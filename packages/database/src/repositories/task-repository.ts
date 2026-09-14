import { randomUUID } from "node:crypto";
import type {
  CreateTagInput,
  CreateTaskInput,
  CreateTimeBlockInput,
  HealthObservation,
  KanbanStatus,
  LifecycleStatus,
  RecurrenceRule,
  ScheduleRun,
  Tag,
  TaskDetail,
  TaskSummary,
  TimeBlock,
  TimeBlockStatus,
  UpdateTaskInput,
  UpsertRecurrenceInput,
  UpdateTagInput,
  WeatherForecast,
} from "@mind-palace/shared";
import { Database } from "../database.js";
import { boolean, integer, json, nullableText, row, text, type Row } from "../rows.js";

export const reservedTagIds = {
  calendarEvent: "mind-palace:calendar-event",
  routine: "mind-palace:routine",
} as const;

function now(): string {
  return new Date().toISOString();
}

function insertedId(result: { lastInsertRowid: number | bigint }): number {
  return Number(result.lastInsertRowid);
}

function mapTag(value: Row, parentIds: number[] = []): Tag {
  const publicId = text(value.public_id);
  return {
    id: integer(value.id),
    publicId,
    title: text(value.title),
    description: nullableText(value.description),
    parentIds,
    reserved: publicId.startsWith("mind-palace:"),
  };
}

function mapTimeBlock(value: Row): TimeBlock {
  return {
    id: integer(value.id),
    publicId: text(value.public_id),
    taskId: integer(value.task_id),
    scheduleRunId: value.schedule_run_id === null ? null : integer(value.schedule_run_id),
    startAt: text(value.start_at),
    endAt: text(value.end_at),
    status: text(value.status) as TimeBlockStatus,
    source: text(value.source) as TimeBlock["source"],
    notes: nullableText(value.notes),
  };
}

export interface SchedulableTask {
  id: number;
  title: string;
  priority: number;
  rank: number;
  durationMinutes: number;
  splittable: boolean;
  minChunkMinutes: number;
  maxChunkMinutes: number;
  earliestStart: string | null;
  deadlineAt: string | null;
  fixedStart: string | null;
  fixedEnd: string | null;
  tagIds: string[];
}

export interface RecurrenceTemplate {
  rule: RecurrenceRule;
  title: string;
  description: string | null;
  priority: number;
  rank: number;
  durationMinutes: number;
  splittable: boolean;
  tagIds: number[];
}

const taskSummarySql = String.raw`
  SELECT
    t.id, t.public_id, t.title, t.priority, t.rank, t.description,
    t.kanban_status, t.lifecycle_status, t.splittable, t.duration_minutes, t.duration_estimated,
    t.earliest_start, t.deadline_at,
    t.fixed_start, t.fixed_end, t.completed_at, t.origin, t.updated_at,
    COALESCE((SELECT json_group_array(json_object(
      'id', tag.id, 'publicId', tag.public_id, 'title', tag.title, 'description', tag.description,
      'reserved', CASE WHEN tag.public_id LIKE 'mind-palace:%' THEN json('true') ELSE json('false') END
    )) FROM task_tags task_tag JOIN tags tag ON tag.id = task_tag.tag_id WHERE task_tag.task_id = t.id), '[]') AS tags_json,
    COALESCE((WITH RECURSIVE ancestors(id) AS (
      SELECT relation.parent_tag_id FROM task_tags direct JOIN tag_parents relation ON relation.child_tag_id = direct.tag_id WHERE direct.task_id = t.id
      UNION
      SELECT relation.parent_tag_id FROM tag_parents relation JOIN ancestors ON relation.child_tag_id = ancestors.id
    ) SELECT json_group_array(json_object(
      'id', tag.id, 'publicId', tag.public_id, 'title', tag.title, 'description', tag.description,
      'reserved', CASE WHEN tag.public_id LIKE 'mind-palace:%' THEN json('true') ELSE json('false') END
    )) FROM ancestors JOIN tags tag ON tag.id = ancestors.id), '[]') AS derived_tags_json
  FROM tasks t
`;

function mapTaskSummary(value: Row): TaskSummary {
  const tags = json<Tag[]>(value.tags_json, []);
  const derivedTags = json<Tag[]>(value.derived_tags_json, []);
  return {
    id: integer(value.id),
    publicId: text(value.public_id),
    title: text(value.title),
    priority: integer(value.priority),
    rank: Number(value.rank),
    description: nullableText(value.description),
    durationMinutes: boolean(value.duration_estimated) ? integer(value.duration_minutes) : null,
    kanbanStatus: text(value.kanban_status) as KanbanStatus,
    lifecycleStatus: text(value.lifecycle_status) as LifecycleStatus,
    splittable: boolean(value.splittable),
    earliestStart: nullableText(value.earliest_start),
    deadlineAt: nullableText(value.deadline_at),
    fixedStart: nullableText(value.fixed_start),
    fixedEnd: nullableText(value.fixed_end),
    completedAt: nullableText(value.completed_at),
    origin: text(value.origin),
    tags: tags.map((tag) => ({ ...tag, parentIds: [] })),
    derivedTags: derivedTags.map((tag) => ({ ...tag, parentIds: [] })),
    updatedAt: text(value.updated_at),
  };
}

export class TaskRepository {
  constructor(private readonly database: Database) {}

  listTasks(): TaskSummary[] {
    return this.database.connection
      .prepare(`${taskSummarySql} ORDER BY CASE t.lifecycle_status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, t.priority DESC, t.updated_at DESC`)
      .all()
      .map((value) => mapTaskSummary(row(value, "task summary")));
  }

  getTask(id: number): TaskDetail {
    const task = row(this.database.connection.prepare("SELECT * FROM tasks WHERE id = ?").get(id), "task");
    return {
      ...mapTaskSummary(row(this.database.connection.prepare(`${taskSummarySql} WHERE t.id = ?`).get(id), "task")),
      minChunkMinutes: task.min_chunk_minutes === null ? 30 : integer(task.min_chunk_minutes),
      maxChunkMinutes: task.max_chunk_minutes === null ? 180 : integer(task.max_chunk_minutes),
      createdAt: text(task.created_at),
      timeBlocks: this.listTimeBlocksForTask(id),
      recurrence: this.listRecurrence(id),
    };
  }

  createTask(input: CreateTaskInput): TaskDetail {
    const timestamp = now();
    const title = input.title.trim();
    if (!title) throw new Error("A task title is required");
    const kanbanStatus = input.kanbanStatus ?? "inbox";
    const lifecycleStatus =
      kanbanStatus === "completed" ? "completed" : kanbanStatus === "cancelled" ? "cancelled" : "active";

    const result = this.database.connection
      .prepare(
        `INSERT INTO tasks
          (public_id, title, description, kanban_status, priority, rank, duration_minutes, duration_estimated,
           splittable, min_chunk_minutes, max_chunk_minutes, earliest_start, deadline_at, fixed_start, fixed_end,
           origin, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(), title, input.description?.trim() || null, kanbanStatus, input.priority ?? 0,
        input.rank ?? Date.now(), input.durationMinutes ?? null, input.durationMinutes === null ? 0 : 1,
        input.splittable ? 1 : 0, input.minChunkMinutes ?? 30, input.maxChunkMinutes ?? 180,
        input.earliestStart ?? null, input.deadlineAt ?? null, input.fixedStart ?? null, input.fixedEnd ?? null,
        input.origin ?? "manual", timestamp, timestamp,
      );
    const taskId = insertedId(result);
    if (input.tagIds && input.tagIds.length > 0) this.setTaskTags(taskId, input.tagIds);
    return this.getTask(taskId);
  }

  listTags(): Tag[] {
    const parents = this.database.connection.prepare("SELECT child_tag_id, parent_tag_id FROM tag_parents").all();
    const parentIds = new Map<number, number[]>();
    for (const value of parents) {
      const item = row(value, "tag parent");
      const childId = integer(item.child_tag_id);
      parentIds.set(childId, [...(parentIds.get(childId) ?? []), integer(item.parent_tag_id)]);
    }
    return this.database.connection
      .prepare("SELECT * FROM tags ORDER BY title COLLATE NOCASE")
      .all()
      .map((value) => {
        const item = row(value, "tag");
        return mapTag(item, parentIds.get(integer(item.id)) ?? []);
      });
  }

  createTag(input: CreateTagInput): Tag {
    const title = input.title.trim();
    if (!title) throw new Error("Tag title is required");
    const timestamp = now();
    this.database.connection.exec("BEGIN IMMEDIATE");
    try {
      const result = this.database.connection
        .prepare("INSERT INTO tags (public_id, title, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .run(randomUUID(), title, input.description?.trim() || null, timestamp, timestamp);
      const id = insertedId(result);
      for (const parentId of new Set(input.parentIds ?? [])) this.insertTagParent(id, parentId, timestamp);
      this.database.connection.exec("COMMIT");
      return this.listTags().find((tag) => tag.id === id)!;
    } catch (error) {
      this.database.connection.exec("ROLLBACK");
      throw error;
    }
  }

  addTagParent(childId: number, parentId: number): void {
    this.database.connection.exec("BEGIN IMMEDIATE");
    try {
      this.insertTagParent(childId, parentId, now());
      this.database.connection.exec("COMMIT");
    } catch (error) {
      this.database.connection.exec("ROLLBACK");
      throw error;
    }
  }

  updateTag(tagId: number, input: UpdateTagInput): Tag {
    if (input.description === undefined) {
      const tag = this.listTags().find((item) => item.id === tagId);
      if (!tag) throw new Error("Expected database row for tag");
      return tag;
    }
    const result = this.database.connection
      .prepare("UPDATE tags SET description = ?, updated_at = ? WHERE id = ?")
      .run(input.description?.trim() || null, now(), tagId);
    if (result.changes !== 1) throw new Error("Expected database row for tag");
    return this.listTags().find((item) => item.id === tagId)!;
  }

  removeTagParent(childId: number, parentId: number): void {
    const result = this.database.connection
      .prepare("DELETE FROM tag_parents WHERE child_tag_id = ? AND parent_tag_id = ?")
      .run(childId, parentId);
    if (result.changes !== 1) throw new Error("Tag relation does not exist");
  }

  /**
   * Find-or-create the tag that maps a parent task to its work, then attach it to the task.
   * Parent-child links between tasks are expressed through shared tags instead of a
   * parent_task_id column; recurrence materialization uses this to stamp each occurrence
   * (and its template) with a tag that names the parent task.
   */
  ensureTaskTag(taskId: number, input: { title: string; description?: string }): Tag {
    const title = input.title.trim();
    if (!title) throw new Error("Tag title is required");
    const timestamp = now();
    this.database.connection.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.database.connection
        .prepare("SELECT id FROM tags WHERE title = ? COLLATE NOCASE")
        .get(title);
      const tagId = existing
        ? integer(row(existing, "tag").id)
        : insertedId(this.database.connection
            .prepare("INSERT INTO tags (public_id, title, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
            .run(randomUUID(), title, input.description?.trim() || null, timestamp, timestamp));
      this.database.connection
        .prepare("INSERT OR IGNORE INTO task_tags (task_id, tag_id, source, created_at) VALUES (?, ?, 'system', ?)")
        .run(taskId, tagId, timestamp);
      this.database.connection.exec("COMMIT");
      return this.listTags().find((tag) => tag.id === tagId)!;
    } catch (error) {
      this.database.connection.exec("ROLLBACK");
      throw error;
    }
  }

  private insertTagParent(childId: number, parentId: number, timestamp: string): void {
    if (childId === parentId) throw new Error("A tag cannot be its own parent");
    const tags = this.database.connection.prepare("SELECT id FROM tags WHERE id IN (?, ?)").all(childId, parentId);
    if (tags.length !== 2) throw new Error("Expected both tags to exist");
    const createsCycle = this.database.connection
      .prepare(
        `WITH RECURSIVE ancestors(id) AS (
           SELECT parent_tag_id FROM tag_parents WHERE child_tag_id = ?
           UNION
           SELECT relation.parent_tag_id FROM tag_parents relation JOIN ancestors ON relation.child_tag_id = ancestors.id
         ) SELECT 1 FROM ancestors WHERE id = ? LIMIT 1`,
      )
      .get(parentId, childId);
    if (createsCycle) throw new Error("Tag hierarchy cannot contain a cycle");
    this.database.connection
      .prepare("INSERT OR IGNORE INTO tag_parents (child_tag_id, parent_tag_id, created_at) VALUES (?, ?, ?)")
      .run(childId, parentId, timestamp);
  }

  updateTask(taskId: number, input: UpdateTaskInput): void {
    const assignments: string[] = [];
    const values: Array<string | number | null> = [];
    const add = (column: string, value: string | number | null) => {
      assignments.push(`${column} = ?`);
      values.push(value);
    };
    if (input.title !== undefined) add("title", input.title.trim());
    if (input.description !== undefined) add("description", input.description?.trim() || null);
    if (input.kanbanStatus !== undefined) {
      add("kanban_status", input.kanbanStatus);
      add("lifecycle_status", input.kanbanStatus === "completed" ? "completed" : input.kanbanStatus === "cancelled" ? "cancelled" : "active");
      if (input.kanbanStatus === "completed") {
        assignments.push("completed_at = COALESCE(completed_at, ?)");
        values.push(now());
      } else {
        add("completed_at", null);
      }
    }
    if (input.priority !== undefined) add("priority", input.priority);
    if (input.rank !== undefined) add("rank", input.rank);
    if (input.durationMinutes !== undefined) {
      add("duration_estimated", input.durationMinutes === null ? 0 : 1);
      if (input.durationMinutes !== null) add("duration_minutes", input.durationMinutes);
    }
    if (input.splittable !== undefined) add("splittable", input.splittable ? 1 : 0);
    if (input.minChunkMinutes !== undefined) add("min_chunk_minutes", input.minChunkMinutes);
    if (input.maxChunkMinutes !== undefined) add("max_chunk_minutes", input.maxChunkMinutes);
    if (input.earliestStart !== undefined) add("earliest_start", input.earliestStart);
    if (input.deadlineAt !== undefined) add("deadline_at", input.deadlineAt);
    if (input.fixedStart !== undefined) add("fixed_start", input.fixedStart);
    if (input.fixedEnd !== undefined) add("fixed_end", input.fixedEnd);
    if (assignments.length > 0) {
      add("updated_at", now());
      const result = this.database.connection
        .prepare(`UPDATE tasks SET ${assignments.join(", ")} WHERE id = ?`)
        .run(...values, taskId);
      if (result.changes !== 1) throw new Error("Expected task to exist");
    }
    if (input.tagIds) this.setTaskTags(taskId, input.tagIds);
  }

  setTaskLifecycle(id: number, status: LifecycleStatus): void {
    this.database.connection
      .prepare("UPDATE tasks SET lifecycle_status = ?, updated_at = ? WHERE id = ?")
      .run(status, now(), id);
  }

  setTaskTags(taskId: number, tagIds: number[]): void {
    const uniqueIds = [...new Set(tagIds)];
    const timestamp = now();
    this.database.connection.exec("BEGIN IMMEDIATE");
    try {
      this.database.connection.prepare("DELETE FROM task_tags WHERE task_id = ?").run(taskId);
      const insert = this.database.connection.prepare(
        "INSERT INTO task_tags (task_id, tag_id, source, created_at) VALUES (?, ?, 'user', ?)",
      );
      for (const tagId of uniqueIds) insert.run(taskId, tagId, timestamp);
      this.database.connection.prepare("UPDATE tasks SET updated_at = ? WHERE id = ?").run(timestamp, taskId);
      this.database.connection.exec("COMMIT");
    } catch (error) {
      this.database.connection.exec("ROLLBACK");
      throw error;
    }
  }

  createTimeBlock(input: CreateTimeBlockInput, scheduleRunId: number | null = null): TimeBlock {
    if (new Date(input.endAt) <= new Date(input.startAt)) throw new Error("Time block end must be after start");
    const timestamp = now();
    const result = this.database.connection
      .prepare(
        `INSERT INTO time_blocks
          (public_id, task_id, schedule_run_id, start_at, end_at, status, source, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(), input.taskId, scheduleRunId, input.startAt, input.endAt, input.status ?? "proposed",
        input.source ?? "manual", input.notes?.trim() || null, timestamp, timestamp,
      );
    return mapTimeBlock(row(this.database.connection.prepare("SELECT * FROM time_blocks WHERE id = ?").get(insertedId(result)), "time block"));
  }

  upsertCalendarTimeBlock(taskId: number, startAt: string, endAt: string): TimeBlock {
    const existing = this.database.connection
      .prepare("SELECT id FROM time_blocks WHERE task_id = ? AND source = 'calendar' ORDER BY id DESC LIMIT 1")
      .get(taskId);
    if (!existing) return this.createTimeBlock({ taskId, startAt, endAt, status: "accepted", source: "calendar" });
    const id = integer(row(existing, "calendar time block").id);
    this.database.connection
      .prepare("UPDATE time_blocks SET start_at = ?, end_at = ?, status = 'accepted', updated_at = ? WHERE id = ?")
      .run(startAt, endAt, now(), id);
    return mapTimeBlock(row(this.database.connection.prepare("SELECT * FROM time_blocks WHERE id = ?").get(id), "calendar time block"));
  }

  listTimeBlocks(from?: string, to?: string): TimeBlock[] {
    const values = from && to
      ? this.database.connection.prepare("SELECT * FROM time_blocks WHERE end_at > ? AND start_at < ? ORDER BY start_at").all(from, to)
      : this.database.connection.prepare("SELECT * FROM time_blocks ORDER BY start_at").all();
    return values.map((value) => mapTimeBlock(row(value, "time block")));
  }

  private listTimeBlocksForTask(taskId: number): TimeBlock[] {
    return this.database.connection
      .prepare("SELECT * FROM time_blocks WHERE task_id = ? ORDER BY start_at")
      .all(taskId)
      .map((value) => mapTimeBlock(row(value, "time block")));
  }

  setTimeBlockStatus(id: number, status: TimeBlockStatus): void {
    const current = row(this.database.connection.prepare("SELECT * FROM time_blocks WHERE id = ?").get(id), "time block");
    if (text(current.status) === "accepted" && status !== "completed" && status !== "missed") {
      throw new Error("Accepted time blocks are immutable");
    }
    this.database.connection.prepare("UPDATE time_blocks SET status = ?, updated_at = ? WHERE id = ?").run(status, now(), id);
  }

  acceptTaskSchedule(taskId: number): void {
    this.database.connection
      .prepare("UPDATE time_blocks SET status = 'accepted', updated_at = ? WHERE task_id = ? AND status = 'proposed'")
      .run(now(), taskId);
  }

  supersedeProposedBlocks(): void {
    this.database.connection
      .prepare("UPDATE time_blocks SET status = 'superseded', updated_at = ? WHERE status = 'proposed'")
      .run(now());
  }

  upsertRecurrence(taskId: number, input: UpsertRecurrenceInput): RecurrenceRule {
    const timestamp = now();
    this.database.connection
      .prepare(
        `INSERT INTO recurrence_rules
          (task_id, frequency, interval_count, weekdays_json, local_start_time, next_occurrence_date, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(task_id) DO UPDATE SET frequency = excluded.frequency, interval_count = excluded.interval_count,
           weekdays_json = excluded.weekdays_json, local_start_time = excluded.local_start_time,
           next_occurrence_date = excluded.next_occurrence_date, active = 1, updated_at = excluded.updated_at`,
      )
      .run(
        taskId, input.frequency, input.intervalCount ?? 1, JSON.stringify(input.weekdays ?? []),
        input.localStartTime ?? null, input.nextOccurrenceDate, timestamp, timestamp,
      );
    return this.listRecurrence(taskId)!;
  }

  private listRecurrence(taskId: number): RecurrenceRule | null {
    const value = this.database.connection.prepare("SELECT * FROM recurrence_rules WHERE task_id = ?").get(taskId);
    if (!value) return null;
    const item = row(value, "recurrence");
    return {
      id: integer(item.id), taskId: integer(item.task_id), frequency: text(item.frequency) as RecurrenceRule["frequency"],
      intervalCount: integer(item.interval_count), weekdays: item.weekdays_json ? json<number[]>(item.weekdays_json, []) : [],
      localStartTime: nullableText(item.local_start_time), nextOccurrenceDate: text(item.next_occurrence_date),
      active: boolean(item.active),
    };
  }

  listRecurrenceTemplates(): RecurrenceTemplate[] {
    return this.database.connection
      .prepare(
        `SELECT rule.*, task.title, task.description, task.priority, task.rank, task.duration_minutes, task.splittable,
          COALESCE((SELECT json_group_array(task_tag.tag_id) FROM task_tags task_tag WHERE task_tag.task_id = task.id), '[]') AS tag_ids
         FROM recurrence_rules rule JOIN tasks task ON task.id = rule.task_id WHERE rule.active = 1`,
      )
      .all()
      .map((value) => {
        const item = row(value, "recurrence template");
        return {
          rule: {
            id: integer(item.id), taskId: integer(item.task_id), frequency: text(item.frequency) as RecurrenceRule["frequency"],
            intervalCount: integer(item.interval_count), weekdays: item.weekdays_json ? json<number[]>(item.weekdays_json, []) : [],
            localStartTime: nullableText(item.local_start_time), nextOccurrenceDate: text(item.next_occurrence_date), active: boolean(item.active),
          },
          title: text(item.title), description: nullableText(item.description), priority: integer(item.priority),
          rank: Number(item.rank), durationMinutes: integer(item.duration_minutes), splittable: boolean(item.splittable),
          tagIds: json<number[]>(item.tag_ids, []),
        };
      });
  }

  recurrenceOccurrenceExists(ruleId: number, date: string): boolean {
    return Boolean(this.database.connection
      .prepare("SELECT 1 FROM recurrence_occurrences WHERE recurrence_rule_id = ? AND occurrence_date = ?")
      .get(ruleId, date));
  }

  recordRecurrenceOccurrence(ruleId: number, date: string, childTaskId: number): void {
    this.database.connection
      .prepare("INSERT INTO recurrence_occurrences (recurrence_rule_id, occurrence_date, child_task_id, created_at) VALUES (?, ?, ?, ?)")
      .run(ruleId, date, childTaskId, now());
  }

  listSchedulableTasks(): SchedulableTask[] {
    return this.database.connection
      .prepare(
        `SELECT task.*, COALESCE((SELECT json_group_array(tag.public_id) FROM task_tags task_tag
          JOIN tags tag ON tag.id = task_tag.tag_id WHERE task_tag.task_id = task.id), '[]') AS tag_ids
         FROM tasks task
         WHERE task.kanban_status IN ('ready', 'in_progress') AND task.duration_estimated = 1
           AND NOT EXISTS (SELECT 1 FROM time_blocks block WHERE block.task_id = task.id AND block.status = 'accepted')
         ORDER BY task.priority DESC, task.rank DESC`,
      )
      .all()
      .map((value) => {
        const item = row(value, "schedulable task");
        return {
          id: integer(item.id), title: text(item.title), priority: integer(item.priority), rank: Number(item.rank),
          durationMinutes: integer(item.duration_minutes), splittable: boolean(item.splittable),
          minChunkMinutes: integer(item.min_chunk_minutes), maxChunkMinutes: integer(item.max_chunk_minutes),
          earliestStart: nullableText(item.earliest_start), deadlineAt: nullableText(item.deadline_at),
          fixedStart: nullableText(item.fixed_start), fixedEnd: nullableText(item.fixed_end),
          tagIds: json<string[]>(item.tag_ids, []),
        };
      });
  }

  createScheduleRun(horizonStart: string, horizonEnd: string, input: unknown): ScheduleRun {
    const timestamp = now();
    const result = this.database.connection
      .prepare(
        `INSERT INTO schedule_runs (public_id, model_version, horizon_start, horizon_end, status, input_json, created_at)
         VALUES (?, 'cp-sat-v0', ?, ?, 'running', ?, ?)`,
      )
      .run(randomUUID(), horizonStart, horizonEnd, JSON.stringify(input), timestamp);
    return this.getScheduleRun(insertedId(result));
  }

  finishScheduleRun(id: number, result: unknown, error?: string): void {
    this.database.connection
      .prepare("UPDATE schedule_runs SET status = ?, result_json = ?, error = ?, finished_at = ? WHERE id = ?")
      .run(error ? "failed" : "succeeded", result ? JSON.stringify(result) : null, error ?? null, now(), id);
  }

  getScheduleRun(id: number): ScheduleRun {
    const item = row(this.database.connection.prepare("SELECT * FROM schedule_runs WHERE id = ?").get(id), "schedule run");
    return {
      id: integer(item.id), publicId: text(item.public_id), modelVersion: text(item.model_version),
      horizonStart: text(item.horizon_start), horizonEnd: text(item.horizon_end),
      status: text(item.status) as ScheduleRun["status"], error: nullableText(item.error),
      createdAt: text(item.created_at), finishedAt: nullableText(item.finished_at),
    };
  }

  listScheduleRuns(): ScheduleRun[] {
    return this.database.connection.prepare("SELECT id FROM schedule_runs ORDER BY id DESC LIMIT 20").all()
      .map((value) => this.getScheduleRun(integer(row(value, "schedule run").id)));
  }

  latestUnscheduledTaskIds(): number[] {
    const value = this.database.connection
      .prepare("SELECT result_json FROM schedule_runs WHERE status = 'succeeded' ORDER BY id DESC LIMIT 1")
      .get();
    if (!value) return [];
    const result = json<{ unscheduledTaskIds?: number[] }>(row(value, "schedule result").result_json, {});
    return result.unscheduledTaskIds ?? [];
  }

  upsertWeather(forecasts: Omit<WeatherForecast, "expiresAt">[], fetchedAt: string, expiresAt: string): void {
    const statement = this.database.connection.prepare(
      `INSERT INTO weather_forecasts
        (location_key, forecast_at, temperature_f, precipitation_probability, short_forecast, fetched_at, expires_at)
       VALUES ('boston-ma', ?, ?, ?, ?, ?, ?)
       ON CONFLICT(location_key, forecast_at) DO UPDATE SET temperature_f = excluded.temperature_f,
         precipitation_probability = excluded.precipitation_probability, short_forecast = excluded.short_forecast,
         fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`,
    );
    this.database.connection.exec("BEGIN IMMEDIATE");
    try {
      for (const forecast of forecasts) statement.run(
        forecast.forecastAt, forecast.temperatureF, forecast.precipitationProbability,
        forecast.shortForecast, fetchedAt, expiresAt,
      );
      this.database.connection.exec("COMMIT");
    } catch (error) {
      this.database.connection.exec("ROLLBACK");
      throw error;
    }
  }

  listWeather(): WeatherForecast[] {
    return this.database.connection
      .prepare("SELECT * FROM weather_forecasts WHERE location_key = 'boston-ma' AND expires_at > ? ORDER BY forecast_at")
      .all(now())
      .map((value) => {
        const item = row(value, "weather forecast");
        return {
          forecastAt: text(item.forecast_at),
          temperatureF: item.temperature_f === null ? null : integer(item.temperature_f),
          precipitationProbability: item.precipitation_probability === null ? null : integer(item.precipitation_probability),
          shortForecast: nullableText(item.short_forecast),
          expiresAt: text(item.expires_at),
        };
      });
  }

  upsertHealthObservation(input: Omit<HealthObservation, "id" | "publicId">): HealthObservation {
    const result = this.database.connection
      .prepare(
        `INSERT INTO health_observations (public_id, source, kind, start_at, end_at, external_id, details_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(source, external_id) DO UPDATE SET kind = excluded.kind, start_at = excluded.start_at,
           end_at = excluded.end_at, details_json = excluded.details_json
         RETURNING id`,
      )
      .get(randomUUID(), input.source, input.kind, input.startAt, input.endAt, input.externalId, JSON.stringify(input.details), now());
    const id = integer(row(result, "health observation").id);
    return this.listHealthObservations().find((item) => item.id === id)!;
  }

  listHealthObservations(): HealthObservation[] {
    return this.database.connection.prepare("SELECT * FROM health_observations ORDER BY start_at DESC").all().map((value) => {
      const item = row(value, "health observation");
      return {
        id: integer(item.id), publicId: text(item.public_id), source: text(item.source),
        kind: text(item.kind) as HealthObservation["kind"], startAt: text(item.start_at), endAt: text(item.end_at),
        externalId: nullableText(item.external_id), details: json(item.details_json, {}),
      };
    });
  }

  ensureIntegrationAccount(kind: "google_calendar" | "garmin" | "weather", externalAccountId: string): number {
    const timestamp = now();
    this.database.connection
      .prepare(
        `INSERT INTO integration_accounts (kind, external_account_id, status, created_at, updated_at)
         VALUES (?, ?, 'configured', ?, ?)
         ON CONFLICT(kind, external_account_id) DO NOTHING`,
      )
      .run(kind, externalAccountId, timestamp, timestamp);
    return integer(row(
      this.database.connection.prepare("SELECT id FROM integration_accounts WHERE kind = ? AND external_account_id = ?").get(kind, externalAccountId),
      "integration account",
    ).id);
  }

  findMappedTask(integrationAccountId: number, externalId: string): number | null {
    const value = this.database.connection
      .prepare("SELECT task_id FROM external_task_mappings WHERE integration_account_id = ? AND external_id = ?")
      .get(integrationAccountId, externalId);
    return value ? integer(row(value, "external task mapping").task_id) : null;
  }

  mapExternalTask(integrationAccountId: number, externalId: string, taskId: number, externalUpdatedAt?: string): void {
    const timestamp = now();
    this.database.connection
      .prepare(
        `INSERT INTO external_task_mappings
          (integration_account_id, external_id, task_id, external_updated_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(integration_account_id, external_id) DO UPDATE SET task_id = excluded.task_id,
           external_updated_at = excluded.external_updated_at, updated_at = excluded.updated_at`,
      )
      .run(integrationAccountId, externalId, taskId, externalUpdatedAt ?? null, timestamp, timestamp);
  }

  tagId(publicId: string): number {
    return integer(row(this.database.connection.prepare("SELECT id FROM tags WHERE public_id = ?").get(publicId), "reserved tag").id);
  }
}