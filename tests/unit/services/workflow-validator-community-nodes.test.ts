import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkflowValidator } from '@/services/workflow-validator';

// Mock logger to prevent console output
vi.mock('@/utils/logger', () => ({
  Logger: vi.fn().mockImplementation(() => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn()
  }))
}));

describe('WorkflowValidator - Community Node Handling', () => {
  let validator: WorkflowValidator;

  const createMockRepository = (nodeData: Record<string, any>) => ({
    getNode: vi.fn((type: string) => nodeData[type] || null),
    findSimilarNodes: vi.fn().mockReturnValue([]),
    getAllNodes: vi.fn().mockReturnValue(Object.values(nodeData)),
  });

  const createMockValidatorClass = () => ({
    validateWithMode: vi.fn().mockReturnValue({
      valid: true,
      errors: [],
      warnings: [],
      suggestions: []
    })
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should emit warning (not error) for unknown community nodes', async () => {
    const mockRepository = createMockRepository({});
    validator = new WorkflowValidator(mockRepository as any, createMockValidatorClass() as any);

    const workflow = {
      name: 'Chatwoot Workflow',
      nodes: [
        {
          id: '1',
          name: 'Webhook',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 1,
          position: [250, 300] as [number, number],
          parameters: {}
        },
        {
          id: '2',
          name: 'Chatwoot',
          type: '@renatoascencio/n8n-nodes-chatwoot.chatwoot',
          typeVersion: 1,
          position: [470, 300] as [number, number],
          parameters: { resource: 'conversation', operation: 'getAll' }
        }
      ],
      connections: {
        'Webhook': { main: [[{ node: 'Chatwoot', type: 'main', index: 0 }]] }
      }
    };

    // Webhook won't be in mock DB either, so it'll also fail —
    // but Chatwoot should get a warning, not an error.
    const result = await validator.validateWorkflow(workflow as any);

    const communityWarning = result.warnings.find(
      (w: any) => w.message?.includes('@renatoascencio/n8n-nodes-chatwoot.chatwoot')
    );
    expect(communityWarning).toBeDefined();
    expect(communityWarning!.message).toContain('community node');

    // The community node should NOT produce an error
    const chatwootError = result.errors.find(
      (e: any) => e.message?.includes('@renatoascencio/n8n-nodes-chatwoot')
    );
    expect(chatwootError).toBeUndefined();
  });

  it('should still error for unknown non-community nodes', async () => {
    const mockRepository = createMockRepository({});
    validator = new WorkflowValidator(mockRepository as any, createMockValidatorClass() as any);

    const workflow = {
      name: 'Test Workflow',
      nodes: [
        {
          id: '1',
          name: 'Unknown',
          type: 'n8n-nodes-base.doesNotExist',
          position: [250, 300] as [number, number],
          parameters: {}
        }
      ],
      connections: {}
    };

    const result = await validator.validateWorkflow(workflow as any);

    expect(result.valid).toBe(false);
    const unknownError = result.errors.find(
      (e: any) => e.message?.includes('Unknown node type')
    );
    expect(unknownError).toBeDefined();
  });

  it('should treat bare node names (no dot) as unknown package, not community', async () => {
    const mockRepository = createMockRepository({});
    validator = new WorkflowValidator(mockRepository as any, createMockValidatorClass() as any);

    const workflow = {
      name: 'Test Workflow',
      nodes: [
        {
          id: '1',
          name: 'BadNode',
          type: 'justABareNodeName',
          position: [250, 300] as [number, number],
          parameters: {}
        }
      ],
      connections: {}
    };

    const result = await validator.validateWorkflow(workflow as any);

    // Should produce an error, not a community warning
    const communityWarning = result.warnings.find(
      (w: any) => w.code === 'COMMUNITY_NODE_NOT_IN_CATALOG'
    );
    expect(communityWarning).toBeUndefined();
    expect(result.valid).toBe(false);
  });

  it('should validate registered Chatwoot nodes normally (no warning)', async () => {
    const chatwootNodeData: Record<string, any> = {
      '@renatoascencio/n8n-nodes-chatwoot.chatwoot': {
        nodeType: '@renatoascencio/n8n-nodes-chatwoot.chatwoot',
        displayName: 'Chatwoot',
        version: 1,
        isVersioned: false,
        isCommunity: true,
        properties: [{ name: 'resource', type: 'options', options: [] }],
        credentials: [{ name: 'chatwootApi' }],
        operations: []
      },
      'n8n-nodes-base.webhook': {
        nodeType: 'n8n-nodes-base.webhook',
        displayName: 'Webhook',
        version: 1,
        isVersioned: true,
        properties: [],
        credentials: [],
        operations: []
      },
      // Also register short-form lookups
      'nodes-base.webhook': {
        nodeType: 'n8n-nodes-base.webhook',
        displayName: 'Webhook',
        version: 1,
        isVersioned: true,
        properties: [],
        credentials: [],
        operations: []
      }
    };

    const mockRepository = createMockRepository(chatwootNodeData);
    validator = new WorkflowValidator(mockRepository as any, createMockValidatorClass() as any);

    const workflow = {
      name: 'Chatwoot Workflow',
      nodes: [
        {
          id: '1',
          name: 'Webhook',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 1,
          position: [250, 300] as [number, number],
          parameters: {}
        },
        {
          id: '2',
          name: 'Chatwoot',
          type: '@renatoascencio/n8n-nodes-chatwoot.chatwoot',
          typeVersion: 1,
          position: [470, 300] as [number, number],
          parameters: { resource: 'conversation', operation: 'getAll' }
        }
      ],
      connections: {
        'Webhook': { main: [[{ node: 'Chatwoot', type: 'main', index: 0 }]] }
      }
    };

    const result = await validator.validateWorkflow(workflow as any);

    // No community-not-in-catalog warning since the node IS in the DB
    const communityWarning = result.warnings.find(
      (w: any) => w.code === 'COMMUNITY_NODE_NOT_IN_CATALOG'
    );
    expect(communityWarning).toBeUndefined();

    // No errors about unknown node type
    const unknownError = result.errors.find(
      (e: any) => e.message?.includes('Unknown node type') && e.message?.includes('chatwoot')
    );
    expect(unknownError).toBeUndefined();
  });
});
