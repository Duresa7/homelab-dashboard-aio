import { runRemote } from '../lib/remote.js';
import { parseSensorsJson, parseDiskInventory } from './parse.js';

/**
 * Sensors integration — the I/O edge.
 *
 * Owns the shell-out (`sensors -j` / `lsblk -J`, local or over SSH), the
 * response cache, the degradation policy, and the `/api/sensors[/debug]`
 * routes. All pure parsing lives in ./parse.js and is unit-tested there.
 *
 * Config is passed in (resolved from env in index.js) rather than read from
 * process.env here, so the health routes can keep reporting the same values.
 *
 * @param {import('express').Express} app
 * @param {{
 *   enabled: boolean, mode: string, sshHost: string, sshUser: string,
 *   sshPort: number, sshKeyPath: string, cacheTtl: number,
 * }} config
 * @returns {{ runSensors: () => Promise<string>, fetchSensorsData: () => Promise<object> }}
 *   A handle the caller's health probes use (e.g. /api/health/live).
 */
export function initSensors(app, config) {
  const { enabled, mode, sshHost, sshUser, sshPort, sshKeyPath, cacheTtl } = config;

  let sensorsCache = { data: null, ts: 0 };
  let sensorsLastError = null;

  function runSensorsRemote(localCmd, localArgs, remoteCmd) {
    return runRemote({
      mode,
      host: sshHost,
      user: sshUser,
      port: sshPort,
      keyPath: sshKeyPath,
      localCmd,
      localArgs,
      remoteCmd,
    });
  }

  function runSensors() {
    return runSensorsRemote('sensors', ['-j'], 'sensors -j');
  }

  function runLsblk() {
    const cols = 'NAME,PATH,MODEL,VENDOR,SERIAL,TRAN,TYPE';
    return runSensorsRemote('lsblk', ['-J', '-o', cols], `lsblk -J -o ${cols}`);
  }

  // lsblk failure degrades to an empty inventory: temperatures still render,
  // disks just fall back to generic "NVMe 1" / "SATA 1" labels. The pure
  // parser throws on bad input; owning that fallback is the edge's job.
  async function fetchSensorDiskInventory() {
    try {
      const raw = await runLsblk();
      return parseDiskInventory(raw);
    } catch {
      return [];
    }
  }

  async function fetchSensorsData() {
    const now = Date.now();
    if (sensorsCache.data && now - sensorsCache.ts < cacheTtl) return sensorsCache.data;

    const [output, diskInventory] = await Promise.all([
      runSensors(),
      fetchSensorDiskInventory(),
    ]);
    const parsed = parseSensorsJson(output, diskInventory);

    sensorsCache = { data: parsed, ts: now };
    sensorsLastError = null;
    return parsed;
  }

  app.get('/api/sensors', async (_req, res) => {
    if (!enabled) return res.json({ disabled: true });
    if (mode === 'ssh' && !sshHost) {
      return res.status(503).json({ error: 'SENSORS_MODE=ssh but no host configured (set SENSORS_SSH_HOST or GPU_SSH_HOST)' });
    }
    try {
      const data = await fetchSensorsData();
      res.json({ sensors: data });
    } catch (err) {
      sensorsLastError = err.message;
      console.warn(`Sensors: ${mode} sensors -j failed → ${err.message.split('\n')[0]}`);
      res.status(502).json({ error: err.message });
    }
  });

  app.get('/api/sensors/debug', async (_req, res) => {
    if (!enabled) return res.json({ disabled: true });
    const cfg = { mode };
    if (mode === 'ssh') {
      cfg.host = sshHost;
      cfg.user = sshUser;
      cfg.port = sshPort;
      cfg.keyPath = sshKeyPath || '(default)';
    }
    try {
      const [raw, diskInventory] = await Promise.all([
        runSensors(),
        fetchSensorDiskInventory(),
      ]);
      res.json({
        config: cfg,
        diskInventory,
        raw: JSON.parse(raw),
        parsed: parseSensorsJson(raw, diskInventory),
        lastError: null,
      });
    } catch (err) {
      res.json({ config: cfg, raw: null, parsed: null, lastError: err.message });
    }
  });

  return { runSensors, fetchSensorsData };
}
