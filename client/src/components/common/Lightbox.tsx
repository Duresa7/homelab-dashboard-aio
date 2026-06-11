import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { imageUrl } from '@/lib/images';
import type { ItemImage } from '@/lib/inventory';
import { cn } from '@/lib/utils';

interface LightboxProps {
  images: ItemImage[];

  index: number | null;
  onClose: () => void;

  label?: string;
}

export function Lightbox({ images, index, onClose, label }: LightboxProps) {
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    if (index !== null) setCurrent(Math.min(Math.max(index, 0), images.length - 1));
  }, [index, images.length]);

  const step = useCallback(
    (delta: number) => {
      if (images.length < 2) return;
      setCurrent((c) => (c + delta + images.length) % images.length);
    },
    [images.length],
  );

  const open = index !== null && images.length > 0;
  const image = open ? images[Math.min(current, images.length - 1)] : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-[min(92vw,1100px)] border-none bg-transparent p-0 shadow-none sm:max-w-[min(92vw,1100px)]"
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') step(-1);
          if (e.key === 'ArrowRight') step(1);
        }}
      >
        <DialogTitle className="sr-only">{label || 'Photo'}</DialogTitle>
        <DialogDescription className="sr-only">
          Photo {current + 1} of {images.length}
        </DialogDescription>
        {image ? (
          <div className="relative flex items-center justify-center">
            <img
              src={imageUrl(image.id)}
              alt={label ? `${label} photo ${current + 1}` : `Photo ${current + 1}`}
              className="max-h-[85vh] w-auto max-w-full rounded-lg object-contain"
              width={image.w || undefined}
              height={image.h || undefined}
            />
            {images.length > 1 ? (
              <>
                <button
                  type="button"
                  aria-label="Previous photo"
                  onClick={() => step(-1)}
                  className={cn(
                    'absolute left-2 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full',
                    'bg-black/50 text-white transition-colors hover:bg-black/70',
                  )}
                >
                  <ChevronLeft className="size-5" />
                </button>
                <button
                  type="button"
                  aria-label="Next photo"
                  onClick={() => step(1)}
                  className={cn(
                    'absolute right-2 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full',
                    'bg-black/50 text-white transition-colors hover:bg-black/70',
                  )}
                >
                  <ChevronRight className="size-5" />
                </button>
                <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-2.5 py-0.5 font-mono text-xs text-white">
                  {current + 1} / {images.length}
                </span>
              </>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
