export const kanbanStatuses = [
  "inbox",
  "ready",
  "in_progress",
  "waiting",
  "completed",
  "cancelled",
] as const;
export type KanbanStatus = (typeof kanbanStatuses)[number];

export const lifecycleStatuses = [
  "backlog",
  "active",
  "paused",
  "completed",
  "cancelled",
  "archived",
] as const;
export type LifecycleStatus = (typeof lifecycleStatuses)[number];

export const timeBlockStatuses = ["proposed", "accepted", "completed", "missed", "superseded"] as const;
export type TimeBlockStatus = (typeof timeBlockStatuses)[number];

/**
 * Commitment kind of a time block. `work` is the default (time set aside to make progress on
 * a task); `calendar_event` marks a fixed appointment whose window is the block itself. New
 * kinds are added here (and in the DB CHECK constraint) when tag-driven Quick-capture modes
 * grow beyond calendar events.
 */
export const timeBlockTypes = ["work", "calendar_event"] as const;
export type TimeBlockType = (typeof timeBlockTypes)[number];

/** Where a time block came from: a human, the solver, a calendar import, or recurrence materialization. */
export const timeBlockSources = ["manual", "solver", "calendar", "recurrence"] as const;
export type TimeBlockSource = (typeof timeBlockSources)[number];

/**
 * Tag kinds, owned via the tags.type column (nullable; most tags have no type). A `goal` tag
 * is a container: tasks carrying it (directly or through a descendant tag) are its subtasks.
 * Convert a task into a goal with POST /api/tasks/:id/convert-to-tag.
 */
export const tagTypes = ["goal"] as const;
export type TagType = (typeof tagTypes)[number];

/**
 * Manual priority levels, P0 (most important) through P5 (least important). A more-important
 * level dominates every less-important one: a P0 task is never dropped in favour of any number
 * of P1 tasks. Rank breaks ties within a level. Kept to a small range so the ordering stays
 * legible and cheap to solve.
 */
export const priorities = [0, 1, 2, 3, 4, 5] as const;
export type Priority = (typeof priorities)[number];

/** Reserved tags that carry behavior (see AGENTS.md "tag-driven behavior"). */
export const reservedTagPublicIds = {
  calendarEvent: "mind-palace:calendar-event",
  routine: "mind-palace:routine",
} as const;

/**
 * Weekday tags in JavaScript `Date#getDay()` order: index 0 = Sunday .. index 6 = Saturday.
 * They are the selectors for the seeded day-pin rules (`assignDays`), so a task carrying one must
 * be scheduled on that day. They used to be children of `mind-palace:this-week`; that tag is gone.
 */
export const weekdayTagPublicIds = [
  "mind-palace:sunday",
  "mind-palace:monday",
  "mind-palace:tuesday",
  "mind-palace:wednesday",
  "mind-palace:thursday",
  "mind-palace:friday",
  "mind-palace:saturday",
] as const;

export type JsonObject = Record<string, unknown>;

export interface TaskSummary {
  id: number;
  publicId: string;
  title: string;
  priority: number;
  rank: number;
  description: string | null;
  /** Minutes of work not yet represented by a time block (see the tasks.duration_minutes_remaining column). */
  durationMinutesRemaining: number | null;
  kanbanStatus: KanbanStatus;
  lifecycleStatus: LifecycleStatus;
  splittable: boolean;
  earliestStart: string | null;
  deadlineAt: string | null;
  completedAt: string | null;
  /**
   * Instant at which this task stops appearing on the board, or null for never. Set when the task is
   * created — a month out, or the routine's own decay point for a recurrence occurrence — and
   * pushed forward when an archived task is unarchived.
   */
  autoArchiveAt: string | null;
  origin: string;
  tags: Tag[];
  derivedTags: Tag[];
  updatedAt: string;
}

export interface TaskDetail extends TaskSummary {
  minChunkMinutes: number;
  maxChunkMinutes: number;
  createdAt: string;
  timeBlocks: TimeBlock[];
  /** Tasks this task depends on — they must be completed (and are scheduled) first. Empty unless linked. */
  dependsOn: TaskSummary[];
  /** Tasks that depend on this task — this task must come first for them. Not a hard gate on manual completion. */
  dependents: TaskSummary[];
}

export interface Tag {
  id: number;
  publicId: string;
  title: string;
  description: string | null;
  parentIds: number[];
  reserved: boolean;
  /** `goal` marks a task container created by converting a task; everything else is null. */
  type: TagType | null;
  /** Archived tags are hidden from tag search/auto-complete (completed or otherwise retired goals). */
  isArchived: boolean;
  updatedAt: string;
}

export interface TimeBlock {
  id: number;
  publicId: string;
  taskId: number;
  scheduleRunId: number | null;
  startAt: string;
  endAt: string;
  status: TimeBlockStatus;
  type: TimeBlockType;
  source: TimeBlockSource;
  notes: string | null;
}

/**
 * A routine is configuration, not work: it says that an ordinary task should exist on certain days,
 * and carries the values each occurrence is born with. It is deliberately not a task — a task is a
 * thing to do on a particular day, and conflating the two made the template occupy a kanban column
 * and need excluding from the scheduler, the decay sweep and the briefing.
 */
export interface RecurrenceTemplate {
  id: number;
  publicId: string;
  title: string;
  description: string | null;
  priority: number;
  durationMinutes: number;
  splittable: boolean;
  minChunkMinutes: number;
  maxChunkMinutes: number;
  frequency: Frequency;
  intervalCount: number;
  weekdays: number[];
  localStartTime: string | null;
  nextOccurrenceDate: string;
  /** Local hour (`0`-`23`) of the occurrence's day at which its child task decays; null = end of day. */
  autoArchiveHour: number | null;
  /** The tag grouping this routine with the occurrences it produced; null until it first runs. */
  routineTagId: number | null;
  active: boolean;
  tagIds: number[];
  updatedAt: string;
}

export type Frequency = "daily" | "weekly";

/**
 * What one materialization pass did. Reported to the caller because "nothing was created" is a
 * legitimate outcome — a weekly routine often has no firing date inside a seven-day window — and a
 * silent 200 reads as a broken job.
 */
export interface MaterializeResult {
  created: number[];
  /** Dates a rule selected but that already had a live child, so nothing was created. */
  alreadyPresent: number;
  /** Routines that fired nowhere in the window (their weekdays all fall outside it). */
  idleTemplates: string[];
}

export interface WeatherForecast {
  forecastAt: string;
  temperatureF: number | null;
  precipitationProbability: number | null;
  windMph: number | null;
  isDaytime: boolean | null;
  /** UV index for the hour. NWS does not publish one, so `WeatherService` fills it from Open-Meteo. */
  uvIndex: number | null;
  shortForecast: string | null;
  expiresAt: string;
}

/**
 * A night of sleep pulled from Garmin Connect. `calendarDate` is the local date the sleep
 * belongs to (the morning you woke up); `startAt`/`endAt` are the in-bed window as ISO UTC.
 * Extra provider metrics live in `details` so the columns stay stable as new data is added.
 */
export interface SleepSession {
  id: number;
  publicId: string;
  externalId: string;
  calendarDate: string;
  startAt: string;
  endAt: string;
  sleepScore: number | null;
  totalSleepMinutes: number | null;
  deepSleepMinutes: number | null;
  lightSleepMinutes: number | null;
  remSleepMinutes: number | null;
  awakeMinutes: number | null;
  avgHeartRate: number | null;
  avgStress: number | null;
  notes: string | null;
  details: JsonObject;
}

/**
 * A recorded Garmin activity (run, ride, lift, ...). `providerTitle` is Garmin's name and is
 * refreshed on every sync; `title` is the owner's override (falls back to `providerTitle`
 * when null) and is never overwritten by a sync. `details` holds extra provider metrics.
 */
export interface HealthActivity {
  id: number;
  publicId: string;
  externalId: string;
  providerTitle: string;
  title: string | null;
  notes: string | null;
  activityType: string;
  activityDate: string;
  startAt: string;
  endAt: string;
  durationMinutes: number | null;
  movingMinutes: number | null;
  distanceMeters: number | null;
  calories: number | null;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
  details: JsonObject;
}

/** The provider-owned half of a health row — what the Garmin worker may write. */
export type SleepSessionProviderInput = Omit<SleepSession, "id" | "publicId" | "notes">;
export type HealthActivityProviderInput = Omit<HealthActivity, "id" | "publicId" | "title" | "notes">;

export interface UpdateSleepSessionInput {
  notes?: string | null;
}

export interface UpdateHealthActivityInput {
  title?: string | null;
  notes?: string | null;
}

/** Result of a manual or scheduled Garmin Connect sync. */
export interface GarminSyncResult {
  sleepImported: number;
  activitiesImported: number;
  sleepFrom: string;
  activitiesFrom: string;
  syncedAt: string;
}

/** Persisted health of one provider connection (`integration_accounts.status` + timestamps). */
export interface IntegrationStatus {
  status: "configured" | "healthy" | "error" | "disabled";
  lastSyncedAt: string | null;
  lastError: string | null;
}

/** A provider's live connection state: persisted health plus whether its credential store exists. */
export interface IntegrationConnection extends IntegrationStatus {
  connected: boolean;
}

/** One row of `GET /api/integrations` — the generic, provider-agnostic connection summary. */
export interface IntegrationSummary extends IntegrationConnection {
  key: string;
  label: string;
}

export interface ScheduleRun {
  id: number;
  publicId: string;
  modelVersion: string;
  horizonStart: string;
  horizonEnd: string;
  status: "running" | "succeeded" | "failed";
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface Schedule {
  runs: ScheduleRun[];
  timeBlocks: TimeBlock[];
  /** Why the latest run left each task unplaced. Empty when the latest run placed everything. */
  unscheduled: ScheduleUnscheduled[];
  /** Objective scores from the latest run, for display/debugging. Null before the first run. */
  scores: ScheduleScores | null;
  /** Convenience mirror of `unscheduled.map((entry) => entry.taskId)`. */
  unscheduledTaskIds: number[];
}

/** Why the solver left a task unscheduled. */
export interface ScheduleReason {
  type: "capacity" | "no_eligible_slots" | "rule";
  detail: string;
}

export interface ScheduleUnscheduled {
  taskId: number;
  reasons: ScheduleReason[];
}

/**
 * The scheduler solves a single weighted objective, not ordered tiers. `decision` reports how
 * many tasks were placed; `style` is the total soft-rule value of the chosen placement.
 */
export interface ScheduleScores {
  decision: { placed: number; of: number; byPriority: Record<string, number> };
  style: number;
}

/** A composable predicate over the scheduling payload. */
export type RuleCondition =
  | { always: true }
  | { taskHasTag: string }
  | { taskHasAnyTag: string[] }
  | { all: RuleCondition[] }
  | { any: RuleCondition[] }
  | { not: RuleCondition };

/**
 * The rule effects the worker implements. This list is the contract: the API rejects anything
 * outside it. `assignDays`, `timeWindow`, `weatherGate`, and `withinAfter` may be hard
 * constraints; `preferTimeOfDay`, `spread`, and `dailyBudget` are preferences only.
 */
export const ruleEffectTypes = ["assignDays", "timeWindow", "preferTimeOfDay", "spread", "dailyBudget", "weatherGate", "withinAfter"] as const;
export type RuleEffectType = (typeof ruleEffectTypes)[number];

/**
 * A placement-scoped condition: the term applies to a slot only when that slot matches. This is
 * separate from `applies`, which selects *which tasks* a rule governs. `dayOfWeek` uses Python
 * weekday order (0 = Monday .. 6 = Sunday).
 */
export interface RuleWhen {
  dayOfWeek?: number[];
}

/** What a rule does. `type` selects the implementation; the remaining keys are parameters. */
export type RuleEffect =
  | { type: "assignDays"; days: number[]; when?: RuleWhen }
  | { type: "timeWindow"; start: string; end: string; when?: RuleWhen }
  | { type: "preferTimeOfDay"; start: string; end: string; when?: RuleWhen }
  | { type: "spread"; maxPerDayMinutes?: number; minDistinctDays?: number; avoidConsecutive?: boolean; when?: RuleWhen }
  | { type: "dailyBudget"; softMaxPerDay?: number; when?: RuleWhen }
  | { type: "withinAfter"; maxMinutes?: number }
  | {
      type: "weatherGate";
      minTemperatureF?: number;
      maxTemperatureF?: number;
      maxPrecipitationProbability?: number;
      maxWindMph?: number;
      requireDaytime?: boolean;
      when?: RuleWhen;
    };

/** Hard rules constrain feasibility; soft rules add a weighted term to the single objective. */
export type RuleStrength = { kind: "hard" } | { kind: "soft"; weight: number };

/**
 * A scheduling rule. Rules are data: the worker compiles them into hard constraints and weighted
 * soft terms. `applies` may reference any tag (seeded or user-created); tags are selectors,
 * never behavior on their own.
 */
export interface SchedulerRule {
  id: number;
  publicId: string;
  title: string;
  enabled: boolean;
  applies: RuleCondition | null;
  effect: RuleEffect;
  strength: RuleStrength;
  reason: string;
  updatedAt: string;
}

/** The editable half of a rule (everything but identity and timestamps). */
export interface SchedulerRuleInput {
  title: string;
  enabled?: boolean;
  applies?: RuleCondition | null;
  effect: RuleEffect;
  strength: RuleStrength;
  reason?: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  priority?: number;
  rank?: number;
  durationMinutesRemaining?: number | null;
  splittable?: boolean;
  minChunkMinutes?: number;
  maxChunkMinutes?: number;
  earliestStart?: string;
  deadlineAt?: string;
  kanbanStatus?: KanbanStatus;
  tagIds?: number[];
  origin?: string;
  /**
   * When this task decays; `null` never, omitted the default month. Recurrence occurrences pass
   * their own instant so a "wake up" row is gone by the time the morning is over.
   */
  autoArchiveAt?: string | null;
  /**
   * Create the task together with its first time block — the Quick-capture surface for
   * tag-driven commitment kinds (currently only calendar events). The block's minutes are
   * subtracted from `durationMinutesRemaining` exactly like any other created block.
   */
  timeBlock?: TaskTimeBlockInput;
}

export interface TaskTimeBlockInput {
  startAt: string;
  endAt: string;
  type?: TimeBlockType;
  notes?: string;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  kanbanStatus?: KanbanStatus;
  priority?: number;
  rank?: number;
  durationMinutesRemaining?: number | null;
  splittable?: boolean;
  minChunkMinutes?: number;
  maxChunkMinutes?: number;
  earliestStart?: string | null;
  deadlineAt?: string | null;
  tagIds?: number[];
  /**
   * When this task decays and leaves the board. `null` never; omitted leaves the current instant
   * alone. Setting it is how you push a task's expiry out (or bring it in) by hand.
   */
  autoArchiveAt?: string | null;
  /**
   * Replace the full set of tasks this task depends on (like `tagIds`, the editor sends the
   * whole list and the repository diffs it against the current links). Omit to leave deps alone.
   */
  dependsOnTaskIds?: number[];
}

export interface CreateTagInput {
  title: string;
  description?: string;
  parentIds?: number[];
  type?: TagType | null;
}

export interface UpdateTagInput {
  title?: string;
  description?: string | null;
  type?: TagType | null;
  isArchived?: boolean;
}

export interface CreateTimeBlockInput {
  taskId: number;
  startAt: string;
  endAt: string;
  status?: TimeBlockStatus;
  type?: TimeBlockType;
  source?: TimeBlock["source"];
  notes?: string;
}

export interface UpdateTimeBlockInput {
  startAt?: string;
  endAt?: string;
}

/** Everything a routine needs to define itself, including the values each occurrence is born with. */
export interface UpsertRecurrenceInput {
  title: string;
  description?: string | null;
  priority?: number;
  durationMinutes: number;
  splittable?: boolean;
  minChunkMinutes?: number;
  maxChunkMinutes?: number;
  tagIds?: number[];
  frequency: Frequency;
  intervalCount?: number;
  weekdays?: number[];
  localStartTime?: string;
  nextOccurrenceDate: string;
  /**
   * Local hour (`0`-`23`) of the occurrence's day at which its child task decays, so a "wake up"
   * routine can be gone by 10am. Null/omitted means end of that day.
   */
  autoArchiveHour?: number | null;
  active?: boolean;
}

/**
 * One printable section of the daily briefing. `layout` is an ordered list of these: it is the
 * whole of the "what appears on the page" decision, and it is data so a different medium (a
 * receipt, an e-ink panel, a future screen) is a different list plus a different stylesheet rather
 * than a fork of the renderer. A new module (recommended workout, AI summary, ...) is a new `kind`
 * here, one builder in BriefingService, and one render function in workers/briefing.
 */
export type BriefingSection =
  | { kind: "weather-day-graph"; fromHour?: number; toHour?: number }
  | { kind: "today-schedule"; agenda?: boolean; fromHour?: number; toHour?: number }
  | { kind: "today-tasks"; descriptionChars?: number; descriptionLines?: number }
  | { kind: "week-ahead"; days?: number; linesPerDay?: number; attention?: boolean }
  | { kind: "board-snapshot"; perColumn?: number; columns?: KanbanStatus[] };

/** One hour of the day's forecast, already placed on the day's local clock by the server. */
export interface BriefingWeatherHour {
  /** Local hour label like "3 PM". */
  hourLabel: string;
  /** Minutes since local midnight - the renderer only maps this to an x position. */
  minuteOfDay: number;
  temperatureF: number | null;
  precipitationProbability: number | null;
  windMph: number | null;
  isDaytime: boolean | null;
  uvIndex: number | null;
  shortForecast: string | null;
}

/**
 * The day's headline numbers for the summary strip: enough to answer "what kind of day is this"
 * without reading the graph.
 */
export interface BriefingWeatherDay {
  highF: number | null;
  lowF: number | null;
  /** Peak precipitation probability, 0-100. */
  rainPercent: number | null;
  /** Peak UV index for the day, and the local time it occurs. */
  uvMax: number | null;
  uvMaxLabel: string | null;
  /** Daylight window as local clock labels, e.g. "7:07 AM" - "5:48 PM". */
  sunriseLabel: string | null;
  sunsetLabel: string | null;
  /** The same window in minutes since local midnight, so the graph can shade the night band. */
  sunriseMinutes: number | null;
  sunsetMinutes: number | null;
}

/** A time block placed on a day: everything a printed block needs, nothing more. */
export interface BriefingBlock {
  taskId: number;
  title: string;
  /** Local clock labels, e.g. "7:30 AM". */
  startLabel: string;
  endLabel: string;
  /** Minutes since local midnight, for positioning on a timeline. Clamped to the day. */
  startMinutes: number;
  endMinutes: number;
  status: TimeBlockStatus;
  type: TimeBlockType;
  /** Where the block came from; the print shades manual work differently from solver output. */
  source: TimeBlockSource;
  /** True when the block belongs to a routine task (recurrence-born or routine-tagged). */
  isRoutine: boolean;
}

/** A task as printed: the board's fields plus the detail the full-width page can afford. */
export interface BriefingTask {
  id: number;
  title: string;
  priority: number;
  durationMinutesRemaining: number | null;
  kanbanStatus: KanbanStatus;
  tags: string[];
  /** Local short due label ("due Wed"), or null when the task has no deadline. */
  deadlineLabel: string | null;
  /** True when this task is routine work: hidden from the board, the week, and "do today". */
  isRoutine: boolean;
  description: string | null;
}

export interface BriefingDay {
  /** `YYYY-MM-DD` in the reference time zone. */
  date: string;
  weekdayLabel: string;
  monthDayLabel: string;
  isToday: boolean;
  highF: number | null;
  lowF: number | null;
  rainPercent: number | null;
  /**
   * The day's blocks, already ordered and clamped to the day. The renderer decides how many fit and
   * draws the mini timeline from the same data, so a tighter medium drops lines instead of dates.
   */
  blocks: BriefingBlock[];
  scheduledMinutes: number;
  /**
   * Non-routine tasks whose deadline falls on this day. The week column prints scheduled work and
   * due work as two labelled groups, because "what is planned" and "what must ship" are different
   * questions and a day can have either, both, or neither.
   */
  dueTasks: BriefingTask[];
}

export interface BriefingBoardColumn {
  status: KanbanStatus;
  label: string;
  tasks: BriefingTask[];
  /** How many tasks the column holds in total, so the print can say "+9 more". */
  total: number;
}

/**
 * The briefing payload: the facts (what the server knows, already normalized to local labels and
 * positions) plus the layout (which sections to render, in what order). The renderer is a pure
 * function of this document - it never reads the database or the network, and it does no date math
 * beyond placing pre-computed minutes on an axis.
 */
export interface BriefingPayload {
  /** "9:03 PM" - the moment this page was built, for the masthead stamp. */
  printedAtLabel: string;
  dateLabel: string;
  timeZone: string;
  facts: {
    weatherHours: BriefingWeatherHour[];
    weatherDay: BriefingWeatherDay;
    todayBlocks: BriefingBlock[];
    todayTasks: BriefingTask[];
    week: BriefingDay[];
    board: BriefingBoardColumn[];
    /** Deadlines and releases landing in the next seven days, for the "attention" list. */
    attention: string[];
  };
  layout: BriefingSection[];
}

