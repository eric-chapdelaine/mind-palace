import type { TaskRepository } from "@mind-palace/database";
import { reservedTagIds } from "@mind-palace/database";
import { weekdayTagPublicIds, type MaterializeResult } from "@mind-palace/shared";
import { localInstant, startOfLocalDay, weekdayIndex, addDays, daysBetween, localDate } from "./clock.js";

/** Days of occurrences to keep on the board. Equal to `ScheduleService`'s horizon: a routine
 *  occurrence further out is a row nothing can schedule. */
export const RECURRENCE_LOOKAHEAD_DAYS = 7;

export class RecurrenceService {
  constructor(private readonly tasks: TaskRepository) {}

  /**
   * Create the occurrence rows for every active template, up to and including `endDate`.
   *
   * Idempotent, but not a one-shot ledger: a date only counts as done while its child is alive, so
   * deleting or completing yesterday's occurrence does not stop tomorrow's from appearing.
   *
   * Deliberately does **not** backfill: the window starts at today, because a server that was off
   * for a week should not manufacture a week of "wake up" rows nobody can act on any more.
   *
   * `onlyTemplateId` scopes the pass to one routine, so authoring one reports that routine's
   * result instead of counting every other routine's existing rows.
   */
  materializeThrough(
    endDate: string,
    today: string = localDate(new Date()),
    onlyTemplateId?: number,
  ): MaterializeResult {
    const created: number[] = [];
    const idleTemplates: string[] = [];
    let alreadyPresent = 0;
    const weekdayTagIds = weekdayTagPublicIds.map((publicId) => this.tasks.tagId(publicId));

    for (const template of this.tasks.listRecurrenceTemplates()) {
      if (onlyTemplateId !== undefined && template.id !== onlyTemplateId) continue;
      const result = this.materializeTemplate(template, endDate, today, weekdayTagIds);
      created.push(...result.created);
      alreadyPresent += result.alreadyPresent;
      if (!result.fired) idleTemplates.push(template.title);
    }
    return { created, alreadyPresent, idleTemplates };
  }

  /** The dates a rule selects inside `[today, endDate]`, oldest first. */
  private dates(
    template: { frequency: "daily" | "weekly"; intervalCount: number; weekdays: number[]; nextOccurrenceDate: string },
    endDate: string,
    today: string,
  ): string[] {
    const seriesStart = template.nextOccurrenceDate;
    const interval = Math.max(1, template.intervalCount);
    // The anchor bounds the window from below, so a future-dated rule does not fire early; `today`
    // bounds it from above, so a missed routine is missed rather than manufactured late.
    const from = seriesStart > today ? seriesStart : today;
    const dates: string[] = [];
    for (let cursor = from; cursor <= endDate; cursor = addDays(cursor, 1)) {
      // Both intervals are counted from the rule's anchor, never from whenever the job happened to
      // run — otherwise "every 3 days" would drift each time the window slid forward.
      if (template.frequency === "daily") {
        if (daysBetween(seriesStart, cursor) % interval === 0) dates.push(cursor);
        continue;
      }
      const weeksIn = Math.floor(daysBetween(seriesStart, cursor) / 7);
      if (weeksIn % interval !== 0) continue;
      if (template.weekdays.includes(weekdayIndex(cursor))) dates.push(cursor);
    }
    return dates;
  }

  private materializeTemplate(
    template: ReturnType<TaskRepository["listRecurrenceTemplates"]>[number],
    endDate: string,
    today: string,
    weekdayTagIds: number[],
  ): MaterializeResult & { fired: number } {
    const created: number[] = [];
    let alreadyPresent = 0;
    const dates = this.dates(template, endDate, today);
    if (dates.length === 0) return { created, alreadyPresent, idleTemplates: [], fired: 0 };

    // Every occurrence carries a tag that names its routine, so /tags/:id lists its whole history.
    const ownTagId = template.routineTagId ?? this.tasks.ensureTemplateTag(template.id, {
      title: template.title,
      description: `Recurring occurrences of the routine “${template.title}”.`,
    }).id;
    // A weekday tag on the template would pin every occurrence to that day and fight the rule.
    const inheritedTagIds = template.tagIds.filter((id) => !weekdayTagIds.includes(id));
    const routineTagId = this.tasks.tagId(reservedTagIds.routine);

    for (const occurrenceDate of dates) {
      if (this.tasks.recurrenceOccurrenceIsLive(template.id, occurrenceDate)) {
        alreadyPresent += 1;
        continue;
      }
      const autoArchiveAt = localInstant(
        occurrenceDate,
        template.autoArchiveHour ?? 23,
        template.autoArchiveHour === null ? 59 : 0,
      );
      // Today's occurrence is only worth creating if there is still time to do it. Without this,
      // authoring a routine in the afternoon drops a card that is already expired onto the board.
      if (autoArchiveAt.getTime() <= Date.now()) continue;
      const child = this.tasks.createTask({
        title: `${template.title} - ${occurrenceDate}`,
        ...(template.description ? { description: template.description } : {}),
        priority: template.priority,
        durationMinutesRemaining: template.durationMinutes,
        splittable: template.splittable,
        minChunkMinutes: template.minChunkMinutes,
        maxChunkMinutes: template.maxChunkMinutes,
        earliestStart: startOfLocalDay(occurrenceDate).toISOString(),
        // The occurrence must land on its own day, so the window closes at local end of day.
        deadlineAt: localInstant(occurrenceDate, 23, 59).toISOString(),
        // `autoArchiveHour` is the template's expiry policy: the difference between "wake up" (gone
        // by 10am) and an ordinary task (a month). NULL means the routine keeps its whole day.
        autoArchiveAt: autoArchiveAt.toISOString(),
        kanbanStatus: "ready",
        origin: "recurrence",
      });
      this.tasks.setTaskTags(child.id, [
        ...new Set([...inheritedTagIds, routineTagId, weekdayTagIds[weekdayIndex(occurrenceDate)]!, ownTagId]),
      ]);
      this.tasks.recordRecurrenceOccurrence(template.id, occurrenceDate, child.id);
      created.push(child.id);
    }
    return { created, alreadyPresent, idleTemplates: [], fired: dates.length };
  }
}
