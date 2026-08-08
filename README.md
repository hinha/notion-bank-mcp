# notion-bank-mcp

Plan-bank MCP for AI agents — read and write Markdown implementation plans in Notion with **line + section addressing**, for Cursor, Claude, Codex, and other MCP hosts.

**Auth:** browser OAuth via [mcp.notion.com](https://mcp.notion.com). No `CLIENT_ID` / `SECRET` for end users. No integration token in `mcp.json`.

```bash
npx -y notion-bank-mcp@latest --version
```

---

## Quick start

1. Add this to your MCP config (Cursor example — same shape works for Claude Desktop / Codex):

```json
{
  "mcpServers": {
    "notion-bank": {
      "command": "npx",
      "args": ["-y", "notion-bank-mcp@latest"]
    }
  }
}
```

2. Restart the host. Tools like `plan_status` and `plan_upsert` should appear.
3. On the first Notion action, a **browser** opens → sign in with Notion.
4. Tell the agent your **Plans root** Notion page URL once → it runs `plan_configure`.

That is enough for most users.

---

## Install options

| Method | When to use |
|--------|-------------|
| `npx -y notion-bank-mcp@latest` | Recommended — always latest, no global install |
| `npm i -g notion-bank-mcp` then `notion-bank-mcp` | Frequent local use |
| Clone + `make build` | Developing the server itself |

Check / update the CLI:

```bash
notion-bank-mcp --version          # or: notion-bank-mcp version
notion-bank-mcp update             # checks npm only — does not auto-install
notion-bank-mcp --help
```

If `update` reports a newer version:

```bash
npm i -g notion-bank-mcp@latest
# or keep using npx -y notion-bank-mcp@latest
```

---

## CLI

| Command | Purpose |
|---------|---------|
| `(default)` / `--stdio` | MCP over stdio (hosts) |
| `serve` / `--http` | Streamable HTTP (optional hosted URL) |
| `version` / `--version` / `-V` | Print package version |
| `update` | Compare local version to npm `latest` |
| `help` / `--help` / `-h` | Short usage |

### Env (optional)

| Env | Description |
|-----|-------------|
| `NOTION_BANK_CONFIG_PATH` | Override path to `config.json` |
| `NOTION_BANK_CREDENTIALS_PATH` | Override path to OAuth credentials |
| `NOTION_BANK_CACHE_TTL_MS` | In-process cache TTL (default `60000`) |
| `NOTION_BANK_CACHE_MAX_ENTRIES` | Cache LRU cap (default `256`) |
| `NOTION_BANK_MODE` | Set `http` to force HTTP serve |
| `NOTION_BANK_LOCAL_CALLBACK_PORT` | OAuth callback port (default `8765`) |

HTTP-only (operators): `NOTION_BANK_PUBLIC_URL`, `NOTION_BANK_HOST`, `NOTION_BANK_PORT`, `NOTION_BANK_HTTP_IDLE_MS`. See [docs/OPERATOR.md](docs/OPERATOR.md).

### Local from source

```bash
make install && make check && make build
make stdio
# or: node dist/index.js
```

From a local clone before publishing:

```json
{
  "mcpServers": {
    "notion-bank": {
      "command": "node",
      "args": ["/absolute/path/to/notion-bank-mcp/dist/index.js"]
    }
  }
}
```

---

## Host compatibility

Primary transport is **stdio**. Same `command` + `args` pattern as other MCP servers. **No env tokens required.**

| Host | Config | Notes |
|------|--------|-------|
| **Cursor** | `.cursor/mcp.json` or Settings → MCP | See `mcp.json.example` |
| **Claude Desktop** | `claude_desktop_config.json` | Same `mcpServers` JSON |
| **Claude Code** | MCP settings | Stdio; optional skill under `.claude/skills/` |
| **Codex** | MCP / tools config | Same pattern |
| **Windsurf / OpenCode** | MCP `command`/`args` | Prefer stdio |

### Agent flow

```text
npx notion-bank-mcp@latest  (host starts stdio)
        │
        ▼
plan_status
        │
        ├─ no auth → browser OAuth (localhost callback :8765)
        │            tokens → ~/.config/notion-bank/credentials.json
        │
        └─ no root → ask Plans root URL → plan_configure
                     config → ~/.config/notion-bank/config.json
        │
        ▼
plan_upsert / plan_get / plan_update_range / …
```

Hierarchy:

```text
Plans / Superpowers          ← root (plan_configure)
  └── <Service>              ← plan_ensure_service
        └── <Plan title>     ← plan_upsert / plan_migrate
```

---

## Tools

| Tool | Purpose |
|------|---------|
| `plan_status` | Auth + workspace readiness |
| `plan_oauth_login` / `plan_oauth_wait` / `plan_oauth_logout` | Browser OAuth lifecycle |
| `plan_configure` | Persist Plans root (+ optional service map) |
| `plan_ensure_service` | Ensure service page under root |
| `plan_create_child` | Create a subpage under any parent page id/URL |
| `plan_upsert` / `plan_migrate` | Create/update plan from markdown or file |
| `plan_get` | Read with optional `L00N\|` lines, TOC, etag |
| `plan_update_range` | Surgical edit by section / lines + `expected_etag` |
| `plan_search` | Search with line hits |
| `plan_sync` | Export Notion plan → local markdown |

## Resources

- `notion-bank://docs/workflow`
- `notion-bank://docs/instructions`
- `notion-bank://config`

## Config (per user / machine)

Stored **outside the git repo**:

| Path | Contents |
|------|----------|
| `~/.config/notion-bank/config.json` | Plans root + service map |
| `~/.config/notion-bank/credentials.json` | OAuth access / refresh tokens |
| `~/.config/notion-bank/oauth-pending.json` | Short-lived login state (auto-cleared) |

Do **not** put Notion tokens or OAuth client secrets in the repo or in committed `mcp.json`. Access tokens expire (~8h); the server refreshes automatically when possible. If refresh fails, run `plan_oauth_login` again.

---

## HTTP serve

Optional hosted URL mode for teams that want `"url": "https://host/mcp"` instead of stdio:

```bash
npm run serve
# or: notion-bank-mcp serve
```

Details: [docs/OPERATOR.md](docs/OPERATOR.md). **Not** required for normal users.

---

## Skills

MCP tools and **skills** are separate. The skill teaches the agent *when/how* to document in Notion; the server only registers tools.

Shipped skill: `skills/notion-bank/SKILL.md`  
Slash name: `/notion-bank`

Copy into your host skills directory (with notion-bank MCP enabled):

| Host | Typical path |
|------|----------------|
| **Cursor** | `.cursor/skills/notion-bank/` or user skills |
| **Claude Code** | `.claude/skills/notion-bank/` |
| **Codex / agents** | `.agents/skills/notion-bank/` |

The skill chains `superpowers` (brainstorming → writing-plans) and `optimize-goal` when applicable, uses an in-skill engineering checklist, and always returns the Notion URL.

---

## Developers

```bash
make check          # typecheck + biome + tests (coverage fail <75%, warn <90%)
make test-coverage
make release VERSION=1.5.0   # bump package.json, commit, create annotated tag v1.5.0
git push && git push origin v1.5.0   # triggers GitHub Actions → npm publish
```

**Coverage policy:** CI fails below **75%** (lines/statements/functions/branches). Below **90%** emits a warning annotation only.

**Release:** git tag `vX.Y.Z` is the source of truth. The release workflow syncs `package.json` version from the tag, runs checks, then `npm publish`. Requires repo secret `NPM_TOKEN`.

### Docs

- [OPERATOR.md](docs/OPERATOR.md)
- [SECURITY.md](SECURITY.md)

## License

MIT
