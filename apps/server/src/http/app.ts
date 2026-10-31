import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serveStatic } from "@hono/node-server/serve-static";
import type { TaskRepository } from "@mind-palace/database";
import {
  kanbanStatuses,
  lifecycleStatuses,
  tagTypes,
  timeBlockStatuses,
  timeBlockTypes,
  type CreateTaskInput,
  type IntegrationConnection,
  type LifecycleStatus,
  type KanbanStatus,
  type TagType,
  type TimeBlockStatus,
  type TimeBlockType,
  type UpsertRecurrenceInput,
} from "@mind-palace/shared";
import { Hono } from "hono";
import { assertBriefingDate, briefingPapers, type BriefingService } from "../services/briefing-service.js";
import type { CalendarImportService } from "../services/calendar-import-service.js";
import type { GarminService } from "../services/garmin-service.js";
import type { ScheduleService } from "../services/schedule-service.js";
import type { WeatherService } from "../services/weather-service.js";
import { RECURRENCE_LOOKAHEAD_DAYS } from "../services/recurrence-service.js";
import type { RecurrenceService } from "../services/recurrence-service.js";
import { addDays, localDate } from "../services/clock.js";
import type { JobScheduler } from "../services/job-scheduler.js";
import { parseRuleInput, parseRulePatch } from "./rules.js";
import { isTimeBlockBody, numberParam, optionalText, requiredString } from "./validation.js";

interface Dependencies {
  tasks: TaskRepository;
  schedule: ScheduleService;
  weather: WeatherService;
  calendar: CalendarImportService;
  garmin: GarminService;
  integrationRegistry: IntegrationRegistration[];
  recurrence: RecurrenceService;
  scheduler: JobScheduler;
  briefing: BriefingService;
}

/** One authenticated provider's place in `GET /api/integrations` — the composition root fills these in. */
export interface IntegrationRegistration {
  key: string;
  label: string;
  status: () => IntegrationConnection;
}

/** Validate and coerce a recurrence payload. Shared by create and update so both reject the same things. */
function recurrenceTemplateInput(body: Record<string, unknown>): UpsertRecurrenceInput {
  const frequency = body.frequency;
  if (frequency !== "daily" && frequency !== "weekly") throw new Error("frequency must be daily or weekly");
  const weekdays = Array.isArray(body.weekdays) ? body.weekdays.map(Number) : [];
  if (frequency === "weekly" && weekdays.length === 0) throw new Error("A weekly recurrence needs at least one weekday");
  const autoArchiveHour = body.autoArchiveHour === null || body.autoArchiveHour === undefined
    ? null
    : Number(body.autoArchiveHour);
  if (autoArchiveHour !== null && !(Number.isInteger(autoArchiveHour) && autoArchiveHour >= 0 && autoArchiveHour <= 23)) {
    throw new Error("autoArchiveHour must be an hour 0-23");
  }
  const durationMinutes = Number(body.durationMinutes ?? 30);
  if (!Number.isInteger(durationMinutes) || durationMinutes < 0) throw new Error("durationMinutes must be a whole number of minutes");
  return {
    title: requiredString(body.title, "title"),
    durationMinutes,
    frequency,
    weekdays,
    autoArchiveHour,
    intervalCount: typeof body.intervalCount === "number" ? body.intervalCount : 1,
    nextOccurrenceDate: requiredString(body.nextOccurrenceDate, "nextOccurrenceDate"),
    ...(typeof body.description === "string" || body.description === null ? { description: body.description } : {}),
    ...(typeof body.priority === "number" ? { priority: body.priority } : {}),
    ...(typeof body.splittable === "boolean" ? { splittable: body.splittable } : {}),
    ...(typeof body.minChunkMinutes === "number" ? { minChunkMinutes: body.minChunkMinutes } : {}),
    ...(typeof body.maxChunkMinutes === "number" ? { maxChunkMinutes: body.maxChunkMinutes } : {}),
    ...(Array.isArray(body.tagIds) ? { tagIds: body.tagIds.map(Number) } : {}),
    ...(typeof body.localStartTime === "string" ? { localStartTime: body.localStartTime } : {}),
    ...(typeof body.active === "boolean" ? { active: body.active } : {}),
  };
}

export function createHttpApp({ tasks, schedule, weather, calendar, garmin, integrationRegistry, recurrence, scheduler, briefing }: Dependencies): Hono {
  const app = new Hono();

  app.onError((error, context) => {
    console.error(error);
    const notFound = error.message.startsWith("Expected database row");
    return context.json({ error: error.message }, notFound ? 404 : 400);
  });

  app.get("/api/health", (context) => context.json({ ok: true }));
  app.get("/api/jobs", (context) => context.json(scheduler.status()));
  // Run a job on demand. Every job is idempotent, so this is safe to poke: it is how you force a
  // sweep (decay, recurrence materialization) instead of waiting for its pinned time.
  app.post("/api/jobs/:name/run", async (context) => {
    const name = context.req.param("name");
    if (!await scheduler.runNow(name)) throw new Error(`No job named ${name}`);
    return context.json(scheduler.status());
  });
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
  // The daily briefing: the printed, no-screen view of the app. `GET` returns the rendered PDF (the
  // browser's print dialog and `curl -o briefing.pdf` both work); `?format=html` returns the same
  // page as HTML for designing against. `date` is a local calendar date in the briefing's zone.
  app.get("/api/briefing", async (context) => {
    const rawDate = context.req.query("date");
    const date = rawDate === undefined ? undefined : assertBriefingDate(rawDate);
    const paper = context.req.query("paper");
    if (paper !== undefined && !(briefingPapers as readonly string[]).includes(paper)) {
      throw new Error(`paper must be one of ${briefingPapers.join(", ")}`);
    }
    const request = {
      ...(date === undefined ? {} : { date }),
      ...(paper === undefined ? {} : { paper }),
    };
    if (context.req.query("format") === "html") {
      return context.html(await briefing.renderHtml(request));
    }
    const document = await briefing.renderPdf(request);
    return context.body(Buffer.from(document.pdfBase64, "base64"), 200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="briefing-${document.date}.pdf"`,
      "X-Briefing-Pages": String(document.pages),
    });
  });
  // The payload behind the PDF, for debugging and for any future medium that wants the facts
  // without the page.
  app.get("/api/briefing/payload", (context) => {
    const rawDate = context.req.query("date");
    const date = rawDate === undefined ? undefined : assertBriefingDate(rawDate);
    return context.json(briefing.buildPayload(date === undefined ? {} : { date }));
  });

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
      ...(body.autoArchiveAt === null || typeof body.autoArchiveAt === "string" ? { autoArchiveAt: body.autoArchiveAt } : {}),
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

  /**
   * Recurrences are their own resource, not a mode on a task: a template defines what to create, so it
   * has its own fields and its own lifecycle. Creating or editing one materializes immediately —
   * authoring a recurrence should visibly do something rather than wait for tomorrow's job.
   */
  app.get("/api/recurrence-templates", (context) => context.json(tasks.listRecurrenceTemplates()));

  app.post("/api/recurrence-templates", async (context) => {
    const body = (await context.req.json()) as Record<string, unknown>;
    const template = tasks.createRecurrenceTemplate(recurrenceTemplateInput(body));
    const materialized = recurrence.materializeThrough(
      addDays(localDate(new Date()), RECURRENCE_LOOKAHEAD_DAYS),
      localDate(new Date()),
      template.id,
    );
    return context.json({ template, materialized }, 201);
  });

  app.patch("/api/recurrence-templates/:id", async (context) => {
    const templateId = numberParam(context.req.param("id"), "recurrence template id");
    const body = (await context.req.json()) as Record<string, unknown>;
    const template = tasks.updateRecurrenceTemplate(templateId, recurrenceTemplateInput(body));
    const materialized = recurrence.materializeThrough(
      addDays(localDate(new Date()), RECURRENCE_LOOKAHEAD_DAYS),
      localDate(new Date()),
      template.id,
    );
    return context.json({ template, materialized });
  });

  app.delete("/api/recurrence-templates/:id", (context) => {
    // Deleting a recurrence stops it; the occurrences it already produced stay on the board, because
    // they are ordinary tasks that happen to have been created this way.
    tasks.deleteRecurrenceTemplate(numberParam(context.req.param("id"), "recurrence template id"));
    return context.json({ ok: true });
  });

  app.post("/api/schedule/generate", async (context) => context.json(await schedule.generate()));
  // Materialize the recurrence window on demand. Reports what it did — a recurrence whose weekdays all
  // fall outside the window legitimately creates nothing, and saying so beats a silent 200.
  app.post("/api/recurrences/materialize", async (context) => {
    const body = (await context.req.json()) as Record<string, unknown>;
    const endDate = typeof body.endDate === "string"
      ? body.endDate
      : addDays(localDate(new Date()), RECURRENCE_LOOKAHEAD_DAYS);
    return context.json(recurrence.materializeThrough(endDate));
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

  // Unarchiving is its own route rather than a `lifecycle` call because it also moves the decay
  // clock forward; letting the generic route do it would leave unarchived tasks to be re-archived
  // on the next sweep.
  app.post("/api/tasks/:id/unarchive", (context) => {
    return context.json(tasks.unarchiveTask(numberParam(context.req.param("id"), "task id")));
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