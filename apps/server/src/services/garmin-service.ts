import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TaskRepository } from "@mind-palace/database";
import type {
  GarminSyncResult,
  GarminSyncStatus,
  HealthActivityProviderInput,
  SleepSessionProviderInput,
} from "@mind-palace/shared";
import { runPythonWorker } from "./worker.js";

interface WorkerResult {
  sleep: SleepSessionProviderInput[];
  activities: HealthActivityProviderInput[];
}

const timeZone = "America/New_York";

/** Calendar date (YYYY-MM-DD) in the owner's timezone — the dates Garmin's API expects. */
function localDate(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(value);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function daysBefore(date: string, count: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - count);
  return value.toISOString().slice(0, 10);
}

/**
 * Provider boundary for Garmin Connect. The sync is incremental: it asks the repository for
 * the newest sleep/activity date already stored and only fetches from there forward (the
 * latest stored day is re-fetched so same-day corrections land). Spawning the Python worker
 * mirrors `ScheduleService`; the worker holds the Garmin library and token handling.
 */
export class GarminService {
  private readonly workerDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../workers/garmin");

  constructor(private readonly tasks: TaskRepository) {}

  status(): GarminSyncStatus {
    return this.tasks.getGarminStatus();
  }

  async sync(): Promise<GarminSyncResult> {
    const today = localDate(new Date());
    const sleepFrom = this.tasks.latestSleepDate() ?? daysBefore(today, 7);
    const activitiesFrom = this.tasks.latestActivityDate() ?? daysBefore(today, 30);
    try {
      const result = await runPythonWorker<WorkerResult>({
        directory: this.workerDirectory,
        script: "sync.py",
        input: { sleepFrom, activitiesFrom, today },
        timeoutMs: 120_000,
        label: "Garmin worker",
      });
      const sleepImported = this.tasks.upsertSleepSessions(result.sleep);
      const activitiesImported = this.tasks.upsertHealthActivities(result.activities);
      this.tasks.markGarminSynced(null);
      return { sleepImported, activitiesImported, sleepFrom, activitiesFrom, syncedAt: new Date().toISOString() };
    } catch (error) {
      this.tasks.markGarminSynced(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
}
