#!/usr/bin/env bash
# Local launcher for development. End users should use `npx notion-bank-mcp`.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi
if [[ ! -f "$ROOT/dist/index.js" ]]; then
  echo "[notion-bank] dist/ missing — run: npm run build" >&2
  exit 1
fi
# Starts without credentials. Browser OAuth via mcp.notion.com on first use.
exec node "$ROOT/dist/index.js" "$@"
