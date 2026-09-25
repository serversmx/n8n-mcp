import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ChatwootConnectionValidator } from '../src/integrations/chatwoot/connection-validator';

/** fetch Response mock with a Chatwoot JSON error body */
function chatwootError(status: number, error: string) {
  return { ok: false, status, text: vi.fn().mockResolvedValue(JSON.stringify({ error })) };
}

describe('ChatwootConnectionValidator', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('testApplicationApi', () => {
    it('returns success on 200', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });

      const result = await ChatwootConnectionValidator.testApplicationApi(
        'https://chatwoot.example.com',
        '1',
        'token123',
      );

      expect(result.success).toBe(true);
      expect(result.apiType).toBe('application');
      expect(result.message).toBe('Application API connection successful');
    });

    it('classifies 401 as auth error', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      const result = await ChatwootConnectionValidator.testApplicationApi(
        'https://chatwoot.example.com',
        '1',
        'bad-token',
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('401');
      expect(result.details?.suggestion).toContain('API access token');
    });

    it('classifies 404 as wrong URL/accountId', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const result = await ChatwootConnectionValidator.testApplicationApi(
        'https://chatwoot.example.com',
        '999',
        'token',
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('404');
      expect(result.details?.suggestion).toContain('baseUrl');
    });

    it('classifies ECONNREFUSED as network error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'));

      const result = await ChatwootConnectionValidator.testApplicationApi(
        'https://chatwoot.example.com',
        '1',
        'token',
      );

      expect(result.success).toBe(false);
      expect(result.apiType).toBe('application');
      expect(result.message).toContain('not reachable');
      expect(result.details?.errorType).toBe('network');
    });

    it('classifies DNS failure', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(
        new Error('getaddrinfo ENOTFOUND bad-host.example.com'),
      );

      const result = await ChatwootConnectionValidator.testApplicationApi(
        'https://bad-host.example.com',
        '1',
        'token',
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('DNS');
      expect(result.details?.errorType).toBe('dns');
    });

    it('classifies abort as timeout', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new DOMException('The operation was aborted', 'AbortError'));

      const result = await ChatwootConnectionValidator.testApplicationApi(
        'https://slow.example.com',
        '1',
        'token',
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('timed out');
      expect(result.details?.errorType).toBe('timeout');
    });

    it('classifies SSL errors', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(
        new Error('UNABLE_TO_VERIFY_LEAF_SIGNATURE'),
      );

      const result = await ChatwootConnectionValidator.testApplicationApi(
        'https://self-signed.example.com',
        '1',
        'token',
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('SSL');
      expect(result.details?.errorType).toBe('ssl');
    });

    it('sanitizes tokens from error messages', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(
        new Error('request failed with api_access_token: mySecretToken12345678'),
      );

      const result = await ChatwootConnectionValidator.testApplicationApi(
        'https://chatwoot.example.com',
        '1',
        'mySecretToken12345678',
      );

      expect(result.success).toBe(false);
      expect(result.message).not.toContain('mySecretToken12345678');
      expect(result.message).toContain('***');
    });

    it('lists conversations with a user token', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

      await ChatwootConnectionValidator.testApplicationApi('https://chatwoot.example.com/', 7, 'token');

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://chatwoot.example.com/api/v1/accounts/7/conversations?page=1',
        expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ api_access_token: 'token' }) }),
      );
    });

    it('does not follow redirects or forward the API token to a different endpoint', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 302 });

      const result = await ChatwootConnectionValidator.testApplicationApi('https://chatwoot.example.com', 7, 'secret-token');

      expect(result).toMatchObject({ success: false, details: { status: 302 } });
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://chatwoot.example.com/api/v1/accounts/7/conversations?page=1',
        expect.objectContaining({ redirect: 'manual' }),
      );
    });

    it('maps Chatwoot error bodies to precise messages', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(chatwootError(401, 'You are not authorized to access this account'));

      const result = await ChatwootConnectionValidator.testApplicationApi('https://chatwoot.example.com', '2', 'token');

      expect(result.success).toBe(false);
      expect(result.message).toBe('This token cannot access the account (401)');
      expect(result.details?.suggestion).toContain('account ID');
    });

    it('reports API access disabled on Chatwoot Cloud plans', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(chatwootError(403, 'API access is not enabled for this account'));

      const result = await ChatwootConnectionValidator.testApplicationApi('https://app.chatwoot.com', '1', 'token');

      expect(result.message).toBe('API access is not enabled for this account (403)');
    });

    it('recognizes an agent bot token used as a user token', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(chatwootError(401, 'Access to this endpoint is not authorized for bots'));

      const result = await ChatwootConnectionValidator.testApplicationApi('https://chatwoot.example.com', '1', 'bot-token');

      expect(result.success).toBe(false);
      expect(result.message).toContain('agent bot token');
      expect(result.details?.suggestion).toContain('agentBot');
    });

    describe('agent bot tokens', () => {
      it('reads conversation 0 and treats 404 as success', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(chatwootError(404, 'Resource could not be found'));

        const result = await ChatwootConnectionValidator.testApplicationApi(
          'https://chatwoot.example.com',
          '1',
          'bot-token',
          'agentBot',
        );

        expect(globalThis.fetch).toHaveBeenCalledWith(
          'https://chatwoot.example.com/api/v1/accounts/1/conversations/0',
          expect.anything(),
        );
        expect(result.success).toBe(true);
        expect(result.details).toMatchObject({ status: 404, tokenType: 'agentBot' });
      });

      it.each([
        { ok: false, status: 404 },
        { ok: false, status: 404, text: async () => '<html>Not found</html>' },
        chatwootError(404, 'Unknown route'),
      ])('does not accept non-Chatwoot 404 responses as token verification', async (response) => {
        globalThis.fetch = vi.fn().mockResolvedValue(response);

        const result = await ChatwootConnectionValidator.testApplicationApi(
          'https://chatwoot.example.com', '1', 'bot-token', 'agentBot',
        );

        expect(result).toMatchObject({ success: false, apiType: 'application', details: { status: 404 } });
      });

      it('reports an inconclusive probe when Chatwoot does not let bots read conversations', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(chatwootError(401, 'Access to this endpoint is not authorized for bots'));

        const result = await ChatwootConnectionValidator.testApplicationApi(
          'https://chatwoot.example.com',
          '1',
          'bot-token',
          'agentBot',
        );

        expect(result.success).toBe(false);
        expect(result.message).toContain('account access could not be verified');
        expect(result.details?.suggestion).toContain('before 4.17');
      });

      it('fails for unknown tokens and foreign accounts', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(chatwootError(401, 'Invalid Access Token'));
        const invalid = await ChatwootConnectionValidator.testApplicationApi('https://c.example.com', '1', 'x', 'agentBot');
        expect(invalid.success).toBe(false);
        expect(invalid.message).toContain('does not know this access token');

        globalThis.fetch = vi.fn().mockResolvedValue(chatwootError(401, 'Bot is not authorized to access this account'));
        const foreign = await ChatwootConnectionValidator.testApplicationApi('https://c.example.com', '9', 'x', 'agentBot');
        expect(foreign.success).toBe(false);
        expect(foreign.message).toContain('does not belong to this account');
      });
    });
  });

  describe('testPlatformApi', () => {
    it('returns success on 200', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });

      const result = await ChatwootConnectionValidator.testPlatformApi(
        'https://chatwoot.example.com',
        'platform-token',
      );

      expect(result.success).toBe(true);
      expect(result.apiType).toBe('platform');
    });

    it('classifies 403 as permissions error', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
      });

      const result = await ChatwootConnectionValidator.testPlatformApi(
        'https://chatwoot.example.com',
        'limited-token',
      );

      expect(result.success).toBe(false);
      expect(result.apiType).toBe('platform');
      expect(result.message).toContain('403');
      expect(result.details?.suggestion).toContain('permissions');
    });
  });

  describe('testPublicApi', () => {
    it('reads the inbox of the identifier (no auth header)', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

      const result = await ChatwootConnectionValidator.testPublicApi('https://chatwoot.example.com', 'abc/12');

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://chatwoot.example.com/public/api/v1/inboxes/abc%2F12',
        expect.objectContaining({ headers: { 'Content-Type': 'application/json' } }),
      );
      expect(result).toMatchObject({ success: true, apiType: 'public' });
    });

    it('explains a 404 (not an API channel inbox identifier)', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });

      const result = await ChatwootConnectionValidator.testPublicApi('https://chatwoot.example.com', 'nope');

      expect(result.success).toBe(false);
      expect(result.apiType).toBe('public');
      expect(result.message).toBe('Inbox identifier not found (404)');
      expect(result.details?.suggestion).toContain('API channel inbox');
    });

    it('classifies network errors as public API errors', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'));

      const result = await ChatwootConnectionValidator.testPublicApi('https://chatwoot.example.com', 'abc');

      expect(result).toMatchObject({ success: false, apiType: 'public' });
      expect(result.details?.errorType).toBe('network');
    });
  });

  describe('testAll', () => {
    it('also tests the Public API and passes the token type', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(chatwootError(404, 'Resource could not be found'));

      const results = await ChatwootConnectionValidator.testAll({
        baseUrl: 'https://chatwoot.example.com',
        accountId: '1',
        token: 'bot-token',
        tokenType: 'agentBot',
        inboxIdentifier: 'abc',
      });

      expect(results.map((r) => [r.apiType, r.success])).toEqual([
        ['application', true],
        ['public', false],
      ]);
    });

    it('runs both APIs when both configs provided', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });

      const results = await ChatwootConnectionValidator.testAll({
        baseUrl: 'https://chatwoot.example.com',
        accountId: '1',
        token: 'app-token',
        platformToken: 'platform-token',
      });

      expect(results).toHaveLength(2);
      expect(results[0].apiType).toBe('application');
      expect(results[1].apiType).toBe('platform');
    });

    it('skips APIs when configs missing', async () => {
      const results = await ChatwootConnectionValidator.testAll({
        baseUrl: 'https://chatwoot.example.com',
      });

      expect(results).toHaveLength(0);
    });
  });
});
