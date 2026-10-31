import {
  weekdayTagPublicIds,
  type HealthActivity,
  type IntegrationSummary,
  type Schedule,
  type SleepSession,
  type Tag,
  type TaskSummary,
  type UpdateTaskInput,
  type WeatherForecast,
} from "@mind-palace/shared";
import { useEffect, useRef, useState, type CSSProperties, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "./api";
import { formatClock, formatMinutes } from "./lib/health";

const DAY_START_HOUR = 8;
const DAY_END_HOUR = 20; // 8am-8pm: the useful day the calendar should fit without scrolling
// Dragging a proposed block moves it in 30-minute steps, matching the scheduler's slot size.
const BLOCK_MOVE_SNAP_MINUTES = 30;

function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function addDays(date: Date, count: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + count);
  return result;
}

function sameDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

// ---- Week-task helpers (pure, so tests stay possible) ----

/** Direct + derived tag public ids. */
function effectiveTagIds(task: TaskSummary): string[] {
  return [...task.tags, ...task.derivedTags].map((tag) => tag.publicId);
}

/**
 * The tasks this page proposes for the week: open, not archived, and actually schedulable. This used
 * to be gated on the `this-week` tag, which meant the list was a second, hand-maintained to-do list
 * that disagreed with the scheduler's own eligibility rule. It is now exactly that rule.
 */
function isProposed(task: TaskSummary): boolean {
  return !terminalStatuses.has(task.kanbanStatus)
    && task.lifecycleStatus !== "archived"
    && schedulabilityReason(task) === null;
}

/**
 * Why a proposed task will be skipped by the scheduler, or null when it is schedulable.
 * Mirrors the filters in `TaskRepository.listSchedulableTasks`: a task must be Ready /
 * In progress and carry a duration estimate (tasks without one are never auto-scheduled).
 */
function schedulabilityReason(task: TaskSummary): { label: string; detail: string } | null {
  if (task.kanbanStatus !== "ready" && task.kanbanStatus !== "in_progress") {
    return {
      label: "not ready",
      detail: `Only Ready and In progress tasks are scheduled; this one is ${task.kanbanStatus}.`,
    };
  }
  if (task.durationMinutesRemaining === null || task.durationMinutesRemaining <= 0) {
    return {
      label: "no estimate",
      detail: "Only tasks with time remaining are scheduled. Set a remaining estimate or release a time block.",
    };
  }
  return null;
}

/**
 * Index into `weekdayTagPublicIds` (0 = Sunday .. 6 = Saturday, matching `Date#getDay()`)
 * of the day the task is pinned to, or -1 when it has no day tag.
 */
function dayTagIndex(task: TaskSummary): number {
  const ids = new Set(effectiveTagIds(task));
  return weekdayTagPublicIds.findIndex((publicId) => ids.has(publicId));
}

function directTagIds(task: TaskSummary): number[] {
  return task.tags.map((tag) => tag.id);
}

function sameIds(left: number[], right: number[]): boolean {
  const sort = (ids: number[]) => [...ids].sort((a, b) => a - b).join(",");
  return sort(left) === sort(right);
}

/**
 * Where a dragged block should start. `cursorMinutes` is the pointer (minutes since local
 * midnight) minus the grab offset. Keeps the whole block within the day and snaps to the grid.
 */
function snappedBlockStart(cursorMinutes: number, durationMinutes: number): number {
  const latestStart = Math.max(0, 1440 - durationMinutes);
  const snapped = Math.round(cursorMinutes / BLOCK_MOVE_SNAP_MINUTES) * BLOCK_MOVE_SNAP_MINUTES;
  return Math.min(latestStart, Math.max(0, snapped));
}

/** The ISO window for a block dropped at `cursorMinutes` on `day`, keeping `durationMinutes`. */
function blockWindow(day: Date, cursorMinutes: number, durationMinutes: number): { startAt: string; endAt: string } {
  const startAt = new Date(day);
  startAt.setHours(0, snappedBlockStart(cursorMinutes, durationMinutes), 0, 0);
  const endAt = new Date(startAt);
  endAt.setMinutes(startAt.getMinutes() + durationMinutes);
  return { startAt: startAt.toISOString(), endAt: endAt.toISOString() };
}

const terminalStatuses = new Set(["completed", "cancelled"]);

/** Clip a health window to one day column and convert it to calendar pixels. */
function healthEventLayout(startAt: string, endAt: string, day: Date, dayEnd: Date, hourHeight: number) {
  const start = new Date(Math.max(new Date(startAt).getTime(), day.getTime()));
  const end = new Date(Math.min(new Date(endAt).getTime(), dayEnd.getTime()));
  return {
    top: (start.getHours() * 60 + start.getMinutes()) * hourHeight / 60,
    height: Math.max(16, (end.getTime() - start.getTime()) / 3_600_000 * hourHeight),
  };
}

/**
 * Read-only Garmin context (sleep / recorded activities) overlaid on the day column. It has no
 * accept/delete affordances: health events are observed facts, not editable time blocks.
 */
function HealthEvent({ kind, startAt, endAt, href, title, subtitle, day, dayEnd, hourHeight }: {
  kind: "sleep" | "activity";
  startAt: string;
  endAt: string;
  href: string;
  title: string;
  subtitle: string;
  day: Date;
  dayEnd: Date;
  hourHeight: number;
}) {
  const { top, height } = healthEventLayout(startAt, endAt, day, dayEnd, hourHeight);
  const compact = height < 40;
  // Show the true in-bed window, not the day-clipped midnight edge, so a night that began the
  // previous evening still reads as "11:06 PM - 8:02 AM" on the wake-day column.
  const startLabel = formatClock(startAt);
  const endLabel = formatClock(endAt);
  const timeLabel = kind === "sleep" || !compact ? `${startLabel} - ${endLabel}` : startLabel;
  return (
    <Link
      to={href}
      className={`calendar-event health-event ${kind}-event${compact ? " calendar-event-compact" : ""}`}
      style={{ top, height }}
      title={`${title} · ${startLabel} - ${endLabel}${subtitle ? ` · ${subtitle}` : ""}`}
    >
      <div className="calendar-event-summary">
        <time>{timeLabel}</time>
        <strong>{title}</strong>
      </div>
      {!compact && subtitle && <span>{subtitle}</span>}
    </Link>
  );
}

function WeekTaskRow({ task, scheduled, removeLabel, onRemove, onDragStart, onDragEnd, onCardDrop, dragOver, onDragEnter, onDragLeave }: {
  task: TaskSummary;
  scheduled: boolean;
  removeLabel: string;
  onRemove: (taskId: number) => void;
  onDragStart: (event: DragEvent<HTMLDivElement>, taskId: number) => void;
  onDragEnd: () => void;
  onCardDrop?: (event: DragEvent<HTMLDivElement>) => void;
  dragOver?: boolean;
  onDragEnter?: () => void;
  onDragLeave?: () => void;
}) {
  const reason = schedulabilityReason(task);
  return (
    <div
      className={`week-task-row${scheduled ? " week-task-row-scheduled" : ""}${dragOver ? " drag-over" : ""}`}
      draggable
      onDragStart={(event) => onDragStart(event, task.id)}
      onDragEnd={onDragEnd}
      onDragOver={onCardDrop ? (event) => event.preventDefault() : undefined}
      onDragEnter={() => onDragEnter?.()}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onDragLeave?.();
      }}
      onDrop={onCardDrop}
    >
      <Link to={`/tasks/${task.id}`} draggable={false}>{task.title}</Link>
      {scheduled && <span className="week-task-ok" title="Fully scheduled this week">✓</span>}
      {task.durationMinutesRemaining !== null && <span className="week-task-duration">{task.durationMinutesRemaining}m</span>}
      {reason !== null && <span className="week-task-ineligible" title={reason.detail}>{reason.label}</span>}
      <button
        type="button"
        className="week-task-remove"
        aria-label={removeLabel}
        title={removeLabel}
        onClick={() => onRemove(task.id)}
      >×</button>
    </div>
  );
}

// Compact chip shown at the top of a calendar day column (sticky, like Google
// Calendar's all-day strip) for tasks pinned to that day.
function DayTaskChip({ task, scheduled, removeLabel, onRemove, onDragStart, onDragEnd, onDrop, dragOver, onDragEnter, onDragLeave }: {
  task: TaskSummary;
  scheduled: boolean;
  removeLabel: string;
  onRemove: (taskId: number) => void;
  onDragStart: (event: DragEvent<HTMLDivElement>, taskId: number) => void;
  onDragEnd: () => void;
  onDrop?: (event: DragEvent<HTMLDivElement>) => void;
  dragOver?: boolean;
  onDragEnter?: () => void;
  onDragLeave?: () => void;
}) {
  const reason = schedulabilityReason(task);
  return (
    <div
      className={`day-task-chip${scheduled ? " day-task-chip-scheduled" : ""}${dragOver ? " drag-over" : ""}`}
      draggable
      onDragStart={(event) => onDragStart(event, task.id)}
      onDragEnd={onDragEnd}
      onDragOver={onDrop ? (event) => event.preventDefault() : undefined}
      onDragEnter={() => onDragEnter?.()}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onDragLeave?.();
      }}
      onDrop={onDrop}
    >
      <Link to={`/tasks/${task.id}`} draggable={false} title={task.title}>{task.title}</Link>
      {scheduled && <span className="week-task-ok" title="Fully scheduled this week">✓</span>}
      {reason !== null && <span className="day-task-chip-ineligible" title={reason.detail}>!</span>}
      <button
        type="button"
        className="week-task-remove"
        aria-label={removeLabel}
        title={removeLabel}
        onClick={() => onRemove(task.id)}
      >×</button>
    </div>
  );
}

export function SchedulePage() {
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [weather, setWeather] = useState<WeatherForecast[]>([]);
  const [sleepSessions, setSleepSessions] = useState<SleepSession[]>([]);
  const [healthActivities, setHealthActivities] = useState<HealthActivity[]>([]);
  const [garmin, setGarmin] = useState<IntegrationSummary | null>(null);
  const [rangeStart, setRangeStart] = useState(() => startOfDay(new Date()));
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [dragOverRow, setDragOverRow] = useState<number | null>(null);
  const [draggingBlockId, setDraggingBlockId] = useState<number | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<number | null>(null);
  const [dragOverDay, setDragOverDay] = useState<string | null>(null);
  const blockGrabOffsetMinutes = useRef(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const calendar = useRef<HTMLDivElement>(null);
  const calendarHead = useRef<HTMLDivElement>(null);
  // Hour-row height. Auto-fit so the 8am-8pm window fills the visible calendar box, so the
  // useful day is always reachable without scrolling (Google Calendar-style day scale).
  const [hourHeight, setHourHeight] = useState(48);

  async function load() {
    try {
      const [nextSchedule, nextTasks, nextTags] = await Promise.all([
        api.schedule(),
        api.tasks(),
        api.tags(),
      ]);
      setSchedule(nextSchedule);
      setTasks(nextTasks);
      setTags(nextTags);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }

  // Weather follows the visible week (plus a day of slack) so navigating back to a past week shows
  // the stored forecast hours for those days, not just the fresh cache.
  async function loadWeather() {
    const from = addDays(rangeStart, -1).toISOString();
    const to = addDays(rangeStart, 8).toISOString();
    try {
      setWeather(await api.weather(from, to));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    void loadWeather();
  }, [rangeStart]);

  // The integration is gated on authentication: only ask for (and render) Garmin context once a
  // token store exists. `connected` comes from GET /api/integrations, so this stays generic.
  const garminConnected = garmin?.connected ?? false;

  async function loadIntegrations() {
    try {
      const list = await api.integrations();
      setGarmin(list.find((entry) => entry.key === "garmin") ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }

  useEffect(() => {
    void loadIntegrations();
  }, []);

  async function loadHealth() {
    const from = addDays(rangeStart, -1).toISOString();
    const to = addDays(rangeStart, 8).toISOString();
    try {
      const [nextSleep, nextActivities] = await Promise.all([
        api.healthObservations(from, to),
        api.healthActivities(from, to),
      ]);
      setSleepSessions(nextSleep);
      setHealthActivities(nextActivities);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }

  // Health context follows the visible week (borrowing a day on each side for overnight windows).
  // Without Garmin authentication nothing is fetched, matching the pre-integration app.
  useEffect(() => {
    if (garminConnected) void loadHealth();
    else {
      setSleepSessions([]);
      setHealthActivities([]);
    }
  }, [rangeStart, garminConnected]);

  async function syncGarmin() {
    setSyncing(true);
    try {
      await api.garminSync();
      await Promise.all([loadIntegrations(), loadHealth()]);
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : String(syncError));
    } finally {
      setSyncing(false);
    }
  }

  /** Fit the day scale: (visible box height − sticky head) ÷ the 8am-8pm window. */
  useEffect(() => {
    const container = calendar.current;
    const head = calendarHead.current;
    if (!container || !head) return;
    const box = container;
    const stickyHead = head;
    function fit() {
      const hour = (box.clientHeight - stickyHead.clientHeight) / (DAY_END_HOUR - DAY_START_HOUR);
      setHourHeight(Math.min(60, Math.max(40, hour)));
    }
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    observer.observe(stickyHead);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const today = new Date();
    const hour = today >= rangeStart && today < addDays(rangeStart, 7)
      ? Math.max(0, today.getHours() - 1)
      : 7;
    if (calendar.current) calendar.current.scrollTop = hour * hourHeight;
  }, [rangeStart]);

  async function generate() {
    setBusy(true);
    try {
      setSchedule(await api.generateSchedule());
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  }

  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const tagIdByPublicId = new Map(tags.map((tag) => [tag.publicId, tag.id]));
  const dayTagIdSet = new Set(
    weekdayTagPublicIds
      .map((publicId) => tagIdByPublicId.get(publicId))
      .filter((id): id is number => id !== undefined),
  );

  // ---- Tag mutations behind the lists ----

  /** Tag ids that put a task in a list: strips other day tags, adds the day if given. */
  function listTags(task: TaskSummary, dayPublicId: string | null): number[] {
    const ids = new Set(directTagIds(task).filter((id) => !dayTagIdSet.has(id)));
    const dayId = dayPublicId === null ? undefined : tagIdByPublicId.get(dayPublicId);
    if (dayId !== undefined) ids.add(dayId);
    return [...ids];
  }

  async function applyTags(taskId: number, tagIds: number[]) {
    try {
      await api.updateTask(taskId, { tagIds });
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    }
  }

  async function assignDay(taskId: number, dayPublicId: string) {
    const task = taskById.get(taskId);
    const dayId = tagIdByPublicId.get(dayPublicId);
    if (!task || dayId === undefined) return;
    const next = listTags(task, dayPublicId);
    if (sameIds(directTagIds(task), next)) return;
    await applyTags(taskId, next);
  }

  async function clearDay(taskId: number) {
    const task = taskById.get(taskId);
    if (!task) return;
    const next = listTags(task, null);
    if (sameIds(directTagIds(task), next)) return;
    await applyTags(taskId, next);
  }

  /** "Remove" from the proposal list: no tag to remove any more, so this archives the task instead. */
  async function removeFromProposal(taskId: number) {
    try {
      await api.setLifecycle(taskId, "archived");
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    }
  }

  /**
   * Drop a card onto another: put the dragged task above the target and re-rank the whole
   * destination list (same pattern as the kanban board's moveTask). `dayPublicId` is the list
   * the drop happened in — null for the This week list; the dragged task is moved into that
   * list via its tags when it wasn't already there.
   */
  async function reorderInList(event: DragEvent<HTMLDivElement>, listTasks: TaskSummary[], beforeTaskId: number, dayPublicId: string | null) {
    event.preventDefault();
    event.stopPropagation();
    const taskId = Number(event.dataTransfer.getData("taskId"));
    if (!Number.isInteger(taskId) || taskId === beforeTaskId) return;
    const task = taskById.get(taskId);
    if (!task) return;
    const destination = [...listTasks].sort((a, b) => b.rank - a.rank).filter((item) => item.id !== taskId);
    const beforeIndex = destination.findIndex((item) => item.id === beforeTaskId);
    if (beforeIndex === -1) return;
    destination.splice(beforeIndex, 0, task);
    try {
      await Promise.all(destination.map(async (item, index) => {
        const input: UpdateTaskInput = {};
        const rank = destination.length - index;
        if (item.id === taskId) {
          const next = listTags(item, dayPublicId);
          if (!sameIds(directTagIds(item), next)) input.tagIds = next;
        }
        if (taskById.get(item.id)!.rank !== rank) input.rank = rank;
        if (Object.keys(input).length > 0) await api.updateTask(item.id, input);
      }));
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    }
  }

  // ---- Drag & drop (native HTML5, same pattern as the kanban board) ----

  function startDrag(event: DragEvent<HTMLDivElement>, taskId: number) {
    event.dataTransfer.setData("taskId", String(taskId));
    event.dataTransfer.effectAllowed = "move";
    setDraggingTaskId(taskId);
  }

  function endDrag() {
    setDragOverColumn(null);
    setDragOverRow(null);
    setDraggingTaskId(null);
    setDragOverDay(null);
  }

  function leaveColumn(event: DragEvent<HTMLElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOverColumn(null);
  }

  function dropOnThisWeek(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragOverColumn(null);
    setDragOverRow(null);
    const taskId = Number(event.dataTransfer.getData("taskId"));
    if (Number.isInteger(taskId)) void clearDay(taskId);
  }

  function dropOnDay(event: DragEvent<HTMLElement>, dayPublicId: string) {
    event.preventDefault();
    setDragOverColumn(null);
    setDragOverRow(null);
    const taskId = Number(event.dataTransfer.getData("taskId"));
    if (Number.isInteger(taskId)) void assignDay(taskId, dayPublicId);
  }

  // ---- Drag & drop: move a proposed time block to a new day/time ----

  function startBlockDrag(event: DragEvent<HTMLElement>, blockId: number) {
    event.dataTransfer.setData("timeBlockId", String(blockId));
    event.dataTransfer.effectAllowed = "move";
    const rect = event.currentTarget.getBoundingClientRect();
    // Remember where in the block the drag started so it stays under the cursor.
    blockGrabOffsetMinutes.current = Math.max(0, (event.clientY - rect.top) / hourHeight * 60);
    setDraggingBlockId(blockId);
  }

  function endBlockDrag() {
    setDraggingBlockId(null);
    setDragOverDay(null);
  }

  function leaveDay(event: DragEvent<HTMLElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOverDay(null);
  }

  /**
   * Drop on a day column: move a dragged proposed block to that time, or — human-driven scheduling —
   * place a dragged task at that time as a manual block. Both snap to the slot grid.
   */
  async function dropOnCalendarDay(event: DragEvent<HTMLElement>, day: Date) {
    const blockRaw = event.dataTransfer.getData("timeBlockId");
    const taskRaw = event.dataTransfer.getData("taskId");
    setDraggingBlockId(null);
    setDraggingTaskId(null);
    setDragOverDay(null);
    if (blockRaw === "" && taskRaw === "") return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    if (blockRaw !== "") {
      const block = schedule?.timeBlocks.find((entry) => entry.id === Number(blockRaw));
      if (!block || block.status !== "proposed") return;
      const durationMinutes = (new Date(block.endAt).getTime() - new Date(block.startAt).getTime()) / 60_000;
      const cursorMinutes = (event.clientY - rect.top) / hourHeight * 60 - blockGrabOffsetMinutes.current;
      try {
        await api.updateTimeBlock(block.id, blockWindow(day, cursorMinutes, durationMinutes));
        await load();
      } catch (moveError) {
        setError(moveError instanceof Error ? moveError.message : String(moveError));
      }
      return;
    }
    const task = taskById.get(Number(taskRaw));
    if (!task) return;
    // Place the task's whole remaining estimate (or a default slot when it has no estimate).
    const durationMinutes = task.durationMinutesRemaining !== null && task.durationMinutesRemaining > 0
      ? task.durationMinutesRemaining
      : BLOCK_MOVE_SNAP_MINUTES;
    const cursorMinutes = (event.clientY - rect.top) / hourHeight * 60;
    try {
      await api.createTimeBlock({ taskId: task.id, ...blockWindow(day, cursorMinutes, durationMinutes), status: "proposed" });
      await load();
    } catch (placeError) {
      setError(placeError instanceof Error ? placeError.message : String(placeError));
    }
  }

  const now = new Date();
  const days = Array.from({ length: 7 }, (_, index) => addDays(rangeStart, index));
  const rangeEnd = addDays(rangeStart, 7);
  const committed = tasks.filter(isProposed);
  const thisWeekTasks = committed.filter((task) => dayTagIndex(task) === -1).sort((a, b) => b.rank - a.rank);

  // Minutes of non-superseded, non-missed blocks per task; calendar events are real blocks too,
  // so a task is fully scheduled when its blocks cover its remaining estimate (creating and
  // deleting blocks already moves minutes in and out of `durationMinutesRemaining`).
  const blockMinutesByTask = new Map<number, number>();
  for (const block of schedule?.timeBlocks ?? []) {
    if (block.status === "superseded" || block.status === "missed") continue;
    const minutes = (new Date(block.endAt).getTime() - new Date(block.startAt).getTime()) / 60_000;
    blockMinutesByTask.set(block.taskId, (blockMinutesByTask.get(block.taskId) ?? 0) + minutes);
  }
  const isFullyScheduled = (task: TaskSummary): boolean => task.durationMinutesRemaining !== null
    && (blockMinutesByTask.get(task.id) ?? 0) >= task.durationMinutesRemaining;

  const visibleBlocks = (schedule?.timeBlocks ?? [])
    .filter((block) => block.status !== "superseded" && (
      new Date(block.startAt) < rangeEnd && new Date(block.endAt) > rangeStart
    ))
    .map((block) => ({ ...block, key: `block-${block.id}` }));
  const rangeLabel = `${rangeStart.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })} - ${addDays(rangeStart, 6).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;

  // High temp + max rain chance per day, condensed from the hourly Boston forecast cache
  // into a single line in each calendar day header.
  const dayWeather = new Map<string, { high: number; rain: number }>();
  const dayHourly = new Map<string, WeatherForecast[]>();
  for (const item of weather) {
    const key = startOfDay(new Date(item.forecastAt)).toISOString();
    const current = dayWeather.get(key) ?? { high: -Infinity, rain: 0 };
    dayWeather.set(key, {
      high: item.temperatureF !== null ? Math.max(current.high, item.temperatureF) : current.high,
      rain: Math.max(current.rain, item.precipitationProbability ?? 0),
    });
    const hourly = dayHourly.get(key);
    if (hourly) hourly.push(item);
    else dayHourly.set(key, [item]);
  }
  for (const list of dayHourly.values()) {
    list.sort((a, b) => new Date(a.forecastAt).getTime() - new Date(b.forecastAt).getTime());
  }

  return <main className="schedule-shell">
    {error && <div className="error-banner">{error}</div>}
    <section className="calendar-navbar">
      <div className="button-row">
        <button onClick={() => setRangeStart(addDays(rangeStart, -7))} aria-label="Previous seven days">‹</button>
        <button onClick={() => setRangeStart(startOfDay(new Date()))}>Today</button>
        <button onClick={() => setRangeStart(addDays(rangeStart, 7))} aria-label="Next seven days">›</button>
      </div>
      <h2>{rangeLabel}</h2>
      <button className="primary-button" disabled={busy} onClick={() => void generate()}>
        {busy ? "Optimizing..." : "Generate schedule"}
      </button>
      {garmin?.connected && <div className="garmin-sync">
        <button onClick={() => void syncGarmin()} disabled={syncing}>
          {syncing ? "Syncing Garmin..." : "Sync Garmin"}
        </button>
        {garmin.lastError
          ? <span className="garmin-sync-error" title={garmin.lastError}>Garmin error</span>
          : garmin.lastSyncedAt
            ? <span className="muted">Synced {new Date(garmin.lastSyncedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
            : <span className="muted">Never synced</span>}
      </div>}
    </section>
    <div className={`schedule-body${sidebarCollapsed ? " schedule-body-collapsed" : ""}`}>
      <div
        className="calendar-scroll"
        ref={calendar}
        style={{ "--hour-height": `${hourHeight}px` } as CSSProperties}
      >
        <div className="calendar-head" ref={calendarHead}>
          <div className="calendar-grid">
            <div className="calendar-corner" />
            {days.map((day) => {
              const forecast = dayWeather.get(day.toISOString());
              const high = forecast !== undefined && Number.isFinite(forecast.high)
                ? Math.round(forecast.high)
                : null;
              const rain = forecast?.rain ?? 0;
              const hourly = dayHourly.get(day.toISOString()) ?? [];
              return (
                <header
                  className={`calendar-day-heading ${sameDay(day, now) ? "today" : ""} ${day < startOfDay(now) ? "past" : ""}`}
                  key={day.toISOString()}
                >
                  <span>{day.toLocaleDateString(undefined, { weekday: "short" })}</span>
                  <strong>{day.getDate()}</strong>
                  {hourly.length > 0 && <details className="day-weather">
                    <summary
                      className={`calendar-day-weather${rain >= 25 ? " rainy" : ""}`}
                      title={`High ${high ?? "-"}°, up to ${Math.round(rain)}% rain — click for hourly`}
                    >
                      {high !== null ? `${high}°` : "—"}{rain >= 25 ? ` ${Math.round(rain)}%` : ""}
                    </summary>
                    <div className="day-weather-hourly">
                      {hourly.map((item) => {
                        const itemRain = item.precipitationProbability ?? 0;
                        return <div key={item.forecastAt}>
                          <time>{new Date(item.forecastAt).toLocaleString(undefined, { hour: "numeric" })}</time>
                          <span>{item.temperatureF ?? "-"}°</span>
                          <span className={itemRain >= 25 ? "rainy" : ""}>{Math.round(itemRain)}%</span>
                        </div>;
                      })}
                    </div>
                  </details>}
                </header>
              );
            })}
            <div className="calendar-chip-gutter" aria-hidden="true" />
            {days.map((day) => {
              const dayIndex = day.getDay();
              // getDay() is 0..6 and weekdayTagPublicIds has one entry per weekday.
              const dayPublicId = weekdayTagPublicIds[dayIndex]!;
              const columnKey = day.toISOString();
              const columnTasks = committed
                .filter((task) => dayTagIndex(task) === dayIndex)
                .sort((a, b) => b.rank - a.rank);
              return (
                <section
                  key={columnKey}
                  className={`calendar-chip-cell${dragOverColumn === columnKey ? " drag-over" : ""}`}
                  onDragOver={(event) => event.preventDefault()}
                  onDragEnter={() => setDragOverColumn(columnKey)}
                  onDragLeave={leaveColumn}
                  onDrop={(event) => dropOnDay(event, dayPublicId)}
                >
                  {columnTasks.map((task) => (
                    <DayTaskChip
                      key={task.id}
                      task={task}
                      scheduled={isFullyScheduled(task)}
                      removeLabel={`Unpin from ${day.toLocaleDateString(undefined, { weekday: "long" })}`}
                      onRemove={(taskId) => void clearDay(taskId)}
                      onDragStart={startDrag}
                      onDragEnd={endDrag}
                      onDrop={(event) => void reorderInList(event, columnTasks, task.id, dayPublicId)}
                      dragOver={dragOverRow === task.id}
                      onDragEnter={() => setDragOverRow(task.id)}
                      onDragLeave={() => setDragOverRow(null)}
                    />
                  ))}
                  {columnTasks.length === 0 && <span className="calendar-chip-empty">Drop a task to pin it</span>}
                </section>
              );
            })}
          </div>
        </div>
        <div className="calendar-grid">
          <div className="time-gutter">
            {Array.from({ length: 24 }, (_, hour) => <time key={hour} style={{ top: hour * hourHeight }}>
              {new Date(2020, 0, 1, hour).toLocaleTimeString([], { hour: "numeric" })}
            </time>)}
          </div>
          {days.map((day) => {
            const dayEnd = addDays(day, 1);
            const blocks = visibleBlocks.filter((block) => (
              new Date(block.startAt) < dayEnd && new Date(block.endAt) > day
            ));
            const elapsedMinutes = sameDay(day, now)
              ? now.getHours() * 60 + now.getMinutes()
              : day < startOfDay(now) ? 1440 : 0;

            const dayKey = day.toISOString();
            const dragging = draggingBlockId !== null || draggingTaskId !== null;
            return <section
              className={`calendar-day${dragOverDay === dayKey ? " drag-over" : ""}`}
              key={dayKey}
              onDragOver={(event) => { if (dragging) event.preventDefault(); }}
              onDragEnter={() => { if (dragging) setDragOverDay(dayKey); }}
              onDragLeave={leaveDay}
              onDrop={(event) => void dropOnCalendarDay(event, day)}
            >
              {elapsedMinutes > 0 && <div
                className="elapsed-time"
                style={{ height: elapsedMinutes * hourHeight / 60 }}
              />}
              {sleepSessions
                .filter((session) => new Date(session.startAt) < dayEnd && new Date(session.endAt) > day)
                .map((session) => <HealthEvent
                  key={`sleep-${session.publicId}`}
                  kind="sleep"
                  startAt={session.startAt}
                  endAt={session.endAt}
                  href={`/health_observation/${session.id}`}
                  title="Sleep"
                  subtitle={[
                    session.sleepScore !== null ? `Score ${session.sleepScore}` : "",
                    formatMinutes(session.totalSleepMinutes),
                  ].filter(Boolean).join(" \u00b7 ")}
                  day={day}
                  dayEnd={dayEnd}
                  hourHeight={hourHeight}
                />)}
              {healthActivities
                .filter((activity) => new Date(activity.startAt) < dayEnd && new Date(activity.endAt) > day)
                .map((activity) => <HealthEvent
                  key={`activity-${activity.publicId}`}
                  kind="activity"
                  startAt={activity.startAt}
                  endAt={activity.endAt}
                  href={`/health_activity/${activity.id}`}
                  title={activity.title ?? activity.providerTitle}
                  subtitle={[
                    activity.activityType,
                    formatMinutes(activity.movingMinutes) ? `${formatMinutes(activity.movingMinutes)} moving` : "",
                    activity.calories !== null ? `${Math.round(activity.calories)} cal` : "",
                  ].filter(Boolean).join(" \u00b7 ")}
                  day={day}
                  dayEnd={dayEnd}
                  hourHeight={hourHeight}
                />)}
              {blocks.map((block) => {
                const start = new Date(Math.max(new Date(block.startAt).getTime(), day.getTime()));
                const end = new Date(Math.min(new Date(block.endAt).getTime(), dayEnd.getTime()));
                const top = (start.getHours() * 60 + start.getMinutes()) * hourHeight / 60;
                // Blocks up to ~90 minutes are too short for the stacked layout (status + a
                // separate Accept button); render them as a single row so the Accept action
                // stays inside the box (and never gets clipped by overflow: hidden).
                const timeHeight = (end.getTime() - start.getTime()) / 3_600_000 * hourHeight;
                const compact = timeHeight < hourHeight * 2;
                // A 30-minute slot maps to 24px, which is shorter than the two-line layout
                // (time + title); give short proposed/accepted blocks a floor so the whole
                // layout fits (real calendar commitments keep their true size).
                const twoLine = block.status === "proposed" || block.status === "accepted";
                const height = Math.max(compact && twoLine ? 32 : 24, timeHeight);
                const task = taskById.get(block.taskId);
                const startLabel = new Date(block.startAt).toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                });
                const endLabel = new Date(block.endAt).toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                });
                const title = task?.title ?? `Task ${block.taskId}`;
                // Calendar imports are fixed commitments the solver cannot move; tint them like the
                // Garmin health windows so they read as external time rather than schedulable work.
                const fixed = block.type === "calendar_event";
                // Proposed blocks can be dragged to a new time; accepted/imported blocks cannot.
                const movable = block.status === "proposed" && !fixed;

                return <article
                  className={`calendar-event block-${block.status}${fixed ? " calendar-event-fixed" : ""} ${compact ? "calendar-event-compact" : ""} ${new Date(block.endAt) <= now ? "schedule-past" : ""}${movable ? " calendar-event-movable" : ""}${draggingBlockId === block.id ? " calendar-event-dragging" : ""}`}
                  key={`${block.key}-${day.toISOString()}`}
                  style={{ top, height }}
                  title={`${title}: ${startLabel} - ${endLabel}${movable ? " — drag to move" : ""}`}
                  draggable={movable}
                  onDragStart={(event) => { if (movable) startBlockDrag(event, block.id); }}
                  onDragEnd={endBlockDrag}
                >
                  <div className="calendar-event-summary">
                    <time>{compact ? startLabel : `${startLabel} - ${endLabel}`}</time>
                    <Link to={`/tasks/${block.taskId}`} draggable={false}><strong>{title}</strong></Link>
                    {compact && block.status === "proposed" && <button
                      aria-label={`Accept ${title}`}
                      onClick={() => void api.acceptTaskSchedule(block.taskId).then(setSchedule)}
                    >Accept</button>}
                  </div>
                  {!compact && <span>{fixed ? "calendar event" : block.status}</span>}
                  {!compact && block.status === "proposed" && <button
                    onClick={() => void api.acceptTaskSchedule(block.taskId).then(setSchedule)}
                  >Accept</button>}
                </article>;
              })}
            </section>;
          })}
        </div>
      </div>
      <aside className={`this-week-panel${sidebarCollapsed ? " this-week-panel-collapsed" : ""}`}>
        {sidebarCollapsed ? (
          <button
            className="panel-toggle panel-toggle-expand"
            onClick={() => setSidebarCollapsed(false)}
            title="Show the tasks waiting to be scheduled"
          >
            To schedule {thisWeekTasks.length}
          </button>
        ) : (
          <>
            <div className="week-panel-head">
              <span className="eyebrow">Ready to schedule</span>
              <span className="week-picks-count">{committed.length}</span>
              <button
                className="panel-toggle"
                onClick={() => setSidebarCollapsed(true)}
                aria-label="Hide proposed list"
                title="Hide proposed list"
              >−</button>
            </div>
            <p className="muted">
              Every open task with time remaining, which is what the scheduler will place. Drag one onto a day header
              to pin it there, or into the calendar to schedule it at that time; drag one onto another task to reorder
              it — ✓ marks tasks already fully scheduled. Drag a placed block to a new time to move it; accepted blocks
              stay put when you regenerate.
            </p>
            <div
              className={`week-picks${dragOverColumn === "this-week" ? " drag-over" : ""}`}
              onDragOver={(event) => event.preventDefault()}
              onDragEnter={() => setDragOverColumn("this-week")}
              onDragLeave={leaveColumn}
              onDrop={dropOnThisWeek}
            >
              {thisWeekTasks.map((task) => (
                <WeekTaskRow
                  key={task.id}
                  task={task}
                  scheduled={isFullyScheduled(task)}
                  removeLabel="Remove from this week"
                  onRemove={(taskId) => void removeFromProposal(taskId)}
                  onDragStart={startDrag}
                  onDragEnd={endDrag}
                  onCardDrop={(event) => void reorderInList(event, thisWeekTasks, task.id, null)}
                  dragOver={dragOverRow === task.id}
                  onDragEnter={() => setDragOverRow(task.id)}
                  onDragLeave={() => setDragOverRow(null)}
                />
              ))}
              {thisWeekTasks.length === 0 && <p className="week-task-empty">Nothing to schedule — every open task is either finished, archived, or has no time estimate.</p>}
            </div>
          </>
        )}
      </aside>
    </div>
    {schedule?.scores && <p className="muted schedule-scores">
      Placed {schedule.scores.decision.placed}/{schedule.scores.decision.of}
      {" · "}style {schedule.scores.style}
    </p>}
    {schedule && schedule.unscheduled.length > 0 && <section className="unscheduled">
      <div className="section-label">Unscheduled</div>
      <h2>Tasks without calendar space</h2>
      <ul className="unscheduled-list">
        {schedule.unscheduled.map((entry) => <li key={entry.taskId}>
          <Link to={`/tasks/${entry.taskId}`}>{taskById.get(entry.taskId)?.title ?? `Task ${entry.taskId}`}</Link>
          <span className="muted">{entry.reasons.map((reason) => reason.detail).join(" · ")}</span>
        </li>)}
      </ul>
    </section>}
  </main>;
}