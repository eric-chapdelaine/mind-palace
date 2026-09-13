import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serveStatic } from "@hono/node-server/serve-static";
import type { TaskRepository } from "@mind-palace/database";
import {
  kanbanStatuses,
  lifecycleStatuses,
  timeBlockStatuses,
  type CreateTaskInput,
  type LifecycleStatus,
  type KanbanStatus,
  type TimeBlockStatus,
} from "@mind-palace/shared";
import { Hono } from "hono";
import type { IntegrationService } from "../services/integration-service.js";
import type { ScheduleService } from "../services/schedule-service.js";
import type { WeatherService } from "../services/weather-service.js";
import type { RecurrenceService } from "../services/recurrence-service.js";

interface Dependencies {
  tasks: TaskRepository;
  schedule: ScheduleService;
  weather: WeatherService;
  integrations: IntegrationService;
  recurrence: RecurrenceService;
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

export function createHttpApp({ tasks, schedule, weather, integrations, recurrence }: Dependencies): Hono {
  const app = new Hono();

  app.onError((error, context) => {
    console.error(error);
    const notFound = error.message.startsWith("Expected database row");
    return context.json({ error: error.message }, notFound ? 404 : 400);
  });

  app.get("/api/health", (context) => context.json({ ok: true }));
  app.get("/api/tasks", (context) => context.json(tasks.listTasks()));
  app.get("/api/tags", (context) => context.json(tasks.listTags()));
  app.get("/api/schedule", (context) => context.json(schedule.getSchedule()));
  app.get("/api/weather", async (context) => context.json(await weather.getForecast()));
  app.get("/api/health-observations", (context) => context.json(tasks.listHealthObservations()));
  app.get("/api/tasks/:id", (context) => context.json(tasks.getTask(numberParam(context.req.param("id"), "task id"))));

  app.post("/api/tasks", async (context) => {
    const body = (await context.req.json()) as Record<string, unknown>;
    const kanbanStatus = kanbanStatuses.includes(body.kanbanStatus as KanbanStatus) ? body.kanbanStatus as KanbanStatus : "inbox";
    const input: CreateTaskInput = {
      title: requiredString(body.title, "title"),
      kanbanStatus,
      priority: typeof body.priority === "number" ? body.priority : 0,
      rank: typeof body.rank === "number" ? body.rank : Date.now(),
      durationMinutes: typeof body.durationMinutes === "number" ? body.durationMinutes : null,
      splittable: body.splittable === true,
      minChunkMinutes: typeof body.minChunkMinutes === "number" ? body.minChunkMinutes : 30,
      maxChunkMinutes: typeof body.maxChunkMinutes === "number" ? body.maxChunkMinutes : 180,
      ...(typeof body.parentTaskId === "number" ? { parentTaskId: body.parentTaskId } : {}),
      tagIds: Array.isArray(body.tagIds) ? body.tagIds.map(Number) : [],
      ...(typeof body.description === "string" ? { description: body.description } : {}),
      ...(typeof body.earliestStart === "string" ? { earliestStart: body.earliestStart } : {}),
      ...(typeof body.deadlineAt === "string" ? { deadlineAt: body.deadlineAt } : {}),
      ...(typeof body.fixedStart === "string" ? { fixedStart: body.fixedStart } : {}),
      ...(typeof body.fixedEnd === "string" ? { fixedEnd: body.fixedEnd } : {}),
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
      ...(body.durationMinutes === null || typeof body.durationMinutes === "number" ? { durationMinutes: body.durationMinutes } : {}),
      ...(typeof body.splittable === "boolean" ? { splittable: body.splittable } : {}),
      ...(typeof body.minChunkMinutes === "number" ? { minChunkMinutes: body.minChunkMinutes } : {}),
      ...(typeof body.maxChunkMinutes === "number" ? { maxChunkMinutes: body.maxChunkMinutes } : {}),
      ...(body.earliestStart === null || typeof body.earliestStart === "string" ? { earliestStart: body.earliestStart } : {}),
      ...(body.deadlineAt === null || typeof body.deadlineAt === "string" ? { deadlineAt: body.deadlineAt } : {}),
      ...(body.fixedStart === null || typeof body.fixedStart === "string" ? { fixedStart: body.fixedStart } : {}),
      ...(body.fixedEnd === null || typeof body.fixedEnd === "string" ? { fixedEnd: body.fixedEnd } : {}),
      ...(body.parentTaskId === null || typeof body.parentTaskId === "number" ? { parentTaskId: body.parentTaskId } : {}),
      ...(Array.isArray(body.tagIds) ? { tagIds: body.tagIds.map(Number) } : {}),
    });
    return context.json(tasks.getTask(taskId));
  });

  app.post("/api/tags", async (context) => {
    const body = (await context.req.json()) as Record<string, unknown>;
    return context.json(tasks.createTag({
      title: requiredString(body.title, "title"),
      ...(typeof body.description === "string" ? { description: body.description } : {}),
      parentIds: Array.isArray(body.parentIds) ? body.parentIds.map(Number) : [],
    }), 201);
  });

  app.post("/api/tags/:id/parents", async (context) => {
    const body = (await context.req.json()) as Record<string, unknown>;
    tasks.addTagParent(numberParam(context.req.param("id"), "tag id"), numberParam(String(body.parentId), "parent id"));
    return context.json(tasks.listTags());
  });

  app.post("/api/time-blocks", async (context) => {
    const body = (await context.req.json()) as Record<string, unknown>;
    const status = (body.status ?? "proposed") as TimeBlockStatus;
    if (!timeBlockStatuses.includes(status)) throw new Error("Invalid time block status");
    return context.json(tasks.createTimeBlock({
      taskId: numberParam(String(body.taskId), "task id"),
      startAt: requiredString(body.startAt, "startAt"),
      endAt: requiredString(body.endAt, "endAt"),
      status,
      source: "manual",
      ...(typeof body.notes === "string" ? { notes: body.notes } : {}),
    }), 201);
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
  app.post("/api/weather/refresh", async (context) => context.json(await weather.getForecast(true)));

  app.post("/api/integrations/calendar/import", async (context) => {
    const body = (await context.req.json()) as Record<string, unknown>;
    if (!Array.isArray(body.events)) throw new Error("events must be an array");
    return context.json(integrations.importCalendar(requiredString(body.accountId, "accountId"), body.events as never));
  });

  app.post("/api/integrations/garmin/import", async (context) => {
    const body = (await context.req.json()) as Record<string, unknown>;
    if (!Array.isArray(body.observations)) throw new Error("observations must be an array");
    return context.json(integrations.importGarmin(body.observations as never));
  });

  app.post("/api/tasks/:id/lifecycle", async (context) => {
    const taskId = numberParam(context.req.param("id"), "task id");
    const body = (await context.req.json()) as Record<string, unknown>;
    if (!lifecycleStatuses.includes(body.status as LifecycleStatus)) throw new Error("Invalid lifecycle status");
    tasks.setTaskLifecycle(taskId, body.status as LifecycleStatus);
    return context.json(tasks.getTask(taskId));
  });

  const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../web/dist");
  if (existsSync(webRoot)) {
    app.use("/*", serveStatic({ root: webRoot }));
    app.get("/*", serveStatic({ root: webRoot, path: "index.html" }));
  }

  return app;
}