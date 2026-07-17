import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  accessTokenNeedsRefresh,
  isInvalidAuthError,
} from "./client.js";
import type { OAuthTokens } from "./tokens.js";

describe("isInvalidAuthError", () => {
  it("detects Notion invalid auth token", () => {
    assert.equal(isInvalidAuthError(new Error("Invalid auth token")), true);
  });

  it("ignores unrelated errors", () => {
    assert.equal(isInvalidAuthError(new Error("page not found")), false);
  });
});

describe("accessTokenNeedsRefresh", () => {
  const base: OAuthTokens = {
    access_token: "a",
    refresh_token: "r",
    token_type: "bearer",
    obtained_at: new Date().toISOString(),
  };

  it("refreshes when expires_at is in the past", () => {
    assert.equal(
      accessTokenNeedsRefresh({
        ...base,
        expires_at: Date.now() - 1000,
      }),
      true,
    );
  });

  it("skips refresh when expires_at is far ahead", () => {
    assert.equal(
      accessTokenNeedsRefresh({
        ...base,
        expires_at: Date.now() + 60 * 60 * 1000,
      }),
      false,
    );
  });

  it("uses obtained_at fallback when expires_at missing", () => {
    assert.equal(
      accessTokenNeedsRefresh({
        ...base,
        obtained_at: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
        expires_at: null,
      }),
      true,
    );
  });
});
