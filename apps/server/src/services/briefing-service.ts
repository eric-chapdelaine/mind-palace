import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TaskRepository } from "@mind-palace/database";
import {
  reservedTagPublicIds,
  weekdayTagPublicIds,
  type BriefingBoardColumn,
  type BriefingBlock,
  type BriefingDay,
  type BriefingPayload,
  type BriefingSection,
  type BriefingTask,
  type BriefingWeatherHour,
  type KanbanStatus,
  type TaskSummary,
  type TimeBlock,
  type WeatherForecast,
} from "@mind-palace/shared";
import { runPythonWorker } from "./worker.js";

/** Page sizes the renderer knows how to lay out (mirrors `PAPER` in workers/briefing). */
export const briefingPapers = ["letter", "a4"] as const;

/** The household's wall clock. The briefing is printed in this zone, never the server's UTC. */
const TIME_ZONE = "America/New_York";

/** Days of blocks/forecast the print covers. */
const WEEK_DAYS = 7;

/**
 * The default page. This list *is* the design: reordering it reorders the print, and a different
 * medium (receipt, e-ink) is a second list rather than a second renderer. Sections are keyed by the
 * `BriefingSection` union, so an entry that does not typecheck cannot reach the worker.
 */
const DEFAULT_LAYOUT: BriefingSection[] = [
  { kind: "weather-day-graph" },
  { kind: "today-schedule" },
  { kind: "today-tasks", descriptionChars: 220 },
  { kind: "week-ahead", days: WEEK_DAYS },
  { kind: "board-snapshot", perColumn: 6 },
];

const boardColumns: Array<{ status: KanbanStatus; label: string }> = [
  { status: "inbox", label: "Inbox" },
  { status: "ready", label: "Ready" },
  { status: "in_progress", label: "In progress" },
  { status: "waiting", label: "Waiting" },
];

// ---- local-time helpers -------------------------------------------------------------------
//
// Everything printed is in `TIME_ZONE`, but every timestamp in the database is UTC. These helpers
// are the single conversion point: repositories hand back ISO strings, the payload carries local
// labels *and* minutes-since-local-midnight, and the renderer only maps minutes to an axis.

const localParts = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  weekday: "short",
});

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string;
  /** `YYYY-MM-DD` in the reference time zone. */
  date: string;
}

function partsOf(instant: Date): LocalParts {
  const fields = new Map(localParts.formatToParts(instant).map((part) => [part.type, part.value]));
  const hour = Number(fields.get("hour")) % 24;
  const year = Number(fields.get("year"));
  const month = Number(fields.get("month"));
  const day = Number(fields.get("day"));
  return {
    year,
    month,
    day,
    hour,
    minute: Number(fields.get("minute")),
    weekday: fields.get("weekday") ?? "",
    date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

/** Signed offset of `TIME_ZONE` at an instant, in milliseconds (local wall clock − UTC). */
function zoneOffsetMs(instant: Date): number {
  const fields = new Map(localParts.formatToParts(instant).map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(fields.get("year")),
    Number(fields.get("month")) - 1,
    Number(fields.get("day")),
    Number(fields.get("hour")) % 24,
    Number(fields.get("minute")),
  );
  return asUtc - Math.floor(instant.getTime() / 60_000) * 60_000;
}

/** The UTC instant of local midnight for a `YYYY-MM-DD` date. */
function startOfLocalDay(date: string): Date {
  const wall = new Date(`${date}T00:00:00Z`);
  return new Date(wall.getTime() - zoneOffsetMs(wall));
}

function addDays(date: string, count: number): string {
  const base = new Date(`${date}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + count);
  return base.toISOString().slice(0, 10);
}

/** Minutes since local midnight of an instant, as printed on a day axis. */
function minuteOfDay(instant: Date): number {
  const parts = partsOf(instant);
  return parts.hour * 60 + parts.minute;
}

/** "7:30 AM" — the clock label the print uses everywhere. */
function clockLabel(instant: Date): string {
  return instant.toLocaleTimeString("en-US", {
    timeZone: TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function shortClock(instant: Date): string {
  const parts = partsOf(instant);
  const hour = parts.hour % 12 || 12;
  const suffix = parts.hour < 12 ? "a" : "p";
  return parts.minute === 0 ? `${hour}${suffix}` : `${hour}:${String(parts.minute).padStart(2, "0")}${suffix}`;
}

function minutesLabel(minutes: number | null): string | null {
  if (minutes === null || minutes <= 0) return null;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return hours > 0 ? `${hours}h${rest === 0 ? "" : ` ${rest}m`}` : `${rest}m`;
}

// ---- payload building ---------------------------------------------------------------------

/** A task is terminal once it is done/cancelled; the board snapshot only wants live work. */
const terminalStatuses = new Set(["completed", "cancelled"]);

export interface BriefingRequest {
  /** `YYYY-MM-DD` in `TIME_ZONE`; defaults to "today" there. */
  date?: string;
  paper?: string;
  layout?: BriefingSection[];
}

export interface BriefingDocument {
  /** Base64 PDF bytes. */
  pdfBase64: string;
  /** Page count from the renderer, for "did this become two pages?" checks. */
  pages: number;
  date: string;
}

/**
 * Orchestrates the daily briefing: gather facts from the repository, shape them into the
 * `BriefingPayload` contract, and hand that to the print worker. It owns no SQL and no markup —
 * the payload is the contract between the two, which is what lets a second medium reuse the facts.
 */
export class BriefingService {
  private readonly workerDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../workers/briefing");

  constructor(private readonly tasks: TaskRepository) {}

  /** Today's date in the reference time zone. */
  today(): string {
    return partsOf(new Date()).date;
  }

  /**
   * Assemble the payload for a date. Pure data: no network, no clock reads beyond "now", so the
   * same inputs always print the same page.
   */
  buildPayload(request: BriefingRequest = {}): BriefingPayload {
    const date = request.date ?? this.today();
    const now = new Date();
    const dayStart = startOfLocalDay(date);
    const dayEnd = startOfLocalDay(addDays(date, 1));
    const weekDays = Array.from({ length: WEEK_DAYS }, (_, index) => addDays(date, index));
    const weekEnd = startOfLocalDay(addDays(date, WEEK_DAYS));

    const tasks = this.tasks.listTasks();
    const taskById = new Map(tasks.map((task) => [task.id, task]));
    const blocks = this.tasks.listTimeBlocks(dayStart.toISOString(), weekEnd.toISOString())
      // Superseded rows are the solver's discarded proposals: never printed.
      .filter((block) => block.status !== "superseded");
    const weather = this.tasks.listWeatherHistory(dayStart.toISOString(), weekEnd.toISOString());

    const todayBlocks = blocks
      .filter((block) => new Date(block.startAt) < dayEnd && new Date(block.endAt) > dayStart)
      .map((block) => this.blockFor(block, taskById, dayStart, dayEnd))
      .sort((left, right) => left.startMinutes - right.startMinutes || left.endMinutes - right.endMinutes);

    const week = weekDays.map((day) => this.weekDay(day, date, blocks, weather, taskById));
    const todayTasks = this.todayTasks(tasks, todayBlocks, date);
    const board = this.board(tasks);
    const attention = this.attention(tasks, date, weekDays);

    return {
      printedAtLabel: clockLabel(now),
      dateLabel: `${weekdayOf(date)}, ${monthDayOf(date)}`,
      timeZone: TIME_ZONE.replace("_", " "),
      facts: {
        weatherHours: this.weatherHours(weather, dayStart, dayEnd),
        todayBlocks,
        todayTasks,
        week,
        board,
        attention,
      },
      layout: request.layout ?? DEFAULT_LAYOUT,
    };
  }

  /** Render the payload to HTML only: the design-iteration loop, and the seam a screen medium uses. */
  async renderHtml(request: BriefingRequest = {}): Promise<string> {
    const payload = this.buildPayload(request);
    const result = await runPythonWorker<{ html: string }>({
      directory: this.workerDirectory,
      script: "render_briefing.py",
      input: { payload, paper: request.paper ?? "letter", action: "html" },
      timeoutMs: 60_000,
      label: "briefing worker",
    });
    return result.html;
  }

  async renderPdf(request: BriefingRequest = {}): Promise<BriefingDocument> {
    const payload = this.buildPayload(request);
    const result = await runPythonWorker<{ pdfBase64: string; pages: number }>({
      directory: this.workerDirectory,
      script: "render_briefing.py",
      input: { payload, paper: request.paper ?? "letter", action: "render" },
      timeoutMs: 90_000,
      label: "briefing worker",
    });
    return { pdfBase64: result.pdfBase64, pages: result.pages, date: request.date ?? this.today() };
  }

  // ---- facts ---------------------------------------------------------------------------

  private blockFor(block: TimeBlock, taskById: Map<number, TaskSummary>, dayStart: Date, dayEnd: Date): BriefingBlock {
    const start = new Date(block.startAt);
    const end = new Date(block.endAt);
    const clampedStart = Math.max(start.getTime(), dayStart.getTime());
    const clampedEnd = Math.min(end.getTime(), dayEnd.getTime());
    // Labels follow the clamped edges: last night's sleep started at 22:30 yesterday, but on
    // today's page it begins at midnight, and a block running past midnight ends at midnight.
    const startInstant = new Date(clampedStart);
    const endInstant = new Date(clampedEnd);
    return {
      taskId: block.taskId,
      title: taskById.get(block.taskId)?.title ?? `Task ${block.taskId}`,
      startLabel: clockLabel(startInstant),
      endLabel: clockLabel(endInstant),
      // A block that started yesterday (sleep) begins at 0; one that runs past midnight ends at 1440.
      startMinutes: Math.round((clampedStart - dayStart.getTime()) / 60_000),
      endMinutes: Math.round((clampedEnd - dayStart.getTime()) / 60_000),
      status: block.status,
      type: block.type,
    };
  }

  private weatherHours(weather: WeatherForecast[], dayStart: Date, dayEnd: Date): BriefingWeatherHour[] {
    return weather
      .filter((hour) => {
        const at = new Date(hour.forecastAt);
        return at >= dayStart && at < dayEnd;
      })
      .map((hour) => {
        const at = new Date(hour.forecastAt);
        return {
          hourLabel: shortClock(at),
          minuteOfDay: minuteOfDay(at),
          temperatureF: hour.temperatureF,
          precipitationProbability: hour.precipitationProbability,
          windMph: hour.windMph,
          isDaytime: hour.isDaytime,
          shortForecast: hour.shortForecast,
        };
      });
  }

  private weekDay(
    date: string,
    todayDate: string,
    blocks: TimeBlock[],
    weather: WeatherForecast[],
    taskById: Map<number, TaskSummary>,
  ): BriefingDay {
    const dayStart = startOfLocalDay(date);
    const dayEnd = startOfLocalDay(addDays(date, 1));
    const dayBlocks = blocks
      .filter((block) => new Date(block.startAt) < dayEnd && new Date(block.endAt) > dayStart)
      .sort((left, right) => left.startAt.localeCompare(right.startAt));
    const dayWeather = weather.filter((hour) => {
      const at = new Date(hour.forecastAt);
      return at >= dayStart && at < dayEnd;
    });
    const temperatures = dayWeather.map((hour) => hour.temperatureF).filter((value): value is number => value !== null);
    const rains = dayWeather.map((hour) => hour.precipitationProbability ?? 0);

    return {
      date,
      weekdayLabel: weekdayOf(date),
      monthDayLabel: monthDayOf(date),
      isToday: date === todayDate,
      highF: temperatures.length > 0 ? Math.round(Math.max(...temperatures)) : null,
      lowF: temperatures.length > 0 ? Math.round(Math.min(...temperatures)) : null,
      rainPercent: rains.length > 0 ? Math.round(Math.max(...rains)) : null,
      blocks: dayBlocks.map((block) => this.blockFor(block, taskById, dayStart, dayEnd)),
      scheduledMinutes: dayBlocks.reduce(
        (total, block) => total + (new Date(block.endAt).getTime() - new Date(block.startAt).getTime()) / 60_000,
        0,
      ),
    };
  }

  /**
   * The tasks that deserve the full-width treatment: everything with a block today, everything
   * pinned to today by a weekday tag, and anything already in progress. Priority first, then the
   * board's own rank order.
   */
  private todayTasks(tasks: TaskSummary[], todayBlocks: BriefingBlock[], date: string): BriefingTask[] {
    const blockedToday = new Set(todayBlocks.map((block) => block.taskId));
    const weekdayIndex = new Date(`${date}T12:00:00Z`).getUTCDay();
    const weekdayTag = weekdayTagPublicIds[weekdayIndex];
    const selected = tasks.filter((task) => {
      if (terminalStatuses.has(task.kanbanStatus)) return false;
      if (blockedToday.has(task.id)) return true;
      if (task.kanbanStatus === "in_progress") return true;
      const tagIds = [...task.tags, ...task.derivedTags].map((tag) => tag.publicId);
      return weekdayTag !== undefined && tagIds.includes(weekdayTag);
    });
    const ordered = selected.sort((left, right) => left.priority - right.priority || right.rank - left.rank);
    // Recurrence leaves one row per day behind ("[LIFE] Sleep" x N). They are separate work items,
    // but on a page they read as a stutter, so an identical title prints once.
    const seen = new Set<string>();
    return ordered
      .filter((task) => {
        const key = task.title.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((task) => this.printTask(task));
  }

  private board(tasks: TaskSummary[]): BriefingBoardColumn[] {
    // Board order is the human's drag order (`rank` desc), same as the web kanban.
    const active = tasks.filter((task) => !terminalStatuses.has(task.kanbanStatus));
    return boardColumns.map((column) => {
      const items = active.filter((task) => task.kanbanStatus === column.status).sort((a, b) => b.rank - a.rank);
      return { status: column.status, label: column.label, tasks: items.map((task) => this.printTask(task)), total: items.length };
    });
  }

  private printTask(task: TaskSummary): BriefingTask {
    return {
      id: task.id,
      title: task.title,
      priority: task.priority,
      durationMinutesRemaining: task.durationMinutesRemaining,
      kanbanStatus: task.kanbanStatus,
      tags: [...task.tags, ...task.derivedTags]
        .map((tag) => tag.title)
        .filter((title, index, all) => all.indexOf(title) === index)
        .slice(0, 4),
      deadlineLabel: this.deadlineLabel(task),
      description: task.description,
    };
  }

  /**
   * "due Wed" / "due today", or null. Overdue work is not labelled per task: the recurrence
   * leftovers in a real board would stamp "overdue" on half the page, and the attention list
   * already carries the count.
   */
  private deadlineLabel(task: TaskSummary): string | null {
    if (!task.deadlineAt) return null;
    const deadline = new Date(task.deadlineAt);
    const today = this.today();
    const deadlineDate = partsOf(deadline).date;
    if (deadlineDate < today) return null;
    if (deadlineDate === today) return "due today";
    const days = Math.round((startOfLocalDay(deadlineDate).getTime() - startOfLocalDay(today).getTime()) / 86_400_000);
    if (days > 14) return null;
    return `due ${weekdayOf(deadlineDate)}`;
  }

  /**
   * Deadlines and releases landing in the window, plus this-week tasks that carry no duration —
   * both are things the print can flag that the day/week views cannot show at a glance.
   */
  private attention(tasks: TaskSummary[], date: string, weekDays: string[]): string[] {
    const window = new Set(weekDays);
    const lines: string[] = [];
    let overdue = 0;
    for (const task of tasks) {
      if (terminalStatuses.has(task.kanbanStatus)) continue;
      if (!task.deadlineAt) continue;
      const deadlineDate = partsOf(new Date(task.deadlineAt)).date;
      // Past-due rows are noise one by one; the count is the signal.
      if (deadlineDate < date) {
        overdue += 1;
      } else if (window.has(deadlineDate)) {
        lines.push(`${task.title} — due ${monthDayOf(deadlineDate)}`);
      }
    }
    if (overdue > 0) {
      lines.push(`${overdue} task${overdue === 1 ? "" : "s"} past due — clear or re-date them`);
    }
    const thisWeekTagged = tasks.filter((task) => {
      if (terminalStatuses.has(task.kanbanStatus)) return false;
      const tagIds = [...task.tags, ...task.derivedTags].map((tag) => tag.publicId);
      return tagIds.includes(reservedTagPublicIds.thisWeek);
    });
    const unschedulable = thisWeekTagged.filter((task) => task.durationMinutesRemaining === null || task.durationMinutesRemaining <= 0);
    if (unschedulable.length > 0) {
      lines.push(`${unschedulable.length} this-week task${unschedulable.length === 1 ? "" : "s"} have no time estimate — the scheduler skips them`);
    }
    return lines.slice(0, 6);
  }
}

function weekdayOf(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
}

function monthDayOf(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
