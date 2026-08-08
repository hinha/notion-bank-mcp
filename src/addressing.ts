export type TocEntry = {
  line: number;
  heading: string;
  level: number;
  text: string;
};

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;

export function splitLines(markdown: string): string[] {
  return markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

export function buildToc(markdown: string): TocEntry[] {
  const lines = splitLines(markdown);
  const toc: TocEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(HEADING_RE);
    if (!m) continue;
    toc.push({
      line: i + 1,
      heading: lines[i].trimEnd(),
      level: m[1].length,
      text: m[2].trim(),
    });
  }
  return toc;
}

export function withLineNumbers(markdown: string): string {
  const lines = splitLines(markdown);
  const width = Math.max(3, String(lines.length).length);
  return lines
    .map((line, i) => {
      const n = String(i + 1).padStart(width, "0");
      return `L${n}|${line}`;
    })
    .join("\n");
}

export function formatTocYaml(toc: TocEntry[]): string {
  if (toc.length === 0) return "toc: []";
  const body = toc
    .map((t) => `  - line: ${t.line}\n    heading: ${JSON.stringify(t.heading)}`)
    .join("\n");
  return `toc:\n${body}`;
}

export type AddressedDocument = {
  markdown: string;
  lines: string[];
  toc: TocEntry[];
  lineCount: number;
  numbered: string;
};

export function addressDocument(markdown: string): AddressedDocument {
  const lines = splitLines(markdown);
  return {
    markdown,
    lines,
    toc: buildToc(markdown),
    lineCount: lines.length,
    numbered: withLineNumbers(markdown),
  };
}

/** Normalize section matcher: "## Risks" or "Risks" */
export function normalizeSectionQuery(section: string): string {
  return section
    .replace(/^#+\s*/, "")
    .trim()
    .toLowerCase();
}

export type SectionRange = {
  startLine: number; // 1-based inclusive
  endLine: number; // 1-based inclusive
  headingLine: number;
  heading: string;
  occurrence: number;
};

export function findSectionRange(
  markdown: string,
  section: string,
  occurrence = 1,
): SectionRange | null {
  const toc = buildToc(markdown);
  const q = normalizeSectionQuery(section);
  const matches = toc.filter(
    (t) => normalizeSectionQuery(t.text) === q || normalizeSectionQuery(t.heading) === q,
  );
  if (matches.length === 0) return null;
  const idx = occurrence - 1;
  if (idx < 0 || idx >= matches.length) return null;
  const hit = matches[idx];
  const hitIndex = toc.indexOf(hit);
  const next = toc[hitIndex + 1];
  const lines = splitLines(markdown);
  const endLine = next ? next.line - 1 : lines.length;
  return {
    startLine: hit.line,
    endLine: Math.max(hit.line, endLine),
    headingLine: hit.line,
    heading: hit.heading,
    occurrence,
  };
}

export function sliceLines(markdown: string, startLine: number, endLine: number): string {
  const lines = splitLines(markdown);
  const start = Math.max(1, startLine);
  const end = Math.min(lines.length, endLine);
  if (start > end) return "";
  return lines.slice(start - 1, end).join("\n");
}

export function replaceLineRange(
  markdown: string,
  startLine: number,
  endLine: number,
  newMarkdown: string,
): string {
  const lines = splitLines(markdown);
  const start = Math.max(1, startLine);
  const end = Math.min(lines.length, endLine);
  if (start > end + 1 || start > lines.length + 1) {
    throw new Error(
      `Invalid line range ${startLine}-${endLine} for document with ${lines.length} lines`,
    );
  }
  const replacement = splitLines(newMarkdown.replace(/\n$/, ""));
  // Allow empty new_markdown to delete range
  const next = [
    ...lines.slice(0, start - 1),
    ...(newMarkdown === "" ? [] : replacement),
    ...lines.slice(end),
  ];
  return next.join("\n");
}

export function filterSections(markdown: string, sections: string[]): string {
  if (sections.length === 0) return markdown;
  const parts: string[] = [];
  for (const s of sections) {
    const range = findSectionRange(markdown, s);
    if (!range) continue;
    parts.push(sliceLines(markdown, range.startLine, range.endLine));
  }
  return parts.join("\n\n");
}

export function truncateLines(markdown: string, maxLines: number): string {
  if (maxLines <= 0) return markdown;
  const lines = splitLines(markdown);
  if (lines.length <= maxLines) return markdown;
  return `${lines.slice(0, maxLines).join("\n")}\n\n… truncated (${lines.length - maxLines} more lines)`;
}

export function searchInMarkdown(
  markdown: string,
  query: string,
  limit = 20,
): Array<{ line: number; snippet: string }> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const lines = splitLines(markdown);
  const hits: Array<{ line: number; snippet: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].toLowerCase().includes(q)) continue;
    hits.push({
      line: i + 1,
      snippet: lines[i].trim().slice(0, 200),
    });
    if (hits.length >= limit) break;
  }
  return hits;
}
