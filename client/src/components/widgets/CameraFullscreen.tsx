import { useEffect, useRef, useState } from 'react';
import { Icon } from '../icons/Icon';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ProtectCamera } from '../../types';
import { CameraSnapshot } from './CameraSnapshot';
import { CameraLiveStream } from './CameraLiveStream';
import { cn } from '@/lib/utils';

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
      document.exitFullscreen().catch(() => {
        /* ignore */
      });
    } else if (panelRef.current) {
      panelRef.current.requestFullscreen().catch(() => {
        /* ignore */
      });
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/85 p-6"
    >
      <div
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        className="relative flex flex-col overflow-hidden bg-black"
        style={{
          width: isFs ? '100vw' : 'min(95vw, 1600px)',
          height: isFs ? '100vh' : 'auto',
          maxHeight: '95vh',
          borderRadius: isFs ? 0 : 8,
        }}
      >
        <div className="absolute inset-x-0 top-0 z-[2] flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-3.5 py-2.5 font-sans text-white">
          <div className="flex items-center gap-2.5">
            <span
              className={cn(
                'size-2 rounded-full',
                camera.state === 'CONNECTED' ? 'bg-ok' : 'bg-bad',
              )}
            />
            <strong className="text-[15px]">{camera.name}</strong>
            <span className="text-xs opacity-70">{camera.modelKey}</span>
          </div>
          <div className="flex items-center gap-2">
            <ModeButton active={mode === 'snapshot'} onClick={() => setMode('snapshot')}>
              Snapshot
            </ModeButton>
            <ModeButton active={mode === 'live'} onClick={() => setMode('live')}>
              Live
            </ModeButton>
            {mode === 'live' ? (
              <Select
                value={quality}
                onValueChange={(v) => setQuality(v as 'low' | 'medium' | 'high')}
              >
                <SelectTrigger
                  size="sm"
                  className="h-7 gap-1 border-white/20 bg-white/10 px-2 text-xs text-white shadow-none hover:bg-white/20 focus-visible:border-white/40 focus-visible:ring-white/40 dark:bg-white/10 dark:hover:bg-white/20 [&_svg]:!text-white/70"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  className="z-[1100] min-w-[5rem] border-white/15 bg-neutral-900 text-white [&_[data-slot=select-item]:focus]:bg-white/15 [&_[data-slot=select-item]:focus]:text-white [&_[data-slot=select-item]]:text-white/90"
                >
                  <SelectItem value="low">low</SelectItem>
                  <SelectItem value="medium">medium</SelectItem>
                  <SelectItem value="high">high</SelectItem>
                </SelectContent>
              </Select>
            ) : null}
            <IconButton title={isFs ? 'Exit fullscreen' : 'Fullscreen'} onClick={toggleFullscreen}>
              <Icon name="expand" size={14} />
            </IconButton>
            <IconButton title="Close" onClick={onClose}>
              <Icon name="x" size={14} />
            </IconButton>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center bg-black">
          <div className="h-full max-h-full w-full">
            {mode === 'live' ? (
              <CameraLiveStream
                key={`live-${quality}`}
                camera={camera}
                quality={quality}
                muted={false}
                aspect={16 / 9}
              />
            ) : (
              <CameraSnapshot camera={camera} highQuality intervalMs={2000} aspect={16 / 9} />
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
      className={cn(
        'cursor-pointer rounded border border-white/20 px-2.5 py-1 text-xs',
        active ? 'bg-white text-black' : 'bg-white/10 text-white hover:bg-white/20',
      )}
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
      className="flex size-7 cursor-pointer items-center justify-center rounded border border-white/20 bg-white/10 text-white hover:bg-white/20"
    >
      {children}
    </button>
  );
}
