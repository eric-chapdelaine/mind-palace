/**
 * Two changes that answer the same question — what is still worth looking at?
 *
 * `tasks.auto_archive_at` is the instant a task decays. The daily `task-auto-archive` job archives
 * rows whose instant has passed, so a task you never got to leaves the board on its own instead of
 * accumulating. It is a timestamp rather than a day because the decay point genuinely carries a
 * time: a "wake up" occurrence should be gone by 10am on the day it was created, while an ordinary
 * task should linger a month. A `YYYY-MM-DD` column cannot express the first one.
 * NULL means never — completed, cancelled and calendar-event rows keep NULL, ordinary tasks default
 * to a month (see `TaskRepository.createTask`). Recurrence templates are skipped by the job rather
 * than by a NULL date, so a still-running routine is never archived out from under its children.
 *
 * `recurrence_rules.auto_archive_hour` is the template's own expiry policy: the local hour of the
 * occurrence's day at which its child decays. NULL means end of that day. That is what makes the
 * rule per-routine instead of one global default.
 *
 * The `this-week` tag goes away. It was the scheduler's eligibility gate, the "this week" bucket and
 * the weekday tags' parent all at once, so a task could be perfectly schedulable and silently
 * invisible. What belongs in the week is the scheduler's answer now (priority, rules, weather), not
 * a tag a person has to remember to add. Weekday tags survive as selectors for the seeded
 * `assignDays` pins; they just no longer hang off a parent.
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
