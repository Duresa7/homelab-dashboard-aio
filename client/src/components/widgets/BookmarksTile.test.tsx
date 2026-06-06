import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Bookmark } from '../../lib/bookmarks';
import { BookmarksTile } from './BookmarksTile';

const store = new Map<string, unknown>();
const listeners = new Map<string, Set<() => void>>();

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../lib/store', () => ({
  getState: vi.fn((key: string, fallback: unknown) => (store.has(key) ? store.get(key) : fallback)),
  setState: vi.fn((key: string, value: unknown) => {
    store.set(key, value);
    for (const listener of listeners.get(key) ?? []) listener();
  }),
  subscribe: vi.fn((key: string, fn: () => void) => {
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key)!.add(fn);
    return () => listeners.get(key)?.delete(fn);
  }),
}));

describe('BookmarksTile', () => {
  beforeEach(() => {
    store.clear();
    listeners.clear();
  });

  it('adds a bookmark and persists it to the bookmarks store key', async () => {
    const user = userEvent.setup();
    render(<BookmarksTile expandable={false} />);

    await user.click(screen.getByRole('button', { name: /edit bookmarks/i }));
    await user.click(screen.getByRole('button', { name: /add/i }));
    await user.type(screen.getByLabelText(/name/i), 'Plex');
    await user.type(screen.getByLabelText(/^url$/i), 'http://192.168.1.10:32400');
    await user.tab();
    expect(screen.getByLabelText(/icon url/i)).toHaveValue('http://192.168.1.10:32400/favicon.ico');
    await user.click(screen.getByRole('button', { name: /add bookmark/i }));

    const saved = store.get('bookmarks') as Bookmark[];
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      label: 'Plex',
      url: 'http://192.168.1.10:32400/',
      icon: 'http://192.168.1.10:32400/favicon.ico',
      groupId: 'default',
    });
    expect(screen.getByRole('link', { name: /plex/i })).toHaveAttribute(
      'href',
      'http://192.168.1.10:32400/',
    );
  });

  it('deletes a bookmark from edit mode', async () => {
    const user = userEvent.setup();
    store.set('bookmarks', [
      { id: 'plex', label: 'Plex', url: 'http://plex.local/', groupId: 'default' },
    ]);

    render(<BookmarksTile expandable={false} />);
    await user.click(screen.getByRole('button', { name: /edit bookmarks/i }));
    await user.click(screen.getByRole('button', { name: /delete plex/i }));

    expect(store.get('bookmarks')).toEqual([]);
    expect(screen.queryByRole('link', { name: /plex/i })).not.toBeInTheDocument();
  });

  it('suppresses native link dragging and navigation while editing bookmarks', async () => {
    const user = userEvent.setup();
    store.set('bookmarks', [
      { id: 'plex', label: 'Plex', url: 'http://plex.local/', groupId: 'default' },
    ]);

    render(<BookmarksTile expandable={false} />);
    const link = screen.getByRole('link', { name: /plex/i });

    expect(fireEvent.click(link)).toBe(true);

    await user.click(screen.getByRole('button', { name: /edit bookmarks/i }));

    expect(link).toHaveAttribute('draggable', 'false');
    expect(fireEvent.click(link)).toBe(false);
  });

  it('renders broken or empty icons with the first-letter fallback', () => {
    store.set('bookmarks', [
      { id: 'nas', label: 'NAS', url: 'http://nas.local/', groupId: 'default' },
    ]);

    render(<BookmarksTile expandable={false} />);

    const link = screen.getByRole('link', { name: /nas/i });
    expect(within(link).getByText('N')).toBeInTheDocument();
  });

  it('falls back from a missing dashboard-icons slug to the first letter', () => {
    store.set('bookmarks', [
      {
        id: 'missing',
        label: 'Missing',
        url: 'https://missing.example.com/',
        icon: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/missing.svg',
        groupId: 'default',
      },
    ]);

    render(<BookmarksTile expandable={false} />);

    const link = screen.getByRole('link', { name: /missing/i });
    const svg = link.querySelector('.bm-img');
    if (!svg) throw new Error('Expected dashboard icon image to render');
    expect(svg).toHaveAttribute(
      'src',
      'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/missing.svg',
    );

    fireEvent.error(svg);

    const png = link.querySelector('.bm-img');
    if (!png) throw new Error('Expected dashboard icon PNG fallback to render');
    expect(png).toHaveAttribute(
      'src',
      'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/missing.png',
    );

    fireEvent.error(png);

    expect(within(link).getByText('M')).toBeInTheDocument();
  });

  it('hides the default group heading while only one group exists', () => {
    store.set('bookmarkGroups', [{ id: 'default', label: 'Apps' }]);
    store.set('bookmarks', [
      { id: 'plex', label: 'Plex', url: 'http://plex.local/', groupId: 'default' },
    ]);

    render(<BookmarksTile expandable={false} />);

    expect(screen.getByRole('link', { name: /plex/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Apps' })).not.toBeInTheDocument();
  });

  it('moves a bookmark between groups from the edit dialog', async () => {
    const user = userEvent.setup();
    store.set('bookmarkGroups', [
      { id: 'default', label: 'Apps' },
      { id: 'media', label: 'Media' },
    ]);
    store.set('bookmarks', [
      { id: 'plex', label: 'Plex', url: 'http://plex.local/', groupId: 'default' },
    ]);

    render(<BookmarksTile expandable={false} />);
    expect(screen.getByRole('heading', { name: 'Apps' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Media' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /edit bookmarks/i }));
    await user.click(screen.getByRole('button', { name: /edit plex/i }));
    await user.selectOptions(screen.getByLabelText(/group/i), 'media');
    await user.click(screen.getByRole('button', { name: /save bookmark/i }));

    expect(store.get('bookmarks')).toMatchObject([{ id: 'plex', label: 'Plex', groupId: 'media' }]);
  });
});
