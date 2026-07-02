import { describe, expect, it } from 'vitest';

import {
  COLOR_PALETTE,
  createDefaultBoard,
  deleteLabel,
  dueTone,
  isKanbanBoardId,
  kanbanBoardKey,
  moveCardToPosition,
  newKanbanId,
  reorderColumns,
  sanitizeBoard,
  sanitizeBoardIndex,
  type KanbanBoard,
} from './kanban';

describe('kanban state helpers', () => {
  it('generates compact board ids that fit the state key contract', () => {
    const id = newKanbanId('b');

    expect(isKanbanBoardId(id)).toBe(true);
    expect(kanbanBoardKey(id)).toMatch(/^kanban\.board\.[a-z][a-z0-9_-]+$/i);
    expect(kanbanBoardKey(id).length).toBeLessThanOrEqual(64);
  });

  it('sanitizes and sorts the shared board index', () => {
    const index = sanitizeBoardIndex({
      boards: [
        { id: 'bsecond', name: '  Second  ', order: 2000 },
        { id: 'bad key', name: 'ignored', order: 0 },
        { id: 'bfirst', name: '', order: 1000 },
        { id: 'bfirst', name: 'duplicate', order: 3000 },
      ],
    });

    expect(index.boards).toEqual([
      { id: 'bfirst', name: 'Untitled board', order: 1000 },
      { id: 'bsecond', name: 'Second', order: 2000 },
    ]);
  });

  it('creates new boards with the expected seed columns', () => {
    const board = createDefaultBoard();

    expect(board.cards).toEqual([]);
    expect(board.labels).toEqual([]);
    expect(board.columns.map((column) => column.name)).toEqual(['To Do', 'In Progress', 'Done']);
    expect(board.columns.map((column) => column.color)).toEqual(COLOR_PALETTE.slice(0, 3));
  });

  it('removes deleted labels from every card', () => {
    const board: KanbanBoard = {
      columns: [{ id: 'col1', name: 'To Do', color: COLOR_PALETTE[0], order: 1000 }],
      labels: [
        { id: 'label1', name: 'Infra', color: COLOR_PALETTE[1] },
        { id: 'label2', name: 'Urgent', color: COLOR_PALETTE[5] },
      ],
      cards: [
        {
          id: 'card1',
          columnId: 'col1',
          title: 'Patch router',
          labelIds: ['label1', 'label2'],
          priority: 'high',
          order: 1000,
        },
      ],
    };

    expect(deleteLabel(board, 'label2').cards[0].labelIds).toEqual(['label1']);
  });

  it('moves cards across columns and normalizes per-column order', () => {
    const board = sanitizeBoard({
      columns: [
        { id: 'todo', name: 'To Do', order: 1000 },
        { id: 'doing', name: 'Doing', order: 2000 },
      ],
      labels: [],
      cards: [
        { id: 'a', columnId: 'todo', title: 'A', labelIds: [], priority: 'medium', order: 1000 },
        { id: 'b', columnId: 'todo', title: 'B', labelIds: [], priority: 'medium', order: 2000 },
        { id: 'c', columnId: 'doing', title: 'C', labelIds: [], priority: 'medium', order: 1000 },
      ],
    });

    const moved = moveCardToPosition(board, 'b', 'doing', 'c');

    expect(moved.cards.filter((card) => card.columnId === 'todo')).toEqual([
      expect.objectContaining({ id: 'a', order: 1000 }),
    ]);
    expect(moved.cards.filter((card) => card.columnId === 'doing')).toEqual([
      expect.objectContaining({ id: 'b', order: 1000 }),
      expect.objectContaining({ id: 'c', order: 2000 }),
    ]);
  });

  it('moves cards downward within a column past the drop target', () => {
    const board = sanitizeBoard({
      columns: [{ id: 'todo', name: 'To Do', order: 1000 }],
      labels: [],
      cards: [
        { id: 'a', columnId: 'todo', title: 'A', labelIds: [], priority: 'medium', order: 1000 },
        { id: 'b', columnId: 'todo', title: 'B', labelIds: [], priority: 'medium', order: 2000 },
        { id: 'c', columnId: 'todo', title: 'C', labelIds: [], priority: 'medium', order: 3000 },
      ],
    });

    const moved = moveCardToPosition(board, 'b', 'todo', 'c');

    expect(moved.cards.map((card) => card.id)).toEqual(['a', 'c', 'b']);
  });

  it('moves cards upward within a column to the drop target position', () => {
    const board = sanitizeBoard({
      columns: [{ id: 'todo', name: 'To Do', order: 1000 }],
      labels: [],
      cards: [
        { id: 'a', columnId: 'todo', title: 'A', labelIds: [], priority: 'medium', order: 1000 },
        { id: 'b', columnId: 'todo', title: 'B', labelIds: [], priority: 'medium', order: 2000 },
        { id: 'c', columnId: 'todo', title: 'C', labelIds: [], priority: 'medium', order: 3000 },
      ],
    });

    const moved = moveCardToPosition(board, 'c', 'todo', 'a');

    expect(moved.cards.map((card) => card.id)).toEqual(['c', 'a', 'b']);
  });

  it('reorders columns one step to the right', () => {
    const board = sanitizeBoard({
      columns: [
        { id: 'todo', name: 'To Do', order: 1000 },
        { id: 'doing', name: 'Doing', order: 2000 },
        { id: 'done', name: 'Done', order: 3000 },
      ],
      labels: [],
      cards: [],
    });

    const moved = reorderColumns(board, 'todo', 'doing');

    expect(moved.columns.map((column) => column.id)).toEqual(['doing', 'todo', 'done']);
  });

  it('reorders columns by target position', () => {
    const board = sanitizeBoard({
      columns: [
        { id: 'todo', name: 'To Do', order: 1000 },
        { id: 'doing', name: 'Doing', order: 2000 },
        { id: 'done', name: 'Done', order: 3000 },
      ],
      labels: [],
      cards: [],
    });

    const moved = reorderColumns(board, 'done', 'todo');

    expect(moved.columns).toEqual([
      expect.objectContaining({ id: 'done', order: 1000 }),
      expect.objectContaining({ id: 'todo', order: 2000 }),
      expect.objectContaining({ id: 'doing', order: 3000 }),
    ]);
  });

  it('classifies due dates relative to the end of the due day', () => {
    const now = new Date(2026, 6, 2, 10, 0, 0);

    expect(dueTone('2026-07-01', now)).toBe('overdue');
    expect(dueTone('2026-07-04', now)).toBe('soon');
    expect(dueTone('2026-07-10', now)).toBe('later');
    expect(dueTone(undefined, now)).toBeNull();
  });
});
