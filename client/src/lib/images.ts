import type { ItemIcon, ItemImage } from './inventory';
import { apiFetch } from './http';

export function imageUrl(id: string, thumb = false): string {
  return `/api/images/${encodeURIComponent(id)}${thumb ? '/thumb' : ''}`;
}

export async function uploadImage(file: File): Promise<ItemImage> {
  const form = new FormData();
  form.append('file', file);
  const res = await apiFetch('/api/images', { method: 'POST', body: form });
  const body = (await res.json().catch(() => ({}))) as Partial<ItemImage> & { error?: string };
  if (!res.ok || typeof body.id !== 'string') {
    throw new Error(body.error || `upload failed (${res.status})`);
  }
  return { id: body.id, w: body.w ?? 0, h: body.h ?? 0 };
}

export async function deleteImage(id: string): Promise<void> {
  await apiFetch(imageUrl(id), { method: 'DELETE' }).catch(() => {
    void 0;
  });
}

export function deleteImages(images: { id: string }[] | undefined): void {
  for (const img of images ?? []) void deleteImage(img.id);
}

export function deleteIcon(icon: ItemIcon | undefined): void {
  if (icon?.kind === 'image') void deleteImage(icon.id);
}

export function deleteItemMedia(item: { icon?: ItemIcon; images?: { id: string }[] } | undefined) {
  if (!item) return;
  deleteIcon(item.icon);
  deleteImages(item.images);
}
