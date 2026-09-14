import type { Tag, TaskSummary } from "@mind-palace/shared";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "./api";
import { TagPicker } from "./components/TagPicker";

function TagEditor({ tag, tags, onSave, onCancel }: {
  tag: Tag;
  tags: Tag[];
  onSave: (description: string, parentIds: number[]) => Promise<void>;
  onCancel: () => void;
}) {
  const [description, setDescription] = useState(tag.description ?? "");
  const [parentIds, setParentIds] = useState(tag.parentIds);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await onSave(description, parentIds);
    } finally {
      setBusy(false);
    }
  }

  return <form className="task-editor detail-section" onSubmit={submit}>
    <div className="editor-heading"><h2>Edit tag details</h2><span>Descriptions support Markdown.</span></div>
    <label>Description<textarea rows={6} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
    <label>Parent tags<TagPicker tags={tags} selectedIds={parentIds} onChange={setParentIds} placeholder="Type to add a parent tag" /></label>
    <div className="button-row"><button className="primary-button" disabled={busy}>{busy ? "Saving..." : "Save changes"}</button><button type="button" onClick={onCancel}>Cancel</button></div>
  </form>;
}

function RelatedTagList({ title, tags, empty }: { title: string; tags: Tag[]; empty: string }) {
  return (
    <section>
      <div className="section-label">{title}</div>
      {tags.length === 0 ? <p className="muted">{empty}</p> : (
        <ul className="tag-relationship-list">
          {tags.map((tag) => (
            <li key={tag.id}>
              <Link to={`/tags/${tag.id}`}>{tag.title}</Link>
              {tag.reserved && <span className="tag-reserved">reserved</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TaggedTaskList({ tasks }: { tasks: TaskSummary[] }) {
  return (
    <section>
      <div className="section-label">Tasks tagged</div>
      {tasks.length === 0 ? <p className="muted">No tasks carry this tag directly.</p> : (
        <ul className="tag-relationship-list">
          {tasks.map((task) => (
            <li key={task.id}>
              <Link to={`/tasks/${task.id}`}>{task.title}</Link>
              <span>{task.kanbanStatus.replace("_", " ")}</span>
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
  const parents = tag
    ? tag.parentIds.map((parentId) => tags.find((item) => item.id === parentId)).filter((item): item is Tag => Boolean(item))
    : [];
  const children = tags.filter((item) => item.parentIds.includes(id));
  const taggedTasks = tasks.filter((task) => task.tags.some((taskTag) => taskTag.id === id));

  async function action(operation: () => Promise<void>) {
    try {
      await operation();
      setError(null);
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : String(operationError));
    }
  }

  async function saveTag(description: string, parentIds: number[]) {
    await api.updateTag(id, { description });
    const removed = tag!.parentIds.filter((parentId) => !parentIds.includes(parentId));
    const added = parentIds.filter((parentId) => !tag!.parentIds.includes(parentId));
    for (const parentId of removed) await api.removeTagParent(id, parentId);
    for (const parentId of added) await api.addTagParent(id, parentId);
    setEditing(false);
    await load();
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
          </div>
          <h1>{tag.title}</h1>
          {tag.description
            ? <div className="markdown-description"><ReactMarkdown remarkPlugins={[remarkGfm]}>{tag.description}</ReactMarkdown></div>
            : <p className="muted">No description yet — add one with “Edit tag details”.</p>}
        </div>
        <div className="detail-actions">
          <button onClick={() => setEditing((current) => !current)}>
            {editing ? "Close editor" : "Edit tag details"}
          </button>
        </div>
      </header>

      {editing && (
        <TagEditor
          tag={tag}
          tags={tags}
          onCancel={() => setEditing(false)}
          onSave={(description, parentIds) => action(() => saveTag(description, parentIds))}
        />
      )}

      <div className="detail-grid">
        <div className="detail-main">
          <RelatedTagList title="Child tags" tags={children} empty="This tag has no children." />
          <TaggedTaskList tasks={taggedTasks} />
        </div>

        <aside className="detail-sidebar">
          <RelatedTagList title="Parent tags" tags={parents} empty="This tag has no parents." />
        </aside>
      </div>
    </main>
  );
}