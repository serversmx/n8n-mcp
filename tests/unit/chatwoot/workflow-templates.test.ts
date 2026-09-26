import { describe, it, expect } from 'vitest';
import { runInNewContext } from 'node:vm';
import { CHATWOOT_WORKFLOW_TEMPLATES } from '@/integrations/chatwoot/workflow-templates';
import {
  getChatwootTriggerEvents,
  getChatwootTriggerOutputShape,
  validateChatwootWorkflow,
} from '@/integrations/chatwoot/template-validator';
import { CHATWOOT_NODE_TYPES } from '@/integrations/chatwoot/chatwoot-node-catalog';

const MAIN = CHATWOOT_NODE_TYPES.main;
const TOOL = CHATWOOT_NODE_TYPES.tool;
const TRIGGER = CHATWOOT_NODE_TYPES.trigger;
const CREDS = { chatwootApi: { id: '', name: 'Chatwoot API' } };

const template = (id: string) => CHATWOOT_WORKFLOW_TEMPLATES.find((t) => t.id === id)!;
const nodes = (id: string) => (template(id).workflow as any).nodes as any[];
const node = (id: string, name: string) => nodes(id).find((n) => n.name === name);
const messages = (workflow: Record<string, unknown>) => validateChatwootWorkflow(workflow as any).map((i) => i.message);

/** Chatwoot Trigger followed by a Set node that reads `expression` */
function triggerThenSet(events: string[], expression: string, extra: Record<string, unknown> = {}) {
  return {
    nodes: [
      { name: 'Chatwoot Trigger', type: TRIGGER, parameters: { events, ...extra }, credentials: CREDS },
      { name: 'Set', type: 'n8n-nodes-base.set', parameters: { value: expression } },
    ],
    connections: { 'Chatwoot Trigger': { main: [[{ node: 'Set', type: 'main', index: 0 }]] } },
  };
}

describe('Chatwoot workflow templates', () => {
  it('have unique ids', () => {
    const ids = CHATWOOT_WORKFLOW_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining([
      'chatwoot-list-conversations', 'chatwoot-contact-sync', 'chatwoot-send-message',
      'chatwoot-auto-assign', 'chatwoot-public-contact', 'chatwoot-ai-agent',
    ]));
  });

  it.each(CHATWOOT_WORKFLOW_TEMPLATES.map((t) => [t.id, t]))(
    '%s matches the node catalog and the Chatwoot 4.18 payloads',
    (_id, t) => {
      expect(validateChatwootWorkflow(t.workflow as any)).toEqual([]);
    },
  );

  it.each(CHATWOOT_WORKFLOW_TEMPLATES.map((t) => [t.id, t]))('%s uses its required credential', (_id, t) => {
    const used = ((t.workflow as any).nodes as any[]).flatMap((n) => Object.keys(n.credentials ?? {}));
    expect(used).toContain(t.requiredCredential);
  });

  it('never gives the trigger a fixed or empty webhookId (it would share one webhook path)', () => {
    for (const t of CHATWOOT_WORKFLOW_TEMPLATES) {
      for (const n of (t.workflow as any).nodes) {
        if (n.type === TRIGGER) expect(n).not.toHaveProperty('webhookId');
      }
    }
  });

  it('reads contact_created fields from the flat payload', () => {
    const values = node('chatwoot-contact-sync', 'Extract Contact Data').parameters.assignments.assignments.map(
      (a: any) => a.value,
    );
    expect(values).toEqual(expect.arrayContaining([
      '={{ $json.id }}', '={{ $json.name || "Unknown" }}', '={{ $json.email || "" }}', '={{ $json.phone_number || "" }}',
    ]));
    expect(JSON.stringify(values)).not.toContain('$json.contact');
  });

  it('sends message_type and private through the options collection', () => {
    const params = node('chatwoot-send-message', 'Send Message').parameters;
    expect(params.options).toEqual({ message_type: 'outgoing', private: false });
    expect(params).not.toHaveProperty('messageType');
    expect(params).not.toHaveProperty('private');
    expect(node('chatwoot-send-message', 'Webhook').parameters.responseMode).toBe('responseNode');
  });

  it('assigns with the conversation display id and online agents', () => {
    const code = node('chatwoot-auto-assign', 'Select Online Agent').parameters.jsCode as string;
    expect(code).toContain("$('Chatwoot Trigger').first().json.id");
    expect(code).toContain("availability_status === 'online'");
    expect(code).not.toContain("'available'");
    const assign = node('chatwoot-auto-assign', 'Assign Conversation').parameters;
    expect(assign).toMatchObject({ resource: 'conversation', operation: 'assign', assignmentType: 'agent' });
    expect(JSON.stringify(nodes('chatwoot-auto-assign'))).not.toMatch(/json\.conversation\??\.id/);
  });

  it.each([
    { assignee: null, agents: [{ id: 8, availability_status: 'offline' }, { id: 9, availability_status: 'online' }], expected: [{ json: { conversation_id: 42, agent_id: 9 } }] },
    { assignee: null, agents: [{ id: 8, availability_status: 'busy' }], expected: [] },
    { assignee: null, agents: [], expected: [] },
    { assignee: { id: 7 }, agents: [{ id: 9, availability_status: 'online' }], expected: [] },
  ])('executes auto-assignment selection correctly for $assignee and $agents', ({ assignee, agents, expected }) => {
    const code = node('chatwoot-auto-assign', 'Select Online Agent').parameters.jsCode;
    const result = runInNewContext(`(function () { ${code} })()`, {
      $: () => ({ first: () => ({ json: { event: 'conversation_created', id: 42, meta: { assignee } } }) }),
      $input: { all: () => agents.map((json) => ({ json })) },
    });
    expect(result).toEqual(expected);
  });

  it('creates public contacts with additionalFields and chains source_id', () => {
    const create = node('chatwoot-public-contact', 'Create Public Contact').parameters;
    expect(create.additionalFields).toEqual({ name: '={{ $json.body.name }}', email: '={{ $json.body.email }}' });
    expect(create).not.toHaveProperty('name');
    expect(node('chatwoot-public-contact', 'Create Conversation').parameters.contactIdentifier).toBe(
      '={{ $json.source_id }}',
    );
  });

  it('connects the Chatwoot Tool variant to the AI Agent', () => {
    const wf = template('chatwoot-ai-agent').workflow as any;
    const tools = wf.nodes.filter((n: any) => n.type === TOOL);
    expect(tools.map((n: any) => n.name)).toEqual(['Reply to Customer', 'Hand Off to Human']);
    for (const t of tools) {
      expect(wf.connections[t.name].ai_tool[0][0]).toMatchObject({ node: 'AI Agent', type: 'ai_tool' });
    }
    expect(tools[0].parameters.content).toContain('$fromAI(');
    const trigger = wf.nodes.find((n: any) => n.type === TRIGGER);
    expect(trigger.parameters.filters.messageTypes).toEqual(['incoming']);
  });

  it.each(['pending', 'open', 'resolved', 'snoozed'])('only invokes the AI for pending conversations, given %s', (status) => {
    const wf = template('chatwoot-ai-agent').workflow as any;
    const gate = node('chatwoot-ai-agent', 'Only Pending Conversations');
    const item = { json: { event: 'message_created', content: 'Help me', conversation: { id: 42, status } } };
    const result = runInNewContext(`(function () { ${gate.parameters.jsCode} })()`, {
      $: () => ({ first: () => item }),
      $input: { all: () => [item] },
    });
    expect(result).toEqual(status === 'pending' ? [item] : []);
    expect(wf.connections['Chatwoot Trigger'].main).toEqual([[{ node: gate.name, type: 'main', index: 0 }]]);
    expect(wf.connections[gate.name].main).toEqual([[{ node: 'AI Agent', type: 'main', index: 0 }]]);
    expect(node('chatwoot-ai-agent', 'Hand Off to Human').parameters.status).toBe('open');
  });

  it.each([
    { response: { id: 81, content: 'Hello' }, expected: { success: true, message_id: 81 } },
    { response: { error: 'Conversation not found', httpCode: '404' }, expected: { success: false, error: 'Conversation not found' } },
  ])('responds truthfully when Send Message returns $response', ({ response, expected }) => {
    const expression = node('chatwoot-send-message', 'Respond').parameters.responseBody as string;
    const result = runInNewContext(expression.slice(3, -2), { $json: response });
    expect(JSON.parse(result)).toEqual(expected);
    expect(node('chatwoot-send-message', 'Send Message').onError).toBe('continueRegularOutput');
  });
});

describe('validateChatwootWorkflow', () => {
  describe('regressions of the pre-0.9 templates', () => {
    it('reports $json.contact on contact_created', () => {
      const issues = messages(triggerThenSet(['contact_created'], '={{ $json.contact?.name || "Unknown" }}'));
      expect(issues).toHaveLength(1);
      expect(issues[0]).toContain('"contact" does not exist');
    });

    it('reports .json.conversation on conversation_created', () => {
      const workflow = {
        nodes: [
          { name: 'Chatwoot Trigger', type: TRIGGER, parameters: { events: ['conversation_created'] } },
          {
            name: 'Assign',
            type: MAIN,
            parameters: {
              resource: 'conversation',
              operation: 'assign',
              conversationId: '={{ $("Chatwoot Trigger").item.json.conversation?.id }}',
              assigneeId: '={{ $json.agent_id }}',
            },
          },
        ],
        connections: {},
      };
      expect(messages(workflow)).toEqual([expect.stringContaining('"conversation" does not exist')]);
    });

    it('reports top-level messageType/private on message > create', () => {
      const issues = messages({
        nodes: [{
          name: 'Send',
          type: MAIN,
          parameters: { resource: 'message', operation: 'create', conversationId: 1, content: 'hi', messageType: 'outgoing', private: false },
        }],
      });
      expect(issues).toEqual([
        expect.stringContaining('the node reads it from "options.message_type"'),
        expect.stringContaining('the node reads it from "options.private"'),
      ]);
    });

    it('reports top-level name/email on publicContact > create', () => {
      const issues = messages({
        nodes: [{ name: 'Create', type: MAIN, parameters: { resource: 'publicContact', operation: 'create', name: 'A', email: 'a@b.c' } }],
      });
      expect(issues).toEqual([
        expect.stringContaining('"additionalFields.name"'),
        expect.stringContaining('"additionalFields.email"'),
      ]);
    });

    it('reports events Chatwoot does not accept for account webhooks', () => {
      const issues = messages({
        nodes: [{
          name: 'Chatwoot Trigger',
          type: TRIGGER,
          parameters: { events: ['conversation_created', 'conversation_assignee_changed', 'conversation_team_changed'] },
        }],
      });
      expect(issues).toHaveLength(1);
      expect(issues[0]).toContain('"conversation_assignee_changed", "conversation_team_changed"');
    });
  });

  describe('trigger payload paths', () => {
    it('accepts valid nested paths and trigger extras', () => {
      expect(messages(triggerThenSet(['message_created'], '={{ $json.conversation.meta.sender.name }}'))).toEqual([]);
      expect(messages(triggerThenSet(['message_created'], "={{ $json['inbox']['name'] }} {{ $json.account?.id }}"))).toEqual([]);
      expect(messages(triggerThenSet(['contact_updated'], '={{ $json.changed_attributes }} {{ $json.webhookDelivery.id }}'))).toEqual([]);
    });

    it('accepts the parsed raw body, exact body text and unverified-delivery marker of the current node', () => {
      const workflow = triggerThenSet(['contact_created'],
        '={{ $json.rawBody.name }} {{ $json.rawBodyText }} {{ $json.signatureVerified }}',
        { options: { includeRawBody: true, includeRawBodyText: true, verifySignature: false } },
      );
      expect(messages(workflow)).toEqual([]);
    });

    it('reports unknown nested keys', () => {
      const issues = messages(triggerThenSet(['message_created'], '={{ $json.conversation.contact.name }}'));
      expect(issues).toEqual([expect.stringContaining('"conversation.contact" does not exist')]);
      expect(messages(triggerThenSet(['conversation_created'], '={{ $json.meta.contact }}'))).toEqual([
        expect.stringContaining('"meta.contact" does not exist'),
      ]);
    });

    it('checks executable expressions and Code nodes without interpreting literal text as code', () => {
      expect(messages(triggerThenSet(['contact_created'], 'The text $json.contact is literal.'))).toEqual([]);
      const workflow = triggerThenSet(['contact_created'], 'plain text');
      workflow.nodes[1] = {
        name: 'Set',
        type: 'n8n-nodes-base.code',
        parameters: { jsCode: "return [{ json: $('Chatwoot Trigger').first().json.contact }];" },
      } as any;
      expect(messages(workflow)).toEqual([expect.stringContaining('"contact" does not exist')]);
    });

    it('checks the union of all selected events', () => {
      expect(messages(triggerThenSet(['contact_created', 'message_created'], '={{ $json.name }} {{ $json.content }}'))).toEqual([]);
    });

    it('checks $("<trigger name>") references anywhere, but $json only right after the trigger', () => {
      const workflow = {
        nodes: [
          { name: 'Chatwoot Trigger', type: TRIGGER, parameters: { events: ['contact_created'] } },
          { name: 'First', type: 'n8n-nodes-base.set', parameters: { value: '={{ $json.name }}' } },
          { name: 'Second', type: 'n8n-nodes-base.set', parameters: { a: '={{ $json.anything }}', b: "={{ $('Chatwoot Trigger').last().json.contact }}" } },
        ],
        connections: {
          'Chatwoot Trigger': { main: [[{ node: 'First', type: 'main', index: 0 }]] },
          First: { main: [[{ node: 'Second', type: 'main', index: 0 }]] },
        },
      };
      const issues = validateChatwootWorkflow(workflow as any);
      expect(issues).toEqual([{ node: 'Second', message: expect.stringContaining('"contact" does not exist') }]);
    });

    it('uses every manual event when the manual source has no event filter', () => {
      expect(getChatwootTriggerEvents({ source: 'manual' })).toContain('conversation_resolved');
      expect(getChatwootTriggerEvents({ events: ['message_created'] })).toEqual(['message_created']);
      expect(getChatwootTriggerOutputShape({ events: ['contact_created'] })).toHaveProperty('rawBody');
    });
  });

  describe('parameters', () => {
    it('reports unknown resources and operations', () => {
      expect(messages({ nodes: [{ name: 'N', type: MAIN, parameters: { resource: 'ticket' } }] })).toEqual([
        'unknown resource "ticket"',
      ]);
      expect(messages({ nodes: [{ name: 'N', type: MAIN, parameters: { resource: 'message', operation: 'send' } }] })).toEqual([
        'unknown operation "send" for resource "message"',
      ]);
    });

    it('reports missing required parameters and invalid option values', () => {
      const issues = messages({
        nodes: [{ name: 'N', type: MAIN, parameters: { resource: 'conversation', operation: 'updateStatus', status: 'closed' } }],
      });
      expect(issues).toEqual([
        expect.stringContaining('"status" must be one of "open", "pending", "resolved", "snoozed"'),
        'required parameter "conversationId" of conversation > updateStatus is not set',
      ]);
    });

    it('reports collection fields that do not exist', () => {
      const issues = messages({
        nodes: [{ name: 'N', type: MAIN, parameters: { resource: 'conversation', operation: 'getAll', filters: { state: 'open' } } }],
      });
      expect(issues).toEqual([expect.stringContaining('"filters.state" is not a field of "filters"')]);
    });

    it.each([
      { values: [null], error: '"formValues.values" entries must be objects' },
      { values: ['name'], error: '"formValues.values" entries must be objects' },
      { values: { name: 'email', value: 'a@b.c' }, error: '"formValues.values" must be an array' },
      { values: [{ field: 'email', value: 'a@b.c' }], error: '"formValues.values.field" is not a field of "formValues.values"' },
      { values: [{ name: 'email', value: 'a@b.c' }], error: undefined },
      { values: '={{ $json.values }}', error: undefined },
    ])('checks fixed-collection form values: $values', ({ values, error }) => {
      const issues = messages({
        nodes: [{
          name: 'Form Reply',
          type: MAIN,
          parameters: {
            resource: 'publicMessage', operation: 'update', contactIdentifier: 'contact-1',
            conversationId: 42, messageId: 81, responseType: 'form', formValues: { values },
          },
        }],
      });
      expect(issues).toEqual(error ? [error] : []);
    });

    it('reports parameters hidden by the current values', () => {
      const issues = messages({
        nodes: [{ name: 'N', type: MAIN, parameters: { resource: 'conversation', operation: 'getAll', returnAll: true, limit: 10 } }],
      });
      expect(issues).toEqual(['"limit" is ignored by conversation > getAll unless returnAll is false']);
    });

    it.each([
      { fields: { entityId: 4 }, expected: [] },
      { fields: { options: { id: 4 } }, expected: [] },
      { fields: { options: { id: '={{ $json.agentId }}' } }, expected: [] },
      { fields: {}, expected: ['required parameter "entityId" of report > accountSummary is not set'] },
      { fields: { options: { id: '' } }, expected: ['"options.id" must be a number or an expression', 'required parameter "entityId" of report > accountSummary is not set'] },
    ])('honors legacy Options IDs in required report fields: $fields', ({ fields, expected }) => {
      expect(messages({
        nodes: [{
          name: 'Report', type: MAIN,
          parameters: {
            resource: 'report', operation: 'accountSummary', type: 'agent',
            since: '2026-01-01T00:00:00Z', until: '2026-02-01T00:00:00Z', ...fields,
          },
        }],
      })).toEqual(expected);
    });

    it.each([
      { since: '2026-01-01T00:00:00Z', until: '2026-02-01T00:00:00Z' },
      { options: { since: '2026-01-01T00:00:00Z', until: '2026-02-01T00:00:00Z' } },
    ])('accepts top-level and legacy Options date ranges for CSAT download: %j', (fields) => {
      expect(messages({ nodes: [{ name: 'CSV', type: MAIN, parameters: { resource: 'csatSurvey', operation: 'download', ...fields } }] })).toEqual([]);
    });

    it('still requires the missing half of a legacy CSAT range', () => {
      expect(messages({
        nodes: [{ name: 'CSV', type: MAIN, parameters: { resource: 'csatSurvey', operation: 'download', options: { since: '2026-01-01T00:00:00Z' } } }],
      })).toEqual(['required parameter "until" of csatSurvey > download is not set']);
    });

    it('accepts expressions for option values and conditions', () => {
      expect(messages({
        nodes: [{
          name: 'N',
          type: MAIN,
          parameters: { resource: 'conversation', operation: 'assign', conversationId: '={{ $json.id }}', assignmentType: '={{ $json.kind }}', teamId: 3 },
        }],
      })).toEqual([]);
    });

    it('accepts the tool variant parameters and applies the same checks', () => {
      expect(messages({
        nodes: [{
          name: 'T',
          type: TOOL,
          parameters: { toolDescription: 'x', descriptionType: 'manual', resource: 'label', operation: 'getAll' },
        }],
      })).toEqual([]);
      expect(messages({ nodes: [{ name: 'T', type: TOOL, parameters: { resource: 'label', operation: 'getAll', foo: 1 } }] })).toEqual([
        '"foo" is not a parameter of label > getAll',
      ]);
    });

    it('reports credentials that do not match the resource API', () => {
      const issues = messages({
        nodes: [{ name: 'N', type: MAIN, parameters: { resource: 'publicInbox', operation: 'get' }, credentials: CREDS }],
      });
      expect(issues).toEqual([expect.stringContaining('needs "chatwootPublicApi"')]);
    });

    it('checks trigger parameters for the selected source', () => {
      expect(messages({ nodes: [{ name: 'T', type: TRIGGER, parameters: {} }] })).toEqual([
        'required parameter "events" of Chatwoot Trigger is not set',
      ]);
      expect(messages({
        nodes: [{ name: 'T', type: TRIGGER, parameters: { source: 'manual', signingSecret: 's', manualEvents: ['conversation_resolved'] } }],
      })).toEqual([]);
      expect(messages({
        nodes: [{ name: 'T', type: TRIGGER, parameters: { source: 'manual', events: ['message_created'] } }],
      })).toEqual(['"events" is ignored by Chatwoot Trigger unless source is "accountWebhook"']);
      expect(messages({
        nodes: [{ name: 'T', type: TRIGGER, parameters: { events: ['message_created'], filters: { messageTypes: ['incoming'], onlyInbox: 1 } } }],
      })).toEqual([expect.stringContaining('"filters.onlyInbox" is not a field of "filters"')]);
    });

    it('ignores nodes of other packages', () => {
      expect(messages({
        nodes: [{ name: 'Other', type: '@devlikeapro/n8n-nodes-chatwoot.chatwoot', parameters: { anything: true } }],
      })).toEqual([]);
    });
  });
});
