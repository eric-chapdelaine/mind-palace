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

/** Reserved tags that carry behavior (see AGENTS.md "tag-driven behavior"). */
export const reservedTagPublicIds = {
  calendarEvent: "mind-palace:calendar-event",
  routine: "mind-palace:routine",
  thisWeek: "mind-palace:this-week",
} as const;

/**
 * Weekday tags in JavaScript `Date#getDay()` order: index 0 = Sunday .. index 6 = Saturday.
 * Each one's parent is `mind-palace:this-week` (see migration 004), so a task tagged with a
 * weekday is eligible this week and must be scheduled on that day.
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
  recurrence: RecurrenceRule | null;
}

export interface Tag {
  id: number;
  publicId: string;
  title: string;
  description: string | null;
  parentIds: number[];
  reserved: boolean;
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
  source: "manual" | "solver" | "calendar" | "recurrence";
  notes: string | null;
}

export interface RecurrenceRule {
  id: number;
  taskId: number;
  frequency: "daily" | "weekly";
  intervalCount: number;
  weekdays: number[];
  localStartTime: string | null;
  nextOccurrenceDate: string;
  active: boolean;
}

export interface WeatherForecast {
  forecastAt: string;
  temperatureF: number | null;
  precipitationProbability: number | null;
  shortForecast: string | null;
  expiresAt: string;
}

export interface HealthObservation {
  id: number;
  publicId: string;
  source: string;
  kind: "activity" | "sleep";
  startAt: string;
  endAt: string;
  externalId: string | null;
  details: JsonObject;
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
  unscheduledTaskIds: number[];
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
}

export interface CreateTagInput {
  title: string;
  description?: string;
  parentIds?: number[];
}

export interface UpdateTagInput {
  description?: string | null;
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

export interface UpsertRecurrenceInput {
  frequency: RecurrenceRule["frequency"];
  intervalCount?: number;
  weekdays?: number[];
  localStartTime?: string;
  nextOccurrenceDate: string;
}