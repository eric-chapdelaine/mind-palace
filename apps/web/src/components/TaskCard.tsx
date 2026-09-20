import type { TaskSummary } from "@mind-palace/shared";
import { Link } from "react-router-dom";
import type { PointerEvent } from "react";
import { TagRow } from "./TagRow";

/** Max direct tags shown on the collapsed card line; extras collapse into "+N". */
const MAX_INLINE_TAGS = 2;

/** Collapse a long description to a word-boundary-safe snippet for the hovered card. */
function truncate(text: string, maxChars = 140): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : maxChars).trimEnd()}…`;
}

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
      {/* Collapsed line: priority, title, and the directly-assigned tags. Everything else
          (description, estimate, updated, derived tags) lives in the expand-on-hover block. */}
      <div className="task-card-line">
        <span className="task-priority">P{task.priority}:</span>
        <h3>{task.title}</h3>
        {task.tags.slice(0, MAX_INLINE_TAGS).map((tag) => (
          <span className="task-card-inline-tag" key={tag.id}>{tag.title}</span>
        ))}
        {task.tags.length > MAX_INLINE_TAGS && (
          <span className="task-card-inline-tag">+{task.tags.length - MAX_INLINE_TAGS}</span>
        )}
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
      <div className="task-card-expand">
        <div>
          {task.description && <p className="task-description">{truncate(task.description)}</p>}
          <TagRow tags={task.derivedTags} derived />
          <dl className="task-meta">
            {task.durationMinutes !== null && <div><dt>Estimate</dt><dd>{task.durationMinutes} min</dd></div>}
            <div><dt>{task.kanbanStatus === "completed" ? "Completed" : "Updated"}</dt><dd>{new Date(task.completedAt ?? task.updatedAt).toLocaleDateString()}</dd></div>
          </dl>
        </div>
      </div>
    </Link>
  );
}
