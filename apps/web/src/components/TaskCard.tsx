import type { TaskSummary } from "@mind-palace/shared";
import { Link } from "react-router-dom";
import type { PointerEvent } from "react";
import { TagRow } from "./TagRow";

export function TaskCard({ task, selected = false, checked = false, onToggleComplete, onCardClick, onPointerDown }: {
  task: TaskSummary;
  selected?: boolean;
  checked?: boolean;
  onToggleComplete?: () => void;
  onCardClick?: () => void;
  onPointerDown?: (event: PointerEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <Link
      className={`task-card${selected ? " selected" : ""}`}
      draggable={false}
      data-task-id={task.id}
      onDragStart={(event) => event.preventDefault()}
      onClick={(event) => {
        if (onCardClick) {
          event.preventDefault();
          event.stopPropagation();
          onCardClick();
        }
      }}
      onPointerDown={(event) => onPointerDown?.(event)}
      to={`/tasks/${task.id}`}
    >
      <div className="task-card-topline">
        <span className="task-priority">P{task.priority}</span>
        {onToggleComplete && (
          <input
            type="checkbox"
            className="task-card-checkbox"
            checked={checked}
            readOnly
            aria-label={checked ? "Mark as not done" : "Mark as done"}
            onClick={(event) => {
              // Keep the link from navigating / toggling drag-select; the input only changes via re-render.
              event.preventDefault();
              event.stopPropagation();
              onToggleComplete();
            }}
          />
        )}
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