/** Injected into MCP initialize; hosts may add this to the agent system prompt. */
export const SERVER_INSTRUCTIONS = `You are connected to notion-bank-mcp.

End users installed with npx/command only. Do NOT ask for CLIENT_ID, CLIENT_SECRET, tokens, broker URLs, or npm serve.

SETUP:
1. plan_status
2. If no auth: plan_oauth_login OR any Notion tool — browser opens automatically
3. If no Plans root: ask only for their Plans root Notion page URL → plan_configure

WORKFLOW:
- plan_upsert / plan_migrate for full plans under Plans→service→plan
- plan_create_child(parent_page_id|url, title, markdown?) to create a subpage under any given page id
- plan_get (lines + etag) then plan_update_range for surgical edits
- Never invent page IDs or tokens
`;

export const WORKFLOW_DOC = `# notion-bank agent workflow

1. First Notion action → browser opens (automatic)
2. Ask for Plans root Notion URL → plan_configure
3. plan_upsert / plan_get / plan_update_range
4. Arbitrary parent: plan_create_child(parent_page_id, title)
`;
