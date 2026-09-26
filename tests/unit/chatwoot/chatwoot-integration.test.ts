import { describe, it, expect, vi, afterEach } from 'vitest';
import { ChatwootIntegration } from '@/integrations/chatwoot/chatwoot-integration';
import { ChatwootConnectionValidator } from '@/integrations/chatwoot/connection-validator';

describe('ChatwootIntegration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getInstallationGuide', () => {
    const guide = ChatwootIntegration.getInstallationGuide();

    it('documents env-managed installation with the catalog version', () => {
      expect(guide).toContain('N8N_COMMUNITY_PACKAGES_MANAGED_BY_ENV=true');
      expect(guide).toContain(
        `N8N_COMMUNITY_PACKAGES=[{"name":"@renatoascencio/n8n-nodes-chatwoot","version":"${ChatwootIntegration.getPackageVersion()}"}]`,
      );
    });

    it('warns about the n8n 3.0 unverified packages default', () => {
      expect(guide).toContain('n8n 3.0');
      expect(guide).toContain('N8N_UNVERIFIED_PACKAGES_ENABLED=true');
      expect(guide).toContain('not verified');
    });

    it('does not recommend N8N_CUSTOM_EXTENSIONS with a package name', () => {
      expect(guide).not.toMatch(/^\s*-\s*N8N_CUSTOM_EXTENSIONS=/m);
      expect(guide).toContain('takes directory paths');
      expect(guide).toContain('CUSTOM.chatwoot');
    });

    it('lists the credential fields of the node and the AI tool', () => {
      expect(guide).toContain('`accountId`');
      expect(guide).toContain('`inboxIdentifier`');
      expect(guide).toContain('`hmacToken` (optional)');
      expect(guide).toContain('@renatoascencio/n8n-nodes-chatwoot.chatwootTool');
    });

    it('documents the env-management version and preserving other installed packages', () => {
      expect(guide).toContain('n8n 2.21.0 or newer');
      expect(guide).toContain('Include every community package you want to keep');
      expect(guide).toContain('mkdir -p /home/node/.n8n/nodes');
    });
  });

  describe('getCapabilitiesSummary', () => {
    const summary = ChatwootIntegration.getCapabilitiesSummary();

    it('derives the counts from the catalog', () => {
      expect(summary).toContain('**Resources:** 39');
      expect(summary).not.toContain('**Resources:** 27');
      expect(summary).toMatch(/\*\*Operations:\*\* \d{3}/);
      expect(summary).toContain('### Application API (31 resources)');
      expect(summary).toContain('### Platform API (4 resources)');
      expect(summary).toContain('### Public API (4 resources)');
    });

    it('describes the AI tool and the trigger', () => {
      expect(summary).toContain('**AI Agent tool:** yes');
      expect(summary).toContain('conversation_typing_on');
      expect(summary).not.toContain('conversation_assignee_changed');
      expect(summary).toContain('ignoreWhatsAppEchoes');
    });
  });

  describe('node types', () => {
    it('returns main, tool and trigger node types', () => {
      expect(ChatwootIntegration.getNodeTypes()).toEqual({
        main: '@renatoascencio/n8n-nodes-chatwoot.chatwoot',
        tool: '@renatoascencio/n8n-nodes-chatwoot.chatwootTool',
        trigger: '@renatoascencio/n8n-nodes-chatwoot.chatwootTrigger',
      });
      expect(ChatwootIntegration.getPackageName()).toBe('@renatoascencio/n8n-nodes-chatwoot');
    });

    it('detects only this package in workflows', () => {
      const uses = (type: string) => ChatwootIntegration.isUsedInWorkflow({ nodes: [{ type }] });
      expect(uses('@renatoascencio/n8n-nodes-chatwoot.chatwootTool')).toBe(true);
      expect(uses('@renatoascencio/n8n-nodes-chatwoot.chatwootTrigger')).toBe(true);
      expect(uses('@devlikeapro/n8n-nodes-chatwoot.chatwoot')).toBe(false);
      expect(uses('@renatoascencio/n8n-nodes-chatwoot.unknown')).toBe(false);
      expect(ChatwootIntegration.isUsedInWorkflow({ nodes: [null, {}, { type: 1 }] })).toBe(false);
      expect(ChatwootIntegration.isUsedInWorkflow({})).toBe(false);
    });
  });

  describe('templates', () => {
    it('lists, finds and filters templates', () => {
      const list = ChatwootIntegration.listTemplates();
      expect(list.length).toBeGreaterThanOrEqual(6);
      expect(ChatwootIntegration.getTemplate('chatwoot-ai-agent')?.category).toBe('ai');
      expect(ChatwootIntegration.getTemplatesByCategory('ai').map((t) => t.id)).toEqual(['chatwoot-ai-agent']);
    });

    it('reports no template issues', () => {
      expect(ChatwootIntegration.validateTemplates()).toEqual([]);
    });

    it('validates arbitrary workflows', () => {
      const issues = ChatwootIntegration.validateWorkflow({
        nodes: [{ name: 'N', type: '@renatoascencio/n8n-nodes-chatwoot.chatwoot', parameters: { resource: 'nope' } }],
      });
      expect(issues).toEqual([{ node: 'N', message: 'unknown resource "nope"' }]);
    });
  });

  describe('validateConnection', () => {
    it('requires a baseUrl', async () => {
      expect(await ChatwootIntegration.validateConnection({})).toEqual([
        { success: false, apiType: 'application', message: 'baseUrl is required' },
      ]);
    });

    it('passes the token type, platform token and inbox identifier', async () => {
      const spy = vi.spyOn(ChatwootConnectionValidator, 'testAll').mockResolvedValue([]);
      await ChatwootIntegration.validateConnection({
        baseUrl: 'https://chatwoot.example.com',
        accountId: 1,
        token: 't',
        tokenType: 'agentBot',
        platformToken: 'p',
        inboxIdentifier: 'abc',
      });
      expect(spy).toHaveBeenCalledWith({
        baseUrl: 'https://chatwoot.example.com',
        accountId: 1,
        token: 't',
        tokenType: 'agentBot',
        platformToken: 'p',
        inboxIdentifier: 'abc',
      });
    });
  });
});
