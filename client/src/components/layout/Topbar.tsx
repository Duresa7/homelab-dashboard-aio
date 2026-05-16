import { Clock } from './Clock';
import { Icon } from '../icons/Icon';
import { useTempUnit } from '../../lib/units';
import { SECTION_LABEL, subLabel, type Section } from '../../lib/route';

interface Props {
  section: Section;
  activeSub?: string;
  title: string;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

export function Topbar({ section, activeSub, title, theme, onToggleTheme }: Props) {
  const { unit, toggle } = useTempUnit();
  const sectionLbl = SECTION_LABEL[section].toLowerCase();
  const here = activeSub ? subLabel(section, activeSub).toLowerCase() : null;

  return (
    <div className="topbar">
      <div className="tb-title">
        <div className="tb-crumb">
          {here ? (
            <>
              <span>{sectionLbl}</span>
              <span className="sep">/</span>
              <span className="here">{here}</span>
            </>
          ) : (
            <span className="here">{sectionLbl}</span>
          )}
        </div>
        <h1>{title}</h1>
      </div>
      <div className="tb-actions">
        <Clock />
        <button
          className="icon-btn unit-btn"
          onClick={toggle}
          title={`Showing °${unit} — click to switch to °${unit === 'F' ? 'C' : 'F'}`}
          aria-label={`Temperature unit: ${unit}. Click to toggle.`}
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
