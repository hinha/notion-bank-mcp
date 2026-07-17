#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createRuntime } from "./runtime.js";
import { registerTools } from "./tools/register.js";
import { registerPrompts, registerResources } from "./tools/meta.js";
import { SERVER_INSTRUCTIONS } from "./instructions.js";
import { log } from "./logging.js";

/** End users: stdio (Cursor starts the process). `serve` is only for optional hosted URL. */
function wantsHttp(argv: string[]): boolean {
  if (argv.includes("--stdio")) return false;
  if (argv.includes("serve") || argv.includes("--http")) return true;
  return process.env.NOTION_BANK_MODE?.trim() === "http";
}

async function startStdio(): Promise<void> {
  // If Cursor restarted mid-login, restore localhost callback before tools run.
  const { resumeOAuthCallbackIfNeeded } = await import("./oauth/login.js");
  await resumeOAuthCallbackIfNeeded();

  const config = loadConfig();
  const runtime = createRuntime(config);

  const server = new McpServer(
    {
      name: "notion-bank-mcp",
      version: "1.4.3",
    },
    {
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  registerTools(server, runtime);
  registerResources(server, runtime.config);
  registerPrompts(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info("notion-bank-mcp listening on stdio", {
    configured: Boolean(config.rootPageId),
    authSource: config.authSource,
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (wantsHttp(argv)) {
    const { startHttpServer } = await import("./http/server.js");
    await startHttpServer();
    return;
  }
  await startStdio();
}

main().catch((err) => {
  console.error("[notion-bank] fatal:", err);
  process.exit(1);
});
