import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveHttpIdleMs, TransportSessionRegistry } from "./transport-sessions.js";

describe("resolveHttpIdleMs", () => {
  it("defaults to 30 minutes", () => {
    assert.equal(resolveHttpIdleMs({}), 30 * 60 * 1000);
  });

  it("allows disable with 0", () => {
    assert.equal(resolveHttpIdleMs({ NOTION_BANK_HTTP_IDLE_MS: "0" }), 0);
  });

  it("parses custom ms", () => {
    assert.equal(resolveHttpIdleMs({ NOTION_BANK_HTTP_IDLE_MS: "5000" }), 5000);
  });
});

describe("TransportSessionRegistry", () => {
  it("refreshes activity on get and evicts idle", async () => {
    let closed = 0;
    const registry = new TransportSessionRegistry(50, 10_000);
    registry.set("s1", {
      accessToken: "tok",
      lastActiveAt: Date.now() - 100,
      transport: {
        close: async () => {
          closed++;
        },
      },
    });
    registry.set("s2", {
      accessToken: "tok2",
      lastActiveAt: Date.now(),
      transport: {
        close: async () => {
          closed++;
        },
      },
    });

    const evicted = await registry.evictIdle();
    assert.deepEqual(evicted, ["s1"]);
    assert.equal(closed, 1);
    assert.equal(registry.size, 1);
    assert.ok(registry.get("s2"));
    registry.delete("s2");
    assert.equal(registry.size, 0);
  });

  it("skips eviction when idleMs is 0", async () => {
    const registry = new TransportSessionRegistry(0);
    registry.set("s1", {
      accessToken: "t",
      lastActiveAt: 0,
      transport: { close: async () => {} },
    });
    assert.deepEqual(await registry.evictIdle(), []);
    assert.equal(registry.size, 1);
  });

  it("start/stop interval is unref-safe", () => {
    const registry = new TransportSessionRegistry(60_000, 1000);
    registry.start();
    registry.start(); // idempotent
    registry.stop();
    registry.stop();
  });
});
