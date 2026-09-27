import type { Tag } from "@mind-palace/shared";
import { Link } from "react-router-dom";

export function TagHierarchy({ tags }: { tags: Tag[] }) {
  const byId = new Map(tags.map((tag) => [tag.id, tag]));
  // Archived tags are hidden (completed/retired goals): keep the navigable outline to live tags.
  const visible = tags.filter((tag) => !tag.isArchived);
  return <details className="tag-hierarchy"><summary>Tag hierarchy</summary>{visible.length === 0 ? <p className="muted">No tags yet.</p> : <ul>{visible.map((tag) => <li key={tag.id}><Link to={`/tags/${tag.id}`}>{tag.title}</Link>{tag.parentIds.length > 0 && <span> under {tag.parentIds.map((id) => byId.get(id)?.title ?? `Tag ${id}`).join(", ")}</span>}</li>)}</ul>}</details>;
}