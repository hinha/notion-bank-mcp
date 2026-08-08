import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { NotionBankConfig } from "../config.js";
import { SERVER_INSTRUCTIONS } from "../instructions.js";
import { getPackageVersion } from "../package-meta.js";
import { createRuntime, type Runtime } from "../runtime.js";
import { registerPrompts, registerResources } from "../tools/meta.js";
import { registerTools } from "../tools/register.js";
import type { UserWorkspaceConfig } from "../user-config.js";
import { getToken, type McpTokenRecord, updateTokenWorkspace } from "./session-store.js";

function configFromSession(rec: McpTokenRecord): NotionBankConfig {
  return {
    notionToken: rec.notion.access_token,
    authSource: "oauth",
    rootPageId: rec.workspace?.root_page_id ?? null,
    serviceMap: { ...(rec.workspace?.services ?? {}) },
    exportDir: rec.workspace?.export_dir?.trim() || resolve(process.cwd(), "exports"),
    cacheTtlMs: Number(process.env.NOTION_BANK_CACHE_TTL_MS || 60_000),
    workspace: rec.workspace,
  };
}

export function runtimeFromAccessToken(accessToken: string): Runtime {
  const rec = getToken(accessToken);
  if (!rec) {
    throw new Error("MCP session expired. Reconnect OAuth in the host.");
  }
  const config = configFromSession(rec);
  const runtime = createRuntime(config);
  runtime.accessToken = accessToken;
  runtime.saveWorkspace = (workspace: UserWorkspaceConfig) => {
    updateTokenWorkspace(accessToken, workspace);
    runtime.config.rootPageId = workspace.root_page_id;
    runtime.config.serviceMap = { ...workspace.services };
    runtime.config.exportDir = workspace.export_dir?.trim() || runtime.config.exportDir;
    runtime.config.workspace = workspace;
  };
  runtime.sessionMeta = {
    workspace_name: rec.notion.workspace_name ?? null,
    mode: "http-oauth",
  };
  return runtime;
}

export function buildMcpServer(runtime: Runtime): McpServer {
  const server = new McpServer(
    {
      name: "notion-bank-mcp",
      version: getPackageVersion(),
    },
    {
      instructions: SERVER_INSTRUCTIONS,
    },
  );
  registerTools(server, runtime);
  registerResources(server, runtime.config);
  registerPrompts(server);
  return server;
}
