/**
 * Chatwoot Integration for n8n-MCP
 *
 * Main integration module that provides:
 * - Node detection (is @renatoascencio/n8n-nodes-chatwoot used in a workflow?)
 * - Workflow template generation and checking
 * - Connection validation
 * - Installation guidance (n8n 2.x and 3.0)
 */

import { CHATWOOT_WORKFLOW_TEMPLATES, ChatwootWorkflowTemplate } from './workflow-templates';
import { ChatwootConnectionValidator, ChatwootTokenType, ConnectionTestResult } from './connection-validator';
import {
  CHATWOOT_AGENT_BOT_ONLY_EVENTS,
  CHATWOOT_CREDENTIALS,
  CHATWOOT_NODE_TYPES,
  CHATWOOT_OPERATIONS,
  CHATWOOT_OPERATION_COUNT,
  CHATWOOT_PACKAGE_NAME,
  CHATWOOT_PACKAGE_VERSION,
  CHATWOOT_RESOURCES,
  CHATWOOT_TRIGGER_EVENTS,
  CHATWOOT_TRIGGER_FILTERS,
  CHATWOOT_TRIGGER_OPTIONS,
  CHATWOOT_USABLE_AS_TOOL,
  ChatwootApiType,
} from './chatwoot-node-catalog';
import { ChatwootWorkflowIssue, validateChatwootWorkflow } from './template-validator';

export interface ChatwootConfig {
  baseUrl?: string;
  accountId?: string | number;
  token?: string;
  /** 'user' (default) or 'agentBot', like the Token Type of the Chatwoot API credential */
  tokenType?: ChatwootTokenType;
  platformToken?: string;
  inboxIdentifier?: string;
}

export class ChatwootIntegration {
  private static readonly PACKAGE_NAME = CHATWOOT_PACKAGE_NAME;
  private static readonly NODE_TYPE = CHATWOOT_NODE_TYPES.main;
  private static readonly TOOL_TYPE = CHATWOOT_NODE_TYPES.tool;
  private static readonly TRIGGER_TYPE = CHATWOOT_NODE_TYPES.trigger;

  /**
   * Get installation instructions for the Chatwoot community node
   */
  static getInstallationGuide(): string {
    const pkg = this.PACKAGE_NAME;
    const version = CHATWOOT_PACKAGE_VERSION;
    const credentials = CHATWOOT_CREDENTIALS.map((credential) => {
      const fields = credential.properties
        .filter((p) => p.type !== 'notice')
        .map((p) => `\`${p.name}\`${p.required ? '' : ' (optional)'}`)
        .join(', ');
      return `- **${credential.displayName}** (\`${credential.name}\`): ${fields}`;
    });

    return `
## Installing the Chatwoot Community Node (${pkg} ${version})

The package is **not verified by n8n**. n8n 3.0 (scheduled for October 2026) changes the default of
\`N8N_UNVERIFIED_PACKAGES_ENABLED\` from \`true\` to \`false\`: installing or updating unverified community
packages (Settings > Community Nodes, env-managed packages, reinstalling missing packages) is then refused
until you set \`N8N_UNVERIFIED_PACKAGES_ENABLED=true\` (env-managed installs can instead pin a trusted
package checksum). Packages that are already installed keep loading.
Set the variable before upgrading to n8n 3.0 if you want to keep installing or updating this node.

### Option 1: n8n UI
1. Go to **Settings > Community Nodes** in your n8n instance
2. Click **Install**
3. Enter: \`${pkg}\`
4. Accept the risks and click **Install**

### Option 2: Docker, managed by environment variables
Requires n8n 2.21.0 or newer. n8n reconciles the listed packages on every start (installs missing ones, fixes versions, uninstalls others;
the Community Nodes UI is locked in this mode):
\`\`\`yaml
environment:
  - N8N_COMMUNITY_PACKAGES_MANAGED_BY_ENV=true
  - 'N8N_COMMUNITY_PACKAGES=[{"name":"${pkg}","version":"${version}"}]'
  - N8N_UNVERIFIED_PACKAGES_ENABLED=true   # required from n8n 3.0 on
\`\`\`
Include every community package you want to keep in this list before enabling environment management.

### Option 3: npm into the n8n nodes folder
\`\`\`bash
# Inside the n8n container (or ~/.n8n/nodes on the host running n8n)
docker exec -it n8n sh -c "mkdir -p /home/node/.n8n/nodes && cd /home/node/.n8n/nodes && npm install ${pkg}@${version}"
docker restart n8n
\`\`\`
n8n 3.0 only supports Docker-based self-hosting, so run this inside the container (the folder must be on a volume).

### Not supported: N8N_CUSTOM_EXTENSIONS with a package name
\`N8N_CUSTOM_EXTENSIONS\` takes directory paths separated by \`;\` (folders with built \`*.node.js\` /
\`*.credentials.js\` files), not npm package names: \`N8N_CUSTOM_EXTENSIONS=${pkg}\` loads nothing.
Nodes loaded from a custom directory are also registered as \`CUSTOM.chatwoot\` / \`CUSTOM.chatwootTrigger\`
instead of \`${this.NODE_TYPE}\`, so the workflows and templates here would not match them.

### After Installation
Create the n8n credential of the Chatwoot API you use (Credentials > Add Credential):
${credentials.join('\n')}

The Chatwoot node is also available to AI Agents as **Chatwoot Tool** (\`${this.TOOL_TYPE}\`).
`.trim();
  }

  /**
   * List all available workflow templates
   */
  static listTemplates(): { id: string; name: string; description: string; category: string; difficulty: string }[] {
    return CHATWOOT_WORKFLOW_TEMPLATES.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
      difficulty: t.difficulty,
    }));
  }

  /**
   * Get a specific workflow template by ID
   */
  static getTemplate(templateId: string): ChatwootWorkflowTemplate | undefined {
    return CHATWOOT_WORKFLOW_TEMPLATES.find((t) => t.id === templateId);
  }

  /**
   * Get all templates for a specific category
   */
  static getTemplatesByCategory(category: string): ChatwootWorkflowTemplate[] {
    return CHATWOOT_WORKFLOW_TEMPLATES.filter((t) => t.category === category);
  }

  /**
   * Check the Chatwoot nodes of a workflow (parameters, trigger events, payload paths) against the catalog
   */
  static validateWorkflow(workflow: Record<string, unknown>): ChatwootWorkflowIssue[] {
    return validateChatwootWorkflow(workflow as Parameters<typeof validateChatwootWorkflow>[0]);
  }

  /**
   * Check every bundled template; returns the templates with issues
   */
  static validateTemplates(): { id: string; issues: ChatwootWorkflowIssue[] }[] {
    return CHATWOOT_WORKFLOW_TEMPLATES.map((t) => ({ id: t.id, issues: this.validateWorkflow(t.workflow) }))
      .filter((result) => result.issues.length > 0);
  }

  /**
   * Validate connection to Chatwoot
   */
  static async validateConnection(config: ChatwootConfig): Promise<ConnectionTestResult[]> {
    if (!config.baseUrl) {
      return [{ success: false, apiType: 'application', message: 'baseUrl is required' }];
    }

    return ChatwootConnectionValidator.testAll({
      baseUrl: config.baseUrl,
      accountId: config.accountId,
      token: config.token,
      tokenType: config.tokenType,
      platformToken: config.platformToken,
      inboxIdentifier: config.inboxIdentifier,
    });
  }

  /**
   * Check if the Chatwoot node (main, tool or trigger) is referenced in a workflow
   */
  static isUsedInWorkflow(workflow: Record<string, unknown>): boolean {
    const nodes = workflow.nodes as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(nodes)) return false;

    const types: string[] = [this.NODE_TYPE, this.TOOL_TYPE, this.TRIGGER_TYPE];
    return nodes.some((node) => node != null && typeof node.type === 'string' && types.includes(node.type));
  }

  /**
   * Get the Chatwoot node type strings for use in n8n
   */
  static getNodeTypes(): { main: string; tool: string; trigger: string } {
    return {
      main: this.NODE_TYPE,
      tool: this.TOOL_TYPE,
      trigger: this.TRIGGER_TYPE,
    };
  }

  /**
   * Get the npm package name
   */
  static getPackageName(): string {
    return this.PACKAGE_NAME;
  }

  /**
   * Get the node package version the catalog was generated from
   */
  static getPackageVersion(): string {
    return CHATWOOT_PACKAGE_VERSION;
  }

  /**
   * Get a summary of Chatwoot node capabilities
   */
  static getCapabilitiesSummary(): string {
    const byApi = (api: ChatwootApiType) => CHATWOOT_RESOURCES.filter((r) => r.api === api);
    const list = (api: ChatwootApiType) =>
      byApi(api).map((r) => `${r.name} (${CHATWOOT_OPERATIONS[r.value].length})`).join(', ');

    return `
## Chatwoot Node Capabilities

**Package:** ${this.PACKAGE_NAME} ${CHATWOOT_PACKAGE_VERSION}
**Resources:** ${CHATWOOT_RESOURCES.length} | **Operations:** ${CHATWOOT_OPERATION_COUNT} | **API Types:** 3
**AI Agent tool:** ${CHATWOOT_USABLE_AS_TOOL ? `yes (${this.TOOL_TYPE})` : 'no'}

### Application API (${byApi('application').length} resources)
${list('application')}

### Platform API (${byApi('platform').length} resources)
${list('platform')}

### Public API (${byApi('public').length} resources)
${list('public')}

### Chatwoot Trigger
- Account webhook events: ${CHATWOOT_TRIGGER_EVENTS.join(', ')}
- Agent bot / API channel (manual URL) source adds: ${CHATWOOT_AGENT_BOT_ONLY_EVENTS.join(', ')}
- Filters: ${CHATWOOT_TRIGGER_FILTERS.join(', ')}
- Options: ${CHATWOOT_TRIGGER_OPTIONS.join(', ')}
- Verifies X-Chatwoot-Signature; output items are the flat Chatwoot payload plus \`event\`

### Credentials
${CHATWOOT_CREDENTIALS.map((c) => `- ${c.displayName} (\`${c.name}\`)`).join('\n')}
`.trim();
  }
}
