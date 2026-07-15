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

export function createRuntime(config: NotionBankConfig): Runtime {
  const notion = new NotionMcpBridge(config.notionToken ?? "");
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
  runtime.notion = new NotionMcpBridge(token);
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

export async function withAuthRetry<T>(
  _runtime: Runtime,
  fn: () => Promise<T>,
): Promise<T> {
  return await fn();
}
