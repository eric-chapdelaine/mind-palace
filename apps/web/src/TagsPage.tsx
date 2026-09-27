import type { Tag, TaskSummary } from "@mind-palace/shared";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "./api";
import { fuzzyScore } from "./components/TagPicker";

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString();
}

/** Badges for the goal type and reserved tags, shown next to a tag title. */
function TagBadges({ tag }: { tag: Tag }) {
  return (
    <>
      {tag.type && <span className="tag-type-badge">{tag.type}</span>}
      {tag.reserved && <span className="tag-reserved">reserved</span>}
    </>
  );
}

function TagList({ tags }: { tags: Tag[] }) {
  return (
    <ul className="tags-list">
      {tags.map((tag) => (
        <li key={tag.id}>
          <Link className="tags-list-title" to={`/tags/${tag.id}`}>{tag.title} <TagBadges tag={tag} /></Link>
          {tag.description && <span className="tags-list-description">{tag.description}</span>}
        </li>
      ))}
    </ul>
  );
}

export function TagsPage() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

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
  }, []);

  const active = tags.filter((tag) => !tag.isArchived);
  const archived = tags
    .filter((tag) => tag.isArchived)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  // Last activity of a tag = the most recent update of the tag itself or of any task that
  // carries it (directly, or through one of the task's own tags' parents).
  const activityAt = (tag: Tag): string => {
    let latest = tag.updatedAt;
    for (const task of tasks) {
      const carriesTag = task.tags.some((taskTag) => taskTag.id === tag.id)
        || task.derivedTags.some((taskTag) => taskTag.id === tag.id);
      if (carriesTag && task.updatedAt > latest) latest = task.updatedAt;
    }
    return latest;
  };
  const byActivityDesc = (a: Tag, b: Tag) => activityAt(b).localeCompare(activityAt(a));
  const hasChildren = (tag: Tag) => tags.some((other) => other.parentIds.includes(tag.id));
  // Leaf tags (nothing hangs underneath them) are the actionable end of the hierarchy and go
  // first; tags that still have children get their own quieter section below.
  const leaves = active.filter((tag) => !hasChildren(tag)).sort(byActivityDesc);
  const structureTags = active.filter((tag) => hasChildren(tag)).sort(byActivityDesc);

  // Typing a query collapses the page into one flat result list (fuzzy over title OR
  // description), ranked by similarity score; an empty query shows the leaf/structure sections.
  const trimmedQuery = query.trim();
  const matching = trimmedQuery === ""
    ? null
    : active
        .map((tag) => ({
          tag,
          score: Math.max(
            fuzzyScore(tag.title, trimmedQuery),
            tag.description === null ? -1 : fuzzyScore(tag.description, trimmedQuery),
          ),
        }))
        .filter((match) => match.score >= 0)
        // Best fuzzy match first; activity breaks score ties (keeps the list deterministic).
        .sort((a, b) => b.score - a.score || activityAt(b.tag).localeCompare(activityAt(a.tag)))
        .map((match) => match.tag);

  return (
    <main className="detail-shell">
      <nav className="detail-nav">
        <Link to="/">Back to board</Link>
        <span>{tags.length} tags</span>
      </nav>
      {error && <div className="error-banner">{error}</div>}
      <header className="detail-header">
        <div>
          <div className="task-card-topline"><span className="task-type">tag directory</span></div>
          <h1>Tags</h1>
          <p className="muted">Goals are tags that contain subtasks — every task carrying the tag (directly or through a child tag) belongs to the goal. Open a tag to rename it, edit its description, restructure its parents, or archive it.</p>
        </div>
      </header>

      <input
        className="tags-search"
        type="search"
        placeholder="Search tags by title or description"
        aria-label="Search tags"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      {active.length === 0
        ? <p className="muted">No tags yet — tags are created from Quick capture or by converting a task.</p>
        : matching
          ? (
            <section className="tags-section">
              <div className="section-label">Matching tags ({matching.length}) — best match first</div>
              {matching.length === 0
                ? <p className="muted">No tags match “{trimmedQuery}”.</p>
                : <TagList tags={matching} />}
            </section>
          )
          : (
            <>
              <section className="tags-section">
                <div className="section-label">Leaf tags ({leaves.length}) — most recently active first</div>
                {leaves.length === 0
                  ? <p className="muted">Every tag has children; nothing is a leaf right now.</p>
                  : <TagList tags={leaves} />}
              </section>
              {structureTags.length > 0 && (
                <section className="tags-section">
                  <div className="section-label">Tags with children ({structureTags.length})</div>
                  <TagList tags={structureTags} />
                </section>
              )}
            </>
          )}

      {archived.length > 0 && (
        <details className="archived-section">
          <summary>Archived ({archived.length})</summary>
          <ul className="archived-list">
            {archived.map((tag) => (
              <li key={tag.id}>
                <Link className="archived-list-title" to={`/tags/${tag.id}`}>{tag.title} <TagBadges tag={tag} /></Link>
                <time dateTime={tag.updatedAt}>archived {formatDateTime(tag.updatedAt)}</time>
              </li>
            ))}
          </ul>
        </details>
      )}
    </main>
  );
}
