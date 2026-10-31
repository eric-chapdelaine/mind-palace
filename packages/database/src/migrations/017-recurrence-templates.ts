/**
 * A recurrence template becomes its own table.
 *
 * A template is not an instance of a task. A task is a thing to do on a particular day; a template
 * is the rule saying such things should exist. Storing templates as `tasks` rows meant a template
 * occupied a kanban column, carried a duration, a rank and a decay date, showed up in tag lists, and
 * had to be excluded by name from the scheduler, the archive sweep and the briefing — four
 * exclusions that existed only to undo the fact that it was a task.
 *
 * The conversion copies each `recurrence_rules` row and the fields its occurrences are born with
 * (title, estimate, priority, tags) into `recurrence_templates`, re-points the occurrence ledger at
 * the template, and deletes the task that used to represent it. `legacy_task_id` is only used by
 * this migration to make the joins on the way through.
 *
 * Occurrences are keyed by `(template_id, occurrence_date)` only. `child_task_id` is a plain
 * reference: the ledger records which day a template has produced, not that a particular task must
 * live forever. That is what lets a deleted or completed occurrence be regenerated.
 */
export const recurrenceTemplatesMigration = {
  version: 17,
  name: "recurrence templates become their own table",
  // Deleting the old template tasks needs FK enforcement out of the way for task_tags; the child
  // tasks themselves are untouched, because parent/child was expressed through a shared tag.
  foreignKeysOff: true,
  sql: String.raw`
    CREATE TABLE recurrence_templates (
      id INTEGER PRIMARY KEY,
      public_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      duration_minutes INTEGER NOT NULL CHECK (duration_minutes >= 0),
      splittable INTEGER NOT NULL DEFAULT 0 CHECK (splittable IN (0, 1)),
      min_chunk_minutes INTEGER NOT NULL DEFAULT 30,
      max_chunk_minutes INTEGER NOT NULL DEFAULT 180,
      frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly')),
      interval_count INTEGER NOT NULL DEFAULT 1 CHECK (interval_count > 0),
      weekdays_json TEXT CHECK (weekdays_json IS NULL OR json_valid(weekdays_json)),
      local_start_time TEXT,
      next_occurrence_date TEXT NOT NULL,
      -- The template's decay policy for each occurrence: the local hour at which a child vanishes on
      -- its day. NULL = end of that day.
      auto_archive_hour INTEGER CHECK (auto_archive_hour IS NULL OR (auto_archive_hour BETWEEN 0 AND 23)),
      -- The tag that groups a template with the occurrences it has produced. It replaces the parent
      -- task's own tag, so /tags/:id still lists a routine's history.
      routine_tag_id INTEGER REFERENCES tags(id) ON DELETE SET NULL,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      legacy_task_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE recurrence_template_tags (
      template_id INTEGER NOT NULL REFERENCES recurrence_templates(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (template_id, tag_id)
    );

    INSERT INTO recurrence_templates
      (public_id, title, description, priority, duration_minutes, splittable, min_chunk_minutes,
       max_chunk_minutes, frequency, interval_count, weekdays_json, local_start_time,
       next_occurrence_date, auto_archive_hour, routine_tag_id, active, legacy_task_id,
       created_at, updated_at)
    SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2)))
             || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(6))),
           task.title, task.description, task.priority,
           COALESCE(task.duration_minutes_remaining, 30), task.splittable,
           task.min_chunk_minutes, task.max_chunk_minutes,
           rule.frequency, rule.interval_count, rule.weekdays_json, rule.local_start_time,
           rule.next_occurrence_date, rule.auto_archive_hour,
           (SELECT tag.id FROM tags tag JOIN task_tags task_tag ON task_tag.tag_id = tag.id
             WHERE task_tag.task_id = task.id
               AND tag.public_id NOT LIKE 'mind-palace:%' AND tag.public_id NOT LIKE 'example:%'
             ORDER BY tag.id LIMIT 1),
           rule.active, task.id, rule.created_at, rule.updated_at
      FROM recurrence_rules rule JOIN tasks task ON task.id = rule.task_id;

    -- A template inherits the tags its task carried, so every occurrence starts life tagged the same
    -- way. Reserved tags are carried too — the service strips the weekday ones, which would
    -- otherwise pin every occurrence to one day.
    INSERT INTO recurrence_template_tags (template_id, tag_id)
    SELECT template.id, task_tag.tag_id
      FROM recurrence_templates template
      JOIN task_tags task_tag ON task_tag.task_id = template.legacy_task_id;

    CREATE TABLE recurrence_occurrences_new (
      template_id INTEGER NOT NULL REFERENCES recurrence_templates(id) ON DELETE CASCADE,
      occurrence_date TEXT NOT NULL,
      -- Neither UNIQUE nor required: the ledger records that a template produced this day, and the
      -- child may later be deleted on its own.
      child_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (template_id, occurrence_date)
    );

    -- The ledger is re-keyed from rule id to template id. Row counts line up because every rule has
    -- exactly one template.
    INSERT INTO recurrence_occurrences_new (template_id, occurrence_date, child_task_id, created_at)
    SELECT (SELECT template.id FROM recurrence_templates template
              JOIN recurrence_rules rule ON rule.task_id = template.legacy_task_id
             WHERE rule.id = occurrence.recurrence_rule_id),
           occurrence.occurrence_date, occurrence.child_task_id, occurrence.created_at
      FROM recurrence_occurrences occurrence;

    DROP TABLE recurrence_occurrences;
    ALTER TABLE recurrence_occurrences_new RENAME TO recurrence_occurrences;

    -- The template used to be a task. Its children do not reference it, so removing it leaves them
    -- intact and tagged with the routine tag the template now owns.
    DELETE FROM tasks WHERE id IN (SELECT legacy_task_id FROM recurrence_templates);
    DROP TABLE recurrence_rules;

    -- Conversion finished: the legacy pointer has no meaning once the old table is gone.
    ALTER TABLE recurrence_templates DROP COLUMN legacy_task_id;

    CREATE INDEX recurrence_occurrences_child_idx ON recurrence_occurrences(child_task_id);
    CREATE INDEX recurrence_templates_active_idx ON recurrence_templates(active, next_occurrence_date);
  `,
} as const;
