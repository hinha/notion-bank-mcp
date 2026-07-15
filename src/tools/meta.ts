import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { NotionBankConfig } from "../config.js";
import { SERVER_INSTRUCTIONS, WORKFLOW_DOC } from "../instructions.js";
import { configPath, getConfigStatus, loadUserConfig } from "../user-config.js";

export function registerResources(
  server: McpServer,
  config: NotionBankConfig,
): void {
  server.registerResource(
    "workflow",
    "notion-bank://docs/workflow",
    {
      title: "Plan bank workflow",
      description:
        "How agents should set up and use notion-bank tools across Cursor/Claude/Codex/OpenCode",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "text/markdown",
          text: WORKFLOW_DOC,
        },
      ],
    }),
  );

  server.registerResource(
    "instructions",
    "notion-bank://docs/instructions",
    {
      title: "Server instructions",
      description: "Same text sent on MCP initialize",
      mimeType: "text/plain",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "text/plain",
          text: SERVER_INSTRUCTIONS,
        },
      ],
    }),
  );

  server.registerResource(
    "config",
    "notion-bank://config",
    {
      title: "Current user config",
      description:
        "Per-user workspace config + status (no secrets). Path from plan_status.",
      mimeType: "application/json",
    },
    async (uri) => {
      const { oauthAvailable } = await import("../oauth/login.js");
      const { getCredentialsPath, loadOAuthTokens } = await import(
        "../oauth/tokens.js"
      );
      const oauth = loadOAuthTokens();
      const avail = oauthAvailable();
      const status = getConfigStatus({
        hasNotionAuth: Boolean(config.notionToken),
        authSource: config.authSource,
        oauthAppConfigured: avail.ok,
        workspaceName: oauth?.workspace_name,
        credentialsPath: getCredentialsPath(),
      });
      let workspace: unknown = null;
      try {
        workspace = loadUserConfig();
      } catch (err) {
        workspace = {
          error: err instanceof Error ? err.message : String(err),
        };
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(
              {
                config_path: configPath(),
                credentials_path: getCredentialsPath(),
                status,
                workspace,
                oauth_workspace: oauth
                  ? {
                      workspace_id: oauth.workspace_id,
                      workspace_name: oauth.workspace_name,
                      bot_id: oauth.bot_id,
                      obtained_at: oauth.obtained_at,
                    }
                  : null,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "save-plan",
    {
      title: "Save plan to Notion",
      description:
        "Guided flow: ensure configured, then upsert a plan under a service",
      argsSchema: {
        service: z.string().describe("Service slug"),
        title: z.string().describe("Plan title"),
      },
    },
    async ({ service, title }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `Save/update a Notion plan via notion-bank.\n` +
              `1) Call plan_status. If not configured, ask me for my Plans root URL and call plan_configure.\n` +
              `2) Call plan_upsert with service=${JSON.stringify(service)}, title=${JSON.stringify(title)}, and full markdown of the plan from this chat.\n` +
              `3) Return the Notion URL.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "revise-section",
    {
      title: "Revise one plan section",
      description: "Guided flow: plan_get then plan_update_range with etag",
      argsSchema: {
        service: z.string().describe("Service slug"),
        title: z.string().describe("Plan title"),
        section: z.string().describe('Heading e.g. "## Risks"'),
      },
    },
    async ({ service, title, section }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `Revise one section of a plan via notion-bank.\n` +
              `1) plan_get(service=${JSON.stringify(service)}, title=${JSON.stringify(title)})\n` +
              `2) plan_update_range with section=${JSON.stringify(section)}, expected_etag from get, and new_markdown for that section.\n` +
              `3) Confirm with the new etag/url.`,
          },
        },
      ],
    }),
  );
}
