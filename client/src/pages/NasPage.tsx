import { HardDrive, ShieldCheck } from 'lucide-react';
import { SmartTile, StorageTile, UnasTile } from '../components/widgets';
import type { DashboardState } from '../types';
import { fmtTemp, useTempUnit } from '../lib/units';
import { formatPowerOnTime } from '../lib/format';

interface Props {
  data: DashboardState;
  sub: string;
}

function Pools({ data }: { data: DashboardState }) {
  return (
    <div className="grid">
      <StorageTile data={data.storage} span={6} expandable={false} />
      <UnasTile data={data.unas} span={6} expandable={false} />
    </div>
  );
}

function Disks({ data }: { data: DashboardState }) {
  const { unit } = useTempUnit();
  const disks = data.storage.disks;
  return (
    <div className="grid">
      <SmartTile data={data.storage} span={12} expandable={false} />
      <div className="tile span-12">
        <div className="t-head">
          <div className="t-title"><HardDrive size={14} strokeWidth={1.75} />All Disks <span className="t-sub">· {disks.length}</span></div>
        </div>
        {disks.length === 0 ? (
          <div className="page-empty">No disks reported</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>SMART</th>
                <th>Device</th>
                <th>Model</th>
                <th className="num">Temp</th>
                <th className="num" title="Total power-on time (drive age)">Age</th>
              </tr>
            </thead>
            <tbody>
              {disks.map((d) => {
                const pillKind = d.smart === 'warn' ? 'warn' : d.smart === 'bad' ? 'bad' : 'ok';
                return (
                  <tr key={d.name}>
                    <td>
                      <span className={`pill ${pillKind}`}>
                        <ShieldCheck size={12} strokeWidth={2} style={{ marginRight: 2 }} />
                        {d.smart}
                      </span>
                    </td>
                    <td className="mono">
                      <span className="icon-text">
                        <HardDrive size={13} strokeWidth={1.75} />
                        {d.name}
                      </span>
                    </td>
                    <td>{d.model}</td>
                    <td className="tnum num">{fmtTemp(d.tempC, unit)}</td>
                    <td className="tnum num">{formatPowerOnTime(d.ageHours)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function NasPage({ data, sub }: Props) {
  if (sub === 'disks') return <Disks data={data} />;
  return <Pools data={data} />;
}
