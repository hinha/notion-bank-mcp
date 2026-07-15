import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

function slugifyServiceName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

export type UserWorkspaceConfig = {
  /** Plans root page UUID (with or without dashes) */
  root_page_id: string;
  /** Optional slug → Notion page id map */
  services: Record<string, string>;
  /** Optional default export directory for plan_sync */
  export_dir?: string;
  updated_at: string;
};

export type ConfigStatus = {
  configured: boolean;
  config_path: string;
  credentials_path: string;
  has_notion_auth: boolean;
  auth_source: "oauth" | "env" | "none";
  oauth_app_configured: boolean;
  root_page_id: string | null;
  service_count: number;
  export_dir: string | null;
  workspace_name?: string | null;
  missing: string[];
  hint: string;
};

function xdgConfigHome(): string {
  return (
    process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config")
  );
}

/** Per-user config file. Not shared via repo .env. */
export function configPath(): string {
  const override = process.env.NOTION_BANK_CONFIG_PATH?.trim();
  if (override) return override;
  return join(xdgConfigHome(), "notion-bank", "config.json");
}

export function normalizePageId(input: string): string {
  const raw = input.trim();
  // Full Notion URL or path ending with 32 hex
  const hex = raw.match(/([0-9a-fA-F]{32})/);
  if (hex) {
    const h = hex[1].toLowerCase();
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  const dashed = raw.match(
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
  );
  if (dashed) return raw.toLowerCase();
  throw new Error(
    `Could not parse Notion page id from: ${JSON.stringify(input)}. Pass a page URL or UUID.`,
  );
}

export function loadUserConfig(): UserWorkspaceConfig | null {
  const path = configPath();
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<UserWorkspaceConfig>;
    if (!raw.root_page_id) return null;
    const services: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw.services ?? {})) {
      services[slugifyServiceName(k)] = normalizePageId(String(v));
    }
    return {
      root_page_id: normalizePageId(raw.root_page_id),
      services,
      export_dir: raw.export_dir,
      updated_at: raw.updated_at ?? new Date().toISOString(),
    };
  } catch (err) {
    throw new Error(
      `Invalid config at ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function saveUserConfig(
  next: Omit<UserWorkspaceConfig, "updated_at"> & { updated_at?: string },
): UserWorkspaceConfig {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  const services: Record<string, string> = {};
  for (const [k, v] of Object.entries(next.services ?? {})) {
    services[slugifyServiceName(k)] = normalizePageId(String(v));
  }
  const saved: UserWorkspaceConfig = {
    root_page_id: normalizePageId(next.root_page_id),
    services,
    export_dir: next.export_dir,
    updated_at: next.updated_at ?? new Date().toISOString(),
  };
  writeFileSync(path, JSON.stringify(saved, null, 2) + "\n", "utf8");
  return saved;
}

export function configureWorkspace(args: {
  root_page_id?: string;
  root_page_url?: string;
  services?: Record<string, string>;
  export_dir?: string;
  /** If true (default), merge services into existing map */
  merge_services?: boolean;
}): UserWorkspaceConfig {
  const rootInput = args.root_page_id || args.root_page_url;
  const existing = loadUserConfig();
  const merge = args.merge_services !== false;

  if (!rootInput && !existing) {
    throw new Error(
      "root_page_id or root_page_url is required on first configure.",
    );
  }

  const root = rootInput
    ? normalizePageId(rootInput)
    : existing!.root_page_id;

  let services: Record<string, string> = {};
  if (merge && existing) services = { ...existing.services };
  if (args.services) {
    for (const [k, v] of Object.entries(args.services)) {
      services[slugifyServiceName(k)] = normalizePageId(v);
    }
  }

  return saveUserConfig({
    root_page_id: root,
    services,
    export_dir: args.export_dir ?? existing?.export_dir,
  });
}

export function getConfigStatus(args: {
  hasNotionAuth: boolean;
  authSource: "oauth" | "env" | "none";
  oauthAppConfigured: boolean;
  workspaceName?: string | null;
  credentialsPath: string;
}): ConfigStatus {
  const path = configPath();
  let workspace: UserWorkspaceConfig | null = null;
  try {
    workspace = loadUserConfig();
  } catch {
    workspace = null;
  }
  const missing: string[] = [];
  if (!args.hasNotionAuth) {
    missing.push(
      args.oauthAppConfigured
        ? "plan_oauth_login (auto on first Notion tool)"
        : "OAuth (this build is misconfigured by the distributor)",
    );
  }
  if (!workspace?.root_page_id) missing.push("plan_configure(root_page_id)");

  return {
    configured: Boolean(workspace?.root_page_id) && args.hasNotionAuth,
    config_path: path,
    credentials_path: args.credentialsPath,
    has_notion_auth: args.hasNotionAuth,
    auth_source: args.authSource,
    oauth_app_configured: args.oauthAppConfigured,
    root_page_id: workspace?.root_page_id ?? null,
    service_count: workspace ? Object.keys(workspace.services).length : 0,
    export_dir: workspace?.export_dir ?? null,
    workspace_name: args.workspaceName ?? null,
    missing,
    hint:
      missing.length === 0
        ? "Ready. Use plan_get / plan_upsert / plan_update_range."
        : `Not ready. Missing: ${missing.join(", ")}. ` +
          (!args.hasNotionAuth
            ? args.oauthAppConfigured
              ? "Call plan_oauth_login, or use any Notion tool — OAuth starts automatically in the browser."
              : "This build is misconfigured by the distributor. Notion OAuth cannot start until the distributor fixes the published MCP build."
            : "Ask the user for their Plans root Notion URL, then call plan_configure."),
  };
}

export const NOT_CONFIGURED_MESSAGE =
  "Plan bank workspace is not configured. Call plan_status, then plan_configure with the user's Plans root page URL or id. Do not invent page IDs. Config is stored per-user (see plan_status.config_path), not in repo .env.";
