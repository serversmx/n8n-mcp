import { ToolDefinition } from '../types';

/**
 * n8n internal REST API tools.
 *
 * These wrap `/rest/*` endpoints (the API used by the n8n UI). They use
 * cookie-based session auth obtained via `n8n_login`, NOT the public API key.
 *
 * IMPORTANT: `/rest/*` is undocumented and may change between n8n releases.
 * Cookies are stored in `~/.n8n-mcp/cookies/<hash>.json` with mode 0600.
 * Multi-tenant HTTP mode is refused (cookies would leak across tenants).
 */
export const n8nRestTools: ToolDefinition[] = [
  {
    name: 'n8n_login',
    description: 'Authenticate against the n8n internal REST API using email + password (plus mfaCode if the account has 2FA enabled). Saves the resulting session cookie to disk (~/.n8n-mcp/cookies/) for subsequent n8n_create_folder and n8n_move_workflow calls. Refused in multi-tenant mode.',
    inputSchema: {
      type: 'object',
      properties: {
        baseUrl: {
          type: 'string',
          description: 'n8n base URL (e.g. https://n8n.example.com). Do NOT include /api/v1 — the REST API lives at /rest/*.',
        },
        email: { type: 'string', description: 'Account email or LDAP login ID' },
        password: { type: 'string', description: 'Account password' },
        mfaCode: {
          type: 'string',
          description: 'Optional 6-digit TOTP code from your authenticator app. REQUIRED if the account has 2FA enabled (otherwise n8n returns HTTP 401 code 998 — MFA Error).',
        },
      },
      required: ['baseUrl', 'email', 'password'],
    },
  },
  {
    name: 'n8n_create_folder',
    description: 'Create a folder inside an n8n project. Uses the internal REST API (cookie auth). Run n8n_login first.',
    inputSchema: {
      type: 'object',
      properties: {
        baseUrl: { type: 'string', description: 'Same baseUrl used in n8n_login' },
        projectId: { type: 'string', description: 'Project ID that will contain the folder' },
        name: { type: 'string', description: 'Folder name' },
        parentFolderId: {
          type: ['string', 'null'],
          description: 'Optional parent folder ID. Omit or null to create at the project root.',
        },
      },
      required: ['baseUrl', 'projectId', 'name'],
    },
  },
  {
    name: 'n8n_move_workflow',
    description: 'Move a workflow into a folder (or to project root). Uses the internal REST API (cookie auth). Run n8n_login first.',
    inputSchema: {
      type: 'object',
      properties: {
        baseUrl: { type: 'string', description: 'Same baseUrl used in n8n_login' },
        workflowId: { type: 'string', description: 'Workflow ID to move' },
        parentFolderId: {
          type: ['string', 'null'],
          description: 'Destination folder ID. Pass null (sent to n8n as the root id "0") to move the workflow to the project root.',
        },
      },
      required: ['baseUrl', 'workflowId', 'parentFolderId'],
    },
  },
];
