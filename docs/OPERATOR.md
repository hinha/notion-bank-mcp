# Operator notes (optional)

End users install with `npx` only — see the root [README](../README.md). They never run this file’s commands.

## Hosted URL mode (optional)

If you want clients to connect with `{ "url": "https://your-host/mcp" }`:

```bash
NOTION_BANK_PUBLIC_URL=https://your-host.example.com \
NOTION_BANK_HOST=0.0.0.0 \
npm run serve
```

Auth still uses Notion’s hosted MCP (`mcp.notion.com`) via Dynamic Client Registration. Do **not** put Notion `CLIENT_ID` / `CLIENT_SECRET` or user tokens in the git repo.

Session data is written under `~/.config/notion-bank/server/` on the host machine (not in the project tree).

## Security checklist

- Never commit `.env`, credentials, or OAuth pending files
- Prefer `gh auth` / SSH for git remotes (avoid embedding PATs in `remote.origin.url`)
- Treat `~/.config/notion-bank/` as private per-user storage
