# Security

## Secrets must not live in this repository

Never commit:

- Notion tokens (`ntn_…`) or OAuth client secrets  
- GitHub PATs embedded in URLs  
- `credentials.json`, `.env`, or `oauth-pending.json`  
- Machine-local MCP configs under `.cursor/` with private paths that should not be shared  

End-user authentication uses browser OAuth against Notion’s hosted MCP. Tokens are stored under `~/.config/notion-bank/` on the user’s machine only.

## Reporting

If you believe a secret was committed to this repo, rotate the credential immediately and open an issue (without pasting the secret).
