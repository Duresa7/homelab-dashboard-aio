import { useState, useSyncExternalStore, type DragEvent } from 'react';
import { Pencil, Plus, Settings2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import {
  BOOKMARKS_KEY,
  BOOKMARK_GROUPS_KEY,
  DEFAULT_BOOKMARK_GROUP,
  type Bookmark,
  type BookmarkGroup,
  deleteBookmarkGroup,
  moveBookmark,
  moveGroup,
  newBookmarkId,
  sanitizeBookmarkGroups,
  sanitizeBookmarks,
  suggestBookmarkIcon,
  validateBookmarkUrl,
} from '../../lib/bookmarks';
import { getState, setState, subscribe as subscribeState } from '../../lib/store';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { Tile } from '../tile/Tile';

interface Props {
  span?: number;
}

interface BookmarkForm {
  id: string | null;
  label: string;
  url: string;
  icon: string;
  groupId: string;
}

const EMPTY_FORM: BookmarkForm = {
  id: null,
  label: '',
  url: '',
  icon: '',
  groupId: DEFAULT_BOOKMARK_GROUP.id,
};
const EMPTY_BOOKMARKS: Bookmark[] = [];
const DEFAULT_GROUPS: BookmarkGroup[] = [DEFAULT_BOOKMARK_GROUP];
let lastRawBookmarks: unknown = null;
let lastBookmarks: Bookmark[] = EMPTY_BOOKMARKS;
let activeGroups: BookmarkGroup[] = DEFAULT_GROUPS;
let lastRawGroups: unknown = null;
let lastGroups: BookmarkGroup[] = DEFAULT_GROUPS;

function readGroups(): BookmarkGroup[] {
  const raw = getState<unknown>(BOOKMARK_GROUPS_KEY, DEFAULT_GROUPS);
  if (raw === lastRawGroups) return lastGroups;
  lastRawGroups = raw;
  lastGroups = sanitizeBookmarkGroups(raw);
  activeGroups = lastGroups;
  return lastGroups;
}

function readBookmarks(): Bookmark[] {
  const raw = getState<unknown>(BOOKMARKS_KEY, EMPTY_BOOKMARKS);
  if (raw === lastRawBookmarks) return lastBookmarks;
  lastRawBookmarks = raw;
  lastBookmarks = sanitizeBookmarks(raw, activeGroups);
  return lastBookmarks;
}

function useBookmarks(): [Bookmark[], (bookmarks: Bookmark[]) => void] {
  const bookmarks = useSyncExternalStore(
    (fn) => subscribeState(BOOKMARKS_KEY, fn),
    readBookmarks,
    readBookmarks,
  );
  return [bookmarks, (next) => setState<Bookmark[]>(BOOKMARKS_KEY, next)];
}

function useBookmarkGroups(): [BookmarkGroup[], (groups: BookmarkGroup[]) => void] {
  const groups = useSyncExternalStore(
    (fn) => subscribeState(BOOKMARK_GROUPS_KEY, fn),
    readGroups,
    readGroups,
  );
  activeGroups = groups;
  return [groups, (next) => setState<BookmarkGroup[]>(BOOKMARK_GROUPS_KEY, next)];
}

function BookmarkIcon({ bookmark }: { bookmark: Bookmark }) {
  const [stage, setStage] = useState(0);
  const src = bookmark.icon ?? '';
  const isDashboardIconsSvg = src.includes('/dashboard-icons/svg/') && src.endsWith('.svg');

  let current = src;
  if (!src || stage >= 2 || (stage >= 1 && !isDashboardIconsSvg)) {
    return (
      <span className="bm-fallback" aria-hidden="true">
        {bookmark.label.charAt(0).toUpperCase()}
      </span>
    );
  }
  if (stage === 1 && isDashboardIconsSvg) {
    current = src
      .replace('/dashboard-icons/svg/', '/dashboard-icons/png/')
      .replace(/\.svg$/, '.png');
  }

  return (
    <img
      key={stage}
      className="bm-img"
      src={current}
      alt=""
      loading="lazy"
      draggable={false}
      onError={() => setStage((s) => s + 1)}
    />
  );
}

export function BookmarksTile({ span = 12 }: Props) {
  const [groups, setGroups] = useBookmarkGroups();
  const [bookmarks, setBookmarks] = useBookmarks();
  const [editing, setEditing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<BookmarkForm>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ type: 'bookmark' | 'group'; id: string } | null>(null);
  const [overBookmark, setOverBookmark] = useState<{
    id: string;
    position: 'before' | 'after';
  } | null>(null);
  const [overGroupId, setOverGroupId] = useState<string | null>(null);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [groupForm, setGroupForm] = useState<{ id: string | null; label: string }>({
    id: null,
    label: '',
  });
  const [groupError, setGroupError] = useState<string | null>(null);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setError(null);
  };

  const openAdd = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (bookmark: Bookmark) => {
    setForm({
      id: bookmark.id,
      label: bookmark.label,
      url: bookmark.url,
      icon: bookmark.icon ?? '',
      groupId: groups.some((group) => group.id === bookmark.groupId)
        ? bookmark.groupId
        : DEFAULT_BOOKMARK_GROUP.id,
    });
    setError(null);
    setDialogOpen(true);
  };

  const updateForm = (patch: Partial<BookmarkForm>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setError(null);
  };

  const suggestIconIfEmpty = () => {
    if (form.icon.trim()) return;
    const suggestion = suggestBookmarkIcon(form.url);
    if (suggestion) updateForm({ icon: suggestion });
  };

  const saveBookmark = () => {
    const label = form.label.trim();
    const url = validateBookmarkUrl(form.url);
    const icon = form.icon.trim();
    if (!label) {
      setError('Name is required.');
      return;
    }
    if (!url) {
      setError('Enter a valid http or https URL.');
      return;
    }

    const bookmark: Bookmark = {
      id: form.id ?? newBookmarkId(),
      label,
      url,
      ...(icon ? { icon } : {}),
      groupId: groups.some((group) => group.id === form.groupId)
        ? form.groupId
        : DEFAULT_BOOKMARK_GROUP.id,
    };
    setBookmarks(
      form.id
        ? bookmarks.map((item) => (item.id === form.id ? bookmark : item))
        : [...bookmarks, bookmark],
    );
    toast.success(form.id ? `Updated ${bookmark.label}` : `Added ${bookmark.label}`);
    setDialogOpen(false);
    resetForm();
  };

  const deleteBookmark = (id: string) => {
    const bookmark = bookmarks.find((item) => item.id === id);
    setBookmarks(bookmarks.filter((item) => item.id !== id));
    if (bookmark) toast.success(`Deleted ${bookmark.label}`);
  };

  const openAddGroup = () => {
    setGroupForm({ id: null, label: '' });
    setGroupError(null);
    setGroupDialogOpen(true);
  };

  const openRenameGroup = (group: BookmarkGroup) => {
    setGroupForm({ id: group.id, label: group.label });
    setGroupError(null);
    setGroupDialogOpen(true);
  };

  const saveGroup = () => {
    const label = groupForm.label.trim();
    if (!label) {
      setGroupError('Name is required.');
      return;
    }
    if (groupForm.id) {
      setGroups(groups.map((item) => (item.id === groupForm.id ? { ...item, label } : item)));
      toast.success(`Renamed ${label}`);
    } else {
      const id = `group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      setGroups([...groups, { id, label }]);
      toast.success(`Added ${label}`);
    }
    setGroupDialogOpen(false);
    setGroupForm({ id: null, label: '' });
    setGroupError(null);
  };

  const removeGroup = (group: BookmarkGroup) => {
    if (group.id === DEFAULT_BOOKMARK_GROUP.id) {
      toast.error('The default group cannot be deleted.');
      return;
    }
    const result = deleteBookmarkGroup(groups, bookmarks, group.id);
    if (!result.deleted) {
      toast.error('The last group cannot be deleted.');
      return;
    }
    setGroups(result.groups);
    setBookmarks(result.bookmarks);
    toast.success(`Deleted ${group.label}`);
  };

  const clearDrag = () => {
    setDragging(null);
    setOverBookmark(null);
    setOverGroupId(null);
  };

  const startBookmarkDrag = (event: DragEvent<HTMLElement>, bookmarkId: string) => {
    if (!editing) return;
    setDragging({ type: 'bookmark', id: bookmarkId });
    event.dataTransfer.effectAllowed = 'move';
    try {
      event.dataTransfer.setData('text/plain', bookmarkId);
    } catch {
      /* noop */
    }
  };

  const bookmarkDropPosition = (
    event: DragEvent<HTMLElement>,
    element: HTMLElement,
  ): 'before' | 'after' => {
    const rect = element.getBoundingClientRect();
    return event.clientY > rect.top + rect.height / 2 ? 'after' : 'before';
  };

  const overBookmarkTarget = (event: DragEvent<HTMLElement>, bookmarkId: string) => {
    if (!dragging || dragging.type !== 'bookmark' || dragging.id === bookmarkId) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    setOverGroupId(null);
    setOverBookmark({ id: bookmarkId, position: bookmarkDropPosition(event, event.currentTarget) });
  };

  const dropOnBookmark = (event: DragEvent<HTMLElement>, bookmarkId: string) => {
    if (!dragging || dragging.type !== 'bookmark') return;
    event.preventDefault();
    event.stopPropagation();
    const position = overBookmark?.id === bookmarkId ? overBookmark.position : 'before';
    setBookmarks(
      moveBookmark(bookmarks, dragging.id, { kind: 'bookmark', targetId: bookmarkId, position }),
    );
    clearDrag();
  };

  const overGroupTarget = (event: DragEvent<HTMLElement>, groupId: string) => {
    if (!dragging || dragging.type !== 'bookmark') return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setOverBookmark(null);
    setOverGroupId(groupId);
  };

  const dropOnGroup = (event: DragEvent<HTMLElement>, groupId: string) => {
    if (!dragging || dragging.type !== 'bookmark') return;
    event.preventDefault();
    setBookmarks(moveBookmark(bookmarks, dragging.id, { kind: 'group', groupId }));
    clearDrag();
  };

  const startGroupDrag = (event: DragEvent<HTMLElement>, groupId: string) => {
    if (!editing) return;
    setDragging({ type: 'group', id: groupId });
    event.dataTransfer.effectAllowed = 'move';
    try {
      event.dataTransfer.setData('text/plain', groupId);
    } catch {
      /* noop */
    }
  };

  const overGroupHeader = (event: DragEvent<HTMLElement>, groupId: string) => {
    if (!dragging || dragging.type !== 'group' || dragging.id === groupId) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    setOverGroupId(groupId);
  };

  const dropGroupHeader = (event: DragEvent<HTMLElement>, groupId: string) => {
    if (!dragging || dragging.type !== 'group') return;
    event.preventDefault();
    event.stopPropagation();
    setGroups(moveGroup(groups, dragging.id, groupId));
    clearDrag();
  };

  const showGroupHeadings = groups.length > 1;
  const grouped = groups.map((group) => ({
    group,
    bookmarks: bookmarks.filter((bookmark) => bookmark.groupId === group.id),
  }));

  return (
    <>
      <Tile
        id="bookmarks"
        title="Apps"
        sub={bookmarks.length ? `${bookmarks.length} saved` : 'No saved apps'}
        span={span}
        action={
          <div className="flex items-center gap-1">
            {editing ? (
              <>
                <Button type="button" size="xs" variant="outline" onClick={openAdd}>
                  <Plus className="size-3" /> Add
                </Button>
                <Button type="button" size="xs" variant="outline" onClick={openAddGroup}>
                  <Plus className="size-3" /> Group
                </Button>
              </>
            ) : null}
            <Button
              type="button"
              size="icon-xs"
              variant={editing ? 'secondary' : 'ghost'}
              aria-label={editing ? 'Exit bookmark edit mode' : 'Edit bookmarks'}
              title={editing ? 'Done' : 'Edit bookmarks'}
              onClick={() => setEditing((value) => !value)}
            >
              <Settings2 className="size-3" />
            </Button>
          </div>
        }
      >
        {bookmarks.length === 0 ? (
          <div className="flex min-h-28 items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-4 text-center text-sm text-muted-foreground">
            {editing ? 'Add your first bookmark.' : 'No bookmarks saved.'}
          </div>
        ) : (
          <div className="bm-groups" onDragEnd={clearDrag}>
            {grouped.map(({ group, bookmarks: groupBookmarks }) =>
              groupBookmarks.length || editing || showGroupHeadings ? (
                <section
                  key={group.id}
                  className={[
                    'bm-group',
                    overGroupId === group.id && dragging?.type === 'bookmark' ? 'is-over' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onDragOver={(event) => overGroupTarget(event, group.id)}
                  onDrop={(event) => dropOnGroup(event, group.id)}
                >
                  {showGroupHeadings ? (
                    <header
                      className={[
                        'bm-group-head',
                        overGroupId === group.id && dragging?.type === 'group' ? 'is-over' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      draggable={editing}
                      onDragStart={(event) => startGroupDrag(event, group.id)}
                      onDragOver={(event) => overGroupHeader(event, group.id)}
                      onDrop={(event) => dropGroupHeader(event, group.id)}
                    >
                      <h3>{group.label}</h3>
                      {editing ? (
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Rename ${group.label}`}
                            onClick={() => openRenameGroup(group)}
                          >
                            <Pencil className="size-3" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Delete ${group.label}`}
                            onClick={() => removeGroup(group)}
                            disabled={groups.length <= 1 || group.id === DEFAULT_BOOKMARK_GROUP.id}
                          >
                            <Trash2 className="size-3" />
                          </Button>
                        </div>
                      ) : null}
                    </header>
                  ) : null}
                  <div className="bm-grid">
                    {groupBookmarks.map((bookmark) => (
                      <div
                        key={bookmark.id}
                        className={[
                          'bm-item',
                          dragging?.type === 'bookmark' && dragging.id === bookmark.id
                            ? 'is-dragging'
                            : '',
                          overBookmark?.id === bookmark.id
                            ? `is-over-${overBookmark.position}`
                            : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        draggable={editing}
                        onDragStart={(event) => startBookmarkDrag(event, bookmark.id)}
                        onDragOver={(event) => overBookmarkTarget(event, bookmark.id)}
                        onDrop={(event) => dropOnBookmark(event, bookmark.id)}
                      >
                        <a
                          href={bookmark.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="bm-app"
                          title={bookmark.url}
                          draggable={editing ? false : undefined}
                          onClick={(event) => {
                            if (editing) event.preventDefault();
                          }}
                        >
                          <span className="bm-icon">
                            <BookmarkIcon bookmark={bookmark} />
                          </span>
                          <span className="bm-label">{bookmark.label}</span>
                        </a>
                        {editing ? (
                          <div className="bm-actions">
                            <Button
                              type="button"
                              variant="secondary"
                              size="icon-xs"
                              aria-label={`Edit ${bookmark.label}`}
                              onClick={() => openEdit(bookmark)}
                            >
                              <Pencil className="size-3" />
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              size="icon-xs"
                              aria-label={`Delete ${bookmark.label}`}
                              onClick={() => deleteBookmark(bookmark.id)}
                            >
                              <Trash2 className="size-3" />
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </section>
              ) : null,
            )}
          </div>
        )}
      </Tile>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form.id ? 'Edit bookmark' : 'Add bookmark'}</DialogTitle>
            <DialogDescription>Saved apps open in a new browser tab.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="bookmark-name">Name</Label>
              <Input
                id="bookmark-name"
                value={form.label}
                onChange={(event) => updateForm({ label: event.target.value })}
                placeholder="Plex"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="bookmark-url">URL</Label>
              <Input
                id="bookmark-url"
                value={form.url}
                onChange={(event) => updateForm({ url: event.target.value })}
                onBlur={suggestIconIfEmpty}
                placeholder="http://192.168.1.10:32400"
                aria-invalid={error?.includes('URL') ? true : undefined}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="bookmark-icon">Icon URL</Label>
              <Input
                id="bookmark-icon"
                value={form.icon}
                onChange={(event) => updateForm({ icon: event.target.value })}
                placeholder="https://.../icon.svg"
              />
            </div>
            {groups.length > 1 ? (
              <div className="grid gap-2">
                <Label htmlFor="bookmark-group">Group</Label>
                <select
                  id="bookmark-group"
                  value={form.groupId}
                  onChange={(event) => updateForm({ groupId: event.target.value })}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {error ? <div className="text-sm font-medium text-destructive">{error}</div> : null}
          </div>
          <DialogFooter>
            <Button type="button" onClick={saveBookmark}>
              {form.id ? 'Save bookmark' : 'Add bookmark'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={groupDialogOpen}
        onOpenChange={(open) => {
          setGroupDialogOpen(open);
          if (!open) {
            setGroupForm({ id: null, label: '' });
            setGroupError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{groupForm.id ? 'Rename group' : 'Add group'}</DialogTitle>
            <DialogDescription>Groups organize your saved apps into sections.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="group-name">Name</Label>
            <Input
              id="group-name"
              value={groupForm.label}
              autoFocus
              onChange={(event) => {
                setGroupForm((prev) => ({ ...prev, label: event.target.value }));
                setGroupError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') saveGroup();
              }}
              placeholder="Media"
              aria-invalid={groupError ? true : undefined}
            />
            {groupError ? (
              <div className="text-sm font-medium text-destructive">{groupError}</div>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" onClick={saveGroup}>
              {groupForm.id ? 'Save group' : 'Add group'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
