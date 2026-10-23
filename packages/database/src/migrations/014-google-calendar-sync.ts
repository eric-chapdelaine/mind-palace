/**
 * Two-way Google Calendar sync: one `calendar_event` task ⇄ one Google event, linked by the
 * existing `external_task_mappings` row (no new table — commitments are the whole mirrored set).
 *
 * `last_pushed_at` is the write we last sent to Google. The pull skips an event whose `updated`
 * is not newer than it, which is exactly the "this change came from us" case; without it a push
 * would bounce back and forth forever. `local_synced_at` is the mirror-image watermark: the newest
 * local edit already sent, so a pull (which rewrites local rows) does not look like a user edit
 * on the next push. `external_etag` remembers the event version last observed.
 */
export const googleCalendarSyncMigration = {
  version: 14,
  name: "google calendar two-way sync fields",
  sql: String.raw`
    ALTER TABLE external_task_mappings ADD COLUMN last_pushed_at TEXT;
    ALTER TABLE external_task_mappings ADD COLUMN external_etag TEXT;

    -- The newest local updated_at (task or its calendar block) that has already been mirrored.
    -- A pull writes local rows, so tasks.updated_at alone cannot mean "the user edited this";
    -- this watermark is what the push compares against to decide whether anything still differs.
    ALTER TABLE external_task_mappings ADD COLUMN local_synced_at TEXT;

    -- Tombstone: the event was deleted on Google's side but the mapping is deliberately kept so
    -- the id can never resurrect the task. Without it every push tick would try to delete again.
    ALTER TABLE external_task_mappings ADD COLUMN external_deleted_at TEXT;
  `,
} as const;
