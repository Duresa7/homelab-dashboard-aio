# Inventory photo storage on local disk (issue #42)

Inventory items (Machines, Components, Devices — anything carrying
`ItemDetail`) can hold up to 6 photos. This records where the bytes live and
why the lifecycle works the way it does.

## Decisions

- **Refs in state, bytes on disk.** The inventory blob stores
  `images: [{ id, w, h }]` (schema v10); files live at
  `data/images/<id>.webp` + `<id>.thumb.webp` next to the SQLite state
  (`IMAGES_DIR` overrides). With a Postgres/MySQL state backend the image
  files **still live on the app host's disk** — refs travel with the DB,
  bytes don't. Backups must include `data/images/`. Putting blobs in the DB
  was rejected: the state store is a key→value JSON table shared across three
  dialects, and multi-megabyte values would wreck the debounced PUT path.
- **Everything is re-encoded.** Uploads (10MB cap, magic-byte + sharp-decode
  allowlist of JPEG/PNG/WebP) pass through sharp: `rotate()` applies EXIF
  orientation, the WebP re-encode (max 2048px, q82, plus a 256px thumb) drops
  EXIF/GPS and all other metadata. Stored ids are 16-hex random, so
  `/api/images/:id` is immutable and cacheable
  (`Cache-Control: private, immutable`) and the id regex doubles as the
  path-traversal guard.
- **Auth matrix:** view = any authenticated user, upload/delete = member+,
  GC = admin (rules live in the central matrix in
  `server/src/auth/middleware.ts`).
- **Orphan GC instead of transactions.** Inventory edits flow client →
  debounced `/api/state` PUT, so the server can't tie an upload to a ref
  atomically. The client deletes files best-effort when photos/items are
  removed; a sweep (boot + `POST /api/images/gc`) deletes files unreferenced
  by the inventory blob **and older than 24h** — the age guard prevents
  reaping a fresh upload whose inventory save hasn't flushed. The GC walks the
  persisted JSON structurally (any `images: [{id}]` array), so it tolerates
  future schema changes.
- **Per-item cap is client-enforced** (`MAX_IMAGES_PER_ITEM = 6`): the server
  never sees per-item context on upload, only per-request size. Acceptable for
  an authenticated member+ surface.

Status: implemented
