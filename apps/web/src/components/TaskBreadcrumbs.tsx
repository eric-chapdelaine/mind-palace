import type { Tag, TaskSummary } from "@mind-palace/shared";
import { Link } from "react-router-dom";
import { buildTagIndex, tagPaths } from "../lib/tagTree";

/** Muted crumb-run line(s) showing which branches a task sits beneath, one per path of
 *  each directly-tagged goal. A multi-parent tag contributes one run per path (e.g.
 *  `Personal › Health; Outside`). Archived tags still resolve (the task really is under
 *  them); they just don't appear in the hierarchy views. `max` keeps cards tidy — the
 *  task detail page shows everything. */
export function TaskBreadcrumbs({ task, allTags, max = Infinity, className }: {
  task: TaskSummary;
  allTags: Tag[];
  max?: number;
  className?: string;
}) {
  const index = buildTagIndex(allTags);
  const runs: Tag[][] = [];
  for (const directTag of task.tags) {
    const fullTag = index.byId.get(directTag.id);
    if (!fullTag) continue;
    for (const path of tagPaths(allTags, fullTag)) {
      if (path.length > 1) runs.push(path);
    }
  }
  if (runs.length === 0) return null;
  const visible = runs.slice(0, max);
  const hidden = runs.length - visible.length;
  return (
    <div className={`task-breadcrumbs${className ? ` ${className}` : ""}`}>
      {visible.map((path, index) => (
        <span key={index}>
          {index > 0 && "; "}
          {path.slice(0, -1).map((crumb, crumbIndex) => (
            <span key={crumb.id}>
              {crumbIndex > 0 && " › "}
              <Link to={`/tags/${crumb.id}`}>{crumb.title}</Link>
            </span>
          ))}
        </span>
      ))}
      {hidden > 0 && <span className="muted">; +{hidden} more</span>}
    </div>
  );
}