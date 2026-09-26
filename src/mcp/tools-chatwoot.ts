import { ToolDefinition } from '../types';

/**
 * Chatwoot Integration Tools
 *
 * Diagnostic tools for the Chatwoot integration module.
 * Always available (not gated by n8n API configuration).
 */
export const chatwootTools: ToolDefinition[] = [
  {
    name: 'chatwoot_doctor',
    description: `Diagnose Chatwoot integration health. Checks: MCP server version, Docker detection, n8n API connectivity, Chatwoot credential presence and bundled catalog version (@renatoascencio/n8n-nodes-chatwoot), and bundled template parameters and known webhook payload paths. Credential presence does not verify package installation or the installed version. Warns about the n8n 3.0 unverified community package default. Optionally tests the Chatwoot Application (user or agent bot token), Platform and Public APIs. Tokens are redacted from diagnostic messages.`,
    inputSchema: {
      type: 'object',
      properties: {
        chatwootBaseUrl: {
          type: 'string',
          description: 'Optional: Chatwoot instance URL to test connectivity (e.g., https://app.chatwoot.com)',
        },
        chatwootAccountId: {
          type: 'string',
          description: 'Optional: Chatwoot account ID for Application API test',
        },
        chatwootToken: {
          type: 'string',
          description: 'Optional: Chatwoot API access token for the Application API test (will be masked in output)',
        },
        chatwootTokenType: {
          type: 'string',
          enum: ['user', 'agentBot'],
          description: 'Optional: kind of chatwootToken, "user" (default) or "agentBot" (agent bots cannot list conversations, so they are tested differently)',
        },
        chatwootPlatformToken: {
          type: 'string',
          description: 'Optional: Platform App access token to test the Platform API (will be masked in output)',
        },
        chatwootInboxIdentifier: {
          type: 'string',
          description: 'Optional: API channel inbox identifier to test the Public API',
        },
        verbose: {
          type: 'boolean',
          description: 'Include extended debug information, the capabilities summary and the installation guide (default: false)',
        },
      },
    },
    annotations: {
      title: 'Chatwoot Doctor',
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
];
