import type { KanbanStatus } from "@mind-palace/shared";
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import {
  captureBoardGeometry,
  cardOffsets,
  dropTargetAt,
  indicatorOffset,
  pointInBoard,
  removeCard,
  type BoardGeometry,
  type DropTarget,
} from "./boardDrag";

/** Pointer travel that turns a press into a drag. A firm trackpad press drifts a few px. */
const MOUSE_THRESHOLD = 4;
/** Touch keeps scrolling as the default gesture, so a drag needs a deliberate long press first. */
const TOUCH_LONG_PRESS_MS = 260;
/** Finger travel that cancels a pending long press — that gesture was a scroll, not a grab. */
const TOUCH_SLOP = 10;
/** Distance from a viewport or board edge at which the board starts scrolling itself. */
const SCROLL_EDGE = 80;

export interface KanbanDragState {
  draggingId: number | null;
  /** Per-card `translateY` that opens a slot at the drop target and closes the lifted card's slot. */
  offsets: Map<number, number>;
  indicator: { status: KanbanStatus; y: number } | null;
}

const IDLE: KanbanDragState = { draggingId: null, offsets: new Map(), indicator: null };

/**
 * Pointer-driven kanban dragging that works with a mouse, a trackpad, a pen and a finger.
 *
 * The rules that keep it smooth:
 * - Board geometry is captured **once** when the card lifts. The gap that opens under the pointer
 *   would otherwise reflow the very cards it is measured against, and the target flickers (that was
 *   the old bug). Nothing is inserted into the layout: cards move with `transform`, the insertion
 *   line is absolutely positioned, so the captured geometry stays true for the whole gesture.
 * - One request per drop, not one per card (the page sends it).
 * - A touch drag needs a long press, so a finger swipe still scrolls the board; once armed, the
 *   non-passive `touchmove` guard stops the page scrolling out from under the card.
 * - Every session ends on `pointerup`, `pointercancel`, window blur or a release outside the
 *   window, so a drag can never leave the board stuck in its dragged state.
 */
export function useKanbanDrag({
  boardRef,
  onDrop,
  enabled = true,
}: {
  boardRef: RefObject<HTMLDivElement | null>;
  onDrop: (taskId: number, target: DropTarget) => void;
  enabled?: boolean;
}): { state: KanbanDragState; onCardPointerDown: (event: ReactPointerEvent<HTMLElement>, taskId: number) => void } {
  const [state, setState] = useState<KanbanDragState>(IDLE);
  const sessionRef = useRef<Session | null>(null);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  const cancel = useCallback(() => {
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session === null) return;
    window.clearTimeout(session.longPress);
    window.cancelAnimationFrame(session.frame);
    session.ghost?.remove();
    session.card.style.removeProperty("visibility");
    document.body.classList.remove("dragging");
    setState(IDLE);
  }, []);

  /** Turn a pending press into a live drag: lift a ghost, freeze the geometry, start the frame loop. */
  const lift = useCallback((session: Session) => {
    const board = boardRef.current;
    if (board === null) return;
    const geometry = captureBoardGeometry(board);
    if (geometry === null) return;
    // Two views of one snapshot: `origin` still holds the lifted card (the offsets need its slot),
    // `geometry` has it removed (the hit test must measure the layout the user can see).
    session.origin = geometry;
    session.geometry = removeCard(geometry, session.taskId);
    session.armed = true;

    const rect = session.card.getBoundingClientRect();
    const ghost = session.card.cloneNode(true) as HTMLElement;
    ghost.classList.add("task-card-drag-ghost");
    ghost.removeAttribute("data-task-id");
    Object.assign(ghost.style, {
      position: "fixed",
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      pointerEvents: "none",
      transition: "none",
    });
    document.body.appendChild(ghost);
    session.ghost = ghost;
    // The original stays in the layout so the captured geometry stays valid; only its paint goes.
    session.card.style.visibility = "hidden";
    document.body.classList.add("dragging");
    setState({ draggingId: session.taskId, offsets: new Map(), indicator: null });
    session.frame = window.requestAnimationFrame(() => tick(session));
  }, [boardRef]);

  /** Recompute the drop target from the last pointer position and animate the board towards it. */
  const tick = useCallback((session: Session) => {
    const board = boardRef.current;
    if (sessionRef.current !== session || !session.armed || board === null) return;
    if (session.geometry === null || session.origin === null) return;
    const point = pointInBoard(board, session.x, session.y);
    const target = dropTargetAt(session.geometry, point, session.taskId);

    if (session.ghost !== null) {
      session.ghost.style.transform = `translate(${session.x - session.grabX}px, ${session.y - session.grabY}px)`;
    }
    if (target !== null) scrollToward(session.x, session.y, board);

    const unchanged = target === null
      ? session.target === null
      : session.target !== null && session.target.status === target.status && session.target.index === target.index;
    if (!unchanged) {
      session.target = target;
      setState(target === null
        ? { draggingId: session.taskId, offsets: new Map(), indicator: null }
        : {
            draggingId: session.taskId,
            offsets: cardOffsets(session.origin, target, session.taskId),
            indicator: { status: target.status, y: indicatorOffset(session.geometry, target) ?? 0 },
          });
    }
    session.frame = window.requestAnimationFrame(() => tick(session));
  }, [boardRef]);

  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      const session = sessionRef.current;
      if (session === null || event.pointerId !== session.pointerId) return;
      session.x = event.clientX;
      session.y = event.clientY;
      if (session.armed) return; // the frame loop already reads the latest position
      const travel = Math.hypot(event.clientX - session.startX, event.clientY - session.startY);
      if (session.pointerType === "touch") {
        // Moved before the long press completed: this is a scroll, hand the gesture back.
        if (travel > TOUCH_SLOP) cancel();
        return;
      }
      if (travel >= MOUSE_THRESHOLD) lift(session);
    }
    function onPointerUp(event: PointerEvent) {
      const session = sessionRef.current;
      if (session === null || event.pointerId !== session.pointerId) return;
      if (session.armed && session.target !== null) {
        onDropRef.current(session.taskId, session.target);
        suppressNextClick();
      }
      cancel();
    }
    function onTouchMove(event: TouchEvent) {
      // Only while a drag is live: a finger drag must not also scroll the page underneath.
      if (sessionRef.current?.armed === true) event.preventDefault();
    }
    function onEscape(event: KeyboardEvent) {
      if (event.key === "Escape") cancel();
    }
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    document.documentElement.addEventListener("mouseleave", cancel);
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("keydown", onEscape);
    return () => {
      cancel();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      document.documentElement.removeEventListener("mouseleave", cancel);
      document.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("keydown", onEscape);
    };
  }, [cancel, lift]);

  const onCardPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>, taskId: number) => {
    if (!enabled) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    cancel(); // self-heal a session whose release never arrived
    const session: Session = {
      taskId,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      grabX: event.clientX,
      grabY: event.clientY,
      card: event.currentTarget,
      armed: false,
      origin: null,
      geometry: null,
      target: null,
      ghost: null,
      longPress: 0,
      frame: 0,
    };
    sessionRef.current = session;
    if (event.pointerType === "touch") {
      session.longPress = window.setTimeout(() => {
        if (sessionRef.current === session) lift(session);
      }, TOUCH_LONG_PRESS_MS);
    }
  }, [cancel, enabled, lift]);

  return { state, onCardPointerDown };
}

interface Session {
  taskId: number;
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  /** Latest pointer position, in client coordinates. */
  x: number;
  y: number;
  /** Where inside the card it was grabbed, so the ghost does not jump under the cursor. */
  grabX: number;
  grabY: number;
  card: HTMLElement;
  armed: boolean;
  /** Board as captured at lift, lifted card included. */
  origin: BoardGeometry | null;
  /** The same board with the lifted card removed — what the user sees mid-drag. */
  geometry: BoardGeometry | null;
  target: DropTarget | null;
  ghost: HTMLElement | null;
  longPress: number;
  frame: number;
}

/** Scroll the page (or the board sideways) when the pointer is held near an edge. */
function scrollToward(x: number, y: number, board: HTMLElement): void {
  const viewport = window.innerHeight;
  if (y < SCROLL_EDGE) window.scrollBy(0, -Math.ceil((SCROLL_EDGE - y) / 5));
  else if (y > viewport - SCROLL_EDGE) window.scrollBy(0, Math.ceil((y - (viewport - SCROLL_EDGE)) / 5));

  if (board.scrollWidth <= board.clientWidth) return;
  const rect = board.getBoundingClientRect();
  if (x < rect.left + SCROLL_EDGE) board.scrollLeft -= Math.ceil((rect.left + SCROLL_EDGE - x) / 5);
  else if (x > rect.right - SCROLL_EDGE) board.scrollLeft += Math.ceil((x - (rect.right - SCROLL_EDGE)) / 5);
}

/** Swallow the click that follows a real drop, so a moved card doesn't open its detail page. */
function suppressNextClick(): void {
  window.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
  }, { capture: true, once: true });
}
