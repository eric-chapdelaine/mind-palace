import type { OrchestrationRepository, TaskRepository } from "@opencode-task-manager/database";
import { reservedTagIds } from "@opencode-task-manager/database";
import type { HealthObservation, TaskDetail } from "@opencode-task-manager/shared";

export interface CalendarImportEvent {
  id: string;
  title: string;
  description?: string;
  startAt: string;
  endAt: string;
  updatedAt?: string;
  allDay?: boolean;
}

export class IntegrationService {
  constructor(
    private readonly orchestration: OrchestrationRepository,
    private readonly tasks: TaskRepository,
  ) {}

  importCalendar(accountId: string, events: CalendarImportEvent[]): TaskDetail[] {
    const integrationId = this.tasks.ensureIntegrationAccount("google_calendar", accountId);
    const calendarTagId = this.tasks.tagId(reservedTagIds.calendarEvent);
    const imported: TaskDetail[] = [];
    for (const event of events) {
      let taskId = this.tasks.findMappedTask(integrationId, event.id);
      if (taskId === null) {
        const task = this.orchestration.createTask({
          title: event.title,
          initialPrompt: event.description || event.title,
          taskType: "question",
          startImmediately: false,
          automationPolicy: "manual",
          ...(event.description ? { description: event.description } : {}),
        });
        taskId = task.id;
        this.tasks.mapExternalTask(integrationId, event.id, taskId, event.updatedAt);
      }
      this.tasks.updateTask(taskId, {
        title: event.title,
        description: event.description ?? null,
        fixedStart: event.startAt,
        fixedEnd: event.endAt,
        durationMinutes: Math.max(30, Math.ceil((new Date(event.endAt).getTime() - new Date(event.startAt).getTime()) / 60_000)),
        tagIds: [calendarTagId],
      });
      this.tasks.upsertCalendarTimeBlock(taskId, event.startAt, event.endAt);
      imported.push(this.orchestration.getTask(taskId));
    }
    return imported;
  }

  importGarmin(observations: Array<Omit<HealthObservation, "id" | "publicId" | "source">>): HealthObservation[] {
    for (const observation of observations) this.tasks.upsertHealthObservation({ ...observation, source: "garmin-connect-api" });
    return this.tasks.listHealthObservations();
  }
}
