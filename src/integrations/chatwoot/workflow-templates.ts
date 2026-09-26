/**
 * Chatwoot Workflow Templates for n8n
 *
 * Ready-to-use workflow JSON templates using @renatoascencio/n8n-nodes-chatwoot (0.9.x).
 * These templates can be imported directly into n8n via the API or UI.
 *
 * Chatwoot parameters and direct trigger payload references are checked by validateChatwootWorkflow
 * (template-validator.ts) against the node catalog and the Chatwoot 4.18 webhook payloads:
 * - trigger items are the Chatwoot payload itself, flat: contact_created → `$json.name`,
 *   conversation_created → `$json.id` (display ID), message_created → `$json.conversation.id`;
 * - optional values live in collections: Message > Create reads `options.message_type`, Public Contact >
 *   Create reads `additionalFields.name`.
 *
 * Trigger nodes carry no `webhookId`: n8n then derives a per-workflow webhook path. A fixed or empty
 * webhookId would make every workflow imported from the same template share one path.
 */

export interface ChatwootWorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: 'contact-sync' | 'messaging' | 'monitoring' | 'automation' | 'ai';
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  requiredCredential: 'chatwootApi' | 'chatwootPlatformApi' | 'chatwootPublicApi';
  workflow: Record<string, unknown>;
}

const CHATWOOT = '@renatoascencio/n8n-nodes-chatwoot.chatwoot';
const CHATWOOT_TOOL = '@renatoascencio/n8n-nodes-chatwoot.chatwootTool';
const CHATWOOT_TRIGGER = '@renatoascencio/n8n-nodes-chatwoot.chatwootTrigger';
const CHATWOOT_API_CREDENTIAL = { chatwootApi: { id: '', name: 'Chatwoot API' } };
const CHATWOOT_PUBLIC_API_CREDENTIAL = { chatwootPublicApi: { id: '', name: 'Chatwoot Public API' } };

export const CHATWOOT_WORKFLOW_TEMPLATES: ChatwootWorkflowTemplate[] = [
  // =========================================================================
  // Template 1: List Conversations (Beginner)
  // =========================================================================
  {
    id: 'chatwoot-list-conversations',
    name: 'Chatwoot: List Open Conversations',
    description: 'Fetches open conversations from Chatwoot every hour. Useful for monitoring and reporting.',
    category: 'monitoring',
    difficulty: 'beginner',
    requiredCredential: 'chatwootApi',
    workflow: {
      name: 'Chatwoot - List Open Conversations',
      nodes: [
        {
          parameters: { rule: { interval: [{ field: 'hours', hoursInterval: 1 }] } },
          name: 'Schedule Trigger',
          type: 'n8n-nodes-base.scheduleTrigger',
          typeVersion: 1.2,
          position: [250, 300],
        },
        {
          parameters: {
            resource: 'conversation',
            operation: 'getAll',
            returnAll: false,
            limit: 50,
            filters: { status: 'open' },
          },
          name: 'Get Open Conversations',
          type: CHATWOOT,
          typeVersion: 1,
          position: [470, 300],
          credentials: CHATWOOT_API_CREDENTIAL,
        },
      ],
      connections: {
        'Schedule Trigger': { main: [[{ node: 'Get Open Conversations', type: 'main', index: 0 }]] },
      },
    },
  },

  // =========================================================================
  // Template 2: New Contact Sync (Intermediate)
  // =========================================================================
  {
    id: 'chatwoot-contact-sync',
    name: 'Chatwoot: New Contact Sync',
    description:
      'When a contact is created in Chatwoot (contact_created webhook), extracts its id, name, email, phone and identifier, ' +
      'ready for a CRM or Google Sheets node. Add your destination node after "Extract Contact Data".',
    category: 'contact-sync',
    difficulty: 'intermediate',
    requiredCredential: 'chatwootApi',
    workflow: {
      name: 'Chatwoot - New Contact Sync',
      nodes: [
        {
          parameters: { source: 'accountWebhook', events: ['contact_created'] },
          name: 'Chatwoot Trigger',
          type: CHATWOOT_TRIGGER,
          typeVersion: 1,
          position: [250, 300],
          credentials: CHATWOOT_API_CREDENTIAL,
        },
        {
          parameters: {
            mode: 'manual',
            assignments: {
              // contact_created is Contact#webhook_data, flat: no `contact` wrapper
              assignments: [
                { name: 'contact_id', type: 'number', value: '={{ $json.id }}' },
                { name: 'name', type: 'string', value: '={{ $json.name || "Unknown" }}' },
                { name: 'email', type: 'string', value: '={{ $json.email || "" }}' },
                { name: 'phone', type: 'string', value: '={{ $json.phone_number || "" }}' },
                { name: 'identifier', type: 'string', value: '={{ $json.identifier || "" }}' },
                { name: 'source', type: 'string', value: 'chatwoot' },
                { name: 'created_at', type: 'string', value: '={{ $now.toISO() }}' },
              ],
            },
          },
          name: 'Extract Contact Data',
          type: 'n8n-nodes-base.set',
          typeVersion: 3.4,
          position: [470, 300],
        },
      ],
      connections: {
        'Chatwoot Trigger': { main: [[{ node: 'Extract Contact Data', type: 'main', index: 0 }]] },
      },
    },
  },

  // =========================================================================
  // Template 3: Send Message (Beginner)
  // =========================================================================
  {
    id: 'chatwoot-send-message',
    name: 'Chatwoot: Send Message to Conversation',
    description:
      'Webhook endpoint that sends an outgoing message to a Chatwoot conversation. ' +
      'POST {"conversation_id": <display id>, "message": "..."}.',
    category: 'messaging',
    difficulty: 'beginner',
    requiredCredential: 'chatwootApi',
    workflow: {
      name: 'Chatwoot - Send Message',
      nodes: [
        {
          // Answered by the "Respond" node, which also runs when Chatwoot rejects the message
          parameters: { httpMethod: 'POST', path: 'send-chatwoot-message', responseMode: 'responseNode' },
          name: 'Webhook',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 2,
          position: [250, 300],
          onError: 'continueRegularOutput',
        },
        {
          parameters: {
            resource: 'message',
            operation: 'create',
            conversationId: '={{ $json.body.conversation_id }}',
            content: '={{ $json.body.message }}',
            // Message > Create reads message_type / private from the Options collection
            options: { message_type: 'outgoing', private: false },
          },
          name: 'Send Message',
          type: CHATWOOT,
          typeVersion: 1,
          position: [470, 300],
          credentials: CHATWOOT_API_CREDENTIAL,
          // On failure the node outputs { error, description, httpCode } instead of stopping
          onError: 'continueRegularOutput',
        },
        {
          parameters: {
            respondWith: 'json',
            responseBody:
              '={{ JSON.stringify($json.error ? { success: false, error: $json.error } : { success: true, message_id: $json.id }) }}',
          },
          name: 'Respond',
          type: 'n8n-nodes-base.respondToWebhook',
          typeVersion: 1.1,
          position: [690, 300],
        },
      ],
      connections: {
        Webhook: { main: [[{ node: 'Send Message', type: 'main', index: 0 }]] },
        'Send Message': { main: [[{ node: 'Respond', type: 'main', index: 0 }]] },
      },
    },
  },

  // =========================================================================
  // Template 4: Auto-Assign Conversations (Intermediate)
  // =========================================================================
  {
    id: 'chatwoot-auto-assign',
    name: 'Chatwoot: Auto-Assign New Conversations',
    description:
      'Assigns each new, unassigned conversation to a random online agent (conversation_created webhook). ' +
      'Nothing happens when no agent is online.',
    category: 'automation',
    difficulty: 'intermediate',
    requiredCredential: 'chatwootApi',
    workflow: {
      name: 'Chatwoot - Auto-Assign Conversations',
      nodes: [
        {
          parameters: { source: 'accountWebhook', events: ['conversation_created'] },
          name: 'Chatwoot Trigger',
          type: CHATWOOT_TRIGGER,
          typeVersion: 1,
          position: [250, 300],
          credentials: CHATWOOT_API_CREDENTIAL,
        },
        {
          parameters: { resource: 'agent', operation: 'getAll' },
          name: 'Get Agents',
          type: CHATWOOT,
          typeVersion: 1,
          position: [470, 300],
          credentials: CHATWOOT_API_CREDENTIAL,
        },
        {
          parameters: {
            jsCode: `// conversation_created is the conversation itself: id = display ID, meta.assignee = current assignee
if ($('Chatwoot Trigger').first().json.meta?.assignee) return [];
// Chatwoot availability_status is 'online', 'busy' or 'offline'
const online = $input.all().filter((agent) => agent.json.availability_status === 'online');
if (online.length === 0) return [];
const selected = online[Math.floor(Math.random() * online.length)];
return [{ json: { conversation_id: $('Chatwoot Trigger').first().json.id, agent_id: selected.json.id } }];`,
          },
          name: 'Select Online Agent',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [690, 300],
        },
        {
          parameters: {
            resource: 'conversation',
            operation: 'assign',
            conversationId: '={{ $json.conversation_id }}',
            assignmentType: 'agent',
            assigneeId: '={{ $json.agent_id }}',
          },
          name: 'Assign Conversation',
          type: CHATWOOT,
          typeVersion: 1,
          position: [910, 300],
          credentials: CHATWOOT_API_CREDENTIAL,
        },
      ],
      connections: {
        'Chatwoot Trigger': { main: [[{ node: 'Get Agents', type: 'main', index: 0 }]] },
        'Get Agents': { main: [[{ node: 'Select Online Agent', type: 'main', index: 0 }]] },
        'Select Online Agent': { main: [[{ node: 'Assign Conversation', type: 'main', index: 0 }]] },
      },
    },
  },

  // =========================================================================
  // Template 5: Public API - Widget Contact (Beginner)
  // =========================================================================
  {
    id: 'chatwoot-public-contact',
    name: 'Chatwoot: Create Contact via Public API',
    description:
      'Creates a contact and a conversation through the Public API of an API channel inbox, as a website widget would. ' +
      'POST {"name": "...", "email": "..."}.',
    category: 'messaging',
    difficulty: 'beginner',
    requiredCredential: 'chatwootPublicApi',
    workflow: {
      name: 'Chatwoot - Public API Contact',
      nodes: [
        {
          parameters: { httpMethod: 'POST', path: 'chatwoot-public-contact' },
          name: 'Webhook',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 2,
          position: [250, 300],
        },
        {
          parameters: {
            resource: 'publicContact',
            operation: 'create',
            // Public Contact > Create only reads Additional Fields
            additionalFields: {
              name: '={{ $json.body.name }}',
              email: '={{ $json.body.email }}',
            },
          },
          name: 'Create Public Contact',
          type: CHATWOOT,
          typeVersion: 1,
          position: [470, 300],
          credentials: CHATWOOT_PUBLIC_API_CREDENTIAL,
        },
        {
          parameters: {
            resource: 'publicConversation',
            operation: 'create',
            // The create response carries the contact identifier as source_id
            contactIdentifier: '={{ $json.source_id }}',
          },
          name: 'Create Conversation',
          type: CHATWOOT,
          typeVersion: 1,
          position: [690, 300],
          credentials: CHATWOOT_PUBLIC_API_CREDENTIAL,
        },
      ],
      connections: {
        Webhook: { main: [[{ node: 'Create Public Contact', type: 'main', index: 0 }]] },
        'Create Public Contact': { main: [[{ node: 'Create Conversation', type: 'main', index: 0 }]] },
      },
    },
  },

  // =========================================================================
  // Template 6: AI Agent with Chatwoot Tools (Advanced)
  // =========================================================================
  {
    id: 'chatwoot-ai-agent',
    name: 'Chatwoot: AI Agent Replies with Chatwoot Tools',
    description:
      'Answers incoming customer messages with an AI Agent that uses the Chatwoot node as a tool (usableAsTool): ' +
      'it replies in the conversation and can hand it over to a human by setting it to open. ' +
      'Only replies while the conversation is pending, so subsequent messages stay with the human after handoff. ' +
      'Use an inbox whose conversations start as pending (agent bot inbox). Needs an OpenAI credential.',
    category: 'ai',
    difficulty: 'advanced',
    requiredCredential: 'chatwootApi',
    workflow: {
      name: 'Chatwoot - AI Agent Replies',
      nodes: [
        {
          parameters: {
            source: 'accountWebhook',
            events: ['message_created'],
            // Only customer messages: the agent's own replies (outgoing) never re-trigger the workflow
            filters: { messageTypes: ['incoming'], senderTypes: ['contact'], privateNotes: 'exclude' },
          },
          name: 'Chatwoot Trigger',
          type: CHATWOOT_TRIGGER,
          typeVersion: 1,
          position: [250, 300],
          credentials: CHATWOOT_API_CREDENTIAL,
        },
        {
          parameters: {
            jsCode: `// A handoff changes pending to open; do not reply again in the human's conversation.
return $('Chatwoot Trigger').first().json.conversation?.status === 'pending' ? $input.all() : [];`,
          },
          name: 'Only Pending Conversations',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [470, 300],
        },
        {
          parameters: {
            promptType: 'define',
            text: "={{ $('Chatwoot Trigger').item.json.content }}",
            options: {
              systemMessage:
                'You are a customer support assistant. Answer the customer with the "Reply to Customer" tool. ' +
                'When you cannot help or the customer asks for a person, use the "Hand Off to Human" tool.',
            },
          },
          name: 'AI Agent',
          type: '@n8n/n8n-nodes-langchain.agent',
          typeVersion: 3.1,
          position: [690, 300],
        },
        {
          parameters: { model: { __rl: true, mode: 'list', value: 'gpt-5-mini' }, options: {} },
          name: 'OpenAI Chat Model',
          type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
          typeVersion: 1.3,
          position: [570, 520],
          credentials: { openAiApi: { id: '', name: 'OpenAI' } },
        },
        {
          parameters: {
            descriptionType: 'manual',
            toolDescription: 'Send a reply to the customer in the current Chatwoot conversation',
            resource: 'message',
            operation: 'create',
            conversationId: "={{ $('Chatwoot Trigger').item.json.conversation.id }}",
            content: "={{ $fromAI('content', 'The reply to send to the customer', 'string') }}",
          },
          name: 'Reply to Customer',
          type: CHATWOOT_TOOL,
          typeVersion: 1,
          position: [750, 520],
          credentials: CHATWOOT_API_CREDENTIAL,
        },
        {
          parameters: {
            descriptionType: 'manual',
            toolDescription: 'Hand the current Chatwoot conversation over to a human agent',
            resource: 'conversation',
            operation: 'updateStatus',
            conversationId: "={{ $('Chatwoot Trigger').item.json.conversation.id }}",
            status: 'open',
          },
          name: 'Hand Off to Human',
          type: CHATWOOT_TOOL,
          typeVersion: 1,
          position: [930, 520],
          credentials: CHATWOOT_API_CREDENTIAL,
        },
      ],
      connections: {
        'Chatwoot Trigger': { main: [[{ node: 'Only Pending Conversations', type: 'main', index: 0 }]] },
        'Only Pending Conversations': { main: [[{ node: 'AI Agent', type: 'main', index: 0 }]] },
        'OpenAI Chat Model': { ai_languageModel: [[{ node: 'AI Agent', type: 'ai_languageModel', index: 0 }]] },
        'Reply to Customer': { ai_tool: [[{ node: 'AI Agent', type: 'ai_tool', index: 0 }]] },
        'Hand Off to Human': { ai_tool: [[{ node: 'AI Agent', type: 'ai_tool', index: 0 }]] },
      },
    },
  },
];
