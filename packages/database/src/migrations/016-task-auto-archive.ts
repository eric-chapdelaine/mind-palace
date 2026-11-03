/**
 * `tasks.auto_archive_at` is the instant a task decays: the sweep archives rows whose instant has
 * passed, so work you never got to leaves the board on its own. It is a timestamp rather than a day
 * because decay genuinely carries a time — "wake up" is gone by 10am, an ordinary task lingers a
 * month — and `YYYY-MM-DD` cannot express the first. NULL means never.
 *
 * `recurrence_rules.auto_archive_hour` is the template's own expiry policy: the local hour at which
 * an occurrence's child decays. NULL means end of that day. That is what makes decay per-recurrence
 * rather than one global default.
 *
 * The `this-week` tag is deleted. It was the scheduler's eligibility gate and a bucket at once, so a
 * task could be perfectly schedulable and silently invisible; what belongs in the week is now the
 * scheduler's answer. The weekday tags survive as selectors for the seeded `assignDays` rules.
 */
export const taskAutoArchiveMigration = {
  version: 16,
  name: "task auto-archive; drop this-week tag",
  sql: String.raw`
    ALTER TABLE tasks ADD COLUMN auto_archive_at TEXT;
    ALTER TABLE recurrence_rules ADD COLUMN auto_archive_hour INTEGER
      CHECK (auto_archive_hour IS NULL OR (auto_archive_hour BETWEEN 0 AND 23));

    -- Existing open rows decay a month after they were created. Rows already past that will be
    -- archived by the first job run, which is the point: the stale inbox is the backlog of things
    -- that never became work. Completed/cancelled rows keep NULL — the Completed view is their
    -- record, and archiving them again only moves them somewhere less useful.
    UPDATE tasks
       SET auto_archive_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+30 days')
     WHERE kanban_status NOT IN ('completed', 'cancelled')
       AND lifecycle_status <> 'archived';

    -- The tag row goes too (its task_tags and tag_parents rows cascade with it). Weekday tags stay:
    -- the seeded day-pin rules select on them directly.
    DELETE FROM tags WHERE public_id = 'mind-palace:this-week';

    CREATE INDEX tasks_auto_archive_idx ON tasks(auto_archive_at);
  `,
} as const;
