import { useRef, useState } from 'react';
import { ImagePlus, Loader2, Palette, X } from 'lucide-react';
import { toast } from 'sonner';

import { BrandIcon } from '@/components/icons/BrandIcon';
import { Button } from '@/components/ui/button';
import { deleteIcon, uploadImage } from '@/lib/images';
import { InventoryIcon } from '@/lib/inventoryIcons';
import type { ItemIcon } from '@/lib/inventory';

import { Section } from './primitives';

const ICON_CHOICES = [
  'proxmox',
  'ubiquiti',
  'cisco',
  'western-digital',
  'samsung',
  'seagate',
  'nvidia',
  'amd',
  'intel',
  'docker',
  'portainer',
  'synology',
  'truenas',
  'qnap',
  'netgear',
  'apple',
  'asus',
  'hp',
  'tp-link',
];

interface IconSectionProps {
  icon?: ItemIcon;
  isEditing: boolean;
  label: string;
  autoBrandText?: string | Array<string | null | undefined> | null;
  onChange: (icon: ItemIcon | undefined) => void;
}

export function IconSection({ icon, isEditing, label, autoBrandText, onChange }: IconSectionProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  if (!isEditing && !icon) return null;

  const replaceIcon = (next: ItemIcon | undefined) => {
    if (icon?.kind === 'image' && icon.id !== (next?.kind === 'image' ? next.id : undefined)) {
      deleteIcon(icon);
    }
    onChange(next);
  };

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const uploaded = await uploadImage(file);
      replaceIcon({ kind: 'image', ...uploaded });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <Section icon={Palette} title="Icon">
      <div className="flex flex-wrap items-center gap-3">
        <InventoryIcon
          icon={icon}
          brandText={autoBrandText}
          label={label}
          size={36}
          fallback={Palette}
        />
        {isEditing ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <ImagePlus className="size-3.5" />
              )}
              Upload
            </Button>
            {icon ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => replaceIcon(undefined)}
              >
                <X className="size-3.5" />
                Clear
              </Button>
            ) : null}
          </>
        ) : null}
      </div>

      {isEditing ? (
        <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-8 md:grid-cols-10">
          {ICON_CHOICES.map((name) => (
            <button
              key={name}
              type="button"
              className="flex size-9 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:border-ring hover:text-foreground"
              onClick={() => replaceIcon({ kind: 'dashboard', name })}
              title={name}
              aria-label={`Use ${name} icon`}
            >
              <BrandIcon name={name} size={20} alt="" />
            </button>
          ))}
        </div>
      ) : null}

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(event) => void pickFile(event.target.files?.[0])}
      />
    </Section>
  );
}
