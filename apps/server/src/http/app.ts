import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serveStatic } from "@hono/node-server/serve-static";
import type { OrchestrationRepository, TaskRepository } from "@opencode-task-manager/database";
import {
  automationPolicies,
  kanbanStatuses,
  lifecycleStatuses,
  taskTypes,
  timeBlockStatuses,
  type AutomationPolicy,
  type CreateTaskInput,
  type LifecycleStatus,
  type TaskType,
  type KanbanStatus,
  type TimeBlockStatus,
} from "@opencode-task-manager/shared";
import { Hono } from "hono";
import type { OpenCodeGateway } from "../services/opencode-gateway.js";
import type { IntegrationService } from "../services/integration-service.js";
import type { ScheduleService } from "../services/schedule-service.js";
import type { WeatherService } from "../services/weather-service.js";
import type { RecurrenceService } from "../services/recurrence-service.js";

interface Dependencies {
  repository: OrchestrationRepository;
  tasks: TaskRepository;
  gateway: OpenCodeGateway;
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

export function createHttpApp({ repository, tasks, gateway, schedule, weather, integrations, recurrence }: Dependencies): Hono {
  const app = new Hono();

  app.onError((error, context) => {
    console.error(error);
    const notFound = error.message.startsWith("Expected database row");
    return context.json({ error: error.message }, notFound ? 404 : 400);
  });

  app.get("/api/health", (context) => context.json({ ok: true }));
  app.get("/api/workflows", (context) => context.json(repository.listWorkflows()));
  app.get("/api/workspaces", (context) => context.json(repository.listWorkspaces()));
  app.get("/api/resources", (context) => context.json(repository.listResources()));
  app.get("/api/tasks", (context) => context.json(repository.listTasks()));
  app.get("/api/tags", (context) => context.json(tasks.listTags()));
  app.get("/api/schedule", (context) => context.json(schedule.getSchedule()));
  app.get("/api/weather", async (context) => context.json(await weather.getForecast()));
  app.get("/api/health-observations", (context) => context.json(tasks.listHealthObservations()));
  app.get("/api/tasks/:id", (context) => context.json(repository.getTask(numberParam(context.req.param("id"), "task id"))));

  app.post("/api/workspaces", async (context) => {
    const body = (await context.req.json()) as Record<string, unknown>;
    const directory = requiredString(body.directory, "directory");
    if (!isAbsolute(directory)) throw new Error("directory must be absolute");
    if (!existsSync(directory) || !statSync(directory).isDirectory()) throw new Error("directory does not exist");
    const workspace = repository.createWorkspace({
      name: requiredString(body.name, "name"),
      directory,
      ...(typeof body.repository === "string" && body.repository.trim() ? { repository: body.repository.trim() } : {}),
      ...(typeof body.defaultBranch === "string" && body.defaultBranch.trim() ? { defaultBranch: body.defaultBranch.trim() } : {}),
    });
    return context.json(workspace, 201);
  });

  app.post("/api/resources", async (context) => {
    const body = (await context.req.json()) as Record<string, unknown>;
    const id = repository.createResource(
      requiredString(body.key, "key"),
      requiredString(body.name, "name"),
      typeof body.description === "string" ? body.description : undefined,
    );
    return context.json({ id }, 201);
  });

  app.post("/api/tasks", async (context) => {
    const body = (await context.req.json()) as Record<string, unknown>;
    const taskType = (body.taskType ?? "question") as TaskType;
    if (!taskTypes.includes(taskType)) throw new Error("taskType must be bug, feature, or question");
    const policy = (body.automationPolicy ?? "manual") as AutomationPolicy;
    if (!automationPolicies.includes(policy)) throw new Error("Invalid automationPolicy");
    const input: CreateTaskInput = {
      taskType,
      title: requiredString(body.title, "title"),
      automationPolicy: policy,
      startImmediately: body.startImmediately === true,
      isNewWorktree: body.isNewWorktree === true,
      ...(typeof body.initialPrompt === "string" ? { initialPrompt: body.initialPrompt } : {}),
      ...(typeof body.description === "string" ? { description: body.description } : {}),
      ...(body.workspaceId !== undefined ? { workspaceId: numberParam(String(body.workspaceId), "workspaceId") } : {}),
      ...(typeof body.priority === "number" ? { priority: body.priority } : {}),
      ...(typeof body.model === "string" && body.model.trim() ? { model: body.model.trim() } : {}),
      ...(typeof body.agent === "string" && body.agent.trim() ? { agent: body.agent.trim() } : {}),
    };
    const task = repository.createTask(input);
    tasks.updateTask(task.id, {
      description: input.description ?? null,
      kanbanStatus: kanbanStatuses.includes(body.kanbanStatus as KanbanStatus) ? body.kanbanStatus as KanbanStatus : "inbox",
      priority: typeof body.priority === "number" ? body.priority : 0,
      rank: typeof body.rank === "number" ? body.rank : Date.now(),
      durationMinutes: typeof body.durationMinutes === "number" ? body.durationMinutes : null,
      splittable: body.splittable === true,
      minChunkMinutes: typeof body.minChunkMinutes === "number" ? body.minChunkMinutes : 30,
      maxChunkMinutes: typeof body.maxChunkMinutes === "number" ? body.maxChunkMinutes : 180,
      earliestStart: typeof body.earliestStart === "string" ? body.earliestStart : null,
      deadlineAt: typeof body.deadlineAt === "string" ? body.deadlineAt : null,
      fixedStart: typeof body.fixedStart === "string" ? body.fixedStart : null,
      fixedEnd: typeof body.fixedEnd === "string" ? body.fixedEnd : null,
      parentTaskId: typeof body.parentTaskId === "number" ? body.parentTaskId : null,
      tagIds: Array.isArray(body.tagIds) ? body.tagIds.map(Number) : [],
    });
    return context.json(repository.getTask(task.id), 201);
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
    return context.json(repository.getTask(taskId));
  });

  app.post("/api/tasks/:id/start-agent", (context) => {
    const taskId = numberParam(context.req.param("id"), "task id");
    tasks.enableAutomation(taskId);
    repository.enqueueStart(taskId, "initial");
    return context.json(repository.getTask(taskId));
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

  app.post("/api/tasks/:id/pause", async (context) => {
    const taskId = numberParam(context.req.param("id"), "task id");
    const session = repository.getSessionForTask(taskId);
    if (session && repository.getActiveRun(taskId)) await gateway.abort(session);
    repository.setTaskLifecycle(taskId, "paused");
    return context.json(repository.getTask(taskId));
  });

  app.post("/api/tasks/:id/resume", (context) => {
    const taskId = numberParam(context.req.param("id"), "task id");
    repository.setTaskLifecycle(taskId, "active");
    repository.enqueueStart(taskId, "user_resume");
    return context.json(repository.getTask(taskId));
  });

  app.post("/api/tasks/:id/run", (context) => {
    const taskId = numberParam(context.req.param("id"), "task id");
    tasks.enableAutomation(taskId);
    repository.enqueueStart(taskId, "user_resume");
    return context.json(repository.getTask(taskId));
  });

  app.post("/api/tasks/:id/lifecycle", async (context) => {
    const taskId = numberParam(context.req.param("id"), "task id");
    const body = (await context.req.json()) as Record<string, unknown>;
    if (!lifecycleStatuses.includes(body.status as LifecycleStatus)) throw new Error("Invalid lifecycle status");
    repository.setTaskLifecycle(taskId, body.status as LifecycleStatus);
    return context.json(repository.getTask(taskId));
  });

  app.post("/api/tasks/:id/transition", async (context) => {
    const taskId = numberParam(context.req.param("id"), "task id");
    const body = (await context.req.json()) as Record<string, unknown>;
    const nextState = repository.findNextState(taskId, requiredString(body.stateKey, "stateKey"), "human_selected");
    if (!nextState) throw new Error("The requested workflow transition is not allowed");
    repository.transitionTask(taskId, nextState, "manual", "user", typeof body.summary === "string" ? body.summary : null);
    if (!nextState.terminal && nextState.autoStart) repository.enqueueStart(taskId);
    return context.json(repository.getTask(taskId));
  });

  app.post("/api/tasks/:id/dependencies", async (context) => {
    const taskId = numberParam(context.req.param("id"), "task id");
    const body = (await context.req.json()) as Record<string, unknown>;
    repository.addDependency(taskId, {
      blockerTaskId: numberParam(String(body.blockerTaskId), "blockerTaskId"),
      requiredStateKey: requiredString(body.requiredStateKey, "requiredStateKey"),
    });
    return context.json(repository.getTask(taskId), 201);
  });

  app.post("/api/tasks/:id/resources", async (context) => {
    const taskId = numberParam(context.req.param("id"), "task id");
    const body = (await context.req.json()) as Record<string, unknown>;
    repository.addResourceRequirement(taskId, {
      resourceId: numberParam(String(body.resourceId), "resourceId"),
      ...(typeof body.stateKey === "string" && body.stateKey ? { stateKey: body.stateKey } : {}),
    });
    return context.json(repository.getTask(taskId), 201);
  });

  app.post("/api/approvals/:id/:decision", (context) => {
    const approvalId = numberParam(context.req.param("id"), "approval id");
    const decision = context.req.param("decision");
    if (decision !== "approve" && decision !== "reject") throw new Error("Decision must be approve or reject");
    const taskId = repository.resolveApproval(approvalId, decision === "approve");
    return context.json(repository.getTask(taskId));
  });

  app.post("/api/interactions/:id/reply", async (context) => {
    const interactionId = numberParam(context.req.param("id"), "interaction id");
    const body = (await context.req.json()) as Record<string, unknown>;
    const interaction = repository.getInteraction(interactionId);
    const task = repository.getTaskContext(interaction.taskId);
    const handledByOpenCode = await gateway.replyToInteraction(interaction, task.workspace.directory, body.response);
    const taskId = repository.resolveInteraction(interactionId, body.response);
    if (!handledByOpenCode) repository.enqueueStart(taskId, "user_resume", { userResponse: body.response });
    return context.json(repository.getTask(taskId));
  });

  const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../web/dist");
  if (existsSync(webRoot)) {
    app.use("/*", serveStatic({ root: webRoot }));
    app.get("/*", serveStatic({ root: webRoot, path: "index.html" }));
  }

  return app;
}
