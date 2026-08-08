---
name: notion-bank
description: >-
  Notion plan-bank documentation hub via notion-bank MCP. Creates and revises
  implementation plans under Plans → service → plan, with surgical section edits.
  Use when documenting services in Notion, creating or updating implementation
  plans, or when the user invokes /notion-bank. Chains superpowers (brainstorming,
  writing-plans) and optimize-goal when applicable; does not use health goal-analyzer.
allowed-tools: plan_status, plan_oauth_login, plan_oauth_wait, plan_oauth_logout, plan_configure, plan_ensure_service, plan_create_child, plan_migrate, plan_upsert, plan_get, plan_search, plan_update_range, plan_sync
---

# Notion Bank — Documentation Hub

Use **notion-bank MCP** to keep implementation plans and service documentation in
Notion. MCP tools are the only I/O to Notion; this skill teaches *when* and *how*
to call them and when to chain other skills first.

## When to Use

- User invokes `/notion-bank`
- Create or revise an implementation plan that should live in Notion
- Document a hinha service (or any service under the Plans root)
- Surgical section edits to an existing Notion plan
- Migrate local markdown into the plan bank

## Prerequisites

- notion-bank MCP is connected in the host (Cursor / Claude / Codex / etc.)
- **Never** ask for `CLIENT_ID`, `CLIENT_SECRET`, Notion tokens, broker URLs, or `npm serve`
- End-user auth is browser OAuth via mcp.notion.com (automatic)

## Setup Gate (always first)

1. Call `plan_status`
2. If no auth: `plan_oauth_login` (or any Notion tool — browser opens automatically)
3. If no Plans root: ask **only** for the user's Plans root Notion page URL → `plan_configure`
4. Never invent page IDs or tokens

See [references/mcp-tools.md](references/mcp-tools.md) for the full tool cheat sheet.

## Skill Chaining (conditional — not a fixed pipeline)

Read [references/chaining.md](references/chaining.md). Summary:

| Situation | Chain |
|-----------|--------|
| New / ambiguous feature or plan | `superpowers:brainstorming` → `superpowers:writing-plans`, then Notion write |
| Existing `goal.md` for Claude `/goal` | `optimize-goal` (tighten file first), then Notion write |
| Docs-only revise of a known plan | Skip brainstorming; use engineering checklist + Notion tools |
| Health / fitness goals | **Do not** invoke health `goal-analyzer` — out of scope |

Always run the **engineering goal checklist** in
[references/engineering-goals.md](references/engineering-goals.md) before writing.

## Write Path

**Full create / replace:**

1. `plan_ensure_service` if the service page may be missing
2. `plan_upsert` (markdown string) or `plan_migrate` (local file)
3. Return the Notion page URL

**Surgical edit:**

1. `plan_get` (numbered lines + TOC + etag)
2. `plan_update_range` with `expected_etag` and section or line range
3. Return the Notion page URL

**Arbitrary child page** (outside Plans→service→plan): `plan_create_child(parent_page_id|url, title, markdown?)`

## Response Contract

When done, always include:

1. What changed (create vs section update)
2. Service + plan title
3. **Notion URL** (required)

## Anti-Patterns

- Inventing Notion page IDs or service map entries
- Asking the user for OAuth client secrets or integration tokens
- Using raw Notion update tools when `plan_*` covers the job
- Invoking health `goal-analyzer` for engineering documentation
- Skipping `expected_etag` on `plan_update_range`
