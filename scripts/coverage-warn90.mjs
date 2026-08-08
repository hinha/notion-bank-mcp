#!/usr/bin/env node
/**
 * Soft gate: if coverage summary exists and any metric is under 90%,
 * print a CI annotation warning. Does not fail the process when >= 75%.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const summaryPath = resolve(process.cwd(), "coverage/coverage-summary.json");
const TARGET = 90;

if (!existsSync(summaryPath)) {
  console.warn("[coverage:warn90] no coverage-summary.json — skip");
  process.exit(0);
}

const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
const total = summary.total;
if (!total) {
  console.warn("[coverage:warn90] missing total in summary — skip");
  process.exit(0);
}

const metrics = ["lines", "statements", "functions", "branches"];
const below = [];

for (const key of metrics) {
  const pct = total[key]?.pct;
  if (typeof pct === "number" && pct < TARGET) {
    below.push(`${key}=${pct}%`);
  }
}

if (below.length === 0) {
  console.log(`[coverage:warn90] all metrics >= ${TARGET}%`);
  process.exit(0);
}

const msg = `Coverage below recommended ${TARGET}%: ${below.join(", ")} (minimum gate is 75%)`;
console.warn(`[coverage:warn90] ${msg}`);
// GitHub Actions annotation (non-failing)
if (process.env.GITHUB_ACTIONS === "true") {
  console.log(`::warning title=Coverage below ${TARGET}%::${msg}`);
}
process.exit(0);
