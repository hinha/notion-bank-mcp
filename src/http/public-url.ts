/**
 * Public base URL of this hosted MCP (like https://mcp.notion.com).
 *
 * Resolution:
 * 1. NOTION_BANK_PUBLIC_URL
 * 2. BAKED_MCP_PUBLIC_URL (set before publishing the hosted build)
 * 3. http://127.0.0.1:${PORT}
 */
export const BAKED_MCP_PUBLIC_URL = "";

export function getListenPort(): number {
  return Number(process.env.NOTION_BANK_PORT || process.env.PORT || 3737);
}

export function getPublicBaseUrl(): string {
  const fromEnv = process.env.NOTION_BANK_PUBLIC_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const baked = BAKED_MCP_PUBLIC_URL.trim();
  if (baked) return baked.replace(/\/$/, "");
  return `http://127.0.0.1:${getListenPort()}`;
}

export function getMcpUrl(): string {
  return `${getPublicBaseUrl()}/mcp`;
}
