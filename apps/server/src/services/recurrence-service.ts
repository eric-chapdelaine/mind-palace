import type { OrchestrationRepository, TaskRepository } from "@opencode-task-manager/database";
import { reservedTagIds } from "@opencode-task-manager/database";

function dateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export class RecurrenceService {
  constructor(
    private readonly orchestration: OrchestrationRepository,
    private readonly tasks: TaskRepository,
  ) {}

  materializeThrough(endDate: string): number[] {
    const created: number[] = [];
    const routineTagId = this.tasks.tagId(reservedTagIds.routine);
    for (const template of this.tasks.listRecurrenceTemplates()) {
      let occurrence = new Date(`${template.rule.nextOccurrenceDate}T12:00:00Z`);
      const end = new Date(`${endDate}T23:59:59Z`);
      while (occurrence <= end) {
        const occurrenceDate = dateString(occurrence);
        const weekdayAllowed = template.rule.frequency === "daily"
          || template.rule.weekdays.length === 0
          || template.rule.weekdays.includes(occurrence.getUTCDay());
        if (weekdayAllowed && !this.tasks.recurrenceOccurrenceExists(template.rule.id, occurrenceDate)) {
          const child = this.orchestration.createTask({
            title: `${template.title} - ${occurrenceDate}`,
            taskType: "question",
            startImmediately: false,
            automationPolicy: "manual",
            ...(template.description ? { description: template.description } : {}),
          });
          this.tasks.updateTask(child.id, {
            parentTaskId: template.rule.taskId,
            kanbanStatus: "ready",
            priority: template.priority,
            rank: template.rank,
            durationMinutes: template.durationMinutes,
            splittable: template.splittable,
            earliestStart: `${occurrenceDate}T00:00:00-04:00`,
            deadlineAt: `${occurrenceDate}T23:59:59-04:00`,
            tagIds: template.tagIds.filter((id) => id !== routineTagId),
          });
          this.tasks.recordRecurrenceOccurrence(template.rule.id, occurrenceDate, child.id);
          created.push(child.id);
        }
        occurrence.setUTCDate(occurrence.getUTCDate() + (template.rule.frequency === "daily" ? template.rule.intervalCount : 1));
      }
    }
    return created;
  }
}
