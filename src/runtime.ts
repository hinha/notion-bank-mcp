import type { NotionBankConfig } from "./config.js";
import { reloadWorkspace } from "./config.js";
import { Catalog } from "./catalog.js";
import { NotionMcpBridge } from "./notion/mcp-upstream.js";
import { log } from "./logging.js";
import type { UserWorkspaceConfig } from "./user-config.js";

export type Runtime = {
  config: NotionBankConfig;
  notion: NotionMcpBridge;
  catalog: Catalog;
  /** Set in hosted HTTP OAuth mode */
  accessToken?: string;
  saveWorkspace?: (workspace: UserWorkspaceConfig) => void;
  sessionMeta?: { workspace_name: string | null; mode: string };
};

function createBridge(config: NotionBankConfig): NotionMcpBridge {
  const allowRefresh = () => config.authSource === "oauth";
  return new NotionMcpBridge(config.notionToken ?? "", {
    onUnauthorized: async () => {
      if (!allowRefresh()) return null;
      const { tryRefreshOAuth } = await import("./oauth/client.js");
      const next = await tryRefreshOAuth();
      if (!next) return null;
      config.notionToken = next.access_token;
      config.authSource = "oauth";
      return next.access_token;
    },
  });
}

export function createRuntime(config: NotionBankConfig): Runtime {
  const notion = createBridge(config);
  const catalog = new Catalog(notion, config);
  return { config, notion, catalog };
}

/** After OAuth login/logout, rebuild Notion MCP bridge from current config. */
export async function rebindNotionAuth(runtime: Runtime): Promise<void> {
  const token = runtime.config.notionToken ?? "";
  try {
    await runtime.notion.close();
  } catch {
    /* ignore */
  }
  runtime.notion = createBridge(runtime.config);
  if (token) runtime.notion.setAccessToken(token);
  runtime.catalog = new Catalog(runtime.notion, runtime.config);
  log.info("Notion MCP client rebound", {
    source: runtime.config.authSource,
  });
}

/** Reload credentials.json / config into a live runtime (e.g. after wait=false OAuth). */
export async function syncAuthFromDisk(runtime: Runtime): Promise<void> {
  const next = reloadWorkspace();
  runtime.config.notionToken = next.notionToken;
  runtime.config.authSource = next.authSource;
  runtime.config.rootPageId = next.rootPageId;
  runtime.config.serviceMap = next.serviceMap;
  runtime.config.exportDir = next.exportDir;
  runtime.config.workspace = next.workspace;
  await rebindNotionAuth(runtime);
}

/**
 * Run a Notion-backed operation; on Invalid auth token, refresh OAuth once and retry.
 */
export async function withAuthRetry<T>(
  runtime: Runtime,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const { isInvalidAuthError, tryRefreshOAuth } = await import(
      "./oauth/client.js"
    );
    if (!isInvalidAuthError(err) || runtime.config.authSource !== "oauth") {
      throw err;
    }
    if (runtime.sessionMeta?.mode === "http-oauth") {
      throw err;
    }
    const next = await tryRefreshOAuth();
    if (!next) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `${msg} — token refresh failed. Run plan_oauth_login again.`,
      );
    }
    runtime.config.notionToken = next.access_token;
    runtime.config.authSource = "oauth";
    await rebindNotionAuth(runtime);
    return await fn();
  }
}
