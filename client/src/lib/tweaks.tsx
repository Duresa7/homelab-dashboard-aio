import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

const PANEL_STYLE = `
  .twk-launch{position:fixed;right:16px;bottom:16px;z-index:2147483645;
    width:36px;height:36px;border-radius:50%;border:1px solid rgba(0,0,0,.1);
    background:rgba(250,249,247,.92);color:#29261b;display:grid;place-items:center;
    box-shadow:0 6px 18px rgba(0,0,0,.18);cursor:pointer}
  .twk-launch svg{width:16px;height:16px}
  [data-theme='dark'] .twk-launch{background:rgba(30,30,32,.92);color:#f4f4f1;
    border-color:rgba(255,255,255,.1)}
  .twk-panel{position:fixed;right:16px;bottom:16px;z-index:2147483646;width:280px;
    max-height:calc(100vh - 32px);display:flex;flex-direction:column;
    background:rgba(250,249,247,.78);color:#29261b;
    -webkit-backdrop-filter:blur(24px) saturate(160%);backdrop-filter:blur(24px) saturate(160%);
    border:.5px solid rgba(255,255,255,.6);border-radius:14px;
    box-shadow:0 1px 0 rgba(255,255,255,.5) inset,0 12px 40px rgba(0,0,0,.18);
    font:11.5px/1.4 ui-sans-serif,system-ui,-apple-system,sans-serif;overflow:hidden}
  [data-theme='dark'] .twk-panel{background:rgba(28,28,32,.82);color:#e8e8e3;
    border-color:rgba(255,255,255,.06)}
  .twk-hd{display:flex;align-items:center;justify-content:space-between;
    padding:10px 8px 10px 14px;cursor:move;user-select:none}
  .twk-hd b{font-size:12px;font-weight:600;letter-spacing:.01em}
  .twk-x{appearance:none;border:0;background:transparent;color:inherit;opacity:.55;
    width:22px;height:22px;border-radius:6px;cursor:pointer;font-size:13px;line-height:1}
  .twk-x:hover{background:rgba(0,0,0,.08);opacity:1}
  .twk-body{padding:2px 14px 14px;display:flex;flex-direction:column;gap:10px;
    overflow-y:auto;overflow-x:hidden;min-height:0}
  .twk-row{display:flex;flex-direction:column;gap:5px}
  .twk-row-h{flex-direction:row;align-items:center;justify-content:space-between;gap:10px}
  .twk-lbl{display:flex;justify-content:space-between;align-items:baseline;opacity:.78}
  .twk-lbl>span:first-child{font-weight:500}
  .twk-val{opacity:.5;font-variant-numeric:tabular-nums}
  .twk-sect{font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
    opacity:.5;padding:10px 0 0}
  .twk-sect:first-child{padding-top:0}
  .twk-field{appearance:none;width:100%;height:26px;padding:0 8px;
    border:.5px solid rgba(0,0,0,.1);border-radius:7px;
    background:rgba(255,255,255,.6);color:inherit;font:inherit;outline:none}
  [data-theme='dark'] .twk-field{background:rgba(0,0,0,.25);border-color:rgba(255,255,255,.1)}
  .twk-field:focus{border-color:rgba(0,0,0,.25)}
  select.twk-field{padding-right:22px}
  .twk-seg{position:relative;display:flex;padding:2px;border-radius:8px;
    background:rgba(0,0,0,.06);user-select:none}
  [data-theme='dark'] .twk-seg{background:rgba(255,255,255,.08)}
  .twk-seg-thumb{position:absolute;top:2px;bottom:2px;border-radius:6px;
    background:rgba(255,255,255,.9);box-shadow:0 1px 2px rgba(0,0,0,.12);
    transition:left .15s cubic-bezier(.3,.7,.4,1),width .15s}
  [data-theme='dark'] .twk-seg-thumb{background:rgba(60,60,68,.95)}
  .twk-seg button{appearance:none;position:relative;z-index:1;flex:1;border:0;
    background:transparent;color:inherit;font:inherit;font-weight:500;min-height:22px;
    border-radius:6px;cursor:pointer;padding:4px 6px;line-height:1.2}
  .twk-toggle{position:relative;width:32px;height:18px;border:0;border-radius:999px;
    background:rgba(0,0,0,.18);transition:background .15s;cursor:pointer;padding:0}
  .twk-toggle[data-on='1']{background:#34c759}
  .twk-toggle i{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;
    background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s}
  .twk-toggle[data-on='1'] i{transform:translateX(14px)}
  .twk-chips{display:flex;gap:6px}
  .twk-chip{appearance:none;flex:1;min-width:0;height:32px;padding:0;border:0;border-radius:6px;
    cursor:pointer;box-shadow:0 0 0 .5px rgba(0,0,0,.12),0 1px 2px rgba(0,0,0,.06);
    transition:transform .12s,box-shadow .12s}
  .twk-chip:hover{transform:translateY(-1px)}
  .twk-chip[data-on='1']{box-shadow:0 0 0 1.5px rgba(0,0,0,.85),0 2px 6px rgba(0,0,0,.15)}
  [data-theme='dark'] .twk-chip[data-on='1']{box-shadow:0 0 0 1.5px rgba(255,255,255,.85),0 2px 6px rgba(0,0,0,.5)}
`;

const STORAGE_KEY = 'homelab-dashboard.tweaks';

export function useTweaks<T extends object>(defaults: T): [T, <K extends keyof T>(k: K, v: T[K]) => void] {
  const [values, setValues] = useState<T>(() => {
    if (typeof window === 'undefined') return defaults;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
    } catch {
      return defaults;
    }
  });

  const setTweak = useCallback(<K extends keyof T>(key: K, val: T[K]) => {
    setValues((prev) => {
      const next = { ...prev, [key]: val };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* localStorage unavailable */
      }
      return next;
    });
  }, []);

  return [values, setTweak];
}

interface PanelProps {
  title?: string;
  children: ReactNode;
}

export function TweaksPanel({ title = 'Tweaks', children }: PanelProps) {
  const [open, setOpen] = useState(false);
  const dragRef = useRef<HTMLDivElement | null>(null);
  const offsetRef = useRef<{ x: number; y: number }>({ x: 16, y: 16 });

  const onDragStart = (e: React.MouseEvent) => {
    const panel = dragRef.current;
    if (!panel) return;
    const r = panel.getBoundingClientRect();
    const sx = e.clientX;
    const sy = e.clientY;
    const startRight = window.innerWidth - r.right;
    const startBottom = window.innerHeight - r.bottom;
    const move = (ev: MouseEvent) => {
      offsetRef.current = {
        x: Math.max(8, startRight - (ev.clientX - sx)),
        y: Math.max(8, startBottom - (ev.clientY - sy)),
      };
      panel.style.right = `${offsetRef.current.x}px`;
      panel.style.bottom = `${offsetRef.current.y}px`;
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <>
      <style>{PANEL_STYLE}</style>
      {!open && (
        <button className="twk-launch" onClick={() => setOpen(true)} aria-label="Open tweaks">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
            strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a8 8 0 0 0 0-6l1.6-1.3-2-3.4-2 .8A8 8 0 0 0 12 3l-.4-2h-4l-.4 2a8 8 0 0 0-5 2.1l-2-.8-2 3.4L0 9a8 8 0 0 0 0 6l-1.6 1.3" />
          </svg>
        </button>
      )}
      {open && (
        <div
          ref={dragRef}
          className="twk-panel"
          style={{ right: offsetRef.current.x, bottom: offsetRef.current.y }}
        >
          <div className="twk-hd" onMouseDown={onDragStart}>
            <b>{title}</b>
            <button
              className="twk-x"
              aria-label="Close tweaks"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setOpen(false)}
            >
              ✕
            </button>
          </div>
          <div className="twk-body">{children}</div>
        </div>
      )}
    </>
  );
}

export function TweakSection({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <>
      <div className="twk-sect">{label}</div>
      {children}
    </>
  );
}

export function TweakRow({
  label,
  value,
  children,
  inline,
}: {
  label: string;
  value?: ReactNode;
  children: ReactNode;
  inline?: boolean;
}) {
  return (
    <div className={inline ? 'twk-row twk-row-h' : 'twk-row'}>
      <div className="twk-lbl">
        <span>{label}</span>
        {value != null && <span className="twk-val">{value}</span>}
      </div>
      {children}
    </div>
  );
}

export function TweakToggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="twk-row twk-row-h">
      <div className="twk-lbl">
        <span>{label}</span>
      </div>
      <button
        type="button"
        className="twk-toggle"
        data-on={value ? '1' : '0'}
        role="switch"
        aria-checked={!!value}
        onClick={() => onChange(!value)}
      >
        <i />
      </button>
    </div>
  );
}

interface RadioOption<T> {
  value: T;
  label: string;
}

export function TweakRadio<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<RadioOption<T> | T>;
  onChange: (v: T) => void;
}) {
  const opts = useMemo<RadioOption<T>[]>(
    () => options.map((o) => (typeof o === 'object' ? o : { value: o, label: String(o) })),
    [options],
  );
  const idx = Math.max(0, opts.findIndex((o) => o.value === value));
  const n = opts.length;
  return (
    <TweakRow label={label}>
      <div role="radiogroup" className="twk-seg">
        <div
          className="twk-seg-thumb"
          style={{
            left: `calc(2px + ${idx} * (100% - 4px) / ${n})`,
            width: `calc((100% - 4px) / ${n})`,
          }}
        />
        {opts.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </TweakRow>
  );
}

interface SelectOption<T> {
  value: T;
  label: string;
}

export function TweakSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<SelectOption<T> | T>;
  onChange: (v: T) => void;
}) {
  const opts = options.map((o) =>
    typeof o === 'object' ? o : ({ value: o, label: String(o) } as SelectOption<T>),
  );
  return (
    <TweakRow label={label}>
      <select
        className="twk-field"
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {opts.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </TweakRow>
  );
}

export function TweakColor({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <TweakRow label={label}>
      <div className="twk-chips" role="radiogroup">
        {options.map((c) => {
          const on = c.toLowerCase() === value.toLowerCase();
          return (
            <button
              key={c}
              type="button"
              className="twk-chip"
              role="radio"
              aria-checked={on}
              data-on={on ? '1' : '0'}
              style={{ background: c }}
              onClick={() => onChange(c)}
              aria-label={c}
              title={c}
            />
          );
        })}
      </div>
    </TweakRow>
  );
}

export function useSystemTheme(): 'light' | 'dark' {
  const [pref, setPref] = useState<'light' | 'dark'>(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light',
  );
  useEffect(() => {
    const m = window.matchMedia('(prefers-color-scheme: dark)');
    const fn = (e: MediaQueryListEvent) => setPref(e.matches ? 'dark' : 'light');
    m.addEventListener('change', fn);
    return () => m.removeEventListener('change', fn);
  }, []);
  return pref;
}
