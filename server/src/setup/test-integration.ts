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
  // Strip trailing slashes with a plain scan rather than /\/+$/, which
  // backtracks quadratically on long slash runs (CodeQL js/polynomial-redos).
  let end = url.length;
  while (end > 0 && url[end - 1] === '/') end--;
  return url.slice(0, end);
}

export function normalizeTestBaseUrl(value: unknown): string {
  const raw = trimSlash(str(value));
  if (!raw) throw new Error('base URL is required');
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('base URL must be a valid absolute URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('base URL must use http or https');
  }
  if (parsed.username || parsed.password) {
    throw new Error('base URL must not include credentials');
  }
  parsed.hash = '';
  return trimSlash(parsed.toString());
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

  let baseUrl: string;
  try {
    baseUrl = normalizeTestBaseUrl(config.baseUrl);
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }

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
