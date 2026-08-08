import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveCacheMaxEntries, TtlCache } from "./cache.js";

describe("TtlCache", () => {
  it("expires on get and sweep", async () => {
    const cache = new TtlCache(20, 10);
    cache.set("a", 1);
    assert.equal(cache.get("a"), 1);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(cache.get("a"), undefined);
    cache.set("b", 2, 5);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(cache.sweep(), 1);
    assert.equal(cache.size, 0);
  });

  it("evicts oldest when over maxEntries (LRU)", () => {
    const cache = new TtlCache(60_000, 2);
    cache.set("a", 1);
    cache.set("b", 2);
    assert.equal(cache.get("a"), 1); // touch a → b is oldest
    cache.set("c", 3);
    assert.equal(cache.get("b"), undefined);
    assert.equal(cache.get("a"), 1);
    assert.equal(cache.get("c"), 3);
    assert.equal(cache.size, 2);
  });

  it("invalidatePrefix and clear", () => {
    const cache = new TtlCache(60_000, 10);
    cache.set("md:1", "x");
    cache.set("md:2", "y");
    cache.set("title:1", "t");
    cache.invalidatePrefix("md:");
    assert.equal(cache.get("md:1"), undefined);
    assert.equal(cache.get("title:1"), "t");
    cache.clear();
    assert.equal(cache.size, 0);
  });
});

describe("resolveCacheMaxEntries", () => {
  it("defaults and parses env", () => {
    assert.equal(resolveCacheMaxEntries({}), 256);
    assert.equal(resolveCacheMaxEntries({ NOTION_BANK_CACHE_MAX_ENTRIES: "128" }), 128);
    assert.equal(resolveCacheMaxEntries({ NOTION_BANK_CACHE_MAX_ENTRIES: "nope" }), 256);
  });
});
