import type { BlockObjectRequest } from "@notionhq/client/build/src/api-endpoints.js";

const RICH_TEXT_LIMIT = 2000;
const BLOCKS_PER_REQUEST = 100;

/** Split plain text into Notion rich_text chunks (max 2000 chars each). */
export function toRichText(content: string): Array<{
  type: "text";
  text: { content: string };
}> {
  if (!content) {
    return [{ type: "text", text: { content: "" } }];
  }
  const parts: Array<{ type: "text"; text: { content: string } }> = [];
  for (let i = 0; i < content.length; i += RICH_TEXT_LIMIT) {
    parts.push({
      type: "text",
      text: { content: content.slice(i, i + RICH_TEXT_LIMIT) },
    });
  }
  return parts;
}

/**
 * Convert common Markdown into Notion block objects.
 * Handles headings, paragraphs, lists, code fences, quotes, dividers.
 * Chunking into ≤100 blocks is caller's responsibility via `chunkBlocks`.
 */
export function markdownToBlocks(markdown: string): BlockObjectRequest[] {
  const lines = markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const blocks: BlockObjectRequest[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code fence
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim() || "plain text";
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        body.push(lines[i]);
        i++;
      }
      i++; // closing fence
      const joined = body.join("\n");
      // code blocks also limited to 2000 per rich_text item
      blocks.push({
        object: "block",
        type: "code",
        code: {
          rich_text: toRichText(joined),
          language: sanitizeLanguage(lang),
        },
      } as BlockObjectRequest);
      continue;
    }

    // Divider
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ object: "block", type: "divider", divider: {} });
      i++;
      continue;
    }

    // Heading
    const heading = line.match(/^(#{1,3})\s+(.+)\s*$/);
    if (heading) {
      const level = heading[1].length;
      const type = level === 1 ? "heading_1" : level === 2 ? "heading_2" : "heading_3";
      blocks.push({
        object: "block",
        type,
        [type]: { rich_text: toRichText(heading[2]) },
      } as BlockObjectRequest);
      i++;
      continue;
    }

    // Bullet
    const bullet = line.match(/^[-*+]\s+(.+)$/);
    if (bullet) {
      blocks.push({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: toRichText(bullet[1]) },
      });
      i++;
      continue;
    }

    // Numbered
    const numbered = line.match(/^\d+\.\s+(.+)$/);
    if (numbered) {
      blocks.push({
        object: "block",
        type: "numbered_list_item",
        numbered_list_item: { rich_text: toRichText(numbered[1]) },
      });
      i++;
      continue;
    }

    // Quote
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      blocks.push({
        object: "block",
        type: "quote",
        quote: { rich_text: toRichText(quote[1]) },
      });
      i++;
      continue;
    }

    // Blank
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph: merge consecutive non-special lines
    const para: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("#") &&
      !lines[i].startsWith("```") &&
      !lines[i].startsWith(">") &&
      !/^[-*+]\s+/.test(lines[i]) &&
      !/^\d+\.\s+/.test(lines[i]) &&
      !/^(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push({
      object: "block",
      type: "paragraph",
      paragraph: { rich_text: toRichText(para.join("\n")) },
    });
  }

  return blocks;
}

export function chunkBlocks(
  blocks: BlockObjectRequest[],
  size = BLOCKS_PER_REQUEST,
): BlockObjectRequest[][] {
  const chunks: BlockObjectRequest[][] = [];
  for (let i = 0; i < blocks.length; i += size) {
    chunks.push(blocks.slice(i, i + size));
  }
  return chunks;
}

function sanitizeLanguage(
  lang: string,
):
  | "plain text"
  | "javascript"
  | "typescript"
  | "python"
  | "go"
  | "bash"
  | "json"
  | "markdown"
  | "yaml"
  | "sql"
  | "html"
  | "css"
  | "rust"
  | "java"
  | "shell" {
  const map: Record<string, string> = {
    js: "javascript",
    ts: "typescript",
    py: "python",
    sh: "shell",
    "": "plain text",
  };
  const normalized = (map[lang.toLowerCase()] || lang.toLowerCase()).trim();
  const allowed = new Set([
    "plain text",
    "javascript",
    "typescript",
    "python",
    "go",
    "bash",
    "json",
    "markdown",
    "yaml",
    "sql",
    "html",
    "css",
    "rust",
    "java",
    "shell",
  ]);
  return (allowed.has(normalized) ? normalized : "plain text") as
    | "plain text"
    | "javascript"
    | "typescript"
    | "python"
    | "go"
    | "bash"
    | "json"
    | "markdown"
    | "yaml"
    | "sql"
    | "html"
    | "css"
    | "rust"
    | "java"
    | "shell";
}

export const LIMITS = {
  RICH_TEXT_LIMIT,
  BLOCKS_PER_REQUEST,
};
