import { useState, useSyncExternalStore } from 'react';
import { Pencil, Plus, Settings2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import {
  BOOKMARKS_KEY,
  DEFAULT_BOOKMARK_GROUP,
  type Bookmark,
  newBookmarkId,
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
  onExpand?: () => void;
  expandable?: boolean;
}

interface BookmarkForm {
  id: string | null;
  label: string;
  url: string;
  icon: string;
}

const EMPTY_FORM: BookmarkForm = { id: null, label: '', url: '', icon: '' };
const EMPTY_BOOKMARKS: Bookmark[] = [];
let lastRawBookmarks: unknown = null;
let lastBookmarks: Bookmark[] = EMPTY_BOOKMARKS;

function readBookmarks(): Bookmark[] {
  const raw = getState<unknown>(BOOKMARKS_KEY, EMPTY_BOOKMARKS);
  if (raw === lastRawBookmarks) return lastBookmarks;
  lastRawBookmarks = raw;
  lastBookmarks = sanitizeBookmarks(raw, [DEFAULT_BOOKMARK_GROUP]);
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

export function BookmarksTile({ span = 12, onExpand, expandable }: Props) {
  const [bookmarks, setBookmarks] = useBookmarks();
  const [editing, setEditing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<BookmarkForm>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

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
      groupId: DEFAULT_BOOKMARK_GROUP.id,
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

  return (
    <>
      <Tile
        id="bookmarks"
        title="Apps"
        sub={bookmarks.length ? `${bookmarks.length} saved` : 'No saved apps'}
        span={span}
        onExpand={onExpand}
        expandable={expandable}
        action={
          <div className="flex items-center gap-1">
            {editing ? (
              <Button type="button" size="xs" variant="outline" onClick={openAdd}>
                <Plus className="size-3" /> Add
              </Button>
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
          <div className="bm-grid">
            {bookmarks.map((bookmark) => (
              <div key={bookmark.id} className="bm-item">
                <a
                  href={bookmark.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="bm-app"
                  title={bookmark.url}
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
            {error ? <div className="text-sm font-medium text-destructive">{error}</div> : null}
          </div>
          <DialogFooter>
            <Button type="button" onClick={saveBookmark}>
              {form.id ? 'Save bookmark' : 'Add bookmark'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
