import type { GarminService } from "./services/garmin-service.js";
import type { ScheduledJob } from "./services/job-scheduler.js";
import type { WeatherService } from "./services/weather-service.js";

/** Pinned times below are wall-clock in this zone (the household's), not UTC. */
const TIME_ZONE = "America/New_York";

/**
 * Every recurring background job the server runs. Add an entry here to schedule new work — the
 * schedule deliberately lives in this file (not in a machine's crontab) so it is versioned and
 * copied with the repo. `GET /api/jobs` reports each job's next run and last-run status.
 *
 * Jobs must be idempotent: an interval tick or pinned time can land at any moment, and `runOnStart`
 * can fire on a restart. Prefer a cheap "is anything actually due?" check inside `run`.
 */
export function scheduledJobs({ weather, garmin }: { weather: WeatherService; garmin: GarminService }): ScheduledJob[] {
  return [
    {
      name: "weather-refresh",
      // Pinned every 8h, matching the cache TTL. Force the fetch: a previous run that started a few
      // seconds late would otherwise leave the cache just-fresh and skip the whole next slot.
      schedule: { kind: "times", at: ["00:00", "08:00", "16:00"], timeZone: TIME_ZONE },
      run: async () => {
        await weather.getWeather(true);
      },
    },
    {
      name: "garmin-sync",
      // Same slot the old crontab used. No-op until a Garmin token store exists, and incremental
      // once it does, so a missed run simply catches up on the next one.
      schedule: { kind: "times", at: ["11:00"], timeZone: TIME_ZONE },
      run: async () => {
        if (!garmin.status().connected) return;
        await garmin.sync();
      },
    },
  ];
}
