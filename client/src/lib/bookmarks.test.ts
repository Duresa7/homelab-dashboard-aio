import { describe, expect, it } from 'vitest';

import {
  DEFAULT_BOOKMARK_GROUP,
  sanitizeBookmarks,
  deleteBookmarkGroup,
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

  it('does not delete the last remaining group', () => {
    const groups = [{ id: 'default', label: 'Apps' }];
    const bookmarks = [
      { id: 'plex', label: 'Plex', url: 'http://plex.local/', groupId: 'default' },
    ];

    const result = deleteBookmarkGroup(groups, bookmarks, 'default');

    expect(result).toEqual({ groups, bookmarks, deleted: false });
  });
});

describe('bookmark URLs and icons', () => {
  it('accepts permissive homelab URLs and rejects clearly invalid input', () => {
    expect(validateBookmarkUrl('http://192.168.1.10:9000')).toBe('http://192.168.1.10:9000/');
    expect(validateBookmarkUrl('https://nas.local/path')).toBe('https://nas.local/path');
    expect(validateBookmarkUrl('nota url')).toBeNull();
    expect(validateBookmarkUrl('ftp://nas.local')).toBeNull();
  });

  it('suggests dashboard-icons for public hosts', () => {
    expect(suggestBookmarkIcon('https://grafana.example.com')).toBe(
      'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/example.svg',
    );
  });

  it('suggests favicon.ico for LAN hosts while preserving custom ports', () => {
    expect(suggestBookmarkIcon('http://192.168.1.10:9000/dashboard')).toBe(
      'http://192.168.1.10:9000/favicon.ico',
    );
    expect(suggestBookmarkIcon('https://nas.local:8443')).toBe(
      'https://nas.local:8443/favicon.ico',
    );
  });
});
