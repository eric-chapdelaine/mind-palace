import type { Tag } from "@mind-palace/shared";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { buildTagIndex, tagPaths, type TagIndex } from "../lib/tagTree";

/**
 * The tag hierarchy as an indented outline: roots first, children nested beneath every
 * active parent. Indentation is the structure — no drawn edges, so nothing overlaps.
 * Multi-parent tags appear once per parent branch (their full set of paths is visible),
 * so nothing needs annotations. Archived tags are hidden.
 *
 * Open by default: in directory mode, roots show one level down; with `focusId`, only
 * the focused tag's path branches open, so unrelated branches don't clutter the page.
 */
export function TagHierarchy({ tags, focusId }: { tags: Tag[]; focusId?: number }) {
  const active = tags.filter((tag) => !tag.isArchived);
  const index = buildTagIndex(active);

  // Explicit user toggles only; everything else follows the per-node default in `isOpen`.
  const [toggledOpen, setToggledOpen] = useState<Set<number>>(new Set());

  // The focused tag and every branch on any of its paths stays open no matter what
  // (derived at render time so async tag loads still work).
  const focusOpenIds = useMemo(() => {
    if (focusId === undefined) return new Set<number>();
    const focus = index.byId.get(focusId);
    if (!focus) return new Set<number>();
    const ids = new Set<number>();
    for (const path of tagPaths(active, focus)) {
      for (const crumb of path) ids.add(crumb.id);
    }
    return ids;
  }, [focusId, index]);

  function toggle(id: number) {
    setToggledOpen((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const isOpen = (tag: Tag): boolean => {
    const children = index.childrenOf.get(tag.id) ?? [];
    if (children.length === 0) return false;
    if (toggledOpen.has(tag.id)) return true;
    if (focusOpenIds.has(tag.id)) return true;
    // Focused page: only the focused branches are open. Directory: roots show one level.
    return focusId === undefined && tag.parentIds.length === 0;
  };

  if (index.roots.length === 0) return <p className="muted">No tags yet.</p>;

  return (
    <ul className="hierarchy">
      {index.roots.map((root) => (
        <HierarchyRow
          key={root.id}
          tag={root}
          index={index}
          isOpen={isOpen}
          onToggle={toggle}
          focusId={focusId}
        />
      ))}
    </ul>
  );
}

function HierarchyRow({ tag, index, isOpen, onToggle, focusId }: {
  tag: Tag;
  index: TagIndex;
  isOpen: (tag: Tag) => boolean;
  onToggle: (id: number) => void;
  focusId: number | undefined;
}) {
  const children = index.childrenOf.get(tag.id) ?? [];
  const open = isOpen(tag);

  return (
    <li className={tag.id === focusId ? "hierarchy-node focused" : "hierarchy-node"}>
      <div className="hierarchy-row">
        <button
          type="button"
          className="hierarchy-toggle"
          onClick={() => onToggle(tag.id)}
          aria-label={children.length === 0 ? undefined : open ? `Collapse ${tag.title}` : `Expand ${tag.title}`}
          disabled={children.length === 0}
        >
          {children.length === 0 ? "·" : open ? "▾" : "▸"}
        </button>
        <Link to={`/tags/${tag.id}`}>{tag.title}</Link>
      </div>
      {children.length > 0 && open && (
        <ul className="hierarchy-children">
          {children.map((child) => (
            <HierarchyRow
              key={child.id}
              tag={child}
              index={index}
              isOpen={isOpen}
              onToggle={onToggle}
              focusId={focusId}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Collapsible sidebar panel: the hierarchy inside a <details> for the dashboard. */
export function TagHierarchyPanel({ tags }: { tags: Tag[] }) {
  return (
    <details className="tag-hierarchy">
      <summary>Tag hierarchy</summary>
      <TagHierarchy tags={tags} />
    </details>
  );
}
