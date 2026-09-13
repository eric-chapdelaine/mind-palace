import type { Tag } from "@mind-palace/shared";

export function TagRow({ tags, derived = false }: { tags: Tag[]; derived?: boolean }) {
  if (tags.length === 0) return null;
  return <div className={`tag-row${derived ? " derived-tags" : ""}`}>{tags.map((tag) => <span key={tag.id}>{tag.title}</span>)}</div>;
}