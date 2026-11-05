import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { reservedTagPublicIds, type CreateTaskInput, type KanbanStatus, type Tag, type TaskDetail, type TaskSummary } from "@mind-palace/shared";
import { api } from "./api";
import { CreateTaskPanel } from "./components/CreateTaskPanel";
import { TaskCard } from "./components/TaskCard";
import { TagHierarchyPanel } from "./components/TagHierarchy";
import { TagPicker } from "./components/TagPicker";
import { reorderTasks, type DropTarget } from "./lib/boardDrag";
import { useKanbanDrag } from "./lib/useKanbanDrag";
import { readTagFilterPreferences, writeTagFilterPreferences } from "./tagFilterPreferences";

const columns: Array<{ status: KanbanStatus; label: string }> = [
  { status: "inbox", label: "Inbox" },
  { status: "ready", label: "Ready" },
  { status: "in_progress", label: "In progress" },
  { status: "waiting", label: "Waiting" },
];

/** One archived task: the card plus the one action that matters here — rescue it. */
function ArchivedTaskRow({ task, allTags, onUnarchive }: { task: TaskSummary; allTags: Tag[]; onUnarchive: () => void }) {
  return (
    <div className="archived-row">
      <TaskCard task={task} allTags={allTags} />
      <div className="archived-row-actions">
        {task.autoArchiveAt && (
          <span className="muted">
            decayed {new Date(task.autoArchiveAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </span>
        )}
        <button onClick={onUnarchive}>Unarchive</button>
      </div>
    </div>
  );
}

export function DashboardPage() {
  // "Set blocking tasks" on a task page lands here in multi-select mode: router state carries
  // the target task id, its card is highlighted, and its current blockers start pre-selected
  // so the board doubles as a full view of what blocks it. Save replaces the set; Cancel
  // heads back to the task page. Without the state flag this is the plain dashboard.
  const navigate = useNavigate();
  const location = useLocation();
  const dependencyTargetId = (location.state as { selectingDependenciesFor?: number } | null)?.selectingDependenciesFor;

  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [includedTagIds, setIncludedTagIds] = useState<number[]>(() => readTagFilterPreferences().includedTagIds);
  const [excludedTagIds, setExcludedTagIds] = useState<number[]>(() => readTagFilterPreferences().excludedTagIds);
  // Card clicks select instead of navigating only while picking the blockers for another task.
  const selecting = dependencyTargetId !== undefined;
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dependencyTarget, setDependencyTarget] = useState<TaskDetail | null>(null);

  // Pre-select the blockers (and remember the target task for the hint) once we know which
  // task we are blocking for; switching back to a plain dashboard resets that state.
  useEffect(() => {
    if (dependencyTargetId === undefined) {
      setDependencyTarget(null);
      setSelectedIds([]);
      return;
    }
    let cancelled = false;
    void api.task(dependencyTargetId)
      .then((task) => {
        if (cancelled) return;
        setDependencyTarget(task);
        setSelectedIds(task.dependsOn.map((dependsOn) => dependsOn.id));
      })
      .catch((targetError) => {
        if (cancelled) return;
        setError(targetError instanceof Error ? targetError.message : String(targetError));
      });
    return () => { cancelled = true; };
  }, [dependencyTargetId]);

  // Dragging lives in useKanbanDrag: it snapshots the board's geometry once per gesture and moves
  // cards with transforms, so opening the drop gap can never reflow what the hit test measures.
  const boardRef = useRef<HTMLDivElement | null>(null);
  const drag = useKanbanDrag({ boardRef, onDrop: dropTask, enabled: !selecting });

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

  // Included acts as a whitelist; excluded is resolved afterwards, so a tag on both lists hides its tasks.
  const visible = tasks.filter((task) => {
    const taskTagIds = new Set([...task.tags, ...task.derivedTags].map((tag) => tag.id));
    if (includedTagIds.length > 0 && !includedTagIds.some((id) => taskTagIds.has(id))) return false;
    return !excludedTagIds.some((id) => taskTagIds.has(id));
  });
  const active = visible.filter(
    (task) => !["completed", "cancelled"].includes(task.kanbanStatus) && task.lifecycleStatus !== "archived",
  );
  // The two drawers below the board are disjoint: a task lives in exactly one of them, so archiving
  // a completed task moves it rather than showing it twice.
  const completed = visible
    .filter((task) => task.kanbanStatus === "completed" && task.lifecycleStatus !== "archived")
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
  // Decayed tasks: still open in the kanban sense, but out of the way. Sorted by the instant they
  // decayed, so the newest arrivals — the ones most likely to be rescued — come first.
  const archived = visible
    .filter((task) => task.lifecycleStatus === "archived")
    .sort((a, b) => (b.autoArchiveAt ?? "").localeCompare(a.autoArchiveAt ?? ""));
  // Calendar-event tasks are fixed commitments: their whole window lives in an accepted block.
  const scheduled = tasks.filter((task) =>
    [...task.tags, ...task.derivedTags].some((tag) => tag.publicId === reservedTagPublicIds.calendarEvent),
  ).length;

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

  /** A drop: show it at once, then persist it. The server renumbers the column in one transaction. */
  async function dropTask(taskId: number, target: DropTarget) {
    setTasks((current) => reorderTasks(current, taskId, target));
    try {
      await api.moveTask(taskId, { kanbanStatus: target.status, index: target.index });
    } catch (moveError) {
      setError(moveError instanceof Error ? moveError.message : String(moveError));
    }
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

  // ---- Multi-select (used to pick the tasks that block another task) ----

  function toggleSelection(taskId: number) {
    // Selecting the task itself would close a dependency cycle, so its card is inert here.
    if (taskId === dependencyTargetId) return;
    setSelectedIds((current) => current.includes(taskId)
      ? current.filter((id) => id !== taskId)
      : [...current, taskId]);
  }

  function cancelSelection() {
    setSelectedIds([]);
    if (dependencyTargetId !== undefined) navigate(`/tasks/${dependencyTargetId}`);
  }

  async function saveBlockingTasks() {
    if (dependencyTargetId === undefined) return;
    try {
      await api.updateTask(dependencyTargetId, {
        dependsOnTaskIds: selectedIds.filter((id) => id !== dependencyTargetId),
      });
      navigate(`/tasks/${dependencyTargetId}`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }

  async function unarchive(task: TaskSummary) {
    try {
      await api.unarchiveTask(task.id);
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }

  return (
    <main className="dashboard-shell">
      <header className="masthead">
        <div className="tag-filter">
          <label>Included tags<TagPicker tags={tags} selectedIds={includedTagIds} onChange={setIncludedTagIds} placeholder="Type to filter in" /></label>
          <label>Excluded tags<TagPicker tags={tags} selectedIds={excludedTagIds} onChange={setExcludedTagIds} placeholder="Type to filter out" /></label>
        </div>
        <div className="masthead-actions">
          <div className="masthead-stats">
            <span><strong>{active.length}</strong> open tasks</span>
            <span><strong>{scheduled}</strong> fixed events</span>
          </div>
          {selecting && (
            <div className="button-row">
              <button className="primary-button" onClick={() => void saveBlockingTasks()}>
                Save {selectedIds.length === 0 ? "blocking tasks" : `${selectedIds.length} blocking task${selectedIds.length === 1 ? "" : "s"}`}
              </button>
              <button onClick={cancelSelection}>Cancel</button>
            </div>
          )}
        </div>
      </header>
      {selecting && (
        <p className="selection-hint muted">
          {dependencyTarget
            ? `Selecting tasks that block “${dependencyTarget.title}” — click task cards to toggle them, then Save.`
            : "Selecting tasks that block this task — click task cards to toggle them, then Save."}
        </p>
      )}
      {error && <div className="error-banner">{error}</div>}
      <div className="mind-layout">
        <section className="kanban-board" ref={boardRef}>
          {columns.map((column) => {
            const items = active.filter((task) => task.kanbanStatus === column.status).sort((a, b) => b.rank - a.rank);
            return (
              <div className="kanban-column" key={column.status} data-status={column.status}>
                <div className="kanban-heading"><h2>{column.label}</h2><span>{items.length}</span></div>
                {/* Cards slide by transform and the drop line is absolutely positioned, so showing
                    a drop never reflows the stack (that reflow is what made targets flicker). */}
                <div className={`kanban-stack${drag.state.draggingId === null ? "" : " dragging"}`}>
                  {items.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      allTags={tags}
                      dragging={drag.state.draggingId === task.id}
                      offsetY={drag.state.offsets.get(task.id) ?? 0}
                      selected={selecting && selectedIds.includes(task.id)}
                      highlighted={selecting && dependencyTargetId === task.id}
                      highlightLabel="this task"
                      {...(selecting ? { onCardClick: () => toggleSelection(task.id) } : {})}
                      onPointerDown={(event) => drag.onCardPointerDown(event, task.id)}
                      checked={task.kanbanStatus === "completed"}
                      onToggleComplete={() => void toggleComplete(task)}
                    />
                  ))}
                  {items.length === 0 && <div className="column-empty">Drop tasks here</div>}
                  {drag.state.indicator?.status === column.status && (
                    <div className="drop-line" style={{ top: drag.state.indicator.y }} />
                  )}
                </div>
              </div>
            );
          })}
        </section>

        <details className="completed-tasks">
          <summary>Completed ({completed.length})</summary>
          {completed.length === 0
            ? <p className="muted">No completed tasks.</p>
            : (
              <div className="completed-list">
                {completed.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    allTags={tags}
                    checked
                    onToggleComplete={() => void toggleComplete(task)}
                  />
                ))}
              </div>
            )}
        </details>
        <details className="completed-tasks">
          <summary>Archived ({archived.length})</summary>
          {archived.length === 0
            ? <p className="muted">Nothing archived. Tasks decay out of the board a month after they were created.</p>
            : (
              <div className="completed-list">
                {archived.map((task) => (
                  <ArchivedTaskRow
                    key={task.id}
                    task={task}
                    allTags={tags}
                    onUnarchive={() => void unarchive(task)}
                  />
                ))}
              </div>
            )}
        </details>
        <aside className="dashboard-sidebar"><CreateTaskPanel tags={tags} onCreateTask={createTask} onCreateTag={createTag} /><TagHierarchyPanel tags={tags} /></aside>
      </div>
    </main>
  );
}
