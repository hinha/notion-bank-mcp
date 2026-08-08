import { randomBytes } from "node:crypto";
import { log } from "../logging.js";
import { refreshNotionMcpToken } from "../notion/mcp-upstream.js";
import { clearOAuthTokens, loadOAuthTokens, type OAuthTokens, saveOAuthTokens } from "./tokens.js";

const LOCAL_CALLBACK_PORT = Number(process.env.NOTION_BANK_LOCAL_CALLBACK_PORT || 8765);

/** Refresh this many ms before expires_at. */
const REFRESH_SKEW_MS = 5 * 60 * 1000;

/**
 * If credentials.json has no expires_at (older saves), assume Notion MCP's
 * typical ~8h access TTL from obtained_at so we refresh before rejection.
 */
const FALLBACK_ACCESS_TTL_MS = 7.5 * 60 * 60 * 1000;

/** @deprecated Public Integration path removed — kept for type imports only. */
export type OAuthAppConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authorizeUrl: string;
  tokenUrl: string;
};

export function loadOAuthAppConfig(): OAuthAppConfig | null {
  return null;
}

export function oauthAppReady(): boolean {
  return true;
}

export function buildAuthorizeUrl(_app: OAuthAppConfig, _state: string): string {
  throw new Error("Use mcp.notion.com OAuth via plan_oauth_login");
}

export function newOAuthState(): string {
  return randomBytes(16).toString("hex");
}

export async function exchangeAuthorizationCode(): Promise<OAuthTokens> {
  throw new Error("Use plan_oauth_login (mcp.notion.com)");
}

export async function refreshAccessToken(): Promise<OAuthTokens> {
  throw new Error("Use tryRefreshOAuth");
}

export async function ensureAccessToken(
  envToken: string | null,
): Promise<{ token: string; source: "oauth" | "env" }> {
  const existing = loadOAuthTokens();
  if (existing?.access_token) {
    return { token: existing.access_token, source: "oauth" };
  }
  if (envToken) {
    return { token: envToken, source: "env" };
  }
  throw new Error("No Notion credentials. Call plan_oauth_login (browser opens automatically).");
}

export function isInvalidAuthError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("invalid auth token") ||
    msg.includes("invalid_token") ||
    msg.includes("unauthorized") ||
    msg.includes("authentication required") ||
    msg.includes("not authenticated") ||
    /\b401\b/.test(msg) ||
    (msg.includes("expired") && msg.includes("token"))
  );
}

function accessTokenExpiresAt(tokens: OAuthTokens): number | null {
  if (typeof tokens.expires_at === "number" && Number.isFinite(tokens.expires_at)) {
    return tokens.expires_at;
  }
  const obtained = Date.parse(tokens.obtained_at);
  if (!Number.isFinite(obtained)) return null;
  return obtained + FALLBACK_ACCESS_TTL_MS;
}

/** True when access token is missing expiry info or within skew of expiry. */
export function accessTokenNeedsRefresh(tokens: OAuthTokens | null): boolean {
  if (!tokens?.access_token || !tokens.refresh_token) return false;
  const expiresAt = accessTokenExpiresAt(tokens);
  if (expiresAt === null) return false;
  return Date.now() >= expiresAt - REFRESH_SKEW_MS;
}

export async function tryRefreshOAuth(): Promise<OAuthTokens | null> {
  const tokens = loadOAuthTokens();
  if (!tokens?.refresh_token) return null;
  try {
    const next = await refreshNotionMcpToken({
      redirectUri: `http://127.0.0.1:${LOCAL_CALLBACK_PORT}/callback`,
      refreshToken: tokens.refresh_token,
    });
    log.info("Refreshed Notion MCP OAuth token", {
      expires_in: next.expires_in ?? null,
    });
    return saveOAuthTokens({
      access_token: next.access_token,
      refresh_token: next.refresh_token,
      token_type: next.token_type,
      workspace_name: tokens.workspace_name,
      bot_id: tokens.bot_id,
      workspace_id: tokens.workspace_id,
      expires_in: next.expires_in,
    });
  } catch (err) {
    log.warn("Notion MCP token refresh failed", { err: String(err) });
    return null;
  }
}

/**
 * Refresh when access token is near/past expiry. No-op if still fresh.
 * Returns the new tokens when a refresh ran; otherwise null.
 */
export async function ensureFreshOAuthToken(): Promise<OAuthTokens | null> {
  const tokens = loadOAuthTokens();
  if (!accessTokenNeedsRefresh(tokens)) return null;
  log.info("Access token near expiry; refreshing");
  return tryRefreshOAuth();
}

export function logoutOAuth(): boolean {
  return clearOAuthTokens();
}
