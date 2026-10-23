import type { TaskRepository } from "@mind-palace/database";
import { reservedTagIds } from "@mind-palace/database";
import type { CalendarEventTask, TaskDetail } from "@mind-palace/shared";
import type { DesiredEvent, NormalizedCalendarEvent } from "./google-calendar-client.js";

export interface CalendarImportEvent {
  id: string;
  title: string;
  description?: string | null;
  startAt: string;
  endAt: string;
  updatedAt?: string;
  allDay?: boolean;
  status?: "confirmed" | "tentative" | "cancelled";
}

/** The mirrored result of one provider event: what the sync did with it. */
export type ImportOutcome = "created" | "updated" | "cancelled" | "skipped";

/**
 * Normalizer between a provider event and the unified task model. An event **is** a
 * `calendar_event` task carrying one accepted `calendar`-source block — no separate model.
 *
 * The sync calls `importCalendarEvent` (single event, so one bad event cannot abort a pass) and
 * `desiredEvent` (the push side's view of the same task). `importCalendar` remains the thin loop
 * for the manual import endpoint.
 */
export class CalendarImportService {
  constructor(private readonly tasks: TaskRepository) {}

  importCalendar(accountId: string, events: CalendarImportEvent[]): TaskDetail[] {
    const integrationId = this.tasks.ensureIntegrationAccount("google_calendar", accountId);
    const imported: TaskDetail[] = [];
    for (const event of events) {
      const outcome = this.importCalendarEvent(integrationId, event);
      if (outcome.taskId !== null) imported.push(this.tasks.getTask(outcome.taskId));
    }
    return imported;
  }

  /**
   * Idempotent single-event upsert. A `cancelled` event cancels the mapped task but keeps the
   * mapping, so the same event id can never resurrect as a fresh task (the D4 decision).
   */
  importCalendarEvent(
    integrationId: number,
    event: CalendarImportEvent | NormalizedCalendarEvent,
    options: { importAllDay?: boolean } = {},
  ): { taskId: number | null; outcome: ImportOutcome } {
    if (event.allDay && !options.importAllDay) return { taskId: null, outcome: "skipped" };
    const mappedTaskId = this.tasks.findMappedTask(integrationId, event.id);
    if (event.status === "cancelled") {
      if (mappedTaskId === null) return { taskId: null, outcome: "skipped" };
      this.tasks.updateTask(mappedTaskId, { kanbanStatus: "cancelled" });
      return { taskId: mappedTaskId, outcome: "cancelled" };
    }
    const calendarTagId = this.tasks.tagId(reservedTagIds.calendarEvent);
    let taskId = mappedTaskId;
    const created = taskId === null;
    if (taskId === null) {
      const task = this.tasks.createTask({
        title: event.title,
        origin: "calendar_import",
        ...(event.description ? { description: event.description } : {}),
      });
      taskId = task.id;
      this.tasks.mapExternalTask(integrationId, event.id, taskId, event.updatedAt ?? undefined);
    }
    this.tasks.updateTask(taskId, {
      title: event.title,
      description: event.description ?? null,
      // A calendar event's whole window lives in its time block, so nothing remains to schedule.
      durationMinutesRemaining: 0,
      tagIds: [calendarTagId],
      // A previously cancelled commitment that reappears in the calendar is live again.
      kanbanStatus: "ready",
    });
    this.tasks.upsertCalendarTimeBlock(taskId, event.startAt, event.endAt);
    return { taskId, outcome: created ? "created" : "updated" };
  }

  /** Wire shape → normalized event, used by the manual import endpoint and the pull. */
  normalize(event: CalendarImportEvent): NormalizedCalendarEvent {
    return {
      id: event.id,
      title: event.title,
      description: event.description ?? null,
      startAt: event.startAt,
      endAt: event.endAt,
      updatedAt: event.updatedAt ?? null,
      status: event.status ?? "confirmed",
      allDay: event.allDay === true,
      mindPalaceTaskId: null,
    };
  }

  /** The push side's desired Google event for a mirrored task. */
  desiredEvent(task: CalendarEventTask, timeZone: string): DesiredEvent {
    return {
      title: task.title,
      description: task.description,
      startAt: task.startAt,
      endAt: task.endAt,
      timeZone,
      taskId: task.taskId,
    };
  }
}
