import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  markdownFromFetch,
  parsePageTitle,
} from "./ops.js";

const SAMPLE_INNER = `Here is the result of "view" for the Page with URL https://app.notion.com/p/abc as of 2026-07-15T13:43:58.485Z:
<page url="https://app.notion.com/p/abc">
<ancestor-path>
<parent-page url="https://app.notion.com/p/parent" title="Service"/>
</ancestor-path>
<properties>
{"title":"Design: Notion Bank MCP"}
</properties>
<content>
# Design: Notion Bank MCP
**Status:** Implemented

## Goal
Ship plan-bank MCP.

### Tools
- plan_get
</content>
</page>`;

const SAMPLE_JSON = JSON.stringify({
  metadata: { type: "page" },
  title: "Design: Notion Bank MCP",
  url: "https://app.notion.com/p/abc",
  text: SAMPLE_INNER,
});

describe("markdownFromFetch", () => {
  it("extracts <content> from Notion MCP JSON fetch wrapper", () => {
    const md = markdownFromFetch(SAMPLE_JSON);
    assert.match(md, /^# Design: Notion Bank MCP/m);
    assert.match(md, /^## Goal/m);
    assert.match(md, /^### Tools/m);
    assert.equal(md.includes("<content>"), false);
    assert.equal(md.includes('"metadata"'), false);
  });

  it("extracts <content> from raw enhanced-markdown text", () => {
    const md = markdownFromFetch(SAMPLE_INNER);
    assert.match(md, /^# Design: Notion Bank MCP/);
    assert.equal(md.includes("<page"), false);
  });

  it("returns plain markdown unchanged", () => {
    const plain = "# Hello\n\nBody line.\n";
    const md = markdownFromFetch(plain);
    assert.equal(md, "# Hello\n\nBody line.\n");
  });

  it("falls back to first markdown heading when no content tag", () => {
    const raw =
      "Preface chrome\n\n# Title Only\n\nParagraph after.\n";
    const md = markdownFromFetch(raw);
    assert.match(md, /^# Title Only/);
    assert.match(md, /Paragraph after/);
  });
});

describe("parsePageTitle", () => {
  it("prefers JSON title field", () => {
    assert.equal(
      parsePageTitle(SAMPLE_JSON, "fallback"),
      "Design: Notion Bank MCP",
    );
  });

  it("reads properties title from enhanced markdown", () => {
    assert.equal(
      parsePageTitle(SAMPLE_INNER, "fallback"),
      "Design: Notion Bank MCP",
    );
  });
});
