import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getPackageMeta, getPackageName, getPackageVersion } from "./package-meta.js";

describe("package-meta", () => {
  it("reads name and version from package.json", () => {
    const meta = getPackageMeta();
    assert.equal(meta.name, "notion-bank-mcp");
    assert.match(meta.version, /^\d+\.\d+\.\d+/);
    assert.equal(getPackageName(), meta.name);
    assert.equal(getPackageVersion(), meta.version);
  });
});
