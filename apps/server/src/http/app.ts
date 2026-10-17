import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serveStatic } from "@hono/node-server/serve-static";
import type { TaskRepository } from "@mind-palace/database";
import {
  kanbanStatuses,
  lifecycleStatuses,
  ruleEffectTypes,
  tagTypes,
  timeBlockStatuses,
  timeBlockTypes,
  type CreateTaskInput,
  type RuleCondition,
  type RuleEffect,
  type RuleStrength,
  type SchedulerRuleInput,
  type IntegrationConnection,
  type LifecycleStatus,
  type KanbanStatus,
  type TagType,
  type TimeBlockStatus,
  type TimeBlockType,
} from "@mind-palace/shared";
import { Hono } from "hono";
import type { CalendarImportService } from "../services/calendar-import-service.js";
import type { GarminService } from "../services/garmin-service.js";
import type { ScheduleService } from "../services/schedule-service.js";
import type { WeatherService } from "../services/weather-service.js";
import type { RecurrenceService } from "../services/recurrence-service.js";
import type { JobScheduler } from "../services/job-scheduler.js";

interface Dependencies {
  tasks: TaskRepository;
  schedule: ScheduleService;
  weather: WeatherService;
  calendar: CalendarImportService;
  garmin: GarminService;
  integrationRegistry: IntegrationRegistration[];
  recurrence: RecurrenceService;
  scheduler: JobScheduler;
}

/** One authenticated provider's place in `GET /api/integrations` — the composition root fills these in. */
export interface IntegrationRegistration {
  key: string;
  label: string;
  status: () => IntegrationConnection;
}

function isTimeBlockBody(value: unknown): value is { startAt: string; endAt: string; type?: string; notes?: string } {
  return typeof value === "object" && value !== null && "startAt" in value && "endAt" in value;
}

function numberParam(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

/** Optional user text: absent → undefined (leave unchanged), null/blank → null (clear), else trimmed. */
function optionalText(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  return value.trim() || null;
}

function parseRuleStrength(value: unknown): RuleStrength {
  if (!value || typeof value !== "object") throw new Error("strength is required");
  const candidate = value as { kind?: unknown; weight?: unknown };
  if (candidate.kind === "hard") return { kind: "hard" };
  if (candidate.kind === "soft") {
    if (typeof candidate.weight !== "number") throw new Error("Soft rules need a numeric weight");
    return { kind: "soft", weight: candidate.weight };
  }
  throw new Error("strength.kind must be hard or soft");
}

/** Reject effects the worker does not implement so the rules table never holds dead behavior. */
function parseRuleEffect(value: unknown): RuleEffect {
  if (!value || typeof value !== "object" || typeof (value as { type?: unknown }).type !== "string") {
    throw new Error("effect.type is required");
  }
  const type = (value as { type: string }).type;
  if (!ruleEffectTypes.includes(type as (typeof ruleEffectTypes)[number])) {
    throw new Error(`Unknown rule effect '${type}'`);
  }
  return value as RuleEffect;
}

function parseRuleInput(body: Record<string, unknown>): SchedulerRuleInput {
  const applies = body.applies;
  return {
    title: requiredString(body.title, "title"),
    ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
    ...(applies === null || (applies && typeof applies === "object") ? { applies: applies as RuleCondition | null } : {}),
    effect: parseRuleEffect(body.effect),
    strength: parseRuleStrength(body.strength),
    ...(typeof body.reason === "string" ? { reason: body.reason } : {}),
  };
}

function parseRulePatch(body: Record<string, unknown>): Partial<SchedulerRuleInput> {
  const patch: Partial<SchedulerRuleInput> = {};
  if (typeof body.title === "string") patch.title = requiredString(body.title, "title");
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (body.applies === null) patch.applies = null;
  else if (body.applies && typeof body.applies === "object") patch.applies = body.applies as RuleCondition;
  if (body.effect !== undefined) patch.effect = parseRuleEffect(body.effect);
  if (body.strength !== undefined) patch.strength = parseRuleStrength(body.strength);
  if (typeof body.reason === "string") patch.reason = body.reason;
  return patch;
}

export function createHttpApp({ tasks, schedule, weather, calendar, garmin, integrationRegistry, recurrence, scheduler }: Dependencies): Hono {
  const app = new Hono();

  app.onError((error, context) => {
    console.error(error);
    const notFound = error.message.startsWith("Expected database row");
    return context.json({ error: error.message }, notFound ? 404 : 400);
  });

  app.get("/api/health", (context) => context.json({ ok: true }));
  app.get("/api/jobs", (context) => context.json(scheduler.status()));
  app.get("/api/tasks", (context) => context.json(tasks.listTasks()));
  app.get("/api/tags", (context) => context.json(tasks.listTags()));
  app.get("/api/scheduler-rules", (context) => context.json(tasks.listSchedulerRules()));
  app.get("/api/schedule", (context) => context.json(schedule.getSchedule()));
  app.get("/api/weather", async (context) =>
    context.json(await weather.getWeather(false, context.req.query("from"), context.req.query("to"))));
  app.get("/api/health-observations", (context) =>
    context.json(tasks.listSleepSessions(context.req.query("from"), context.req.query("to"))));
  app.get("/api/health-activities", (context) =>
    context.json(tasks.listHealthActivities(context.req.query("from"), context.req.query("to"))));
  app.get("/api/health-observations/:id", (context) =>
    context.json(tasks.getSleepSession(numberParam(context.req.param("id"), "sleep session id"))));
  app.get("/api/health-activities/:id", (context) =>
    context.json(tasks.getHealthActivity(numberParam(context.req.param("id"), "activity id"))));
  app.get("/api/tasks/:id", (context) => context.json(tasks.getTask(numberParam(context.req.param("id"), "task id"))));
  app.get("/api/time-blocks/:id", (context) => context.json(tasks.getTimeBlock(numberParam(context.req.param("id"), "time block id"))));

  app.post("/api/tasks", async (context) => {
    const body = (await context.req.json()) as Record<string, unknown>;
    const kanbanStatus = kanbanStatuses.includes(body.kanbanStatus as KanbanStatus) ? body.kanbanStatus as KanbanStatus : "inbox";
    const input: CreateTaskInput = {
      title: requiredString(body.title, "title"),
      kanbanStatus,
      priority: typeof body.priority === "number" ? body.priority : 0,
      rank: typeof body.rank === "number" ? body.rank : Date.now(),
      durationMinutesRemaining: typeof body.durationMinutesRemaining === "number" ? body.durationMinutesRemaining : null,
      splittable: body.splittable === true,
      minChunkMinutes: typeof body.minChunkMinutes === "number" ? body.minChunkMinutes : 30,
      maxChunkMinutes: typeof body.maxChunkMinutes === "number" ? body.maxChunkMinutes : 180,
      tagIds: Array.isArray(body.tagIds) ? body.tagIds.map(Number) : [],
      ...(typeof body.description === "string" ? { description: body.description } : {}),
      ...(typeof body.earliestStart === "string" ? { earliestStart: body.earliestStart } : {}),
      ...(typeof body.deadlineAt === "string" ? { deadlineAt: body.deadlineAt } : {}),
      ...(isTimeBlockBody(body.timeBlock)
        ? {
            timeBlock: {
              startAt: requiredString(body.timeBlock.startAt, "timeBlock.startAt"),
              endAt: requiredString(body.timeBlock.endAt, "timeBlock.endAt"),
              ...(typeof body.timeBlock.type === "string" && timeBlockTypes.includes(body.timeBlock.type as TimeBlockType)
                ? { type: body.timeBlock.type as TimeBlockType }
                : {}),
              ...(typeof body.timeBlock.notes === "string" ? { notes: body.timeBlock.notes } : {}),
            },
          }
        : {}),
    };
    return context.json(tasks.getTask(tasks.createTask(input).id), 201);
  });

  app.patch("/api/tasks/:id", async (context) => {
    const taskId = numberParam(context.req.param("id"), "task id");
    const body = (await context.req.json()) as Record<string, unknown>;
    if (body.kanbanStatus !== undefined && !kanbanStatuses.includes(body.kanbanStatus as KanbanStatus)) {
      throw new Error("Invalid kanban status");
    }
    tasks.updateTask(taskId, {
      ...(typeof body.title === "string" ? { title: body.title } : {}),
      ...(body.description === null || typeof body.description === "string" ? { description: body.description } : {}),
      ...(body.kanbanStatus !== undefined ? { kanbanStatus: body.kanbanStatus as KanbanStatus } : {}),
      ...(typeof body.priority === "number" ? { priority: body.priority } : {}),
      ...(typeof body.rank === "number" ? { rank: body.rank } : {}),
      ...(body.durationMinutesRemaining === null || typeof body.durationMinutesRemaining === "number" ? { durationMinutesRemaining: body.durationMinutesRemaining } : {}),
      ...(typeof body.splittable === "boolean" ? { splittable: body.splittable } : {}),
      ...(typeof body.minChunkMinutes === "number" ? { minChunkMinutes: body.minChunkMinutes } : {}),
      ...(typeof body.maxChunkMinutes === "number" ? { maxChunkMinutes: body.maxChunkMinutes } : {}),
      ...(body.earliestStart === null || typeof body.earliestStart === "string" ? { earliestStart: body.earliestStart } : {}),
      ...(body.deadlineAt === null || typeof body.deadlineAt === "string" ? { deadlineAt: body.deadlineAt } : {}),
      ...(Array.isArray(body.tagIds) ? { tagIds: body.tagIds.map(Number) } : {}),
      ...(Array.isArray(body.dependsOnTaskIds) ? { dependsOnTaskIds: body.dependsOnTaskIds.map(Number) } : {}),
    });
    return context.json(tasks.getTask(taskId));
  });

  app.post("/api/scheduler-rules", async (context) => {
    const body = (await context.req.json()) as Record<string, unknown>;
    return context.json(tasks.createSchedulerRule(parseRuleInput(body)), 201);
  });

  app.patch("/api/scheduler-rules/:id", async (context) => {
    const body = (await context.req.json()) as Record<string, unknown>;
    return context.json(tasks.updateSchedulerRule(numberParam(context.req.param("id"), "rule id"), parseRulePatch(body)));
  });

  app.delete("/api/scheduler-rules/:id", (context) => {
    tasks.deleteSchedulerRule(numberParam(context.req.param("id"), "rule id"));
    return context.json(tasks.listSchedulerRules());
  });

  app.post("/api/tags", async (context) => {
    const body = (await context.req.json()) as Record<string, unknown>;
    const rawType = body.type ?? null;
    if (rawType !== null && !tagTypes.includes(rawType as TagType)) throw new Error("Invalid tag type");
    const type: TagType | null = rawType === null ? null : (rawType as TagType);
    return context.json(tasks.createTag({
      title: requiredString(body.title, "title"),
      ...(typeof body.description === "string" ? { description: body.description } : {}),
      parentIds: Array.isArray(body.parentIds) ? body.parentIds.map(Number) : [],
      type,
    }), 201);
  });

  app.patch("/api/tags/:id", async (context) => {
    const tagId = numberParam(context.req.param("id"), "tag id");
    const body = (await context.req.json()) as Record<string, unknown>;
    if (body.type !== undefined && body.type !== null && !tagTypes.includes(body.type as TagType)) {
      throw new Error("Invalid tag type");
    }
    return context.json(tasks.updateTag(tagId, {
      ...(typeof body.title === "string" ? { title: requiredString(body.title, "title") } : {}),
      ...(body.description === null || typeof body.description === "string" ? { description: body.description } : {}),
      ...(body.type === null || typeof body.type === "string" ? { type: body.type as TagType | null } : {}),
      ...(typeof body.isArchived === "boolean" ? { isArchived: body.isArchived } : {}),
    }));
  });

  app.post("/api/tags/:id/parents", async (context) => {
    const body = (await context.req.json()) as Record<string, unknown>;
    tasks.addTagParent(numberParam(context.req.param("id"), "tag id"), numberParam(String(body.parentId), "parent id"));
    return context.json(tasks.listTags());
  });

  app.delete("/api/tags/:id/parents/:parentId", (context) => {
    tasks.removeTagParent(numberParam(context.req.param("id"), "tag id"), numberParam(context.req.param("parentId"), "parent id"));
    return context.json(tasks.listTags());
  });

  app.post("/api/time-blocks", async (context) => {
    const body = (await context.req.json()) as Record<string, unknown>;
    const status = (body.status ?? "proposed") as TimeBlockStatus;
    if (!timeBlockStatuses.includes(status)) throw new Error("Invalid time block status");
    const type = (body.type ?? "work") as TimeBlockType;
    if (!timeBlockTypes.includes(type)) throw new Error("Invalid time block type");
    return context.json(tasks.createTimeBlock({
      taskId: numberParam(String(body.taskId), "task id"),
      startAt: requiredString(body.startAt, "startAt"),
      endAt: requiredString(body.endAt, "endAt"),
      status,
      type,
      source: "manual",
      ...(typeof body.notes === "string" ? { notes: body.notes } : {}),
    }), 201);
  });

  app.delete("/api/time-blocks/:id", (context) => {
    tasks.deleteTimeBlock(numberParam(context.req.param("id"), "time block id"));
    return context.json(schedule.getSchedule());
  });

  app.patch("/api/time-blocks/:id", async (context) => {
    const body = (await context.req.json()) as Record<string, unknown>;
    return context.json(tasks.updateTimeBlock(numberParam(context.req.param("id"), "time block id"), {
      ...(typeof body.startAt === "string" ? { startAt: body.startAt } : {}),
      ...(typeof body.endAt === "string" ? { endAt: body.endAt } : {}),
    }));
  });

  app.post("/api/time-blocks/:id/status", async (context) => {
    const body = (await context.req.json()) as Record<string, unknown>;
    if (!timeBlockStatuses.includes(body.status as TimeBlockStatus)) throw new Error("Invalid time block status");
    tasks.setTimeBlockStatus(numberParam(context.req.param("id"), "time block id"), body.status as TimeBlockStatus);
    return context.json(schedule.getSchedule());
  });

  app.post("/api/tasks/:id/accept-schedule", (context) => {
    tasks.acceptTaskSchedule(numberParam(context.req.param("id"), "task id"));
    return context.json(schedule.getSchedule());
  });

  // Remove the "task :id depends on :dependencyId" link (either direction of the page UI).
  app.delete("/api/tasks/:id/dependencies/:dependencyId", (context) => {
    const taskId = numberParam(context.req.param("id"), "task id");
    tasks.removeTaskDependency(taskId, numberParam(context.req.param("dependencyId"), "task id"));
    return context.json(tasks.getTask(taskId));
  });

  app.post("/api/tasks/:id/recurrence", async (context) => {
    const taskId = numberParam(context.req.param("id"), "task id");
    const body = (await context.req.json()) as Record<string, unknown>;
    if (body.frequency !== "daily" && body.frequency !== "weekly") throw new Error("frequency must be daily or weekly");
    return context.json(tasks.upsertRecurrence(taskId, {
      frequency: body.frequency,
      intervalCount: typeof body.intervalCount === "number" ? body.intervalCount : 1,
      weekdays: Array.isArray(body.weekdays) ? body.weekdays.map(Number) : [],
      ...(typeof body.localStartTime === "string" ? { localStartTime: body.localStartTime } : {}),
      nextOccurrenceDate: requiredString(body.nextOccurrenceDate, "nextOccurrenceDate"),
    }));
  });

  app.post("/api/schedule/generate", async (context) => context.json(await schedule.generate()));
  app.post("/api/recurrences/materialize", async (context) => {
    const body = (await context.req.json()) as Record<string, unknown>;
    return context.json({ taskIds: recurrence.materializeThrough(requiredString(body.endDate, "endDate")) });
  });
  app.post("/api/weather/refresh", async (context) => context.json(await weather.getWeather(true)));

  app.post("/api/integrations/calendar/import", async (context) => {
    const body = (await context.req.json()) as Record<string, unknown>;
    if (!Array.isArray(body.events)) throw new Error("events must be an array");
    return context.json(calendar.importCalendar(requiredString(body.accountId, "accountId"), body.events as never));
  });

  app.post("/api/integrations/garmin/sync", async (context) => context.json(await garmin.sync()));
  app.get("/api/integrations", (context) => context.json(
    integrationRegistry.map((entry) => ({ key: entry.key, label: entry.label, ...entry.status() })),
  ));

  app.patch("/api/health-observations/:id", async (context) => {
    const body = (await context.req.json()) as Record<string, unknown>;
    const notes = optionalText(body.notes);
    return context.json(tasks.updateSleepSession(
      numberParam(context.req.param("id"), "sleep session id"),
      { ...(notes !== undefined ? { notes } : {}) },
    ));
  });

  app.patch("/api/health-activities/:id", async (context) => {
    const body = (await context.req.json()) as Record<string, unknown>;
    const title = optionalText(body.title);
    const notes = optionalText(body.notes);
    return context.json(tasks.updateHealthActivity(
      numberParam(context.req.param("id"), "activity id"),
      { ...(title !== undefined ? { title } : {}), ...(notes !== undefined ? { notes } : {}) },
    ));
  });

  app.post("/api/tasks/:id/lifecycle", async (context) => {
    const taskId = numberParam(context.req.param("id"), "task id");
    const body = (await context.req.json()) as Record<string, unknown>;
    if (!lifecycleStatuses.includes(body.status as LifecycleStatus)) throw new Error("Invalid lifecycle status");
    tasks.setTaskLifecycle(taskId, body.status as LifecycleStatus);
    return context.json(tasks.getTask(taskId));
  });

  app.post("/api/tasks/:id/convert-to-tag", (context) => {
    const taskId = numberParam(context.req.param("id"), "task id");
    return context.json(tasks.convertTaskToTag(taskId));
  });

  const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../web/dist");
  if (existsSync(webRoot)) {
    // Hashed build output. A miss under /assets/ must be a hard 404: falling through to the SPA
    // shell below would answer a stale asset URL with `index.html` (200, text/html), which
    // browsers and CDNs cache and then refuse to execute as JS/CSS.
    app.use("/assets/*", serveStatic({
      root: webRoot,
      onFound: (_path, context) => context.header("Cache-Control", "public, max-age=31536000, immutable"),
    }));
    app.get("/assets/*", (context) => context.body(null, 404));

    app.use("/*", serveStatic({
      root: webRoot,
      onFound: (_path, context) => context.header("Cache-Control", "no-cache"),
    }));
    app.get("/*", serveStatic({
      root: webRoot,
      path: "index.html",
      onFound: (_path, context) => context.header("Cache-Control", "no-cache"),
    }));
  }

  return app;
}