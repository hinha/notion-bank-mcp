import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addressDocument,
  findSectionRange,
  replaceLineRange,
  searchInMarkdown,
  withLineNumbers,
} from "./addressing.js";
import { markdownToBlocks, chunkBlocks, toRichText } from "./notion/chunker.js";
import { etagOf } from "./config.js";

describe("addressing", () => {
  const md = `# Goal\n\nDo thing.\n\n## Risks\n\n- A\n\n## Risks\n\n- B\n`;

  it("withLineNumbers prefixes L00N", () => {
    const out = withLineNumbers("# Hi\nThere");
    assert.match(out, /^L001\|# Hi\nL002\|There$/);
  });

  it("builds toc with line numbers", () => {
    const doc = addressDocument(md);
    assert.equal(doc.toc[0].text, "Goal");
    assert.equal(doc.toc[1].text, "Risks");
    assert.equal(doc.toc[1].line, 5);
  });

  it("finds section by occurrence", () => {
    const first = findSectionRange(md, "Risks", 1);
    const second = findSectionRange(md, "## Risks", 2);
    assert.ok(first);
    assert.ok(second);
    assert.equal(first!.startLine, 5);
    assert.equal(second!.startLine, 9);
  });

  it("replaceLineRange updates slice", () => {
    const next = replaceLineRange(md, 5, 7, "## Risks\n\n- Z");
    assert.match(next, /## Risks\n\n- Z/);
    assert.match(next, /## Risks\n\n- B/);
  });

  it("searchInMarkdown returns line hits", () => {
    const hits = searchInMarkdown(md, "Do thing");
    assert.equal(hits[0].line, 3);
  });
});

describe("chunker", () => {
  it("splits rich text over 2000 chars", () => {
    const long = "x".repeat(4500);
    const parts = toRichText(long);
    assert.equal(parts.length, 3);
    assert.equal(parts[0].text.content.length, 2000);
  });

  it("chunkBlocks respects 100", () => {
    const blocks = markdownToBlocks(
      Array.from({ length: 250 }, (_, i) => `- item ${i}`).join("\n"),
    );
    const chunks = chunkBlocks(blocks, 100);
    assert.equal(chunks.length, 3);
    assert.equal(chunks[0].length, 100);
  });

  it("parses headings and code", () => {
    const blocks = markdownToBlocks("# T\n\n```ts\nconst x = 1\n```\n");
    assert.equal(blocks[0].type, "heading_1");
    assert.equal(blocks[1].type, "code");
  });
});

describe("etag", () => {
  it("is stable sha256", () => {
    assert.equal(etagOf("a"), etagOf("a"));
    assert.notEqual(etagOf("a"), etagOf("b"));
    assert.match(etagOf("a"), /^sha256:[a-f0-9]{64}$/);
  });
});
