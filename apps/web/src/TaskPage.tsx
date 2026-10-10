import type { Tag, TaskDetail, TaskSummary } from "@mind-palace/shared";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "./api";
import { useCrumbTitle } from "./components/Breadcrumbs";
import { TagRow } from "./components/TagRow";
import { TaskBreadcrumbs } from "./components/TaskBreadcrumbs";
import { TaskEditor } from "./components/TaskEditor";

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString();
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
 * Dashboard via the "Set blocking tasks" button (multi-select, like "Add to this week"); a
 * dependency is not a hard gate — manual completion never ripples — but the scheduler
 * orders prerequisites first.
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
            <strong>{formatDateTime(block.startAt)}</strong>
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
    // Pick blocking tasks on the Dashboard (multi-select, like "Add to this week").
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
          <button onClick={() => void action(() => api.setLifecycle(id, "archived"))}>Archive</button>
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
          <DependencySection task={task} onRemoveDependency={(dependentId, prerequisiteId) => void removeDependency(dependentId, prerequisiteId)} />
        </div>
        <div className="detail-sidebar">
          <PlanningSection task={task} />
        </div>
      </div>
    </main>
  );
}