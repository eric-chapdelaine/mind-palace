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
  durationMinutes: number | null;
  kanbanStatus: KanbanStatus;
  lifecycleStatus: LifecycleStatus;
  splittable: boolean;
  earliestStart: string | null;
  deadlineAt: string | null;
  fixedStart: string | null;
  fixedEnd: string | null;
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
  durationMinutes?: number | null;
  splittable?: boolean;
  minChunkMinutes?: number;
  maxChunkMinutes?: number;
  earliestStart?: string;
  deadlineAt?: string;
  fixedStart?: string;
  fixedEnd?: string;
  kanbanStatus?: KanbanStatus;
  tagIds?: number[];
  origin?: string;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  kanbanStatus?: KanbanStatus;
  priority?: number;
  rank?: number;
  durationMinutes?: number | null;
  splittable?: boolean;
  minChunkMinutes?: number;
  maxChunkMinutes?: number;
  earliestStart?: string | null;
  deadlineAt?: string | null;
  fixedStart?: string | null;
  fixedEnd?: string | null;
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
  source?: TimeBlock["source"];
  notes?: string;
}

export interface UpsertRecurrenceInput {
  frequency: RecurrenceRule["frequency"];
  intervalCount?: number;
  weekdays?: number[];
  localStartTime?: string;
  nextOccurrenceDate: string;
}