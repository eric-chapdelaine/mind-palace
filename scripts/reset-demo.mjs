#!/usr/bin/env node
// Reset the demo dataset so the scheduler can be exercised from scratch: drop every generated
// solver block and schedule run, and hand each task back the time those blocks were holding.
//
// This mirrors the repository invariant (see TaskRepository.deleteTimeBlock): a block's minutes
// are subtracted from the task's remaining estimate while it exists, so removing the block adds
// them back. `superseded` blocks already returned their time when they were replaced, so only
// live blocks are refunded. Calendar events and other tasks are untouched.
//
//   pnpm demo:reset
import { DatabaseSync } from "node:sqlite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const databasePath = process.env.DATABASE_PATH
  ?? resolve(dirname(fileURLToPath(import.meta.url)), "../data/mind-palace.db");

const database = new DatabaseSync(databasePath);
database.exec("BEGIN IMMEDIATE");
try {
  // Sum the time each task is still holding before dropping the blocks that hold it.
  const heldMinutes = new Map();
  const liveBlocks = database
    .prepare("SELECT task_id, start_at, end_at FROM time_blocks WHERE source = 'solver' AND status != 'superseded'")
    .all();
  for (const block of liveBlocks) {
    const minutes = Math.round((Date.parse(block.end_at) - Date.parse(block.start_at)) / 60_000);
    heldMinutes.set(block.task_id, (heldMinutes.get(block.task_id) ?? 0) + minutes);
  }

  database.exec("DELETE FROM time_blocks WHERE source = 'solver'");
  database.exec("DELETE FROM schedule_runs");

  const timestamp = new Date().toISOString();
  const release = database.prepare(
    `UPDATE tasks SET
       duration_minutes_remaining = CASE
         WHEN duration_minutes_remaining IS NULL THEN NULL
         ELSE MAX(0, duration_minutes_remaining + ?)
       END,
       updated_at = ?
     WHERE id = ?`,
  );
  for (const [taskId, minutes] of heldMinutes) release.run(minutes, timestamp, taskId);

  database.exec("COMMIT");
} catch (error) {
  database.exec("ROLLBACK");
  throw error;
}
console.log(`Reset demo data in ${databasePath}`);
