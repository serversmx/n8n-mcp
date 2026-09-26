import { describe, it, expect, vi } from 'vitest';
import {
  CHATWOOT_AGENT_BOT_ONLY_EVENTS,
  CHATWOOT_CATALOG_NODES,
  CHATWOOT_CREDENTIALS,
  CHATWOOT_NODE_TYPES,
  CHATWOOT_OPERATIONS,
  CHATWOOT_OPERATION_COUNT,
  CHATWOOT_PACKAGE_NAME,
  CHATWOOT_PACKAGE_VERSION,
  CHATWOOT_RESOURCES,
  CHATWOOT_RESOURCE_VALUES,
  CHATWOOT_TRIGGER_EVENTS,
  CHATWOOT_TRIGGER_FILTERS,
  CHATWOOT_TRIGGER_MANUAL_EVENTS,
  CHATWOOT_TRIGGER_OPTIONS,
  CHATWOOT_TRIGGER_SOURCES,
  CHATWOOT_USABLE_AS_TOOL,
  CHATWOOT_WEBHOOK_PAYLOADS,
  getChatwootDefaultOperation,
  getChatwootOperationParameters,
  registerChatwootNodes,
} from '@/integrations/chatwoot/chatwoot-node-catalog';
import type { ChatwootNodeSnapshot } from '@/integrations/chatwoot/chatwoot-node-catalog';
import snapshotJson from '@/integrations/chatwoot/chatwoot-node-snapshot.json';

const snapshot = snapshotJson as unknown as ChatwootNodeSnapshot;

/** Chatwoot 4.18.0 app/models/webhook.rb ALLOWED_WEBHOOK_EVENTS (same list in 4.13.0) */
const CHATWOOT_ALLOWED_WEBHOOK_EVENTS = [
  'conversation_status_changed', 'conversation_updated', 'conversation_created', 'contact_created',
  'contact_updated', 'message_created', 'message_updated', 'webwidget_triggered', 'inbox_created',
  'inbox_updated', 'conversation_typing_on', 'conversation_typing_off',
];

/** Resources of @renatoascencio/n8n-nodes-chatwoot 0.9.0 (Chatwoot.node.ts resource options) */
const V090_RESOURCES = {
  application: [
    'account', 'agent', 'agentBot', 'appliedSla', 'auditLog', 'automationRule', 'campaign', 'cannedResponse',
    'company', 'contact', 'contactNote', 'conversation', 'conversationParticipant', 'csatSurvey',
    'customAttribute', 'customFilter', 'helpCenter', 'inbox', 'integration', 'label', 'liveReport', 'macro',
    'message', 'notification', 'profile', 'report', 'search', 'slaPolicy', 'summaryReport', 'team', 'webhook',
  ],
  platform: ['platformAccount', 'accountAgentBot', 'accountUser', 'platformUser'],
  public: ['publicContact', 'publicConversation', 'publicInbox', 'publicMessage'],
};

const main = () => CHATWOOT_CATALOG_NODES.find((n) => n.nodeType === CHATWOOT_NODE_TYPES.main)!;
const tool = () => CHATWOOT_CATALOG_NODES.find((n) => n.nodeType === CHATWOOT_NODE_TYPES.tool)!;
const trigger = () => CHATWOOT_CATALOG_NODES.find((n) => n.nodeType === CHATWOOT_NODE_TYPES.trigger)!;

describe('Chatwoot Node Catalog', () => {
  describe('snapshot', () => {
    it('is generated from @renatoascencio/n8n-nodes-chatwoot 0.9.0', () => {
      expect(CHATWOOT_PACKAGE_NAME).toBe('@renatoascencio/n8n-nodes-chatwoot');
      expect(CHATWOOT_PACKAGE_VERSION).toBe('0.9.0');
      expect(snapshot.nodes.map((n) => n.nodeType)).toEqual([
        '@renatoascencio/n8n-nodes-chatwoot.chatwoot',
        '@renatoascencio/n8n-nodes-chatwoot.chatwootTrigger',
      ]);
      expect(snapshot.credentials.map((c) => c.name)).toEqual([
        'chatwootApi', 'chatwootPlatformApi', 'chatwootPublicApi',
      ]);
    });
  });

  describe('CHATWOOT_CATALOG_NODES', () => {
    it('contains the main node, its AI tool variant and the trigger', () => {
      expect(CHATWOOT_CATALOG_NODES.map((n) => n.nodeType)).toEqual([
        '@renatoascencio/n8n-nodes-chatwoot.chatwoot',
        '@renatoascencio/n8n-nodes-chatwoot.chatwootTool',
        '@renatoascencio/n8n-nodes-chatwoot.chatwootTrigger',
      ]);
    });

    it('should define the main Chatwoot node correctly', () => {
      const node = main();
      expect(node.displayName).toBe('Chatwoot');
      expect(node.isCommunity).toBe(true);
      expect(node.isVerified).toBe(false);
      expect(node.isTrigger).toBe(false);
      expect(node.isWebhook).toBe(false);
      expect(node.style).toBe('programmatic');
      expect(node.category).toBe('Communication');
      expect(node.version).toBe('1');
      expect(node.npmPackageName).toBe('@renatoascencio/n8n-nodes-chatwoot');
      expect(node.npmVersion).toBe('0.9.0');
      expect(node.authorName).toBe('Renato Ascencio');
      expect(node.authorGithubUrl).toBe('https://github.com/RenatoAscencio');
      expect(node.credentials).toHaveLength(3);
    });

    it('marks the main node as usable as an AI tool (usableAsTool)', () => {
      expect(CHATWOOT_USABLE_AS_TOOL).toBe(true);
      expect(main().isAITool).toBe(true);
      expect(main().hasToolVariant).toBe(true);
    });

    it('registers the Tool variant n8n creates for AI Agents', () => {
      const variant = tool();
      expect(variant.displayName).toBe('Chatwoot Tool');
      expect(variant.isToolVariant).toBe(true);
      expect(variant.toolVariantOf).toBe(CHATWOOT_NODE_TYPES.main);
      expect(variant.isAITool).toBe(true);
      expect(variant.outputs).toEqual([{ type: 'ai_tool', displayName: 'Tool' }]);
      expect(variant.properties[0].name).toBe('toolDescription');
      expect(variant.properties.length).toBe(main().properties.length + 1);
      expect(variant.isCommunity).toBe(true);
      expect(variant.npmPackageName).toBe(CHATWOOT_PACKAGE_NAME);
    });

    it('should define the trigger node correctly (never an AI tool)', () => {
      const node = trigger();
      expect(node.displayName).toBe('Chatwoot Trigger');
      expect(node.isCommunity).toBe(true);
      expect(node.isTrigger).toBe(true);
      expect(node.isWebhook).toBe(true);
      expect(node.isAITool).toBe(false);
      expect(node.hasToolVariant).toBe(false);
      expect(node.credentials).toHaveLength(1);
      expect(node.credentials[0]).toMatchObject({
        name: 'chatwootApi',
        displayOptions: { show: { source: ['accountWebhook'] } },
      });
    });

    it('stores the full node properties, not only the resource', () => {
      const names = new Set(main().properties.map((p: any) => p.name));
      for (const name of ['resource', 'operation', 'conversationId', 'content', 'options', 'additionalFields', 'assignmentType']) {
        expect(names.has(name)).toBe(true);
      }
      const resourceProp = main().properties.find((p: any) => p.name === 'resource');
      expect(resourceProp.options.map((o: any) => o.value)).toEqual(CHATWOOT_RESOURCE_VALUES);
    });

    it('documents every resource and every trigger event', () => {
      for (const resource of CHATWOOT_RESOURCE_VALUES) {
        expect(main().documentation).toContain(`(\`${resource}\`)`);
      }
      for (const event of CHATWOOT_TRIGGER_MANUAL_EVENTS) {
        expect(trigger().documentation).toContain(`\`${event}\``);
      }
      expect(trigger().documentation).toContain('$json.name');
      expect(trigger().documentation).toContain('$json.conversation.id');
    });
  });

  describe('resources and operations', () => {
    it('lists every v0.9.0 resource with its API', () => {
      expect(CHATWOOT_RESOURCES).toHaveLength(39);
      for (const [api, resources] of Object.entries(V090_RESOURCES)) {
        expect(CHATWOOT_RESOURCES.filter((r) => r.api === api).map((r) => r.value).sort()).toEqual([...resources].sort());
      }
    });

    it('includes the resources the old hand-written catalog was missing', () => {
      for (const resource of [
        'appliedSla', 'campaign', 'company', 'contactNote', 'conversationParticipant', 'liveReport', 'macro',
        'notification', 'search', 'slaPolicy', 'summaryReport', 'publicInbox',
      ]) {
        expect(CHATWOOT_RESOURCE_VALUES).toContain(resource);
      }
    });

    it('maps each resource to the credential the node shows for it', () => {
      const credentialByApi = { application: 'chatwootApi', platform: 'chatwootPlatformApi', public: 'chatwootPublicApi' };
      for (const resource of CHATWOOT_RESOURCES) {
        expect(resource.credential).toBe(credentialByApi[resource.api]);
      }
      // Each resource is shown for exactly one credential (chatwootApi is not required for Platform/Public)
      const shown = main().credentials.flatMap((c: any) => c.displayOptions.show.resource);
      expect([...shown].sort()).toEqual([...CHATWOOT_RESOURCE_VALUES].sort());
    });

    it('lists every operation of every resource', () => {
      const fromProperties = main()
        .properties.filter((p: any) => p.name === 'operation')
        .flatMap((p: any) => p.options.map((o: any) => `${p.displayOptions.show.resource[0]}.${o.value}`));
      const fromCatalog = Object.entries(CHATWOOT_OPERATIONS).flatMap(([resource, ops]) =>
        ops.map((op) => `${resource}.${op.value}`),
      );
      expect([...fromCatalog].sort()).toEqual([...fromProperties].sort());
      expect(CHATWOOT_OPERATION_COUNT).toBe(fromCatalog.length);
      // Independent release invariant: comparing catalog to snapshot alone would also pass
      // if generation silently dropped the same operation from both derived views.
      expect(CHATWOOT_OPERATION_COUNT).toBe(269);
      for (const resource of CHATWOOT_RESOURCE_VALUES) {
        expect(CHATWOOT_OPERATIONS[resource].length).toBeGreaterThan(0);
      }
    });

    it('exposes the operations used by the templates and common workflows', () => {
      const has = (resource: string, operation: string) =>
        CHATWOOT_OPERATIONS[resource].some((op) => op.value === operation);
      expect(has('conversation', 'assign')).toBe(true);
      expect(has('conversation', 'updateStatus')).toBe(true);
      expect(has('message', 'create')).toBe(true);
      expect(has('contact', 'findByWhatsApp')).toBe(true);
      expect(has('publicContact', 'create')).toBe(true);
      expect(has('publicInbox', 'get')).toBe(true);
      expect(has('liveReport', 'conversationMetrics')).toBe(true);
    });

    it('returns the default operation of a resource', () => {
      expect(getChatwootDefaultOperation('message')).toBe('create');
      expect(getChatwootDefaultOperation('conversation')).toBe('getAll');
    });
  });

  describe('getChatwootOperationParameters', () => {
    it('returns the real parameter names of message > create', () => {
      const params = getChatwootOperationParameters('message', 'create')!;
      expect(params.map((p) => p.name)).toEqual(['conversationId', 'content', 'options']);
      const options = params.find((p) => p.name === 'options')!;
      expect(options.fields!.map((f) => f.name)).toEqual(expect.arrayContaining(['message_type', 'private', 'template_params']));
      expect(params.find((p) => p.name === 'conversationId')!.required).toBe(true);
    });

    it('returns additionalFields for publicContact > create (name/email are not top-level)', () => {
      const params = getChatwootOperationParameters('publicContact', 'create')!;
      expect(params.map((p) => p.name)).toEqual(['additionalFields']);
      expect(params[0].fields!.map((f) => f.name)).toEqual(expect.arrayContaining(['name', 'email', 'identifier']));
    });

    it('returns conditional parameters with their conditions', () => {
      const params = getChatwootOperationParameters('conversation', 'assign')!;
      expect(params.find((p) => p.name === 'assignmentType')!.values).toEqual(
        expect.arrayContaining(['agent', 'agentBot', 'team', 'unassign']),
      );
      expect(params.find((p) => p.name === 'assigneeId')!.showWhen).toEqual({ assignmentType: ['agent'] });
      expect(params.find((p) => p.name === 'assigneeId')!.dynamicOptions).toBe(true);
    });

    it('preserves nested fixedCollection fields and their activation condition', () => {
      const params = getChatwootOperationParameters('publicMessage', 'update')!;
      const form = params.find((p) => p.name === 'formValues')!;
      expect(form.type).toBe('fixedCollection');
      expect(form.showWhen).toEqual({ responseType: ['form'] });
      expect(form.fields).toHaveLength(1);
      expect(form.fields![0].name).toBe('values');
      expect(form.fields![0].fields!.map((field) => field.name)).toEqual(['name', 'value']);
    });

    it('retains conditions for saved report entity IDs and compatibility output options', () => {
      const reportParams = getChatwootOperationParameters('report', 'timeseries')!;
      const entityId = reportParams.find((param) => param.name === 'entityId')!;
      expect(entityId.required).toBe(true);
      expect(entityId.showWhen).toEqual({ type: ['agent', 'inbox', 'label', 'team'] });
      expect(entityId.hideWhen).toEqual({ '/options.id': [{ _cnd: { exists: true } }] });
      expect(getChatwootOperationParameters('webhook', 'getAll')).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'simplifyOutput', type: 'boolean', default: false }),
      ]));
      expect(CHATWOOT_OPERATIONS.contact.map((operation) => operation.value)).toContain('appendLabels');
      expect(CHATWOOT_OPERATIONS.conversation.map((operation) => operation.value)).toEqual(
        expect.arrayContaining(['appendLabels', 'removeLabels']),
      );
    });

    it('honours hide rules and rejects unknown operations', () => {
      expect(getChatwootOperationParameters('integration', 'updateHook')!.map((p) => p.name)).not.toContain('appId');
      expect(getChatwootOperationParameters('message', 'nope')).toBeUndefined();
      expect(getChatwootOperationParameters('nope', 'create')).toBeUndefined();
    });
  });

  describe('trigger', () => {
    it('lists exactly the events Chatwoot accepts for account webhooks', () => {
      expect([...CHATWOOT_TRIGGER_EVENTS].sort()).toEqual([...CHATWOOT_ALLOWED_WEBHOOK_EVENTS].sort());
      expect(CHATWOOT_TRIGGER_EVENTS).not.toContain('conversation_assignee_changed');
      expect(CHATWOOT_TRIGGER_EVENTS).not.toContain('conversation_team_changed');
      expect(CHATWOOT_TRIGGER_EVENTS).toContain('conversation_typing_on');
      expect(CHATWOOT_TRIGGER_EVENTS).toContain('inbox_updated');
    });

    it('lists the manual (agent bot / API channel) events', () => {
      expect(CHATWOOT_TRIGGER_SOURCES).toEqual(['accountWebhook', 'manual']);
      expect([...CHATWOOT_AGENT_BOT_ONLY_EVENTS].sort()).toEqual(['conversation_opened', 'conversation_resolved']);
      expect([...CHATWOOT_TRIGGER_MANUAL_EVENTS].sort()).toEqual(
        [...CHATWOOT_ALLOWED_WEBHOOK_EVENTS, 'conversation_opened', 'conversation_resolved'].sort(),
      );
    });

    it('lists the trigger filters and options', () => {
      expect([...CHATWOOT_TRIGGER_FILTERS].sort()).toEqual([
        'ignoreUserIds', 'ignoreWhatsAppEchoes', 'inboxIds', 'messageTypes', 'privateNotes', 'senderTypes',
      ]);
      expect([...CHATWOOT_TRIGGER_OPTIONS].sort()).toEqual([
        'includeDeliveryInfo', 'includeRawBody', 'includeRawBodyText', 'redactChannelSecrets', 'signatureTolerance', 'verifySignature',
      ]);
      const events = trigger().properties.find((p: any) => p.name === 'events');
      expect(events.options.map((o: any) => o.value)).toEqual(CHATWOOT_TRIGGER_EVENTS);
    });
  });

  describe('webhook payloads (Chatwoot 4.18)', () => {
    it('has a payload for every event the trigger can receive', () => {
      for (const event of CHATWOOT_TRIGGER_MANUAL_EVENTS) {
        expect(CHATWOOT_WEBHOOK_PAYLOADS[event]).toBeDefined();
        expect(CHATWOOT_WEBHOOK_PAYLOADS[event].event).toBe(true);
      }
    });

    it('describes contact events as the flat contact (no contact wrapper)', () => {
      const payload = CHATWOOT_WEBHOOK_PAYLOADS.contact_created;
      for (const key of ['id', 'name', 'email', 'phone_number', 'identifier', 'custom_attributes']) {
        expect(payload[key]).toBeDefined();
      }
      expect(payload.contact).toBeUndefined();
      expect(CHATWOOT_WEBHOOK_PAYLOADS.contact_updated.changed_attributes).toBe(true);
    });

    it('describes conversation events as the flat conversation (id = display id)', () => {
      const payload = CHATWOOT_WEBHOOK_PAYLOADS.conversation_created;
      expect(payload.id).toBe(true);
      expect(payload.conversation).toBeUndefined();
      expect(payload.meta).toMatchObject({ sender: true, assignee: true, team: true });
      expect(CHATWOOT_WEBHOOK_PAYLOADS.conversation_updated.changed_attributes).toBe(true);
    });

    it('nests the conversation in message and typing events', () => {
      expect((CHATWOOT_WEBHOOK_PAYLOADS.message_created.conversation as any).id).toBe(true);
      expect(CHATWOOT_WEBHOOK_PAYLOADS.message_created.message_type).toBe(true);
      expect(CHATWOOT_WEBHOOK_PAYLOADS.message_created.source_id).toBe(true);
      expect((CHATWOOT_WEBHOOK_PAYLOADS.conversation_typing_on.conversation as any).id).toBe(true);
      expect(CHATWOOT_WEBHOOK_PAYLOADS.conversation_typing_on.is_private).toBe(true);
    });

    it('describes inbox events without an inbox id', () => {
      expect(CHATWOOT_WEBHOOK_PAYLOADS.inbox_created.id).toBeUndefined();
      expect(CHATWOOT_WEBHOOK_PAYLOADS.inbox_created.channel).toBe(true);
    });
  });

  describe('credentials', () => {
    it('lists the credential fields of each API', () => {
      const fields = Object.fromEntries(
        CHATWOOT_CREDENTIALS.map((c) => [c.name, c.properties.filter((p) => p.type !== 'notice').map((p) => p.name)]),
      );
      expect(fields).toEqual({
        chatwootApi: ['baseUrl', 'accountId', 'apiAccessToken', 'tokenType'],
        chatwootPlatformApi: ['baseUrl', 'apiAccessToken'],
        chatwootPublicApi: ['baseUrl', 'inboxIdentifier', 'hmacToken'],
      });
    });

    it('never stores secret defaults', () => {
      const secrets = CHATWOOT_CREDENTIALS.flatMap((credential) => credential.properties
        .filter((prop) => ['apiAccessToken', 'hmacToken'].includes(prop.name))
        .map((prop) => [`${credential.name}.${prop.name}`, prop.default]));
      expect(secrets).toEqual([
        ['chatwootApi.apiAccessToken', ''],
        ['chatwootPlatformApi.apiAccessToken', ''],
        ['chatwootPublicApi.hmacToken', ''],
      ]);
    });
  });

  describe('registerChatwootNodes', () => {
    it('should call saveNode for each catalog entry and return count', () => {
      const mockRepository = {
        saveNode: vi.fn(),
      };

      const count = registerChatwootNodes(mockRepository as any);

      expect(count).toBe(3);
      expect(mockRepository.saveNode).toHaveBeenCalledTimes(3);
      expect(mockRepository.saveNode.mock.calls.map((call) => call[0].nodeType)).toEqual([
        CHATWOOT_NODE_TYPES.main,
        CHATWOOT_NODE_TYPES.tool,
        CHATWOOT_NODE_TYPES.trigger,
      ]);
    });

    it('should pass full node definitions to saveNode', () => {
      const mockRepository = {
        saveNode: vi.fn(),
      };

      registerChatwootNodes(mockRepository as any);

      const firstCall = mockRepository.saveNode.mock.calls[0][0];
      expect(firstCall.nodeType).toContain('chatwoot');
      expect(firstCall.isCommunity).toBe(true);
      expect(firstCall.packageName).toBe('@renatoascencio/n8n-nodes-chatwoot');
      expect(firstCall.operations.length).toBe(CHATWOOT_OPERATION_COUNT);
      expect(firstCall).not.toHaveProperty('usableAsTool');
    });
  });
});
