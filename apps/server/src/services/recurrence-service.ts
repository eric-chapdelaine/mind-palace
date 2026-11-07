import type { TaskRepository } from "@mind-palace/database";
import { reservedTagIds } from "@mind-palace/database";
import {
  scheduleHorizonDays,
  type MaterializeResult,
  type RecurrenceTemplate,
  type SavedRecurrence,
  type UpsertRecurrenceInput,
} from "@mind-palace/shared";
import { localInstant, startOfLocalDay, addDays, daysBetween, localDate } from "./clock.js";

/**
 * A recurrence says how much work exists and the window each occurrence must live in. It never
 * says which day an occurrence lands on: that is the scheduler's answer, shaped by rules.
 *
 * A **period** is one repetition of the rule (`daily` = 1 day, `weekly` = 7 days, times
 * `intervalCount`). A period gets `timesPerPeriod` interchangeable occurrences:
 *
 * - a daily period gets one, dated to its day (`earliestStart` and `deadlineAt` both that day), so
 *   "wake up" is a card for today that decays at its own hour;
 * - a weekly period gets N, each with the whole week as its window, so "groceries, once this week"
 *   floats until rules place it.
 *
 * Periods are counted from the template's anchor date, never from the day the job happened to run,
 * so "every 3 days" does not drift when the window slides forward.
 */
export class RecurrenceService {
  constructor(private readonly tasks: TaskRepository) {}

  /** Save a template and fill the window straight away, so authoring one visibly does something. */
  save(input: UpsertRecurrenceInput, templateId?: number): SavedRecurrence {
    const template = templateId === undefined
      ? this.tasks.createRecurrenceTemplate(input)
      : this.tasks.updateRecurrenceTemplate(templateId, input);
    return { template, materialized: this.materialize(template.id) };
  }

  /** Materialize the scheduler's window: every active recurrence, or just `onlyTemplateId`. */
  materialize(onlyTemplateId?: number): MaterializeResult {
    return this.materializeThrough(
      addDays(localDate(new Date()), scheduleHorizonDays),
      undefined,
      onlyTemplateId,
    );
  }

  /**
   * Create the occurrence rows for every active template, up to and including `endDate`.
   *
   * Idempotent. A daily occurrence is regenerated when its child is gone, because the day's card
   * should exist; a quota occurrence is not, because completing this week's grocery trip must not
   * mint a second trip in the same week.
   *
   * Deliberately does **not** backfill: the window starts at today, because a server that was off
   * for a week should not manufacture a week of "wake up" rows nobody can act on any more.
   *
   * Every period that starts before `endDate` is generated, not just the current one. A weekly
   * template can therefore have two live periods when the next one begins inside the horizon, which
   * is what lets the scheduler plan next Sunday while it is still planning this one. A period that
   * starts on the horizon's last day is left for the next pass: it would only have a sliver of
   * placeable time, and the board should not hold work the scheduler cannot lay out. Each period's
   * occurrences carry that period as their window, so two periods never compete for the same day.
   */
  materializeThrough(
    endDate: string,
    today: string = localDate(new Date()),
    onlyTemplateId?: number,
  ): MaterializeResult {
    const created: number[] = [];
    const idleTemplates: string[] = [];
    let alreadyPresent = 0;

    for (const template of this.tasks.listRecurrenceTemplates()) {
      if (onlyTemplateId !== undefined && template.id !== onlyTemplateId) continue;
      const result = this.materializeTemplate(template, endDate, today);
      created.push(...result.created);
      alreadyPresent += result.alreadyPresent;
      if (result.fired === 0) idleTemplates.push(template.title);
    }
    return { created, alreadyPresent, idleTemplates };
  }

  /** One period is `intervalCount` days (daily) or that many weeks (weekly). */
  private periodDays(template: RecurrenceTemplate): number {
    const interval = Math.max(1, template.intervalCount);
    return interval * (template.frequency === "weekly" ? 7 : 1);
  }

  /** The period containing `date`, anchored on the template's start date. */
  private periodAt(template: RecurrenceTemplate, date: string): { start: string; end: string } {
    const days = this.periodDays(template);
    // Counting from the anchor is what keeps "every 3 days" from drifting each time the window
    // slides forward. A date before the anchor belongs to the first period.
    const periodsIn = Math.max(0, Math.floor(daysBetween(template.nextOccurrenceDate, date) / days));
    const start = addDays(template.nextOccurrenceDate, periodsIn * days);
    return { start, end: addDays(start, days - 1) };
  }

  /** Every period whose window overlaps `[today, endDate]`, oldest first. */
  private livePeriods(
    template: RecurrenceTemplate,
    today: string,
    endDate: string,
  ): Array<{ start: string; end: string }> {
    if (template.nextOccurrenceDate > endDate) return [];
    const days = this.periodDays(template);
    const lastStart = this.periodAt(template, endDate).start;
    const periods: Array<{ start: string; end: string }> = [];
    for (let start = this.periodAt(template, today).start; start <= lastStart; start = addDays(start, days)) {
      const end = addDays(start, days - 1);
      if (end >= today && start < endDate) periods.push({ start, end });
    }
    return periods;
  }

  /** "Wake up - 2026-03-02", "Groceries - week of 2026-03-01", "Review - 2026-03-01 to 2026-03-14". */
  private occurrenceTitle(template: RecurrenceTemplate, period: { start: string; end: string }): string {
    const days = this.periodDays(template);
    if (days === 1) return `${template.title} - ${period.start}`;
    if (days === 7) return `${template.title} - week of ${period.start}`;
    return `${template.title} - ${period.start} to ${period.end}`;
  }

  private materializeTemplate(
    template: RecurrenceTemplate,
    endDate: string,
    today: string,
  ): { created: number[]; alreadyPresent: number; fired: number } {
    const created: number[] = [];
    let alreadyPresent = 0;
    const periods = this.livePeriods(template, today, endDate);
    if (periods.length === 0) return { created, alreadyPresent, fired: 0 };

    // Every occurrence carries a tag that names its recurrence, so /tags/:id lists its whole
    // history. Templates created after this change already have one; the fallback covers old rows.
    const ownTagId = template.routineTagId ?? this.tasks.ensureTemplateTag(template.id, {
      title: template.title,
      description: `Recurring occurrences of “${template.title}”.`,
    }).id;
    const routineTagId = this.tasks.tagId(reservedTagIds.routine);
    const daily = this.periodDays(template) === 1;
    const timesPerPeriod = daily ? 1 : Math.max(1, template.timesPerPeriod);
    let fired = 0;

    for (const period of periods) {
      for (let sequence = 0; sequence < timesPerPeriod; sequence += 1) {
        fired += 1;
        // A daily slot is done only while its child is alive (a deleted card comes back); a quota
        // slot is done once it has ever been filled, or completing Monday's groceries would create
        // a second card for the same week.
        const done = daily
          ? this.tasks.recurrenceOccurrenceIsLive(template.id, period.start, sequence)
          : this.tasks.recurrenceOccurrenceExists(template.id, period.start, sequence);
        if (done) {
          alreadyPresent += 1;
          continue;
        }
        // `autoArchiveHour` is the template's expiry policy: the difference between "wake up" (gone
        // by 10am) and an ordinary task (a month). It lands on the daily card's day, or on the last
        // day of a quota's period. NULL means "end of that day".
        const lastDay = daily ? period.start : period.end;
        const autoArchiveAt = localInstant(
          lastDay,
          template.autoArchiveHour ?? 23,
          template.autoArchiveHour === null ? 59 : 0,
        );
        // Nothing worth creating if the card would already be expired: authoring a recurrence in
        // the afternoon should not drop an expired card onto the board.
        if (autoArchiveAt.getTime() <= Date.now()) continue;
        const child = this.tasks.createTask({
          title: this.occurrenceTitle(template, period),
          ...(template.description ? { description: template.description } : {}),
          priority: template.priority,
          durationMinutesRemaining: template.durationMinutes,
          splittable: template.splittable,
          minChunkMinutes: template.minChunkMinutes,
          maxChunkMinutes: template.maxChunkMinutes,
          earliestStart: startOfLocalDay(period.start).toISOString(),
          // A daily card must land on its own day. A quota card's window is its whole period, which
          // is what lets the scheduler move it off the preferred day instead of dropping it.
          deadlineAt: localInstant(lastDay, 23, 59).toISOString(),
          autoArchiveAt: autoArchiveAt.toISOString(),
          kanbanStatus: "ready",
          origin: "recurrence",
        });
        this.tasks.setTaskTags(child.id, [
          ...new Set([...template.tagIds, routineTagId, ownTagId]),
        ]);
        this.tasks.recordRecurrenceOccurrence(template.id, period.start, sequence, child.id);
        created.push(child.id);
      }
    }
    return { created, alreadyPresent, fired };
  }
}
