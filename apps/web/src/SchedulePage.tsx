import {
  reservedTagPublicIds,
  weekdayTagPublicIds,
  type Schedule,
  type Tag,
  type TaskSummary,
  type TimeBlockStatus,
  type UpdateTaskInput,
  type WeatherForecast,
} from "@mind-palace/shared";
import { useEffect, useRef, useState, type CSSProperties, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "./api";

const DAY_START_HOUR = 8;
const DAY_END_HOUR = 20; // 8am-8pm: the useful day the calendar should fit without scrolling

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

/** A task is committed to the week when this-week (a direct or ancestor tag) is present. */
function hasThisWeek(task: TaskSummary): boolean {
  return effectiveTagIds(task).includes(reservedTagPublicIds.thisWeek);
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

const terminalStatuses = new Set(["completed", "cancelled"]);

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

// Collapse adjacent blocks of the same task (e.g. consecutive 30-minute solver
// chunks) into one event in the UI. Adjacency is judged on the times as they
// appear in this day column, so blocks that touch across midnight still merge.
function mergeAdjacentBlocks(
  blocks: Array<{ key: string; taskId: number; startAt: string; endAt: string; status: TimeBlockStatus }>,
  day: Date,
  dayEnd: Date,
): Array<{ key: string; taskId: number; startAt: string; endAt: string; status: TimeBlockStatus }> {
  const sorted = [...blocks].sort((left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime());
  const merged: typeof blocks = [];
  for (const block of sorted) {
    const previous = merged[merged.length - 1];
    const previousEnd = previous
      ? new Date(Math.min(new Date(previous.endAt).getTime(), dayEnd.getTime()))
      : null;
    const blockStart = new Date(Math.max(new Date(block.startAt).getTime(), day.getTime()));
    if (
      previous && previousEnd
      && previous.taskId === block.taskId
      && previous.status === block.status
      && previousEnd.getTime() === blockStart.getTime()
    ) {
      merged[merged.length - 1] = { ...previous, endAt: block.endAt };
    } else {
      merged.push(block);
    }
  }
  return merged;
}

export function SchedulePage() {
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [weather, setWeather] = useState<WeatherForecast[]>([]);
  const [rangeStart, setRangeStart] = useState(() => startOfDay(new Date()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [dragOverRow, setDragOverRow] = useState<number | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const calendar = useRef<HTMLDivElement>(null);
  const calendarHead = useRef<HTMLDivElement>(null);
  // Hour-row height. Auto-fit so the 8am-8pm window fills the visible calendar box, so the
  // useful day is always reachable without scrolling (Google Calendar-style day scale).
  const [hourHeight, setHourHeight] = useState(48);

  async function load() {
    try {
      const [nextSchedule, nextTasks, nextTags, nextWeather] = await Promise.all([
        api.schedule(),
        api.tasks(),
        api.tags(),
        api.weather(),
      ]);
      setSchedule(nextSchedule);
      setTasks(nextTasks);
      setTags(nextTags);
      setWeather(nextWeather);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }

  useEffect(() => {
    void load();
  }, []);

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
  const thisWeekTagId = tagIdByPublicId.get(reservedTagPublicIds.thisWeek);
  const dayTagIdSet = new Set(
    weekdayTagPublicIds
      .map((publicId) => tagIdByPublicId.get(publicId))
      .filter((id): id is number => id !== undefined),
  );

  // ---- Tag mutations behind the lists ----

  /** Tag ids that put a task in a list: strips other day tags, keeps this-week, adds the day if given. */
  function listTags(task: TaskSummary, dayPublicId: string | null): number[] {
    const ids = new Set(directTagIds(task).filter((id) => !dayTagIdSet.has(id)));
    if (thisWeekTagId !== undefined) ids.add(thisWeekTagId);
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
    if (!task || dayId === undefined || thisWeekTagId === undefined) return;
    const next = listTags(task, dayPublicId);
    if (sameIds(directTagIds(task), next)) return;
    await applyTags(taskId, next);
  }

  async function clearDay(taskId: number) {
    const task = taskById.get(taskId);
    if (!task || thisWeekTagId === undefined) return;
    const next = listTags(task, null);
    if (sameIds(directTagIds(task), next)) return;
    await applyTags(taskId, next);
  }

  async function removeFromThisWeek(taskId: number) {
    const task = taskById.get(taskId);
    if (!task) return;
    const next = directTagIds(task).filter((id) => id !== thisWeekTagId && !dayTagIdSet.has(id));
    if (sameIds(directTagIds(task), next)) return;
    await applyTags(taskId, next);
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
  }

  function endDrag() {
    setDragOverColumn(null);
    setDragOverRow(null);
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

  const now = new Date();
  const days = Array.from({ length: 7 }, (_, index) => addDays(rangeStart, index));
  const rangeEnd = addDays(rangeStart, 7);
  const committed = tasks.filter((task) => hasThisWeek(task) && !terminalStatuses.has(task.kanbanStatus));
  const thisWeekTasks = committed.filter((task) => dayTagIndex(task) === -1).sort((a, b) => b.rank - a.rank);
  // Tasks shown as proposed but that the scheduler will skip (see `schedulabilityReason`).
  const unSchedulableCount = committed.filter((task) => schedulabilityReason(task) !== null).length;

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

  // High temp + max rain chance per day, condensed from the 3-hourly Boston forecast cache
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
            const blocks = mergeAdjacentBlocks(
              visibleBlocks.filter((block) => (
                new Date(block.startAt) < dayEnd && new Date(block.endAt) > day
              )),
              day,
              dayEnd,
            );
            const elapsedMinutes = sameDay(day, now)
              ? now.getHours() * 60 + now.getMinutes()
              : day < startOfDay(now) ? 1440 : 0;

            return <section className="calendar-day" key={day.toISOString()}>
              {elapsedMinutes > 0 && <div
                className="elapsed-time"
                style={{ height: elapsedMinutes * hourHeight / 60 }}
              />}
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

                return <article
                  className={`calendar-event block-${block.status} ${compact ? "calendar-event-compact" : ""} ${new Date(block.endAt) <= now ? "schedule-past" : ""}`}
                  key={`${block.key}-${day.toISOString()}`}
                  style={{ top, height }}
                  title={`${title}: ${startLabel} - ${endLabel}`}
                >
                  <div className="calendar-event-summary">
                    <time>{compact ? startLabel : `${startLabel} - ${endLabel}`}</time>
                    <Link to={`/tasks/${block.taskId}`}><strong>{title}</strong></Link>
                    {compact && block.status === "proposed" && <button
                      aria-label={`Accept ${title}`}
                      onClick={() => void api.acceptTaskSchedule(block.taskId).then(setSchedule)}
                    >Accept</button>}
                  </div>
                  {!compact && <span>{block.status}</span>}
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
            title="Show proposed this week"
          >
            Proposed {thisWeekTasks.length}
          </button>
        ) : (
          <>
            <div className="week-panel-head">
              <span className="eyebrow">Proposed for this week</span>
              <span className="week-picks-count">{committed.length}</span>
              <button
                className="panel-toggle"
                onClick={() => setSidebarCollapsed(true)}
                aria-label="Hide proposed list"
                title="Hide proposed list"
              >−</button>
            </div>
            <p className="muted">
              Tasks you picked with “Add to this week” on the board. Drag one onto a day in the calendar to pin it
              there, or onto another task to reorder it — ✓ marks tasks already fully scheduled.
            </p>
            {unSchedulableCount > 0 && <p className="muted week-tasks-warning">
              {unSchedulableCount} of {committed.length} proposed task{unSchedulableCount === 1 ? "" : "s"} can’t be scheduled yet —
              hover the “not ready” / “no estimate” badges for details.
            </p>}
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
                  onRemove={(taskId) => void removeFromThisWeek(taskId)}
                  onDragStart={startDrag}
                  onDragEnd={endDrag}
                  onCardDrop={(event) => void reorderInList(event, thisWeekTasks, task.id, null)}
                  dragOver={dragOverRow === task.id}
                  onDragEnter={() => setDragOverRow(task.id)}
                  onDragLeave={() => setDragOverRow(null)}
                />
              ))}
              {thisWeekTasks.length === 0 && <p className="week-task-empty">Nothing proposed yet — use “Add to this week” on the board.</p>}
            </div>
          </>
        )}
      </aside>
    </div>
    {schedule && schedule.unscheduledTaskIds.length > 0 && <section className="unscheduled">
      <div className="section-label">Unscheduled</div>
      <h2>Tasks without calendar space</h2>
      {schedule.unscheduledTaskIds.map((id) => <Link key={id} to={`/tasks/${id}`}>
        {taskById.get(id)?.title ?? `Task ${id}`}
      </Link>)}
    </section>}
  </main>;
}