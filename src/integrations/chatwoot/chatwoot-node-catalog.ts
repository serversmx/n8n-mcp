/**
 * Chatwoot Node Catalog
 *
 * Catalog of the @renatoascencio/n8n-nodes-chatwoot community nodes, registered in the MCP database so they
 * appear in search results, expose their real parameters and pass workflow validation.
 *
 * Everything node-related is derived from chatwoot-node-snapshot.json, which
 * src/scripts/generate-chatwoot-catalog.ts generates from the built package with the same NodeParser used
 * for core nodes. Do not edit resources, operations or parameters here by hand: regenerate the snapshot.
 *
 * The webhook payload shapes below are the only hand-written data. They mirror Chatwoot 4.18.0:
 *   app/listeners/webhook_listener.rb, app/listeners/agent_bot_listener.rb,
 *   app/presenters/conversations/event_data_presenter.rb (+ enterprise SLA keys),
 *   app/presenters/inbox/event_data_presenter.rb and the *#webhook_data methods of
 *   Contact, Message, ContactInbox, Inbox, Account and User.
 */

import type { ParsedNode } from '../../parsers/node-parser';
import type { CommunityNodeFields, NodeRepository } from '../../database/node-repository';
import { ToolVariantGenerator } from '../../services/tool-variant-generator';
import snapshotJson from './chatwoot-node-snapshot.json';

// ============================================================================
// Snapshot
// ============================================================================

export interface ChatwootSnapshotNode extends ParsedNode {
  /** Raw `usableAsTool` flag of the node description */
  usableAsTool: boolean;
}

export interface ChatwootCredentialProperty {
  name: string;
  displayName: string;
  type: string;
  required: boolean;
  default?: unknown;
  description?: string;
  options?: Array<{ name: string; value: string }>;
  displayOptions?: Record<string, unknown>;
}

export interface ChatwootCredentialDefinition {
  name: string;
  displayName: string;
  documentationUrl?: string;
  properties: ChatwootCredentialProperty[];
}

export interface ChatwootNodeSnapshot {
  packageName: string;
  packageVersion: string;
  source?: string;
  nodes: ChatwootSnapshotNode[];
  credentials: ChatwootCredentialDefinition[];
}

const SNAPSHOT = snapshotJson as unknown as ChatwootNodeSnapshot;

export const CHATWOOT_PACKAGE_NAME = SNAPSHOT.packageName;
export const CHATWOOT_PACKAGE_VERSION = SNAPSHOT.packageVersion;
export const CHATWOOT_AUTHOR_NAME = 'Renato Ascencio';
export const CHATWOOT_AUTHOR_GITHUB_URL = 'https://github.com/RenatoAscencio';
export const CHATWOOT_REPOSITORY_URL = 'https://github.com/RenatoAscencio/n8n-nodes-chatwoot';

export const CHATWOOT_NODE_TYPES = {
  main: `${CHATWOOT_PACKAGE_NAME}.chatwoot`,
  /** Created by n8n at runtime because the main node sets usableAsTool (AI Agent "Tool" input) */
  tool: `${CHATWOOT_PACKAGE_NAME}.chatwootTool`,
  trigger: `${CHATWOOT_PACKAGE_NAME}.chatwootTrigger`,
} as const;

function snapshotNode(nodeType: string): ChatwootSnapshotNode {
  const node = SNAPSHOT.nodes.find((n) => n.nodeType === nodeType);
  if (!node) throw new Error(`Chatwoot snapshot has no node ${nodeType}`);
  return node;
}

const MAIN = snapshotNode(CHATWOOT_NODE_TYPES.main);
const TRIGGER = snapshotNode(CHATWOOT_NODE_TYPES.trigger);

export const CHATWOOT_CREDENTIALS: ChatwootCredentialDefinition[] = SNAPSHOT.credentials;

/** Whether the main node can be connected to an AI Agent as a tool (description.usableAsTool). */
export const CHATWOOT_USABLE_AS_TOOL = MAIN.usableAsTool;

// ============================================================================
// Resources and operations (main node)
// ============================================================================

export type ChatwootApiType = 'application' | 'platform' | 'public';

export interface ChatwootResourceInfo {
  value: string;
  name: string;
  api: ChatwootApiType;
  credential: string;
}

export interface ChatwootOperationInfo {
  value: string;
  name: string;
  description?: string;
}

const API_BY_CREDENTIAL: Record<string, ChatwootApiType> = {
  chatwootApi: 'application',
  chatwootPlatformApi: 'platform',
  chatwootPublicApi: 'public',
};

function credentialForResource(resource: string): string {
  const credential = MAIN.credentials.find((c: any) =>
    (c.displayOptions?.show?.resource ?? []).includes(resource),
  );
  if (!credential) throw new Error(`Chatwoot snapshot: no credential for resource ${resource}`);
  return credential.name;
}

const RESOURCE_PROPERTY = MAIN.properties.find((p: any) => p.name === 'resource');

export const CHATWOOT_RESOURCES: ChatwootResourceInfo[] = (RESOURCE_PROPERTY?.options ?? []).map(
  (option: any) => {
    const credential = credentialForResource(option.value);
    return { value: option.value, name: option.name, api: API_BY_CREDENTIAL[credential], credential };
  },
);

export const CHATWOOT_RESOURCE_VALUES: string[] = CHATWOOT_RESOURCES.map((r) => r.value);

export const CHATWOOT_OPERATIONS: Record<string, ChatwootOperationInfo[]> = Object.fromEntries(
  CHATWOOT_RESOURCE_VALUES.map((resource) => [
    resource,
    MAIN.operations
      .filter((op: any) => op.resource === resource)
      .map((op: any) => ({ value: op.operation, name: op.name, description: op.description })),
  ]),
);

export const CHATWOOT_OPERATION_COUNT = MAIN.operations.length;

/** Default resource of the main node ('conversation'). */
export const CHATWOOT_DEFAULT_RESOURCE: string = RESOURCE_PROPERTY?.default ?? 'conversation';

/** Default operation of a resource (the operation property's default). */
export function getChatwootDefaultOperation(resource: string): string | undefined {
  const prop = MAIN.properties.find(
    (p: any) => p.name === 'operation' && (p.displayOptions?.show?.resource ?? []).includes(resource),
  );
  return prop?.default;
}

// ============================================================================
// Parameters
// ============================================================================

export interface ChatwootParameterInfo {
  name: string;
  displayName: string;
  type: string;
  required: boolean;
  default: unknown;
  description?: string;
  /** Allowed values of options/multiOptions parameters (absent when loaded dynamically) */
  values?: string[];
  /** Whether the options are loaded from Chatwoot at runtime (loadOptionsMethod) */
  dynamicOptions?: boolean;
  /** Keys of collection / fixedCollection parameters */
  fields?: ChatwootParameterInfo[];
  /** Other parameters that must have these values for this one to be shown (besides resource/operation) */
  showWhen?: Record<string, unknown[]>;
  /** Other parameter conditions that hide this field (besides resource/operation) */
  hideWhen?: Record<string, unknown[]>;
  /** Raw property definition from the node description */
  property: any;
}

function toParameterInfo(prop: any): ChatwootParameterInfo {
  const show = { ...(prop.displayOptions?.show ?? {}) };
  const hide = { ...(prop.displayOptions?.hide ?? {}) };
  delete show.resource;
  delete show.operation;
  delete hide.resource;
  delete hide.operation;
  const info: ChatwootParameterInfo = {
    name: prop.name,
    displayName: prop.displayName,
    type: prop.type,
    required: prop.required === true,
    default: prop.default,
    description: prop.description,
    property: prop,
  };
  if ((prop.type === 'options' || prop.type === 'multiOptions') && Array.isArray(prop.options)) {
    info.values = prop.options.map((o: any) => o.value);
  }
  if (prop.typeOptions?.loadOptionsMethod || prop.typeOptions?.loadOptions) {
    info.dynamicOptions = true;
  }
  if (prop.type === 'collection' && Array.isArray(prop.options)) {
    info.fields = prop.options.map(toParameterInfo);
  }
  if (prop.type === 'fixedCollection' && Array.isArray(prop.options)) {
    info.fields = prop.options.map((group: any) => ({
      ...toParameterInfo({ ...group, type: 'fixedCollectionGroup' }),
      fields: (group.values ?? []).map(toParameterInfo),
    }));
  }
  if (Object.keys(show).length > 0) info.showWhen = show;
  if (Object.keys(hide).length > 0) info.hideWhen = hide;
  return info;
}

function matchesCondition(condition: Record<string, unknown[]> | undefined, key: string, value: string): boolean | undefined {
  const allowed = condition?.[key];
  if (!Array.isArray(allowed)) return undefined;
  return allowed.includes(value);
}

/** Whether a property is shown for resource/operation (conditions on other parameters are ignored here). */
function isShownFor(prop: any, resource: string, operation: string): boolean {
  const show = prop.displayOptions?.show;
  const hide = prop.displayOptions?.hide;
  if (!show) return false;
  if (matchesCondition(show, 'resource', resource) === false) return false;
  if (matchesCondition(show, 'operation', operation) === false) return false;
  if (!show.resource && !show.operation) return false;
  if (matchesCondition(hide, 'resource', resource) === true) return false;
  if (matchesCondition(hide, 'operation', operation) === true) return false;
  return true;
}

/**
 * Parameters of a main-node operation (resource and operation excluded), exactly as the node defines them.
 * Returns undefined for an unknown resource/operation.
 */
export function getChatwootOperationParameters(
  resource: string,
  operation: string,
): ChatwootParameterInfo[] | undefined {
  if (!CHATWOOT_OPERATIONS[resource]?.some((op) => op.value === operation)) return undefined;
  return MAIN.properties
    .filter((p: any) => p.name !== 'resource' && p.name !== 'operation')
    .filter((p: any) => isShownFor(p, resource, operation))
    .map(toParameterInfo);
}

// ============================================================================
// Trigger
// ============================================================================

function triggerProperty(name: string): any {
  const prop = TRIGGER.properties.find((p: any) => p.name === name);
  if (!prop) throw new Error(`Chatwoot snapshot: trigger has no property ${name}`);
  return prop;
}

function optionValues(prop: any): string[] {
  return (prop.options ?? []).map((o: any) => o.value ?? o.name);
}

/** Trigger sources: 'accountWebhook' (registered automatically) and 'manual' (agent bot / API channel URL). */
export const CHATWOOT_TRIGGER_SOURCES: string[] = optionValues(triggerProperty('source'));

/**
 * Events of the "Account Webhook" source (`events`). Identical to Chatwoot's Webhook::ALLOWED_WEBHOOK_EVENTS
 * (4.13-4.18): Chatwoot rejects any other subscription with HTTP 422.
 */
export const CHATWOOT_TRIGGER_EVENTS: string[] = optionValues(triggerProperty('events'));

/** Events of the "Agent Bot / API Channel (Manual URL)" source (`manualEvents`). */
export const CHATWOOT_TRIGGER_MANUAL_EVENTS: string[] = optionValues(triggerProperty('manualEvents'));

/** Events only agent bots receive (not valid account webhook subscriptions). */
export const CHATWOOT_AGENT_BOT_ONLY_EVENTS: string[] = CHATWOOT_TRIGGER_MANUAL_EVENTS.filter(
  (event) => !CHATWOOT_TRIGGER_EVENTS.includes(event),
);

/** Keys of the trigger's `filters` collection. */
export const CHATWOOT_TRIGGER_FILTERS: string[] = optionValues(triggerProperty('filters'));

/** Keys of the trigger's `options` collection. */
export const CHATWOOT_TRIGGER_OPTIONS: string[] = optionValues(triggerProperty('options'));

/** Top-level trigger parameters. */
export const CHATWOOT_TRIGGER_PARAMETERS: ChatwootParameterInfo[] = TRIGGER.properties
  .filter((p: any) => p.type !== 'notice')
  .map(toParameterInfo);

// ============================================================================
// Webhook payloads (Chatwoot 4.18.0)
// ============================================================================

/** A payload object: key → nested shape, or `true` for a value whose inner keys are not checked. */
export type ChatwootPayloadShape = { [key: string]: ChatwootPayloadShape | true };

const ACCOUNT_REF: ChatwootPayloadShape = { id: true, name: true };
const INBOX_REF: ChatwootPayloadShape = { id: true, name: true };

/** Contact#webhook_data */
const CONTACT: ChatwootPayloadShape = {
  account: ACCOUNT_REF,
  additional_attributes: true,
  avatar: true,
  blocked: true,
  custom_attributes: true,
  email: true,
  id: true,
  identifier: true,
  name: true,
  phone_number: true,
  thumbnail: true,
};

/** Conversations::EventDataPresenter#webhook_data. `id` is the conversation DISPLAY id (used by the API). */
const CONVERSATION: ChatwootPayloadShape = {
  account: ACCOUNT_REF,
  additional_attributes: true,
  agent_last_seen_at: true,
  can_reply: true,
  channel: true,
  contact_inbox: true,
  contact_last_seen_at: true,
  created_at: true,
  custom_attributes: true,
  first_reply_created_at: true,
  id: true,
  inbox_id: true,
  labels: true,
  last_activity_at: true,
  messages: true,
  meta: { sender: true, assignee: true, assignee_type: true, team: true, hmac_verified: true },
  priority: true,
  snoozed_until: true,
  status: true,
  timestamp: true,
  unread_count: true,
  updated_at: true,
  waiting_since: true,
  // Enterprise, accounts with the 'sla' feature only
  applied_sla: true,
  sla_events: true,
  sla_policy_id: true,
};

/** Message#webhook_data */
const MESSAGE: ChatwootPayloadShape = {
  account: ACCOUNT_REF,
  additional_attributes: true,
  attachments: true,
  content: true,
  content_attributes: true,
  content_type: true,
  conversation: CONVERSATION,
  created_at: true,
  id: true,
  inbox: INBOX_REF,
  message_type: true,
  private: true,
  sender: true,
  source_id: true,
};

/** Inbox::EventDataPresenter#webhook_data: no inbox id or name. */
const INBOX_EVENT: ChatwootPayloadShape = {
  account: ACCOUNT_REF,
  allow_messages_after_resolved: true,
  auto_assignment_config: true,
  business_name: true,
  channel: true,
  created_at: true,
  csat_survey_enabled: true,
  enable_auto_assignment: true,
  enable_email_collect: true,
  greeting_enabled: true,
  greeting_message: true,
  lock_to_single_conversation: true,
  out_of_office_message: true,
  sender_name_type: true,
  timezone: true,
  updated_at: true,
  working_hours: true,
  working_hours_enabled: true,
};

/** WebhookListener#handle_typing_status */
const TYPING: ChatwootPayloadShape = { conversation: CONVERSATION, is_private: true, user: true };

/** ContactInbox#webhook_data + event_info */
const WEBWIDGET: ChatwootPayloadShape = {
  account: ACCOUNT_REF,
  contact: CONTACT,
  current_conversation: CONVERSATION,
  event_info: true,
  id: true,
  inbox: INBOX_REF,
  source_id: true,
};

const CHANGED = { changed_attributes: true } as const;

/**
 * Payload of every trigger event (flat: the event object is the root, e.g. `$json.name` for contact_created,
 * `$json.id` for conversation_created, `$json.conversation.id` for message_created). `event` is always set.
 */
export const CHATWOOT_WEBHOOK_PAYLOADS: Record<string, ChatwootPayloadShape> = {
  contact_created: { event: true, ...CONTACT },
  contact_updated: { event: true, ...CONTACT, ...CHANGED },
  conversation_created: { event: true, ...CONVERSATION },
  conversation_status_changed: { event: true, ...CONVERSATION, ...CHANGED },
  conversation_updated: { event: true, ...CONVERSATION, ...CHANGED },
  conversation_opened: { event: true, ...CONVERSATION },
  conversation_resolved: { event: true, ...CONVERSATION },
  conversation_typing_on: { event: true, ...TYPING },
  conversation_typing_off: { event: true, ...TYPING },
  inbox_created: { event: true, ...INBOX_EVENT },
  inbox_updated: { event: true, ...INBOX_EVENT, ...CHANGED },
  message_created: { event: true, ...MESSAGE },
  message_updated: { event: true, ...MESSAGE },
  webwidget_triggered: { event: true, ...WEBWIDGET },
};

/** Keys the trigger adds to every item, depending on its options. */
export const CHATWOOT_TRIGGER_OUTPUT_EXTRAS: ChatwootPayloadShape = {
  rawBody: true,
  rawBodyText: true,
  signatureVerified: true,
  webhookDelivery: { id: true, timestamp: true, signature: true, signatureVerified: true, source: true },
};

// ============================================================================
// Documentation (served by get_node in docs mode)
// ============================================================================

const API_TITLES: Record<ChatwootApiType, string> = {
  application: 'Application API (credential: Chatwoot API)',
  platform: 'Platform API (credential: Chatwoot Platform API, self-hosted Super Admin platform app)',
  public: 'Public API (credential: Chatwoot Public API, API channel inbox identifier)',
};

function buildMainDocumentation(): string {
  const sections = (['application', 'platform', 'public'] as ChatwootApiType[]).map((api) => {
    const rows = CHATWOOT_RESOURCES.filter((r) => r.api === api).map(
      (r) => `- **${r.name}** (\`${r.value}\`): ${CHATWOOT_OPERATIONS[r.value].map((op) => `\`${op.value}\``).join(', ')}`,
    );
    return `### ${API_TITLES[api]}\n${rows.join('\n')}`;
  });

  return `# Chatwoot (${CHATWOOT_PACKAGE_NAME} ${CHATWOOT_PACKAGE_VERSION})

Community node for the Chatwoot API: ${CHATWOOT_RESOURCES.length} resources, ${CHATWOOT_OPERATION_COUNT} operations.
Set \`resource\` and \`operation\`, then the operation's parameters. Optional values live in collections
(\`additionalFields\`, \`updateFields\`, \`options\`, \`filters\`), not at the top level: for example
Message > Create reads \`options.message_type\` / \`options.private\`, and Public Contact > Create reads
\`additionalFields.name\` / \`additionalFields.email\`. Use get_node with detail "full" for every parameter.

Conversation IDs are the conversation **display ID** (the number in the Chatwoot URL, \`id\` in webhook payloads).

## AI Agent tool
The node sets \`usableAsTool\`, so n8n also offers it as **Chatwoot Tool** (\`${CHATWOOT_NODE_TYPES.tool}\`),
connected to an AI Agent through \`ai_tool\`. Let the model fill values with \`$fromAI()\`, e.g.
\`={{ $fromAI('content', 'Reply to send to the customer', 'string') }}\`.

## Resources and operations
${sections.join('\n\n')}

## Installation
Not a verified community node. n8n 3.0 (October 2026) turns \`N8N_UNVERIFIED_PACKAGES_ENABLED\` off by default,
which blocks installing or updating unverified packages without a trusted checksum. Set
\`N8N_UNVERIFIED_PACKAGES_ENABLED=true\` to allow this package through community-package management.
Repository: ${CHATWOOT_REPOSITORY_URL}
`;
}

function describeShape(shape: ChatwootPayloadShape): string {
  return Object.keys(shape)
    .sort()
    .map((key) => {
      const value = shape[key];
      return value === true || Object.keys(value).length > 12 ? key : `${key}{${Object.keys(value).join(', ')}}`;
    })
    .join(', ');
}

function buildTriggerDocumentation(): string {
  // The manualEvents option descriptions say which Chatwoot senders deliver each event
  const deliveredBy = new Map<string, string>(
    (triggerProperty('manualEvents').options ?? []).map((o: any) => [o.value, o.description]),
  );
  const events = CHATWOOT_TRIGGER_MANUAL_EVENTS.map(
    (event) =>
      `- \`${event}\` (${String(deliveredBy.get(event) ?? 'all sources').replace(/\.$/, '')}). ` +
      `Keys: ${describeShape(CHATWOOT_WEBHOOK_PAYLOADS[event] ?? {})}`,
  );

  return `# Chatwoot Trigger (${CHATWOOT_PACKAGE_NAME} ${CHATWOOT_PACKAGE_VERSION})

Starts a workflow on Chatwoot webhook events. The output item is the Chatwoot payload itself, flat, plus
\`event\`: use \`$json.name\` for contact events, \`$json.id\` (conversation display ID) for conversation events
and \`$json.conversation.id\` / \`$json.content\` / \`$json.sender\` for message events. There is no
\`$json.contact\` or \`$json.conversation\` wrapper on contact or conversation events.

## Sources (\`source\`)
- \`accountWebhook\` (default): creates a Chatwoot account webhook on activation (needs an administrator token)
  and verifies X-Chatwoot-Signature. Subscribe with \`events\`: ${CHATWOOT_TRIGGER_EVENTS.map((e) => `\`${e}\``).join(', ')}.
  These are exactly Chatwoot's allowed webhook events; anything else is rejected with HTTP 422.
- \`manual\`: paste the URL into an agent bot, API channel inbox or self-managed webhook, set \`signingSecret\`
  and pick \`manualEvents\` (empty = all). Agent-bot-only events: ${CHATWOOT_AGENT_BOT_ONLY_EVENTS.map((e) => `\`${e}\``).join(', ')}.

## Event payloads (top-level keys, Chatwoot 4.18)
${events.join('\n')}

\`applied_sla\`, \`sla_events\` and \`sla_policy_id\` only exist on Enterprise accounts with the SLA feature.
\`inbox_created\` / \`inbox_updated\` are only sent when the Chatwoot server sets ENABLE_INBOX_EVENTS.
Assignee or team changes arrive as \`conversation_updated\` with \`changed_attributes\`.

## Filters (\`filters\`)
${CHATWOOT_TRIGGER_FILTERS.map((f) => `\`${f}\``).join(', ')}. Use \`messageTypes: ['incoming']\` or
\`ignoreUserIds\` to avoid reply loops. \`ignoreWhatsAppEchoes\` skips outgoing messages whose \`source_id\`
starts with "WAID:" (messages Evolution API imports into Chatwoot), for workflows that answer WhatsApp through
Evolution API, e.g. with the companion package @renatoascencio/n8n-nodes-evolution-api.

## Options (\`options\`)
${CHATWOOT_TRIGGER_OPTIONS.map((o) => `\`${o}\``).join(', ')}. \`includeDeliveryInfo\` adds \`webhookDelivery\`,
\`includeRawBody\` adds the parsed payload object as \`rawBody\`; \`includeRawBodyText\` adds the exact
signed JSON text as \`rawBodyText\` (omitted for inbox events while channel-secret redaction is on).
Unverified deliveries always include top-level \`signatureVerified: false\`.
`;
}

// ============================================================================
// Catalog entries
// ============================================================================

type CatalogNode = ParsedNode & CommunityNodeFields;

const COMMUNITY_FIELDS: CommunityNodeFields = {
  isCommunity: true,
  isVerified: false,
  authorName: CHATWOOT_AUTHOR_NAME,
  authorGithubUrl: CHATWOOT_AUTHOR_GITHUB_URL,
  npmPackageName: CHATWOOT_PACKAGE_NAME,
  npmVersion: CHATWOOT_PACKAGE_VERSION,
};

function toCatalogNode(node: ChatwootSnapshotNode, documentation: string): CatalogNode {
  const { usableAsTool, ...parsed } = node;
  return {
    ...parsed,
    isAITool: usableAsTool,
    hasToolVariant: usableAsTool && !parsed.isTrigger,
    documentation,
    ...COMMUNITY_FIELDS,
  };
}

const MAIN_ENTRY = toCatalogNode(MAIN, buildMainDocumentation());
const TRIGGER_ENTRY = toCatalogNode(TRIGGER, buildTriggerDocumentation());
const TOOL_VARIANT = new ToolVariantGenerator().generateToolVariant(MAIN_ENTRY);

/**
 * Catalog entries: the main node, its AI Agent Tool variant (n8n creates it because of usableAsTool) and the
 * trigger (never a tool).
 */
export const CHATWOOT_CATALOG_NODES: CatalogNode[] = [
  MAIN_ENTRY,
  ...(TOOL_VARIANT ? [{ ...TOOL_VARIANT, ...COMMUNITY_FIELDS }] : []),
  TRIGGER_ENTRY,
];

/**
 * Register Chatwoot community nodes in the database.
 * Returns the number of nodes registered.
 */
export function registerChatwootNodes(repository: NodeRepository): number {
  let count = 0;
  for (const node of CHATWOOT_CATALOG_NODES) {
    repository.saveNode(node);
    count++;
  }
  return count;
}
