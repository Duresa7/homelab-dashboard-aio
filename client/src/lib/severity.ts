import type { Severity } from '../types';
import { getThresholds, type ThresholdPair } from './thresholds';

export const severityColor: Record<Severity, string> = {
  ok: 'var(--ok)',
  info: 'var(--info)',
  warn: 'var(--warn)',
  bad: 'var(--bad)',
};

// Severity bands use STRICT comparisons (`>` / `<`) so that being exactly
// at the configured threshold counts as the milder side — matching the
// inline `pct > 90 ? 'bad' : pct > 75 ? 'warn'` semantics each widget used
// before threshold extraction. The forward and inverse helpers are
// mirrors: forward uses `>`, inverse uses `<`, so a value AT the bad cutoff
// stays in the warn band on both sides.
function byThreshold(value: number, t: ThresholdPair): Severity {
  if (value > t.bad) return 'bad';
  if (value > t.warn) return 'warn';
  return 'ok';
}

function byInverseThreshold(value: number, t: ThresholdPair): Severity {
  // For metrics where lower = worse (battery %, uptime %).
  if (value < t.bad) return 'bad';
  if (value < t.warn) return 'warn';
  return 'ok';
}

export function cpuUsageSeverity(pct: number): Severity {
  return byThreshold(pct, getThresholds().cpuUsage);
}

export function cpuTempSeverity(tempC: number): Severity {
  return byThreshold(tempC, getThresholds().cpuTemp);
}

export function ramUsageSeverity(pct: number): Severity {
  return byThreshold(pct, getThresholds().ramUsage);
}

export function gpuUsageSeverity(pct: number): Severity {
  return byThreshold(pct, getThresholds().gpuUsage);
}

export function gpuTempSeverity(tempC: number): Severity {
  return byThreshold(tempC, getThresholds().gpuTemp);
}

export function diskTempSeverity(tempC: number): Severity {
  return byThreshold(tempC, getThresholds().diskTemp);
}

export function fillSeverity(pct: number): Severity {
  return byThreshold(pct, getThresholds().storageFill);
}

export function fanSeverity(pct: number): Severity {
  return byThreshold(pct, getThresholds().fan);
}

export function pingSeverity(ms: number): Severity {
  return byThreshold(ms, getThresholds().ping);
}

export function batterySeverity(pct: number): Severity {
  // Battery is inverse: low = bad.
  return byInverseThreshold(pct, { warn: 50, bad: 25 });
}

export function uptimeSeverity(pct: number): Severity {
  return byInverseThreshold(pct, { warn: 99.9, bad: 99 });
}

// Back-compat: generic helpers used by some callers. Optional explicit thresholds win.
export function usageSeverity(pct: number, warnAt?: number, badAt?: number): Severity {
  if (warnAt !== undefined && badAt !== undefined) {
    return byThreshold(pct, { warn: warnAt, bad: badAt });
  }
  return cpuUsageSeverity(pct);
}

export function tempSeverity(tempC: number, warnAt?: number, badAt?: number): Severity {
  if (warnAt !== undefined && badAt !== undefined) {
    return byThreshold(tempC, { warn: warnAt, bad: badAt });
  }
  return cpuTempSeverity(tempC);
}
