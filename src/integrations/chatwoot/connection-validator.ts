/**
 * Chatwoot Connection Validator
 *
 * Validates connectivity to a Chatwoot instance with the same read-only requests the node's credential tests
 * use (@renatoascencio/n8n-nodes-chatwoot 0.9):
 * - Application API, user token: GET /api/v1/accounts/{id}/conversations?page=1
 * - Application API, agent bot token: GET /api/v1/accounts/{id}/conversations/0 (bots cannot list anything;
 *   Chatwoot's resource-not-found response verifies the token, but cannot verify a nonexistent account)
 * - Platform API: GET /platform/api/v1/agent_bots
 * - Public API: GET /public/api/v1/inboxes/{inbox identifier}
 *
 * Error messages are sanitized to prevent secret leakage and classified
 * by type (auth, network, timeout, dns, ssl) with actionable suggestions.
 * Chatwoot's own error texts (AccessTokenAuthHelper, EnsureCurrentAccountHelper) are mapped when present.
 */

const DEFAULT_TIMEOUT_MS = 10_000;

export type ChatwootTokenType = 'user' | 'agentBot';

export interface ConnectionTestResult {
  success: boolean;
  apiType: 'application' | 'platform' | 'public';
  message: string;
  details?: Record<string, unknown>;
}

interface FetchResult {
  status: number;
  ok: boolean;
  chatwootError?: string;
}

/** GET with timeout; reads Chatwoot's `{ error }` / `{ message }` body on failures */
async function get(url: string, headers: Record<string, string>): Promise<FetchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { ...headers, 'Content-Type': 'application/json' },
      // Fetch forwards custom authentication headers on redirects, including to another origin.
      // A diagnostic must never send the supplied token anywhere except the requested Chatwoot URL.
      redirect: 'manual',
      signal: controller.signal,
    });
    const result: FetchResult = { status: response.status, ok: response.ok };
    if (!response.ok) result.chatwootError = await readChatwootError(response);
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

async function readChatwootError(response: Response): Promise<string | undefined> {
  if (typeof response.text !== 'function') return undefined;
  try {
    const body = JSON.parse(await response.text());
    const error = body?.error ?? body?.message;
    return typeof error === 'string' ? error : undefined;
  } catch {
    return undefined;
  }
}

/** Chatwoot 4.18 authentication/authorization errors → message + suggestion */
const CHATWOOT_ERRORS: Record<string, { message: string; suggestion: string }> = {
  'Invalid Access Token': {
    message: 'Authentication failed: Chatwoot does not know this access token',
    suggestion: 'Copy the token again (Profile Settings > Access Token, or Settings > Bots for an agent bot token).',
  },
  'You are not authorized to access this account': {
    message: 'This token cannot access the account',
    suggestion: 'Check the account ID: the token user must be a member of that account.',
  },
  'Bot is not authorized to access this account': {
    message: 'The agent bot does not belong to this account and is not connected to any of its inboxes',
    suggestion: 'Check the account ID, or connect the bot to an inbox of the account.',
  },
  'Account is suspended': {
    message: 'The Chatwoot account is suspended',
    suggestion: 'Reactivate the account (Super Admin console) or use another account.',
  },
  'API access is not enabled for this account': {
    message: 'API access is not enabled for this account',
    suggestion: 'Chatwoot Cloud: the plan must include API access and webhooks.',
  },
};

function failure(
  apiType: ConnectionTestResult['apiType'],
  result: FetchResult,
  override?: { message: string; suggestion: string },
): ConnectionTestResult {
  const known = override ?? (result.chatwootError ? CHATWOOT_ERRORS[result.chatwootError] : undefined);
  const { message, suggestion } = known
    ? { message: `${known.message} (${result.status})`, suggestion: known.suggestion }
    : classifyHttpStatus(result.status);
  return {
    success: false,
    apiType,
    message,
    details: { status: result.status, suggestion },
  };
}

export class ChatwootConnectionValidator {
  /**
   * Test Application API connectivity
   */
  static async testApplicationApi(
    baseUrl: string,
    accountId: string | number,
    token: string,
    tokenType: ChatwootTokenType = 'user',
  ): Promise<ConnectionTestResult> {
    const base = `${baseUrl.replace(/\/+$/, '')}/api/v1/accounts/${encodeURIComponent(String(accountId))}`;
    const url = tokenType === 'agentBot' ? `${base}/conversations/0` : `${base}/conversations?page=1`;

    try {
      const result = await get(url, { api_access_token: token });

      if (tokenType === 'agentBot') {
        // Conversation 0 never exists. Require Chatwoot's error body: an HTML/proxy 404 proves nothing
        // about the token. A nonexistent account returns the same body, so account membership is unverified.
        if (result.status === 404 && result.chatwootError === 'Resource could not be found') {
          return {
            success: true,
            apiType: 'application',
            message: 'Application API connection successful (agent bot token)',
            details: {
              status: result.status,
              tokenType,
              note: 'An account ID that does not exist also answers 404, so it is not verified for bot tokens.',
            },
          };
        }
        if (result.chatwootError === 'Access to this endpoint is not authorized for bots') {
          return failure('application', result, {
            message:
              'Chatwoot rejected the agent bot connection probe; account access could not be verified',
            suggestion:
              'Chatwoot versions before 4.17 do not let bots read conversations. Verify the account and bot inbox ' +
              'assignment separately; bot-supported operations such as Message > Create may still work.',
          });
        }
      }

      if (result.ok) {
        return {
          success: true,
          apiType: 'application',
          message: 'Application API connection successful',
          details: { status: result.status, tokenType },
        };
      }

      if (tokenType === 'user' && result.chatwootError === 'Access to this endpoint is not authorized for bots') {
        return failure('application', result, {
          message: 'This is an agent bot token',
          suggestion: 'Test it with tokenType "agentBot" (bots cannot list conversations).',
        });
      }
      return failure('application', result);
    } catch (error) {
      const result = classifyError(error);
      result.apiType = 'application';
      return result;
    }
  }

  /**
   * Test Platform API connectivity
   */
  static async testPlatformApi(
    baseUrl: string,
    token: string,
  ): Promise<ConnectionTestResult> {
    const url = `${baseUrl.replace(/\/+$/, '')}/platform/api/v1/agent_bots`;

    try {
      const result = await get(url, { api_access_token: token });

      if (result.ok) {
        return {
          success: true,
          apiType: 'platform',
          message: 'Platform API connection successful',
          details: { status: result.status },
        };
      }

      return failure('platform', result);
    } catch (error) {
      const result = classifyError(error);
      result.apiType = 'platform';
      return result;
    }
  }

  /**
   * Test Public API connectivity (API channel inbox identifier; the Public API has no auth header)
   */
  static async testPublicApi(
    baseUrl: string,
    inboxIdentifier: string,
  ): Promise<ConnectionTestResult> {
    const url = `${baseUrl.replace(/\/+$/, '')}/public/api/v1/inboxes/${encodeURIComponent(inboxIdentifier)}`;

    try {
      const result = await get(url, {});

      if (result.ok) {
        return {
          success: true,
          apiType: 'public',
          message: 'Public API connection successful',
          details: { status: result.status },
        };
      }

      if (result.status === 404) {
        return failure('public', result, {
          message: 'Inbox identifier not found',
          suggestion:
            'Use the identifier of an API channel inbox (Settings > Inboxes > the API inbox > Configuration); other inbox types have no Public API.',
        });
      }
      return failure('public', result);
    } catch (error) {
      const result = classifyError(error);
      result.apiType = 'public';
      return result;
    }
  }

  /**
   * Test all APIs and return a summary
   */
  static async testAll(config: {
    baseUrl: string;
    accountId?: string | number;
    token?: string;
    tokenType?: ChatwootTokenType;
    platformToken?: string;
    inboxIdentifier?: string;
  }): Promise<ConnectionTestResult[]> {
    const results: ConnectionTestResult[] = [];

    if (config.token && config.accountId) {
      results.push(
        await this.testApplicationApi(config.baseUrl, config.accountId, config.token, config.tokenType),
      );
    }

    if (config.platformToken) {
      results.push(
        await this.testPlatformApi(config.baseUrl, config.platformToken),
      );
    }

    if (config.inboxIdentifier) {
      results.push(
        await this.testPublicApi(config.baseUrl, config.inboxIdentifier),
      );
    }

    return results;
  }
}

/** Classify fetch errors into actionable categories */
function classifyError(error: unknown): ConnectionTestResult {
  const raw = error instanceof Error ? error.message : String(error);

  if (raw.includes('ECONNREFUSED') || raw.includes('ECONNRESET')) {
    return {
      success: false,
      apiType: 'application',
      message: 'Connection refused. The Chatwoot server is not reachable.',
      details: {
        errorType: 'network',
        suggestion: 'Verify the baseUrl and ensure the Chatwoot server is running.',
      },
    };
  }

  if (raw.includes('ENOTFOUND') || raw.includes('getaddrinfo')) {
    return {
      success: false,
      apiType: 'application',
      message: 'DNS resolution failed. The hostname could not be resolved.',
      details: {
        errorType: 'dns',
        suggestion: 'Check the baseUrl for typos in the hostname.',
      },
    };
  }

  if (raw.includes('ETIMEDOUT') || raw.includes('AbortError') || raw.includes('aborted')) {
    return {
      success: false,
      apiType: 'application',
      message: `Connection timed out after ${DEFAULT_TIMEOUT_MS}ms.`,
      details: {
        errorType: 'timeout',
        suggestion: 'The server may be slow or unreachable. Check network connectivity.',
      },
    };
  }

  if (raw.includes('UNABLE_TO_VERIFY_LEAF_SIGNATURE') || raw.includes('CERT_')) {
    return {
      success: false,
      apiType: 'application',
      message: 'SSL/TLS certificate error.',
      details: {
        errorType: 'ssl',
        suggestion: 'The server has an invalid SSL certificate. Check HTTPS configuration.',
      },
    };
  }

  if (raw.includes('Invalid URL') || raw.includes('ERR_INVALID_URL')) {
    return {
      success: false,
      apiType: 'application',
      message: 'Invalid URL format.',
      details: {
        errorType: 'invalid_url',
        suggestion: 'Ensure baseUrl starts with http:// or https:// and is well-formed.',
      },
    };
  }

  // Generic: sanitize to prevent secret leakage
  const sanitized = raw
    .replace(/api_access_token[=:]\s*\S+/gi, 'api_access_token=***')
    .replace(/token[=:]\s*[A-Za-z0-9_\-]{20,}/gi, 'token=***')
    .replace(/key[=:]\s*[A-Za-z0-9_\-]{20,}/gi, 'key=***')
    .replace(/Bearer\s+\S+/gi, 'Bearer ***');

  return {
    success: false,
    apiType: 'application',
    message: `Connection failed: ${sanitized}`,
    details: { errorType: 'unknown' },
  };
}

/** Map HTTP status codes to actionable messages */
function classifyHttpStatus(status: number): { message: string; suggestion: string } {
  switch (status) {
    case 401:
      return {
        message: 'Authentication failed (401 Unauthorized)',
        suggestion: 'Check your API access token.',
      };
    case 403:
      return {
        message: 'Access forbidden (403)',
        suggestion: 'The token may lack required permissions.',
      };
    case 404:
      return {
        message: 'Endpoint not found (404)',
        suggestion: 'Verify the baseUrl and accountId are correct.',
      };
    case 500:
      return {
        message: 'Server error (500)',
        suggestion: 'The Chatwoot server encountered an internal error.',
      };
    case 502:
    case 503:
    case 504:
      return {
        message: `Server unavailable (${status})`,
        suggestion: 'The Chatwoot server may be down or restarting.',
      };
    default:
      return {
        message: `Unexpected status ${status}`,
        suggestion: 'Check Chatwoot server logs for details.',
      };
  }
}
