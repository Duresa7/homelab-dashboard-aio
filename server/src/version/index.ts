import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Express, Request, RequestHandler, Response } from 'express';

import type { UpdateStatus, VersionInfo } from '../../../shared/wire.ts';
import { isEnabled } from '../lib/env.js';
import { errorMessage } from '../lib/errors.js';

const APP_VERSION = process.env.APP_VERSION?.trim();
const APP_COMMIT = process.env.APP_COMMIT?.trim() || null;
const APP_BUILD_TIME = process.env.APP_BUILD_TIME?.trim() || null;

// Set at build time (CI release workflow). When unset we're running from source
// (`npm run server`) or an un-tagged local image — i.e. a dev build, which we
// never nag about updates for.
const isDevBuild = !APP_VERSION;

function readPackageVersion(): string {
  try {
    // server/src/version/index.ts -> repo root package.json (same layout in the
    // Docker runtime image: /app/server/src/version -> /app).
    const pkgPath = fileURLToPath(new URL('../../../package.json', import.meta.url));
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version?.trim() || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

let versionInfo: VersionInfo | null = null;

export function getVersionInfo(): VersionInfo {
  if (!versionInfo) {
    versionInfo = {
      version: APP_VERSION || readPackageVersion(),
      commit: APP_COMMIT,
      buildTime: APP_BUILD_TIME,
      isDevBuild,
    };
  }
  return versionInfo;
}

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

function parseSemver(input: string): ParsedVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(input.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

function comparePrerelease(a: string[], b: string[]): number {
  // No prerelease outranks a prerelease (1.0.0 > 1.0.0-rc.1).
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i >= a.length) return -1;
    if (i >= b.length) return 1;
    const ai = a[i];
    const bi = b[i];
    const aNum = /^\d+$/.test(ai);
    const bNum = /^\d+$/.test(bi);
    if (aNum && bNum) {
      const diff = Number(ai) - Number(bi);
      if (diff !== 0) return diff < 0 ? -1 : 1;
    } else if (aNum !== bNum) {
      return aNum ? -1 : 1; // numeric identifiers rank below alphanumeric
    } else if (ai !== bi) {
      return ai < bi ? -1 : 1;
    }
  }
  return 0;
}

/** True when `latest` is a strictly newer version than `current`. */
export function isNewer(latest: string, current: string): boolean {
  const a = parseSemver(latest);
  const b = parseSemver(current);
  if (!a || !b) return false;
  if (a.major !== b.major) return a.major > b.major;
  if (a.minor !== b.minor) return a.minor > b.minor;
  if (a.patch !== b.patch) return a.patch > b.patch;
  return comparePrerelease(a.prerelease, b.prerelease) > 0;
}

const UPDATE_REPO = process.env.UPDATE_REPO?.trim() || 'Duresa7/homelab-dashboard-aio';
const CHECK_INTERVAL_MS = Number(process.env.UPDATE_CHECK_INTERVAL) || 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;
const MIN_FORCE_INTERVAL_MS = 60 * 1000;
const NOTES_MAX_CHARS = 4000;

function checkEnabled(): boolean {
  // isEnabled() already returns false when the global DISABLE_ALL kill-switch is set.
  return isEnabled(process.env.UPDATE_CHECK_ENABLED, true);
}

interface ReleaseCache {
  latest: string | null;
  releaseName: string | null;
  releaseUrl: string | null;
  publishedAt: string | null;
  notes: string | null;
  checkedAt: number | null;
  error: string | null;
}

let cache: ReleaseCache = {
  latest: null,
  releaseName: null,
  releaseUrl: null,
  publishedAt: null,
  notes: null,
  checkedAt: null,
  error: null,
};
let inFlight: Promise<void> | null = null;
let lastForcedAt = 0;

interface GithubRelease {
  tag_name?: string;
  name?: string;
  html_url?: string;
  published_at?: string;
  body?: string;
}

async function fetchLatestRelease(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const token = process.env.GITHUB_TOKEN?.trim();
      const res = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'homelab-dashboard-update-check',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        // 404 just means no releases published yet — not an error worth surfacing.
        cache = {
          ...cache,
          checkedAt: Date.now(),
          error: res.status === 404 ? null : `GitHub API ${res.status}`,
        };
        return;
      }
      const data = (await res.json()) as GithubRelease;
      const tag = data.tag_name?.trim() || null;
      cache = {
        latest: tag,
        releaseName: data.name?.trim() || tag,
        releaseUrl: data.html_url ?? null,
        publishedAt: data.published_at ?? null,
        notes: data.body ? data.body.slice(0, NOTES_MAX_CHARS) : null,
        checkedAt: Date.now(),
        error: null,
      };
    } catch (err) {
      // Keep the last good cache; only record the error.
      cache = { ...cache, checkedAt: Date.now(), error: errorMessage(err) };
    } finally {
      clearTimeout(timer);
      inFlight = null;
    }
  })();
  return inFlight;
}

export function getUpdateStatus(): UpdateStatus {
  const info = getVersionInfo();
  const enabled = checkEnabled();
  const isOutdated =
    enabled && !info.isDevBuild && !!cache.latest && isNewer(cache.latest, info.version);
  return {
    current: info.version,
    commit: info.commit,
    buildTime: info.buildTime,
    latest: cache.latest,
    isOutdated,
    releaseUrl: cache.releaseUrl,
    releaseName: cache.releaseName,
    publishedAt: cache.publishedAt,
    notes: cache.notes,
    lastCheckedAt: cache.checkedAt ? new Date(cache.checkedAt).toISOString() : null,
    enabled,
    isDevBuild: info.isDevBuild,
    error: cache.error,
  };
}

interface ForceResult {
  ok: boolean;
  retryAfterMs?: number;
}

async function forceUpdateCheck(): Promise<ForceResult> {
  if (!checkEnabled()) return { ok: false };
  const now = Date.now();
  const elapsed = now - lastForcedAt;
  if (elapsed < MIN_FORCE_INTERVAL_MS) {
    return { ok: false, retryAfterMs: MIN_FORCE_INTERVAL_MS - elapsed };
  }
  lastForcedAt = now;
  await fetchLatestRelease();
  return { ok: true };
}

/** Kick off the periodic GitHub release poll. Returns a stop function. */
export function startUpdateChecker(): () => void {
  if (!checkEnabled()) {
    console.log('Update check: DISABLED (set UPDATE_CHECK_ENABLED=true to enable)');
    return () => {};
  }
  const info = getVersionInfo();
  console.log(
    `Update check: enabled — repo ${UPDATE_REPO}, running ${info.isDevBuild ? 'dev build' : `v${info.version}`}`,
  );
  void fetchLatestRelease();
  const timer = setInterval(() => void fetchLatestRelease(), CHECK_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

export function registerVersionRoutes(app: Express, opts: { sameOrigin: RequestHandler }): void {
  app.get('/api/version', (_req: Request, res: Response) => res.json(getVersionInfo()));
  app.get('/api/update', (_req: Request, res: Response) => res.json(getUpdateStatus()));
  app.post('/api/update/check', opts.sameOrigin, async (_req: Request, res: Response) => {
    const result = await forceUpdateCheck();
    if (!result.ok) {
      if (result.retryAfterMs) {
        res.set('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)));
        return res
          .status(429)
          .json({ error: 'update check rate limited', retryAfterMs: result.retryAfterMs });
      }
      return res.status(409).json({ error: 'update check disabled' });
    }
    res.json(getUpdateStatus());
  });
}
