import type { KanbanStatus, TaskSummary } from "@mind-palace/shared";

/**
 * Kanban drag targets come from board geometry captured once, when a card is lifted — never from the
 * live DOM. Opening a gap reflows the very cards that would have to be measured again, so hit-testing
 * the current layout feeds back on itself and the target flickers between neighbours.
 *
 * Coordinates are board-content pixels: the board's own scroll box, so a page scroll or the board's
 * horizontal scroll during a drag does not move the cards out from under the pointer. Everything here
 * is pure so the placement math is testable without a browser.
 */

/** One card's vertical span, in board-content coordinates. */
export interface CardSpan {
  taskId: number;
  top: number;
  bottom: number;
}

/** One column as it looked when the drag started. */
export interface ColumnSpan {
  status: KanbanStatus;
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** Top of the card stack — the origin the insertion line is placed against. */
  stackTop: number;
  /** Cards in visual order, top to bottom. */
  cards: CardSpan[];
}

export interface BoardGeometry {
  columns: ColumnSpan[];
  /** Row gap between stacked cards (px). */
  gap: number;
}

/** Where a dropped card would land: a column, and how many cards sit above it there. */
export interface DropTarget {
  status: KanbanStatus;
  index: number;
}

/** Read the board's columns and cards, in board-content pixels. */
export function captureBoardGeometry(board: HTMLElement): BoardGeometry | null {
  const boardRect = board.getBoundingClientRect();
  const columns: ColumnSpan[] = [];
  for (const element of board.querySelectorAll<HTMLElement>(".kanban-column")) {
    const status = element.dataset.status;
    if (status === undefined) continue;
    const rect = element.getBoundingClientRect();
    const stack = element.querySelector<HTMLElement>(".kanban-stack");
    const stackRect = stack?.getBoundingClientRect();
    const cards: CardSpan[] = [];
    for (const card of element.querySelectorAll<HTMLElement>(".kanban-stack > .task-card")) {
      const taskId = Number(card.dataset.taskId);
      if (!Number.isInteger(taskId)) continue;
      const cardRect = card.getBoundingClientRect();
      cards.push({
        taskId,
        top: cardRect.top - boardRect.top + board.scrollTop,
        bottom: cardRect.bottom - boardRect.top + board.scrollTop,
      });
    }
    columns.push({
      status: status as KanbanStatus,
      left: rect.left - boardRect.left + board.scrollLeft,
      right: rect.right - boardRect.left + board.scrollLeft,
      top: rect.top - boardRect.top + board.scrollTop,
      bottom: rect.bottom - boardRect.top + board.scrollTop,
      stackTop: stackRect === undefined ? rect.top - boardRect.top + board.scrollTop : stackRect.top - boardRect.top + board.scrollTop,
      cards,
    });
  }
  if (columns.length === 0) return null;
  const stack = board.querySelector<HTMLElement>(".kanban-stack");
  const gap = stack ? Number.parseFloat(getComputedStyle(stack).rowGap) || 0 : 0;
  return { columns, gap };
}

/** A pointer position in the same board-content pixels as the captured geometry. */
export function pointInBoard(board: HTMLElement, clientX: number, clientY: number): { x: number; y: number } {
  const rect = board.getBoundingClientRect();
  return { x: clientX - rect.left + board.scrollLeft, y: clientY - rect.top + board.scrollTop };
}

/** The board as it is drawn once the dragged card has been lifted out of its slot. */
export function removeCard(geometry: BoardGeometry, taskId: number): BoardGeometry {
  const lifted = findCard(geometry, taskId);
  if (lifted === null) return geometry;
  const slot = lifted.card.bottom - lifted.card.top + geometry.gap;
  return {
    ...geometry,
    columns: geometry.columns.map((column) => column === lifted.column
      ? {
          ...column,
          // Cards below the lifted one rise by one slot; cards above are untouched.
          cards: column.cards
            .filter((card) => card.taskId !== taskId)
            .map((card) => (card.top > lifted.card.top ? { ...card, top: card.top - slot, bottom: card.bottom - slot } : card)),
        }
      : column),
  };
}

/** How far outside a column the pointer may stray and still count as aiming at it (px). */
const DROP_SLOP = 72;

/**
 * The drop target under a pointer, or null when it is too far from every column.
 *
 * Picks the nearest column rather than requiring the pointer to be inside one: on a phone the board
 * stacks, so a column is only as tall as its cards and a pointer just past the last card must still
 * mean "the end of this column". `y` is clamped to the column, so overshooting reads as the last slot.
 */
export function dropTargetAt(
  geometry: BoardGeometry,
  point: { x: number; y: number },
  draggingTaskId: number,
): DropTarget | null {
  const nearest = nearestColumn(geometry.columns, point);
  if (nearest === null || nearest.distance > DROP_SLOP) return null;
  const y = Math.min(Math.max(point.y, nearest.span.top), nearest.span.bottom);
  return { status: nearest.span.status, index: insertionIndex(nearest.span.cards, y, draggingTaskId) };
}

/** How many cards sit above a drop at `y`: those whose midpoint is above the pointer. */
export function insertionIndex(cards: CardSpan[], y: number, draggingTaskId: number): number {
  let index = 0;
  for (const card of cards) {
    if (card.taskId !== draggingTaskId && y > (card.top + card.bottom) / 2) index += 1;
  }
  return index;
}

/**
 * How far each card slides, in px, to show the drop. Card offsets are pure transforms: nothing
 * reflows, so the board animates smoothly and the captured geometry stays valid for the whole drag.
 *
 * Closing the gap where the card was lifted and opening the same gap at the drop target are two
 * opposite shifts of one card slot; a card between the two nets out at zero and stays put.
 */
export function cardOffsets(geometry: BoardGeometry, target: DropTarget, draggingTaskId: number): Map<number, number> {
  const offsets = new Map<number, number>();
  const lifted = findCard(geometry, draggingTaskId);
  if (lifted === null) return offsets;
  const slot = lifted.card.bottom - lifted.card.top + geometry.gap;
  for (const column of geometry.columns) {
    const compacted = column.cards.filter((card) => card.taskId !== draggingTaskId);
    compacted.forEach((card, index) => {
      const closesLiftedGap = column === lifted.column && card.top > lifted.card.top;
      const opensTargetGap = column.status === target.status && index >= target.index;
      const offset = (opensTargetGap ? slot : 0) - (closesLiftedGap ? slot : 0);
      if (offset !== 0) offsets.set(card.taskId, offset);
    });
  }
  return offsets;
}

/**
 * Where the insertion line goes, as a `top` offset inside the card stack: the leading edge of the slot
 * the card would fill. Derived from the same geometry as `cardOffsets`, so line and gap always agree.
 */
export function indicatorOffset(geometry: BoardGeometry, target: DropTarget): number | null {
  const column = geometry.columns.find((candidate) => candidate.status === target.status);
  if (column === undefined) return null;
  const visible = column.cards;
  if (visible.length === 0) return 0;
  const above = target.index <= 0 ? undefined : visible[Math.min(target.index, visible.length) - 1];
  return above === undefined
    ? visible[0]!.top - column.stackTop
    : above.bottom - column.stackTop + geometry.gap / 2;
}

/**
 * Apply a drop to the task list optimistically, so the board reads correctly before the server
 * answers. The moved task is spliced to `target.index` among the cards already in that column and
 * every card in it is renumbered, exactly matching what `TaskRepository.moveTask` stores — so the
 * drop looks the same whether the next poll has landed or not.
 */
export function reorderTasks(tasks: TaskSummary[], taskId: number, target: DropTarget): TaskSummary[] {
  const moved = tasks.find((task) => task.id === taskId);
  if (moved === undefined) return tasks;
  // `index` counts drawn cards, so a decayed task still sitting in the column must not take a slot —
  // the board does not render it, and neither does the server count it.
  const column = tasks
    .filter((task) => task.kanbanStatus === target.status && task.id !== taskId && task.lifecycleStatus !== "archived")
    .sort((a, b) => b.rank - a.rank);
  column.splice(Math.max(0, Math.min(target.index, column.length)), 0, moved);
  const ranks = new Map(column.map((task, index) => [task.id, column.length - index]));
  return tasks.map((task) => {
    const rank = ranks.get(task.id);
    if (rank === undefined) return task;
    if (task.id !== taskId) return { ...task, rank };
    // A drop into Completed also settles the lifecycle fields the repository writes alongside it.
    return target.status === "completed"
      ? { ...task, kanbanStatus: target.status, rank, lifecycleStatus: "completed", completedAt: task.completedAt ?? new Date().toISOString() }
      : { ...task, kanbanStatus: target.status, rank, lifecycleStatus: "active", completedAt: null };
  });
}

function findCard(geometry: BoardGeometry, taskId: number): { column: ColumnSpan; card: CardSpan } | null {
  for (const column of geometry.columns) {
    const card = column.cards.find((candidate) => candidate.taskId === taskId);
    if (card !== undefined) return { column, card };
  }
  return null;
}

/** The column closest to a point, with the distance from its box (0 when inside it). */
function nearestColumn(
  columns: ColumnSpan[],
  point: { x: number; y: number },
): { span: ColumnSpan; distance: number } | null {
  let best: { span: ColumnSpan; distance: number } | null = null;
  for (const span of columns) {
    const dx = point.x < span.left ? span.left - point.x : point.x > span.right ? point.x - span.right : 0;
    const dy = point.y < span.top ? span.top - point.y : point.y > span.bottom ? point.y - span.bottom : 0;
    const distance = Math.hypot(dx, dy);
    if (best === null || distance < best.distance) best = { span, distance };
  }
  return best;
}
