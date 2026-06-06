export const BOOKMARKS_KEY = 'bookmarks';
export const BOOKMARK_GROUPS_KEY = 'bookmarkGroups';
export const DEFAULT_GROUP_ID = 'default';

export interface Bookmark {
  id: string;
  label: string;
  url: string;
  icon?: string;
  groupId: string;
}

export interface BookmarkGroup {
  id: string;
  label: string;
}

export const DEFAULT_BOOKMARK_GROUP: BookmarkGroup = { id: DEFAULT_GROUP_ID, label: 'Apps' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isBookmark(value: unknown): value is Bookmark {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' && typeof value.label === 'string' && typeof value.url === 'string'
  );
}

export function isBookmarkGroup(value: unknown): value is BookmarkGroup {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string' && typeof value.label === 'string';
}

export function sanitizeBookmarkGroups(value: unknown): BookmarkGroup[] {
  if (!Array.isArray(value)) return [DEFAULT_BOOKMARK_GROUP];
  const groups = value.filter(isBookmarkGroup).map((group) => ({
    id: group.id.trim() || DEFAULT_GROUP_ID,
    label: group.label.trim() || 'Group',
  }));
  if (groups.length === 0) return [DEFAULT_BOOKMARK_GROUP];
  if (!groups.some((group) => group.id === DEFAULT_GROUP_ID)) {
    return [DEFAULT_BOOKMARK_GROUP, ...groups];
  }
  return groups;
}

export function sanitizeBookmarks(
  value: unknown,
  groups: BookmarkGroup[] = [DEFAULT_BOOKMARK_GROUP],
): Bookmark[] {
  if (!Array.isArray(value)) return [];
  const groupIds = new Set(groups.map((group) => group.id));
  return value.filter(isBookmark).map((bookmark) => {
    const groupId = groupIds.has(bookmark.groupId) ? bookmark.groupId : DEFAULT_GROUP_ID;
    return {
      id: bookmark.id,
      label: bookmark.label,
      url: bookmark.url,
      ...(typeof bookmark.icon === 'string' && bookmark.icon.trim()
        ? { icon: bookmark.icon.trim() }
        : {}),
      groupId,
    };
  });
}

export function deleteBookmarkGroup(
  groups: BookmarkGroup[],
  bookmarks: Bookmark[],
  groupId: string,
): { groups: BookmarkGroup[]; bookmarks: Bookmark[]; deleted: boolean } {
  if (groups.length <= 1) return { groups, bookmarks, deleted: false };
  const exists = groups.some((group) => group.id === groupId);
  if (!exists) return { groups, bookmarks, deleted: false };

  const nextGroups = groups.filter((group) => group.id !== groupId);
  const fallbackGroupId =
    groupId === DEFAULT_GROUP_ID
      ? (nextGroups[0]?.id ?? DEFAULT_GROUP_ID)
      : nextGroups.some((group) => group.id === DEFAULT_GROUP_ID)
        ? DEFAULT_GROUP_ID
        : nextGroups[0].id;
  return {
    groups: nextGroups,
    bookmarks: bookmarks.map((bookmark) =>
      bookmark.groupId === groupId ? { ...bookmark, groupId: fallbackGroupId } : bookmark,
    ),
    deleted: true,
  };
}

export type BookmarkMoveTarget =
  | { kind: 'bookmark'; targetId: string; position: 'before' | 'after' }
  | { kind: 'group'; groupId: string };

export function moveBookmark(
  bookmarks: Bookmark[],
  bookmarkId: string,
  target: BookmarkMoveTarget,
): Bookmark[] {
  const moving = bookmarks.find((bookmark) => bookmark.id === bookmarkId);
  if (!moving) return bookmarks;

  const remaining = bookmarks.filter((bookmark) => bookmark.id !== bookmarkId);
  if (target.kind === 'group') {
    return [...remaining, { ...moving, groupId: target.groupId }];
  }

  const targetIndex = remaining.findIndex((bookmark) => bookmark.id === target.targetId);
  if (targetIndex < 0) return bookmarks;
  const targetBookmark = remaining[targetIndex];
  const insertAt = target.position === 'after' ? targetIndex + 1 : targetIndex;
  const next = [...remaining];
  next.splice(insertAt, 0, { ...moving, groupId: targetBookmark.groupId });
  return next;
}

export function moveGroup(
  groups: BookmarkGroup[],
  groupId: string,
  targetId: string,
  position: 'before' | 'after' = 'before',
): BookmarkGroup[] {
  if (groupId === targetId) return groups;
  const moving = groups.find((group) => group.id === groupId);
  if (!moving) return groups;
  const remaining = groups.filter((group) => group.id !== groupId);
  const targetIndex = remaining.findIndex((group) => group.id === targetId);
  if (targetIndex < 0) return groups;
  const insertAt = position === 'after' ? targetIndex + 1 : targetIndex;
  const next = [...remaining];
  next.splice(insertAt, 0, moving);
  return next;
}

export function validateBookmarkUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function isIpv4(hostname: string): boolean {
  const parts = hostname.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d+$/.test(part)) return false;
    const n = Number(part);
    return n >= 0 && n <= 255;
  });
}

function isLanHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    isIpv4(host) ||
    !host.includes('.') ||
    host.endsWith('.local') ||
    host.endsWith('.lan') ||
    host.endsWith('.home') ||
    host.endsWith('.internal')
  );
}

function slugHost(hostname: string): string {
  const labels = hostname.toLowerCase().split('.').filter(Boolean);
  const base = labels.length > 1 ? labels[labels.length - 2] : labels[0];
  return base.replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '') || 'app';
}

export function suggestBookmarkIcon(rawUrl: string): string {
  const normalized = validateBookmarkUrl(rawUrl);
  if (!normalized) return '';
  const url = new URL(normalized);
  if (isLanHost(url.hostname)) {
    return `${url.protocol}//${url.host}/favicon.ico`;
  }
  return `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/${slugHost(url.hostname)}.svg`;
}

export function newBookmarkId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `bookmark-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
