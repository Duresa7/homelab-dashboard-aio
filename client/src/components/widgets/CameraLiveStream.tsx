import { useEffect, useRef, useState } from 'react';
import type Hls from 'hls.js'; // type only — the runtime lib is lazy-loaded below
import type { ProtectCamera } from '../../types';
import { CameraSnapshot } from './CameraSnapshot';
import { cn } from '@/lib/utils';

interface Props {
  camera: ProtectCamera;
  quality?: 'high' | 'medium' | 'low';
  muted?: boolean;
  aspect?: number;
  className?: string;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'live' }
  | { kind: 'error'; message: string; canFallback: boolean }
  | { kind: 'offline' };

// Reuses the server-side ffmpeg HLS session. On mount, POST start; on
// unmount we stop the player but leave the server session alive — the
// idle reaper kills it when no client requests segments for a while.
// If the stream fails (ffmpeg missing, RTSPS refused, codec issue), we
// transparently fall back to the snapshot-rotation view.
export function CameraLiveStream({
  camera,
  quality = 'medium',
  muted = true,
  aspect = 16 / 9,
  className,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const cancelledRef = useRef(false);
  const [status, setStatus] = useState<Status>(
    camera.state === 'CONNECTED' ? { kind: 'starting' } : { kind: 'offline' },
  );

  useEffect(() => {
    cancelledRef.current = false;
    if (camera.state !== 'CONNECTED') {
      setStatus({ kind: 'offline' });
      return () => {
        cancelledRef.current = true;
      };
    }
    setStatus({ kind: 'starting' });

    let hls: Hls | null = null;

    const start = async () => {
      try {
        const res = await fetch(
          `/api/protect/cameras/${camera.id}/stream/start?quality=${quality}`,
          { method: 'POST' },
        );
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          const msg = payload.error || `start failed (${res.status})`;
          // 503 with hint = ffmpeg not installed → fall back permanently.
          const canFallback = res.status === 503 || /ffmpeg|not available/i.test(msg);
          if (!cancelledRef.current) setStatus({ kind: 'error', message: msg, canFallback });
          return;
        }
        if (cancelledRef.current) return;
        const playlist = payload.playlist as string;
        const video = videoRef.current;
        if (!video) return;

        // Lazy-load hls.js (~520KB) only when a live stream is actually opened.
        const Hls = (await import('hls.js')).default;
        if (cancelledRef.current) return;

        if (Hls.isSupported()) {
          hls = new Hls({
            lowLatencyMode: true,
            liveDurationInfinity: true,
            maxBufferLength: 8,
            backBufferLength: 4,
          });
          hlsRef.current = hls;
          hls.loadSource(playlist);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (!cancelledRef.current) {
              setStatus({ kind: 'live' });
              video.play().catch(() => {
                /* autoplay blocked is OK */
              });
            }
          });
          hls.on(Hls.Events.ERROR, (_evt, data) => {
            if (data.fatal) {
              setStatus({
                kind: 'error',
                message: `${data.type}: ${data.details}`,
                canFallback: true,
              });
              try {
                hls?.destroy();
              } catch {
                /* ignore */
              }
              hlsRef.current = null;
            }
          });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          // Safari plays HLS natively.
          video.src = playlist;
          video.addEventListener('loadedmetadata', () => {
            if (!cancelledRef.current) {
              setStatus({ kind: 'live' });
              video.play().catch(() => {
                /* ignore */
              });
            }
          });
        } else {
          setStatus({
            kind: 'error',
            message: 'HLS not supported in this browser',
            canFallback: true,
          });
        }
      } catch (err) {
        if (cancelledRef.current) return;
        setStatus({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
          canFallback: true,
        });
      }
    };

    start();

    return () => {
      cancelledRef.current = true;
      try {
        hlsRef.current?.destroy();
      } catch {
        /* ignore */
      }
      hlsRef.current = null;
      // Best-effort stop — fire-and-forget; idle reaper handles failures.
      fetch(`/api/protect/cameras/${camera.id}/stream/stop`, { method: 'POST' }).catch(() => {
        /* ignore */
      });
    };
  }, [camera.id, camera.state, quality]);

  if (status.kind === 'error' && status.canFallback) {
    return <CameraSnapshot camera={camera} className={className} aspect={aspect} />;
  }

  return (
    <div
      className={cn(
        'cam-live relative flex w-full items-center justify-center overflow-hidden rounded-md bg-black',
        className,
      )}
      style={{
        aspectRatio: String(aspect),
      }}
    >
      <video
        ref={videoRef}
        muted={muted}
        playsInline
        autoPlay
        className={cn(
          'h-full w-full bg-black object-cover',
          status.kind === 'live' ? 'block' : 'hidden',
        )}
      />
      {status.kind !== 'live' ? (
        <div
          className={cn(
            't-sub max-w-[90%] p-3 text-center',
            status.kind === 'error' ? 'text-bad' : 'text-muted-foreground',
          )}
        >
          {status.kind === 'starting' && 'starting live stream…'}
          {status.kind === 'offline' && 'offline'}
          {status.kind === 'error' && status.message}
        </div>
      ) : null}
      <div className="absolute bottom-1.5 left-2 flex items-center gap-1.5 rounded-[3px] bg-black/55 px-1.5 py-0.5 font-sans text-[11px] text-white">
        <span
          className={cn(
            'inline-block size-1.5 rounded-full',
            status.kind === 'live' ? 'bg-bad' : camera.state === 'CONNECTED' ? 'bg-ok' : 'bg-bad',
          )}
        />
        {camera.name}
        {status.kind === 'live' ? <span className="opacity-75">LIVE</span> : null}
      </div>
    </div>
  );
}
