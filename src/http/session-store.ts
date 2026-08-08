import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { UserWorkspaceConfig } from "../user-config.js";

export type NotionCreds = {
  access_token: string;
  refresh_token: string | null;
  token_type: string;
  bot_id?: string;
  workspace_id?: string;
  workspace_name?: string | null;
};

export type McpTokenRecord = {
  access_token: string;
  refresh_token: string;
  client_id: string;
  scopes: string[];
  /** epoch ms */
  expires_at: number;
  notion: NotionCreds;
  workspace: UserWorkspaceConfig | null;
  created_at: string;
};

export type PendingAuth = {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  state?: string;
  scopes: string[];
  resource?: string;
  /** PKCE verifier for mcp.notion.com token exchange */
  notion_code_verifier?: string;
  /** epoch ms */
  expires_at: number;
};

export type AuthCodeRecord = {
  code: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  scopes: string[];
  resource?: string;
  notion: NotionCreds;
  /** epoch ms */
  expires_at: number;
};

type StoreFile = {
  clients: Record<string, unknown>;
  tokens: Record<string, McpTokenRecord>;
  /** refresh_token → access_token */
  refresh_index: Record<string, string>;
};

function dataDir(): string {
  const override = process.env.NOTION_BANK_DATA_DIR?.trim();
  if (override) return override;
  const xdg = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");
  return join(xdg, "notion-bank", "server");
}

function storePath(): string {
  return join(dataDir(), "sessions.json");
}

function emptyStore(): StoreFile {
  return { clients: {}, tokens: {}, refresh_index: {} };
}

function loadFile(): StoreFile {
  const path = storePath();
  if (!existsSync(path)) return emptyStore();
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<StoreFile>;
    return {
      clients: raw.clients ?? {},
      tokens: raw.tokens ?? {},
      refresh_index: raw.refresh_index ?? {},
    };
  } catch {
    return emptyStore();
  }
}

function saveFile(data: StoreFile): void {
  const path = storePath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
}

/** In-memory pending OAuth (short-lived). */
const pendingAuths = new Map<string, PendingAuth>();
const authCodes = new Map<string, AuthCodeRecord>();

/** Remove expired in-memory OAuth state. Returns counts removed. */
export function pruneInMemoryAuth(now = Date.now()): {
  pending: number;
  codes: number;
} {
  let pending = 0;
  let codes = 0;
  for (const [k, v] of pendingAuths) {
    if (v.expires_at < now) {
      pendingAuths.delete(k);
      pending++;
    }
  }
  for (const [k, v] of authCodes) {
    if (v.expires_at < now) {
      authCodes.delete(k);
      codes++;
    }
  }
  return { pending, codes };
}

/** Drop expired access tokens from a store object. Returns whether anything changed. */
export function purgeExpiredTokens(data: StoreFile, now = Date.now()): boolean {
  let changed = false;
  for (const [access, rec] of Object.entries(data.tokens)) {
    if (rec.expires_at >= now) continue;
    delete data.tokens[access];
    delete data.refresh_index[rec.refresh_token];
    changed = true;
  }
  return changed;
}

function loadAndPurge(): StoreFile {
  pruneInMemoryAuth();
  const data = loadFile();
  if (purgeExpiredTokens(data)) saveFile(data);
  return data;
}

export function putPendingAuth(id: string, pending: PendingAuth): void {
  pruneInMemoryAuth();
  pendingAuths.set(id, pending);
}

export function takePendingAuth(id: string): PendingAuth | null {
  pruneInMemoryAuth();
  const p = pendingAuths.get(id);
  if (!p) return null;
  pendingAuths.delete(id);
  if (p.expires_at < Date.now()) return null;
  return p;
}

export function putAuthCode(record: AuthCodeRecord): void {
  pruneInMemoryAuth();
  authCodes.set(record.code, record);
}

export function peekAuthCode(code: string): AuthCodeRecord | null {
  pruneInMemoryAuth();
  const r = authCodes.get(code);
  if (!r) return null;
  if (r.expires_at < Date.now()) {
    authCodes.delete(code);
    return null;
  }
  return r;
}

export function takeAuthCode(code: string): AuthCodeRecord | null {
  const r = peekAuthCode(code);
  if (!r) return null;
  authCodes.delete(code);
  return r;
}

/** Test helper — in-memory map sizes after prune. */
export function inMemoryAuthSizes(): { pending: number; codes: number } {
  pruneInMemoryAuth();
  return { pending: pendingAuths.size, codes: authCodes.size };
}

export function saveToken(record: McpTokenRecord): void {
  const data = loadAndPurge();
  data.tokens[record.access_token] = record;
  data.refresh_index[record.refresh_token] = record.access_token;
  saveFile(data);
}

export function getToken(accessToken: string): McpTokenRecord | null {
  const data = loadAndPurge();
  return data.tokens[accessToken] ?? null;
}

export function getTokenByRefresh(refreshToken: string): McpTokenRecord | null {
  const data = loadAndPurge();
  const access = data.refresh_index[refreshToken];
  if (!access) return null;
  return data.tokens[access] ?? null;
}

export function updateTokenWorkspace(accessToken: string, workspace: UserWorkspaceConfig): void {
  const data = loadAndPurge();
  const rec = data.tokens[accessToken];
  if (!rec) throw new Error("Session not found for update");
  rec.workspace = workspace;
  data.tokens[accessToken] = rec;
  saveFile(data);
}

export function revokeAccessToken(accessToken: string): void {
  const data = loadAndPurge();
  const rec = data.tokens[accessToken];
  if (!rec) return;
  delete data.tokens[accessToken];
  delete data.refresh_index[rec.refresh_token];
  saveFile(data);
}

export function getClientsMap(): Record<string, unknown> {
  return loadAndPurge().clients;
}

export function saveClient(clientId: string, client: unknown): void {
  const data = loadAndPurge();
  data.clients[clientId] = client;
  saveFile(data);
}

export function getDataDir(): string {
  return dataDir();
}
