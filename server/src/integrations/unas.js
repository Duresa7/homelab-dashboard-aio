// UniFi UNAS (drive appliance) integration. Normalizes storage pools + disks
// (with SMART/incompatibility detail) into the dashboard's `unas` slice.
import { insecureFetch, makeSafeFetch } from '../lib/http.js';
import { withTtlCache } from '../lib/cache.js';
import { isEnabled, trimBaseUrl } from '../lib/env.js';

const UNAS_ENABLED = isEnabled(process.env.UNAS_ENABLED, false);
const UNAS_BASE_URL = trimBaseUrl(process.env.UNAS_BASE_URL);
const UNAS_API_KEY = process.env.UNAS_API_KEY || '';
const UNAS_CACHE_TTL = Number(process.env.UNAS_POLL_INTERVAL) || 30000;

const TB = 1024 ** 4;
const GB = 1024 ** 3;

async function unasFetch(path) {
  const res = await insecureFetch(`${UNAS_BASE_URL}${path}`, {
    headers: { 'X-API-Key': UNAS_API_KEY, Accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`UNAS API ${res.status} ${res.statusText} — ${path} — ${body.slice(0, 200)}`);
  }
  return res.json();
}

const safeUnasFetch = makeSafeFetch('UNAS', unasFetch);

function formatRaidLevel(preferLevel) {
  if (!preferLevel) return 'JBOD';
  const m = String(preferLevel).match(/^raid(\d+)$/i);
  return m ? `RAID ${m[1]}` : String(preferLevel).toUpperCase();
}

function poolStatus(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'fullyoperational' || s === 'optimal') return 'online';
  if (s.includes('degrade') || s.includes('rebuild') || s.includes('resync')) return 'degraded';
  return 'offline';
}

const UNAS_MODEL_NAMES = {
  UNAS2B: 'UNAS 2',
  UNAS2: 'UNAS 2',
  UNAS4B: 'UNAS 4',
  UNAS4: 'UNAS 4',
  UNASPRO: 'UNAS Pro',
  'UNAS-PRO': 'UNAS Pro',
};

function unasModelLabel(hardwareShort) {
  const code = String(hardwareShort || '').toUpperCase();
  if (!code) return 'UNAS';
  if (UNAS_MODEL_NAMES[code]) return UNAS_MODEL_NAMES[code];
  // Generic fallback for future models — e.g. "UNAS3B" → "UNAS 3B".
  return (
    code
      .replace(/^UNAS[-_ ]?/, 'UNAS ')
      .replace(/\s+/g, ' ')
      .trim() || 'UNAS'
  );
}

function diskSmart(disk) {
  const state = String(disk.state || '').toLowerCase();
  const risks = Array.isArray(disk.riskReasons) ? disk.riskReasons.length : 0;
  const badSectors =
    (Number(disk.badSectorCount) || 0) + (Number(disk.uncorrectableSectorCount) || 0);
  if (state !== 'optimal' || badSectors > 50) return 'bad';
  if (risks > 0 || badSectors > 0) return 'warn';
  return 'ok';
}

const INCOMPAT_LABELS = {
  DISK_INCOMPATIBLE_REASON_SMALLER_SIZE: 'smaller capacity',
  DISK_INCOMPATIBLE_REASON_LARGER_SIZE: 'larger than usable',
  DISK_INCOMPATIBLE_REASON_LOWER_RPM: 'slower RPM',
  DISK_INCOMPATIBLE_REASON_HIGHER_RPM: 'faster RPM',
  DISK_INCOMPATIBLE_REASON_DIFFERENT_MODEL: 'different model',
  DISK_INCOMPATIBLE_REASON_DIFFERENT_TYPE: 'different type',
};

function formatIncompatibility(code) {
  if (INCOMPAT_LABELS[code]) return INCOMPAT_LABELS[code];
  return String(code)
    .replace(/^DISK_INCOMPATIBLE_REASON_/, '')
    .toLowerCase()
    .replace(/_/g, ' ');
}

async function fetchUnasDataRaw() {
  const [storage, fanCtl, system] = await Promise.all([
    unasFetch('/proxy/drive/api/v2/storage'),
    safeUnasFetch('/proxy/drive/api/v2/systems/fan-control', null),
    safeUnasFetch('/api/system', null),
  ]);

  const rawPools = Array.isArray(storage?.pools) ? storage.pools : [];
  const rawDisks = Array.isArray(storage?.disks) ? storage.disks : [];

  const pools = rawPools.map((p) => {
    const incompatSet = new Set();
    for (const d of rawDisks) {
      if (d.poolId !== p.id) continue;
      for (const code of d.incompatibleReasons || []) incompatSet.add(code);
    }
    const scrub = p.dataScrubbing
      ? {
          status: p.dataScrubbing.status || 'unknown',
          scheduleEnabled: !!p.dataScrubbing.schedule?.enabled,
          lastRun: p.dataScrubbing.lastTaskRun || null,
          nextRun: p.dataScrubbing.nextRun || null,
        }
      : null;
    return {
      name: `Pool ${p.number ?? ''}`.trim() || 'Pool',
      type: formatRaidLevel(p.preferLevel),
      usedTB: (p.usage || 0) / TB,
      totalTB: (p.capacity || 0) / TB,
      status: poolStatus(p.status),
      scrub,
      incompatibilities: [...incompatSet].map(formatIncompatibility),
    };
  });

  const disks = rawDisks.map((d) => ({
    slot: String(d.slotId ?? '?'),
    model: String(d.model || 'unknown').trim(),
    tempC: Number(d.temperature) || 0,
    sizeGB: Math.round((Number(d.size) || 0) / GB),
    smart: diskSmart(d),
    powerOnHours: Number(d.powerOnHours) || 0,
    rpm: Number(d.rpm) || 0,
    badSectors: Number(d.badSectorCount) || 0,
    uncorrectableSectors: Number(d.uncorrectableSectorCount) || 0,
    lastSmartTest: d.smartTest
      ? {
          type: d.smartTest.type || 'unknown',
          status: d.smartTest.status || 'unknown',
          result: d.smartTest.result || 'unknown',
          finishedAt: d.smartTest.finishedAt || null,
        }
      : null,
  }));

  const maxDiskTemp = disks.reduce((m, d) => Math.max(m, d.tempC), 0);

  const modelLabel = unasModelLabel(system?.hardware?.shortname);

  return {
    unas: {
      name: system?.name || 'UNAS',
      model: modelLabel,
      tempC: maxDiskTemp,
      fanProfile: fanCtl?.currentProfile || '—',
      pools,
      disks,
    },
  };
}

const fetchUnasData = withTtlCache(fetchUnasDataRaw, UNAS_CACHE_TTL);

export const unasStatus = {
  enabled: UNAS_ENABLED,
  configured: !!(UNAS_BASE_URL && UNAS_API_KEY),
  baseUrl: UNAS_BASE_URL,
};

/** Liveness probe used by /api/health/live. */
export function probeUnas() {
  return unasFetch('/proxy/drive/api/v2/storage');
}

export function registerUnas(app) {
  app.get('/api/unas', async (_req, res) => {
    if (!UNAS_ENABLED) return res.json({ disabled: true });
    if (!UNAS_BASE_URL || !UNAS_API_KEY) {
      return res.status(503).json({
        error: 'UNAS not configured. Set UNAS_BASE_URL and UNAS_API_KEY in .env',
      });
    }
    try {
      res.json(await fetchUnasData());
    } catch (err) {
      console.error('UNAS API error:', err.message);
      res.status(502).json({ error: err.message });
    }
  });

  app.get('/api/unas/debug', async (_req, res) => {
    if (!UNAS_ENABLED) return res.json({ disabled: true });
    const c = fetchUnasData.peek();
    res.json({
      config: { baseUrl: UNAS_BASE_URL || null, hasKey: !!UNAS_API_KEY },
      cache: c.data
        ? {
            ageMs: Date.now() - c.ts,
            pools: c.data.unas.pools.length,
            disks: c.data.unas.disks.length,
          }
        : null,
      lastError: c.lastError,
    });
  });
}
