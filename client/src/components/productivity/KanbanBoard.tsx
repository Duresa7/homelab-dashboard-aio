import {
  closestCorners,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties } from 'react';
import {
  CalendarDays,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Plus,
  SquareKanban,
  Tags,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { SectionCard, StatusBadge } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { canEdit, useAuth } from '@/lib/auth';
import {
  COLOR_PALETTE,
  KANBAN_BOARDS_KEY,
  createBoardSummary,
  createCard,
  createColumn,
  createDefaultBoard,
  createLabel,
  deleteCard,
  deleteColumn,
  deleteLabel,
  dueTone,
  kanbanBoardKey,
  moveCardToPosition,
  normalizeBoardOrders,
  removeBoardSummary,
  reorderColumns,
  sanitizeBoard,
  sanitizeBoardIndex,
  updateCard,
  updateColumn,
  updateLabel,
  upsertBoardSummary,
  type KanbanBoard,
  type KanbanBoardIndex,
  type KanbanBoardSummary,
  type KanbanCard,
  type KanbanColumn,
  type KanbanLabel,
  type KanbanPriority,
} from '@/lib/kanban';
import { deleteState, getState, setState, subscribe as subscribeState } from '@/lib/store';
import { cn } from '@/lib/utils';

const EMPTY_INDEX: KanbanBoardIndex = { boards: [] };
const EMPTY_BOARD: KanbanBoard = { columns: [], cards: [], labels: [] };

let lastRawIndex: unknown = null;
let lastIndex = EMPTY_INDEX;
const boardCache = new Map<string, { raw: unknown; board: KanbanBoard }>();

type BoardDialogState = { mode: 'create' } | { mode: 'rename'; board: KanbanBoardSummary } | null;
type ColumnDialogState =
  { mode: 'create' } | { mode: 'edit'; column: KanbanColumn; focus: 'name' | 'color' } | null;
type CardDialogState = { mode: 'create'; columnId: string } | { mode: 'edit'; cardId: string };

interface CardFormState {
  title: string;
  description: string;
  columnId: string;
  dueDate: string;
  priority: KanbanPriority;
  labelIds: string[];
}

interface LabelDraft {
  id: string | null;
  name: string;
  color: string;
}

function readIndex(): KanbanBoardIndex {
  const raw = getState<unknown>(KANBAN_BOARDS_KEY, EMPTY_INDEX);
  if (raw === lastRawIndex) return lastIndex;
  lastRawIndex = raw;
  lastIndex = sanitizeBoardIndex(raw);
  return lastIndex;
}

function readBoard(boardId: string): KanbanBoard {
  const raw = getState<unknown>(kanbanBoardKey(boardId), EMPTY_BOARD);
  const cached = boardCache.get(boardId);
  if (cached && cached.raw === raw) return cached.board;
  const board = sanitizeBoard(raw);
  boardCache.set(boardId, { raw, board });
  return board;
}

function useBoardIndex(): [KanbanBoardIndex, (next: KanbanBoardIndex) => void] {
  const index = useSyncExternalStore(
    (fn) => subscribeState(KANBAN_BOARDS_KEY, fn),
    readIndex,
    readIndex,
  );
  return [index, (next) => setState<KanbanBoardIndex>(KANBAN_BOARDS_KEY, sanitizeBoardIndex(next))];
}

function useBoardState(boardId: string | null): [KanbanBoard, (next: KanbanBoard) => void] {
  const board = useSyncExternalStore(
    (fn) => (boardId ? subscribeState(kanbanBoardKey(boardId), fn) : () => undefined),
    () => (boardId ? readBoard(boardId) : EMPTY_BOARD),
    () => EMPTY_BOARD,
  );
  return [
    board,
    (next) => {
      if (!boardId) return;
      setState<KanbanBoard>(kanbanBoardKey(boardId), normalizeBoardOrders(next));
    },
  ];
}

function nextOrder(items: { order: number }[]): number {
  return items.length === 0 ? 1000 : Math.max(...items.map((item) => item.order)) + 1000;
}

function priorityLabel(priority: KanbanPriority): string {
  if (priority === 'high') return 'High';
  if (priority === 'low') return 'Low';
  return 'Medium';
}

function priorityClass(priority: KanbanPriority): string {
  if (priority === 'high') return 'bg-bad';
  if (priority === 'low') return 'bg-info';
  return 'bg-warn';
}

function dueClass(date: string | undefined): string {
  const tone = dueTone(date);
  if (tone === 'overdue') {
    return 'border-bad/30 bg-bad/10 text-bad';
  }
  if (tone === 'soon') {
    return 'border-warn/30 bg-warn/10 text-warn';
  }
  return 'border-border bg-muted/40 text-muted-foreground';
}

function dueLabel(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  }
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function labelById(labels: KanbanLabel[]): Map<string, KanbanLabel> {
  return new Map(labels.map((label) => [label.id, label]));
}

function cardCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'card' : 'cards'}`;
}

export function KanbanBoardSection() {
  const editor = canEdit(useAuth().user);
  const [index, setIndex] = useBoardIndex();
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null);
  const [boardDialog, setBoardDialog] = useState<BoardDialogState>(null);
  const [deleteBoardTarget, setDeleteBoardTarget] = useState<KanbanBoardSummary | null>(null);
  const [columnDialog, setColumnDialog] = useState<ColumnDialogState>(null);
  const [deleteColumnTarget, setDeleteColumnTarget] = useState<KanbanColumn | null>(null);
  const [cardDialog, setCardDialog] = useState<CardDialogState | null>(null);
  const [board, setBoard] = useBoardState(selectedBoardId);
  const selectedBoard = index.boards.find((item) => item.id === selectedBoardId) ?? null;

  useEffect(() => {
    setSelectedBoardId((current) => {
      if (index.boards.length === 0) return null;
      return current && index.boards.some((board) => board.id === current)
        ? current
        : index.boards[0].id;
    });
  }, [index.boards]);

  const createBoard = (name: string) => {
    const summary = createBoardSummary(name, nextOrder(index.boards));
    setIndex(upsertBoardSummary(index, summary));
    setState<KanbanBoard>(kanbanBoardKey(summary.id), createDefaultBoard());
    setSelectedBoardId(summary.id);
    toast.success(`Created ${summary.name}`);
  };

  const renameBoard = (summary: KanbanBoardSummary, name: string) => {
    const next = { ...summary, name: name.trim() || summary.name };
    setIndex(upsertBoardSummary(index, next));
    toast.success(`Renamed ${next.name}`);
  };

  const confirmDeleteBoard = () => {
    if (!deleteBoardTarget) return;
    const target = deleteBoardTarget;
    setIndex(removeBoardSummary(index, target.id));
    deleteState(kanbanBoardKey(target.id));
    setDeleteBoardTarget(null);
    toast.success(`Deleted ${target.name}`);
  };

  const updateBoard = (mutate: (current: KanbanBoard) => KanbanBoard) => {
    if (!selectedBoardId) return;
    setBoard(mutate(board));
  };

  const saveColumn = (name: string, color: string) => {
    if (!columnDialog) return;
    if (columnDialog.mode === 'create') {
      updateBoard((current) => createColumn(current, name, color));
      toast.success(`Added ${name.trim() || 'column'}`);
    } else {
      updateBoard((current) => updateColumn(current, columnDialog.column.id, { name, color }));
      toast.success(`Updated ${name.trim() || columnDialog.column.name}`);
    }
    setColumnDialog(null);
  };

  const requestDeleteColumn = (column: KanbanColumn) => {
    const cards = board.cards.filter((card) => card.columnId === column.id);
    if (cards.length === 0) {
      updateBoard((current) => deleteColumn(current, column.id));
      toast.success(`Deleted ${column.name}`);
      return;
    }
    setDeleteColumnTarget(column);
  };

  const confirmDeleteColumn = () => {
    if (!deleteColumnTarget) return;
    const column = deleteColumnTarget;
    updateBoard((current) => deleteColumn(current, column.id));
    setDeleteColumnTarget(null);
    toast.success(`Deleted ${column.name}`);
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (event: DragEndEvent) => {
    if (!editor || !event.over) return;
    const activeType = event.active.data.current?.type;
    const overType = event.over.data.current?.type;
    const activeId = String(event.active.id);
    const overId = String(event.over.id);

    if (activeType === 'column' && overType === 'column') {
      updateBoard((current) => reorderColumns(current, activeId, overId));
      return;
    }

    if (activeType !== 'card') return;
    const targetColumnId =
      overType === 'column'
        ? overId
        : typeof event.over.data.current?.columnId === 'string'
          ? event.over.data.current.columnId
          : null;
    if (!targetColumnId) return;
    updateBoard((current) =>
      moveCardToPosition(
        current,
        activeId,
        targetColumnId,
        overType === 'card' ? overId : undefined,
      ),
    );
  };

  const boardCardCount = board.cards.length;

  return (
    <>
      <SectionCard
        span={12}
        title="Kanban"
        sub={
          selectedBoard
            ? `${board.columns.length} ${board.columns.length === 1 ? 'column' : 'columns'}`
            : 'No boards yet'
        }
        icon={<SquareKanban size={14} strokeWidth={1.75} />}
        actions={
          editor ? (
            <Button type="button" size="sm" onClick={() => setBoardDialog({ mode: 'create' })}>
              <Plus className="size-4" />
              New board
            </Button>
          ) : (
            <StatusBadge kind="idle">read only</StatusBadge>
          )
        }
        bodyClassName="p-0"
      >
        {index.boards.length === 0 ? (
          <EmptyBoards editor={editor} onCreate={() => setBoardDialog({ mode: 'create' })} />
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-[var(--pad)] py-3">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <Select
                  value={selectedBoardId ?? undefined}
                  onValueChange={(value) => setSelectedBoardId(value)}
                >
                  <SelectTrigger className="w-full min-w-[220px] sm:w-[280px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {index.boards.map((summary) => (
                      <SelectItem key={summary.id} value={summary.id}>
                        {summary.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedBoard ? (
                  <Badge variant="outline" className="text-muted-foreground">
                    {cardCountLabel(boardCardCount)}
                  </Badge>
                ) : null}
              </div>
              {editor && selectedBoard ? (
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setBoardDialog({ mode: 'rename', board: selectedBoard })}
                  >
                    <Pencil className="size-4" />
                    Rename
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setDeleteBoardTarget(selectedBoard)}
                  >
                    <Trash2 className="size-4" />
                    Delete
                  </Button>
                </div>
              ) : null}
            </div>

            {selectedBoard ? (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCorners}
                onDragEnd={onDragEnd}
              >
                <div className="min-h-[560px] overflow-x-auto">
                  <div className="flex min-w-max items-start gap-3 px-[var(--pad)] py-[var(--pad)]">
                    <SortableContext
                      items={board.columns.map((column) => column.id)}
                      strategy={horizontalListSortingStrategy}
                    >
                      {board.columns.map((column) => (
                        <KanbanColumnView
                          key={column.id}
                          board={board}
                          column={column}
                          editor={editor}
                          onEdit={(focus) => setColumnDialog({ mode: 'edit', column, focus })}
                          onDelete={() => requestDeleteColumn(column)}
                          onAddCard={() => setCardDialog({ mode: 'create', columnId: column.id })}
                          onOpenCard={(cardId) => setCardDialog({ mode: 'edit', cardId })}
                        />
                      ))}
                    </SortableContext>
                    {editor ? (
                      <button
                        type="button"
                        className="flex h-28 w-72 shrink-0 items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/20 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-foreground"
                        onClick={() => setColumnDialog({ mode: 'create' })}
                      >
                        <Plus className="size-4" />
                        Add column
                      </button>
                    ) : null}
                    {board.columns.length === 0 ? (
                      <div className="flex h-28 w-72 shrink-0 items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-4 text-center text-sm text-muted-foreground">
                        {editor ? 'Add a column to start.' : 'No columns.'}
                      </div>
                    ) : null}
                  </div>
                </div>
              </DndContext>
            ) : null}
          </>
        )}
      </SectionCard>

      <BoardDialog
        state={boardDialog}
        onOpenChange={(open) => !open && setBoardDialog(null)}
        onSave={(name) => {
          if (!boardDialog) return;
          if (boardDialog.mode === 'create') createBoard(name);
          else renameBoard(boardDialog.board, name);
          setBoardDialog(null);
        }}
      />

      <ColumnDialog state={columnDialog} onOpenChange={setColumnDialog} onSave={saveColumn} />

      <CardDialog
        state={cardDialog}
        board={board}
        editor={editor}
        onOpenChange={(open) => !open && setCardDialog(null)}
        onChangeBoard={setBoard}
      />

      <ConfirmDialog
        open={deleteBoardTarget != null}
        title="Delete board"
        description={
          boardCardCount > 0
            ? `Delete "${deleteBoardTarget?.name}" and its ${cardCountLabel(boardCardCount)}?`
            : `Delete "${deleteBoardTarget?.name}"?`
        }
        confirmLabel="Delete board"
        onConfirm={confirmDeleteBoard}
        onOpenChange={(open) => !open && setDeleteBoardTarget(null)}
      />

      <ConfirmDialog
        open={deleteColumnTarget != null}
        title="Delete column"
        description={
          deleteColumnTarget
            ? `Delete "${deleteColumnTarget.name}" and its ${cardCountLabel(
                board.cards.filter((card) => card.columnId === deleteColumnTarget.id).length,
              )}?`
            : ''
        }
        confirmLabel="Delete column"
        onConfirm={confirmDeleteColumn}
        onOpenChange={(open) => !open && setDeleteColumnTarget(null)}
      />
    </>
  );
}

function EmptyBoards({ editor, onCreate }: { editor: boolean; onCreate: () => void }) {
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="grid size-12 place-items-center rounded-lg border border-border bg-muted/30">
        <SquareKanban className="size-5 text-muted-foreground" />
      </div>
      <div className="text-sm font-semibold text-foreground">No boards yet</div>
      <div className="max-w-sm text-sm text-muted-foreground">
        {editor
          ? 'Create your first board to start tracking work.'
          : 'No shared boards have been created yet.'}
      </div>
      {editor ? (
        <Button type="button" onClick={onCreate}>
          <Plus className="size-4" />
          New board
        </Button>
      ) : null}
    </div>
  );
}

function KanbanColumnView({
  board,
  column,
  editor,
  onEdit,
  onDelete,
  onAddCard,
  onOpenCard,
}: {
  board: KanbanBoard;
  column: KanbanColumn;
  editor: boolean;
  onEdit: (focus: 'name' | 'color') => void;
  onDelete: () => void;
  onAddCard: () => void;
  onOpenCard: (cardId: string) => void;
}) {
  const cards = useMemo(
    () =>
      board.cards.filter((card) => card.columnId === column.id).sort((a, b) => a.order - b.order),
    [board.cards, column.id],
  );
  const sortable = useSortable({
    id: column.id,
    disabled: !editor,
    data: { type: 'column' },
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };

  return (
    <section
      ref={sortable.setNodeRef}
      style={style}
      className={cn(
        'flex max-h-[70vh] w-72 shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-muted/30 shadow-xs',
        sortable.isDragging && 'opacity-60',
      )}
    >
      <div className="h-1 shrink-0" style={{ backgroundColor: column.color ?? COLOR_PALETTE[0] }} />
      <header className="flex items-start gap-2 border-b border-border bg-card px-3 py-2.5">
        {editor ? (
          <button
            type="button"
            className="mt-0.5 rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={`Reorder ${column.name}`}
            {...sortable.attributes}
            {...sortable.listeners}
          >
            <GripVertical className="size-4" />
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground">{column.name}</div>
          <div className="text-xs text-muted-foreground">{cardCountLabel(cards.length)}</div>
        </div>
        {editor ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`${column.name} menu`}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onEdit('name')}>
                <Pencil className="size-4" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onEdit('color')}>
                <Tags className="size-4" />
                Recolor
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                <Trash2 className="size-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </header>

      <SortableContext items={cards.map((card) => card.id)} strategy={verticalListSortingStrategy}>
        <div className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto p-2">
          {cards.map((card) => (
            <KanbanCardView
              key={card.id}
              card={card}
              labels={board.labels}
              editor={editor}
              onOpen={() => onOpenCard(card.id)}
            />
          ))}
          {cards.length === 0 ? (
            <div className="flex min-h-20 items-center justify-center rounded-md border border-dashed border-border bg-card/50 px-3 text-center text-xs text-muted-foreground">
              No cards
            </div>
          ) : null}
        </div>
      </SortableContext>

      {editor ? (
        <button
          type="button"
          className="flex items-center justify-center gap-2 border-t border-border bg-card px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={onAddCard}
        >
          <Plus className="size-4" />
          Add card
        </button>
      ) : null}
    </section>
  );
}

function KanbanCardView({
  card,
  labels,
  editor,
  onOpen,
}: {
  card: KanbanCard;
  labels: KanbanLabel[];
  editor: boolean;
  onOpen: () => void;
}) {
  const labelsById = useMemo(() => labelById(labels), [labels]);
  const cardLabels = card.labelIds.flatMap((id) => {
    const label = labelsById.get(id);
    return label ? [label] : [];
  });
  const sortable = useSortable({
    id: card.id,
    disabled: !editor,
    data: { type: 'card', columnId: card.columnId },
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };

  return (
    <article
      ref={sortable.setNodeRef}
      style={style}
      className={cn(
        'rounded-md border border-border bg-card shadow-xs transition-shadow hover:shadow-card',
        sortable.isDragging && 'opacity-60',
      )}
    >
      <div className="flex gap-2 p-3">
        <button type="button" className="min-w-0 flex-1 text-left" onClick={onOpen}>
          <div className="line-clamp-2 text-sm font-semibold text-foreground">{card.title}</div>
          {cardLabels.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {cardLabels.map((label) => (
                <span
                  key={label.id}
                  className="max-w-full truncate rounded-full border px-2 py-0.5 text-[11px] font-medium"
                  style={{ borderColor: label.color, color: label.color }}
                >
                  {label.name}
                </span>
              ))}
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <span className={cn('size-1.5 rounded-full', priorityClass(card.priority))} />
              {priorityLabel(card.priority)}
            </span>
            {card.dueDate ? (
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium',
                  dueClass(card.dueDate),
                )}
              >
                <CalendarDays className="size-3" />
                {dueLabel(card.dueDate)}
              </span>
            ) : null}
          </div>
        </button>
        {editor ? (
          <button
            type="button"
            className="h-7 rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={`Move ${card.title}`}
            onClick={(event) => event.stopPropagation()}
            {...sortable.attributes}
            {...sortable.listeners}
          >
            <GripVertical className="size-4" />
          </button>
        ) : null}
      </div>
    </article>
  );
}

function BoardDialog({
  state,
  onOpenChange,
  onSave,
}: {
  state: BoardDialogState;
  onOpenChange: (open: boolean) => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(state?.mode === 'rename' ? state.board.name : '');
    setError(null);
  }, [state]);

  const save = () => {
    if (!name.trim()) {
      setError('Board name is required.');
      return;
    }
    onSave(name);
  };

  return (
    <Dialog open={state != null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{state?.mode === 'rename' ? 'Rename board' : 'New board'}</DialogTitle>
          <DialogDescription>
            {state?.mode === 'rename'
              ? 'Rename this board.'
              : 'Create a shared board everyone can see.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="kanban-board-name">Name</Label>
          <Input
            id="kanban-board-name"
            value={name}
            autoFocus
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') save();
            }}
            placeholder="Homelab projects"
            aria-invalid={error ? true : undefined}
          />
          {error ? <div className="text-sm font-medium text-destructive">{error}</div> : null}
        </div>
        <DialogFooter showCloseButton>
          <Button type="button" onClick={save}>
            {state?.mode === 'rename' ? 'Save board' : 'Create board'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ColumnDialog({
  state,
  onOpenChange,
  onSave,
}: {
  state: ColumnDialogState;
  onOpenChange: (state: ColumnDialogState) => void;
  onSave: (name: string, color: string) => void;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(COLOR_PALETTE[0]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(state?.mode === 'edit' ? state.column.name : '');
    setColor(state?.mode === 'edit' ? (state.column.color ?? COLOR_PALETTE[0]) : COLOR_PALETTE[0]);
    setError(null);
  }, [state]);

  const save = () => {
    if (!name.trim()) {
      setError('Column name is required.');
      return;
    }
    onSave(name, color);
  };

  return (
    <Dialog open={state != null} onOpenChange={(open) => !open && onOpenChange(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{state?.mode === 'edit' ? 'Edit column' : 'Add column'}</DialogTitle>
          <DialogDescription>
            {state?.mode === 'edit'
              ? 'Rename or recolor this column.'
              : 'Add a column to this board.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="kanban-column-name">Name</Label>
            <Input
              id="kanban-column-name"
              value={name}
              autoFocus={state?.mode !== 'edit' || state.focus === 'name'}
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') save();
              }}
              placeholder="Review"
              aria-invalid={error ? true : undefined}
            />
          </div>
          <ColorSwatches
            value={color}
            onChange={setColor}
            autoFocus={state?.mode === 'edit' && state.focus === 'color'}
          />
          {error ? <div className="text-sm font-medium text-destructive">{error}</div> : null}
        </div>
        <DialogFooter showCloseButton>
          <Button type="button" onClick={save}>
            {state?.mode === 'edit' ? 'Save column' : 'Add column'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CardDialog({
  state,
  board,
  editor,
  onOpenChange,
  onChangeBoard,
}: {
  state: CardDialogState | null;
  board: KanbanBoard;
  editor: boolean;
  onOpenChange: (open: boolean) => void;
  onChangeBoard: (board: KanbanBoard) => void;
}) {
  const card = state?.mode === 'edit' ? board.cards.find((item) => item.id === state.cardId) : null;
  const cardId = state?.mode === 'edit' ? state.cardId : null;
  const [form, setForm] = useState<CardFormState>({
    title: '',
    description: '',
    columnId: '',
    dueDate: '',
    priority: 'medium',
    labelIds: [],
  });
  const [error, setError] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState<LabelDraft>({
    id: null,
    name: '',
    color: COLOR_PALETTE[1],
  });

  useEffect(() => {
    if (!state) return;
    if (state.mode === 'create') {
      setForm({
        title: '',
        description: '',
        columnId: state.columnId,
        dueDate: '',
        priority: 'medium',
        labelIds: [],
      });
    } else {
      const seed = board.cards.find((item) => item.id === state.cardId);
      if (seed) {
        setForm({
          title: seed.title,
          description: seed.description ?? '',
          columnId: seed.columnId,
          dueDate: seed.dueDate ?? '',
          priority: seed.priority,
          labelIds: seed.labelIds,
        });
      }
    }
    setError(null);
    setLabelDraft({ id: null, name: '', color: COLOR_PALETTE[1] });
    // Seed the form only when the dialog target changes, not when the board mutates
    // underneath (e.g. creating a label mid-edit), which would discard unsaved edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, cardId]);

  const updateForm = (patch: Partial<CardFormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setError(null);
  };

  const toggleLabel = (labelId: string, checked: boolean) => {
    updateForm({
      labelIds: checked
        ? [...form.labelIds, labelId]
        : form.labelIds.filter((current) => current !== labelId),
    });
  };

  const saveCard = () => {
    if (!state || !editor) return;
    if (!form.title.trim()) {
      setError('Card title is required.');
      return;
    }
    const input = {
      title: form.title,
      description: form.description,
      columnId: form.columnId,
      dueDate: form.dueDate,
      priority: form.priority,
      labelIds: form.labelIds,
    };
    const next =
      state.mode === 'create' ? createCard(board, input) : updateCard(board, state.cardId, input);
    onChangeBoard(next);
    toast.success(
      state.mode === 'create' ? `Added ${form.title.trim()}` : `Updated ${form.title.trim()}`,
    );
    onOpenChange(false);
  };

  const removeCard = () => {
    if (!state || state.mode !== 'edit' || !editor) return;
    onChangeBoard(deleteCard(board, state.cardId));
    toast.success('Deleted card');
    onOpenChange(false);
  };

  const saveLabel = () => {
    if (!labelDraft.name.trim()) return;
    if (labelDraft.id) {
      onChangeBoard(
        updateLabel(board, labelDraft.id, { name: labelDraft.name, color: labelDraft.color }),
      );
    } else {
      const next = createLabel(board, labelDraft.name, labelDraft.color);
      const created = next.labels.at(-1);
      onChangeBoard(next);
      if (created && !form.labelIds.includes(created.id)) {
        updateForm({ labelIds: [...form.labelIds, created.id] });
      }
    }
    setLabelDraft({ id: null, name: '', color: COLOR_PALETTE[1] });
  };

  const removeLabel = (labelId: string) => {
    onChangeBoard(deleteLabel(board, labelId));
    setForm((prev) => ({ ...prev, labelIds: prev.labelIds.filter((id) => id !== labelId) }));
  };

  return (
    <Dialog open={state != null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {state?.mode === 'create' ? 'Add card' : editor ? 'Edit card' : 'Card'}
          </DialogTitle>
          <DialogDescription>
            {!editor
              ? 'View this card.'
              : state?.mode === 'create'
                ? 'Fill in the details for a new card.'
                : 'Update this card.'}
          </DialogDescription>
        </DialogHeader>
        {state?.mode === 'edit' && !card ? (
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            Card not found.
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="kanban-card-title">Title</Label>
              <Input
                id="kanban-card-title"
                value={form.title}
                disabled={!editor}
                autoFocus={editor && state?.mode === 'create'}
                onChange={(event) => updateForm({ title: event.target.value })}
                placeholder="Card title"
                aria-invalid={error ? true : undefined}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="kanban-card-description">Description</Label>
              <textarea
                id="kanban-card-description"
                value={form.description}
                disabled={!editor}
                onChange={(event) => updateForm({ description: event.target.value })}
                rows={4}
                className="min-h-24 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="Notes"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label>Column</Label>
                <Select
                  value={form.columnId}
                  onValueChange={(value) => updateForm({ columnId: value })}
                  disabled={!editor}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {board.columns.map((column) => (
                      <SelectItem key={column.id} value={column.id}>
                        {column.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Priority</Label>
                <Select
                  value={form.priority}
                  onValueChange={(value) => updateForm({ priority: value as KanbanPriority })}
                  disabled={!editor}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="kanban-card-due">Due date</Label>
                <Input
                  id="kanban-card-due"
                  type="date"
                  value={form.dueDate}
                  disabled={!editor}
                  onChange={(event) => updateForm({ dueDate: event.target.value })}
                />
              </div>
            </div>

            <div className="grid gap-3 rounded-lg border border-border bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Tags className="size-4 text-muted-foreground" />
                  Labels
                </div>
                {labelDraft.id ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Cancel label edit"
                    onClick={() => setLabelDraft({ id: null, name: '', color: COLOR_PALETTE[1] })}
                  >
                    <X className="size-3" />
                  </Button>
                ) : null}
              </div>
              {board.labels.length === 0 ? (
                <div className="rounded-md border border-dashed border-border bg-card/50 px-3 py-3 text-center text-sm text-muted-foreground">
                  No labels yet
                </div>
              ) : (
                <div className="grid gap-2">
                  {board.labels.map((label) => (
                    <div
                      key={label.id}
                      className="flex min-h-9 items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5"
                    >
                      <Checkbox
                        checked={form.labelIds.includes(label.id)}
                        disabled={!editor}
                        onCheckedChange={(checked) => toggleLabel(label.id, checked === true)}
                        aria-label={`Attach ${label.name}`}
                      />
                      <span
                        className="max-w-full truncate rounded-full border px-2 py-0.5 text-xs font-medium"
                        style={{ borderColor: label.color, color: label.color }}
                      >
                        {label.name}
                      </span>
                      {editor ? (
                        <div className="ml-auto flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Edit ${label.name}`}
                            onClick={() =>
                              setLabelDraft({ id: label.id, name: label.name, color: label.color })
                            }
                          >
                            <Pencil className="size-3" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Delete ${label.name}`}
                            onClick={() => removeLabel(label.id)}
                          >
                            <Trash2 className="size-3" />
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
              {editor ? (
                <div className="grid gap-3 rounded-md border border-border bg-card p-3">
                  <div className="grid gap-2">
                    <Label htmlFor="kanban-label-name">
                      {labelDraft.id ? 'Edit label' : 'New label'}
                    </Label>
                    <Input
                      id="kanban-label-name"
                      value={labelDraft.name}
                      onChange={(event) =>
                        setLabelDraft((prev) => ({ ...prev, name: event.target.value }))
                      }
                      placeholder="Infra"
                    />
                  </div>
                  <ColorSwatches
                    value={labelDraft.color}
                    onChange={(next) => setLabelDraft((prev) => ({ ...prev, color: next }))}
                  />
                  <Button type="button" variant="outline" size="sm" onClick={saveLabel}>
                    {labelDraft.id ? 'Save label' : 'Add label'}
                  </Button>
                </div>
              ) : null}
            </div>
            {error ? <div className="text-sm font-medium text-destructive">{error}</div> : null}
          </div>
        )}
        <DialogFooter showCloseButton={!editor}>
          {editor && state?.mode === 'edit' ? (
            <Button type="button" variant="outline" onClick={removeCard}>
              <Trash2 className="size-4" />
              Delete card
            </Button>
          ) : null}
          {editor ? (
            <Button type="button" onClick={saveCard}>
              {state?.mode === 'create' ? 'Add card' : 'Save card'}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ColorSwatches({
  value,
  onChange,
  autoFocus = false,
}: {
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <div className="grid gap-2">
      <Label>Color</Label>
      <div className="flex flex-wrap gap-2">
        {COLOR_PALETTE.map((color, index) => (
          <button
            key={color}
            type="button"
            className={cn(
              'size-7 rounded-full border border-border ring-offset-background transition-shadow focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
              color === value && 'ring-2 ring-ring ring-offset-2',
            )}
            style={{ backgroundColor: color }}
            aria-label={`Choose color ${index + 1}`}
            aria-pressed={color === value}
            autoFocus={autoFocus && color === value}
            onClick={() => onChange(color)}
          />
        ))}
      </div>
    </div>
  );
}

function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onOpenChange,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter showCloseButton>
          <Button type="button" variant="destructive" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
