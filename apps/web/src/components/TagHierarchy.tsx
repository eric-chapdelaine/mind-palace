import type { Tag } from "@mind-palace/shared";
import { Link } from "react-router-dom";

export function TagHierarchy({ tags }: { tags: Tag[] }) {
  const byId = new Map(tags.map((tag) => [tag.id, tag]));
  return <details className="tag-hierarchy"><summary>Tag hierarchy</summary><ul>{tags.map((tag) => <li key={tag.id}><Link to={`/tags/${tag.id}`}>{tag.title}</Link>{tag.parentIds.length > 0 && <span> under {tag.parentIds.map((id) => byId.get(id)?.title ?? `Tag ${id}`).join(", ")}</span>}</li>)}</ul></details>;
}