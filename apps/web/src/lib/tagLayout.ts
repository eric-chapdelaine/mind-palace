import type { Tag } from "@mind-palace/shared";

/**
 * Pure layout for the tag graph. Tags form a DAG (a tag can have several parents), but in
 * practice the graph is tree-like, so we lay it out like a tidy tree:
 *
 * - Leveling uses Kahn's topological sort: a tag is placed on a row only after every one of
 *   its parents has been placed, always one row below its deepest parent. Row 0 therefore
 *   holds the most general tags (roots, e.g. Health) and the last row the most specific ones
 *   (leaves, e.g. Exercise).
 *
 * - Horizontal placement is a **band layout**. Each leaf occupies one slot on a shared
 *   horizontal axis; a tag's band is as wide as the slots its whole subtree spans, and
 *   `xBand` is the band's center. Because every child keeps its slot inside its parent's
 *   band, children always sit in the same horizontal space as their parent (an `errands`
 *   never drifts away from its `shopping`), and big subtrees automatically get proportionally
 *   more horizontal room. Edges between tags on the same row can then never cross.
 *
 * - The DAG case is handled by giving every tag ONE "primary" parent — the parent on the
 *   nearest row — and laying the resulting forest out as trees. Secondary parent edges still
 *   render; they are the only place crossings can appear, which is fine because they are rare.
 *
 * The function is intentionally free of DOM and React so it can be unit-tested and swapped out
 * independently of the component that renders it.
 */

export interface TagLayoutNode {
  tag: Tag;
  /** Row index: 0 = most general (top), highest = most specific (bottom). */
  level: number;
  /** Band center in leaf-slot units (one leaf = one slot). A tag's whole subtree falls
   *  inside its band, so children and parents share horizontal space. */
  xBand: number;
  /** Left-to-right order inside the row (by xBand). */
  column: number;
}

export interface TagLayoutEdge {
  parentId: number;
  childId: number;
}

export interface TagLayout {
  nodes: TagLayoutNode[];
  edges: TagLayoutEdge[];
  levelCount: number;
}

/** Returns a comparator that orders tag ids by title (used to keep results deterministic). */
function byTitle(byId: Map<number, Tag>) {
  return (a: number, b: number) => byId.get(a)!.title.localeCompare(byId.get(b)!.title);
}

export function layoutTags(tags: Tag[]): TagLayout {
  if (tags.length === 0) return { nodes: [], edges: [], levelCount: 0 };

  // ---- adjacency maps (dangling parent refs and duplicate assignments are ignored) ----
  const byId = new Map(tags.map((tag) => [tag.id, tag]));
  const parentsOf = new Map<number, number[]>(tags.map((tag) => [tag.id, []]));
  const childrenOf = new Map<number, number[]>(tags.map((tag) => [tag.id, []]));
  const seenEdges = new Set<string>();
  for (const tag of tags) {
    for (const parentId of tag.parentIds) {
      if (!byId.has(parentId) || seenEdges.has(`${parentId}:${tag.id}`)) continue;
      seenEdges.add(`${parentId}:${tag.id}`);
      parentsOf.get(tag.id)!.push(parentId);
      childrenOf.get(parentId)!.push(tag.id);
    }
  }

  // ---- levels via Kahn's algorithm ----
  // Roots (no parents) start the queue on row 0; a tag is enqueued only once every parent is
  // placed, so it lands on the row below its deepest parent.
  const level = new Map<number, number>();
  const unplacedParents = new Map(tags.map((tag) => [tag.id, parentsOf.get(tag.id)!.length]));
  const queue = tags.filter((tag) => unplacedParents.get(tag.id) === 0).map((tag) => tag.id);
  queue.sort(byTitle(byId));
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head]!;
    const row = level.get(id) ?? 0;
    level.set(id, row); // roots land on row 0; children were stored when enqueued
    for (const childId of childrenOf.get(id)!) {
      const left = unplacedParents.get(childId)! - 1;
      unplacedParents.set(childId, left);
      if (left === 0) {
        level.set(childId, row + 1);
        queue.push(childId);
      }
    }
  }
  // The repository forbids cycles, so everything should be leveled above; if a cycle ever
  // slips through, fall back deterministically instead of breaking the dashboard.
  for (const tag of tags) {
    if (level.has(tag.id)) continue;
    const deepestParent = Math.max(0, ...parentsOf.get(tag.id)!.map((id) => level.get(id) ?? 0));
    level.set(tag.id, deepestParent + 1);
  }

  // ---- forest via a primary parent ----
  // Every tag attaches to the parent on the nearest row (ties broken by id). This turns the
  // DAG into a forest whose bands can be laid out without overlap.
  const primaryParentOf = new Map<number, number>();
  for (const tag of tags) {
    const parents = parentsOf.get(tag.id)!;
    if (parents.length === 0) continue;
    parents.sort((a, b) => level.get(b)! - level.get(a)! || a - b);
    primaryParentOf.set(tag.id, parents[0]!);
  }
  const forestChildren = new Map<number, number[]>(tags.map((tag) => [tag.id, []]));
  for (const tag of tags) {
    const primary = primaryParentOf.get(tag.id);
    if (primary !== undefined) forestChildren.get(primary)!.push(tag.id);
  }
  for (const children of forestChildren.values()) children.sort(byTitle(byId));

  // ---- leaf slots ----
  // Walk each root's subtree, numbering leaves 0..n-1. The order of leaves defines the
  // horizontal arrangement below every root.
  const leafSlot = new Map<number, number>();
  let nextSlot = 0;
  const assignSlots = (tagId: number): void => {
    const children = forestChildren.get(tagId)!;
    if (children.length === 0) {
      leafSlot.set(tagId, nextSlot);
      nextSlot += 1;
      return;
    }
    for (const child of children) assignSlots(child);
  };
  const rootIds = tags.filter((tag) => parentsOf.get(tag.id)!.length === 0).map((tag) => tag.id);
  rootIds.sort(byTitle(byId));
  for (const root of rootIds) assignSlots(root);
  // Leftovers would mean a cycle slipped in; give them the remaining slots, deterministically.
  for (const tag of tags) {
    if (!leafSlot.has(tag.id)) {
      leafSlot.set(tag.id, nextSlot);
      nextSlot += 1;
    }
  }

  // ---- xBand: center of the band a tag's whole subtree spans ----
  const xBand = new Map<number, number>();
  const xBandOf = (tagId: number): number => {
    const children = forestChildren.get(tagId)!;
    if (children.length === 0) return leafSlot.get(tagId)! + 0.5;
    const childBands = children.map(xBandOf);
    return (Math.min(...childBands) + Math.max(...childBands)) / 2;
  };
  for (const tag of tags) xBand.set(tag.id, xBandOf(tag.id));

  // ---- order inside each row (left to right by band center) ----
  const rows: number[][] = [];
  for (const tag of tags) {
    (rows[level.get(tag.id)!] ??= []).push(tag.id);
  }
  const levelCount = rows.length;
  for (const row of rows) {
    row.sort((a, b) => xBand.get(a)! - xBand.get(b)! || byTitle(byId)(a, b));
  }

  // ---- emit ----
  const nodes: TagLayoutNode[] = [];
  for (const tag of tags) {
    const row = level.get(tag.id)!;
    nodes.push({ tag, level: row, xBand: xBand.get(tag.id)!, column: rows[row]!.indexOf(tag.id) });
  }
  const edges: TagLayoutEdge[] = [];
  for (const [parentId, children] of childrenOf) {
    for (const childId of children) edges.push({ parentId, childId });
  }
  return { nodes, edges, levelCount };
}