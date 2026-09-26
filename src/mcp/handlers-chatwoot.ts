/**
 * Chatwoot MCP Tool Handlers
 *
 * Implements the chatwoot_doctor diagnostic tool that validates
 * the full Chatwoot integration stack: MCP server, n8n API,
 * Chatwoot node installation, credentials, catalog and templates.
 */

import { McpToolResponse } from '../types/n8n-api';
import { InstanceContext } from '../types/instance-context';
import { ChatwootIntegration } from '../integrations/chatwoot';
import { ChatwootConnectionValidator } from '../integrations/chatwoot';
import { getN8nApiConfig, getN8nApiConfigFromContext } from '../config/n8n-api';
import { PROJECT_VERSION } from '../utils/version';
import { logger } from '../utils/logger';

interface ChatwootDoctorArgs {
  chatwootBaseUrl?: string;
  chatwootAccountId?: string;
  chatwootToken?: string;
  chatwootTokenType?: 'user' | 'agentBot';
  chatwootPlatformToken?: string;
  chatwootInboxIdentifier?: string;
  verbose?: boolean;
}

/** n8n 3.0 turns N8N_UNVERIFIED_PACKAGES_ENABLED off by default (docs: n8n 3.0 breaking changes) */
export const N8N_3_UNVERIFIED_PACKAGES_NOTICE =
  'n8n 3.0 changes the default of N8N_UNVERIFIED_PACKAGES_ENABLED to false: installing or updating this ' +
  'unverified community package (UI, N8N_COMMUNITY_PACKAGES, reinstalling missing packages) is refused ' +
  'unless N8N_UNVERIFIED_PACKAGES_ENABLED=true (env-managed installs may instead pin a trusted checksum). ' +
  'Installed packages keep loading.';

function majorVersion(version: unknown): number | undefined {
  const match = typeof version === 'string' ? /^v?(\d+)\./.exec(version) : null;
  return match ? Number(match[1]) : undefined;
}

export async function handleChatwootDoctor(
  args: ChatwootDoctorArgs,
  context?: InstanceContext,
): Promise<McpToolResponse> {
  const startTime = Date.now();
  const report: Record<string, unknown> = {};
  const advisories: string[] = [];
  const connectionIssues: string[] = [];
  const apiConfig = (context && getN8nApiConfigFromContext(context)) || getN8nApiConfig();
  const secrets = [args.chatwootToken, args.chatwootPlatformToken, apiConfig?.apiKey]
    .filter((value): value is string => !!value);
  const sanitize = (error: unknown) => sanitizeErrorMessage(error, secrets);

  // 1. MCP Server Info
  report.server = {
    version: PROJECT_VERSION,
    isDocker: process.env.IS_DOCKER === 'true',
    mcpMode: process.env.MCP_MODE || 'stdio',
    nodeVersion: process.version,
    platform: process.platform,
    timestamp: new Date().toISOString(),
  };

  // 2. n8n API Connectivity
  const n8nApiStatus: Record<string, unknown> = {
    configured: apiConfig !== null,
    baseUrl: apiConfig?.baseUrl ?? null,
  };

  if (apiConfig) {
    try {
      const { getN8nApiClient } = await import('./handlers-n8n-manager');
      const client = getN8nApiClient(context);
      if (client) {
        const health = await client.healthCheck();
        n8nApiStatus.connected = true;
        n8nApiStatus.n8nVersion = health.n8nVersion || 'unknown';
      } else {
        n8nApiStatus.connected = false;
        n8nApiStatus.error = 'Could not create API client';
      }
    } catch (error) {
      n8nApiStatus.connected = false;
      n8nApiStatus.error = sanitize(error);
    }
  }
  report.n8nApi = n8nApiStatus;

  // 3. Chatwoot Node Installation (credentials check via n8n API)
  const nodeInstallation: Record<string, unknown> = {
    packageName: ChatwootIntegration.getPackageName(),
    catalogVersion: ChatwootIntegration.getPackageVersion(),
    verifiedByN8n: false,
    n8n3Notice: N8N_3_UNVERIFIED_PACKAGES_NOTICE,
    installationVerified: false,
    note: 'Credential presence does not verify package installation or its installed version.',
    checked: false,
  };

  if (apiConfig && n8nApiStatus.connected) {
    try {
      const { getN8nApiClient } = await import('./handlers-n8n-manager');
      const client = getN8nApiClient(context);
      if (client) {
        const credResponse = await client.listCredentials();
        const chatwootCreds = credResponse.data.filter(
          (c) =>
            c.type === 'chatwootApi' ||
            c.type === 'chatwootPlatformApi' ||
            c.type === 'chatwootPublicApi',
        );
        nodeInstallation.checked = true;
        nodeInstallation.credentialsFound = chatwootCreds.length;
        nodeInstallation.credentialTypes = chatwootCreds.map((c) => ({
          name: c.name,
          type: c.type,
        }));
      }
    } catch (error) {
      nodeInstallation.checked = true;
      nodeInstallation.error = sanitize(error);
    }
  }
  report.chatwootNode = nodeInstallation;

  const n8nMajor = majorVersion(n8nApiStatus.n8nVersion);
  if (n8nMajor !== undefined && n8nMajor >= 3) {
    advisories.push(N8N_3_UNVERIFIED_PACKAGES_NOTICE);
  }

  // 4. Templates: every Chatwoot parameter and trigger payload path is checked against the node catalog
  const templates = ChatwootIntegration.listTemplates();
  const invalidTemplates = ChatwootIntegration.validateTemplates();
  report.templates = {
    available: templates.length,
    invalid: invalidTemplates,
    healthy: templates.length > 0 && invalidTemplates.length === 0,
    list: templates.map((t) => ({ id: t.id, name: t.name, category: t.category })),
  };

  // 5. Chatwoot API Connectivity (optional)
  if (args.chatwootBaseUrl) {
    const chatwootApi: Record<string, unknown> = {
      baseUrl: args.chatwootBaseUrl,
      tokenProvided: !!args.chatwootToken,
      accountIdProvided: !!args.chatwootAccountId,
    };

    const summarize = (result: Awaited<ReturnType<typeof ChatwootConnectionValidator.testPlatformApi>>) => ({
      success: result.success,
      message: sanitize(result.message),
      ...(result.details ? { status: result.details.status } : {}),
    });
    const safely = async (api: string, test: () => ReturnType<typeof ChatwootConnectionValidator.testPlatformApi>) => {
      try {
        const result = summarize(await test());
        if (!result.success) connectionIssues.push(`Chatwoot ${api} check failed`);
        return result;
      } catch (error) {
        connectionIssues.push(`Chatwoot ${api} check failed`);
        return { success: false, message: sanitize(error) };
      }
    };

    if (args.chatwootToken && args.chatwootAccountId) {
      chatwootApi.applicationApi = await safely('Application API', () =>
        ChatwootConnectionValidator.testApplicationApi(
          args.chatwootBaseUrl!,
          args.chatwootAccountId!,
          args.chatwootToken!,
          args.chatwootTokenType ?? 'user',
        ),
      );
    } else if (args.chatwootToken) {
      chatwootApi.note =
        'Provide both chatwootAccountId and chatwootToken to test Application API';
      connectionIssues.push('Chatwoot Application API check requires chatwootAccountId');
    }

    if (args.chatwootPlatformToken) {
      chatwootApi.platformApi = await safely('Platform API', () =>
        ChatwootConnectionValidator.testPlatformApi(args.chatwootBaseUrl!, args.chatwootPlatformToken!),
      );
    }

    if (args.chatwootInboxIdentifier) {
      chatwootApi.publicApi = await safely('Public API', () =>
        ChatwootConnectionValidator.testPublicApi(args.chatwootBaseUrl!, args.chatwootInboxIdentifier!),
      );
    }

    report.chatwootApi = chatwootApi;
  } else if (args.chatwootToken || args.chatwootPlatformToken || args.chatwootInboxIdentifier) {
    connectionIssues.push('Chatwoot API checks require chatwootBaseUrl');
  }

  // 6. Summary
  const issues: string[] = [...connectionIssues];
  if (!apiConfig) issues.push('n8n API not configured (N8N_API_URL/N8N_API_KEY missing)');
  if (apiConfig && !n8nApiStatus.connected)
    issues.push('n8n API configured but not reachable');
  if (nodeInstallation.error) issues.push('Could not check Chatwoot credentials in n8n instance');
  if (
    nodeInstallation.checked &&
    (nodeInstallation.credentialsFound as number) === 0
  ) {
    issues.push('No Chatwoot credentials found in n8n instance');
  }
  if (templates.length === 0) {
    issues.push('No Chatwoot workflow templates available');
  }
  for (const template of invalidTemplates) {
    issues.push(`Template ${template.id} does not match the Chatwoot node catalog (${template.issues.length} issues)`);
  }

  report.summary = {
    healthy: issues.length === 0,
    issueCount: issues.length,
    issues,
    advisories,
    responseTimeMs: Date.now() - startTime,
  };

  // Verbose debug
  if (args.verbose) {
    report.debug = {
      envKeys: Object.keys(process.env).filter(
        (k) =>
          k.startsWith('N8N_') ||
          k.startsWith('MCP_') ||
          k.startsWith('CHATWOOT_') ||
          k === 'IS_DOCKER',
      ),
      chatwootCapabilities: ChatwootIntegration.getCapabilitiesSummary(),
      installationGuide: ChatwootIntegration.getInstallationGuide(),
    };
  }

  logger.info('chatwoot_doctor completed', {
    healthy: issues.length === 0,
    issueCount: issues.length,
    responseTimeMs: Date.now() - startTime,
  });

  return { success: true, data: report };
}

/** Sanitize error messages to prevent secret leakage */
function sanitizeErrorMessage(error: unknown, secrets: string[] = []): string {
  let msg = error instanceof Error ? error.message : String(error);
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    msg = msg.split(secret).join('***');
  }
  return msg
    .replace(/api_access_token[=:]\s*\S+/gi, 'api_access_token=***')
    .replace(/token[=:]\s*[A-Za-z0-9_\-]{20,}/gi, 'token=***')
    .replace(/key[=:]\s*[A-Za-z0-9_\-]{20,}/gi, 'key=***')
    .replace(/Bearer\s+\S+/gi, 'Bearer ***');
}
