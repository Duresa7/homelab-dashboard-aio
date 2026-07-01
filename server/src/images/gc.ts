import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

import type { StateStore } from '../storage/types.js';

const FILE_RE = /^([0-9a-f]{16})(\.thumb)?\.webp$/;

export const GC_MIN_AGE_MS = 24 * 60 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectImageIds(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectImageIds(item, out);
    return out;
  }
  if (!isRecord(value)) return out;
  const images = value.images;
  if (Array.isArray(images)) {
    for (const img of images) {
      if (isRecord(img) && typeof img.id === 'string') out.add(img.id);
    }
  }
  const icon = value.icon;
  if (isRecord(icon) && icon.kind === 'image' && typeof icon.id === 'string') {
    out.add(icon.id);
  }
  for (const key of Object.keys(value)) {
    if (key !== 'images' && key !== 'icon') collectImageIds(value[key], out);
  }
  return out;
}

export async function sweepOrphanedImages(
  dir: string,
  store: StateStore,
  opts: { minAgeMs?: number; now?: number } = {},
): Promise<number> {
  const minAgeMs = opts.minAgeMs ?? GC_MIN_AGE_MS;
  const now = opts.now ?? Date.now();

  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return 0;
  }

  const inventory = await store.get('inventory');
  const referenced = collectImageIds(inventory?.value);

  let removed = 0;
  for (const file of files) {
    const match = FILE_RE.exec(file);
    if (!match) continue;
    if (referenced.has(match[1])) continue;
    const full = path.join(dir, file);
    try {
      const info = await stat(full);
      if (now - info.mtimeMs < minAgeMs) continue;
      await rm(full, { force: true });
      removed++;
    } catch {
      void 0;
    }
  }
  if (removed > 0) console.log(`Images: GC removed ${removed} orphaned file(s)`);
  return removed;
}
