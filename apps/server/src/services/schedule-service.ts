import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TaskRepository } from "@mind-palace/database";
import type { Schedule } from "@mind-palace/shared";
import { runPythonWorker } from "./worker.js";

interface SolverResult {
  horizonStart: string;
  horizonEnd: string;
  assignments: Array<{ taskId: number; startAt: string; endAt: string }>;
  unscheduledTaskIds: number[];
  solverStatus: string;
  objectiveValue: number;
  error?: string;
}

export class ScheduleService {
  private readonly workerDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../workers/cp-sat");

  constructor(private readonly tasks: TaskRepository) {}

  getSchedule(): Schedule {
    return {
      runs: this.tasks.listScheduleRuns(),
      timeBlocks: this.tasks.listTimeBlocks(),
      unscheduledTaskIds: this.tasks.latestUnscheduledTaskIds(),
    };
  }

  async generate(): Promise<Schedule> {
    // Release time held by stale proposals first so listSchedulableTasks (and the solver)
    // see an accurate remaining estimate; the new proposed blocks re-claim it below.
    this.tasks.supersedeProposedBlocks();
    const input = {
      tasks: this.tasks.listSchedulableTasks(),
      timeBlocks: this.tasks.listTimeBlocks(),
      weather: this.tasks.listWeather(),
    };
    const result = await this.runSolver(input);
    const run = this.tasks.createScheduleRun(result.horizonStart, result.horizonEnd, input);
    try {
      for (const assignment of result.assignments) {
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
