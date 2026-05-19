import { Tile } from '../tile/Tile';
import { BrandIcon } from '../icons/BrandIcon';
import type { Severity, UnasData, UnasScrub, UnasSmartTest } from '../../types';
import { fmtTemp, useTempUnit } from '../../lib/units';
import { ageSince, formatPowerOnTime } from '../../lib/format';

interface Props {
  data: UnasData;
  span?: number;
  onExpand?: () => void;
  expandable?: boolean;
  compact?: boolean;
}

const KIND_COLOR: Record<Severity, string> = {
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  bad: 'var(--bad)',
  info: 'var(--info)',
};

function tempKind(tempC: number): Severity {
  if (tempC >= 55) return 'bad';
  if (tempC >= 50) return 'warn';
  return 'ok';
}

function poolKind(status: string): Severity {
  if (status === 'offline') return 'bad';
  if (status === 'degraded') return 'warn';
  return 'ok';
}

function scrubDisplay(scrub: UnasScrub | null): { label: string; kind: Severity } {
  if (!scrub) return { label: 'unknown', kind: 'warn' };
  const age = ageSince(scrub.lastRun);
  if (!age) {
    return {
      label: scrub.scheduleEnabled ? 'scheduled — never run' : 'never (schedule off)',
      kind: 'warn',
    };
  }
  return { label: age.label, kind: age.days > 35 ? 'warn' : 'ok' };
}

function smartTestDisplay(test: UnasSmartTest | null): { label: string; kind: Severity } | null {
  if (!test) return { label: 'never tested', kind: 'warn' };
  const passed = test.status === 'successful' && test.result === 'optimal';
  const cancelled = test.status === 'cancelled' || test.result === 'aborted';
  if (passed) return null; // hide the chatter when everything's fine
  const age = ageSince(test.finishedAt);
  const suffix = age ? ` ${age.label}` : '';
  if (cancelled) return { label: `test cancelled${suffix}`, kind: 'warn' };
  return { label: `test failed${suffix}`, kind: 'bad' };
}

export function UnasTile({ data, span, onExpand, expandable, compact }: Props) {
  const { unit } = useTempUnit();
  const { name, model, tempC, fanProfile, pools, disks } = data;
  const allIncompat = [...new Set(pools.flatMap((p) => p.incompatibilities))];

  return (
    <Tile
      title={<><BrandIcon name="unifi" alt="UniFi" /> {model}</>}
      sub={`${name} · fan ${fanProfile}`}
      span={span}
      onExpand={onExpand}
      expandable={expandable}
      tag={{ label: fmtTemp(tempC, unit), kind: tempKind(tempC) }}
    >
      <div className="disks">
        {pools.map((p) => {
          const pct = p.totalTB > 0 ? (p.usedTB / p.totalTB) * 100 : 0;
          const cls = poolKind(p.status);
          const scrub = scrubDisplay(p.scrub);
          return (
            <div key={p.name} className="disk">
              <div className="row">
                <div className="name flex1" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      width: 6, height: 6, borderRadius: 50,
                      background: KIND_COLOR[cls],
                    }}
                  />
                  {p.name}
                  <span className="t-tag">{p.type}</span>
                </div>
                <div className="meta">
                  {p.usedTB.toFixed(2)} / {p.totalTB.toFixed(2)} TB
                </div>
              </div>
              <div className={`pbar ${cls === 'ok' ? '' : cls}`}>
                <span style={{ width: `${pct}%` }} />
              </div>
              {!compact && (
                <div className="t-sub" style={{ fontSize: 12 }}>
                  Last scrub:{' '}
                  <span style={{ color: KIND_COLOR[scrub.kind] }}>{scrub.label}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!compact && disks.length > 0 && (
        <>
          <div className="t-sub" style={{ marginTop: 4 }}>Drives</div>
          <div className="list">
            {disks.map((d) => {
              const hasBadSectors = d.badSectors > 0 || d.uncorrectableSectors > 0;
              const test = smartTestDisplay(d.lastSmartTest);
              const dotCls =
                d.smart === 'bad' || hasBadSectors
                  ? 'bad'
                  : d.smart === 'warn' || test?.kind === 'warn'
                    ? 'warn'
                    : '';
              return (
                <div key={d.slot} className="li">
                  <span className={`d ${dotCls}`} />
                  <span className="name">Slot {d.slot} · {d.model}</span>
                  <span className="meta">
                    {formatPowerOnTime(d.powerOnHours)}
                    {hasBadSectors && (
                      <span style={{ color: 'var(--bad)', marginLeft: 6 }}>
                        · {d.badSectors + d.uncorrectableSectors} bad
                      </span>
                    )}
                    {test && (
                      <span style={{ color: KIND_COLOR[test.kind], marginLeft: 6 }}>
                        · {test.label}
                      </span>
                    )}
                  </span>
                  <span className="val">{fmtTemp(d.tempC, unit)}</span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {allIncompat.length > 0 && (
        <div className="t-sub" style={{ color: 'var(--warn)', fontSize: 12 }}>
          Mismatched drives: {allIncompat.join(', ')}
        </div>
      )}
    </Tile>
  );
}
