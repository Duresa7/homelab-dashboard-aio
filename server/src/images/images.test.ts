import { mkdtemp, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { authedAgent, bootstrapAdmin } from '../test/auth.js';
import { loadServerApp } from '../test/serverApp.js';
import { sweepOrphanedImages } from './gc.js';

async function usingApp(
  fn: (ctx: Awaited<ReturnType<typeof loadServerApp>> & { imagesDir: string }) => Promise<unknown>,
) {
  const imagesDir = await mkdtemp(path.join(os.tmpdir(), 'homelab-images-test-'));
  const ctx = await loadServerApp({ IMAGES_DIR: imagesDir });
  try {
    return await fn({ ...ctx, imagesDir });
  } finally {
    await ctx.cleanup();
  }
}

function pngFixture(w = 320, h = 200): Promise<Buffer> {
  return sharp({
    create: { width: w, height: h, channels: 3, background: { r: 200, g: 60, b: 60 } },
  })
    .png()
    .toBuffer();
}

describe('image upload pipeline', () => {
  it('uploads, serves full + thumb, and deletes', async () => {
    await usingApp(async ({ app, imagesDir }) => {
      const admin = await bootstrapAdmin(app);

      const res = await admin
        .post('/api/images')
        .attach('file', await pngFixture(), 'part.png')
        .expect(201);
      expect(res.body.id).toMatch(/^[0-9a-f]{16}$/);
      expect(res.body).toMatchObject({ w: 320, h: 200 });

      const full = await admin.get(`/api/images/${res.body.id}`).expect(200);
      expect(full.headers['content-type']).toContain('image/webp');
      expect(full.headers['cache-control']).toContain('immutable');
      const fullMeta = await sharp(full.body as Buffer).metadata();
      expect(fullMeta.format).toBe('webp');
      expect(fullMeta.width).toBe(320);

      const thumb = await admin.get(`/api/images/${res.body.id}/thumb`).expect(200);
      const thumbMeta = await sharp(thumb.body as Buffer).metadata();
      expect(thumbMeta.width).toBeLessThanOrEqual(256);

      await admin.delete(`/api/images/${res.body.id}`).expect(200);
      await admin.get(`/api/images/${res.body.id}`).expect(404);
      expect(await readdir(imagesDir)).toEqual([]);
    });
  });

  it('accepts WebP uploads through the image API', async () => {
    await usingApp(async ({ app }) => {
      const admin = await bootstrapAdmin(app);
      const webp = await sharp({
        create: { width: 64, height: 64, channels: 3, background: { r: 40, g: 80, b: 120 } },
      })
        .webp()
        .toBuffer();

      const res = await admin.post('/api/images').attach('file', webp, 'icon.webp').expect(201);
      const served = await admin.get(`/api/images/${res.body.id}`).expect(200);
      const meta = await sharp(served.body as Buffer).metadata();

      expect(meta.format).toBe('webp');
      expect(meta.width).toBe(64);
    });
  });

  it('applies EXIF orientation and strips metadata on re-encode', async () => {
    await usingApp(async ({ app }) => {
      const admin = await bootstrapAdmin(app);

      const oriented = await sharp({
        create: { width: 400, height: 300, channels: 3, background: { r: 10, g: 120, b: 40 } },
      })
        .jpeg()
        .withMetadata({ orientation: 6 })
        .toBuffer();

      const res = await admin.post('/api/images').attach('file', oriented, 'photo.jpg').expect(201);

      expect(res.body).toMatchObject({ w: 300, h: 400 });

      const served = await admin.get(`/api/images/${res.body.id}`).expect(200);
      const meta = await sharp(served.body as Buffer).metadata();
      expect(meta.width).toBe(300);
      expect(meta.height).toBe(400);

      expect(meta.exif).toBeUndefined();
      expect(meta.orientation).toBeUndefined();
    });
  });

  it('downscales oversized images to the 2048px cap', async () => {
    await usingApp(async ({ app }) => {
      const admin = await bootstrapAdmin(app);
      const big = await sharp({
        create: { width: 4000, height: 1000, channels: 3, background: { r: 1, g: 2, b: 3 } },
      })
        .jpeg()
        .toBuffer();
      const res = await admin.post('/api/images').attach('file', big, 'wide.jpg').expect(201);
      expect(res.body.w).toBe(2048);
      expect(res.body.h).toBe(512);
    });
  });

  it('rejects non-image payloads and renamed fakes with 415', async () => {
    await usingApp(async ({ app }) => {
      const admin = await bootstrapAdmin(app);
      await admin
        .post('/api/images')
        .attach('file', Buffer.from('#!/bin/sh\necho pwned'), 'totally-a.png')
        .expect(415);

      const fake = Buffer.concat([
        Buffer.from([0xff, 0xd8, 0xff]),
        Buffer.from('not really a jpeg at all'),
      ]);
      await admin.post('/api/images').attach('file', fake, 'fake.jpg').expect(415);
      await admin.post('/api/images').expect(400);
    });
  });

  it('rejects oversize uploads with 413', async () => {
    await usingApp(async ({ app }) => {
      const admin = await bootstrapAdmin(app);
      const huge = Buffer.alloc(10 * 1024 * 1024 + 1, 0xab);
      await admin.post('/api/images').attach('file', huge, 'huge.png').expect(413);
    });
  });

  it('enforces the role matrix: viewer reads only, member uploads, admin runs gc', async () => {
    await usingApp(async ({ app }) => {
      const admin = await bootstrapAdmin(app);
      const member = await authedAgent(app, 'member', { admin });
      const viewer = await authedAgent(app, 'viewer', { admin });

      const up = await member
        .post('/api/images')
        .attach('file', await pngFixture(), 'p.png')
        .expect(201);

      await viewer.get(`/api/images/${up.body.id}`).expect(200);
      await viewer
        .post('/api/images')
        .attach('file', await pngFixture(), 'p.png')
        .expect(403);
      await viewer.delete(`/api/images/${up.body.id}`).expect(403);
      await member.post('/api/images/gc').expect(403);
      await admin.post('/api/images/gc').expect(200);

      await request(app).get(`/api/images/${up.body.id}`).expect(401);
    });
  });

  it('validates ids against traversal', async () => {
    await usingApp(async ({ app }) => {
      const admin = await bootstrapAdmin(app);
      await admin.get('/api/images/..%2F..%2Fsecret').expect(400);
      await admin.get('/api/images/abc').expect(400);
      await admin.delete('/api/images/0123456789abcdeg').expect(400);
    });
  });
});

describe('orphan GC', () => {
  it('keeps image files referenced anywhere in the inventory shape', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'homelab-gc-test-'));
    const referenced = [
      'aaaaaaaaaaaaaaaa',
      'bbbbbbbbbbbbbbbb',
      'cccccccccccccccc',
      'eeeeeeeeeeeeeeee',
    ];
    const orphan = 'dddddddddddddddd';
    try {
      for (const id of [...referenced, orphan]) {
        await writeFile(path.join(dir, `${id}.webp`), 'image');
      }
      const store = {
        get: async () => ({
          value: {
            v: 10,
            data: {
              machines: [{ id: 'm1', images: [{ id: referenced[0], w: 1, h: 1 }] }],
              components: [
                {
                  id: 'c1',
                  icon: { kind: 'image', id: referenced[3], w: 1, h: 1 },
                  images: [{ id: referenced[1], w: 1, h: 1 }],
                },
              ],
              devices: [{ items: [{ images: [{ id: referenced[2], w: 1, h: 1 }] }] }],
            },
          },
          updatedAt: 0,
        }),
      } as unknown as Parameters<typeof sweepOrphanedImages>[1];

      expect(await sweepOrphanedImages(dir, store, { minAgeMs: 0, now: Date.now() + 10_000 })).toBe(
        1,
      );
      for (const id of referenced) {
        expect((await stat(path.join(dir, `${id}.webp`))).isFile()).toBe(true);
      }
      await expect(stat(path.join(dir, `${orphan}.webp`))).rejects.toBeTruthy();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reaps only old unreferenced files', async () => {
    await usingApp(async ({ app, imagesDir }) => {
      const admin = await bootstrapAdmin(app);

      const kept = await admin
        .post('/api/images')
        .attach('file', await pngFixture(), 'kept.png')
        .expect(201);
      await admin
        .put('/api/state/inventory')
        .send({ v: 10, data: { components: [{ id: 'c1', images: [{ id: kept.body.id }] }] } })
        .expect(200);

      const freshOrphan = await admin
        .post('/api/images')
        .attach('file', await pngFixture(), 'fresh.png')
        .expect(201);
      const oldOrphan = await admin
        .post('/api/images')
        .attach('file', await pngFixture(), 'old.png')
        .expect(201);
      const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000);
      for (const suffix of ['.webp', '.thumb.webp']) {
        const p = path.join(imagesDir, `${oldOrphan.body.id}${suffix}`);
        await utimes(p, oldTime, oldTime);
      }

      const res = await admin.post('/api/images/gc').expect(200);
      expect(res.body.removed).toBe(2);

      await admin.get(`/api/images/${kept.body.id}`).expect(200);
      await admin.get(`/api/images/${freshOrphan.body.id}`).expect(200);
      await admin.get(`/api/images/${oldOrphan.body.id}`).expect(404);
    });
  });

  it('ignores foreign files and missing directories', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'homelab-gc-test-'));
    await writeFile(path.join(dir, 'README.txt'), 'not an image');
    const store = {
      get: async () => null,
    } as unknown as Parameters<typeof sweepOrphanedImages>[1];
    expect(await sweepOrphanedImages(dir, store, { minAgeMs: 0 })).toBe(0);
    expect((await stat(path.join(dir, 'README.txt'))).isFile()).toBe(true);
    expect(await sweepOrphanedImages(path.join(dir, 'does-not-exist'), store)).toBe(0);
  });
});
