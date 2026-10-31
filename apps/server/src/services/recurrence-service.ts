import type { TaskRepository } from "@mind-palace/database";
import { reservedTagIds } from "@mind-palace/database";
import { weekdayTagPublicIds } from "@mind-palace/shared";
import { localInstant, startOfLocalDay, weekdayIndex, addDays, daysBetween, localDate } from "./clock.js";

/** Days of occurrences to keep on the board. Equal to `ScheduleService`'s horizon: a routine
 *  occurrence further out is a row nothing can schedule. */
export const RECURRENCE_LOOKAHEAD_DAYS = 7;

export class RecurrenceService {
  constructor(private readonly tasks: TaskRepository) {}

  /**
   * Create the occurrence rows for every active template, up to and including `endDate`.
   *
   * Idempotent (a date that already has an occurrence is skipped) and safe to call on every boot.
   * Deliberately does **not** backfill: the window starts at today, because a server that was off
   * for a week should not manufacture a week of "wake up" rows nobody can act on any more.
   */
  materializeThrough(endDate: string, today: string = localDate(new Date())): number[] {
    const created: number[] = [];
    const routineTagId = this.tasks.tagId(reservedTagIds.routine);
    const weekdayTagIds = weekdayTagPublicIds.map((publicId) => this.tasks.tagId(publicId));
    for (const template of this.tasks.listRecurrenceTemplates()) {
      // Parent-child links between tasks are expressed through tags: give the routine
      // template a tag that names it, then stamp every occurrence (and the template
      // itself) with that tag. The tag page for it shows the parent task and its children.
      const parentTag = this.tasks.ensureTaskTag(template.rule.taskId, {
        title: template.title,
        description: `Recurring occurrences of the routine “${template.title}”.`,
      });
      // The occurrence's own weekday tag wins over any the template carries: a template tagged
      // `monday` would otherwise pin every occurrence to Monday and fight the rule.
      const inheritedTagIds = template.tagIds.filter((id) => !weekdayTagIds.includes(id));
      const seriesStart = template.rule.nextOccurrenceDate;
      // Never backfill: a routine that was missed was missed. The rule's own anchor still bounds
      // the window from below so a future-dated rule does not fire early.
      let cursor = seriesStart > today ? seriesStart : today;
      const interval = Math.max(1, template.rule.intervalCount);
      for (; cursor <= endDate; cursor = addDays(cursor, 1)) {
        const occurrenceDate = cursor;
        // A weekly rule with an interval is "every N weeks, on these weekdays", so the count is
        // taken from the rule's own anchor week rather than from whenever the job happened to run.
        const weeksIn = Math.floor(daysBetween(seriesStart, occurrenceDate) / 7);
        if (template.rule.frequency === "weekly" && weeksIn % interval !== 0) continue;
        const weekdayAllowed = template.rule.frequency === "daily"
          ? true
          : template.rule.weekdays.includes(weekdayIndex(occurrenceDate));
        if (weekdayAllowed && !this.tasks.recurrenceOccurrenceExists(template.rule.id, occurrenceDate)) {
          const occurrenceTagIds = [
            ...new Set([
              ...inheritedTagIds,
              routineTagId,
              weekdayTagIds[weekdayIndex(occurrenceDate)]!,
              parentTag.id,
            ]),
          ];
          const child = this.tasks.createTask({
            title: `${template.title} - ${occurrenceDate}`,
            ...(template.description ? { description: template.description } : {}),
            priority: template.priority,
            rank: template.rank,
            durationMinutesRemaining: template.durationMinutesRemaining,
            splittable: template.splittable,
            earliestStart: startOfLocalDay(occurrenceDate).toISOString(),
            // The occurrence must land on its own day, so the window closes at local end of day.
            // `autoArchiveHour` can close it earlier — that is the template's expiry policy, and it
            // is the difference between "wake up" (gone by 10am) and an ordinary task.
            deadlineAt: localInstant(occurrenceDate, 23, 59).toISOString(),
            autoArchiveAt: localInstant(
              occurrenceDate,
              template.autoArchiveHour ?? 23,
              template.autoArchiveHour === null ? 59 : 0,
            ).toISOString(),
            kanbanStatus: "ready",
            origin: "recurrence",
          });
          this.tasks.setTaskTags(child.id, occurrenceTagIds);
          this.tasks.recordRecurrenceOccurrence(template.rule.id, occurrenceDate, child.id);
          created.push(child.id);
        }
        if (template.rule.frequency === "daily") cursor = addDays(cursor, interval - 1);
      }
    }
    return created;
  }
}
