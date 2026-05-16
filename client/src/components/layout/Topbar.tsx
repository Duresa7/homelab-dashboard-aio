import { Clock } from './Clock';
import { Icon } from '../icons/Icon';
import { useTempUnit } from '../../lib/units';

interface Props {
  title: string;
  subtitle?: string;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

export function Topbar({ title, subtitle, theme, onToggleTheme }: Props) {
  const { unit, toggle } = useTempUnit();
  return (
    <div className="topbar">
      <div className="tb-title">
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      <div className="tb-actions">
        <Clock />
        <button
          className="icon-btn unit-btn"
          onClick={toggle}
          title={`Showing °${unit} — click to switch to °${unit === 'F' ? 'C' : 'F'}`}
          aria-label={`Temperature unit: ${unit}. Click to toggle.`}
          style={{
            width: 'auto',
            padding: '0 10px',
            fontSize: 12,
            fontWeight: 600,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          °{unit}
        </button>
        <button className="icon-btn" title="Refresh">
          <Icon name="refresh" />
        </button>
        <button className="icon-btn" onClick={onToggleTheme} title="Toggle theme">
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
        </button>
      </div>
    </div>
  );
}
