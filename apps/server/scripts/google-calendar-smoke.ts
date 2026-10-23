/**
 * Smoke harness for the Google Calendar reconcile loop — no network, no real credentials.
 * Stubs the client and drives the service through a fresh throwaway DB, asserting the pull, the
 * push, the echo suppression, the tombstones, and the cancelled-task sweep.
 *
 *   pnpm --filter @mind-palace/server exec tsx scripts/google-calendar-smoke.ts
 */
import { writeFileSync } from "node:fs";
import { Database, TaskRepository } from "@mind-palace/database";
import { CalendarImportService } from "../src/services/calendar-import-service.js";
import { GoogleCalendarService } from "../src/services/google-calendar-service.js";
import type { DesiredEvent, NormalizedCalendarEvent } from "../src/services/google-calendar-client.js";

const path = process.env.DATABASE_PATH ?? "/tmp/mp-sync.db";
writeFileSync("/tmp/mp-sync-token.json", JSON.stringify({ refreshToken: "fake", accessToken: null, expiresAt: null, calendarId: "primary", calendarSummary: null, accountEmail: null }));
process.env.GOOGLE_CALENDAR_TOKEN_STORE = "/tmp/mp-sync-token.json";

const database = new Database(path);
database.migrate();
const tasks = new TaskRepository(database);
const service = new GoogleCalendarService(tasks, new CalendarImportService(tasks), "http://127.0.0.1:4310/cb");

// ---- fake Google ------------------------------------------------------------------------------
let remote: NormalizedCalendarEvent[] = [];
const calls: string[] = [];
const client = service.client as unknown as Record<string, unknown>;
client.listEvents = async () => ({ events: remote, nextSyncToken: `tok-${Date.now()}`, expiredCursor: false });
client.insertEvent = async (_id: string, event: DesiredEvent) => {
  calls.push(`insert:${event.title}`);
  const created: NormalizedCalendarEvent = {
    id: `g-${event.taskId}`, title: event.title, description: event.description,
    startAt: event.startAt, endAt: event.endAt, updatedAt: new Date().toISOString(),
    status: "confirmed", allDay: false, mindPalaceTaskId: event.taskId,
  };
  remote.push(created);
  return { id: created.id, updated: created.updatedAt };
};
client.patchEvent = async (_id: string, externalId: string, event: DesiredEvent) => {
  calls.push(`patch:${event.title}`);
  remote = remote.map((item) => item.id === externalId
    ? { ...item, title: event.title, description: event.description, startAt: event.startAt, endAt: event.endAt, updatedAt: new Date().toISOString() }
    : item);
  return { updated: new Date().toISOString() };
};
client.deleteEvent = async (_id: string, externalId: string) => {
  calls.push(`delete:${externalId}`);
  remote = remote.filter((item) => item.id !== externalId);
};

// ---- assertions -------------------------------------------------------------------------------
let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : ` — got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`}`);
}

const now = Date.now();
function window(hoursFrom: number, hoursTo: number): { startAt: string; endAt: string } {
  return {
    startAt: new Date(now + hoursFrom * 3_600_000).toISOString(),
    endAt: new Date(now + hoursTo * 3_600_000).toISOString(),
  };
}

async function main(): Promise<void> {
  const calendarTagId = tasks.tagId("mind-palace:calendar-event");

  // A. Pull a brand-new remote event.
  const a = window(24, 25);
  remote = [{ id: "evt-a", title: "Dentist", description: "bring forms", ...a, updatedAt: new Date(now).toISOString(), status: "confirmed", allDay: false, mindPalaceTaskId: null }];
  const r1 = await service.sync();
  const mirrored = tasks.listCalendarEventTasks();
  check("A pull creates one mirrored task", mirrored.length, 1);
  check("A task title", mirrored[0]?.title, "Dentist");
  check("A block window", [mirrored[0]?.startAt, mirrored[0]?.endAt], [a.startAt, a.endAt]);
  check("A mapping externalId", mirrored[0]?.externalId, "evt-a");
  check("A no push", r1.pushed, 0);
  check("A tag attached", tasks.getTask(mirrored[0]!.taskId).tags.some((tag) => tag.id === calendarTagId), true);

  // B. Second pass with an unchanged remote event: idempotent, nothing pushed.
  const r2 = await service.sync();
  check("B pull is idempotent", tasks.listCalendarEventTasks().length, 1);
  check("B skipped echo", r2.skipped, 1);
  check("B no push", r2.pushed, 0);

  // C. Remote edit (newer `updated`) propagates to task + block.
  const c = window(48, 50);
  remote = [{ ...remote[0]!, title: "Dentist (moved)", startAt: c.startAt, endAt: c.endAt, updatedAt: new Date(now + 5_000).toISOString() }];
  await service.sync();
  const afterC = tasks.listCalendarEventTasks()[0]!;
  check("C title updated", afterC.title, "Dentist (moved)");
  check("C window updated", [afterC.startAt, afterC.endAt], [c.startAt, c.endAt]);

  // D. Locally created commitment is inserted into Google.
  calls.length = 0;
  const d = window(72, 73);
  const created = tasks.createTask({
    title: "Coffee with Sam",
    tagIds: [calendarTagId],
    timeBlock: { startAt: d.startAt, endAt: d.endAt, type: "calendar_event" },
  });
  const r4 = await service.sync();
  check("D pushed insert", r4.pushed, 1);
  check("D insert call", calls, ["insert:Coffee with Sam"]);
  const mappedD = tasks.findMappingForTask(tasks.calendarAccountId(), created.id);
  check("D mapping exists", Boolean(mappedD?.externalId), true);

  // E. Local rename is patched.
  calls.length = 0;
  tasks.updateTask(created.id, { title: "Coffee with Sam (cafe)" });
  const r5 = await service.sync();
  check("E patch", calls, ["patch:Coffee with Sam (cafe)"]);
  check("E pushed", r5.pushed, 1);

  // F. Nothing changed anywhere: no writes to Google.
  calls.length = 0;
  await service.sync();
  check("F steady state makes no calls", calls, []);

  // G. Cancelling a task deletes the event and the mapping.
  const cancelled = tasks.listCalendarEventTasks().find((task) => task.taskId === created.id);
  tasks.updateTask(created.id, { kanbanStatus: "cancelled" });
  const r7 = await service.sync();
  check("G event deleted", remote.some((event) => event.id === cancelled?.externalId), false);
  check("G deleted count", r7.deleted, 1);
  // Mapping is deliberately kept: it prevents the event id from re-creating the task.
  check("G mapping kept", tasks.findMappingForTask(tasks.calendarAccountId(), created.id)?.externalId, cancelled?.externalId);
  // A cancelled mirror must not be re-deleted (or re-created) on later passes.
  calls.length = 0;
  await service.sync();
  check("G cancelled is quiet afterwards", calls, []);

  // H. Remote delete cancels the mapped task but keeps it (never re-imported).
  remote = [{
    id: "evt-a", title: "Dentist (moved)", description: null, ...window(48, 50),
    updatedAt: new Date(now + 10_000).toISOString(), status: "cancelled", allDay: false,
    mindPalaceTaskId: null,
  }];
  await service.sync();
  const afterH = tasks.listCalendarEventTasks()[0]!;
  check("H task cancelled", afterH.kanbanStatus, "cancelled");
  check("H mapping kept", afterH.externalId, "evt-a");

  // H2. The cancelled event stays in the incremental feed; a second pass must not touch it.
  calls.length = 0;
  await service.sync();
  check("H2 repeated cancelled pull is quiet", calls, []);

  // I. All-day events are skipped by default.
  remote = [{
    id: "evt-allday", title: "Birthday", description: null,
    startAt: `${new Date(now).toISOString().slice(0, 10)}T00:00:00`,
    endAt: `${new Date(now).toISOString().slice(0, 10)}T00:00:00`,
    updatedAt: new Date(now).toISOString(), status: "confirmed", allDay: true, mindPalaceTaskId: null,
  }];
  const r9 = await service.sync();
  check("I all-day skipped", r9.pulled, 0);

  // J. Round-trip convergence: Google edit → local → Google, with no writes left over.
  remote = [];
  const j = window(96, 98);
  const jTask = tasks.createTask({
    title: "Physio",
    tagIds: [calendarTagId],
    timeBlock: { startAt: j.startAt, endAt: j.endAt, type: "calendar_event" },
  });
  await service.sync();
  const jExternal = tasks.findMappingForTask(tasks.calendarAccountId(), jTask.id)?.externalId;
  check("J pushed the new event", Boolean(jExternal), true);

  // A remote edit lands and is mirrored...
  const moved = window(120, 122);
  remote = remote.map((event) => event.id === jExternal
    ? { ...event, title: "Physio (moved)", startAt: moved.startAt, endAt: moved.endAt, updatedAt: new Date(Date.now() + 60_000).toISOString() }
    : event);
  await service.sync();
  const jMirrored = tasks.listCalendarEventTasks().find((task) => task.taskId === jTask.id);
  check("J remote edit mirrored title", jMirrored?.title, "Physio (moved)");
  check("J remote edit mirrored window", [jMirrored?.startAt, jMirrored?.endAt], [moved.startAt, moved.endAt]);

  // ...then a local edit on top of it is pushed, and the next pass is quiet in both directions.
  calls.length = 0;
  tasks.updateTask(jTask.id, { title: "Physio (knee)" });
  await service.sync();
  check("J local edit pushed", calls, ["patch:Physio (knee)"]);
  calls.length = 0;
  const r12 = await service.sync();
  check("J steady state after round trip", calls, []);
  check("J second pass pulls nothing", r12.pulled, 0);

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  database.close();
  process.exit(failures === 0 ? 0 : 1);
}

void main();
