# notion-bank MCP tools

End users install with `npx` / command only. No `CLIENT_ID` / `SECRET`.

## Setup

| Tool | Purpose |
|------|---------|
| `plan_status` | Auth + workspace readiness. Call first. |
| `plan_oauth_login` | Open browser OAuth (mcp.notion.com). Auto on first Notion tool if needed. |
| `plan_oauth_wait` | Finish pending login after browser approval (`wait=false` flow). |
| `plan_oauth_logout` | Clear local OAuth credentials. |
| `plan_configure` | Persist Plans root URL/UUID (+ optional services map). Ask user for root — never invent. |

## Hierarchy

```text
Plans root          ← plan_configure
  └── service page  ← plan_ensure_service
        └── plan    ← plan_upsert / plan_migrate
```

| Tool | Purpose |
|------|---------|
| `plan_ensure_service` | Ensure service page under Plans root |
| `plan_create_child` | Subpage under any parent id/URL (no configure required) |
| `plan_upsert` | Create/update plan from markdown string |
| `plan_migrate` | Upsert from local markdown file |
| `plan_get` | Addressable markdown with `L00N|` lines, TOC, etag |
| `plan_update_range` | Surgical edit by section or lines + `expected_etag` |
| `plan_search` | Search plan bank; hits include line + snippet |
| `plan_sync` | Export Notion plan → local markdown |

## Rules

- Prefer `plan_update_range` with section name after `plan_get`
- Always pass `expected_etag` from the latest `plan_get`
- Never invent page IDs
- Prefer service slugs from the configured map
