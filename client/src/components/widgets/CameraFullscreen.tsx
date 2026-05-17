import { useEffect, useRef, useState } from 'react';
import { Icon } from '../icons/Icon';
import type { ProtectCamera } from '../../types';
import { CameraSnapshot } from './CameraSnapshot';
import { CameraLiveStream } from './CameraLiveStream';

export type CameraViewMode = 'snapshot' | 'live';

interface Props {
  camera: ProtectCamera;
  initialMode?: CameraViewMode;
  onClose: () => void;
}

// Modal overlay: clicking the backdrop or pressing Escape closes it.
// The "Fullscreen" button calls the browser Fullscreen API on the panel
// element itself, so the camera fills the entire screen (no browser
// chrome). Inside browser-fullscreen, ESC is owned by the browser — the
// page-level ESC handler only fires once we're back in windowed mode.
export function CameraFullscreen({ camera, initialMode = 'snapshot', onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<CameraViewMode>(initialMode);
  const [quality, setQuality] = useState<'low' | 'medium' | 'high'>('high');
  const [isFs, setIsFs] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.fullscreenElement) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const onFsChange = () => setIsFs(document.fullscreenElement === panelRef.current);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => { /* ignore */ });
    } else if (panelRef.current) {
      panelRef.current.requestFullscreen().catch(() => { /* ignore */ });
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.85)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative',
          width: isFs ? '100vw' : 'min(95vw, 1600px)',
          height: isFs ? '100vh' : 'auto',
          maxHeight: '95vh',
          background: '#000',
          borderRadius: isFs ? 0 : 8,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 14px',
            background: 'linear-gradient(rgba(0,0,0,0.7), rgba(0,0,0,0))',
            color: '#fff',
            fontFamily: 'var(--font-sans)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 50,
                background: camera.state === 'CONNECTED' ? '#00d27a' : '#e34',
              }}
            />
            <strong style={{ fontSize: 15 }}>{camera.name}</strong>
            <span style={{ fontSize: 12, opacity: 0.7 }}>{camera.modelKey}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ModeButton active={mode === 'snapshot'} onClick={() => setMode('snapshot')}>
              Snapshot
            </ModeButton>
            <ModeButton active={mode === 'live'} onClick={() => setMode('live')}>
              Live
            </ModeButton>
            {mode === 'live' ? (
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value as 'low' | 'medium' | 'high')}
                style={{
                  background: 'rgba(255,255,255,0.1)',
                  color: '#fff',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: 4,
                  padding: '4px 6px',
                  fontSize: 12,
                }}
              >
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            ) : null}
            <IconButton title={isFs ? 'Exit fullscreen' : 'Fullscreen'} onClick={toggleFullscreen}>
              <Icon name="expand" size={14} />
            </IconButton>
            <IconButton title="Close" onClick={onClose}>
              <Icon name="x" size={14} />
            </IconButton>
          </div>
        </div>
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#000',
            minHeight: 0,
          }}
        >
          <div style={{ width: '100%', height: '100%', maxHeight: '100%' }}>
            {mode === 'live' ? (
              <CameraLiveStream
                key={`live-${quality}`}
                camera={camera}
                quality={quality}
                muted={false}
                aspect={16 / 9}
              />
            ) : (
              <CameraSnapshot
                camera={camera}
                highQuality
                intervalMs={2000}
                aspect={16 / 9}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? '#fff' : 'rgba(255,255,255,0.1)',
        color: active ? '#000' : '#fff',
        border: '1px solid rgba(255,255,255,0.2)',
        borderRadius: 4,
        padding: '4px 10px',
        fontSize: 12,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function IconButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        background: 'rgba(255,255,255,0.1)',
        color: '#fff',
        border: '1px solid rgba(255,255,255,0.2)',
        borderRadius: 4,
        width: 28,
        height: 28,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}
