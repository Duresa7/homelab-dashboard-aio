import { describe, expect, it } from 'vitest';

import {
  DEFAULT_BOOKMARK_GROUP,
  sanitizeBookmarks,
  deleteBookmarkGroup,
  moveBookmark,
  moveGroup,
  suggestBookmarkIcon,
  validateBookmarkUrl,
} from './bookmarks';

describe('bookmark sanitizer', () => {
  it('moves orphaned bookmarks into the default group', () => {
    const bookmarks = sanitizeBookmarks(
      [
        { id: 'plex', label: 'Plex', url: 'http://plex.local:32400', groupId: 'missing' },
        { id: 'nas', label: 'NAS', url: 'http://nas.local', groupId: 'default' },
      ],
      [DEFAULT_BOOKMARK_GROUP],
    );

    expect(bookmarks.map((bookmark) => bookmark.groupId)).toEqual(['default', 'default']);
  });

  it('drops stored bookmarks with non-http URLs', () => {
    const bookmarks = sanitizeBookmarks(
      [
        { id: 'bad', label: 'Bad', url: 'javascript:alert(1)', groupId: 'default' },
        { id: 'nas', label: 'NAS', url: 'https://nas.local', groupId: 'default' },
      ],
      [DEFAULT_BOOKMARK_GROUP],
    );

    expect(bookmarks).toEqual([
      { id: 'nas', label: 'NAS', url: 'https://nas.local/', groupId: 'default' },
    ]);
  });
});

describe('bookmark groups', () => {
  it('deletes a group by reassigning its bookmarks to the default group', () => {
    const result = deleteBookmarkGroup(
      [
        { id: 'default', label: 'Apps' },
        { id: 'media', label: 'Media' },
      ],
      [
        { id: 'plex', label: 'Plex', url: 'http://plex.local/', groupId: 'media' },
        { id: 'nas', label: 'NAS', url: 'http://nas.local/', groupId: 'default' },
      ],
      'media',
    );

    expect(result.deleted).toBe(true);
    expect(result.groups).toEqual([{ id: 'default', label: 'Apps' }]);
    expect(result.bookmarks.map((bookmark) => [bookmark.id, bookmark.groupId])).toEqual([
      ['plex', 'default'],
      ['nas', 'default'],
    ]);
  });

  it('never deletes the default group, even when others exist', () => {
    const groups = [
      { id: 'default', label: 'Apps' },
      { id: 'media', label: 'Media' },
    ];
    const bookmarks = [
      { id: 'plex', label: 'Plex', url: 'http://plex.local/', groupId: 'default' },
    ];

    const result = deleteBookmarkGroup(groups, bookmarks, 'default');

    expect(result).toEqual({ groups, bookmarks, deleted: false });
  });

  it('does not delete the last remaining group', () => {
    const groups = [{ id: 'default', label: 'Apps' }];
    const bookmarks = [
      { id: 'plex', label: 'Plex', url: 'http://plex.local/', groupId: 'default' },
    ];

    const result = deleteBookmarkGroup(groups, bookmarks, 'default');

    expect(result).toEqual({ groups, bookmarks, deleted: false });
  });
});

describe('bookmark drag math', () => {
  const bookmarks = [
    { id: 'a', label: 'A', url: 'http://a.local/', groupId: 'default' },
    { id: 'b', label: 'B', url: 'http://b.local/', groupId: 'default' },
    { id: 'c', label: 'C', url: 'http://c.local/', groupId: 'media' },
  ];

  it('reorders bookmarks within a group', () => {
    expect(
      moveBookmark(bookmarks, 'b', { kind: 'bookmark', targetId: 'a', position: 'before' }),
    ).toEqual([
      { id: 'b', label: 'B', url: 'http://b.local/', groupId: 'default' },
      { id: 'a', label: 'A', url: 'http://a.local/', groupId: 'default' },
      { id: 'c', label: 'C', url: 'http://c.local/', groupId: 'media' },
    ]);
  });

  it('moves a bookmark across groups and assigns the target group', () => {
    expect(
      moveBookmark(bookmarks, 'a', { kind: 'bookmark', targetId: 'c', position: 'after' }),
    ).toEqual([
      { id: 'b', label: 'B', url: 'http://b.local/', groupId: 'default' },
      { id: 'c', label: 'C', url: 'http://c.local/', groupId: 'media' },
      { id: 'a', label: 'A', url: 'http://a.local/', groupId: 'media' },
    ]);
  });

  it('appends a bookmark into an empty group container', () => {
    expect(moveBookmark(bookmarks, 'a', { kind: 'group', groupId: 'empty' })).toEqual([
      { id: 'b', label: 'B', url: 'http://b.local/', groupId: 'default' },
      { id: 'c', label: 'C', url: 'http://c.local/', groupId: 'media' },
      { id: 'a', label: 'A', url: 'http://a.local/', groupId: 'empty' },
    ]);
  });

  it('reorders groups', () => {
    const groups = [
      { id: 'default', label: 'Apps' },
      { id: 'media', label: 'Media' },
      { id: 'infra', label: 'Infra' },
    ];

    expect(moveGroup(groups, 'infra', 'default')).toEqual([
      { id: 'infra', label: 'Infra' },
      { id: 'default', label: 'Apps' },
      { id: 'media', label: 'Media' },
    ]);
  });
});

describe('bookmark URLs and icons', () => {
  it('accepts permissive homelab URLs and rejects clearly invalid input', () => {
    expect(validateBookmarkUrl('http://198.51.100.10:9000')).toBe('http://198.51.100.10:9000/');
    expect(validateBookmarkUrl('https://nas.local/path')).toBe('https://nas.local/path');
    expect(validateBookmarkUrl('nota url')).toBeNull();
    expect(validateBookmarkUrl('ftp://nas.local')).toBeNull();
  });

  it('suggests dashboard-icons from the service subdomain for public hosts', () => {
    expect(suggestBookmarkIcon('https://grafana.example.com')).toBe(
      'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/grafana.svg',
    );
  });

  it('suggests dashboard-icons from the bare domain for public hosts without subdomains', () => {
    expect(suggestBookmarkIcon('https://example.com')).toBe(
      'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/example.svg',
    );
  });

  it('suggests favicon.ico for LAN hosts while preserving custom ports', () => {
    expect(suggestBookmarkIcon('http://198.51.100.10:9000/dashboard')).toBe(
      'http://198.51.100.10:9000/favicon.ico',
    );
    expect(suggestBookmarkIcon('https://nas.local:8443')).toBe(
      'https://nas.local:8443/favicon.ico',
    );
  });
});
