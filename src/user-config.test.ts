import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  configPath,
  configureWorkspace,
  getConfigStatus,
  loadUserConfig,
  normalizePageId,
  saveUserConfig,
} from "./user-config.js";

describe("normalizePageId", () => {
  it("parses dashed uuid", () => {
    const id = "39e8d63e-407a-806f-a1e1-d23d28e807df";
    assert.equal(normalizePageId(id), id);
  });

  it("parses 32-hex from URL", () => {
    const url =
      "https://www.notion.so/workspace/Plans-Superpowers-39e8d63e407a806fa1e1d23d28e807df";
    assert.equal(normalizePageId(url), "39e8d63e-407a-806f-a1e1-d23d28e807df");
  });

  it("rejects unparseable input", () => {
    assert.throws(() => normalizePageId("not-a-page"), /Could not parse/);
  });
});

describe("configureWorkspace", () => {
  it("writes per-user config file", () => {
    const dir = mkdtempSync(join(tmpdir(), "notion-bank-"));
    const prev = process.env.NOTION_BANK_CONFIG_PATH;
    process.env.NOTION_BANK_CONFIG_PATH = join(dir, "config.json");
    try {
      const saved = configureWorkspace({
        root_page_url: "https://app.notion.com/p/39e8d63e407a806fa1e1d23d28e807df",
        services: { "my-svc": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      });
      assert.equal(saved.root_page_id, "39e8d63e-407a-806f-a1e1-d23d28e807df");
      assert.equal(saved.services["my-svc"], "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
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
      assert.ok(status.missing.some((m) => m.includes("plan_oauth") || m.includes("NOTION")));
    } finally {
      if (prev === undefined) delete process.env.NOTION_BANK_CONFIG_PATH;
      else process.env.NOTION_BANK_CONFIG_PATH = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("merges services and reuses root when omitted", () => {
    const dir = mkdtempSync(join(tmpdir(), "notion-bank-"));
    const prev = process.env.NOTION_BANK_CONFIG_PATH;
    process.env.NOTION_BANK_CONFIG_PATH = join(dir, "config.json");
    try {
      configureWorkspace({
        root_page_id: "39e8d63e407a806fa1e1d23d28e807df",
        services: { alpha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
        export_dir: "/tmp/exports",
      });
      const merged = configureWorkspace({
        services: { "Beta Svc": "cccccccccccccccccccccccccccccccc" },
      });
      assert.equal(merged.root_page_id, "39e8d63e-407a-806f-a1e1-d23d28e807df");
      assert.equal(merged.services.alpha, "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
      assert.equal(merged.services["beta-svc"], "cccccccc-cccc-cccc-cccc-cccccccccccc");
      assert.equal(merged.export_dir, "/tmp/exports");

      const replaced = configureWorkspace({
        root_page_id: "39e8d63e407a806fa1e1d23d28e807df",
        services: { only: "dddddddddddddddddddddddddddddddd" },
        merge_services: false,
      });
      assert.deepEqual(Object.keys(replaced.services), ["only"]);
    } finally {
      if (prev === undefined) delete process.env.NOTION_BANK_CONFIG_PATH;
      else process.env.NOTION_BANK_CONFIG_PATH = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("requires root on first configure", () => {
    const dir = mkdtempSync(join(tmpdir(), "notion-bank-"));
    const prev = process.env.NOTION_BANK_CONFIG_PATH;
    process.env.NOTION_BANK_CONFIG_PATH = join(dir, "config.json");
    try {
      assert.throws(() => configureWorkspace({ services: {} }), /required on first configure/);
    } finally {
      if (prev === undefined) delete process.env.NOTION_BANK_CONFIG_PATH;
      else process.env.NOTION_BANK_CONFIG_PATH = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("loadUserConfig + status", () => {
  it("returns null when file missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "notion-bank-"));
    const prev = process.env.NOTION_BANK_CONFIG_PATH;
    process.env.NOTION_BANK_CONFIG_PATH = join(dir, "missing.json");
    try {
      assert.equal(loadUserConfig(), null);
      assert.match(configPath(), /missing\.json$/);
    } finally {
      if (prev === undefined) delete process.env.NOTION_BANK_CONFIG_PATH;
      else process.env.NOTION_BANK_CONFIG_PATH = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns null when root_page_id absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "notion-bank-"));
    const prev = process.env.NOTION_BANK_CONFIG_PATH;
    const path = join(dir, "config.json");
    process.env.NOTION_BANK_CONFIG_PATH = path;
    try {
      writeFileSync(path, `${JSON.stringify({ services: {} })}\n`);
      assert.equal(loadUserConfig(), null);
    } finally {
      if (prev === undefined) delete process.env.NOTION_BANK_CONFIG_PATH;
      else process.env.NOTION_BANK_CONFIG_PATH = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws on invalid JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "notion-bank-"));
    const prev = process.env.NOTION_BANK_CONFIG_PATH;
    const path = join(dir, "config.json");
    process.env.NOTION_BANK_CONFIG_PATH = path;
    try {
      writeFileSync(path, "{not-json");
      assert.throws(() => loadUserConfig(), /Invalid config/);
    } finally {
      if (prev === undefined) delete process.env.NOTION_BANK_CONFIG_PATH;
      else process.env.NOTION_BANK_CONFIG_PATH = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports ready and misconfigured distributor hints", () => {
    const dir = mkdtempSync(join(tmpdir(), "notion-bank-"));
    const prev = process.env.NOTION_BANK_CONFIG_PATH;
    process.env.NOTION_BANK_CONFIG_PATH = join(dir, "config.json");
    try {
      saveUserConfig({
        root_page_id: "39e8d63e-407a-806f-a1e1-d23d28e807df",
        services: {},
        export_dir: "/out",
      });
      const ready = getConfigStatus({
        hasNotionAuth: true,
        authSource: "oauth",
        oauthAppConfigured: true,
        credentialsPath: join(dir, "cred.json"),
        workspaceName: "WS",
      });
      assert.equal(ready.configured, true);
      assert.equal(ready.missing.length, 0);
      assert.match(ready.hint, /Ready/);
      assert.equal(ready.export_dir, "/out");
      assert.equal(ready.workspace_name, "WS");

      const badBuild = getConfigStatus({
        hasNotionAuth: false,
        authSource: "none",
        oauthAppConfigured: false,
        credentialsPath: join(dir, "cred.json"),
      });
      assert.ok(badBuild.missing.some((m) => m.includes("misconfigured")));
      assert.match(badBuild.hint, /distributor/);
    } finally {
      if (prev === undefined) delete process.env.NOTION_BANK_CONFIG_PATH;
      else process.env.NOTION_BANK_CONFIG_PATH = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
