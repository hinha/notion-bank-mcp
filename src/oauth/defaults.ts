/**
 * Optional legacy broker base URL (operator experiments only).
 * Default end-user auth uses mcp.notion.com DCR via src/oauth/login.ts — leave empty.
 *
 * Override (operator/dev only): NOTION_BANK_OAUTH_BROKER_URL
 */
export const BAKED_OAUTH_BROKER_URL = "";

export function getOAuthBrokerUrl(): string | null {
  const fromEnv = process.env.NOTION_BANK_OAUTH_BROKER_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const baked = BAKED_OAUTH_BROKER_URL.trim();
  if (baked) return baked.replace(/\/$/, "");
  return null;
}

export function brokerConfigured(): boolean {
  return getOAuthBrokerUrl() !== null;
}
