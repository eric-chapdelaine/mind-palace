import { Fragment, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Link } from "react-router-dom";
import { reservedTagPublicIds, type CreateTaskInput, type KanbanStatus, type Tag, type TaskSummary } from "@mind-palace/shared";
import { api } from "./api";
import { CreateTaskPanel } from "./components/CreateTaskPanel";
import { TaskCard } from "./components/TaskCard";
import { TagHierarchy } from "./components/TagHierarchy";
import { TagPicker } from "./components/TagPicker";
import { readTagFilterPreferences, writeTagFilterPreferences } from "./tagFilterPreferences";

const columns: Array<{ status: KanbanStatus; label: string }> = [
  { status: "inbox", label: "Inbox" },
  { status: "ready", label: "Ready" },
  { status: "in_progress", label: "In progress" },
  { status: "waiting", label: "Waiting" },
];

export function DashboardPage() {
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [includedTagIds, setIncludedTagIds] = useState<number[]>(() => readTagFilterPreferences().includedTagIds);
  const [excludedTagIds, setExcludedTagIds] = useState<number[]>(() => readTagFilterPreferences().excludedTagIds);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Kanban drag state: which card is being dragged (its spot shows a dotted placeholder), its
  // measured height (so the placeholder matches), and where a drop would land (the hint line).
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [draggingHeight, setDraggingHeight] = useState(0);
  const [dropHint, setDropHint] = useState<{ status: KanbanStatus; beforeTaskId: number | null } | null>(null);

  // Custom pointer-driven drag instead of native HTML5 DnD: Firefox ignores setDragImage and
  // cancels a drag when its source element leaves the DOM (the placeholder swap), which left the
  // board stuck and ghost-less there. Mutable drag session lives in refs so the window listeners
  // always see fresh data and cleanup is reliable on every mouse-up.
  const dragSessionRef = useRef<{
    taskId: number;
    startX: number;
    startY: number;
    started: boolean;
    cardEl: HTMLAnchorElement;
    ghost: HTMLElement | null;
  } | null>(null);
  const dropHintRef = useRef<{ status: KanbanStatus; beforeTaskId: number | null } | null>(null);
  const moveTaskRef = useRef(moveTask);
  moveTaskRef.current = moveTask; // keep the latest closure (fresh tasks/active) available to listeners

  async function load() {
    try {
      const [nextTasks, nextTags] = await Promise.all([api.tasks(), api.tags()]);
      setTasks(nextTasks);
      setTags(nextTags);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(interval);
  }, []);

  // Persist the tag filter to cookies on every change so it survives browser sessions.
  useEffect(() => {
    writeTagFilterPreferences(includedTagIds, excludedTagIds);
  }, [includedTagIds, excludedTagIds]);

  // Always-on window listeners gate on the active drag session, so re-renders never lose them.
  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      if (dragSessionRef.current) handleDragMove(event);
    }
    function onPointerUp() {
      if (dragSessionRef.current) handleDragEnd();
    }
    function onPointerCancel() {
      if (dragSessionRef.current) abortDrag();
    }
    function onWindowBlur() {
      if (dragSessionRef.current) abortDrag();
    }
    function onMouseLeaveViewport() {
      // Release outside the window never delivers pointerup; cancel so nothing is left behind.
      if (dragSessionRef.current) abortDrag();
    }
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("blur", onWindowBlur);
    document.documentElement.addEventListener("mouseleave", onMouseLeaveViewport);
    return () => {
      abortDrag();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("blur", onWindowBlur);
      document.documentElement.removeEventListener("mouseleave", onMouseLeaveViewport);
    };
  }, []);

  // Included acts as a whitelist; excluded is resolved afterwards, so a tag on both lists hides its tasks.
  const visible = tasks.filter((task) => {
    const taskTagIds = new Set([...task.tags, ...task.derivedTags].map((tag) => tag.id));
    if (includedTagIds.length > 0 && !includedTagIds.some((id) => taskTagIds.has(id))) return false;
    return !excludedTagIds.some((id) => taskTagIds.has(id));
  });
  const active = visible.filter((task) => !["completed", "cancelled"].includes(task.kanbanStatus));
  const completed = visible
    .filter((task) => task.kanbanStatus === "completed")
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
  const scheduled = tasks.filter((task) => task.fixedStart || task.fixedEnd).length;

  async function createTask(input: CreateTaskInput) {
    const task = await api.createTask(input);
    // Immediately show the new task at the top of the Inbox column (rank = Date.now() sorts it first); the poll will reconcile server order.
    setTasks((current) => [task, ...current]);
  }

  async function createTag(title: string) {
    const tag = await api.createTag({ title });
    setTags((current) => [...current, tag].sort((a, b) => a.title.localeCompare(b.title)));
    return tag;
  }

  async function moveTask(taskId: number, status: KanbanStatus, beforeTaskId?: number) {
    const destination = active
      .filter((task) => task.kanbanStatus === status && task.id !== taskId)
      .sort((a, b) => b.rank - a.rank);
    const beforeIndex = beforeTaskId ? destination.findIndex((task) => task.id === beforeTaskId) : -1;
    destination.splice(beforeIndex < 0 ? destination.length : beforeIndex, 0, tasks.find((task) => task.id === taskId)!);
    await Promise.all(destination.map((task, index) => api.updateTask(task.id, {
      kanbanStatus: task.id === taskId ? status : task.kanbanStatus,
      rank: destination.length - index,
    })));
    await load();
  }

  async function toggleComplete(task: TaskSummary) {
    try {
      await api.updateTask(task.id, { kanbanStatus: task.kanbanStatus === "completed" ? "inbox" : "completed" });
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }

  // ---- Kanban drag & drop (custom pointer-driven; see the drag-session notes above) ----

  const DRAG_START_DISTANCE = 8; // px of pointer movement before a press becomes a drag

  function beginCardPointerDown(event: ReactPointerEvent<HTMLAnchorElement>, taskId: number) {
    if (selecting || event.button !== 0) return;
    abortDrag(); // self-heal any stale session (e.g. previous drag released outside the window)
    dragSessionRef.current = {
      taskId,
      startX: event.clientX,
      startY: event.clientY,
      started: false,
      cardEl: event.currentTarget,
      ghost: null,
    };
  }

  function setHint(hint: { status: KanbanStatus; beforeTaskId: number | null } | null) {
    dropHintRef.current = hint;
    setDropHint(hint);
  }

  function handleDragMove(event: PointerEvent) {
    const session = dragSessionRef.current;
    if (!session) return;
    if (!session.started) {
      if (Math.hypot(event.clientX - session.startX, event.clientY - session.startY) < DRAG_START_DISTANCE) return;
      // Activate the drag: lift a fixed-position clone of the card that follows the cursor.
      const rect = session.cardEl.getBoundingClientRect();
      const ghost = session.cardEl.cloneNode(true) as HTMLElement;
      ghost.className = `${ghost.className} task-card-drag-ghost`;
      ghost.style.position = "fixed";
      ghost.style.left = `${rect.left}px`;
      ghost.style.top = `${rect.top}px`;
      ghost.style.width = `${rect.width}px`;
      ghost.style.outline = "none";
      ghost.style.transition = "none";
      ghost.style.pointerEvents = "none";
      document.body.appendChild(ghost);
      session.ghost = ghost;
      session.started = true;
      document.body.classList.add("dragging");
      setDraggingId(session.taskId);
      setDraggingHeight(rect.height);
      setHint(null);
      return;
    }
    if (session.ghost) {
      session.ghost.style.transform = `translate(${event.clientX - session.startX}px, ${event.clientY - session.startY}px)`;
    }
    setHint(dropTargetAt(event.clientX, event.clientY, session.taskId));
  }

  function handleDragEnd() {
    const session = dragSessionRef.current;
    if (session?.started) {
      const hint = dropHintRef.current;
      if (hint) {
        void moveTaskRef.current(session.taskId, hint.status, hint.beforeTaskId ?? undefined);
        // Swallow the click that follows a real drop, so a moved card doesn't navigate to its
        // detail page. Deliberately gated on the drop itself, not on "a drag started": a firm
        // trackpad press can drift a few px past the drag threshold without intending to drag,
        // and swallowing that click is what forced double-clicking to open a task on macOS.
        suppressNextClick();
      }
    }
    abortDrag();
  }

  function abortDrag() {
    const session = dragSessionRef.current;
    dragSessionRef.current = null;
    session?.ghost?.remove();
    document.body.classList.remove("dragging");
    setHint(null);
    setDraggingId(null);
    setDraggingHeight(0);
  }

  function suppressNextClick() {
    window.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
    }, { capture: true, once: true });
  }

  /** Board position under the pointer, or null when a drop there wouldn't be accepted. */
  function dropTargetAt(x: number, y: number, draggingTaskId: number): { status: KanbanStatus; beforeTaskId: number | null } | null {
    let node: Element | null = document.elementFromPoint(x, y);
    while (node && node !== document.body) {
      if (node instanceof HTMLElement) {
        if (node.classList.contains("kanban-column")) {
          return { status: node.dataset.status as KanbanStatus, beforeTaskId: null };
        }
        if (node.classList.contains("task-card")) {
          const id = Number(node.dataset.taskId);
          if (Number.isInteger(id) && id !== draggingTaskId) {
            const column = node.closest(".kanban-column");
            if (column instanceof HTMLElement) {
              return { status: column.dataset.status as KanbanStatus, beforeTaskId: id };
            }
          }
          return null; // the dragged card itself, or a card we don't recognise: no drop
        }
        // The dotted placeholder where the card was lifted from: dropping there puts it back.
        if (node.classList.contains("task-card-placeholder")) return null;
      }
      node = node.parentElement;
    }
    return null;
  }

  // ---- "Add to this week" multi-select (commits picked tasks to the this-week tag) ----

  const thisWeekTagId = tags.find((tag) => tag.publicId === reservedTagPublicIds.thisWeek)?.id;

  function toggleSelection(taskId: number) {
    setSelectedIds((current) => current.includes(taskId)
      ? current.filter((id) => id !== taskId)
      : [...current, taskId]);
  }

  function cancelSelection() {
    setSelectedIds([]);
    setSelecting(false);
  }

  async function addSelectedToThisWeek() {
    if (thisWeekTagId === undefined) return;
    try {
      await Promise.all(selectedIds.map(async (taskId) => {
        const task = tasks.find((item) => item.id === taskId);
        if (!task) return;
        const tagIds = task.tags.map((tag) => tag.id);
        if (tagIds.includes(thisWeekTagId)) return;
        await api.updateTask(taskId, { tagIds: [...tagIds, thisWeekTagId] });
      }));
      cancelSelection();
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }

  return (
    <main className="dashboard-shell">
      <header className="masthead">
        <div><h1>Mind Palace</h1><p>Tasks and schedules.</p></div>
        <div className="masthead-actions">
          <div className="masthead-stats">
            <div><strong>{active.length}</strong><span>open tasks</span></div>
            <div><strong>{scheduled}</strong><span>fixed events</span></div>
          </div>
          {selecting ? (
            <div className="button-row">
              <button
                className="primary-button"
                disabled={selectedIds.length === 0}
                onClick={() => void addSelectedToThisWeek()}
              >
                Add {selectedIds.length === 0 ? "tasks" : `${selectedIds.length} task${selectedIds.length === 1 ? "" : "s"}`} to this week
              </button>
              <button onClick={cancelSelection}>Cancel</button>
            </div>
          ) : <button className="primary-button" onClick={() => setSelecting(true)}>Add to this week</button>}
        </div>
      </header>
      {selecting && <p className="selection-hint muted">Selecting tasks to schedule this week — click task cards to toggle them.</p>}
      <nav className="view-nav">
        <div className="tag-filter">
          <label>Included tags<TagPicker tags={tags} selectedIds={includedTagIds} onChange={setIncludedTagIds} placeholder="Type to filter in" /></label>
          <label>Excluded tags<TagPicker tags={tags} selectedIds={excludedTagIds} onChange={setExcludedTagIds} placeholder="Type to filter out" /></label>
        </div>
        <Link to="/schedule">Weekly schedule</Link>
      </nav>
      {error && <div className="error-banner">{error}</div>}
      <div className="mind-layout">
        <section className="kanban-board">
          {columns.map((column) => {
            const items = active.filter((task) => task.kanbanStatus === column.status).sort((a, b) => b.rank - a.rank);
            return (
              <div className="kanban-column" key={column.status} data-status={column.status}>
                <div className="kanban-heading"><h2>{column.label}</h2><span>{items.length}</span></div>
                <div className="kanban-stack">
                  {items.map((task) => (
                    <Fragment key={task.id}>
                      {dropHint?.status === column.status && dropHint.beforeTaskId === task.id && <div className="drop-line" />}
                      {draggingId === task.id ? (
                        <div className="task-card-placeholder" style={{ minHeight: draggingHeight || undefined }} />
                      ) : (
                        <TaskCard
                          task={task}
                          selected={selecting && selectedIds.includes(task.id)}
                          {...(selecting ? { onCardClick: () => toggleSelection(task.id) } : {})}
                          onPointerDown={(event) => beginCardPointerDown(event, task.id)}
                          checked={task.kanbanStatus === "completed"}
                          onToggleComplete={() => void toggleComplete(task)}
                        />
                      )}
                    </Fragment>
                  ))}
                  {items.length > 0 && dropHint?.status === column.status && dropHint.beforeTaskId === null && <div className="drop-line" />}
                  {items.length === 0 && <div className="column-empty">Drop tasks here</div>}
                </div>
              </div>
            );
          })}
        </section>
        <details className="completed-tasks"><summary>Completed ({completed.length})</summary>{completed.length === 0 ? <p className="muted">No completed tasks.</p> : <div className="completed-list">{completed.map((task) => <TaskCard key={task.id} task={task} checked onToggleComplete={() => void toggleComplete(task)} />)}</div>}</details>
        <aside className="dashboard-sidebar"><CreateTaskPanel tags={tags} onCreateTask={createTask} onCreateTag={createTag} /><TagHierarchy tags={tags} /></aside>
      </div>
    </main>
  );
}
