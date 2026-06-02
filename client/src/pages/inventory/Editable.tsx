import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';

interface EditableProps {
  value: string;
  editing: boolean;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  mono?: boolean;
  multiline?: boolean;
  muted?: boolean;
  maxLength?: number;
}

export function Editable({
  value,
  editing,
  onChange,
  placeholder = '',
  className = '',
  mono = false,
  multiline = false,
  muted = false,
  maxLength,
}: EditableProps) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);

  const classes = [
    'inv-edit',
    editing ? 'is-editing' : 'is-readonly',
    mono ? 'mono' : '',
    multiline ? 'multi' : '',
    muted ? 'muted' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  if (!editing) {
    const display = value.length > 0 ? value : placeholder;
    return <span className={classes + (value.length === 0 ? ' is-empty' : '')}>{display}</span>;
  }

  const commit = () => {
    if (draft !== value) onChange(draft);
    setFocused(false);
  };
  const handleKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') {
      setDraft(value);
      (e.target as HTMLElement).blur();
    } else if (!multiline && e.key === 'Enter') {
      e.preventDefault();
      (e.target as HTMLElement).blur();
    }
  };

  if (multiline) {
    return (
      <textarea
        className={classes}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={commit}
        onKeyDown={handleKey}
        maxLength={maxLength}
        rows={1}
      />
    );
  }
  return (
    <input
      type="text"
      className={classes}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={commit}
      onKeyDown={handleKey}
      maxLength={maxLength}
    />
  );
}
