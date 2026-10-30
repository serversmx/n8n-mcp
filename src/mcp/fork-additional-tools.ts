import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import type { AdditionalTool } from '../types/additional-tools';
import type { InstanceContext } from '../types/instance-context';
import { chatwootTools } from './tools-chatwoot';
import { n8nRestTools } from './tools-n8n-rest';
import { handleChatwootDoctor } from './handlers-chatwoot';
import {
  handleN8nLogin,
  handleN8nCreateFolder,
  handleN8nMoveWorkflow,
} from './handlers-n8n-rest';

/**
 * serversmx fork: Chatwoot and n8n internal REST tools.
 *
 * Registered through upstream's `additionalTools` seam instead of editing the
 * built-in tool lists in server.ts, so syncing with czlonkowski/n8n-mcp does not
 * conflict in the server's tool registry.
 */

function toTool(definition: unknown): Tool {
  return definition as Tool;
}

function textResult(payload: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

export function getForkAdditionalTools(): AdditionalTool[] {
  const tools: AdditionalTool[] = [];

  // Diagnostic, not gated by the n8n API configuration.
  for (const definition of chatwootTools) {
    tools.push({
      tool: toTool(definition),
      handler: async (args, context) =>
        textResult(await handleChatwootDoctor(args as Record<string, any>, context.instanceContext as InstanceContext | undefined)),
    });
  }

  // Cookies from /rest/login would leak across tenants, so these are not offered
  // (and their handlers refuse) in multi-tenant mode.
  if (process.env.ENABLE_MULTI_TENANT !== 'true') {
    const restHandlers: Record<string, (args: unknown) => Promise<CallToolResult>> = {
      n8n_login: handleN8nLogin as (args: unknown) => Promise<CallToolResult>,
      n8n_create_folder: handleN8nCreateFolder as (args: unknown) => Promise<CallToolResult>,
      n8n_move_workflow: handleN8nMoveWorkflow as (args: unknown) => Promise<CallToolResult>,
    };
    for (const definition of n8nRestTools) {
      const handler = restHandlers[definition.name];
      if (!handler) throw new Error(`No handler for n8n REST tool "${definition.name}"`);
      tools.push({ tool: toTool(definition), handler: args => handler(args) });
    }
  }

  return tools;
}
