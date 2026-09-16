import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Tag } from "@mind-palace/shared";
import { layoutTags, type TagLayout, type TagLayoutEdge, type TagLayoutNode } from "../lib/tagLayout";

/**
 * Tag graph rendered as rows of clickable tag links (row 0 = most general on top, last row
 * = most specific) with orthogonal lines connecting each tag to its parents.
 *
 * The layout (levels + band positions) comes from the pure `layoutTags` helper; this
 * component only renders it:
 *
 * - **full** (the /tags page) places every tag absolutely at its band center
 *   (`xBand` × unit), so a tag's whole subtree spreads out beneath it and children share
 *   their parent's horizontal space. The unit is measured from the rendered pills so a
 *   leaf slot is always at least as wide as the widest tag — no pills ever overlap.
 * - **compact** (the dashboard sidebar) flows pills left to right in band order with gaps
 *   proportional to band distance — the same ordering, without needing a wide canvas.
 * - The space between two rows ("corridor") is sized to fit one horizontal lane per edge
 *   entering the level below, each at its own y, so sibling lines never draw on top of
 *   each other.
 * - Node positions are measured after layout (refs + ResizeObserver), so lines always
 *   match the rendered pills, whatever the container width.
 * - Links stay clickable: the SVG overlay ignores pointer events and sits behind the nodes.
 *
 * `TagHierarchy` is the dashboard's collapsible sidebar version; `TagGraph` is the bare
 * graph, used at full size on the /tags page.
 */

export type TagGraphSize = "compact" | "full";

interface EdgePath extends TagLayoutEdge {
  /** SVG path drawing the connector line, in container-relative pixels. */
  d: string;
}

interface Geometry {
  /** The layout this calibration was computed for (recalibrate when it changes). */
  layout: TagLayout;
  /** Pixel width of one leaf slot, derived from the widest rendered pill. */
  unit: number;
  /** Height of one row of pills, measured from the rendered pills. */
  rowHeight: number;
  /** Total graph width in pixels. */
  width: number;
}

/** Spacing knobs per size. These drive the layout math, so they live here next to the
 *  drawing code; the CSS layer only styles what the nodes look like. */
const SPACING: Record<TagGraphSize, {
  baseGap: number;
  laneSpacing: number;
  /** Full mode: extra width per leaf slot beyond the widest pill. */
  slotGap: number;
  /** Compact mode: flex gap per unit of band distance. */
  gapPerBand: number;
}> = {
  compact: { baseGap: 10, laneSpacing: 5, slotGap: 12, gapPerBand: 4 },
  full: { baseGap: 26, laneSpacing: 9, slotGap: 12, gapPerBand: 4 },
};

export function TagHierarchy({ tags }: { tags: Tag[] }) {
  if (tags.length === 0) {
    return (
      <details className="tag-hierarchy">
        <summary>Tag hierarchy</summary>
        <p className="muted">No tags yet.</p>
      </details>
    );
  }
  return (
    <details className="tag-hierarchy">
      <summary>Tag hierarchy</summary>
      <TagGraph tags={tags} size="compact" />
    </details>
  );
}

export function TagGraph({ tags, size }: { tags: Tag[]; size: TagGraphSize }) {
  const layout = useMemo(() => layoutTags(tags), [tags]);
  const isFull = size === "full";
  const spacing = SPACING[size];

  const containerRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<number, HTMLAnchorElement>());
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const [edgePaths, setEdgePaths] = useState<EdgePath[]>([]);

  const rows = useMemo(() => {
    const nodesByLevel: TagLayoutNode[][] = [];
    for (const node of layout.nodes) {
      (nodesByLevel[node.level] ??= []).push(node);
    }
    return nodesByLevel;
  }, [layout]);

  const nodeById = useMemo(
    () => new Map(layout.nodes.map((node) => [node.tag.id, node])),
    [layout],
  );

  // Edges grouped by the level they enter, ordered by the child's column so the lanes run
  // left to right and the verticals barely have to fan out.
  const edgesIntoLevel = useMemo(() => {
    const byLevel = new Map<number, TagLayoutEdge[]>();
    for (const edge of layout.edges) {
      const child = nodeById.get(edge.childId);
      if (!child) continue;
      const levelEdges = byLevel.get(child.level);
      if (levelEdges) levelEdges.push(edge);
      else byLevel.set(child.level, [edge]);
    }
    for (const edges of byLevel.values()) {
      edges.sort((a, b) => nodeById.get(a.childId)!.column - nodeById.get(b.childId)!.column);
    }
    return byLevel;
  }, [layout, nodeById]);

  const totalSlots = Math.max(0, ...layout.nodes.map((node) => node.xBand + 0.5));
  const maxLevel = rows.length - 1;
  // Space under a row: the corridor above the next level, sized to fit its lanes.
  const rowGapBelow = (level: number) =>
    level < maxLevel ? spacing.baseGap + (edgesIntoLevel.get(level + 1)?.length ?? 0) * spacing.laneSpacing : 0;

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    // Full mode calibration: the leaf-slot unit must fit the widest rendered pill, so the
    // first pass lays pills out in flow, measures them, and derives the geometry. A second
    // pass (this effect re-running with `geometry` set) then draws the lanes.
    if (isFull && (geometry === null || geometry.layout !== layout)) {
      let widestPill = 0;
      let maxHeight = 0;
      for (const node of layout.nodes) {
        const element = nodeRefs.current.get(node.tag.id);
        if (!element) continue;
        const rect = element.getBoundingClientRect();
        widestPill = Math.max(widestPill, rect.width);
        maxHeight = Math.max(maxHeight, rect.height);
      }
      const unit = widestPill + spacing.slotGap;
      setGeometry({ layout, unit, rowHeight: Math.ceil(maxHeight), width: Math.ceil((totalSlots + 1) * unit) });
      return;
    }

    const measure = () => {
      const containerRect = container.getBoundingClientRect();

      // Top/bottom edge of each level's box, from the actual node positions.
      const rowTop = new Map<number, number>();
      const rowBottom = new Map<number, number>();
      for (const node of layout.nodes) {
        const element = nodeRefs.current.get(node.tag.id);
        if (!element) continue;
        const rect = element.getBoundingClientRect();
        const top = rect.top - containerRect.top;
        const bottom = rect.bottom - containerRect.top;
        const currentTop = rowTop.get(node.level);
        const currentBottom = rowBottom.get(node.level);
        if (currentTop === undefined || top < currentTop) rowTop.set(node.level, top);
        if (currentBottom === undefined || bottom > currentBottom) rowBottom.set(node.level, bottom);
      }

      // Orthogonal connector per edge: down from the parent's bottom edge to its own lane
      // in the corridor above the child's row, across, then down into the child's top edge.
      const edges: EdgePath[] = [];
      for (const edge of layout.edges) {
        const parentElement = nodeRefs.current.get(edge.parentId);
        const childElement = nodeRefs.current.get(edge.childId);
        const childNode = nodeById.get(edge.childId);
        if (!parentElement || !childElement || !childNode) continue;
        const parentRect = parentElement.getBoundingClientRect();
        const childRect = childElement.getBoundingClientRect();
        const parentX = parentRect.left - containerRect.left + parentRect.width / 2;
        const parentY = parentRect.bottom - containerRect.top;
        const childX = childRect.left - containerRect.left + childRect.width / 2;
        const childY = childRect.top - containerRect.top;

        const lanes = edgesIntoLevel.get(childNode.level) ?? [];
        // Match the full edge: a child can have several parents, so childId alone would
        // hand both incoming edges the same lane.
        const laneIndex = lanes.findIndex(
          (candidate) => candidate.parentId === edge.parentId && candidate.childId === edge.childId,
        );
        if (laneIndex < 0) continue;
        const corridorTop = rowBottom.get(childNode.level - 1) ?? parentY;
        const corridorBottom = rowTop.get(childNode.level) ?? childY;
        const corridorHeight = Math.max(corridorBottom - corridorTop, 4);
        const laneY = corridorBottom - corridorHeight * ((laneIndex + 1) / (lanes.length + 1));

        edges.push({
          parentId: edge.parentId,
          childId: edge.childId,
          d: `M ${parentX} ${parentY} V ${laneY} H ${childX} V ${childY}`,
        });
      }

      setEdgePaths(edges);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [layout, nodeById, edgesIntoLevel, geometry, isFull, totalSlots, spacing]);

  if (tags.length === 0) {
    return <p className="muted">No tags yet.</p>;
  }

  return (
    <div
      className={`tag-graph tag-graph--${size}`}
      ref={containerRef}
      style={isFull && geometry ? { width: geometry.width } : undefined}
    >
      <svg className="tag-graph-lines" aria-hidden="true">
        {edgePaths.map((edge) => (
          <path key={`${edge.parentId}-${edge.childId}`} d={edge.d} />
        ))}
      </svg>
      <div className="tag-graph-rows">
        {rows.map((levelNodes, level) => (
          <div
            className="tag-graph-row"
            key={level}
            style={{
              ...(isFull && geometry ? { height: geometry.rowHeight, position: "relative" } : {}),
              ...(level < maxLevel ? { marginBottom: rowGapBelow(level) } : {}),
            }}
          >
            {levelNodes.map((node, index) =>
              isFull && geometry ? (
                <Link
                  key={node.tag.id}
                  to={`/tags/${node.tag.id}`}
                  className="tag-graph-node"
                  style={{
                    position: "absolute",
                    top: 0,
                    left: node.xBand * geometry.unit,
                    transform: "translateX(-50%)",
                  }}
                  ref={(element) => {
                    if (element) nodeRefs.current.set(node.tag.id, element);
                    else nodeRefs.current.delete(node.tag.id);
                  }}
                >
                  {node.tag.title}
                </Link>
              ) : (
                <Link
                  key={node.tag.id}
                  to={`/tags/${node.tag.id}`}
                  className="tag-graph-node"
                  style={index > 0
                    ? { marginLeft: Math.min(40, Math.max(spacing.baseGap, (levelNodes[index]!.xBand - levelNodes[index - 1]!.xBand) * spacing.gapPerBand)) }
                    : undefined}
                  ref={(element) => {
                    if (element) nodeRefs.current.set(node.tag.id, element);
                    else nodeRefs.current.delete(node.tag.id);
                  }}
                >
                  {node.tag.title}
                </Link>
              ),
            )}
          </div>
        ))}
      </div>
    </div>
  );
}