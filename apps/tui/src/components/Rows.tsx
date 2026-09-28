import type { Tag, TaskSummary } from "@mind-palace/shared";
import { Box, Text } from "ink";

/**
 * Presentational rows for the dashboard body. Never fetch, never mutate — everything flows
 * through props, matching the web frontend's pages-vs-components rule.
 */

function hoursMinutes(minutes: number): string {
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest === 0 ? `${hours}h` : `${hours}h${rest}m`;
  }
  return `${minutes}m`;
}

export function ColumnHeader({ label, count, hint }: { label: string; count: number; hint?: string }) {
  return (
    <Box paddingTop={1}>
      <Text bold color="cyan">{label}</Text>
      <Text dimColor> ({count})</Text>
      {hint ? <Text dimColor> · {hint}</Text> : null}
    </Box>
  );
}

export function TaskRow({ task, cursor }: { task: TaskSummary; cursor: boolean }) {
  const inactive = task.kanbanStatus === "completed" || task.kanbanStatus === "cancelled";
  const minutes = task.durationMinutesRemaining;
  const priorityColor = task.priority <= 0 ? "red" : task.priority <= 2 ? "yellow" : "green";
  const tagTitles = [...new Set(task.tags.map((tag) => tag.title))].slice(0, 4);
  const tags = tagTitles.length > 0 ? `  ${tagTitles.map((tag) => `#${tag}`).join(" ")}` : "";
  const duration = minutes === null ? "--" : hoursMinutes(minutes);

  return (
    <Text inverse={cursor} wrap="truncate" {...(inactive ? { color: "gray" } : {})}>
      {cursor ? "▸ " : "  "}
      {inactive ? "✓ " : "  "}
      <Text {...(cursor ? {} : { color: priorityColor })}>P{task.priority}</Text> {duration}  {task.title}
      <Text dimColor>{tags}</Text>
    </Text>
  );
}

export function TagSearchRow({ query, focused }: { query: string; focused: boolean }) {
  const text =
    query.length > 0
      ? focused
        ? `search: ${query}█`
        : `search: ${query}`
      : "· / to search tags";
  return (
    <Text dimColor wrap="truncate">
      {text}
    </Text>
  );
}

export function TagRow({ tag, included, excluded, rank, cursor }: {
  tag: Tag;
  included: boolean;
  excluded: boolean;
  rank: number;
  cursor: boolean;
}) {
  const marker = included ? "＋" : excluded ? "－" : "·";
  const markerColor = included ? "cyan" : excluded ? "red" : "gray";
  return (
    <Text inverse={cursor} wrap="truncate">
      {cursor ? "▸ " : "  "}
      <Text {...(cursor ? {} : { color: markerColor })}>{marker}</Text> {rank}. {tag.title}
      {tag.reserved ? <Text dimColor> (reserved)</Text> : null}
      {tag.isArchived ? <Text dimColor> (archived)</Text> : null}
    </Text>
  );
}