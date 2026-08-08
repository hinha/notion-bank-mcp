/**
 * Hosted OAuth broker — ONLY this process needs Notion Public Integration secrets.
 * End-user MCP clients never see CLIENT_ID / CLIENT_SECRET.
 *
 * Endpoints:
 *   GET  /health
 *   GET  /oauth/start?state=&client_redirect=  → redirect to Notion
 *   GET  /oauth/callback                      → Notion redirect (exchange + session)
 *   GET  /oauth/session/:id                   → one-time token pickup (JSON)
 */

import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { log } from "../logging.js";
import { loadDotEnvForBroker } from "./broker-env.js";

type SessionPayload = {
  access_token: string;
  refresh_token: string | null;
  token_type: string;
  bot_id?: string;
  workspace_id?: string;
  workspace_name?: string | null;
  expires_at: number;
};

type PendingStart = {
  state: string;
  client_redirect: string;
  expires_at: number;
};

const sessions = new Map<string, SessionPayload>();
const pendings = new Map<string, PendingStart>(); // key = state

const SESSION_TTL_MS = 5 * 60 * 1000;

function prune(): void {
  const now = Date.now();
  for (const [k, v] of sessions) {
    if (v.expires_at < now) sessions.delete(k);
  }
  for (const [k, v] of pendings) {
    if (v.expires_at < now) pendings.delete(k);
  }
}

function requireApp(): {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} {
  const clientId = process.env.NOTION_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.NOTION_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Broker requires NOTION_OAUTH_CLIENT_ID and NOTION_OAUTH_CLIENT_SECRET");
  }
  const port = Number(process.env.NOTION_BANK_BROKER_PORT || 8787);
  const publicBase =
    process.env.NOTION_BANK_BROKER_PUBLIC_URL?.replace(/\/$/, "") || `http://127.0.0.1:${port}`;
  const redirectUri =
    process.env.NOTION_OAUTH_REDIRECT_URI?.trim() || `${publicBase}/oauth/callback`;
  return { clientId, clientSecret, redirectUri };
}

function html(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;line-height:1.5}</style>
</head><body><h1>${title}</h1><p>${body}</p></body></html>`;
}

async function exchangeCode(
  app: ReturnType<typeof requireApp>,
  code: string,
): Promise<{
  access_token: string;
  refresh_token?: string | null;
  token_type?: string;
  bot_id?: string;
  workspace_id?: string;
  workspace_name?: string | null;
}> {
  const basic = Buffer.from(`${app.clientId}:${app.clientSecret}`, "utf8").toString("base64");
  const res = await fetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/json",
      "Notion-Version": "2026-03-11",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: app.redirectUri,
    }),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(`token exchange failed: ${JSON.stringify(json).slice(0, 300)}`);
  }
  return json as {
    access_token: string;
    refresh_token?: string | null;
    token_type?: string;
    bot_id?: string;
    workspace_id?: string;
    workspace_name?: string | null;
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  prune();
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const app = requireApp();

  if (url.pathname === "/health") {
    sendJson(res, 200, { ok: true, service: "notion-bank-oauth-broker" });
    return;
  }

  if (url.pathname === "/oauth/start") {
    const state = url.searchParams.get("state");
    const clientRedirect = url.searchParams.get("client_redirect");
    if (!state || !clientRedirect) {
      sendJson(res, 400, { error: "state and client_redirect required" });
      return;
    }
    // Only allow localhost callbacks from MCP clients
    let redirectOk = false;
    try {
      const u = new URL(clientRedirect);
      redirectOk =
        (u.hostname === "127.0.0.1" || u.hostname === "localhost") &&
        (u.protocol === "http:" || u.protocol === "https:");
    } catch {
      redirectOk = false;
    }
    if (!redirectOk) {
      sendJson(res, 400, {
        error: "client_redirect must be http(s)://127.0.0.1 or localhost",
      });
      return;
    }

    pendings.set(state, {
      state,
      client_redirect: clientRedirect,
      expires_at: Date.now() + SESSION_TTL_MS,
    });

    const auth = new URL("https://api.notion.com/v1/oauth/authorize");
    auth.searchParams.set("client_id", app.clientId);
    auth.searchParams.set("response_type", "code");
    auth.searchParams.set("owner", "user");
    auth.searchParams.set("redirect_uri", app.redirectUri);
    auth.searchParams.set("state", state);
    res.writeHead(302, { Location: auth.toString() });
    res.end();
    return;
  }

  if (url.pathname === "/oauth/callback") {
    const err = url.searchParams.get("error");
    if (err) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html("Authorization failed", err));
      return;
    }
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html("Missing code/state", "Try again from your agent."));
      return;
    }
    const pending = pendings.get(state);
    pendings.delete(state);
    if (!pending) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html("Unknown or expired state", "Call plan_oauth_login again."));
      return;
    }
    try {
      const tokens = await exchangeCode(app, code);
      const sessionId = randomBytes(24).toString("hex");
      sessions.set(sessionId, {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token ?? null,
        token_type: tokens.token_type || "bearer",
        bot_id: tokens.bot_id,
        workspace_id: tokens.workspace_id,
        workspace_name: tokens.workspace_name ?? null,
        expires_at: Date.now() + SESSION_TTL_MS,
      });
      const back = new URL(pending.client_redirect);
      back.searchParams.set("session", sessionId);
      back.searchParams.set("state", state);
      res.writeHead(302, { Location: back.toString() });
      res.end();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html("Token exchange failed", message));
    }
    return;
  }

  if (url.pathname === "/oauth/refresh" && req.method === "POST") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    let body: { refresh_token?: string };
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        refresh_token?: string;
      };
    } catch {
      sendJson(res, 400, { error: "invalid json" });
      return;
    }
    if (!body.refresh_token) {
      sendJson(res, 400, { error: "refresh_token required" });
      return;
    }
    try {
      const basic = Buffer.from(`${app.clientId}:${app.clientSecret}`, "utf8").toString("base64");
      const tokenRes = await fetch("https://api.notion.com/v1/oauth/token", {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/json",
          "Notion-Version": "2026-03-11",
        },
        body: JSON.stringify({
          grant_type: "refresh_token",
          refresh_token: body.refresh_token,
        }),
      });
      const json = (await tokenRes.json()) as Record<string, unknown>;
      if (!tokenRes.ok) {
        sendJson(res, tokenRes.status, { error: json });
        return;
      }
      sendJson(res, 200, json);
    } catch (e) {
      sendJson(res, 500, {
        error: e instanceof Error ? e.message : String(e),
      });
    }
    return;
  }

  const sessionMatch = url.pathname.match(/^\/oauth\/session\/([a-f0-9]+)$/);
  if (sessionMatch && req.method === "GET") {
    const id = sessionMatch[1];
    const payload = sessions.get(id);
    sessions.delete(id); // one-time
    if (!payload || payload.expires_at < Date.now()) {
      sendJson(res, 404, { error: "session not found or expired" });
      return;
    }
    sendJson(res, 200, {
      access_token: payload.access_token,
      refresh_token: payload.refresh_token,
      token_type: payload.token_type,
      bot_id: payload.bot_id,
      workspace_id: payload.workspace_id,
      workspace_name: payload.workspace_name,
    });
    return;
  }

  sendJson(res, 404, { error: "not found" });
}

export async function startBrokerServer(): Promise<void> {
  loadDotEnvForBroker();
  const port = Number(process.env.NOTION_BANK_BROKER_PORT || 8787);
  const app = requireApp();
  const server = createServer((req, res) => {
    void handler(req, res).catch((err) => {
      log.error("broker handler error", { err: String(err) });
      sendJson(res, 500, { error: "internal" });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.listen(port, "0.0.0.0", () => resolve());
    server.once("error", reject);
  });
  log.info("notion-bank OAuth broker listening", {
    port,
    redirect_uri: app.redirectUri,
  });
  console.error(
    `[notion-bank-broker] listening on :${port}\n` +
      `  Notion redirect URI must be: ${app.redirectUri}\n` +
      `  Clients use NOTION_BANK_OAUTH_BROKER_URL pointing at this host`,
  );
}
