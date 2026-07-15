import {
  etagOf,
  pageUrl,
  slugifyServiceName,
  type NotionBankConfig,
} from "./config.js";
import { TtlCache } from "./cache.js";
import { log } from "./logging.js";
import type { NotionMcpBridge } from "./notion/mcp-upstream.js";
import {
  createPageWithMarkdown,
  getPageTitle,
  listChildPages,
  replacePageMarkdown,
  retrieveMarkdown,
} from "./notion/ops.js";

export type ServiceRef = {
  slug: string;
  pageId: string;
  title: string;
  created?: boolean;
};

export type PlanRef = {
  service: string;
  title: string;
  pageId: string;
  url: string;
};

export class Catalog {
  readonly cache: TtlCache;

  constructor(
    private readonly notion: NotionMcpBridge,
    private readonly config: NotionBankConfig,
  ) {
    this.cache = new TtlCache(config.cacheTtlMs);
  }

  resolveKnownService(slug: string): string | undefined {
    const key = slugifyServiceName(slug);
    return this.config.serviceMap[key];
  }

  async ensureService(slugOrName: string): Promise<ServiceRef> {
    const slug = slugifyServiceName(slugOrName);
    const known = this.resolveKnownService(slug);
    if (known) {
      const title = await this.cachedTitle(known);
      return { slug, pageId: known, title };
    }

    const children = await this.listServices(true);
    const hit = children.find(
      (c) => slugifyServiceName(c.title) === slug || c.slug === slug,
    );
    if (hit) {
      this.config.serviceMap[slug] = hit.pageId;
      return { slug, pageId: hit.pageId, title: hit.title };
    }

    const title = humanizeSlug(slugOrName);
    const rootPageId = this.config.rootPageId;
    if (!rootPageId) {
      throw new Error(
        "Workspace not configured. Call plan_configure before ensuring a service.",
      );
    }
    log.info("Creating service page", { title, parent: rootPageId });
    const created = await createPageWithMarkdown(
      this.notion,
      rootPageId,
      title,
      `Service page for **${title}**.\n\nPlan subpages live under this page.`,
    );
    this.config.serviceMap[slug] = created.id;
    this.cache.invalidatePrefix("services:");
    this.cache.invalidatePrefix("plans:");
    return { slug, pageId: created.id, title, created: true };
  }

  async listServices(force = false): Promise<
    Array<{ slug: string; pageId: string; title: string }>
  > {
    const key = "services:root";
    if (!force) {
      const cached = this.cache.get<
        Array<{ slug: string; pageId: string; title: string }>
      >(key);
      if (cached) return cached;
    }

    const fromMap = Object.entries(this.config.serviceMap).map(
      ([slug, pageId]) => ({
        slug,
        pageId,
        title: humanizeSlug(slug),
      }),
    );

    const rootPageId = this.config.rootPageId;
    if (!rootPageId) {
      throw new Error(
        "Workspace not configured. Call plan_configure before listing services.",
      );
    }
    const children = await listChildPages(this.notion, rootPageId);
    const byId = new Map(fromMap.map((s) => [s.pageId, s]));
    for (const child of children) {
      const slug = slugifyServiceName(child.title);
      const existing = byId.get(child.id);
      if (existing) {
        existing.title = child.title;
        existing.slug = slug;
      } else {
        byId.set(child.id, { slug, pageId: child.id, title: child.title });
        this.config.serviceMap[slug] = child.id;
      }
    }

    const list = [...byId.values()].sort((a, b) =>
      a.title.localeCompare(b.title),
    );
    this.cache.set(key, list);
    return list;
  }

  async findPlan(
    serviceSlug: string,
    title: string,
  ): Promise<PlanRef | null> {
    const service = await this.ensureService(serviceSlug);
    const plans = await this.listPlans(service.pageId, service.slug);
    const exact = plans.find((p) => p.title === title);
    return exact ?? null;
  }

  async listPlans(
    servicePageId: string,
    serviceSlug: string,
    force = false,
  ): Promise<PlanRef[]> {
    const key = `plans:${servicePageId}`;
    if (!force) {
      const cached = this.cache.get<PlanRef[]>(key);
      if (cached) return cached;
    }
    const children = await listChildPages(this.notion, servicePageId);
    const plans = children.map((c) => ({
      service: serviceSlug,
      title: c.title,
      pageId: c.id,
      url: pageUrl(c.id),
    }));
    this.cache.set(key, plans);
    return plans;
  }

  async resolvePlan(args: {
    service: string;
    title?: string;
    page_id?: string;
  }): Promise<PlanRef> {
    if (args.page_id) {
      const title =
        args.title || (await this.cachedTitle(args.page_id)) || args.page_id;
      return {
        service: slugifyServiceName(args.service),
        title,
        pageId: args.page_id,
        url: pageUrl(args.page_id),
      };
    }
    if (!args.title) {
      throw new Error("Either page_id or title is required");
    }
    const found = await this.findPlan(args.service, args.title);
    if (!found) {
      throw new Error(
        `Plan not found: service=${args.service} title=${JSON.stringify(args.title)}`,
      );
    }
    return found;
  }

  async upsertPlan(args: {
    service: string;
    title: string;
    markdown: string;
    mode?: "upsert" | "create_only";
    dryRun?: boolean;
  }): Promise<{
    plan: PlanRef;
    created: boolean;
    etag: string;
    dryRun: boolean;
  }> {
    const mode = args.mode ?? "upsert";
    const service = await this.ensureService(args.service);
    const existing = await this.findPlan(service.slug, args.title);

    if (existing && mode === "create_only") {
      throw new Error(
        `Plan already exists (create_only): ${existing.url}`,
      );
    }

    if (args.dryRun) {
      return {
        plan:
          existing ??
          ({
            service: service.slug,
            title: args.title,
            pageId: "(dry-run)",
            url: "(dry-run)",
          } satisfies PlanRef),
        created: !existing,
        etag: etagOf(args.markdown),
        dryRun: true,
      };
    }

    if (existing) {
      await this.writeMarkdown(existing.pageId, args.markdown);
      this.cache.invalidatePrefix(`md:${existing.pageId}`);
      this.cache.invalidatePrefix(`plans:${service.pageId}`);
      return {
        plan: existing,
        created: false,
        etag: etagOf(args.markdown),
        dryRun: false,
      };
    }

    const created = await createPageWithMarkdown(
      this.notion,
      service.pageId,
      args.title,
      args.markdown,
    );
    this.cache.invalidatePrefix(`plans:${service.pageId}`);
    const plan: PlanRef = {
      service: service.slug,
      title: args.title,
      pageId: created.id,
      url: pageUrl(created.id),
    };
    return {
      plan,
      created: true,
      etag: etagOf(args.markdown),
      dryRun: false,
    };
  }

  async getMarkdown(pageId: string, force = false): Promise<string> {
    const key = `md:${pageId}`;
    if (!force) {
      const cached = this.cache.get<string>(key);
      if (cached !== undefined) return cached;
    }
    const md = await retrieveMarkdown(this.notion, pageId);
    this.cache.set(key, md);
    return md;
  }

  async writeMarkdown(pageId: string, markdown: string): Promise<void> {
    await replacePageMarkdown(this.notion, pageId, markdown);
    this.cache.set(`md:${pageId}`, markdown);
  }

  private async cachedTitle(pageId: string): Promise<string> {
    const key = `title:${pageId}`;
    const cached = this.cache.get<string>(key);
    if (cached) return cached;
    const title = await getPageTitle(this.notion, pageId);
    this.cache.set(key, title);
    return title;
  }
}

function humanizeSlug(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
