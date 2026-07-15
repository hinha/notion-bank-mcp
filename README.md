# notion-bank-mcp

**Plan-bank MCP for AI agents and Notion.**  
Agents read and write Markdown implementation plans with **line + section addressing** — no ad-hoc temp scripts.

OAuth via [mcp.notion.com](https://mcp.notion.com) (browser) · zero `CLIENT_ID` / `SECRET` for end users · stdio install like other MCP servers

[![license](https://img.shields.io/github/license/hinha/notion-bank-mcp)](LICENSE)
[![node](https://img.shields.io/node/v/notion-bank-mcp)](package.json)

```bash
npx -y notion-bank-mcp
```

---

**Contents:** [Setup](#how-do-i-set-up-notion-bank-mcp) · [Flow](#what-does-the-agent-flow-look-like) · [Tools](#what-tools-are-available) · [Config](#where-is-configuration-stored) · [Security](#what-about-secrets-and-security) · [Operator](#optional-hosted-url) · [FAQ](#faq)

## How does notion-bank-mcp compare?

| Feature | notion-bank-mcp | Hosted Notion MCP (`mcp.notion.com`) |
|---|---|---|
| **Focus** | Plan bank: hierarchy, migrate, surgical section edits | General workspace tools |
| **Content format** | Markdown + line numbers / TOC / etag | Enhanced markdown tools |
| **Install for users** | `npx` / `command` (stdio) | MCP `url` |
| **User secrets in mcp.json** | ❌ None | ❌ None (host OAuth) |
| **`plan_update_range` + etag** | ✅ | ❌ (generic update tools) |

## How do I set up notion-bank-mcp?

### Cursor / Claude / Windsurf / Codex

Add to your MCP config (no env tokens required):

```json
{
  "mcpServers": {
    "notion-bank": {
      "command": "npx",
      "args": ["-y", "notion-bank-mcp"]
    }
  }
}
```

**Cursor:** `.cursor/mcp.json` or Settings → MCP  
**Claude Desktop:** `claude_desktop_config.json`  
**Windsurf:** MCP config JSON  

From a local clone (before publishing to npm):

```json
{
  "mcpServers": {
    "notion-bank": {
      "command": "npx",
      "args": [
        "-y",
        "--package=/absolute/path/to/notion-bank-mcp",
        "notion-bank-mcp"
      ]
    }
  }
}
```

Or:

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

(`npm install && npm run build` first for the `node dist` form.)

### First-time use

1. Enable the MCP in your client  
2. On the first Notion action, a **browser** opens → sign in with Notion (`mcp.notion.com`)  
3. Tell the agent your **Plans root** Notion page URL once → it runs `plan_configure`  
4. Use `plan_upsert` / `plan_get` / `plan_update_range` as usual  

## What does the agent flow look like?

```text
npx notion-bank-mcp  (Cursor starts stdio)
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

Suggested hierarchy:

```text
Plans / Superpowers          ← root (plan_configure)
  └── <Service>              ← plan_ensure_service
        └── <Plan title>     ← plan_upsert / plan_migrate
```

## What tools are available?

| Tool | Purpose |
|------|---------|
| `plan_status` | Auth + workspace readiness |
| `plan_oauth_login` / `plan_oauth_wait` / `plan_oauth_logout` | Browser OAuth lifecycle |
| `plan_configure` | Persist Plans root (+ optional service map) |
| `plan_ensure_service` | Ensure service page under root |
| `plan_upsert` / `plan_migrate` | Create/update plan from markdown or file |
| `plan_get` | Read with optional `L00N\|` lines, TOC, etag |
| `plan_update_range` | Surgical edit by section / lines + `expected_etag` |
| `plan_search` | Search with line hits |
| `plan_sync` | Export Notion plan → local markdown |

## Where is configuration stored?

All of this is **outside the git repo** (per user / machine):

| Path | Contents |
|------|----------|
| `~/.config/notion-bank/config.json` | Plans root + service map |
| `~/.config/notion-bank/credentials.json` | OAuth access / refresh tokens |
| `~/.config/notion-bank/oauth-pending.json` | Short-lived login state (auto-cleared) |

Overrides (optional): `NOTION_BANK_CONFIG_PATH`, `NOTION_BANK_CREDENTIALS_PATH`, `XDG_CONFIG_HOME`.

## What about secrets and security?

- **Do not** put Notion tokens, OAuth client secrets, or PATs in this repository or in committed `mcp.json`.  
- End-user auth is browser OAuth against Notion’s hosted MCP (`mcp.notion.com`) using Dynamic Client Registration — **no** `CLIENT_ID` / `CLIENT_SECRET` in user config.  
- Tokens live only under `~/.config/notion-bank/` with restrictive file modes where possible.  
- `.env` is gitignored; `.env.example` documents optional non-secret host knobs only.  
- Prefer OS credential helpers / `gh auth login` for GitHub — avoid embedding tokens in `git remote` URLs.

## Optional hosted URL

For teams that want `"url": "https://host/mcp"` instead of stdio, operators can run `npm run serve`. Details: [docs/OPERATOR.md](docs/OPERATOR.md). **Not** required for normal users.

## Development

```bash
git clone https://github.com/hinha/notion-bank-mcp.git
cd notion-bank-mcp
npm install
npm run build
npm test
npm run stdio    # or: node dist/index.js
```

## FAQ

### Do I need a Notion internal integration token?

No for the default path. Browser OAuth is enough.

### Why did `127.0.0.1` refuse the connection during login?

Some MCP hosts restart the stdio process right after a tool returns. This server persists pending OAuth to disk and re-binds the callback on process start. Retry `plan_oauth_login` if needed and keep the client open until you see “notion-bank connected”.

### Can I share one config across machines via git?

No — keep `~/.config/notion-bank/` private. Each user (or machine) runs OAuth + `plan_configure` once.

## License

MIT — see [LICENSE](LICENSE).
