import type { Tag } from "@mind-palace/shared";

export function TagHierarchy({ tags }: { tags: Tag[] }) {
  const byId = new Map(tags.map((tag) => [tag.id, tag]));
  return <details className="tag-hierarchy"><summary>Tag hierarchy</summary><ul>{tags.map((tag) => <li key={tag.id}><strong>{tag.title}</strong>{tag.parentIds.length > 0 && <span> under {tag.parentIds.map((id) => byId.get(id)?.title ?? `Tag ${id}`).join(", ")}</span>}</li>)}</ul></details>;
}
