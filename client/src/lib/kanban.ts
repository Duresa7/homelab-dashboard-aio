export const KANBAN_BOARDS_KEY = 'kanban.boards';

export const COLOR_PALETTE = [
  '#64748b',
  '#0ea5e9',
  '#14b8a6',
  '#22c55e',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#ec4899',
] as const;

export type KanbanPriority = 'low' | 'medium' | 'high';
export type DueTone = 'overdue' | 'soon' | 'later';

export interface KanbanBoardSummary {
  id: string;
  name: string;
  order: number;
}

export interface KanbanBoardIndex {
  boards: KanbanBoardSummary[];
}

export interface KanbanColumn {
  id: string;
  name: string;
  color?: string;
  order: number;
}

export interface KanbanLabel {
  id: string;
  name: string;
  color: string;
}

export interface KanbanCard {
  id: string;
  columnId: string;
  title: string;
  description?: string;
  labelIds: string[];
  dueDate?: string;
  priority: KanbanPriority;
  order: number;
}

export interface KanbanBoard {
  columns: KanbanColumn[];
  cards: KanbanCard[];
  labels: KanbanLabel[];
}

const EMPTY_INDEX: KanbanBoardIndex = { boards: [] };
const EMPTY_BOARD: KanbanBoard = { columns: [], cards: [], labels: [] };
const PRIORITIES = new Set<KanbanPriority>(['low', 'medium', 'high']);
const KEY_PREFIX = 'kanban.board.';
const DEFAULT_COLUMN_NAMES = ['To Do', 'In Progress', 'Done'];

export function kanbanBoardKey(boardId: string): string {
  return `${KEY_PREFIX}${boardId}`;
}

export function isKanbanBoardId(id: string): boolean {
  return /^[a-z][a-z0-9_-]{1,31}$/i.test(id) && kanbanBoardKey(id).length <= 64;
}

export function newKanbanId(prefix: 'b' | 'col' | 'card' | 'label'): string {
  const rand =
    typeof crypto !== 'undefined' && 'getRandomValues' in crypto
      ? Array.from(crypto.getRandomValues(new Uint8Array(4)), (n) =>
          n.toString(36).padStart(2, '0'),
        ).join('')
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}${Date.now().toString(36)}${rand.slice(0, 8)}`;
}

export function sanitizeColor(value: unknown, fallback: string = COLOR_PALETTE[0]): string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

export function sanitizeBoardIndex(value: unknown): KanbanBoardIndex {
  if (!isRecord(value) || !Array.isArray(value.boards)) return EMPTY_INDEX;
  const seen = new Set<string>();
  const boards = value.boards.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    if (!isKanbanBoardId(id) || seen.has(id)) return [];
    seen.add(id);
    return [
      {
        id,
        name: readName(item.name, 'Untitled board'),
        order: readOrder(item.order, index),
      },
    ];
  });
  return { boards: sortByOrder(boards) };
}

export function sanitizeBoard(value: unknown): KanbanBoard {
  if (!isRecord(value)) return EMPTY_BOARD;

  const columns = Array.isArray(value.columns)
    ? value.columns.flatMap((item, index) => {
        if (!isRecord(item) || typeof item.id !== 'string') return [];
        return [
          {
            id: item.id,
            name: readName(item.name, 'Column'),
            color: sanitizeColor(item.color, COLOR_PALETTE[index % COLOR_PALETTE.length]),
            order: readOrder(item.order, index),
          },
        ];
      })
    : [];
  const columnIds = new Set(columns.map((column) => column.id));

  const labels = Array.isArray(value.labels)
    ? value.labels.flatMap((item, index) => {
        if (!isRecord(item) || typeof item.id !== 'string') return [];
        return [
          {
            id: item.id,
            name: readName(item.name, 'Label'),
            color: sanitizeColor(item.color, COLOR_PALETTE[(index + 3) % COLOR_PALETTE.length]),
          },
        ];
      })
    : [];
  const labelIds = new Set(labels.map((label) => label.id));

  const cards = Array.isArray(value.cards)
    ? value.cards.flatMap((item, index) => {
        if (!isRecord(item) || typeof item.id !== 'string') return [];
        if (typeof item.columnId !== 'string' || !columnIds.has(item.columnId)) return [];
        const title = readName(item.title, '');
        if (!title) return [];
        const description = typeof item.description === 'string' ? item.description.trim() : '';
        const cardLabelIds = Array.isArray(item.labelIds)
          ? item.labelIds.filter((id): id is string => typeof id === 'string' && labelIds.has(id))
          : [];
        const dueDate = sanitizeDueDate(item.dueDate);
        return [
          {
            id: item.id,
            columnId: item.columnId,
            title,
            ...(description ? { description } : {}),
            labelIds: unique(cardLabelIds),
            ...(dueDate ? { dueDate } : {}),
            priority: PRIORITIES.has(item.priority as KanbanPriority)
              ? (item.priority as KanbanPriority)
              : 'medium',
            order: readOrder(item.order, index),
          },
        ];
      })
    : [];

  const sortedColumns = sortByOrder(columns);
  return normalizeBoardOrders({
    columns: sortedColumns,
    cards: sortedColumns.flatMap((column) =>
      sortByOrder(cards.filter((card) => card.columnId === column.id)),
    ),
    labels,
  });
}

export function createBoardSummary(name: string, order: number): KanbanBoardSummary {
  return {
    id: newKanbanId('b'),
    name: name.trim() || 'Untitled board',
    order,
  };
}

export function createDefaultBoard(): KanbanBoard {
  return {
    columns: DEFAULT_COLUMN_NAMES.map((name, index) => ({
      id: newKanbanId('col'),
      name,
      color: COLOR_PALETTE[index],
      order: orderForIndex(index),
    })),
    cards: [],
    labels: [],
  };
}

export function upsertBoardSummary(
  index: KanbanBoardIndex,
  summary: KanbanBoardSummary,
): KanbanBoardIndex {
  const exists = index.boards.some((board) => board.id === summary.id);
  const boards = exists
    ? index.boards.map((board) => (board.id === summary.id ? summary : board))
    : [...index.boards, summary];
  return { boards: sortByOrder(boards) };
}

export function removeBoardSummary(index: KanbanBoardIndex, boardId: string): KanbanBoardIndex {
  return { boards: normalizeOrders(index.boards.filter((board) => board.id !== boardId)) };
}

export function createColumn(board: KanbanBoard, name: string, color: string): KanbanBoard {
  const column: KanbanColumn = {
    id: newKanbanId('col'),
    name: name.trim() || 'New column',
    color: sanitizeColor(color),
    order: orderForIndex(board.columns.length),
  };
  return normalizeBoardOrders({ ...board, columns: [...board.columns, column] });
}

export function updateColumn(
  board: KanbanBoard,
  columnId: string,
  patch: Partial<Pick<KanbanColumn, 'name' | 'color'>>,
): KanbanBoard {
  return {
    ...board,
    columns: board.columns.map((column) =>
      column.id === columnId
        ? {
            ...column,
            ...(patch.name != null ? { name: patch.name.trim() || column.name } : {}),
            ...(patch.color != null ? { color: sanitizeColor(patch.color, column.color) } : {}),
          }
        : column,
    ),
  };
}

export function deleteColumn(board: KanbanBoard, columnId: string): KanbanBoard {
  return normalizeBoardOrders({
    ...board,
    columns: board.columns.filter((column) => column.id !== columnId),
    cards: board.cards.filter((card) => card.columnId !== columnId),
  });
}

export function reorderColumns(
  board: KanbanBoard,
  columnId: string,
  targetColumnId: string,
): KanbanBoard {
  if (columnId === targetColumnId) return board;
  const moving = board.columns.find((column) => column.id === columnId);
  if (!moving) return board;
  const sorted = sortByOrder(board.columns);
  // Index against the pre-move ordering (moving column still in place): dnd-kit
  // reports the later sibling as the drop target on rightward drags, and this
  // matches its arrayMove semantics in both directions.
  const targetIndex = sorted.findIndex((column) => column.id === targetColumnId);
  if (targetIndex < 0) return board;
  const nextColumns = sorted.filter((column) => column.id !== columnId);
  nextColumns.splice(Math.min(targetIndex, nextColumns.length), 0, moving);
  return normalizeBoardOrders({ ...board, columns: nextColumns });
}

export function createLabel(board: KanbanBoard, name: string, color: string): KanbanBoard {
  const label: KanbanLabel = {
    id: newKanbanId('label'),
    name: name.trim() || 'New label',
    color: sanitizeColor(color),
  };
  return { ...board, labels: [...board.labels, label] };
}

export function updateLabel(
  board: KanbanBoard,
  labelId: string,
  patch: Partial<Pick<KanbanLabel, 'name' | 'color'>>,
): KanbanBoard {
  return {
    ...board,
    labels: board.labels.map((label) =>
      label.id === labelId
        ? {
            ...label,
            ...(patch.name != null ? { name: patch.name.trim() || label.name } : {}),
            ...(patch.color != null ? { color: sanitizeColor(patch.color, label.color) } : {}),
          }
        : label,
    ),
  };
}

export function deleteLabel(board: KanbanBoard, labelId: string): KanbanBoard {
  return {
    ...board,
    labels: board.labels.filter((label) => label.id !== labelId),
    cards: board.cards.map((card) => ({
      ...card,
      labelIds: card.labelIds.filter((id) => id !== labelId),
    })),
  };
}

export function createCard(
  board: KanbanBoard,
  input: {
    columnId: string;
    title: string;
    description?: string;
    labelIds?: string[];
    dueDate?: string;
    priority?: KanbanPriority;
  },
): KanbanBoard {
  const title = input.title.trim();
  if (!title || !board.columns.some((column) => column.id === input.columnId)) return board;
  const existing = cardsForColumn(board, input.columnId);
  const labelIds = new Set(board.labels.map((label) => label.id));
  const description = input.description?.trim();
  const dueDate = sanitizeDueDate(input.dueDate);
  const card: KanbanCard = {
    id: newKanbanId('card'),
    columnId: input.columnId,
    title,
    ...(description ? { description } : {}),
    labelIds: unique((input.labelIds ?? []).filter((id) => labelIds.has(id))),
    ...(dueDate ? { dueDate } : {}),
    priority: input.priority ?? 'medium',
    order: orderForIndex(existing.length),
  };
  return normalizeBoardOrders({ ...board, cards: [...board.cards, card] });
}

export function updateCard(
  board: KanbanBoard,
  cardId: string,
  patch: Partial<Omit<KanbanCard, 'id' | 'order'>>,
): KanbanBoard {
  const columnIds = new Set(board.columns.map((column) => column.id));
  const labelIds = new Set(board.labels.map((label) => label.id));
  return normalizeBoardOrders({
    ...board,
    cards: board.cards.map((card) => {
      if (card.id !== cardId) return card;
      const title = patch.title?.trim() ?? card.title;
      const hasDescription = Object.hasOwn(patch, 'description');
      const description = hasDescription ? patch.description?.trim() : card.description;
      const dueDate = patch.dueDate === undefined ? card.dueDate : sanitizeDueDate(patch.dueDate);
      const next: KanbanCard = {
        ...card,
        ...(columnIds.has(patch.columnId ?? '') ? { columnId: patch.columnId } : {}),
        title: title || card.title,
        labelIds: patch.labelIds
          ? unique(patch.labelIds.filter((id) => labelIds.has(id)))
          : card.labelIds,
        priority: patch.priority && PRIORITIES.has(patch.priority) ? patch.priority : card.priority,
      };
      if (description) next.description = description;
      else delete next.description;
      if (dueDate) next.dueDate = dueDate;
      else delete next.dueDate;
      return next;
    }),
  });
}

export function deleteCard(board: KanbanBoard, cardId: string): KanbanBoard {
  return normalizeBoardOrders({
    ...board,
    cards: board.cards.filter((card) => card.id !== cardId),
  });
}

export function moveCardToPosition(
  board: KanbanBoard,
  cardId: string,
  targetColumnId: string,
  targetCardId?: string,
): KanbanBoard {
  const moving = board.cards.find((card) => card.id === cardId);
  if (!moving || !board.columns.some((column) => column.id === targetColumnId)) return board;
  if (cardId === targetCardId) return board;

  const untouched = board.cards.filter(
    (card) => card.id !== cardId && card.columnId !== targetColumnId,
  );
  const columnWithMoving = cardsForColumn(board, targetColumnId);
  const targetCards = columnWithMoving.filter((card) => card.id !== cardId);
  // Index against the pre-move ordering (moving card still in place): on a
  // same-column downward drag dnd-kit reports the later sibling as the target,
  // and this index lands the card after it — arrayMove semantics either way.
  const insertAt = targetCardId
    ? columnWithMoving.findIndex((card) => card.id === targetCardId)
    : targetCards.length;
  const nextTargetCards = [...targetCards];
  nextTargetCards.splice(
    insertAt < 0 ? targetCards.length : Math.min(insertAt, targetCards.length),
    0,
    {
      ...moving,
      columnId: targetColumnId,
    },
  );
  return normalizeBoardOrders({ ...board, cards: [...untouched, ...nextTargetCards] });
}

export function cardsForColumn(board: KanbanBoard, columnId: string): KanbanCard[] {
  return sortByOrder(board.cards.filter((card) => card.columnId === columnId));
}

export function normalizeBoardOrders(board: KanbanBoard): KanbanBoard {
  const columns = normalizeOrders(board.columns);
  const cards = columns.flatMap((column) =>
    normalizeOrders(board.cards.filter((card) => card.columnId === column.id)),
  );
  return { ...board, columns, cards };
}

export function dueTone(dueDate: string | undefined, now = new Date()): DueTone | null {
  if (!dueDate) return null;
  const due = parseDueEnd(dueDate);
  if (!due) return null;
  if (due.getTime() < now.getTime()) return 'overdue';
  const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
  return due.getTime() - now.getTime() <= threeDaysMs ? 'soon' : 'later';
}

function parseDueEnd(value: string): Date | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day, 23, 59, 59, 999);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function sanitizeDueDate(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return parseDueEnd(trimmed) ? trimmed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readName(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value.trim() || fallback : fallback;
}

function readOrder(value: unknown, index: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : orderForIndex(index);
}

function orderForIndex(index: number): number {
  return (index + 1) * 1000;
}

function sortByOrder<T extends { order: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.order - b.order);
}

function normalizeOrders<T extends { order: number }>(items: T[]): T[] {
  return items.map((item, index) => ({ ...item, order: orderForIndex(index) }));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
