/**
 * Stdio OAuth via mcp.notion.com (DCR).
 *
 * Callback server is durable for the MCP process lifetime + pending state is
 * persisted to disk so Cursor MCP restarts mid-login don't break redirect to
 * http://127.0.0.1:8765/callback.
 */
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { openBrowserIfEnabled } from "./browser.js";
import { saveOAuthTokens, type OAuthTokens } from "./tokens.js";
import {
  buildNotionMcpAuthorizeUrl,
  exchangeNotionMcpCode,
  newPkce,
  NotionMcpBridge,
} from "../notion/mcp-upstream.js";
import { log } from "../logging.js";

export type LoginResult = {
  ok: true;
  tokens: {
    workspace_id?: string;
    workspace_name?: string | null;
    bot_id?: string;
    obtained_at: string;
  };
  authorize_url: string;
  redirect_uri: string;
  via: "mcp.notion.com";
};

type Pending = {
  state: string;
  authorize_url: string;
  redirect_uri: string;
  code_verifier: string;
  expires_at: number;
  done: Promise<OAuthTokens>;
  resolveDone: (t: OAuthTokens) => void;
  rejectDone: (e: Error) => void;
};

let pending: Pending | null = null;
/** Lives for the whole MCP process — never closed on restart/success. */
let callbackServer: Server | null = null;
let callbackListening = false;

const LOCAL_CALLBACK_PORT = Number(
  process.env.NOTION_BANK_LOCAL_CALLBACK_PORT || 8765,
);

function localCallbackUri(): string {
  return `http://127.0.0.1:${LOCAL_CALLBACK_PORT}/callback`;
}

function pendingPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");
  return join(xdg, "notion-bank", "oauth-pending.json");
}

type StoredPending = {
  state: string;
  authorize_url: string;
  redirect_uri: string;
  code_verifier: string;
  expires_at: number;
};

function writePendingFile(p: StoredPending): void {
  const path = pendingPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(p, null, 2), { mode: 0o600 });
}

function readPendingFile(): StoredPending | null {
  const path = pendingPath();
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as StoredPending;
    if (!raw.state || !raw.code_verifier || !raw.redirect_uri) return null;
    if (raw.expires_at < Date.now()) {
      clearPendingFile();
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

function clearPendingFile(): void {
  try {
    unlinkSync(pendingPath());
  } catch {
    /* ignore */
  }
}

export function getPendingOAuth(): {
  authorize_url: string;
  redirect_uri: string;
  state: string;
} | null {
  if (pending) {
    return {
      authorize_url: pending.authorize_url,
      redirect_uri: pending.redirect_uri,
      state: pending.state,
    };
  }
  const stored = readPendingFile();
  if (!stored) return null;
  return {
    authorize_url: stored.authorize_url,
    redirect_uri: stored.redirect_uri,
    state: stored.state,
  };
}

function clearPendingMemory(reason: string): void {
  if (!pending) return;
  pending = null;
  log.warn("OAuth pending cleared", { reason });
}

function summarize(tokens: OAuthTokens): LoginResult["tokens"] {
  return {
    workspace_id: tokens.workspace_id,
    workspace_name: tokens.workspace_name,
    bot_id: tokens.bot_id,
    obtained_at: tokens.obtained_at,
  };
}

/** Always available — uses mcp.notion.com DCR (no CLIENT_ID/SECRET). */
export function oauthAvailable(): {
  ok: boolean;
  mode: "mcp.notion.com";
  hint: string;
} {
  return {
    ok: true,
    mode: "mcp.notion.com",
    hint: "Browser OAuth via mcp.notion.com (automatic). No CLIENT_ID/SECRET.",
  };
}

async function workspaceName(accessToken: string): Promise<string | null> {
  try {
    const bridge = new NotionMcpBridge(accessToken);
    const self = await bridge.fetch("self");
    await bridge.close();
    const m =
      self.match(/"name"\s*:\s*"([^"]+)"/) ||
      self.match(/workspace[^"]*"([^"]+)"/i);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

function html(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;line-height:1.5}</style>
</head><body><h1>${title}</h1><p>${body}</p></body></html>`;
}

async function handleCallback(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const u = new URL(req.url || "/", `http://127.0.0.1:${LOCAL_CALLBACK_PORT}`);
  if (u.pathname !== "/callback") {
    res.writeHead(404).end("Not found");
    return;
  }

  // Prefer in-memory pending; fall back to disk (MCP may have restarted).
  if (!pending) {
    const stored = readPendingFile();
    if (stored) attachPendingFromStored(stored);
  }

  const err = u.searchParams.get("error");
  if (err) {
    res.writeHead(400, { "Content-Type": "text/html" }).end(html("Denied", err));
    pending?.rejectDone(new Error(`OAuth denied: ${err}`));
    clearPendingMemory("denied");
    clearPendingFile();
    return;
  }

  const code = u.searchParams.get("code");
  const st = u.searchParams.get("state");
  if (!code || !pending || st !== pending.state) {
    res
      .writeHead(400, { "Content-Type": "text/html" })
      .end(
        html(
          "Invalid callback",
          "Login session missing. In Cursor, run plan_oauth_login again, then retry.",
        ),
      );
    return;
  }

  try {
    const tokens = await exchangeNotionMcpCode({
      redirectUri: pending.redirect_uri,
      code,
      codeVerifier: pending.code_verifier,
    });
    const workspace_name = await workspaceName(tokens.access_token);
    const saved = saveOAuthTokens({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type: tokens.token_type,
      workspace_name,
      expires_in: tokens.expires_in,
    });
    res
      .writeHead(200, { "Content-Type": "text/html" })
      .end(
        html(
          "notion-bank connected",
          "You can close this tab and return to Cursor.",
        ),
      );
    pending.resolveDone(saved);
    clearPendingMemory("success");
    clearPendingFile();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res
      .writeHead(500, { "Content-Type": "text/html" })
      .end(html("Failed", message));
    pending.rejectDone(e instanceof Error ? e : new Error(message));
    clearPendingMemory("error");
    clearPendingFile();
  }
}

function attachPendingFromStored(stored: StoredPending): void {
  let resolveDone!: (t: OAuthTokens) => void;
  let rejectDone!: (e: Error) => void;
  const done = new Promise<OAuthTokens>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  pending = {
    ...stored,
    done,
    resolveDone,
    rejectDone,
  };
}

export async function ensureCallbackServer(): Promise<void> {
  if (callbackListening && callbackServer) return;

  if (!callbackServer) {
    callbackServer = createServer((req, res) => {
      void handleCallback(req, res);
    });
  }

  await new Promise<void>((resolve, reject) => {
    const server = callbackServer!;
    const onError = (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE" && callbackListening) {
        resolve();
        return;
      }
      reject(err);
    };
    server.once("error", onError);
    server.listen(LOCAL_CALLBACK_PORT, "127.0.0.1", () => {
      server.off("error", onError);
      callbackListening = true;
      log.info("OAuth callback listening", {
        url: localCallbackUri(),
      });
      resolve();
    });
  });
}

/**
 * Call from MCP process boot. Restores pending login after Cursor restarts stdio.
 */
export async function resumeOAuthCallbackIfNeeded(): Promise<void> {
  const stored = readPendingFile();
  if (!stored) return;
  if (!pending) attachPendingFromStored(stored);
  await ensureCallbackServer();
  log.info("Resumed OAuth callback from disk", { state: stored.state });
}

export async function startOAuthLoginAsync(opts?: {
  open_browser?: boolean;
  timeout_ms?: number;
}): Promise<{
  authorize_url: string;
  redirect_uri: string;
  state: string;
  message: string;
}> {
  // New login replaces old pending (do not close durable server).
  if (pending) {
    pending.rejectDone(new Error("OAuth restarted"));
    clearPendingMemory("restart");
  }

  await ensureCallbackServer();

  const redirect_uri = localCallbackUri();
  const state = randomBytes(16).toString("hex");
  const pkce = newPkce();
  const { url: authorize_url } = await buildNotionMcpAuthorizeUrl({
    redirectUri: redirect_uri,
    state,
    codeChallenge: pkce.challenge,
  });

  let resolveDone!: (t: OAuthTokens) => void;
  let rejectDone!: (e: Error) => void;
  const done = new Promise<OAuthTokens>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  const expires_at = Date.now() + (opts?.timeout_ms ?? 10 * 60 * 1000);
  const stored: StoredPending = {
    state,
    authorize_url,
    redirect_uri,
    code_verifier: pkce.verifier,
    expires_at,
  };
  writePendingFile(stored);

  pending = {
    ...stored,
    done,
    resolveDone,
    rejectDone,
  };

  const timer = setTimeout(() => {
    if (!pending || pending.state !== state) return;
    pending.rejectDone(new Error("OAuth timed out"));
    clearPendingMemory("timeout");
    clearPendingFile();
  }, opts?.timeout_ms ?? 10 * 60 * 1000);
  void done.finally(() => clearTimeout(timer));

  if (opts?.open_browser !== false) {
    openBrowserIfEnabled(authorize_url);
  }

  log.info("OAuth started (mcp.notion.com)", { redirect_uri, state });
  return {
    authorize_url,
    redirect_uri,
    state,
    message:
      "Browser opened for Notion login. Keep Cursor open — after approve you should see “notion-bank connected”.",
  };
}

export async function waitOAuthLogin(timeoutMs?: number): Promise<LoginResult> {
  if (!pending) {
    const stored = readPendingFile();
    if (stored) {
      attachPendingFromStored(stored);
      await ensureCallbackServer();
    }
  }
  if (!pending) {
    throw new Error("No pending OAuth. Call plan_oauth_login first.");
  }
  const p = pending;
  const tokens = await Promise.race([
    p.done,
    new Promise<never>((_, reject) => {
      if (!timeoutMs) return;
      setTimeout(() => reject(new Error("OAuth wait timed out")), timeoutMs);
    }),
  ]);
  return {
    ok: true,
    tokens: summarize(tokens),
    authorize_url: p.authorize_url,
    redirect_uri: p.redirect_uri,
    via: "mcp.notion.com",
  };
}

export async function runOAuthLoginFlow(opts?: {
  timeoutMs?: number;
  open_browser?: boolean;
}): Promise<LoginResult> {
  const started = await startOAuthLoginAsync({
    open_browser: opts?.open_browser,
    timeout_ms: opts?.timeoutMs,
  });
  if (!pending) throw new Error("OAuth session missing after start");
  const tokens = await pending.done;
  return {
    ok: true,
    tokens: summarize(tokens),
    authorize_url: started.authorize_url,
    redirect_uri: started.redirect_uri,
    via: "mcp.notion.com",
  };
}
