import { randomBytes, randomUUID } from "node:crypto";
import type { Response } from "express";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { InvalidRequestError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import {
  getToken,
  getTokenByRefresh,
  putAuthCode,
  putPendingAuth,
  saveClient,
  saveToken,
  peekAuthCode,
  takeAuthCode,
  takePendingAuth,
  getClientsMap,
  type NotionCreds,
} from "./session-store.js";
import { getPublicBaseUrl } from "./public-url.js";
import {
  buildNotionMcpAuthorizeUrl,
  exchangeNotionMcpCode,
  newPkce,
  NotionMcpBridge,
} from "../notion/mcp-upstream.js";
import { log } from "../logging.js";

const ACCESS_TTL_MS = 60 * 60 * 1000;
const CODE_TTL_MS = 10 * 60 * 1000;
const PENDING_TTL_MS = 15 * 60 * 1000;

export function notionCallbackUri(): string {
  return `${getPublicBaseUrl()}/notion/callback`;
}

class PersistentClientsStore implements OAuthRegisteredClientsStore {
  async getClient(
    clientId: string,
  ): Promise<OAuthClientInformationFull | undefined> {
    const clients = getClientsMap();
    return clients[clientId] as OAuthClientInformationFull | undefined;
  }

  async registerClient(
    clientMetadata: Omit<
      OAuthClientInformationFull,
      "client_id" | "client_id_issued_at"
    >,
  ): Promise<OAuthClientInformationFull> {
    const incoming = clientMetadata as OAuthClientInformationFull;
    const full: OAuthClientInformationFull = {
      ...incoming,
      client_id: incoming.client_id || randomUUID(),
      client_id_issued_at:
        incoming.client_id_issued_at ?? Math.floor(Date.now() / 1000),
    };
    saveClient(full.client_id, full);
    return full;
  }
}

/**
 * MCP AS for Cursor ↔ Notion hosted MCP.
 * Zero CLIENT_ID/SECRET: uses mcp.notion.com Dynamic Client Registration.
 */
export class NotionBankOAuthProvider implements OAuthServerProvider {
  clientsStore = new PersistentClientsStore();

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    if (!client.redirect_uris.includes(params.redirectUri)) {
      throw new InvalidRequestError("Unregistered redirect_uri");
    }

    const pendingId = randomBytes(16).toString("hex");
    const pkce = newPkce();
    putPendingAuth(pendingId, {
      client_id: client.client_id,
      redirect_uri: params.redirectUri,
      code_challenge: params.codeChallenge,
      state: params.state,
      scopes: params.scopes ?? [],
      resource: params.resource?.toString(),
      expires_at: Date.now() + PENDING_TTL_MS,
      notion_code_verifier: pkce.verifier,
    });

    try {
      const { url } = await buildNotionMcpAuthorizeUrl({
        redirectUri: notionCallbackUri(),
        state: pendingId,
        codeChallenge: pkce.challenge,
      });
      log.info("OAuth authorize → mcp.notion.com", { pendingId });
      res.redirect(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res
        .status(503)
        .type("html")
        .send(`<h1>Could not start Notion login</h1><p>${message}</p>`);
    }
  }

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const rec = peekAuthCode(authorizationCode);
    if (!rec) throw new Error("Invalid authorization code");
    return rec.code_challenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<OAuthTokens> {
    const rec = takeAuthCode(authorizationCode);
    if (!rec) throw new Error("Invalid authorization code");
    if (rec.client_id !== client.client_id) {
      throw new Error("Authorization code was not issued to this client");
    }

    const access_token = randomBytes(32).toString("hex");
    const refresh_token = randomBytes(32).toString("hex");
    const expires_at = Date.now() + ACCESS_TTL_MS;
    saveToken({
      access_token,
      refresh_token,
      client_id: client.client_id,
      scopes: rec.scopes,
      expires_at,
      notion: rec.notion,
      workspace: null,
      created_at: new Date().toISOString(),
    });

    return {
      access_token,
      token_type: "bearer",
      expires_in: Math.floor(ACCESS_TTL_MS / 1000),
      refresh_token,
      scope: rec.scopes.join(" "),
    };
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
  ): Promise<OAuthTokens> {
    const old = getTokenByRefresh(refreshToken);
    if (!old || old.client_id !== client.client_id) {
      throw new Error("Invalid refresh token");
    }
    const access_token = randomBytes(32).toString("hex");
    const refresh_token = randomBytes(32).toString("hex");
    const expires_at = Date.now() + ACCESS_TTL_MS;
    const nextScopes = scopes?.length ? scopes : old.scopes;
    saveToken({
      ...old,
      access_token,
      refresh_token,
      scopes: nextScopes,
      expires_at,
    });
    return {
      access_token,
      token_type: "bearer",
      expires_in: Math.floor(ACCESS_TTL_MS / 1000),
      refresh_token,
      scope: nextScopes.join(" "),
    };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const rec = getToken(token);
    if (!rec) throw new Error("Invalid or expired token");
    return {
      token,
      clientId: rec.client_id,
      scopes: rec.scopes,
      expiresAt: Math.floor(rec.expires_at / 1000),
    };
  }
}

async function workspaceNameFromToken(accessToken: string): Promise<string | null> {
  try {
    const bridge = new NotionMcpBridge(accessToken);
    const self = await bridge.fetch("self");
    await bridge.close();
    const m = self.match(/"name"\s*:\s*"([^"]+)"/) || self.match(/workspace[^"]*"([^"]+)"/i);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Handle mcp.notion.com → /notion/callback, then redirect to Cursor. */
export async function handleNotionCallback(
  provider: NotionBankOAuthProvider,
  query: { code?: string; state?: string; error?: string },
  res: Response,
): Promise<void> {
  if (query.error) {
    res
      .status(400)
      .type("html")
      .send(`<h1>Notion auth denied</h1><p>${query.error}</p>`);
    return;
  }
  if (!query.code || !query.state) {
    res.status(400).type("html").send("<h1>Missing code/state</h1>");
    return;
  }

  const pending = takePendingAuth(query.state);
  if (!pending?.notion_code_verifier) {
    res
      .status(400)
      .type("html")
      .send("<h1>Expired or invalid login session</h1><p>Retry Connect in Cursor.</p>");
    return;
  }

  const client = await provider.clientsStore.getClient(pending.client_id);
  if (!client) {
    res.status(400).type("html").send("<h1>Unknown OAuth client</h1>");
    return;
  }

  try {
    const tokens = await exchangeNotionMcpCode({
      redirectUri: notionCallbackUri(),
      code: query.code,
      codeVerifier: pending.notion_code_verifier,
    });
    const workspace_name = await workspaceNameFromToken(tokens.access_token);
    const notion: NotionCreds = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type: tokens.token_type,
      workspace_name,
    };

    const code = randomBytes(24).toString("hex");
    putAuthCode({
      code,
      client_id: pending.client_id,
      redirect_uri: pending.redirect_uri,
      code_challenge: pending.code_challenge,
      scopes: pending.scopes,
      resource: pending.resource,
      notion,
      expires_at: Date.now() + CODE_TTL_MS,
    });

    const target = new URL(pending.redirect_uri);
    target.searchParams.set("code", code);
    if (pending.state) target.searchParams.set("state", pending.state);
    log.info("mcp.notion.com OAuth ok → redirecting to MCP client");
    res.redirect(target.toString());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("Notion MCP callback failed", { message });
    res
      .status(500)
      .type("html")
      .send(`<h1>Notion login failed</h1><p>${message}</p>`);
  }
}
