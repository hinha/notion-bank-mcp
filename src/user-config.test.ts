import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  configureWorkspace,
  getConfigStatus,
  normalizePageId,
  loadUserConfig,
} from "./user-config.js";

describe("normalizePageId", () => {
  it("parses dashed uuid", () => {
    const id = "39e8d63e-407a-806f-a1e1-d23d28e807df";
    assert.equal(normalizePageId(id), id);
  });

  it("parses 32-hex from URL", () => {
    const url =
      "https://www.notion.so/workspace/Plans-Superpowers-39e8d63e407a806fa1e1d23d28e807df";
    assert.equal(
      normalizePageId(url),
      "39e8d63e-407a-806f-a1e1-d23d28e807df",
    );
  });
});

describe("configureWorkspace", () => {
  it("writes per-user config file", () => {
    const dir = mkdtempSync(join(tmpdir(), "notion-bank-"));
    const prev = process.env.NOTION_BANK_CONFIG_PATH;
    process.env.NOTION_BANK_CONFIG_PATH = join(dir, "config.json");
    try {
      const saved = configureWorkspace({
        root_page_url:
          "https://app.notion.com/p/39e8d63e407a806fa1e1d23d28e807df",
        services: { "my-svc": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      });
      assert.equal(saved.root_page_id, "39e8d63e-407a-806f-a1e1-d23d28e807df");
      assert.equal(
        saved.services["my-svc"],
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      );
      const loaded = loadUserConfig();
      assert.ok(loaded);
      assert.equal(loaded!.root_page_id, saved.root_page_id);

      const status = getConfigStatus({
        hasNotionAuth: false,
        authSource: "none",
        oauthAppConfigured: true,
        credentialsPath: join(dir, "credentials.json"),
      });
      assert.equal(status.configured, false);
      assert.ok(
        status.missing.some((m) => m.includes("plan_oauth") || m.includes("NOTION")),
      );
    } finally {
      if (prev === undefined) delete process.env.NOTION_BANK_CONFIG_PATH;
      else process.env.NOTION_BANK_CONFIG_PATH = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
