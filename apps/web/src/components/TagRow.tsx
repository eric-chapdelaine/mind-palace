import type { Tag } from "@mind-palace/shared";
import { Link } from "react-router-dom";

export function TagRow({ tags, derived = false, links = false }: { tags: Tag[]; derived?: boolean; links?: boolean }) {
  if (tags.length === 0) return null;
  return <div className={`tag-row${derived ? " derived-tags" : ""}`}>{tags.map((tag) => links
    ? <Link key={tag.id} to={`/tags/${tag.id}`}>{tag.title}</Link>
    : <span key={tag.id}>{tag.title}</span>)}</div>;
}