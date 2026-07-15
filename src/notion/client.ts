import { Client } from "@notionhq/client";
import type { BlockObjectRequest } from "@notionhq/client/build/src/api-endpoints.js";
import type { NotionBankConfig } from "../config.js";
import { log } from "../logging.js";

/** Notion API version with markdown page endpoints */
export const NOTION_VERSION = "2026-03-11";

export function createNotionClient(config: NotionBankConfig): Client {
  return new Client({
    auth: config.notionToken ?? undefined,
    notionVersion: NOTION_VERSION,
    retry: { maxRetries: 4, initialRetryDelayMs: 1000 },
  });
}

export type ChildPage = {
  id: string;
  title: string;
};

export async function listChildPages(
  notion: Client,
  parentPageId: string,
): Promise<ChildPage[]> {
  const results: ChildPage[] = [];
  let cursor: string | undefined;
  do {
    const page = await notion.blocks.children.list({
      block_id: parentPageId,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const block of page.results) {
      if (!("type" in block)) continue;
      if (block.type === "child_page" && "child_page" in block) {
        results.push({
          id: block.id,
          title: block.child_page.title,
        });
      }
    }
    cursor = page.has_more ? (page.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return results;
}

export async function getPageTitle(
  notion: Client,
  pageId: string,
): Promise<string> {
  const page = await notion.pages.retrieve({ page_id: pageId });
  if (!("properties" in page)) return pageId;
  const props = page.properties;
  for (const value of Object.values(props)) {
    if (value.type === "title") {
      return value.title.map((t) => t.plain_text).join("") || pageId;
    }
  }
  return pageId;
}

export async function retrieveMarkdown(
  notion: Client,
  pageId: string,
): Promise<string> {
  const res = await notion.pages.retrieveMarkdown({ page_id: pageId });
  return res.markdown ?? "";
}

export async function createPageWithMarkdown(
  notion: Client,
  parentPageId: string,
  title: string,
  markdown: string,
): Promise<{ id: string }> {
  // Prefer native markdown create; strip leading H1 matching title to avoid duplicate titles
  const body = stripRedundantTitle(markdown, title);
  const page = await notion.pages.create({
    parent: { page_id: parentPageId },
    properties: {
      title: {
        title: [{ type: "text", text: { content: title.slice(0, 2000) } }],
      },
    },
    markdown: body,
  } as Parameters<Client["pages"]["create"]>[0]);
  return { id: page.id };
}

export async function replacePageMarkdown(
  notion: Client,
  pageId: string,
  markdown: string,
  allowAsync = true,
): Promise<string> {
  const res = await notion.pages.updateMarkdown({
    page_id: pageId,
    type: "replace_content",
    replace_content: {
      new_str: markdown,
      allow_deleting_content: true,
    },
    allow_async: allowAsync,
  });
  return res.markdown ?? markdown;
}

export async function updatePageMarkdownExact(
  notion: Client,
  pageId: string,
  oldStr: string,
  newStr: string,
): Promise<string> {
  const res = await notion.pages.updateMarkdown({
    page_id: pageId,
    type: "update_content",
    update_content: {
      content_updates: [{ old_str: oldStr, new_str: newStr }],
      allow_deleting_content: true,
    },
  });
  return res.markdown ?? "";
}

/**
 * Fallback when markdown write fails: clear children and append chunked blocks.
 * Used only as last resort; prefers Notion markdown API.
 */
export async function replacePageViaBlocks(
  notion: Client,
  pageId: string,
  blocks: BlockObjectRequest[],
): Promise<void> {
  // Delete existing children
  let cursor: string | undefined;
  const toDelete: string[] = [];
  do {
    const page = await notion.blocks.children.list({
      block_id: pageId,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const block of page.results) {
      if ("id" in block) toDelete.push(block.id);
    }
    cursor = page.has_more ? (page.next_cursor ?? undefined) : undefined;
  } while (cursor);

  for (const id of toDelete) {
    try {
      await notion.blocks.delete({ block_id: id });
    } catch (err) {
      log.warn("Failed to delete block", { id, err: String(err) });
    }
  }

  const CHUNK = 100;
  for (let i = 0; i < blocks.length; i += CHUNK) {
    const slice = blocks.slice(i, i + CHUNK);
    await notion.blocks.children.append({
      block_id: pageId,
      children: slice,
    });
  }
}

function stripRedundantTitle(markdown: string, title: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  if (lines.length === 0) return markdown;
  const m = lines[0].match(/^#\s+(.+?)\s*$/);
  if (m && m[1].trim() === title.trim()) {
    return lines.slice(1).join("\n").replace(/^\n+/, "");
  }
  return markdown;
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}
