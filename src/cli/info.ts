import { getPackageMeta, getPackageVersion } from "../package-meta.js";

export type InfoCommand = "version" | "update" | "help";

const REGISTRY_LATEST = "https://registry.npmjs.org/notion-bank-mcp/latest";

/** Detect info subcommands before MCP stdio/HTTP boot. */
export function matchInfoCommand(argv: string[]): InfoCommand | null {
  const first = argv[0]?.trim();
  if (!first) return null;
  if (first === "--version" || first === "-V" || first === "version") {
    return "version";
  }
  if (first === "update") return "update";
  if (first === "--help" || first === "-h" || first === "help") return "help";
  return null;
}

export function formatVersionLine(
  meta: { name: string; version: string } = getPackageMeta(),
): string {
  return `${meta.name} ${meta.version}`;
}

export function printVersion(write: (s: string) => void = console.log): void {
  write(formatVersionLine());
}

export function printHelp(write: (s: string) => void = console.log): void {
  write(`Usage: notion-bank-mcp [command] [options]

Commands:
  version, --version, -V   Print package version
  update                   Check npm registry for a newer version (no install)
  help, --help, -h         Show this help
  serve, --http            Start Streamable HTTP server (optional hosted URL)
  --stdio                  Start MCP over stdio (default when not serve)

Setup:
  End users need no CLIENT_ID/SECRET. Browser OAuth via mcp.notion.com opens
  automatically on first Notion tool use. Config lives under ~/.config/notion-bank/

Examples:
  npx -y notion-bank-mcp --version
  notion-bank-mcp update
  notion-bank-mcp --stdio
  notion-bank-mcp serve
`);
}

function parseSemver(raw: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(raw.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Compare a.b.c style versions. Returns -1 if a<b, 0 if equal, 1 if a>b. */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) {
    return a === b ? 0 : a < b ? -1 : 1;
  }
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}

export type UpdateCheckResult = {
  current: string;
  latest: string | null;
  status: "up_to_date" | "update_available" | "unavailable";
  message: string;
};

export async function checkForUpdate(
  fetchImpl: typeof fetch = fetch,
  currentVersion: string = getPackageVersion(),
): Promise<UpdateCheckResult> {
  try {
    const res = await fetchImpl(REGISTRY_LATEST, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      return {
        current: currentVersion,
        latest: null,
        status: "unavailable",
        message: `Could not check for updates (registry HTTP ${res.status}). Current: ${currentVersion}`,
      };
    }
    const body = (await res.json()) as { version?: string };
    const latest = body.version?.trim() ?? "";
    if (!latest) {
      return {
        current: currentVersion,
        latest: null,
        status: "unavailable",
        message: `Could not parse latest version from registry. Current: ${currentVersion}`,
      };
    }
    if (compareSemver(currentVersion, latest) >= 0) {
      return {
        current: currentVersion,
        latest,
        status: "up_to_date",
        message: `notion-bank-mcp is up to date (${currentVersion})`,
      };
    }
    return {
      current: currentVersion,
      latest,
      status: "update_available",
      message: [
        `New version available: ${latest} (current ${currentVersion})`,
        "Update with: npm i -g notion-bank-mcp@latest",
        "Or use: npx -y notion-bank-mcp@latest",
      ].join("\n"),
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      current: currentVersion,
      latest: null,
      status: "unavailable",
      message: `Could not check for updates (${detail}). Current: ${currentVersion}`,
    };
  }
}

export async function printUpdateCheck(
  fetchImpl: typeof fetch = fetch,
  write: (s: string) => void = console.log,
): Promise<number> {
  const result = await checkForUpdate(fetchImpl);
  write(result.message);
  return result.status === "unavailable" ? 1 : 0;
}

export async function runInfoCommand(
  cmd: InfoCommand,
  opts: {
    fetchImpl?: typeof fetch;
    write?: (s: string) => void;
  } = {},
): Promise<number> {
  const write = opts.write ?? console.log;
  switch (cmd) {
    case "version":
      printVersion(write);
      return 0;
    case "help":
      printHelp(write);
      return 0;
    case "update":
      return printUpdateCheck(opts.fetchImpl ?? fetch, write);
    default:
      return 1;
  }
}
