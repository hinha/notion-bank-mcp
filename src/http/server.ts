import { randomUUID } from "node:crypto";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthRouter,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import {
  handleNotionCallback,
  NotionBankOAuthProvider,
  notionCallbackUri,
} from "./oauth-provider.js";
import {
  getListenPort,
  getMcpUrl,
  getPublicBaseUrl,
} from "./public-url.js";
import { buildMcpServer, runtimeFromAccessToken } from "./create-mcp.js";
import { getDataDir } from "./session-store.js";
import { log } from "../logging.js";

type TransportEntry = {
  transport: StreamableHTTPServerTransport;
  accessToken: string;
};

export async function startHttpServer(): Promise<void> {
  const publicBase = getPublicBaseUrl();
  const mcpUrl = getMcpUrl();
  const port = getListenPort();
  const host = process.env.NOTION_BANK_HOST?.trim() || "127.0.0.1";
  const issuerUrl = new URL(publicBase);
  const mcpServerUrl = new URL(mcpUrl);

  const appHost =
    host === "0.0.0.0" || host === "::"
      ? {
          host,
          allowedHosts: [
            issuerUrl.hostname,
            "127.0.0.1",
            "localhost",
            "[::1]",
          ],
        }
      : { host };

  const app = createMcpExpressApp(appHost);
  const provider = new NotionBankOAuthProvider();

  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl,
      baseUrl: issuerUrl,
      resourceServerUrl: mcpServerUrl,
      scopesSupported: ["mcp:tools"],
      resourceName: "Notion Bank MCP",
    }),
  );

  app.get("/notion/callback", async (req, res) => {
    await handleNotionCallback(provider, {
      code: typeof req.query.code === "string" ? req.query.code : undefined,
      state: typeof req.query.state === "string" ? req.query.state : undefined,
      error: typeof req.query.error === "string" ? req.query.error : undefined,
    }, res);
  });

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      mcp_url: mcpUrl,
      oauth_ready: true,
      oauth_upstream: "https://mcp.notion.com",
      notion_callback: notionCallbackUri(),
      note: "No CLIENT_ID/SECRET. Auth uses mcp.notion.com Dynamic Client Registration.",
      data_dir: getDataDir(),
    });
  });

  const authMiddleware = requireBearerAuth({
    verifier: provider,
    requiredScopes: [],
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpServerUrl),
  });

  const transports: Record<string, TransportEntry> = {};

  const mcpHandler = async (req: import("express").Request, res: import("express").Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const accessToken = req.auth?.token;
    if (!accessToken) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    try {
      let entry = sessionId ? transports[sessionId] : undefined;

      if (entry) {
        await entry.transport.handleRequest(req, res, req.body);
        return;
      }

      if (!sessionId && isInitializeRequest(req.body)) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            transports[sid] = { transport, accessToken };
          },
        });
        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid) delete transports[sid];
        };

        const runtime = runtimeFromAccessToken(accessToken);
        const server = buildMcpServer(runtime);
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      }

      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: No valid session ID provided",
        },
        id: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("MCP HTTP error", { message });
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message },
          id: null,
        });
      }
    }
  };

  app.post("/mcp", authMiddleware, mcpHandler);
  app.get("/mcp", authMiddleware, mcpHandler);
  app.delete("/mcp", authMiddleware, mcpHandler);

  await new Promise<void>((resolve, reject) => {
    app.listen(port, host, (err?: Error) => {
      if (err) reject(err);
      else resolve();
    });
  });

  log.info("notion-bank-mcp HTTP listening", {
    host,
    port,
    mcp_url: mcpUrl,
    oauth_upstream: "https://mcp.notion.com",
  });
  // eslint-disable-next-line no-console
  console.error(
    `[notion-bank] MCP URL (install this): ${mcpUrl}\n` +
      `[notion-bank] OAuth via mcp.notion.com (no CLIENT_ID/SECRET)\n` +
      `[notion-bank] Callback: ${notionCallbackUri()}`,
  );
}
