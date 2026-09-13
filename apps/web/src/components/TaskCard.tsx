import type { TaskSummary } from "@mind-palace/shared";
import { Link } from "react-router-dom";
import type { DragEvent } from "react";

export function TaskCard({ task, draggable = false, onDragStart, onDrop }: { task: TaskSummary; draggable?: boolean; onDragStart?: (event: DragEvent<HTMLAnchorElement>) => void; onDrop?: (event: DragEvent<HTMLAnchorElement>) => void }) {
  return (
    <Link className="task-card" draggable={draggable} onDragStart={(event) => onDragStart?.(event)} onDragOver={(event) => onDrop && event.preventDefault()} onDrop={onDrop} to={`/tasks/${task.id}`}>
      <div className="task-card-topline">
        <span className="task-priority">P{task.priority}</span>
      </div>
      <h3>{task.title}</h3>
      {task.description && <p className="task-description">{task.description}</p>}
      <div className="tag-row">{task.tags.map((tag) => <span key={tag.id}>{tag.title}</span>)}</div>
      {task.derivedTags.length > 0 && <div className="tag-row derived-tags">{task.derivedTags.map((tag) => <span key={tag.id}>{tag.title}</span>)}</div>}
      <dl className="task-meta">
        {task.durationMinutes !== null && <div><dt>Estimate</dt><dd>{task.durationMinutes} min</dd></div>}
        <div><dt>{task.kanbanStatus === "completed" ? "Completed" : "Updated"}</dt><dd>{new Date(task.completedAt ?? task.updatedAt).toLocaleDateString()}</dd></div>
      </dl>
    </Link>
  );
}