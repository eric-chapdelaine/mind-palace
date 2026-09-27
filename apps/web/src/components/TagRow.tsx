import type { Tag } from "@mind-palace/shared";
import { Link } from "react-router-dom";

export function TagRow({ tags, links = false }: { tags: Tag[]; links?: boolean }) {
  if (tags.length === 0) return null;
  return <div className="tag-row">{tags.map((tag) => links
    ? <Link key={tag.id} to={`/tags/${tag.id}`} className={tag.isArchived ? "archived-tag" : undefined}>{tag.title}</Link>
    : <span key={tag.id} className={tag.isArchived ? "archived-tag" : undefined}>{tag.title}</span>)}</div>;
}