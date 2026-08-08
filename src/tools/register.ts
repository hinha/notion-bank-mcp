import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  addressDocument,
  filterSections,
  findSectionRange,
  formatTocYaml,
  replaceLineRange,
  searchInMarkdown,
  sliceLines,
  truncateLines,
} from "../addressing.js";
import {
  applyWorkspaceToConfig,
  etagOf,
  pageUrl,
  requireNotionToken,
  requireRootPageId,
} from "../config.js";

import { log } from "../logging.js";
import { createPageWithMarkdown, updatePageMarkdownExact } from "../notion/ops.js";
import {
  configureWorkspace,
  getConfigStatus,
  NOT_CONFIGURED_MESSAGE,
  normalizePageId,
} from "../user-config.js";

function textResult(payload: unknown) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  return { content: [{ type: "text" as const, text }] };
}

function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  log.error(message);
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}

function formatGetOutput(args: {
  pageId: string;
  url: string;
  markdown: string;
  withLines: boolean;
  sections?: string[];
  maxLines?: number;
}): string {
  let body = args.markdown;
  if (args.sections?.length) {
    body = filterSections(body, args.sections);
  }
  if (args.maxLines && args.maxLines > 0) {
    body = truncateLines(body, args.maxLines);
  }
  const addressed = addressDocument(body);
  const etag = etagOf(args.markdown);
  const header = [
    "---",
    `page_id: ${args.pageId}`,
    `url: ${args.url}`,
    `etag: ${etag}`,
    `lines: 1-${addressed.lineCount}`,
    formatTocYaml(addressed.toc),
    "---",
  ].join("\n");
  const content = args.withLines ? addressed.numbered : addressed.markdown;
  return `${header}\n${content}`;
}

function isHttpOauthMode(runtime: import("../runtime.js").Runtime): boolean {
  return runtime.sessionMeta?.mode === "http-oauth";
}

async function ensureAuth(runtime: import("../runtime.js").Runtime): Promise<void> {
  const { syncAuthFromDisk } = await import("../runtime.js");
  await syncAuthFromDisk(runtime);

  // Proactively refresh before Notion rejects an expired access token.
  if (
    !isHttpOauthMode(runtime) &&
    runtime.config.authSource === "oauth" &&
    runtime.config.notionToken
  ) {
    const { ensureFreshOAuthToken } = await import("../oauth/client.js");
    const refreshed = await ensureFreshOAuthToken();
    if (refreshed) {
      await syncAuthFromDisk(runtime);
    }
  }

  if (runtime.config.notionToken) return;
  if (isHttpOauthMode(runtime)) {
    throw new Error(
      "No Notion auth on this MCP session. Reconnect OAuth in the host (Cursor → MCP → notion-bank).",
    );
  }
  const { oauthAvailable, runOAuthLoginFlow } = await import("../oauth/login.js");
  const avail = oauthAvailable();
  if (!avail.ok) {
    throw new Error(avail.hint);
  }
  // Opens browser automatically — user only installed via npx/command
  const result = await runOAuthLoginFlow({ open_browser: true });
  await syncAuthFromDisk(runtime);
  log.info("Auto OAuth completed", { via: result.via });
}

async function assertReady(runtime: import("../runtime.js").Runtime): Promise<void> {
  await ensureAuth(runtime);
  requireRootPageId(runtime.config);
  requireNotionToken(runtime.config);
}

/** Auth only — for tools that accept an arbitrary parent page id. */
async function assertAuth(runtime: import("../runtime.js").Runtime): Promise<void> {
  await ensureAuth(runtime);
  requireNotionToken(runtime.config);
}

export function registerTools(server: McpServer, runtime: import("../runtime.js").Runtime): void {
  const config = runtime.config;

  const catalog = () => runtime.catalog;
  const notion = () => runtime.notion;

  server.registerTool(
    "plan_status",
    {
      description:
        "Show auth + workspace status. Call first. End users need no CLIENT_ID — browser OAuth opens automatically.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        if (isHttpOauthMode(runtime)) {
          const missing: string[] = [];
          if (!config.notionToken) missing.push("host OAuth reconnect");
          if (!config.rootPageId) missing.push("plan_configure(root_page_url)");
          return textResult({
            configured: Boolean(config.notionToken && config.rootPageId),
            mode: "http-oauth",
            has_notion_auth: Boolean(config.notionToken),
            auth_source: config.authSource,
            root_page_id: config.rootPageId,
            service_count: Object.keys(config.serviceMap).length,
            workspace_name: runtime.sessionMeta?.workspace_name ?? null,
            missing,
            hint: missing.length ? `Not ready. Missing: ${missing.join(", ")}` : "Ready.",
          });
        }
        const { syncAuthFromDisk } = await import("../runtime.js");
        await syncAuthFromDisk(runtime);
        const { oauthAvailable } = await import("../oauth/login.js");
        const { getCredentialsPath, loadOAuthTokens } = await import("../oauth/tokens.js");
        const oauth = loadOAuthTokens();
        const avail = oauthAvailable();
        return textResult({
          ...getConfigStatus({
            hasNotionAuth: Boolean(runtime.config.notionToken),
            authSource: runtime.config.authSource,
            oauthAppConfigured: avail.ok,
            workspaceName: oauth?.workspace_name,
            credentialsPath: getCredentialsPath(),
          }),
          mode: "stdio",
          oauth_mode: avail.mode,
          oauth_hint: avail.hint,
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "plan_oauth_login",
    {
      description:
        "Open browser for Notion login (mcp.notion.com). Auto-runs on first Notion tool if not logged in. No CLIENT_ID/SECRET.",
      inputSchema: z.object({
        wait: z.boolean().optional().describe("Block until browser login finishes (default true)"),
        open_browser: z.boolean().optional().default(true),
        timeout_ms: z.number().int().positive().optional(),
      }),
    },
    async ({ wait, open_browser, timeout_ms }) => {
      try {
        if (isHttpOauthMode(runtime)) {
          return textResult({
            ok: true,
            mode: "http-oauth",
            message:
              "Auth is handled by the MCP host Connect flow. Reconnect notion-bank in MCP settings if needed.",
            has_notion_auth: Boolean(config.notionToken),
          });
        }
        const { runOAuthLoginFlow, startOAuthLoginAsync } = await import("../oauth/login.js");
        const { rebindNotionAuth } = await import("../runtime.js");
        if (wait === false) {
          const started = await startOAuthLoginAsync({
            open_browser,
            timeout_ms,
          });
          return textResult(started);
        }
        const result = await runOAuthLoginFlow({
          open_browser,
          timeoutMs: timeout_ms,
        });
        await rebindNotionAuth(runtime);
        return textResult({
          ...result,
          message:
            "OAuth complete. Tokens saved. Call plan_configure with Plans root URL if needed, then plan_status.",
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "plan_oauth_wait",
    {
      description:
        "Finish a pending plan_oauth_login(wait=false) after the user approves in the browser.",
      inputSchema: z.object({
        timeout_ms: z.number().int().positive().optional(),
      }),
    },
    async ({ timeout_ms }) => {
      try {
        const { waitOAuthLogin } = await import("../oauth/login.js");
        const { rebindNotionAuth } = await import("../runtime.js");
        const result = await waitOAuthLogin(timeout_ms);
        await rebindNotionAuth(runtime);
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "plan_oauth_logout",
    {
      description:
        "Clear saved OAuth credentials for this user (credentials.json). Does not revoke at Notion end.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const { logoutOAuth } = await import("../oauth/client.js");
        const { syncAuthFromDisk } = await import("../runtime.js");
        const cleared = logoutOAuth();
        syncAuthFromDisk(runtime);
        return textResult({
          ok: true,
          cleared,
          auth_source: runtime.config.authSource,
          message: cleared ? "OAuth credentials removed." : "No OAuth credentials file found.",
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "plan_configure",
    {
      description:
        "Persist per-user workspace settings (NOT in repo .env). Pass the user's Plans root Notion URL or UUID. Optional services map slug→page_id. Merges services by default. Call after plan_status when root_page_id missing. Ask the user for their root page — never invent IDs.",
      inputSchema: z.object({
        root_page_id: z.string().optional().describe("Notion page UUID (with or without dashes)"),
        root_page_url: z
          .string()
          .optional()
          .describe("Full Notion page URL containing the page id"),
        services: z
          .record(z.string(), z.string())
          .optional()
          .describe('Optional map e.g. {"my-service":"<page_uuid>"}'),
        export_dir: z.string().optional(),
        merge_services: z
          .boolean()
          .optional()
          .describe("Merge into existing services map (default true)"),
      }),
    },
    async (args) => {
      try {
        const saved = configureWorkspace(args);
        if (runtime.saveWorkspace) {
          runtime.saveWorkspace(saved);
        }
        applyWorkspaceToConfig(config, saved);
        catalog().cache.clear();
        if (isHttpOauthMode(runtime)) {
          return textResult({
            ok: true,
            saved,
            mode: "http-oauth",
            message: "Workspace config saved for this OAuth session. Restart not required.",
          });
        }
        const { oauthAvailable } = await import("../oauth/login.js");
        const { getCredentialsPath, loadOAuthTokens } = await import("../oauth/tokens.js");
        const oauth = loadOAuthTokens();
        const avail = oauthAvailable();
        const status = getConfigStatus({
          hasNotionAuth: Boolean(config.notionToken),
          authSource: config.authSource,
          oauthAppConfigured: avail.ok,
          workspaceName: oauth?.workspace_name,
          credentialsPath: getCredentialsPath(),
        });
        return textResult({
          ok: true,
          saved,
          status,
          message: "Workspace config saved for this user/machine. Restart not required.",
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "plan_ensure_service",
    {
      description:
        "Ensure a service page exists under the configured Plans root. Creates if missing. Requires plan_configure + NOTION_TOKEN.",
      inputSchema: z.object({
        service: z.string().describe('Service slug or name, e.g. "billing" or "Auth Service"'),
        dry_run: z.boolean().optional(),
      }),
    },
    async ({ service, dry_run }) => {
      try {
        await assertReady(runtime);
        if (dry_run) {
          const known = catalog().resolveKnownService(service);
          return textResult({
            dryRun: true,
            wouldCreate: !known,
            service,
            pageId: known ?? "(new)",
          });
        }
        const ref = await catalog().ensureService(service);
        // Persist newly discovered/created service id into user config
        if (ref.created || !config.serviceMap[ref.slug]) {
          const saved = configureWorkspace({
            root_page_id: config.rootPageId!,
            services: { [ref.slug]: ref.pageId },
            merge_services: true,
          });
          if (runtime.saveWorkspace) runtime.saveWorkspace(saved);
          applyWorkspaceToConfig(config, saved);
        }
        return textResult({
          slug: ref.slug,
          page_id: ref.pageId,
          title: ref.title,
          created: Boolean(ref.created),
          url: `https://app.notion.com/p/${ref.pageId.replace(/-/g, "")}`,
        });
      } catch (err) {
        return errorResult(
          err instanceof Error && /not configured/i.test(err.message)
            ? new Error(NOT_CONFIGURED_MESSAGE)
            : err,
        );
      }
    },
  );

  server.registerTool(
    "plan_create_child",
    {
      description:
        "Create a Notion subpage under any parent page (UUID or URL). Use when the user gives a page id/URL and asks for a child under it — does not require plan_configure. For the usual Plans→service→plan bank, prefer plan_ensure_service + plan_upsert.",
      inputSchema: z.object({
        parent_page_id: z
          .string()
          .optional()
          .describe("Parent Notion page UUID (with or without dashes)"),
        parent_page_url: z.string().optional().describe("Full Notion URL of the parent page"),
        title: z.string().describe("Title of the new child page"),
        markdown: z.string().optional().describe("Optional initial markdown body (default: empty)"),
        dry_run: z.boolean().optional(),
      }),
    },
    async ({ parent_page_id, parent_page_url, title, markdown, dry_run }) => {
      try {
        await assertAuth(runtime);
        const parentInput = parent_page_id || parent_page_url;
        if (!parentInput) {
          throw new Error(
            "parent_page_id or parent_page_url is required. Pass the page that should own the new subpage.",
          );
        }
        const parentId = normalizePageId(parentInput);
        const body = markdown?.trim() ? markdown : "";
        if (dry_run) {
          return textResult({
            dryRun: true,
            parent_page_id: parentId,
            title,
            markdown_chars: body.length,
          });
        }
        const created = await createPageWithMarkdown(
          notion(),
          parentId,
          title,
          body || `# ${title}\n`,
        );
        catalog().cache.invalidatePrefix("plans:");
        catalog().cache.invalidatePrefix("services:");
        const url = pageUrl(created.id);
        log.info("Created child page", {
          parent: parentId,
          page_id: created.id,
          title,
        });
        return textResult({
          ok: true,
          parent_page_id: parentId,
          page_id: created.id,
          title,
          url,
          etag: etagOf(body || `# ${title}\n`),
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "plan_migrate",
    {
      description:
        "Migrate a local markdown file into Notion plan bank (upsert under service → title). Requires plan_configure + NOTION_TOKEN. Chunking handled inside MCP.",
      inputSchema: z.object({
        path: z.string().describe("Absolute or relative path to a .md file"),
        service: z.string().describe('Service slug, e.g. "billing"'),
        title: z.string().describe("Plan title (Notion subpage name)"),
        mode: z.enum(["upsert", "create_only"]).optional(),
        dry_run: z.boolean().optional(),
      }),
    },
    async ({ path, service, title, mode, dry_run }) => {
      try {
        await assertReady(runtime);
        const abs = resolve(path);
        const markdown = readFileSync(abs, "utf8");
        const result = await catalog().upsertPlan({
          service,
          title,
          markdown,
          mode,
          dryRun: dry_run,
        });
        const addressed = addressDocument(markdown);
        return textResult({
          ...result,
          path: abs,
          line_count: addressed.lineCount,
          toc: addressed.toc,
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "plan_upsert",
    {
      description:
        "Create or update a plan from a markdown string. Upserts by exact title under the service page. Requires plan_configure + NOTION_TOKEN.",
      inputSchema: z.object({
        service: z.string(),
        title: z.string(),
        markdown: z.string(),
        mode: z.enum(["upsert", "create_only"]).optional(),
        dry_run: z.boolean().optional(),
      }),
    },
    async ({ service, title, markdown, mode, dry_run }) => {
      try {
        await assertReady(runtime);
        const result = await catalog().upsertPlan({
          service,
          title,
          markdown,
          mode,
          dryRun: dry_run,
        });
        const addressed = addressDocument(markdown);
        return textResult({
          ...result,
          line_count: addressed.lineCount,
          toc: addressed.toc,
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "plan_get",
    {
      description:
        "Fetch a plan as addressable markdown with L00N| line numbers, TOC, and etag. Always call before plan_update_range. Requires plan_configure + NOTION_TOKEN.",
      inputSchema: z.object({
        service: z.string(),
        title: z.string().optional(),
        page_id: z.string().optional(),
        with_lines: z.boolean().optional().default(true),
        sections: z.array(z.string()).optional(),
        max_lines: z.number().int().positive().optional(),
      }),
    },
    async ({ service, title, page_id, with_lines, sections, max_lines }) => {
      try {
        await assertReady(runtime);
        const plan = await catalog().resolvePlan({ service, title, page_id });
        const markdown = await catalog().getMarkdown(plan.pageId, true);
        return textResult(
          formatGetOutput({
            pageId: plan.pageId,
            url: plan.url,
            markdown,
            withLines: with_lines ?? true,
            sections,
            maxLines: max_lines,
          }),
        );
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "plan_search",
    {
      description:
        "Search configured plan bank. Hits include service, title, url, line, snippet (lines match plan_get). Requires plan_configure + NOTION_TOKEN.",
      inputSchema: z.object({
        query: z.string(),
        service: z.string().optional(),
        limit: z.number().int().positive().optional().default(20),
      }),
    },
    async ({ query, service, limit }) => {
      try {
        await assertReady(runtime);
        const services = service
          ? [await catalog().ensureService(service)]
          : await catalog().listServices();
        const hits: Array<{
          service: string;
          title: string;
          url: string;
          line: number;
          snippet: string;
        }> = [];
        const perPlan = Math.max(3, Math.ceil((limit ?? 20) / 4));

        for (const svc of services) {
          const plans = await catalog().listPlans(svc.pageId, svc.slug);
          for (const plan of plans) {
            if (hits.length >= (limit ?? 20)) break;
            let md: string;
            try {
              md = await catalog().getMarkdown(plan.pageId);
            } catch {
              continue;
            }
            const found = searchInMarkdown(md, query, perPlan);
            for (const h of found) {
              hits.push({
                service: plan.service,
                title: plan.title,
                url: plan.url,
                line: h.line,
                snippet: h.snippet,
              });
              if (hits.length >= (limit ?? 20)) break;
            }
          }
          if (hits.length >= (limit ?? 20)) break;
        }
        return textResult({ query, count: hits.length, hits });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "plan_update_range",
    {
      description:
        "Surgical update by section (preferred) or start_line/end_line. Pass expected_etag from plan_get. Errors if neither section nor lines given (no silent full replace). Requires plan_configure + NOTION_TOKEN.",
      inputSchema: z.object({
        service: z.string(),
        title: z.string().optional(),
        page_id: z.string().optional(),
        section: z.string().optional(),
        occurrence: z.number().int().positive().optional(),
        start_line: z.number().int().positive().optional(),
        end_line: z.number().int().positive().optional(),
        new_markdown: z.string(),
        expected_etag: z.string().optional(),
        dry_run: z.boolean().optional(),
      }),
    },
    async (args) => {
      try {
        await assertReady(runtime);
        const plan = await catalog().resolvePlan({
          service: args.service,
          title: args.title,
          page_id: args.page_id,
        });
        const current = await catalog().getMarkdown(plan.pageId, true);
        const currentEtag = etagOf(current);

        if (args.expected_etag && args.expected_etag !== currentEtag) {
          throw new Error(
            `etag mismatch: expected ${args.expected_etag}, current ${currentEtag}. Re-run plan_get.`,
          );
        }

        let startLine: number;
        let endLine: number;
        let strategy: string;

        if (args.section) {
          const range = findSectionRange(current, args.section, args.occurrence ?? 1);
          if (!range) {
            throw new Error(`Section not found: ${JSON.stringify(args.section)}`);
          }
          startLine = range.startLine;
          endLine = range.endLine;
          strategy = `section:${range.heading}#${range.occurrence}`;
        } else if (args.start_line != null && args.end_line != null) {
          startLine = args.start_line;
          endLine = args.end_line;
          strategy = `lines:${startLine}-${endLine}`;
        } else {
          throw new Error("Provide section or start_line+end_line. Full replace: use plan_upsert.");
        }

        const oldSlice = sliceLines(current, startLine, endLine);
        const next = replaceLineRange(current, startLine, endLine, args.new_markdown);
        const newEtag = etagOf(next);

        if (args.dry_run) {
          return textResult({
            dryRun: true,
            strategy,
            start_line: startLine,
            end_line: endLine,
            old_preview: oldSlice.slice(0, 500),
            new_preview: args.new_markdown.slice(0, 500),
            etag_current: currentEtag,
            etag_next: newEtag,
            url: plan.url,
          });
        }

        try {
          if (oldSlice && current.split(oldSlice).length === 2) {
            await updatePageMarkdownExact(
              notion(),
              plan.pageId,
              oldSlice,
              args.new_markdown.replace(/\n$/, ""),
            );
          } else {
            await catalog().writeMarkdown(plan.pageId, next);
          }
        } catch {
          await catalog().writeMarkdown(plan.pageId, next);
        }

        catalog().cache.invalidatePrefix(`md:${plan.pageId}`);
        const verified = await catalog().getMarkdown(plan.pageId, true);
        const addressed = addressDocument(verified);

        return textResult({
          ok: true,
          strategy,
          start_line: startLine,
          end_line: endLine,
          page_id: plan.pageId,
          url: plan.url,
          etag: etagOf(verified),
          line_count: addressed.lineCount,
          toc: addressed.toc,
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "plan_sync",
    {
      description:
        "Export a Notion plan (canonical) to a local markdown file. Requires plan_configure + NOTION_TOKEN.",
      inputSchema: z.object({
        service: z.string(),
        title: z.string().optional(),
        page_id: z.string().optional(),
        path: z.string().optional(),
        dry_run: z.boolean().optional(),
      }),
    },
    async ({ service, title, page_id, path, dry_run }) => {
      try {
        await assertReady(runtime);
        const plan = await catalog().resolvePlan({ service, title, page_id });
        const markdown = await catalog().getMarkdown(plan.pageId, true);
        const out =
          path || resolve(config.exportDir, plan.service, `${sanitizeFilename(plan.title)}.md`);

        if (dry_run) {
          return textResult({
            dryRun: true,
            path: out,
            bytes: Buffer.byteLength(markdown, "utf8"),
            etag: etagOf(markdown),
            url: plan.url,
          });
        }

        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, markdown, "utf8");
        return textResult({
          ok: true,
          path: out,
          page_id: plan.pageId,
          url: plan.url,
          etag: etagOf(markdown),
          bytes: Buffer.byteLength(markdown, "utf8"),
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "-").trim() || "plan";
}
