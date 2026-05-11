import type { ReactNode } from 'react';
import { Clock } from './Clock';
import { Icon } from '../icons/Icon';

interface Props {
  title: string;
  subtitle?: string;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  extraActions?: ReactNode;
}

export function Topbar({ title, subtitle, theme, onToggleTheme, extraActions }: Props) {
  return (
    <div className="topbar">
      <div className="tb-title">
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      <div className="tb-actions">
        <Clock />
        <button className="icon-btn" title="Refresh">
          <Icon name="refresh" />
        </button>
        <button className="icon-btn" onClick={onToggleTheme} title="Toggle theme">
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
        </button>
        {extraActions}
      </div>
    </div>
  );
}
