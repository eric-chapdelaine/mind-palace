import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TaskRepository } from "@mind-palace/database";
import type { Schedule, ScheduleTierScores, ScheduleUnscheduled } from "@mind-palace/shared";
import { runPythonWorker } from "./worker.js";

interface SolverResult {
  modelVersion: string;
  horizonStart: string;
  horizonEnd: string;
  assignments: Assignment[];
  unscheduled: ScheduleUnscheduled[];
  unscheduledTaskIds: number[];
  tierScores: ScheduleTierScores;
  solverStatus: string;
  objectiveValue: number;
  error?: string;
}

interface Assignment {
  taskId: number;
  startAt: string;
  endAt: string;
}

/**
 * Collapse adjacent solver slots for the same task into one block. The worker models time in
 * fixed slots (e.g. two 30-minute slots), but a block of work is a contiguous span: 10:00-10:30
 * plus 10:30-11:00 is a single 10:00-11:00 block. The API and UI both read blocks, so the merge
 * happens once here instead of being re-done by every consumer.
 */
export function mergeAssignments(assignments: Assignment[]): Assignment[] {
  const sorted = [...assignments].sort((left, right) => left.startAt.localeCompare(right.startAt) || left.taskId - right.taskId);
  const merged: Assignment[] = [];
  for (const assignment of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && previous.taskId === assignment.taskId && previous.endAt === assignment.startAt) {
      previous.endAt = assignment.endAt;
    } else {
      merged.push({ ...assignment });
    }
  }
  return merged;
}

/** How far ahead the worker lays out slots. Sent in the payload so a run is reproducible. */
const HORIZON_DAYS = 7;

/**
 * Solver configuration. The worker owns the defaults (slot size, day window, timezone); the
 * control plane only states the choices that are product decisions. Kept in the payload so the
 * stored run is self-describing.
 */
const SCHEDULER_CONFIG = { priorityMode: "weighted" } as const;

export class ScheduleService {
  private readonly workerDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../workers/cp-sat");

  constructor(private readonly tasks: TaskRepository) {}

  getSchedule(): Schedule {
    const latest = this.tasks.latestScheduleResult();
    return {
      runs: this.tasks.listScheduleRuns(),
      timeBlocks: this.tasks.listTimeBlocks(),
      unscheduled: latest.unscheduled,
      tierScores: latest.tierScores,
      unscheduledTaskIds: latest.unscheduled.map((entry) => entry.taskId),
    };
  }

  async generate(): Promise<Schedule> {
    // Release time held by stale proposals first so listSchedulableTasks (and the solver)
    // see an accurate remaining estimate; the new proposed blocks re-claim it below.
    this.tasks.supersedeProposedBlocks();
    const input = {
      now: new Date().toISOString(),
      horizonDays: HORIZON_DAYS,
      config: SCHEDULER_CONFIG,
      tasks: this.tasks.listSchedulableTasks(),
      timeBlocks: this.tasks.listTimeBlocks(),
      rules: this.tasks.listSchedulerRules(),
    };
    const result = await this.runSolver(input);
    const run = this.tasks.createScheduleRun(result.horizonStart, result.horizonEnd, input, result.modelVersion);
    try {
      for (const assignment of mergeAssignments(result.assignments)) {
        this.tasks.createTimeBlock({ ...assignment, source: "solver", status: "proposed" }, run.id);
      }
      this.tasks.finishScheduleRun(run.id, result);
    } catch (error) {
      this.tasks.finishScheduleRun(run.id, null, error instanceof Error ? error.message : String(error));
      throw error;
    }
    return this.getSchedule();
  }

  private runSolver(input: unknown): Promise<SolverResult> {
    return runPythonWorker<SolverResult>({
      directory: this.workerDirectory,
      script: "scheduler.py",
      input,
      timeoutMs: 30_000,
      label: "CP-SAT worker",
    });
  }
}
