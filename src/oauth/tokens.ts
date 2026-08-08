import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { configPath } from "../user-config.js";

export type OAuthTokens = {
  access_token: string;
  refresh_token: string | null;
  token_type: string;
  bot_id?: string;
  workspace_id?: string;
  workspace_name?: string | null;
  /** ISO time when tokens were saved / last refreshed */
  obtained_at: string;
  /** epoch ms when access_token expires (from expires_in); optional for older files */
  expires_at?: number | null;
};

function credentialsPath(): string {
  const override = process.env.NOTION_BANK_CREDENTIALS_PATH?.trim();
  if (override) return override;
  // Sibling of config.json
  return join(dirname(configPath()), "credentials.json");
}

export function getCredentialsPath(): string {
  return credentialsPath();
}

export function loadOAuthTokens(): OAuthTokens | null {
  const path = credentialsPath();
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<OAuthTokens>;
    if (!raw.access_token) return null;
    return {
      access_token: raw.access_token,
      refresh_token: raw.refresh_token ?? null,
      token_type: raw.token_type ?? "bearer",
      bot_id: raw.bot_id,
      workspace_id: raw.workspace_id,
      workspace_name: raw.workspace_name ?? null,
      obtained_at: raw.obtained_at ?? new Date().toISOString(),
      expires_at:
        typeof raw.expires_at === "number" && Number.isFinite(raw.expires_at)
          ? raw.expires_at
          : null,
    };
  } catch {
    return null;
  }
}

export function expiresAtFromExpiresIn(expiresInSec?: number): number | null {
  if (typeof expiresInSec !== "number" || !Number.isFinite(expiresInSec)) {
    return null;
  }
  return Date.now() + Math.max(0, expiresInSec) * 1000;
}

export function saveOAuthTokens(
  tokens: Omit<OAuthTokens, "obtained_at"> & {
    obtained_at?: string;
    expires_in?: number;
  },
): OAuthTokens {
  const path = credentialsPath();
  mkdirSync(dirname(path), { recursive: true });
  const expires_at =
    tokens.expires_at !== undefined ? tokens.expires_at : expiresAtFromExpiresIn(tokens.expires_in);
  const saved: OAuthTokens = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? null,
    token_type: tokens.token_type ?? "bearer",
    bot_id: tokens.bot_id,
    workspace_id: tokens.workspace_id,
    workspace_name: tokens.workspace_name ?? null,
    obtained_at: tokens.obtained_at ?? new Date().toISOString(),
    expires_at,
  };
  writeFileSync(path, `${JSON.stringify(saved, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // best-effort on platforms without chmod
  }
  return saved;
}

export function clearOAuthTokens(): boolean {
  const path = credentialsPath();
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

export function oauthConfigured(): boolean {
  return loadOAuthTokens() !== null;
}

/** Prefer OAuth access token; fall back to internal integration env token. */
export function resolveAccessToken(envToken: string | null): {
  token: string | null;
  source: "oauth" | "env" | "none";
  oauth: OAuthTokens | null;
} {
  const oauth = loadOAuthTokens();
  if (oauth?.access_token) {
    return { token: oauth.access_token, source: "oauth", oauth };
  }
  if (envToken) {
    return { token: envToken, source: "env", oauth: null };
  }
  return { token: null, source: "none", oauth: null };
}
