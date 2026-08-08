import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkForUpdate,
  compareSemver,
  formatVersionLine,
  matchInfoCommand,
  printHelp,
  printVersion,
  runInfoCommand,
} from "./info.js";

describe("cli/info", () => {
  it("matchInfoCommand detects version/help/update", () => {
    assert.equal(matchInfoCommand(["--version"]), "version");
    assert.equal(matchInfoCommand(["-V"]), "version");
    assert.equal(matchInfoCommand(["version"]), "version");
    assert.equal(matchInfoCommand(["update"]), "update");
    assert.equal(matchInfoCommand(["--help"]), "help");
    assert.equal(matchInfoCommand(["-h"]), "help");
    assert.equal(matchInfoCommand(["help"]), "help");
    assert.equal(matchInfoCommand(["--stdio"]), null);
    assert.equal(matchInfoCommand([]), null);
  });

  it("formatVersionLine and printVersion", () => {
    const line = formatVersionLine({ name: "notion-bank-mcp", version: "1.2.3" });
    assert.equal(line, "notion-bank-mcp 1.2.3");
    let out = "";
    printVersion((s) => {
      out = s;
    });
    assert.match(out, /^notion-bank-mcp \d+\.\d+\.\d+/);
  });

  it("printHelp mentions update and version", () => {
    let out = "";
    printHelp((s) => {
      out = s;
    });
    assert.match(out, /update/);
    assert.match(out, /version/);
    assert.match(out, /serve/);
  });

  it("compareSemver orders versions", () => {
    assert.equal(compareSemver("1.0.0", "1.0.1"), -1);
    assert.equal(compareSemver("2.0.0", "1.9.9"), 1);
    assert.equal(compareSemver("1.2.3", "1.2.3"), 0);
  });

  it("compareSemver falls back for non-semver strings", () => {
    assert.equal(compareSemver("beta", "beta"), 0);
    assert.ok(compareSemver("a", "b") !== 0);
  });

  it("checkForUpdate reports update available", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ version: "9.9.9" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    const result = await checkForUpdate(fetchImpl as typeof fetch, "1.0.0");
    assert.equal(result.status, "update_available");
    assert.equal(result.latest, "9.9.9");
    assert.match(result.message, /New version available/);
  });

  it("checkForUpdate reports up to date", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ version: "1.0.0" }), { status: 200 });
    const result = await checkForUpdate(fetchImpl as typeof fetch, "1.0.0");
    assert.equal(result.status, "up_to_date");
  });

  it("checkForUpdate handles registry errors", async () => {
    const fetchImpl = async () => new Response("nope", { status: 500 });
    const result = await checkForUpdate(fetchImpl as typeof fetch, "1.0.0");
    assert.equal(result.status, "unavailable");
  });

  it("checkForUpdate handles network errors", async () => {
    const fetchImpl = async () => {
      throw new Error("offline");
    };
    const result = await checkForUpdate(fetchImpl as typeof fetch, "1.0.0");
    assert.equal(result.status, "unavailable");
    assert.match(result.message, /offline/);
  });

  it("checkForUpdate handles empty version body", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({}), { status: 200 });
    const result = await checkForUpdate(fetchImpl as typeof fetch, "1.0.0");
    assert.equal(result.status, "unavailable");
  });

  it("runInfoCommand version and help exit 0", async () => {
    const sink: string[] = [];
    const write = (s: string) => sink.push(s);
    assert.equal(await runInfoCommand("version", { write }), 0);
    assert.equal(await runInfoCommand("help", { write }), 0);
    assert.ok(sink.length >= 2);
  });

  it("runInfoCommand update returns 0 when available", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ version: "1.0.0" }), { status: 200 });
    const code = await runInfoCommand("update", {
      fetchImpl: fetchImpl as typeof fetch,
      write: () => {},
    });
    assert.equal(code, 0);
  });
});
