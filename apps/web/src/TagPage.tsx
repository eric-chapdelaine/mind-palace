import type { Tag, TaskSummary } from "@mind-palace/shared";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "./api";
import { TagHierarchy } from "./components/TagHierarchy";
import { TagPicker } from "./components/TagPicker";
import { tagPaths } from "./lib/tagTree";

function TagEditor({ tag, tags, onSave, onCancel }: {
  tag: Tag;
  tags: Tag[];
  onSave: (title: string, description: string, parentIds: number[]) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(tag.title);
  const [description, setDescription] = useState(tag.description ?? "");
  const [parentIds, setParentIds] = useState(tag.parentIds);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await onSave(title, description, parentIds);
    } finally {
      setBusy(false);
    }
  }

  return <form className="task-editor detail-section" onSubmit={submit}>
    <div className="editor-heading"><h2>Edit tag details</h2><span>Descriptions support Markdown.</span></div>
    <label>Title<input required value={title} onChange={(event) => setTitle(event.target.value)} /></label>
    <label>Description<textarea rows={6} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
    <label>Parent tags<TagPicker tags={tags} selectedIds={parentIds} onChange={setParentIds} placeholder="Type to add a parent tag" /></label>
    <div className="button-row"><button className="primary-button" disabled={busy}>{busy ? "Saving..." : "Save changes"}</button><button type="button" onClick={onCancel}>Cancel</button></div>
  </form>;
}

function TaggedTaskList({ tasks, derivedTasks, label }: { tasks: TaskSummary[]; derivedTasks: TaskSummary[]; label: string }) {
  const total = tasks.length + derivedTasks.length;
  return (
    <section>
      <div className="section-label">{label} ({total})</div>
      {total === 0 ? <p className="muted">No tasks carry this tag yet.</p> : (
        <ul className="tag-relationship-list">
          {tasks.map((task) => (
            <li key={task.id}>
              <Link to={`/tasks/${task.id}`}>{task.title}</Link>
              <span>{task.kanbanStatus.replace("_", " ")}</span>
            </li>
          ))}
          {derivedTasks.map((task) => (
            <li key={task.id}>
              <Link to={`/tasks/${task.id}`}>{task.title}</Link>
              <span>{task.kanbanStatus.replace("_", " ")} · via child tag</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function TagPage() {
  const id = Number(useParams().id);
  const [tags, setTags] = useState<Tag[]>([]);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  async function load() {
    try {
      const [nextTags, nextTasks] = await Promise.all([api.tags(), api.tasks()]);
      setTags(nextTags);
      setTasks(nextTasks);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(interval);
  }, [id]);

  const tag = tags.find((item) => item.id === id);
  // Breadcrumbs: one root → … → this tag line per ancestor path — a multi-parent tag has
  // several paths, and each gets its own line so both branches are visible at a glance.
  const paths = tag ? tagPaths(tags, tag) : [];
  // A task carries this tag directly (task.tags) or through one of its own tags' parents
  // (task.derivedTags are ancestor tags) — both count as work under the tag.
  const taggedTasks = tasks.filter((task) => task.tags.some((taskTag) => taskTag.id === id));
  const derivedTasks = tasks.filter((task) => task.derivedTags.some((taskTag) => taskTag.id === id));

  async function action(operation: () => Promise<void>) {
    try {
      await operation();
      setError(null);
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : String(operationError));
    }
  }

  async function saveTag(title: string, description: string, parentIds: number[]) {
    await api.updateTag(id, { title, description });
    const removed = tag!.parentIds.filter((parentId) => !parentIds.includes(parentId));
    const added = parentIds.filter((parentId) => !tag!.parentIds.includes(parentId));
    for (const parentId of removed) await api.removeTagParent(id, parentId);
    for (const parentId of added) await api.addTagParent(id, parentId);
    setEditing(false);
    await load();
  }

  async function toggleArchive() {
    await action(async () => {
      await api.updateTag(id, { isArchived: !tag!.isArchived });
    });
  }

  if (tags.length === 0 && !error) {
    return <main className="detail-shell"><Link to="/">Back</Link><p>Loading...</p></main>;
  }
  if (!tag) {
    return <main className="detail-shell"><Link to="/">Back</Link><div className="error-banner">Tag not found.</div></main>;
  }

  return (
    <main className="detail-shell">
      <nav className="detail-nav">
        <Link to="/">Back to board</Link>
        <span>{tag.publicId.slice(0, 8)}</span>
      </nav>
      {error && <div className="error-banner">{error}</div>}
      <header className="detail-header">
        <div>
          <div className="task-card-topline">
            <span className="task-type">{tag.reserved ? "reserved tag" : "tag"}</span>
            {tag.type && <span className="tag-type-badge">{tag.type}</span>}
            {tag.isArchived && <span className="tag-reserved">archived</span>}
          </div>
          <h1>{tag.title}</h1>
          {paths.some((path) => path.length > 1) && (
            <div className="tag-breadcrumbs">
              {paths.slice(0, 3).map((path, index) => (
                <div className="tag-breadcrumb" key={index}>
                  {path.slice(0, -1).map((crumb, crumbIndex) => (
                    <span key={crumb.id}>{crumbIndex > 0 && " › "}<Link to={`/tags/${crumb.id}`}>{crumb.title}</Link></span>
                  ))}
                </div>
              ))}
              {paths.length > 3 && <div className="tag-breadcrumb muted">+{paths.length - 3} more paths</div>}
            </div>
          )}
          {tag.description
            ? <div className="markdown-description"><ReactMarkdown remarkPlugins={[remarkGfm]}>{tag.description}</ReactMarkdown></div>
            : <p className="muted">No description yet — add one with “Edit tag details”.</p>}
        </div>
        <div className="detail-actions">
          <button onClick={() => setEditing((current) => !current)}>
            {editing ? "Close editor" : "Edit tag details"}
          </button>
          <button onClick={() => void toggleArchive()}>
            {tag.isArchived ? "Unarchive tag" : "Archive tag"}
          </button>
        </div>
      </header>

      {editing && (
        <TagEditor
          tag={tag}
          tags={tags}
          onCancel={() => setEditing(false)}
          onSave={(title, description, parentIds) => action(() => saveTag(title, description, parentIds))}
        />
      )}

      <div className="detail-main">
        <section>
          <div className="section-label">Hierarchy</div>
          <TagHierarchy tags={tags} focusId={tag.id} />
        </section>
        <TaggedTaskList tasks={taggedTasks} derivedTasks={derivedTasks} label={tag.type === "goal" ? "Subtasks" : "Tasks tagged"} />
      </div>
    </main>
  );
}