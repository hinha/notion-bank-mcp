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
  const unwrapped = unwrapFetchPayload(fetchText);
  if (unwrapped.jsonTitle) return unwrapped.jsonTitle;

  const titleTag = unwrapped.body.match(/<page[^>]*title="([^"]+)"/i);
  if (titleTag?.[1]) return titleTag[1];

  const props = unwrapped.body.match(
    /<properties>\s*\{[^}]*"title"\s*:\s*"([^"]+)"/i,
  );
  if (props?.[1]) return props[1];

  const h1 = unwrapped.body.match(/^#\s+(.+)$/m);
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

type UnwrappedFetch = {
  body: string;
  jsonTitle: string | null;
};

/**
 * Notion MCP `fetch` often returns a JSON envelope:
 * `{ metadata, title, url, text: "…<page>…<content>markdown</content></page>" }`
 */
function unwrapFetchPayload(fetchText: string): UnwrappedFetch {
  const trimmed = fetchText.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as {
        title?: unknown;
        text?: unknown;
        markdown?: unknown;
      };
      const jsonTitle =
        typeof parsed.title === "string" && parsed.title.trim()
          ? parsed.title.trim()
          : null;
      const inner =
        typeof parsed.text === "string"
          ? parsed.text
          : typeof parsed.markdown === "string"
            ? parsed.markdown
            : null;
      if (inner != null) {
        return { body: inner, jsonTitle };
      }
    } catch {
      /* not JSON — treat as raw text */
    }
  }
  return { body: fetchText, jsonTitle: null };
}

function extractContentTag(body: string): string | null {
  const match = body.match(/<content>([\s\S]*?)<\/content>/i);
  if (!match) return null;
  return match[1].replace(/^\n+/, "").replace(/\n+$/, "") + "\n";
}

function extractFromFirstHeading(body: string): string | null {
  const match = body.match(/(^|\n)(#\s+[^\n]+[\s\S]*)$/);
  if (!match) return null;
  return match[2].replace(/^\n+/, "").replace(/\n+$/, "") + "\n";
}

/**
 * Markdown body for addressing — strip Notion MCP fetch chrome
 * (JSON envelope, view preface, <page>/<content> wrappers).
 */
export function markdownFromFetch(fetchText: string): string {
  const { body } = unwrapFetchPayload(fetchText);

  const fromContent = extractContentTag(body);
  if (fromContent) return fromContent;

  // Close dangling content if Notion truncates the closing tag
  const openContent = body.match(/<content>([\s\S]*)$/i);
  if (openContent && !body.includes("</content>")) {
    let md = openContent[1];
    md = md.replace(/<\/page>\s*$/i, "");
    return md.replace(/^\n+/, "").replace(/\n+$/, "") + "\n";
  }

  const fromHeading = extractFromFirstHeading(body);
  if (fromHeading) return fromHeading;

  // Already plain markdown (or unknown shape)
  if (body.trimStart().startsWith("#")) {
    return body.replace(/^\n+/, "").replace(/\n+$/, "") + "\n";
  }

  return body;
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
