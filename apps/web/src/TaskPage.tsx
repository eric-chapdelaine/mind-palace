import type { Tag, TaskDetail } from "@mind-palace/shared";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "./api";
import { TagRow } from "./components/TagRow";
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

  if (!task) {
    return <main className="detail-shell"><Link to="/">Back</Link>{error ? <div className="error-banner">{error}</div> : <p>Loading...</p>}</main>;
  }

  return (
    <main className="detail-shell">
      <nav className="detail-nav">
        <Link to="/">Back to board</Link>
        <span>{task.publicId.slice(0, 8)}</span>
      </nav>
      {error && <div className="error-banner">{error}</div>}
      <header className="detail-header">
        <div>
          <div className="task-card-topline">
            <span className="task-type">{task.kanbanStatus.replace("_", " ")}</span>
          </div>
          <h1>{task.title}</h1>
          {task.description && (
            <div className="markdown-description">
              <MarkdownLinks>{task.description}</MarkdownLinks>
            </div>
          )}
          <TagRow tags={task.tags} links />
          <TagRow tags={task.derivedTags} derived links />
        </div>
        <div className="detail-actions">
          <button onClick={() => setEditing((current) => !current)}>
            {editing ? "Close editor" : "Edit task"}
          </button>
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

      <div className="detail-stack">
        <PlanningSection task={task} />
        <TimeBlockSection task={task} onAcceptSchedule={() => void acceptSchedule()} onDeleteBlock={(blockId) => void deleteBlock(blockId)} />
      </div>
    </main>
  );
}