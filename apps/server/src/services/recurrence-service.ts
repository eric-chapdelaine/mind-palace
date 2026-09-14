import type { TaskRepository } from "@mind-palace/database";
import { reservedTagIds } from "@mind-palace/database";

function dateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export class RecurrenceService {
  constructor(private readonly tasks: TaskRepository) {}

  materializeThrough(endDate: string): number[] {
    const created: number[] = [];
    const routineTagId = this.tasks.tagId(reservedTagIds.routine);
    for (const template of this.tasks.listRecurrenceTemplates()) {
      // Parent-child links between tasks are expressed through tags: give the routine
      // template a tag that names it, then stamp every occurrence (and the template
      // itself) with that tag. The tag page for it shows the parent task and its children.
      const parentTag = this.tasks.ensureTaskTag(template.rule.taskId, {
        title: template.title,
        description: `Recurring occurrences of the routine “${template.title}”.`,
      });
      const occurrenceTagIds = [...new Set([...template.tagIds.filter((id) => id !== routineTagId), parentTag.id])];
      let occurrence = new Date(`${template.rule.nextOccurrenceDate}T12:00:00Z`);
      const end = new Date(`${endDate}T23:59:59Z`);
      while (occurrence <= end) {
        const occurrenceDate = dateString(occurrence);
        const weekdayAllowed = template.rule.frequency === "daily"
          || template.rule.weekdays.length === 0
          || template.rule.weekdays.includes(occurrence.getUTCDay());
        if (weekdayAllowed && !this.tasks.recurrenceOccurrenceExists(template.rule.id, occurrenceDate)) {
          const child = this.tasks.createTask({
            title: `${template.title} - ${occurrenceDate}`,
            ...(template.description ? { description: template.description } : {}),
            priority: template.priority,
            rank: template.rank,
            durationMinutes: template.durationMinutes,
            splittable: template.splittable,
            earliestStart: `${occurrenceDate}T00:00:00-04:00`,
            deadlineAt: `${occurrenceDate}T23:59:59-04:00`,
            kanbanStatus: "ready",
            origin: "recurrence",
          });
          this.tasks.setTaskTags(child.id, occurrenceTagIds);
          this.tasks.recordRecurrenceOccurrence(template.rule.id, occurrenceDate, child.id);
          created.push(child.id);
        }
        occurrence.setUTCDate(occurrence.getUTCDate() + (template.rule.frequency === "daily" ? template.rule.intervalCount : 1));
      }
    }
    return created;
  }
}