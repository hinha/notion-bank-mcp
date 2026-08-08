import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveAccessToken } from "./oauth/tokens.js";
import { loadUserConfig, type UserWorkspaceConfig } from "./user-config.js";

export type NotionBankConfig = {
  notionToken: string | null;
  /** null until plan_configure */
  rootPageId: string | null;
  serviceMap: Record<string, string>;
  exportDir: string;
  cacheTtlMs: number;
  workspace: UserWorkspaceConfig | null;
  authSource: "oauth" | "env" | "none";
};

function loadDotEnv(): void {
  const candidates = [resolve(process.cwd(), ".env"), resolve(import.meta.dirname, "../../.env")];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
    break;
  }
}

function normalizeSlug(slug: string): string {
  return slug.trim().toLowerCase().replace(/\s+/g, "-");
}

/**
 * Runtime config. Workspace IDs: per-user plan_configure file.
 * Auth: OAuth credentials.json preferred, else NOTION_TOKEN env.
 */
export function loadConfig(): NotionBankConfig {
  loadDotEnv();
  return reloadWorkspace();
}

export function reloadWorkspace(): NotionBankConfig {
  const envToken = process.env.NOTION_TOKEN?.trim() || null;
  const resolved = resolveAccessToken(envToken);
  const cacheTtlMs = Number(process.env.NOTION_BANK_CACHE_TTL_MS || 60_000);
  const workspace = loadUserConfig();
  return {
    notionToken: resolved.token,
    authSource: resolved.source,
    rootPageId: workspace?.root_page_id ?? null,
    serviceMap: { ...(workspace?.services ?? {}) },
    exportDir: workspace?.export_dir?.trim() || resolve(process.cwd(), "exports"),
    cacheTtlMs,
    workspace,
  };
}

export function applyWorkspaceToConfig(
  config: NotionBankConfig,
  workspace: UserWorkspaceConfig,
): void {
  config.workspace = workspace;
  config.rootPageId = workspace.root_page_id;
  config.serviceMap = { ...workspace.services };
  if (workspace.export_dir) config.exportDir = workspace.export_dir;
}

export function slugifyServiceName(name: string): string {
  return normalizeSlug(name);
}

export function etagOf(markdown: string): string {
  return `sha256:${createHash("sha256").update(markdown, "utf8").digest("hex")}`;
}

export function pageUrl(pageId: string): string {
  const id = pageId.replace(/-/g, "");
  return `https://app.notion.com/p/${id}`;
}

export function requireNotionToken(config: NotionBankConfig): string {
  if (!config.notionToken) {
    throw new Error(
      "No Notion credentials. Prefer plan_oauth_login (Public Integration OAuth), or set NOTION_TOKEN for an Internal Integration.",
    );
  }
  return config.notionToken;
}

export function requireRootPageId(config: NotionBankConfig): string {
  if (!config.rootPageId) {
    throw new Error(
      "Workspace not configured. Call plan_configure with the user's Plans root page URL/id first.",
    );
  }
  return config.rootPageId;
}
