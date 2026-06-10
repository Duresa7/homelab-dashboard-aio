// Inventory photo uploads. Files live on local disk next to the SQLite state
// (data/images/ by default) regardless of the configured DB backend — image
// refs travel inside the inventory state blob, the bytes stay on the app host.
//
// Every accepted upload is re-encoded with sharp: EXIF orientation is applied
// (rotate()), all metadata is dropped by the re-encode, and the result is
// stored as webp in a full (max 2048px) and thumb (256px) variant. The stored
// id is random, so URLs are immutable and cacheable.
import { randomBytes } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';

import type { Express, NextFunction, Request, RequestHandler, Response } from 'express';
import multer from 'multer';
import sharp from 'sharp';

import { errorMessage } from '../lib/errors.js';
import { makeSameOriginGuard } from '../state/index.js';
import type { StateStore } from '../storage/types.js';
import { sweepOrphanedImages } from './gc.js';

export const IMAGE_ID_RE = /^[0-9a-f]{16}$/;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const FULL_MAX_PX = 2048;
const THUMB_PX = 256;
const WEBP_QUALITY = 82;
/** Decompression-bomb guard for sharp. */
const MAX_INPUT_PIXELS = 64_000_000;

export function imagePath(dir: string, id: string, thumb = false): string {
  return path.join(dir, `${id}${thumb ? '.thumb' : ''}.webp`);
}

/** Magic-byte allowlist: jpeg/png/webp. Fast pre-check; sharp's decoded
 * format is the authoritative one. */
export function sniffImageFormat(buf: Buffer): 'jpeg' | 'png' | 'webp' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  )
    return 'png';
  if (
    buf.length >= 12 &&
    buf.toString('latin1', 0, 4) === 'RIFF' &&
    buf.toString('latin1', 8, 12) === 'WEBP'
  )
    return 'webp';
  return null;
}

export interface InitImagesOpts {
  /** Directory for image files; created on demand. */
  dir: string;
  /** State store used by the orphan GC to read inventory refs. */
  store: StateStore;
}

export interface ImagesHandle {
  dir: string;
  shutdown(): void;
}

export function initImages(app: Express, opts: InitImagesOpts): ImagesHandle {
  const { dir, store } = opts;
  const sameOrigin = makeSameOriginGuard();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  });

  // multer throws on oversize; map its errors to JSON instead of a stack page.
  const uploadSingle: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
    upload.single('file')(req, res, (err: unknown) => {
      if (!err) return next();
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: `image exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024}MB` });
      }
      return res.status(400).json({ error: errorMessage(err) });
    });
  };

  app.post('/api/images', sameOrigin, uploadSingle, async (req: Request, res: Response) => {
    try {
      const file = req.file;
      if (!file || file.size === 0) {
        return res.status(400).json({ error: 'attach an image as multipart field "file"' });
      }
      if (!sniffImageFormat(file.buffer)) {
        return res.status(415).json({ error: 'only JPEG, PNG, or WebP images are accepted' });
      }

      const input = sharp(file.buffer, { limitInputPixels: MAX_INPUT_PIXELS });
      const meta = await input.metadata().catch(() => null);
      if (!meta || !meta.format || !['jpeg', 'png', 'webp'].includes(meta.format)) {
        return res.status(415).json({ error: 'only JPEG, PNG, or WebP images are accepted' });
      }

      // rotate() applies EXIF orientation; the webp re-encode (no
      // withMetadata) drops EXIF/GPS and every other metadata block.
      const { data: full, info } = await sharp(file.buffer, {
        limitInputPixels: MAX_INPUT_PIXELS,
      })
        .rotate()
        .resize(FULL_MAX_PX, FULL_MAX_PX, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer({ resolveWithObject: true });
      const thumb = await sharp(full)
        .resize(THUMB_PX, THUMB_PX, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer();

      const id = randomBytes(8).toString('hex');
      await mkdir(dir, { recursive: true });
      await writeFile(imagePath(dir, id), full);
      await writeFile(imagePath(dir, id, true), thumb);

      res.status(201).json({ id, w: info.width, h: info.height });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  const serve = (thumb: boolean) => (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!IMAGE_ID_RE.test(id)) return res.status(400).json({ error: 'invalid image id' });
    // Ids are random and content-addressed-per-upload: safe to cache forever.
    res.sendFile(
      imagePath(dir, id, thumb),
      {
        headers: {
          'Content-Type': 'image/webp',
          'Cache-Control': 'private, max-age=31536000, immutable',
        },
      },
      (err) => {
        if (err && !res.headersSent) res.status(404).json({ error: 'not found' });
      },
    );
  };

  app.get('/api/images/:id', serve(false));
  app.get('/api/images/:id/thumb', serve(true));

  app.delete('/api/images/:id', sameOrigin, async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!IMAGE_ID_RE.test(id)) return res.status(400).json({ error: 'invalid image id' });
    try {
      await rm(imagePath(dir, id), { force: true });
      await rm(imagePath(dir, id, true), { force: true });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  // Admin-triggered orphan sweep (role enforced by the auth gate matrix).
  app.post('/api/images/gc', sameOrigin, async (_req: Request, res: Response) => {
    try {
      const removed = await sweepOrphanedImages(dir, store);
      res.json({ ok: true, removed });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  // Boot-time sweep, fire-and-forget — never blocks startup.
  void sweepOrphanedImages(dir, store).catch((err) => {
    console.warn(`Images: boot GC failed - ${errorMessage(err)}`);
  });

  return { dir, shutdown() {} };
}
