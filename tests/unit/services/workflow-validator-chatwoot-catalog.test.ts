import { describe, it, expect, vi } from 'vitest';
import { WorkflowValidator } from '@/services/workflow-validator';
import { EnhancedConfigValidator } from '@/services/enhanced-config-validator';
import { CHATWOOT_CATALOG_NODES, CHATWOOT_NODE_TYPES } from '@/integrations/chatwoot/chatwoot-node-catalog';

vi.mock('@/utils/logger', () => ({
  Logger: vi.fn().mockImplementation(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() })),
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

/**
 * The generic workflow validator (validate_workflow) with the Chatwoot catalog registered, as NodeRepository
 * returns rows (parseNodeRow shape). Checks INSIGHT-17: resources that the old catalog lacked, and the
 * Chatwoot Tool variant, are accepted.
 */
function repositoryWithCatalog() {
  const rows: Record<string, any> = {};
  for (const node of CHATWOOT_CATALOG_NODES) {
    rows[node.nodeType] = {
      nodeType: node.nodeType,
      displayName: node.displayName,
      package: node.packageName,
      isAITool: node.isAITool,
      isTrigger: node.isTrigger,
      isWebhook: node.isWebhook,
      isVersioned: node.isVersioned,
      isToolVariant: node.isToolVariant ?? false,
      toolVariantOf: node.toolVariantOf ?? null,
      hasToolVariant: node.hasToolVariant ?? false,
      version: node.version,
      properties: node.properties,
      operations: node.operations,
      credentials: node.credentials,
      outputs: node.outputs ?? null,
      isCommunity: true,
    };
  }
  rows['nodes-langchain.agent'] = {
    nodeType: 'nodes-langchain.agent',
    displayName: 'AI Agent',
    package: '@n8n/n8n-nodes-langchain',
    isAITool: false,
    isTrigger: false,
    isVersioned: true,
    version: '3.1',
    properties: [],
    operations: [],
    credentials: [],
  };
  rows['nodes-langchain.lmChatOpenAi'] = {
    nodeType: 'nodes-langchain.lmChatOpenAi',
    displayName: 'Chat Model',
    package: '@n8n/n8n-nodes-langchain',
    isAITool: false,
    isTrigger: false,
    isVersioned: false,
    version: '1',
    properties: [],
    operations: [],
    credentials: [],
    outputs: ['ai_languageModel'],
  };
  return {
    getNode: vi.fn((type: string) => rows[type] ?? null),
    findSimilarNodes: vi.fn().mockReturnValue([]),
    getAllNodes: vi.fn().mockReturnValue(Object.values(rows)),
  };
}

function chatwootNode(name: string, resource: string, operation: string, parameters: Record<string, unknown> = {}, type: string = CHATWOOT_NODE_TYPES.main) {
  return { id: name, name, type, typeVersion: 1, position: [470, 300] as [number, number], parameters: { resource, operation, ...parameters } };
}

const trigger = {
  id: 'trigger',
  name: 'Chatwoot Trigger',
  type: CHATWOOT_NODE_TYPES.trigger,
  typeVersion: 1,
  position: [250, 300] as [number, number],
  parameters: { events: ['message_created'] },
};

const chatModel = {
  id: 'model', name: 'Chat Model', type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
  typeVersion: 1, position: [500, 500] as [number, number], parameters: { modelName: 'gpt-4o-mini' },
};

describe('WorkflowValidator with the Chatwoot catalog', () => {
  it.each([
    { resource: 'company', operation: 'getAll' },
    { resource: 'appliedSla', operation: 'getAll' },
    { resource: 'slaPolicy', operation: 'getAll' },
    { resource: 'liveReport', operation: 'conversationMetrics' },
    { resource: 'summaryReport', operation: 'agent', parameters: { since: '2026-09-01T00:00:00Z', until: '2026-09-02T00:00:00Z' } },
    { resource: 'search', operation: 'searchAll', parameters: { query: 'customer' } },
    { resource: 'macro', operation: 'getAll' },
    { resource: 'notification', operation: 'getAll' },
    { resource: 'campaign', operation: 'getAll' },
    { resource: 'contactNote', operation: 'getAll', parameters: { contactId: 1 } },
    { resource: 'conversationParticipant', operation: 'getAll', parameters: { conversationId: 1 } },
    { resource: 'publicInbox', operation: 'get' },
  ])('validates the $resource / $operation parameters from the catalog', async ({ resource, operation, parameters }) => {
    const validator = new WorkflowValidator(repositoryWithCatalog() as any, EnhancedConfigValidator);
    const result = await validator.validateWorkflow({
      nodes: [trigger, chatwootNode('Chatwoot', resource, operation, parameters)],
      connections: { 'Chatwoot Trigger': { main: [[{ node: 'Chatwoot', type: 'main', index: 0 }]] } },
    } as any);

    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.warnings.find((w: any) => w.code === 'COMMUNITY_NODE_NOT_IN_CATALOG')).toBeUndefined();
  });

  it.each([
    { resource: 'notAChatwootResource', operation: 'getAll', field: 'resource' },
    { resource: 'company', operation: 'notAChatwootOperation', field: 'operation' },
    { resource: 'search', operation: 'searchAll', field: 'query' },
  ])('rejects an invalid or missing $field instead of skipping catalog validation', async ({ resource, operation, field }) => {
    const validator = new WorkflowValidator(repositoryWithCatalog() as any, EnhancedConfigValidator);
    const result = await validator.validateWorkflow({
      nodes: [trigger, chatwootNode('Chatwoot', resource, operation)],
      connections: { 'Chatwoot Trigger': { main: [[{ node: 'Chatwoot', type: 'main', index: 0 }]] } },
    } as any);

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.nodeName === 'Chatwoot' && error.message.toLowerCase().includes(field))).toBe(true);
  });

  it('rejects agent-bot-only events on the account webhook trigger', async () => {
    const validator = new WorkflowValidator(repositoryWithCatalog() as any, EnhancedConfigValidator);
    const result = await validator.validateWorkflow({
      nodes: [{ ...trigger, parameters: { source: 'accountWebhook', events: ['automation_event.message_created'] } }],
      connections: {},
    } as any);

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.nodeName === trigger.name && error.message.includes('automation_event.message_created'))).toBe(true);
  });

  it('accepts the Chatwoot Tool variant on an AI Agent tool input', async () => {
    const validator = new WorkflowValidator(repositoryWithCatalog() as any, EnhancedConfigValidator);
    const result = await validator.validateWorkflow({
      nodes: [
        trigger,
        { id: 'agent', name: 'AI Agent', type: '@n8n/n8n-nodes-langchain.agent', typeVersion: 3.1, position: [470, 300], parameters: {} },
        chatModel,
        chatwootNode('Reply', 'message', 'create', { conversationId: 1, content: 'Hello', toolDescription: 'Reply to a conversation' }, CHATWOOT_NODE_TYPES.tool),
      ],
      connections: {
        'Chatwoot Trigger': { main: [[{ node: 'AI Agent', type: 'main', index: 0 }]] },
        Reply: { ai_tool: [[{ node: 'AI Agent', type: 'ai_tool', index: 0 }]] },
        'Chat Model': { ai_languageModel: [[{ node: 'AI Agent', type: 'ai_languageModel', index: 0 }]] },
      },
    } as any);

    const codes = result.errors.map((e: any) => e.code);
    expect(codes).not.toContain('INVALID_AI_TOOL_SOURCE');
    expect(codes).not.toContain('WRONG_NODE_TYPE_FOR_AI_TOOL');
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.warnings.find((w: any) => w.code === 'INFERRED_TOOL_VARIANT')).toBeUndefined();
    expect(result.suggestions.join(' ')).not.toContain('N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE');
  });

  it('suggests the Tool variant when the base Chatwoot node is wired as a tool', async () => {
    const validator = new WorkflowValidator(repositoryWithCatalog() as any, EnhancedConfigValidator);
    const result = await validator.validateWorkflow({
      nodes: [
        trigger,
        { id: 'agent', name: 'AI Agent', type: '@n8n/n8n-nodes-langchain.agent', typeVersion: 3.1, position: [470, 300], parameters: {} },
        chatwootNode('Reply', 'message', 'create', { conversationId: 1, content: 'Hello' }),
      ],
      connections: {
        'Chatwoot Trigger': { main: [[{ node: 'AI Agent', type: 'main', index: 0 }]] },
        Reply: { ai_tool: [[{ node: 'AI Agent', type: 'ai_tool', index: 0 }]] },
      },
    } as any);

    const error = result.errors.find((e: any) => e.code === 'WRONG_NODE_TYPE_FOR_AI_TOOL');
    expect(error).toBeDefined();
    expect(error!.message).toContain('@renatoascencio/n8n-nodes-chatwoot.chatwootTool');
  });
});
