#!/usr/bin/env node
import { spawn } from "node:child_process";
// Collect src/**/*.test.ts and run via tsx --test.
// Avoids shell/c8 glob quirks on Linux CI (quoted globs treated as literal paths).
import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = join(root, "src");

async function collectTests(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectTests(full)));
    } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

const files = (await collectTests(srcRoot)).sort();
if (files.length === 0) {
  console.error("No test files found under src/");
  process.exit(1);
}

const tsxBin = join(root, "node_modules", "tsx", "dist", "cli.mjs");
const child = spawn(process.execPath, [tsxBin, "--test", ...files], {
  stdio: "inherit",
  cwd: root,
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
