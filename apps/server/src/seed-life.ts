/**
 * Seeds the "life scheduling" demo: a week of recurring life tasks (sleep, wake, get outside,
 * breakfast, work, strength, dinner, wind-down) plus outings and a weekly grocery run, and the
 * rules that shape them. Then runs the scheduler once so proposed blocks exist.
 *
 * Run with `pnpm demo:life` (or `pnpm --filter @mind-palace/server db:seed-life`).
 * Safe to re-run: it clears `[LIFE]`/`[DEMO]` rows first, then recreates them. Real tasks are
 * left untouched.
 */
import { Database, reservedTagIds, TaskRepository } from "@mind-palace/database";
import type { RuleCondition, RuleEffect } from "@mind-palace/shared";
import { loadConfig } from "./config.js";
import { ScheduleService } from "./services/schedule-service.js";
import { WeatherService } from "./services/weather-service.js";

const TZ = "America/New_York";

/** Local calendar date `offsetDays` from now in the scheduler's timezone. */
function dayOffset(offsetDays: number): string {
  const target = new Date(Date.now() + offsetDays * 86_400_000);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(target);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Python weekday (0 = Monday .. 6 = Sunday) for a local date string. */
function weekdayOf(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return (new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)).getUTCDay() + 6) % 7;
}

/** An ISO instant for `date` + `time` interpreted in the scheduler's timezone. */
function zoned(date: string, time: string): string {
  const base = new Date(`${date}T${time}:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(base);
  const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
  return new Date(base.getTime() - (asUtc - base.getTime())).toISOString();
}

const config = loadConfig();
const database = new Database(config.databasePath);
database.migrate();
const tasks = new TaskRepository(database);

// ---- clear previous demo data (real, un-prefixed tasks are untouched) -----------------
database.connection.exec(`
  DELETE FROM task_dependencies
    WHERE task_id IN (SELECT id FROM tasks WHERE title LIKE '[DEMO]%' OR title LIKE '[LIFE]%')
       OR depends_on_task_id IN (SELECT id FROM tasks WHERE title LIKE '[DEMO]%' OR title LIKE '[LIFE]%');
  DELETE FROM task_tags WHERE task_id IN (SELECT id FROM tasks WHERE title LIKE '[DEMO]%' OR title LIKE '[LIFE]%');
  DELETE FROM time_blocks WHERE task_id IN (SELECT id FROM tasks WHERE title LIKE '[DEMO]%' OR title LIKE '[LIFE]%');
  DELETE FROM tasks WHERE title LIKE '[DEMO]%' OR title LIKE '[LIFE]%';
  DELETE FROM tag_parents
    WHERE child_tag_id IN (SELECT id FROM tags WHERE title LIKE '[DEMO]%' OR title LIKE '[LIFE]%')
       OR parent_tag_id IN (SELECT id FROM tags WHERE title LIKE '[DEMO]%' OR title LIKE '[LIFE]%');
  DELETE FROM task_tags WHERE tag_id IN (SELECT id FROM tags WHERE title LIKE '[DEMO]%' OR title LIKE '[LIFE]%');
  DELETE FROM tags WHERE title LIKE '[DEMO]%' OR title LIKE '[LIFE]%';
  DELETE FROM scheduler_rules WHERE title LIKE '[DEMO]%' OR title LIKE '[LIFE]%';
  DELETE FROM time_blocks WHERE source = 'solver';
  DELETE FROM schedule_runs;
`);

// ---- tags -----------------------------------------------------------------------------
const makeTag = (title: string): number => tasks.createTag({ title: `[LIFE] ${title}`, description: `Life-scheduling demo: ${title}` }).id;
const tag = {
  thisWeek: tasks.tagId(reservedTagIds.thisWeek),
  work: makeTag("Work"),
  wake: makeTag("Wake"),
  sleep: makeTag("Sleep"),
  breakfast: makeTag("Breakfast"),
  dinner: makeTag("Dinner"),
  cook: tasks.tagId(reservedTagIds.cook),
  eatOut: tasks.tagId(reservedTagIds.eatOut),
  meal: makeTag("Meal"),
  strength: makeTag("Strength"),
  outing: makeTag("Outing"),
  grocery: makeTag("Grocery"),
  walk: makeTag("Walk"),
  windDown: makeTag("Wind-down"),
};

const has = (tagId: number): RuleCondition => ({ taskHasTag: tasks.listTags().find((entry) => entry.id === tagId)!.publicId });

/** The demo's definition of "nice weather" — edit it on the Rules page; the worker hardcodes nothing. */
const NICE_WEATHER = { minTemperatureF: 50, maxTemperatureF: 80, maxPrecipitationProbability: 20, maxWindMph: 15, requireDaytime: true } as const;

// ---- rules ----------------------------------------------------------------------------
function hard(title: string, applies: RuleCondition, effect: RuleEffect, reason: string): void {
  tasks.createSchedulerRule({ title: `[LIFE] ${title}`, applies, effect, strength: { kind: "hard" }, reason });
}
function soft(title: string, applies: RuleCondition, effect: RuleEffect, weight: number, reason: string): void {
  tasks.createSchedulerRule({ title: `[LIFE] ${title}`, applies, effect, strength: { kind: "soft", weight }, reason });
}

hard("Work on weekdays", has(tag.work), { type: "assignDays", days: [0, 1, 2, 3, 4] }, "Work happens Mon-Fri");
hard("Work 9-5", has(tag.work), { type: "timeWindow", start: "09:00", end: "17:00" }, "Protect the work window");
soft("Breakfast in the morning", has(tag.breakfast), { type: "preferTimeOfDay", start: "06:30", end: "09:00" }, 5, "Breakfast before work");
hard("Dinner window", has(tag.dinner), { type: "timeWindow", start: "17:30", end: "21:00" }, "Eat dinner between 5:30 and 9");
soft("Sleep window", has(tag.sleep), { type: "preferTimeOfDay", start: "22:00", end: "23:00" }, 8, "Target 10:30pm-6:45am");
soft("Wake in the morning", has(tag.wake), { type: "preferTimeOfDay", start: "06:30", end: "07:30" }, 8, "Target a 6:45am wake");
soft("Wind down before bed", has(tag.windDown), { type: "preferTimeOfDay", start: "21:00", end: "22:30" }, 4, "Dim the day before sleep");
soft("An outing every day", { any: [has(tag.outing), has(tag.eatOut)] }, { type: "dailyBudget", softMaxPerDay: 1 }, 20, "At least one outing or meal out, minimize the count");
soft("Outings at 5pm on weekdays", has(tag.outing),
  { type: "preferTimeOfDay", start: "17:00", end: "18:00", when: { dayOfWeek: [0, 1, 2, 3, 4] } }, 6, "Right after work");
soft("Outings like nice weather", has(tag.outing), { type: "weatherGate", ...NICE_WEATHER }, 5, "Prefer dry, mild, daytime");
soft("Strength on distinct days", has(tag.strength),
  { type: "spread", maxPerDayMinutes: 600, minDistinctDays: 3, avoidConsecutive: true }, 12, "3x/week, not back-to-back");
hard("Get outside right after waking", has(tag.walk), { type: "withinAfter", maxMinutes: 30 }, "Within 30 min of waking");
soft("Get outside in the morning", has(tag.walk), { type: "preferTimeOfDay", start: "06:30", end: "07:45" }, 7, "Morning light");
hard("Grocery nice weather only", has(tag.grocery), { type: "weatherGate", ...NICE_WEATHER }, "Nice-weather-only errand");
hard("Grocery on the weekend", has(tag.grocery), { type: "assignDays", days: [5, 6] }, "Weekend errand");

// ---- tasks ----------------------------------------------------------------------------
function makeTask(input: {
  title: string;
  tagIds: number[];
  durationMinutes: number;
  start: string;
  deadline: string;
  priority: number;
  description?: string;
  splittable?: boolean;
  dependsOn?: number[];
}): number {
  const created = tasks.createTask({
    title: `[LIFE] ${input.title}`,
    durationMinutesRemaining: input.durationMinutes,
    splittable: input.splittable ?? false,
    priority: input.priority,
    kanbanStatus: "ready",
    origin: "recurrence",
    earliestStart: input.start,
    deadlineAt: input.deadline,
    tagIds: [tag.thisWeek, ...input.tagIds],
    ...(input.description ? { description: input.description } : {}),
  });
  if (input.dependsOn && input.dependsOn.length > 0) tasks.setTaskDependencies(created.id, input.dependsOn);
  return created.id;
}

const weekStart = dayOffset(1);
const weekEnd = dayOffset(6);

for (let offset = 1; offset <= 6; offset += 1) {
  const date = dayOffset(offset);
  const next = dayOffset(offset + 1);
  const wake = makeTask({ title: "Wake up", tagIds: [tag.wake], durationMinutes: 30, start: zoned(date, "05:00"), deadline: zoned(date, "10:00"), priority: 3, description: "Target 6:45am wake." });
  makeTask({ title: "Get outside within 30 min", tagIds: [tag.walk], durationMinutes: 30, start: zoned(date, "06:00"), deadline: zoned(date, "10:00"), priority: 3, dependsOn: [wake], description: "WFH: short walk. In-office: commute." });
  makeTask({ title: "Eat breakfast", tagIds: [tag.breakfast, tag.meal], durationMinutes: 30, start: zoned(date, "06:30"), deadline: zoned(date, "10:30"), priority: 2, dependsOn: [wake], description: "~500 kcal — eat more in the morning." });
  if (weekdayOf(date) <= 4) {
    makeTask({ title: "Work", tagIds: [tag.work], durationMinutes: 480, start: zoned(date, "08:00"), deadline: zoned(date, "18:00"), priority: 4 });
  }
  // Dinner is one fused, non-splittable block: cooking always happens right before eating. One
  // day is seeded as eat-out to show the reserved-tag swap (the task page toggles it in one click).
  const dinnerTag = offset === 3 ? tag.eatOut : tag.cook;
  makeTask({ title: "Dinner", tagIds: [tag.dinner, tag.meal, dinnerTag], durationMinutes: 60, start: zoned(date, "16:00"), deadline: zoned(date, "21:30"), priority: 2, description: "Cook + eat at home, ~800 kcal. Tag it eat-out to mark a meal out." });
  makeTask({ title: "Wind down", tagIds: [tag.windDown], durationMinutes: 30, start: zoned(date, "20:30"), deadline: zoned(date, "23:59"), priority: 1, description: "Screens off, dim light." });
  makeTask({ title: "Sleep", tagIds: [tag.sleep], durationMinutes: 480, start: zoned(date, "20:00"), deadline: zoned(next, "08:00"), priority: 3, description: "Target 10:30pm-6:45am." });
}

// Strength: 3 floating sessions somewhere in the week, on distinct non-consecutive days.
for (let index = 1; index <= 3; index += 1) {
  makeTask({ title: `Strength training ${index}`, tagIds: [tag.strength], durationMinutes: 45, start: zoned(weekStart, "07:00"), deadline: zoned(weekEnd, "22:00"), priority: 2 });
}

// Outings: float across the week; the budget rule spreads them to ~one per day.
const outings = ["Evening walk", "Bike ride", "Run", "Errand: pharmacy", "Walk to the park"];
for (const outing of outings) {
  makeTask({ title: outing, tagIds: [tag.outing], durationMinutes: 30, start: zoned(weekStart, "06:00"), deadline: zoned(weekEnd, "22:00"), priority: 1 });
}

// Grocery: weekly, weekend only, nice weather, and it counts as an outing.
makeTask({ title: "Grocery run", tagIds: [tag.grocery, tag.outing], durationMinutes: 60, start: zoned(weekStart, "09:00"), deadline: zoned(weekEnd, "19:00"), priority: 3, description: "Nice-weather-only weekend errand." });

// ---- generate a schedule so there is something to look at -----------------------------
const weather = new WeatherService(tasks);
// Force a refresh so the new wind/daylight fields are populated for weather-gated rules.
try {
  await weather.getWeather(true);
} catch {
  // Offline is fine: a missing forecast makes `weatherGate` permissive rather than blocking.
}
const schedule = new ScheduleService(tasks, weather);
const result = await schedule.generate();
const placed = result.scores?.decision;
console.log(`Seeded the life demo. Scheduled ${placed?.placed ?? 0}/${placed?.of ?? 0} tasks with ${result.timeBlocks.filter((block) => block.source === "solver").length} solver blocks.`);
database.close();
