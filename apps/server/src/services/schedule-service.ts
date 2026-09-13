import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TaskRepository } from "@mind-palace/database";
import type { Schedule } from "@mind-palace/shared";

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
    const input = {
      tasks: this.tasks.listSchedulableTasks(),
      timeBlocks: this.tasks.listTimeBlocks(),
      weather: this.tasks.listWeather(),
    };
    const stdout = await this.runSolver(input);
    const result = JSON.parse(stdout) as SolverResult;
    if (result.error) throw new Error(result.error);
    const run = this.tasks.createScheduleRun(result.horizonStart, result.horizonEnd, input);
    try {
      this.tasks.supersedeProposedBlocks();
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

  private runSolver(input: unknown): Promise<string> {
    return new Promise((resolvePromise, reject) => {
      const child = spawn(
        "uv",
        ["run", "--project", this.workerDirectory, "python", resolve(this.workerDirectory, "scheduler.py")],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      let stdout = "";
      let stderr = "";
      const timeout = setTimeout(() => child.kill("SIGTERM"), 30_000);
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
      child.once("error", (error) => { clearTimeout(timeout); reject(error); });
      child.once("close", (code) => {
        clearTimeout(timeout);
        if (code === 0) resolvePromise(stdout);
        else reject(new Error(stderr.trim() || stdout.trim() || `CP-SAT worker exited with ${code}`));
      });
      child.stdin.end(JSON.stringify(input));
    });
  }
}
