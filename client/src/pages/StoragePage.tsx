import { SmartTile, StorageTile, UnasTile } from '../components/widgets';
import type { DashboardState } from '../types';

interface Props {
  data: DashboardState;
}

export function StoragePage({ data }: Props) {
  return (
    <div className="grid">
      <StorageTile data={data.storage} span={6} expandable={false} />
      <UnasTile data={data.unas} span={6} expandable={false} />
      <SmartTile data={data.storage} span={12} expandable={false} />
      <div className="tile span-12">
        <div className="t-title">All Disks</div>
        <table className="data-table">
          <thead>
            <tr>
              <th>SMART</th>
              <th>Device</th>
              <th>Model</th>
              <th className="num">Temp</th>
              <th className="num">Wear</th>
            </tr>
          </thead>
          <tbody>
            {data.storage.disks.map((d) => (
              <tr key={d.name}>
                <td>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span
                      style={{
                        width: 7, height: 7, borderRadius: 50,
                        background: d.smart === 'warn' ? 'var(--warn)' : 'var(--ok)',
                      }}
                    />
                    {d.smart}
                  </span>
                </td>
                <td className="mono">{d.name}</td>
                <td>{d.model}</td>
                <td className="mono tnum num">{d.tempC}°C</td>
                <td className="mono tnum num">{d.wear}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
