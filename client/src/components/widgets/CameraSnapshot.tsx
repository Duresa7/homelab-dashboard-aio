import { useEffect, useState } from 'react';
import type { ProtectCamera } from '../../types';

interface Props {
  camera: ProtectCamera;
  intervalMs?: number;
  highQuality?: boolean;
  channel?: 'main' | 'package';
  className?: string;
  aspect?: number;
}

// Auto-refreshing camera snapshot. We rotate two <img> elements:
// the next image is preloaded into a hidden slot, and only swapped in
// once it has finished decoding — that way the visible image never
// flashes back to "broken" between polls.
export function CameraSnapshot({
  camera,
  intervalMs = 4000,
  highQuality = false,
  channel = 'main',
  className,
  aspect = 16 / 9,
}: Props) {
  const isConnected = camera.state === 'CONNECTED';
  const [displayed, setDisplayed] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [primed, setPrimed] = useState(false);

  useEffect(() => {
    if (!isConnected) {
      setDisplayed(null);
      setPrimed(true);
      return;
    }
    // `cancelled` is closed-over by this single effect run only. StrictMode
    // simulates a remount in dev, and each run gets its own copy — so
    // late image callbacks from a discarded run no-op without affecting
    // the live run. Do NOT add a "mounted ref" pattern here: refs persist
    // across StrictMode's simulated unmount and would silently stick the
    // component on "loading" forever (we hit this and it took a minute).
    let cancelled = false;

    const baseQs = new URLSearchParams();
    if (channel === 'package') baseQs.set('channel', 'package');
    if (highQuality) baseQs.set('highQuality', 'true');

    const buildUrl = () => {
      const qs = new URLSearchParams(baseQs);
      qs.set('t', String(Date.now()));
      return `/api/protect/cameras/${camera.id}/snapshot?${qs}`;
    };

    const tick = () => {
      if (cancelled) return;
      const url = buildUrl();
      const img = new Image();
      img.onload = () => {
        if (cancelled) return;
        setDisplayed(url);
        setFailed(false);
        setPrimed(true);
      };
      img.onerror = () => {
        if (cancelled) return;
        setFailed(true);
        setPrimed(true);
      };
      img.src = url;
    };

    tick();
    const id = window.setInterval(tick, Math.max(1000, intervalMs));
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [camera.id, isConnected, intervalMs, highQuality, channel]);

  return (
    <div
      className={`cam-snap ${className ?? ''}`}
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: String(aspect),
        background: '#000',
        borderRadius: 6,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {displayed && isConnected ? (
        <img
          src={displayed}
          alt={camera.name}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : null}
      {!isConnected ? (
        <div className="t-sub" style={{ color: '#9aa' }}>
          offline
        </div>
      ) : !primed ? (
        <div className="t-sub" style={{ color: '#9aa' }}>
          loading…
        </div>
      ) : failed && !displayed ? (
        <div className="t-sub" style={{ color: '#c66' }}>
          no snapshot
        </div>
      ) : null}
      <div
        style={{
          position: 'absolute',
          left: 8,
          bottom: 6,
          fontSize: 11,
          padding: '2px 6px',
          borderRadius: 3,
          background: 'rgba(0,0,0,0.55)',
          color: '#fff',
          fontFamily: 'var(--font-sans)',
          letterSpacing: 0.2,
        }}
      >
        <span
          style={{
            display: 'inline-block',
            width: 6,
            height: 6,
            borderRadius: 50,
            background: isConnected ? 'var(--ok, #00d27a)' : 'var(--bad, #e34)',
            marginRight: 6,
            verticalAlign: 'middle',
          }}
        />
        {camera.name}
      </div>
    </div>
  );
}
