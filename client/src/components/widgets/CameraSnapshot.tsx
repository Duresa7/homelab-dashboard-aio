import { useEffect, useState } from 'react';
import type { ProtectCamera } from '../../types';
import { cn } from '@/lib/utils';

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
      className={cn(
        'cam-snap relative flex w-full items-center justify-center overflow-hidden rounded-md bg-black',
        className,
      )}
      style={{
        aspectRatio: String(aspect),
      }}
    >
      {displayed && isConnected ? (
        <img
          src={displayed}
          alt={`${camera.name} snapshot`}
          className="block h-full w-full object-cover"
        />
      ) : null}
      {!isConnected ? (
        <div className="t-sub text-muted-foreground">offline</div>
      ) : !primed ? (
        <div className="t-sub text-muted-foreground">loading…</div>
      ) : failed && !displayed ? (
        <div className="t-sub text-bad">no snapshot</div>
      ) : null}
      <div className="absolute bottom-1.5 left-2 rounded-[3px] bg-black/55 px-1.5 py-0.5 font-sans text-[11px] text-white">
        <span
          className={cn(
            'mr-1.5 inline-block size-1.5 rounded-full align-middle',
            isConnected ? 'bg-ok' : 'bg-bad',
          )}
        />
        {camera.name}
      </div>
    </div>
  );
}
