import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../src/config/n8n-api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/config/n8n-api')>(),
  getN8nApiConfig: vi.fn(),
  isN8nApiConfigured: vi.fn(),
}));

vi.mock('../src/utils/version', () => ({
  PROJECT_VERSION: '2.33.5-test',
}));

const FIVE_TEMPLATES = [
  { id: 'chatwoot-list-conversations', name: 'List Open Conversations', description: 'd1', category: 'monitoring', difficulty: 'beginner' },
  { id: 'chatwoot-contact-sync', name: 'New Contact Sync', description: 'd2', category: 'contact-sync', difficulty: 'intermediate' },
  { id: 'chatwoot-send-message', name: 'Send Message', description: 'd3', category: 'messaging', difficulty: 'beginner' },
  { id: 'chatwoot-auto-assign', name: 'Auto-Assign Conversations', description: 'd4', category: 'automation', difficulty: 'intermediate' },
  { id: 'chatwoot-public-contact', name: 'Public API Contact', description: 'd5', category: 'messaging', difficulty: 'beginner' },
];

// Template state read by the mocked module (vi.mock factories are hoisted)
const state = vi.hoisted(() => ({
  templates: [] as Array<Record<string, string>>,
  invalid: [] as Array<{ id: string; issues: Array<{ node: string; message: string }> }>,
}));

vi.mock('../src/integrations/chatwoot', () => ({
  ChatwootIntegration: {
    getPackageName: () => '@renatoascencio/n8n-nodes-chatwoot',
    getPackageVersion: () => '0.9.0',
    listTemplates: () => state.templates,
    validateTemplates: () => state.invalid,
    getCapabilitiesSummary: () => 'Chatwoot: 39 resources, 269 operations',
    getInstallationGuide: () => 'N8N_UNVERIFIED_PACKAGES_ENABLED=true',
  },
  ChatwootConnectionValidator: {
    testApplicationApi: vi.fn(),
    testPlatformApi: vi.fn(),
    testPublicApi: vi.fn(),
  },
}));

vi.mock('../src/mcp/handlers-n8n-manager', () => ({
  getN8nApiClient: vi.fn(),
}));

import { handleChatwootDoctor, N8N_3_UNVERIFIED_PACKAGES_NOTICE } from '../src/mcp/handlers-chatwoot';
import { getN8nApiConfig } from '../src/config/n8n-api';
import { getN8nApiClient } from '../src/mcp/handlers-n8n-manager';
import { ChatwootConnectionValidator } from '../src/integrations/chatwoot';

const API_CONFIG = {
  baseUrl: 'https://n8n.example.com',
  apiKey: 'test-key',
  timeout: 30000,
  maxRetries: 3,
};

function connectedClient(n8nVersion: string, credentials = [{ name: 'My Chatwoot', type: 'chatwootApi' }]) {
  vi.mocked(getN8nApiConfig).mockReturnValue(API_CONFIG);
  vi.mocked(getN8nApiClient).mockReturnValue({
    healthCheck: vi.fn().mockResolvedValue({ n8nVersion }),
    listCredentials: vi.fn().mockResolvedValue({ data: credentials }),
  } as any);
}

describe('handleChatwootDoctor', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    state.templates = [...FIVE_TEMPLATES];
    state.invalid = [];
  });

  it('returns server info and template status without n8n API', async () => {
    vi.mocked(getN8nApiConfig).mockReturnValue(null);

    const result = await handleChatwootDoctor({});

    expect(result.success).toBe(true);
    const data = result.data as Record<string, any>;

    // Server info
    expect(data.server.version).toBe('2.33.5-test');
    expect(data.server).toHaveProperty('platform');
    expect(data.server).toHaveProperty('nodeVersion');

    // n8n API not configured
    expect(data.n8nApi.configured).toBe(false);

    // Templates
    expect(data.templates.available).toBe(5);
    expect(data.templates.invalid).toEqual([]);
    expect(data.templates.healthy).toBe(true);
    expect(data.templates).not.toHaveProperty('expected');

    // Summary should report n8n issue
    expect(data.summary.healthy).toBe(false);
    expect(data.summary.issues).toContain('n8n API not configured (N8N_API_URL/N8N_API_KEY missing)');
  });

  it('does not hard-code the number of templates', async () => {
    connectedClient('1.40.0');
    state.templates = [
      ...FIVE_TEMPLATES,
      { id: 'chatwoot-ai-agent', name: 'AI Agent', description: 'd6', category: 'ai', difficulty: 'advanced' },
    ];

    const data = (await handleChatwootDoctor({})).data as Record<string, any>;

    expect(data.templates.available).toBe(6);
    expect(data.templates.healthy).toBe(true);
    expect(data.summary.healthy).toBe(true);
    expect(JSON.stringify(data.summary.issues)).not.toContain('Expected 5 templates');
  });

  it('reports templates that do not match the node catalog', async () => {
    connectedClient('1.40.0');
    state.invalid = [
      { id: 'chatwoot-send-message', issues: [{ node: 'Send Message', message: '"messageType" is not a parameter of message > create' }] },
    ];

    const data = (await handleChatwootDoctor({})).data as Record<string, any>;

    expect(data.templates.healthy).toBe(false);
    expect(data.templates.invalid[0].issues[0].message).toContain('messageType');
    expect(data.summary.healthy).toBe(false);
    expect(data.summary.issues).toContain(
      'Template chatwoot-send-message does not match the Chatwoot node catalog (1 issues)',
    );
  });

  it('reports a missing template set', async () => {
    connectedClient('1.40.0');
    state.templates = [];

    const data = (await handleChatwootDoctor({})).data as Record<string, any>;

    expect(data.templates.healthy).toBe(false);
    expect(data.summary.issues).toContain('No Chatwoot workflow templates available');
  });

  it('checks n8n API connectivity when configured', async () => {
    vi.mocked(getN8nApiConfig).mockReturnValue(API_CONFIG);
    vi.mocked(getN8nApiClient).mockReturnValue({
      healthCheck: vi.fn().mockResolvedValue({ n8nVersion: '1.40.0' }),
      listCredentials: vi.fn().mockResolvedValue({
        data: [
          { name: 'My Chatwoot', type: 'chatwootApi' },
          { name: 'Other', type: 'googleApi' },
        ],
      }),
    } as any);

    const result = await handleChatwootDoctor({});
    const data = result.data as Record<string, any>;

    expect(data.n8nApi.configured).toBe(true);
    expect(data.n8nApi.connected).toBe(true);
    expect(data.n8nApi.n8nVersion).toBe('1.40.0');
    // API key must NOT appear
    expect(JSON.stringify(data)).not.toContain('test-key');

    expect(data.chatwootNode.checked).toBe(true);
    expect(data.chatwootNode.credentialsFound).toBe(1);
    expect(data.chatwootNode.credentialTypes).toEqual([
      { name: 'My Chatwoot', type: 'chatwootApi' },
    ]);

    expect(data.summary.healthy).toBe(true);
    expect(data.summary.advisories).toEqual([]);
  });

  it('reports the catalog version and n8n 3.0 verification status', async () => {
    vi.mocked(getN8nApiConfig).mockReturnValue(null);

    const data = (await handleChatwootDoctor({})).data as Record<string, any>;

    expect(data.chatwootNode.catalogVersion).toBe('0.9.0');
    expect(data.chatwootNode.verifiedByN8n).toBe(false);
    expect(data.chatwootNode.n8n3Notice).toBe(N8N_3_UNVERIFIED_PACKAGES_NOTICE);
    expect(N8N_3_UNVERIFIED_PACKAGES_NOTICE).toContain('N8N_UNVERIFIED_PACKAGES_ENABLED=true');
  });

  it('adds the unverified packages advisory on n8n 3.x without failing the check', async () => {
    connectedClient('3.0.1');

    const data = (await handleChatwootDoctor({})).data as Record<string, any>;

    expect(data.summary.advisories).toEqual([N8N_3_UNVERIFIED_PACKAGES_NOTICE]);
    expect(data.summary.healthy).toBe(true);
  });

  it('reports unreachable n8n API', async () => {
    vi.mocked(getN8nApiConfig).mockReturnValue(API_CONFIG);
    vi.mocked(getN8nApiClient).mockReturnValue({
      healthCheck: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    } as any);

    const result = await handleChatwootDoctor({});
    const data = result.data as Record<string, any>;

    expect(data.n8nApi.connected).toBe(false);
    expect(data.n8nApi.error).toBeDefined();
    expect(data.summary.issues).toContain('n8n API configured but not reachable');
  });

  it('tests Chatwoot API when baseUrl and token provided', async () => {
    vi.mocked(getN8nApiConfig).mockReturnValue(null);
    vi.mocked(ChatwootConnectionValidator.testApplicationApi).mockResolvedValue({
      success: true,
      apiType: 'application',
      message: 'Application API connection successful',
      details: { status: 200 },
    });

    const result = await handleChatwootDoctor({
      chatwootBaseUrl: 'https://chatwoot.example.com',
      chatwootAccountId: '1',
      chatwootToken: 'secret-token-value',
    });
    const data = result.data as Record<string, any>;

    expect(data.chatwootApi).toBeDefined();
    expect(data.chatwootApi.applicationApi.success).toBe(true);
    expect(ChatwootConnectionValidator.testApplicationApi).toHaveBeenCalledWith(
      'https://chatwoot.example.com',
      '1',
      'secret-token-value',
      'user',
    );
    // Token must NOT appear in output
    expect(JSON.stringify(data)).not.toContain('secret-token-value');
  });

  it('tests agent bot tokens, the Platform API and the Public API when asked', async () => {
    vi.mocked(getN8nApiConfig).mockReturnValue(null);
    vi.mocked(ChatwootConnectionValidator.testApplicationApi).mockResolvedValue({
      success: true, apiType: 'application', message: 'ok', details: { status: 404 },
    });
    vi.mocked(ChatwootConnectionValidator.testPlatformApi).mockResolvedValue({
      success: false, apiType: 'platform', message: 'Authentication failed (401 Unauthorized)', details: { status: 401 },
    });
    vi.mocked(ChatwootConnectionValidator.testPublicApi).mockRejectedValue(
      new Error('api_access_token: abcdefghijklmnopqrstuvwxyz failed'),
    );

    const data = (await handleChatwootDoctor({
      chatwootBaseUrl: 'https://chatwoot.example.com',
      chatwootAccountId: '1',
      chatwootToken: 'bot-token',
      chatwootTokenType: 'agentBot',
      chatwootPlatformToken: 'platform-secret',
      chatwootInboxIdentifier: 'inbox-abc',
    })).data as Record<string, any>;

    expect(ChatwootConnectionValidator.testApplicationApi).toHaveBeenCalledWith(
      'https://chatwoot.example.com', '1', 'bot-token', 'agentBot',
    );
    expect(ChatwootConnectionValidator.testPlatformApi).toHaveBeenCalledWith('https://chatwoot.example.com', 'platform-secret');
    expect(ChatwootConnectionValidator.testPublicApi).toHaveBeenCalledWith('https://chatwoot.example.com', 'inbox-abc');
    expect(data.chatwootApi.applicationApi).toEqual({ success: true, message: 'ok', status: 404 });
    expect(data.chatwootApi.platformApi).toEqual({ success: false, message: 'Authentication failed (401 Unauthorized)', status: 401 });
    expect(data.chatwootApi.publicApi.success).toBe(false);
    expect(data.chatwootApi.publicApi.message).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(JSON.stringify(data)).not.toContain('platform-secret');
    expect(JSON.stringify(data)).not.toContain('bot-token');
  });

  it('includes debug info in verbose mode', async () => {
    vi.mocked(getN8nApiConfig).mockReturnValue(null);

    const result = await handleChatwootDoctor({ verbose: true });
    const data = result.data as Record<string, any>;

    expect(data.debug).toBeDefined();
    expect(data.debug.chatwootCapabilities).toContain('39 resources');
    expect(data.debug.installationGuide).toContain('N8N_UNVERIFIED_PACKAGES_ENABLED');
  });

  it('sanitizes error messages containing tokens', async () => {
    vi.mocked(getN8nApiConfig).mockReturnValue(API_CONFIG);
    vi.mocked(getN8nApiClient).mockReturnValue({
      healthCheck: vi.fn().mockRejectedValue(
        new Error('api_access_token: abc123def456ghi789jklmnop request failed'),
      ),
    } as any);

    const result = await handleChatwootDoctor({});
    const data = result.data as Record<string, any>;

    // Raw token must not be in output
    expect(data.n8nApi.error).not.toContain('abc123def456ghi789jklmnop');
    expect(data.n8nApi.error).toContain('***');
  });

  it('reports missing credentials when n8n connected but no chatwoot creds', async () => {
    connectedClient('1.40.0', [{ name: 'Google', type: 'googleApi' }]);

    const result = await handleChatwootDoctor({});
    const data = result.data as Record<string, any>;

    expect(data.chatwootNode.credentialsFound).toBe(0);
    expect(data.summary.issues).toContain('No Chatwoot credentials found in n8n instance');
  });

  it('uses instance credentials when environment configuration is absent', async () => {
    connectedClient('3.0.0');
    vi.mocked(getN8nApiConfig).mockReturnValue(null);
    const context = { n8nApiUrl: 'https://tenant.example.com', n8nApiKey: 'tenant-key' };

    const data = (await handleChatwootDoctor({}, context)).data as Record<string, any>;

    expect(getN8nApiClient).toHaveBeenCalledWith(context);
    expect(data.n8nApi).toMatchObject({ configured: true, connected: true, baseUrl: context.n8nApiUrl });
    expect(data.summary.healthy).toBe(true);
    expect(JSON.stringify(data)).not.toContain(context.n8nApiKey);
  });

  it('does not claim installation is verified from a stored credential', async () => {
    connectedClient('2.40.7');
    const data = (await handleChatwootDoctor({})).data as Record<string, any>;
    expect(data.chatwootNode.credentialsFound).toBe(1);
    expect(data.chatwootNode.installationVerified).toBe(false);
    expect(data.chatwootNode.note).toContain('does not verify package installation');
  });

  it('reports credential lookup failures in the summary', async () => {
    connectedClient('2.40.7');
    vi.mocked(getN8nApiClient)()!.listCredentials = vi.fn().mockRejectedValue(new Error('Forbidden'));
    const data = (await handleChatwootDoctor({})).data as Record<string, any>;
    expect(data.chatwootNode.error).toBe('Forbidden');
    expect(data.summary.healthy).toBe(false);
    expect(data.summary.issues).toContain('Could not check Chatwoot credentials in n8n instance');
  });

  it.each(['application', 'platform', 'public'] as const)('includes failed %s API checks in the summary', async (api) => {
    connectedClient('2.40.7');
    vi.mocked(ChatwootConnectionValidator.testApplicationApi).mockResolvedValue({ success: false, apiType: 'application', message: 'Rejected' });
    vi.mocked(ChatwootConnectionValidator.testPlatformApi).mockResolvedValue({ success: false, apiType: 'platform', message: 'Rejected' });
    vi.mocked(ChatwootConnectionValidator.testPublicApi).mockResolvedValue({ success: false, apiType: 'public', message: 'Rejected' });
    const args = api === 'application' ? { chatwootToken: 'secret', chatwootAccountId: '1' }
      : api === 'platform' ? { chatwootPlatformToken: 'secret' } : { chatwootInboxIdentifier: 'inbox' };

    const data = (await handleChatwootDoctor({ chatwootBaseUrl: 'https://chat.example.com', ...args })).data as Record<string, any>;

    expect(data.chatwootApi[`${api}Api`].success).toBe(false);
    expect(data.summary.healthy).toBe(false);
    expect(data.summary.issues).toEqual([`Chatwoot ${api[0].toUpperCase() + api.slice(1)} API check failed`]);
  });

  it.each([false, true])('redacts supplied short tokens from returned or thrown messages (throws=%s)', async (throws) => {
    connectedClient('2.40.7');
    const method = vi.mocked(ChatwootConnectionValidator.testPlatformApi);
    if (throws) method.mockRejectedValue(new Error('Rejected p!s/word'));
    else method.mockResolvedValue({ success: false, apiType: 'platform', message: 'Rejected p!s/word' });

    const data = (await handleChatwootDoctor({ chatwootBaseUrl: 'https://chat.example.com', chatwootPlatformToken: 'p!s/word' })).data as Record<string, any>;

    expect(data.chatwootApi.platformApi.message).toBe('Rejected ***');
    expect(JSON.stringify(data)).not.toContain('p!s/word');
  });

  it('reports checks skipped because a required connection input is missing', async () => {
    connectedClient('2.40.7');
    const noUrl = (await handleChatwootDoctor({ chatwootPlatformToken: 'secret' })).data as Record<string, any>;
    expect(noUrl.summary.healthy).toBe(false);
    expect(noUrl.summary.issues).toContain('Chatwoot API checks require chatwootBaseUrl');
    const noAccount = (await handleChatwootDoctor({ chatwootBaseUrl: 'https://chat.example.com', chatwootToken: 'secret' })).data as Record<string, any>;
    expect(noAccount.summary.healthy).toBe(false);
    expect(noAccount.summary.issues).toContain('Chatwoot Application API check requires chatwootAccountId');
    expect(ChatwootConnectionValidator.testApplicationApi).not.toHaveBeenCalled();
    expect(ChatwootConnectionValidator.testPlatformApi).not.toHaveBeenCalled();
  });
});
