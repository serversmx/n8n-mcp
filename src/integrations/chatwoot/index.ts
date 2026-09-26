/**
 * Chatwoot Integration for n8n-MCP
 *
 * Provides the node catalog, workflow templates and helpers for the @renatoascencio/n8n-nodes-chatwoot
 * community node. Enables AI agents to quickly scaffold Chatwoot-powered workflows.
 */

export { ChatwootIntegration } from './chatwoot-integration';
export type { ChatwootConfig } from './chatwoot-integration';
export { CHATWOOT_WORKFLOW_TEMPLATES } from './workflow-templates';
export type { ChatwootWorkflowTemplate } from './workflow-templates';
export { ChatwootConnectionValidator } from './connection-validator';
export type { ChatwootTokenType, ConnectionTestResult } from './connection-validator';
export {
  CHATWOOT_CATALOG_NODES,
  CHATWOOT_NODE_TYPES,
  CHATWOOT_OPERATIONS,
  CHATWOOT_OPERATION_COUNT,
  CHATWOOT_PACKAGE_NAME,
  CHATWOOT_PACKAGE_VERSION,
  CHATWOOT_RESOURCES,
  CHATWOOT_TRIGGER_EVENTS,
  CHATWOOT_TRIGGER_MANUAL_EVENTS,
  CHATWOOT_USABLE_AS_TOOL,
  CHATWOOT_WEBHOOK_PAYLOADS,
  getChatwootOperationParameters,
  registerChatwootNodes,
} from './chatwoot-node-catalog';
export { validateChatwootWorkflow } from './template-validator';
export type { ChatwootWorkflowIssue } from './template-validator';
