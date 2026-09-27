import type { Tag } from "@mind-palace/shared";

/** Index helpers for the tag-hierarchy outline. Tags form a DAG; the outline shows a tag
 *  under EVERY active parent, so a multi-parent tag appears in each branch it belongs to.
 *  Its other root→tag paths are also visible in breadcrumbs — no drawn edges and no
 *  annotations, so nothing can overlap or cross. */

export interface TagIndex {
  byId: Map<number, Tag>;
  /** Tags with no active parent (their parents are all hidden/archived). */
  roots: Tag[];
  /** Children per active parent id, in input (title) order. */
  childrenOf: Map<number, Tag[]>;
}

export function buildTagIndex(tags: Tag[]): TagIndex {
  const byId = new Map(tags.map((tag) => [tag.id, tag]));
  const roots: Tag[] = [];
  const childrenOf = new Map<number, Tag[]>();
  for (const tag of tags) {
    const activeParents = tag.parentIds
      .map((id) => byId.get(id))
      .filter((parent): parent is Tag => Boolean(parent));
    if (activeParents.length === 0) {
      roots.push(tag);
      continue;
    }
    for (const parent of activeParents) {
      const siblings = childrenOf.get(parent.id);
      if (siblings) siblings.push(tag);
      else childrenOf.set(parent.id, [tag]);
    }
  }
  return { byId, roots, childrenOf };
}

/** Every simple root → tag path through the active parents, shallowest first. A tag with
 *  two parents yields two paths (e.g. `Outside › exercise` and `Personal › Health ›
 *  exercise`), which is how the UI shows it belongs to both branches. */
export function tagPaths(tags: Tag[], tag: Tag): Tag[][] {
  const index = buildTagIndex(tags);
  const paths: Tag[][] = [];
  const walk = (current: Tag, chain: Tag[]): void => {
    if (chain.includes(current)) return; // cycle guard; the schema forbids real cycles
    const next = [...chain, current];
    const parents = current.parentIds
      .map((id) => index.byId.get(id))
      .filter((parent): parent is Tag => Boolean(parent));
    if (parents.length === 0) {
      paths.push(next.reverse());
      return;
    }
    for (const parent of parents) walk(parent, next);
  };
  walk(tag, []);
  return paths.sort((a, b) => a.length - b.length);
}
