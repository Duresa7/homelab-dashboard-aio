// Transient connection test for a candidate integration config — used by the
// onboarding "Test connection" button before saving. Reuses each integration's
// auth scheme + a cheap liveness endpoint, but never persists or touches the
// live integration. HTTP integrations are probed; SSH/local/listener
// capabilities (gpu, sensors, logs) have no transient upstream to hit.
import { errorMessage } from '../lib/errors.js';
import { insecureFetch } from '../lib/http.js';

function str(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

interface HttpTest {
  path: string;
  headers: (config: Record<string, unknown>) => Record<string, string>;
}

// Auth + liveness path per HTTP capability, matching the live integrations.
const HTTP_TESTS: Record<string, HttpTest> = {
  datacenter: {
    path: '/api2/json/version',
    headers: (c) => ({
      Authorization: `PVEAPIToken=${str(c.tokenId)}=${str(c.tokenSecret)}`,
      Accept: 'application/json',
    }),
  },
  network: {
    path: '/proxy/network/integration/v1/sites',
    headers: (c) => ({ 'X-API-Key': str(c.apiKey), Accept: 'application/json' }),
  },
  nas: {
    path: '/proxy/drive/api/v2/storage',
    headers: (c) => ({ 'X-API-Key': str(c.apiKey), Accept: 'application/json' }),
  },
  containers: {
    path: '/api/endpoints',
    headers: (c) => ({ 'X-API-Key': str(c.apiKey), Accept: 'application/json' }),
  },
};

export interface TestResult {
  ok: boolean;
  error?: string;
  /** True when the capability has no transient connection to probe (gpu/sensors/logs). */
  untestable?: boolean;
}

export async function testIntegration(
  capability: string,
  config: Record<string, unknown>,
  timeoutMs = 8000,
): Promise<TestResult> {
  const test = HTTP_TESTS[capability];
  if (!test) return { ok: true, untestable: true };

  const baseUrl = trimSlash(str(config.baseUrl));
  if (!baseUrl) return { ok: false, error: 'base URL is required' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await insecureFetch(`${baseUrl}${test.path}`, {
      headers: test.headers(config),
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status} ${res.statusText}`.trim() };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  } finally {
    clearTimeout(timer);
  }
}
