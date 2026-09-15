import type { TaskSummary } from "@mind-palace/shared";
import { Link } from "react-router-dom";
import type { DragEvent } from "react";
import { TagRow } from "./TagRow";

export function TaskCard({ task, draggable = false, selected = false, onCardClick, onDragStart, onDrop }: {
  task: TaskSummary;
  draggable?: boolean;
  selected?: boolean;
  onCardClick?: () => void;
  onDragStart?: (event: DragEvent<HTMLAnchorElement>) => void;
  onDrop?: (event: DragEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <Link
      className={`task-card${selected ? " selected" : ""}`}
      draggable={draggable}
      onClick={(event) => {
        if (onCardClick) {
          event.preventDefault();
          event.stopPropagation();
          onCardClick();
        }
      }}
      onDragStart={(event) => onDragStart?.(event)}
      onDragOver={(event) => onDrop && event.preventDefault()}
      onDrop={onDrop}
      to={`/tasks/${task.id}`}
    >      <div className="task-card-topline">
        <span className="task-priority">P{task.priority}</span>
      </div>
      <h3>{task.title}</h3>
      {task.description && <p className="task-description">{task.description}</p>}
      <TagRow tags={task.tags} />
      <TagRow tags={task.derivedTags} derived />
      <dl className="task-meta">
        {task.durationMinutes !== null && <div><dt>Estimate</dt><dd>{task.durationMinutes} min</dd></div>}
        <div><dt>{task.kanbanStatus === "completed" ? "Completed" : "Updated"}</dt><dd>{new Date(task.completedAt ?? task.updatedAt).toLocaleDateString()}</dd></div>
      </dl>
    </Link>
  );
}