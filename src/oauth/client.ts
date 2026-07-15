import { randomBytes } from "node:crypto";
import {
  clearOAuthTokens,
  loadOAuthTokens,
  saveOAuthTokens,
  type OAuthTokens,
} from "./tokens.js";
import {
  refreshNotionMcpToken,
} from "../notion/mcp-upstream.js";
import { log } from "../logging.js";

const LOCAL_CALLBACK_PORT = Number(
  process.env.NOTION_BANK_LOCAL_CALLBACK_PORT || 8765,
);

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

export function buildAuthorizeUrl(
  _app: OAuthAppConfig,
  _state: string,
): string {
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
  throw new Error(
    "No Notion credentials. Call plan_oauth_login (browser opens automatically).",
  );
}

export async function tryRefreshOAuth(): Promise<OAuthTokens | null> {
  const tokens = loadOAuthTokens();
  if (!tokens?.refresh_token) return null;
  try {
    const next = await refreshNotionMcpToken({
      redirectUri: `http://127.0.0.1:${LOCAL_CALLBACK_PORT}/callback`,
      refreshToken: tokens.refresh_token,
    });
    log.info("Refreshed Notion MCP OAuth token");
    return saveOAuthTokens({
      access_token: next.access_token,
      refresh_token: next.refresh_token,
      token_type: next.token_type,
      workspace_name: tokens.workspace_name,
      bot_id: tokens.bot_id,
      workspace_id: tokens.workspace_id,
    });
  } catch (err) {
    log.warn("Notion MCP token refresh failed", { err: String(err) });
    return null;
  }
}

export function logoutOAuth(): boolean {
  return clearOAuthTokens();
}
