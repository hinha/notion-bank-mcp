import { NotionMcpBridge } from "./mcp-upstream.js";

export type ChildPage = {
  id: string;
  title: string;
};

function extractUuid(raw: string): string | null {
  const dashed = raw.match(
    /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/,
  );
  if (dashed) return dashed[0].toLowerCase();
  const hex = raw.match(/[0-9a-fA-F]{32}/);
  if (!hex) return null;
  const h = hex[0].toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Pull child page refs from Notion enhanced-markdown / search XML-ish output. */
export function parseChildPages(text: string): ChildPage[] {
  const out: ChildPage[] = [];
  const seen = new Set<string>();

  const tagRe =
    /<(page|page-link)[^>]*url="([^"]+)"[^>]*(?:title|name)="([^"]*)"[^>]*>|<(page|page-link)[^>]*(?:title|name)="([^"]*)"[^>]*url="([^"]+)"[^>]*>/gi;
  for (const m of text.matchAll(tagRe)) {
    const url = m[2] || m[6];
    const title = (m[3] || m[5] || "").trim();
    const id = extractUuid(url || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, title: title || id });
  }

  // Fallback: markdown links [Title](https://www.notion.so/...id)
  const mdRe = /\[([^\]]+)\]\((https?:\/\/[^)]*notion[^)]+)\)/gi;
  for (const m of text.matchAll(mdRe)) {
    const id = extractUuid(m[2]);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, title: m[1].trim() || id });
  }

  return out;
}

export function parsePageTitle(fetchText: string, fallback: string): string {
  const titleTag = fetchText.match(/<page[^>]*title="([^"]+)"/i);
  if (titleTag?.[1]) return titleTag[1];
  const h1 = fetchText.match(/^#\s+(.+)$/m);
  if (h1?.[1]) return h1[1].trim();
  const jsonName = fetchText.match(/"title"\s*:\s*"([^"]+)"/);
  if (jsonName?.[1]) return jsonName[1];
  return fallback;
}

export function parseCreatedPageId(createResult: string): string {
  const id = extractUuid(createResult);
  if (!id) {
    throw new Error(
      `Could not parse created page id from Notion MCP response: ${createResult.slice(0, 200)}`,
    );
  }
  return id;
}

export function stripRedundantTitle(markdown: string, title: string): string {
  const lines = markdown.split("\n");
  if (lines[0]?.startsWith("# ")) {
    const h = lines[0].replace(/^#\s+/, "").trim();
    if (h.toLowerCase() === title.toLowerCase()) {
      return lines.slice(1).join("\n").replace(/^\n+/, "");
    }
  }
  return markdown;
}

/** Markdown body for addressing — strip wrapper chrome from fetch if present. */
export function markdownFromFetch(fetchText: string): string {
  // Prefer fenced content / page body; otherwise return as-is
  const marker = fetchText.indexOf("\n# ");
  if (marker > 0 && marker < 500) {
    return fetchText.slice(marker + 1);
  }
  return fetchText;
}

export async function listChildPages(
  bridge: NotionMcpBridge,
  parentPageId: string,
): Promise<ChildPage[]> {
  // Search scoped under parent surfaces child pages more reliably than fetch alone
  const searched = await bridge.search("*", parentPageId);
  const fromSearch = parseChildPages(searched).filter((p) => p.id !== parentPageId);
  if (fromSearch.length) return fromSearch;

  const fetched = await bridge.fetch(parentPageId);
  return parseChildPages(fetched).filter((p) => p.id !== parentPageId);
}

export async function getPageTitle(
  bridge: NotionMcpBridge,
  pageId: string,
): Promise<string> {
  const text = await bridge.fetch(pageId);
  return parsePageTitle(text, pageId);
}

export async function retrieveMarkdown(
  bridge: NotionMcpBridge,
  pageId: string,
): Promise<string> {
  const text = await bridge.fetch(pageId);
  return markdownFromFetch(text);
}

export async function createPageWithMarkdown(
  bridge: NotionMcpBridge,
  parentPageId: string,
  title: string,
  markdown: string,
): Promise<{ id: string }> {
  const body = stripRedundantTitle(markdown, title);
  const result = await bridge.createPage({
    parentPageId,
    title,
    content: body,
  });
  return { id: parseCreatedPageId(result) };
}

export async function replacePageMarkdown(
  bridge: NotionMcpBridge,
  pageId: string,
  markdown: string,
): Promise<string> {
  await bridge.replaceContent(pageId, markdown);
  return markdown;
}

export async function updatePageMarkdownExact(
  bridge: NotionMcpBridge,
  pageId: string,
  oldStr: string,
  newStr: string,
): Promise<string> {
  await bridge.updateContent(pageId, oldStr, newStr);
  return newStr;
}
