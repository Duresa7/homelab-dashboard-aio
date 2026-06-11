import { useRef, useState } from 'react';
import { ImagePlus, Images, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Lightbox } from '@/components/common/Lightbox';
import { deleteImage, imageUrl, uploadImage } from '@/lib/images';
import { MAX_IMAGES_PER_ITEM, type ItemImage } from '@/lib/inventory';

interface ImagesSectionProps {
  images: ItemImage[];
  isEditing: boolean;

  label: string;
  onChange: (images: ItemImage[]) => void;
}

export function ImagesSection({ images, isEditing, label, onChange }: ImagesSectionProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  if (!isEditing && images.length === 0) return null;

  const onPick = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const room = MAX_IMAGES_PER_ITEM - images.length;
    if (room <= 0) return;
    const batch = [...files].slice(0, room);
    if (batch.length < files.length) {
      toast.error(`Up to ${MAX_IMAGES_PER_ITEM} photos per item`);
    }
    setUploading(true);
    try {
      const added: ItemImage[] = [];
      for (const file of batch) {
        added.push(await uploadImage(file));
      }
      onChange([...images, ...added]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const remove = (img: ItemImage) => {
    onChange(images.filter((i) => i.id !== img.id));
    void deleteImage(img.id);
  };

  return (
    <section className="rounded-xl border border-border bg-muted/30 p-4 md:col-span-2">
      <h3 className="mb-3 flex items-center gap-1.5 text-[12.5px] font-semibold tracking-wide text-muted-foreground">
        <Images className="size-3.5" />
        Photos
        {images.length > 0 ? <span className="tabular-nums">{images.length}</span> : null}
      </h3>

      <div className="flex flex-wrap gap-2">
        {images.map((img, i) => (
          <div key={img.id} className="group relative">
            <button
              type="button"
              onClick={() => setLightboxIndex(i)}
              className="block overflow-hidden rounded-lg border border-border bg-card transition-shadow hover:shadow-md"
              aria-label={`Open photo ${i + 1} of ${label}`}
            >
              <img
                src={imageUrl(img.id, true)}
                alt={`${label} photo ${i + 1}`}
                loading="lazy"
                className="size-24 object-cover"
              />
            </button>
            {isEditing ? (
              <Button
                type="button"
                variant="destructive"
                size="icon"
                className="absolute -right-1.5 -top-1.5 size-5 rounded-full opacity-0 shadow transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                aria-label={`Remove photo ${i + 1}`}
                onClick={() => remove(img)}
              >
                <X className="size-3" />
              </Button>
            ) : null}
          </div>
        ))}

        {isEditing && images.length < MAX_IMAGES_PER_ITEM ? (
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            className="flex size-24 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-muted-foreground transition-colors hover:border-ring hover:text-foreground disabled:opacity-60"
            aria-label="Add photo"
          >
            {uploading ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <ImagePlus className="size-5" />
            )}
            <span className="text-[11px]">{uploading ? 'Uploading…' : 'Add photo'}</span>
          </button>
        ) : null}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={(e) => void onPick(e.target.files)}
      />

      <Lightbox
        images={images}
        index={lightboxIndex}
        onClose={() => setLightboxIndex(null)}
        label={label}
      />
    </section>
  );
}
