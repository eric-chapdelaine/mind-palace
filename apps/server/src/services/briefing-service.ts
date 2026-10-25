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
  type BriefingWeatherDay,
  type BriefingWeatherHour,
  type KanbanStatus,
  type TimeBlockSource,
  type TaskSummary,
  type TimeBlock,
  type WeatherForecast,
} from "@mind-palace/shared";
import { runPythonWorker } from "./worker.js";

/** Boston. Sunrise/sunset are computed for this point; the weather cache is for the same place. */
const HOME_LATITUDE = 42.3601;
const HOME_LONGITUDE = -71.0589;

/** Page sizes the renderer knows how to lay out (mirrors `PAPER` in workers/briefing). */
export const briefingPapers = ["letter", "a4"] as const;

/** The household's wall clock. The briefing is printed in this zone, never the server's UTC. */
const TIME_ZONE = "America/New_York";

/** Days of blocks/forecast the print covers. */
const WEEK_DAYS = 7;

/**
 * Routine work is the household's scaffolding: sleep, meals, wind-down. It belongs on the day's
 * timeline (so the page shows what the day actually looks like) but it is not "work to do", so it
 * is excluded from the task lists, the week's due column, and the board snapshot.
 */
function isRoutineTask(task: TaskSummary, routineTagId: string | null): boolean {
  if (task.origin === "recurrence") return true;
  if (routineTagId === null) return false;
  return [...task.tags, ...task.derivedTags].some((tag) => tag.publicId === routineTagId);
}

/**
 * The default page. This list *is* the design: reordering it reorders the print, and a different
 * medium (receipt, e-ink) is a second list rather than a second renderer. Sections are keyed by the
 * `BriefingSection` union, so an entry that does not typecheck cannot reach the worker.
 */
const DEFAULT_LAYOUT: BriefingSection[] = [
  { kind: "weather-day-graph" },
  { kind: "today-schedule" },
  { kind: "today-tasks", descriptionChars: 220, descriptionLines: 4 },
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

/**
 * Parse a timestamp from the database, or null when it is not a real instant.
 *
 * `tasks.deadline_at` is free-form text written by the app and by imports, so one malformed row used
 * to throw `RangeError: Invalid time value` out of `Intl.DateTimeFormat` and turn the whole briefing
 * into an HTTP 400 - no printout at all, from one bad deadline. A task with an unreadable deadline
 * is a task with no deadline for print purposes, which is a far better failure.
 */
function instantOf(value: string | null | undefined): Date | null {
  if (!value) return null;
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? null : instant;
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

/**
 * Sunrise and sunset in minutes since local midnight, from the NOAA solar-position approximation.
 * Accurate to a couple of minutes at this latitude, and it needs no network and no extra column:
 * the point of printing daylight hours is the window, not the second.
 */
function daylightMinutes(date: string): { sunrise: number; sunset: number } {
  const [year, month, day] = date.split("-").map(Number);
  const dayOfYear = Math.floor(
    (Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1) - Date.UTC(year ?? 0, 0, 0)) / 86_400_000,
  );
  const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1);
  const equationOfTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));
  const declination =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);
  const latitude = HOME_LATITUDE * (Math.PI / 180);
  // 90.833 deg: the sun's disc plus standard refraction, the same convention as the almanac.
  const cosHourAngle =
    Math.cos(90.833 * (Math.PI / 180)) / (Math.cos(latitude) * Math.cos(declination)) -
    Math.tan(latitude) * Math.tan(declination);
  const hourAngle = Math.acos(Math.min(1, Math.max(-1, cosHourAngle))) * (180 / Math.PI);
  const solarNoon = 720 - 4 * HOME_LONGITUDE - equationOfTime;
  // Both are UTC minutes; shift by the zone offset so they read as local wall-clock minutes.
  const offset = zoneOffsetMs(startOfLocalDay(date)) / 60_000;
  return { sunrise: solarNoon - 4 * hourAngle + offset, sunset: solarNoon + 4 * hourAngle + offset };
}

/** Peak UV for the day and the hour it lands: what a person needs to know is "when, and how bad". */
function weatherSummary(hours: BriefingWeatherHour[], date: string): BriefingWeatherDay {
  const temperatures = hours.map((hour) => hour.temperatureF).filter((value): value is number => value !== null);
  const rains = hours.map((hour) => hour.precipitationProbability ?? 0);
  const uvs = hours
    .filter((hour) => hour.uvIndex !== null)
    .sort((left, right) => (right.uvIndex ?? 0) - (left.uvIndex ?? 0));
  const peakUv = uvs[0];
  const { sunrise, sunset } = daylightMinutes(date);
  return {
    highF: temperatures.length > 0 ? Math.round(Math.max(...temperatures)) : null,
    lowF: temperatures.length > 0 ? Math.round(Math.min(...temperatures)) : null,
    rainPercent: rains.length > 0 ? Math.round(Math.max(...rains)) : null,
    uvMax: peakUv?.uvIndex ?? null,
    uvMaxLabel: peakUv ? formatMinutes(peakUv.minuteOfDay) : null,
    sunriseLabel: formatMinutes(sunrise),
    sunsetLabel: formatMinutes(sunset),
    sunriseMinutes: Math.round(sunrise),
    sunsetMinutes: Math.round(sunset),
  };
}

/** Minutes since midnight -> "7:07 AM". Only for whole-minute labels, never for block times. */
function formatMinutes(minutes: number): string {
  const total = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hour = Math.floor(total / 60);
  const rest = total % 60;
  const suffix = hour < 12 ? "AM" : "PM";
  return `${hour % 12 || 12}:${String(rest).padStart(2, "0")} ${suffix}`;
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
    const routineTagId = reservedTagPublicIds.routine;
    const routineTaskIds = new Set(
      tasks.filter((task) => isRoutineTask(task, routineTagId)).map((task) => task.id),
    );
    const blocks = this.tasks.listTimeBlocks(dayStart.toISOString(), weekEnd.toISOString())
      // Superseded rows are the solver's discarded proposals: never printed.
      .filter((block) => block.status !== "superseded");
    const weather = this.tasks.listWeatherHistory(dayStart.toISOString(), weekEnd.toISOString());

    const todayBlocks = blocks
      .filter((block) => new Date(block.startAt) < dayEnd && new Date(block.endAt) > dayStart)
      .map((block) => this.blockFor(block, taskById, routineTaskIds, dayStart, dayEnd))
      .sort((left, right) => left.startMinutes - right.startMinutes || left.endMinutes - right.endMinutes);

    const weatherHours = this.weatherHours(weather, dayStart, dayEnd);
    const week = weekDays.map((day) =>
      this.weekDay(day, date, blocks, weather, taskById, tasks, routineTaskIds),
    );
    const todayTasks = this.todayTasks(tasks, todayBlocks, date, routineTaskIds);
    const board = this.board(tasks, routineTaskIds);
    const attention = this.attention(tasks, date, weekDays, routineTaskIds);

    return {
      printedAtLabel: clockLabel(now),
      dateLabel: `${weekdayOf(date)}, ${monthDayOf(date)}`,
      timeZone: TIME_ZONE.replace("_", " "),
      facts: {
        weatherHours,
        weatherDay: weatherSummary(weatherHours, date),
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

  private blockFor(
    block: TimeBlock,
    taskById: Map<number, TaskSummary>,
    routineTaskIds: Set<number>,
    dayStart: Date,
    dayEnd: Date,
  ): BriefingBlock {
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
      source: block.source,
      isRoutine: routineTaskIds.has(block.taskId),
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
          uvIndex: hour.uvIndex,
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
    tasks: TaskSummary[],
    routineTaskIds: Set<number>,
  ): BriefingDay {
    const dayStart = startOfLocalDay(date);
    const dayEnd = startOfLocalDay(addDays(date, 1));
    const dayBlocks = blocks
      .filter((block) => new Date(block.startAt) < dayEnd && new Date(block.endAt) > dayStart)
      // Routine work is the scaffolding of the day, not something to plan around: it stays out of
      // the week columns so the real tasks have room.
      .filter((block) => !routineTaskIds.has(block.taskId))
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
      blocks: dayBlocks.map((block) => this.blockFor(block, taskById, routineTaskIds, dayStart, dayEnd)),
      dueTasks: tasks
        .filter((task) => {
          if (terminalStatuses.has(task.kanbanStatus) || routineTaskIds.has(task.id)) return false;
          const deadline = instantOf(task.deadlineAt);
          return deadline !== null && partsOf(deadline).date === date;
        })
        .sort((left, right) => left.priority - right.priority || right.rank - left.rank)
        .map((task) => this.printTask(task, routineTaskIds)),
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
   *
   * Routine work is excluded: sleep, meals and wind-down are already on today's timeline above, and
   * as full-width cards they crowd out the handful of tasks the page exists to surface.
   */
  private todayTasks(
    tasks: TaskSummary[],
    todayBlocks: BriefingBlock[],
    date: string,
    routineTaskIds: Set<number>,
  ): BriefingTask[] {
    const blockedToday = new Set(todayBlocks.map((block) => block.taskId));
    const weekdayIndex = new Date(`${date}T12:00:00Z`).getUTCDay();
    const weekdayTag = weekdayTagPublicIds[weekdayIndex];
    const selected = tasks.filter((task) => {
      if (terminalStatuses.has(task.kanbanStatus) || routineTaskIds.has(task.id)) return false;
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
      .map((task) => this.printTask(task, routineTaskIds));
  }

  private board(tasks: TaskSummary[], routineTaskIds: Set<number>): BriefingBoardColumn[] {
    // Board order is the human's drag order (`rank` desc), same as the web kanban. Routine rows
    // (recurrence scaffolding like "[LIFE] Wake up") are filtered out here and in the week view:
    // they are already in today's agenda, and they crowd out real work.
    const active = tasks.filter(
      (task) => !terminalStatuses.has(task.kanbanStatus) && !routineTaskIds.has(task.id),
    );
    return boardColumns.map((column) => {
      const items = active.filter((task) => task.kanbanStatus === column.status).sort((a, b) => b.rank - a.rank);
      return {
        status: column.status,
        label: column.label,
        tasks: items.map((task) => this.printTask(task, routineTaskIds)),
        total: items.length,
      };
    });
  }

  private printTask(task: TaskSummary, routineTaskIds: Set<number>): BriefingTask {
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
      isRoutine: routineTaskIds.has(task.id),
      description: task.description,
    };
  }

  /**
   * "due Wed" / "due today", or null. Overdue work is not labelled per task: the recurrence
   * leftovers in a real board would stamp "overdue" on half the page, and the attention list
   * already carries the count.
   */
  private deadlineLabel(task: TaskSummary): string | null {
    const deadline = instantOf(task.deadlineAt);
    if (!deadline) return null;
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
  private attention(tasks: TaskSummary[], date: string, weekDays: string[], routineTaskIds: Set<number>): string[] {
    const window = new Set(weekDays);
    const lines: string[] = [];
    let overdue = 0;
    for (const task of tasks) {
      if (terminalStatuses.has(task.kanbanStatus) || routineTaskIds.has(task.id)) continue;
      const deadline = instantOf(task.deadlineAt);
      if (!deadline) continue;
      const deadlineDate = partsOf(deadline).date;
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
      if (terminalStatuses.has(task.kanbanStatus) || routineTaskIds.has(task.id)) return false;
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
