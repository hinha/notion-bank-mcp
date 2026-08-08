import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  getToken,
  inMemoryAuthSizes,
  pruneInMemoryAuth,
  purgeExpiredTokens,
  putAuthCode,
  putPendingAuth,
  saveToken,
  takePendingAuth,
} from "./session-store.js";

describe("purgeExpiredTokens", () => {
  it("removes expired access tokens and refresh index", () => {
    const data = {
      clients: {},
      tokens: {
        live: {
          access_token: "live",
          refresh_token: "r-live",
          client_id: "c",
          scopes: [],
          expires_at: Date.now() + 60_000,
          notion: {
            access_token: "n",
            refresh_token: null,
            token_type: "bearer",
          },
          workspace: null,
          created_at: new Date().toISOString(),
        },
        dead: {
          access_token: "dead",
          refresh_token: "r-dead",
          client_id: "c",
          scopes: [],
          expires_at: Date.now() - 1000,
          notion: {
            access_token: "n",
            refresh_token: null,
            token_type: "bearer",
          },
          workspace: null,
          created_at: new Date().toISOString(),
        },
      },
      refresh_index: { "r-live": "live", "r-dead": "dead" },
    };
    assert.equal(purgeExpiredTokens(data), true);
    assert.ok(data.tokens.live);
    assert.equal(data.tokens.dead, undefined);
    assert.equal(data.refresh_index["r-dead"], undefined);
    assert.equal(purgeExpiredTokens(data), false);
  });
});

describe("pruneInMemoryAuth + disk purge via getToken", () => {
  it("drops expired pending/auth codes", () => {
    putPendingAuth("p1", {
      client_id: "c",
      redirect_uri: "http://localhost",
      code_challenge: "x",
      scopes: [],
      expires_at: Date.now() - 1,
    });
    let pruned = pruneInMemoryAuth();
    assert.equal(pruned.pending, 1);
    assert.equal(takePendingAuth("p1"), null);

    putAuthCode({
      code: "code1",
      client_id: "c",
      redirect_uri: "http://localhost",
      code_challenge: "x",
      scopes: [],
      notion: { access_token: "a", refresh_token: null, token_type: "bearer" },
      expires_at: Date.now() - 1,
    });
    pruned = pruneInMemoryAuth();
    assert.equal(pruned.codes, 1);

    putPendingAuth("p2", {
      client_id: "c",
      redirect_uri: "http://localhost",
      code_challenge: "x",
      scopes: [],
      expires_at: Date.now() + 60_000,
    });
    assert.ok(takePendingAuth("p2"));
    assert.equal(inMemoryAuthSizes().pending, 0);
  });

  it("getToken purges expired rows from disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "notion-bank-sess-"));
    const prev = process.env.NOTION_BANK_DATA_DIR;
    process.env.NOTION_BANK_DATA_DIR = dir;
    try {
      saveToken({
        access_token: "dead-access",
        refresh_token: "dead-refresh",
        client_id: "c",
        scopes: [],
        expires_at: Date.now() - 5000,
        notion: { access_token: "n", refresh_token: null, token_type: "bearer" },
        workspace: null,
        created_at: new Date().toISOString(),
      });
      saveToken({
        access_token: "live-access",
        refresh_token: "live-refresh",
        client_id: "c",
        scopes: [],
        expires_at: Date.now() + 60_000,
        notion: { access_token: "n", refresh_token: null, token_type: "bearer" },
        workspace: null,
        created_at: new Date().toISOString(),
      });
      assert.equal(getToken("dead-access"), null);
      assert.ok(getToken("live-access"));
    } finally {
      if (prev === undefined) delete process.env.NOTION_BANK_DATA_DIR;
      else process.env.NOTION_BANK_DATA_DIR = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
