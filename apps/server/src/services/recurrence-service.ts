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
   * deleting or completing yesterday's occurrence does not stop tomorrow's from appearing. A date
   * whose child was archived or finished is regenerated when the window reaches it again.
   *
   * Deliberately does **not** backfill: the window starts at today, because a server that was off
   * for a week should not manufacture a week of "wake up" rows nobody can act on any more.
   */
  materializeThrough(endDate: string, today: string = localDate(new Date())): MaterializeResult {
    const created: number[] = [];
    const idleTemplates: string[] = [];
    let alreadyPresent = 0;
    const routineTagId = this.tasks.tagId(reservedTagIds.routine);
    const weekdayTagIds = weekdayTagPublicIds.map((publicId) => this.tasks.tagId(publicId));

    for (const template of this.tasks.listRecurrenceTemplates()) {
      // Every occurrence carries the tag that names its routine. The template owns that tag so the
      // template page and /tags/:id both list a routine's whole history.
      const routineTag = template.routineTagId === null
        ? this.tasks.ensureTemplateTag(template.id, {
            title: template.title,
            description: `Recurring occurrences of the routine “${template.title}”.`,
          })
        : null;
      const ownTagId = template.routineTagId ?? routineTag!.id;
      // A weekday tag on the template would pin every occurrence to that day and fight the rule.
      const inheritedTagIds = template.tagIds.filter((id) => !weekdayTagIds.includes(id));
      const seriesStart = template.nextOccurrenceDate;
      // Never backfill: a routine that was missed was missed. The rule's own anchor still bounds the
      // window from below so a future-dated rule does not fire early.
      let cursor = seriesStart > today ? seriesStart : today;
      const interval = Math.max(1, template.intervalCount);
      let fired = 0;

      for (; cursor <= endDate; cursor = addDays(cursor, template.frequency === "daily" ? interval : 1)) {
        const occurrenceDate = cursor;
        // A weekly rule with an interval is "every N weeks, on these weekdays", so the count is
        // taken from the rule's own anchor week rather than from whenever the job happened to run.
        const weeksIn = Math.floor(daysBetween(seriesStart, occurrenceDate) / 7);
        if (template.frequency === "weekly" && weeksIn % interval !== 0) continue;
        const weekdayAllowed = template.frequency === "daily"
          ? true
          : template.weekdays.includes(weekdayIndex(occurrenceDate));
        if (!weekdayAllowed) continue;
        fired += 1;
        if (this.tasks.recurrenceOccurrenceIsLive(template.id, occurrenceDate)) {
          alreadyPresent += 1;
          continue;
        }
        const occurrenceTagIds = [
          ...new Set([...inheritedTagIds, routineTagId, weekdayTagIds[weekdayIndex(occurrenceDate)]!, ownTagId]),
        ];
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
          // `autoArchiveHour` can close it earlier — that is the template's expiry policy, and it is
          // the difference between "wake up" (gone by 10am) and an ordinary task.
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
        this.tasks.recordRecurrenceOccurrence(template.id, occurrenceDate, child.id);
        created.push(child.id);
      }
      // A daily rule with an interval must not step by one: skipping the days in between is what
      // "every 3 days" means.
      if (fired === 0) idleTemplates.push(template.title);
    }
    return { created, alreadyPresent, idleTemplates };
  }
}
