import type { RecurrenceRule, Tag, TaskDetail, TaskSummary, UpsertRecurrenceInput } from "@mind-palace/shared";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "./api";
import { useCrumbTitle } from "./components/Breadcrumbs";
import { formatClock } from "./lib/health";
import { TagRow } from "./components/TagRow";
import { TaskBreadcrumbs } from "./components/TaskBreadcrumbs";
import { TaskEditor } from "./components/TaskEditor";

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString();
}

/** "Mon, Oct 12, 2026 · 3:00 PM – 9:00 PM", or both dates when the block spans midnight. */
function formatBlockRange(startAt: string, endAt: string): string {
  const start = new Date(startAt);
  const end = new Date(endAt);
  const dayOptions: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric", year: "numeric" };
  const startLabel = start.toLocaleDateString(undefined, dayOptions);
  if (start.toLocaleDateString() === end.toLocaleDateString()) {
    return `${startLabel} · ${formatClock(startAt)} – ${formatClock(endAt)}`;
  }
  return `${startLabel} ${formatClock(startAt)} – ${end.toLocaleDateString(undefined, dayOptions)} ${formatClock(endAt)}`;
}

/** Open markdown links in a new tab instead of navigating the SPA away. */
function MarkdownLinks({ children }: { children: string | null | undefined }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}

function PlanningSection({ task }: { task: TaskDetail }) {
  return (
    <section>
      <div className="section-label">Planning</div>
      <strong>Priority {task.priority}</strong>
      {task.durationMinutesRemaining !== null
        ? <span>{task.durationMinutesRemaining} minutes remaining{task.splittable ? ", splittable" : ""}</span>
        : <span>No time estimate</span>}
      {task.deadlineAt && <span>Due {formatDateTime(task.deadlineAt)}</span>}
      {task.autoArchiveAt && (
        <span>
          {task.lifecycleStatus === "archived" ? "Archived" : "Archives"} {formatDateTime(task.autoArchiveAt)}
        </span>
      )}
    </section>
  );
}

function DependencyLink({ task, onRemove }: { task: TaskSummary; onRemove: () => void }) {
  return (
    <li className="dependency-row">
      <Link to={`/tasks/${task.id}`}>
        <span className="dependency-status">{task.kanbanStatus.replace("_", " ")}</span>
        {task.title}
      </Link>
      <button type="button" className="mini-block-delete" onClick={onRemove}>Remove</button>
    </li>
  );
}

/**
 * Read-only display of both dependency directions. Blocking tasks are picked on the
 * Dashboard via the "Set blocking tasks" button; a dependency is not a hard gate — manual
 * completion never ripples — but the scheduler orders prerequisites first.
 */
function DependencySection({ task, onRemoveDependency }: {
  task: TaskDetail;
  onRemoveDependency: (dependentTaskId: number, prerequisiteTaskId: number) => void;
}) {
  return (
    <section>
      <div className="section-label">Dependencies</div>
      {task.dependsOn.length === 0 && task.dependents.length === 0 && (
        <p className="dependency-empty">No dependencies. Set blocking tasks above.</p>
      )}
      {task.dependsOn.length > 0 && (
        <div className="dependency-group">
          <div className="dependency-group-label">Depends on (scheduled first)</div>
          <ul className="dependency-list">
            {task.dependsOn.map((dependsOn) => (
              <DependencyLink key={dependsOn.id} task={dependsOn} onRemove={() => onRemoveDependency(task.id, dependsOn.id)} />
            ))}
          </ul>
        </div>
      )}
      {task.dependents.length > 0 && (
        <div className="dependency-group">
          <div className="dependency-group-label">Depend on this</div>
          <ul className="dependency-list">
            {task.dependents.map((dependent) => (
              <DependencyLink key={dependent.id} task={dependent} onRemove={() => onRemoveDependency(dependent.id, task.id)} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

const WEEKDAY_CHOICES = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

/**
 * The routine editor. A recurrence rule turns this task into a template: the daily job creates one
 * child per scheduled day, copying this task's title, estimate, priority and tags. Editing the
 * template only affects occurrences created afterwards — existing children keep the values they
 * were born with, so re-tagging or re-estimating a template never rewrites history.
 */
function RecurrenceSection({ task, onSave }: {
  task: TaskDetail;
  onSave: (input: UpsertRecurrenceInput) => Promise<void>;
}) {
  const rule = task.recurrence;
  const [frequency, setFrequency] = useState<RecurrenceRule["frequency"]>(rule?.frequency ?? "daily");
  const [intervalCount, setIntervalCount] = useState(String(rule?.intervalCount ?? 1));
  const [weekdays, setWeekdays] = useState<number[]>(rule?.weekdays ?? []);
  const [autoArchiveHour, setAutoArchiveHour] = useState(rule?.autoArchiveHour === null || rule === null ? "" : String(rule.autoArchiveHour));
  const [nextOccurrenceDate, setNextOccurrenceDate] = useState(rule?.nextOccurrenceDate ?? new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await onSave({
        frequency,
        intervalCount: Number(intervalCount) || 1,
        weekdays,
        autoArchiveHour: autoArchiveHour === "" ? null : Number(autoArchiveHour),
        nextOccurrenceDate,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="detail-section" onSubmit={submit}>
      <div className="section-label">Routine</div>
      {rule === null
        ? <p className="muted">Not a routine. Set a schedule below and this task becomes the template for recurring occurrences.</p>
        : <p className="muted">
            Creates a child task {rule.frequency === "daily" ? `every ${rule.intervalCount === 1 ? "day" : `${rule.intervalCount} days`}` : `every ${rule.intervalCount === 1 ? "week" : `${rule.intervalCount} weeks`}`}.
            Changing these values affects occurrences created from tomorrow on; the ones already on the board keep their own values.
          </p>}
      <div className="form-pair">
        <label>Repeats<select value={frequency} onChange={(event) => setFrequency(event.target.value as typeof frequency)}>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
        </select></label>
        <label>{frequency === "daily" ? "Every N days" : "Every N weeks"}
          <input type="number" min="1" value={intervalCount} onChange={(event) => setIntervalCount(event.target.value)} />
        </label>
      </div>
      {frequency === "weekly" && (
        <label>On these days
          <span className="weekday-choices">
            {WEEKDAY_CHOICES.map((choice) => (
              <label key={choice.value} className="checkbox-field">
                <input
                  type="checkbox"
                  checked={weekdays.includes(choice.value)}
                  onChange={(event) => setWeekdays((current) => event.target.checked
                    ? [...current, choice.value]
                    : current.filter((day) => day !== choice.value))}
                />
                <span>{choice.label}</span>
              </label>
            ))}
          </span>
        </label>
      )}
      <div className="form-pair">
        <label>First occurrence<input type="date" value={nextOccurrenceDate} onChange={(event) => setNextOccurrenceDate(event.target.value)} /></label>
        <label>Vanishes at (hour)
          <input type="number" min="0" max="23" placeholder="End of day" value={autoArchiveHour} onChange={(event) => setAutoArchiveHour(event.target.value)} />
        </label>
      </div>
      <p className="form-hint muted">
        Occurrences that go unticked vanish on their own, so a missed routine does not pile up. Set
        the hour to end a routine with its day (10 for “wake up”); leave it blank to keep the whole day.
      </p>
      <div className="button-row"><button className="primary-button" disabled={busy}>{busy ? "Saving..." : rule === null ? "Make this a routine" : "Save routine"}</button></div>
    </form>
  );
}

function TimeBlockSection({ task, onAcceptSchedule, onDeleteBlock }: {
  task: TaskDetail;
  onAcceptSchedule: () => void;
  onDeleteBlock: (blockId: number) => void;
}) {
  const visible = task.timeBlocks.filter((block) => block.status !== "superseded");
  if (visible.length === 0) return null;
  return (
    <section>
      <div className="section-label">Time blocks</div>
      {visible.map((block) => (
        <div className="mini-block" key={block.id}>
          <Link className="mini-block-link" to={`/time-blocks/${block.id}`}>
            <strong>{formatBlockRange(block.startAt, block.endAt)}</strong>
            <span>{block.type === "calendar_event" ? "calendar event · " : ""}{block.status}</span>
          </Link>
          <button type="button" className="mini-block-delete" onClick={() => onDeleteBlock(block.id)}>Delete block</button>
        </div>
      ))}
      {task.timeBlocks.some((block) => block.status === "proposed") && (
        <button onClick={onAcceptSchedule}>Accept schedule</button>
      )}
    </section>
  );
}

export function TaskPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  async function load() {
    try {
      const [nextTask, nextTags] = await Promise.all([
        api.task(id),
        api.tags(),
      ]);
      setTask(nextTask);
      setTags(nextTags);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }

  // Name this page's crumb once its title is known (also refreshes it when the task is renamed).
  const registerCrumbTitle = useCrumbTitle();
  useEffect(() => {
    if (task) registerCrumbTitle(`/tasks/${id}`, task.title);
  }, [task, id, registerCrumbTitle]);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), 2000);
    return () => window.clearInterval(interval);
  }, [id]);

  async function action(operation: () => Promise<TaskDetail>) {
    try {
      setTask(await operation());
      setError(null);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    }
  }

  async function acceptSchedule() {
    await action(() => api.acceptTaskSchedule(task!.id).then(() => api.task(id)));
  }

  async function deleteBlock(blockId: number) {
    await action(() => api.deleteTimeBlock(blockId).then(() => api.task(id)));
  }

  async function removeDependency(dependentTaskId: number, prerequisiteTaskId: number) {
    await action(() => api.removeTaskDependency(dependentTaskId, prerequisiteTaskId).then(() => api.task(id)));
  }

  function setBlockingTasks() {
    // Pick blocking tasks on the Dashboard (multi-select mode).
    navigate("/", { state: { selectingDependenciesFor: id } });
  }

  async function convertToTag() {
    try {
      const tag = await api.convertTaskToTag(id);
      setError(null);
      navigate(`/tags/${tag.id}`);
    } catch (convertError) {
      setError(convertError instanceof Error ? convertError.message : String(convertError));
    }
  }

  if (!task) {
    return <main className="detail-shell">{error ? <div className="error-banner">{error}</div> : <p>Loading...</p>}</main>;
  }

  return (
    <main className="detail-shell">
      {error && <div className="error-banner">{error}</div>}
      <header className="detail-header">
        <div>
          <div className="task-card-topline">
            <span className="task-type">{task.kanbanStatus.replace("_", " ")}</span>
            <span className="detail-public-id">{task.publicId.slice(0, 8)}</span>
          </div>
          <h1>{task.title}</h1>
          <TagRow tags={task.tags} links />
          <TaskBreadcrumbs task={task} allTags={tags} />
        </div>
        <div className="detail-actions">
          <button onClick={() => setEditing((current) => !current)}>
            {editing ? "Close editor" : "Edit task"}
          </button>
          <button onClick={() => setBlockingTasks()}>Set blocking tasks</button>
          <button onClick={() => void convertToTag()}>Convert to tag</button>
          {task.kanbanStatus !== "completed" && (
            <button className="primary-button" onClick={() => void action(() => api.updateTask(id, { kanbanStatus: "completed" }))}>
              Mark completed
            </button>
          )}
          {task.lifecycleStatus === "archived"
            ? <button className="primary-button" onClick={() => void action(() => api.unarchiveTask(id))}>Unarchive</button>
            : <button onClick={() => void action(() => api.setLifecycle(id, "archived"))}>Archive</button>}
        </div>
      </header>

      {editing && (
        <TaskEditor
          task={task}
          tags={tags}
          onCancel={() => setEditing(false)}
          onSave={async (input) => {
            await action(() => api.updateTask(id, input));
            setEditing(false);
          }}
        />
      )}

      <div className="detail-grid">
        <div className="detail-main">
          {task.description && (
            <section className="detail-section markdown-description">
              <MarkdownLinks>{task.description}</MarkdownLinks>
            </section>
          )}
          <TimeBlockSection task={task} onAcceptSchedule={() => void acceptSchedule()} onDeleteBlock={(blockId) => void deleteBlock(blockId)} />
          <RecurrenceSection task={task} onSave={async (input) => { await action(() => api.upsertRecurrence(id, input).then(() => api.task(id))); }} />
          <DependencySection task={task} onRemoveDependency={(dependentId, prerequisiteId) => void removeDependency(dependentId, prerequisiteId)} />
        </div>
        <div className="detail-sidebar">
          <PlanningSection task={task} />
        </div>
      </div>
    </main>
  );
}