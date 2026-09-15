import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { reservedTagPublicIds, type CreateTaskInput, type KanbanStatus, type Tag, type TaskSummary } from "@mind-palace/shared";
import { api } from "./api";
import { CreateTaskPanel } from "./components/CreateTaskPanel";
import { TaskCard } from "./components/TaskCard";
import { TagHierarchy } from "./components/TagHierarchy";
import { TagPicker } from "./components/TagPicker";

const columns: Array<{ status: KanbanStatus; label: string }> = [
  { status: "inbox", label: "Inbox" },
  { status: "ready", label: "Ready" },
  { status: "in_progress", label: "In progress" },
  { status: "waiting", label: "Waiting" },
  { status: "in_review", label: "Review" },
];

export function DashboardPage() {
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [includedTagIds, setIncludedTagIds] = useState<number[]>([]);
  const [excludedTagIds, setExcludedTagIds] = useState<number[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

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
    navigate(`/tasks/${task.id}`);
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
              <div
                className="kanban-column"
                key={column.status}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => void moveTask(Number(event.dataTransfer.getData("taskId")), column.status)}
              >
                <div className="kanban-heading"><h2>{column.label}</h2><span>{items.length}</span></div>
                <div className="kanban-stack">
                  {items.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      draggable={!selecting}
                      selected={selecting && selectedIds.includes(task.id)}
                      {...(selecting ? { onCardClick: () => toggleSelection(task.id) } : {})}
                      onDragStart={(event) => event.dataTransfer.setData("taskId", String(task.id))}
                      onDrop={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void moveTask(Number(event.dataTransfer.getData("taskId")), column.status, task.id);
                      }}
                    />
                  ))}
                  {items.length === 0 && <div className="column-empty">Drop tasks here</div>}
                </div>
              </div>
            );
          })}
        </section>
        <details className="completed-tasks"><summary>Completed ({completed.length})</summary>{completed.length === 0 ? <p className="muted">No completed tasks.</p> : <div className="completed-list">{completed.map((task) => <TaskCard key={task.id} task={task} />)}</div>}</details>
        <aside className="dashboard-sidebar"><CreateTaskPanel tags={tags} onCreateTask={createTask} onCreateTag={createTag} /><TagHierarchy tags={tags} /></aside>
      </div>
    </main>
  );
}
