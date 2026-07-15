/**
 * Talk to Notion's hosted MCP (https://mcp.notion.com) — same auth surface as the
 * official Notion Cursor plugin. Uses Dynamic Client Registration; NO CLIENT_ID/SECRET.
 */
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getDataDir } from "../http/session-store.js";
import { log } from "../logging.js";

export const NOTION_MCP_URL = "https://mcp.notion.com/mcp";
export const NOTION_MCP_ISSUER = "https://mcp.notion.com";

type OAuthServerMeta = {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
};

type RegisteredClient = {
  client_id: string;
  client_secret?: string;
  redirect_uri: string;
  token_endpoint_auth_method: string;
};

let cachedMeta: OAuthServerMeta | null = null;

function clientStorePath(): string {
  return join(getDataDir(), "notion-mcp-dcr-client.json");
}

export async function discoverNotionMcpOAuth(): Promise<OAuthServerMeta> {
  if (cachedMeta) return cachedMeta;
  const res = await fetch(
    `${NOTION_MCP_ISSUER}/.well-known/oauth-authorization-server`,
  );
  if (!res.ok) {
    throw new Error(
      `Failed to discover Notion MCP OAuth metadata: ${res.status}`,
    );
  }
  cachedMeta = (await res.json()) as OAuthServerMeta;
  return cachedMeta;
}

function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function newPkce(): { verifier: string; challenge: string } {
  return pkce();
}

/** Ensure a DCR client exists for our redirect URI (public client, no secret). */
export async function ensureNotionMcpDcrClient(
  redirectUri: string,
): Promise<RegisteredClient> {
  const path = clientStorePath();
  if (existsSync(path)) {
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as RegisteredClient;
      if (raw.client_id && raw.redirect_uri === redirectUri) return raw;
    } catch {
      /* re-register */
    }
  }

  const meta = await discoverNotionMcpOAuth();
  if (!meta.registration_endpoint) {
    throw new Error("Notion MCP does not advertise registration_endpoint");
  }

  const res = await fetch(meta.registration_endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_name: "notion-bank-mcp",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Notion MCP DCR failed ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = JSON.parse(text) as {
    client_id: string;
    client_secret?: string;
  };
  const saved: RegisteredClient = {
    client_id: json.client_id,
    client_secret: json.client_secret,
    redirect_uri: redirectUri,
    token_endpoint_auth_method: "none",
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(saved, null, 2), { mode: 0o600 });
  log.info("Registered DCR client with mcp.notion.com", {
    client_id: saved.client_id,
  });
  return saved;
}

export async function buildNotionMcpAuthorizeUrl(args: {
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): Promise<{ url: string; clientId: string }> {
  const meta = await discoverNotionMcpOAuth();
  const client = await ensureNotionMcpDcrClient(args.redirectUri);
  const u = new URL(meta.authorization_endpoint);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", client.client_id);
  u.searchParams.set("redirect_uri", args.redirectUri);
  u.searchParams.set("state", args.state);
  u.searchParams.set("code_challenge", args.codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("resource", NOTION_MCP_URL);
  return { url: u.toString(), clientId: client.client_id };
}

export type NotionMcpTokens = {
  access_token: string;
  refresh_token: string | null;
  token_type: string;
  expires_in?: number;
};

export async function exchangeNotionMcpCode(args: {
  redirectUri: string;
  code: string;
  codeVerifier: string;
}): Promise<NotionMcpTokens> {
  const meta = await discoverNotionMcpOAuth();
  const client = await ensureNotionMcpDcrClient(args.redirectUri);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: args.code,
    redirect_uri: args.redirectUri,
    client_id: client.client_id,
    code_verifier: args.codeVerifier,
    resource: NOTION_MCP_URL,
  });
  const res = await fetch(meta.token_endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `Notion MCP token exchange failed ${res.status}: ${text.slice(0, 300)}`,
    );
  }
  const json = JSON.parse(text) as {
    access_token: string;
    refresh_token?: string;
    token_type?: string;
    expires_in?: number;
  };
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token ?? null,
    token_type: json.token_type || "bearer",
    expires_in: json.expires_in,
  };
}

export async function refreshNotionMcpToken(args: {
  redirectUri: string;
  refreshToken: string;
}): Promise<NotionMcpTokens> {
  const meta = await discoverNotionMcpOAuth();
  const client = await ensureNotionMcpDcrClient(args.redirectUri);
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: args.refreshToken,
    client_id: client.client_id,
    resource: NOTION_MCP_URL,
  });
  const res = await fetch(meta.token_endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `Notion MCP refresh failed ${res.status}: ${text.slice(0, 300)}`,
    );
  }
  const json = JSON.parse(text) as {
    access_token: string;
    refresh_token?: string;
    token_type?: string;
    expires_in?: number;
  };
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token ?? args.refreshToken,
    token_type: json.token_type || "bearer",
    expires_in: json.expires_in,
  };
}

function toolText(result: {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}): string {
  const parts = (result.content ?? [])
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text!);
  const text = parts.join("\n");
  if (result.isError) throw new Error(text || "Notion MCP tool error");
  return text;
}

/** Thin client: call Notion hosted MCP tools with a user access token. */
export class NotionMcpBridge {
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;

  constructor(private accessToken: string) {}

  private async connect(): Promise<Client> {
    if (this.client) return this.client;
    const transport = new StreamableHTTPClientTransport(
      new URL(NOTION_MCP_URL),
      {
        requestInit: {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
          },
        },
      },
    );
    const client = new Client({
      name: "notion-bank-mcp",
      version: "1.4.0",
    });
    await client.connect(transport);
    this.transport = transport;
    this.client = client;
    return client;
  }

  async close(): Promise<void> {
    try {
      await this.transport?.close();
    } catch {
      /* ignore */
    }
    this.client = null;
    this.transport = null;
  }

  private async call(
    names: string[],
    args: Record<string, unknown>,
  ): Promise<string> {
    const client = await this.connect();
    let lastErr: Error | null = null;
    for (const name of names) {
      try {
        const result = await client.callTool({ name, arguments: args });
        return toolText(
          result as {
            content?: Array<{ type: string; text?: string }>;
            isError?: boolean;
          },
        );
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        const msg = lastErr.message.toLowerCase();
        if (
          msg.includes("unknown tool") ||
          msg.includes("not found") ||
          msg.includes("tool not")
        ) {
          continue;
        }
        throw lastErr;
      }
    }
    throw lastErr ?? new Error(`No matching Notion MCP tool: ${names.join(",")}`);
  }

  async fetch(id: string): Promise<string> {
    return this.call(["notion-fetch", "fetch"], { id });
  }

  async search(query: string, pageUrl?: string): Promise<string> {
    return this.call(["notion-search", "search"], {
      query,
      query_type: "internal",
      ...(pageUrl ? { page_url: pageUrl } : {}),
      page_size: 25,
    });
  }

  async createPage(args: {
    parentPageId: string;
    title: string;
    content: string;
  }): Promise<string> {
    return this.call(["notion-create-pages", "create-pages"], {
      parent: { page_id: args.parentPageId, type: "page_id" },
      pages: [
        {
          properties: { title: args.title },
          content: args.content,
        },
      ],
    });
  }

  async replaceContent(pageId: string, markdown: string): Promise<string> {
    return this.call(["notion-update-page", "update-page"], {
      page_id: pageId,
      command: "replace_content",
      new_str: markdown,
      allow_deleting_content: true,
    });
  }

  async updateContent(
    pageId: string,
    oldStr: string,
    newStr: string,
  ): Promise<string> {
    return this.call(["notion-update-page", "update-page"], {
      page_id: pageId,
      command: "update_content",
      content_updates: [{ old_str: oldStr, new_str: newStr }],
      allow_deleting_content: true,
    });
  }
}
