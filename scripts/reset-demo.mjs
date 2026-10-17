#!/usr/bin/env node
// Reset the demo dataset to its freshly-seeded state so the scheduler can be exercised from
// scratch: drop every generated solver block and schedule run, then restore each [DEMO] task's
// remaining minutes. Calendar events, tags, and rules are left untouched.
//
//   pnpm demo:reset
//
// The title -> minutes map mirrors the demo seed. If you change the demo tasks, update it too.
import { DatabaseSync } from "node:sqlite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const databasePath = process.env.DATABASE_PATH
  ?? resolve(dirname(fileURLToPath(import.meta.url)), "../data/mind-palace.db");

const seededRemaining = {
  "[DEMO] Write design doc": 240,
  "[DEMO] Refactor scheduler tests": 180,
  "[DEMO] Review PR backlog": 120,
  "[DEMO] Inbox zero": 60,
  "[DEMO] Pay bills": 45,
  "[DEMO] Grocery run": 60,
  "[DEMO] Dentist paperwork": 30,
  "[DEMO] Long run": 90,
  "[DEMO] Gym session": 60,
  "[DEMO] Weekly planning": 60,
  "[DEMO] Team sync prep": 60,
  "[DEMO] Midweek review": 45,
  "[DEMO] Friday retro": 45,
  "[DEMO] Prepare slides": 90,
  "[DEMO] Rehearse presentation": 60,
  "[DEMO] File expense report": 60,
  "[DEMO] Call insurance": 30,
  "[DEMO] Monday workshop A": 360,
  "[DEMO] Monday workshop B": 360,
  "[DEMO] Monday workshop C": 360,
  "[DEMO] Someday idea": null,
  "[DEMO] Next month planning": 120,
};

const database = new DatabaseSync(databasePath);
database.exec("BEGIN IMMEDIATE");
try {
  database.exec("DELETE FROM time_blocks WHERE source = 'solver'");
  database.exec("DELETE FROM schedule_runs");
  const timestamp = new Date().toISOString();
  const update = database.prepare(
    "UPDATE tasks SET duration_minutes_remaining = ?, updated_at = ? WHERE title = ?",
  );
  for (const [title, remaining] of Object.entries(seededRemaining)) {
    update.run(remaining, timestamp, title);
  }
  database.exec("COMMIT");
} catch (error) {
  database.exec("ROLLBACK");
  throw error;
}
console.log(`Reset demo data in ${databasePath}`);