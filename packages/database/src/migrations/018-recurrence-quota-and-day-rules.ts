/**
 * Day pins leave the data model, and recurrence learns to express a quota.
 *
 * Two changes that belong together because they are the same idea: a task must not store a
 * placement fact, and recurrence must be able to say "this many times per period" without naming
 * which day.
 *
 * 1. The seven `mind-palace:<weekday>` tags and the seven seeded hard `assignDays` rules are
 *    deleted. A task carrying the Monday tag was pinned to a Monday that stops existing, so on
 *    Tuesday the rule matched nothing and the task silently fell out of the plan. Day intent now
 *    lives in a rule on the class tag (the routine's own tag), where it is re-evaluated against
 *    the current week. The dead `mind-palace:this-week` tag goes with them.
 *
 * 2. `times_per_period` is how many interchangeable occurrences a period gets. A daily period is
 *    one day, so 1 means "today's card". A weekly period is a week: 1 means "once this week, any
 *    day", 3 means "three times this week". The period's span becomes the occurrence's window, so
 *    `deadlineAt` no longer pins a card to a single date — rules decide where it lands.
 *
 * Existing weekly templates keep their frequency: their occurrence count becomes the number of
 * weekdays they used to select, and their weekday intent is carried over as a soft preference on
 * the routine's tag. A soft `assignDays` is now graded by distance, so Monday still beats Tuesday
 * for a Sunday-preferred routine.
 *
 * The ledger is re-keyed to `(template_id, period_start, sequence)`: `sequence` is what lets one
 * weekly period hold three interchangeable children. `period_start` is derived from the template's
 * anchor with the same arithmetic the service uses, so an existing occurrence lands in the period
 * it was generated for rather than the date it happened to be stamped with.
 */
export const recurrenceQuotaAndDayRulesMigration = {
  version: 18,
  name: "recurrence quotas and rule-owned days",
  sql: String.raw`
    -- Day pins: the tags first (their join rows cascade), then the rules that read them.
    DELETE FROM tags WHERE public_id IN (
      'mind-palace:sunday', 'mind-palace:monday', 'mind-palace:tuesday', 'mind-palace:wednesday',
      'mind-palace:thursday', 'mind-palace:friday', 'mind-palace:saturday', 'mind-palace:this-week'
    );
    DELETE FROM scheduler_rules WHERE public_id LIKE 'mind-palace:rule:weekday-%';

    ALTER TABLE recurrence_templates
      ADD COLUMN times_per_period INTEGER NOT NULL DEFAULT 1 CHECK (times_per_period >= 1);

    -- A weekly template with three weekdays meant three occurrences a week. Keep the count; let
    -- the days float, which is the point of the change.
    UPDATE recurrence_templates
       SET times_per_period = MAX(1, json_array_length(weekdays_json))
     WHERE frequency = 'weekly' AND weekdays_json IS NOT NULL;

    -- Carry the old day choice over as a graded soft preference on the routine's own tag, so the
    -- intent survives without a per-task pin. Recurrence used JS getDay() order (0 = Sunday);
    -- rule days use Python order (0 = Monday), hence the rotation.
    INSERT OR IGNORE INTO scheduler_rules
      (public_id, title, enabled, condition_json, effect_json, strength_kind, weight, reason, created_at, updated_at)
    SELECT 'mind-palace:rule:recurrence-' || template.public_id,
           template.title || ' preferred days', 1,
           json_object('taskHasTag', (SELECT tag.public_id FROM tags tag WHERE tag.id = template.routine_tag_id)),
           json_object(
             'type', 'assignDays',
             'days', json((SELECT json_group_array((CAST(value AS INTEGER) + 6) % 7)
                             FROM json_each(template.weekdays_json)))
           ),
           'soft', 10, template.title || ' used to run on these days',
           strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM recurrence_templates template
     WHERE template.frequency = 'weekly'
       AND template.routine_tag_id IS NOT NULL
       AND template.weekdays_json IS NOT NULL
       AND json_array_length(template.weekdays_json) > 0;

    CREATE TABLE recurrence_occurrences_new (
      template_id INTEGER NOT NULL REFERENCES recurrence_templates(id) ON DELETE CASCADE,
      -- The first date of the period this occurrence belongs to. For a daily template that is the
      -- date itself; for a weekly one it is the week's first day, whichever weekday that is.
      period_start TEXT NOT NULL,
      sequence INTEGER NOT NULL DEFAULT 0 CHECK (sequence >= 0),
      -- Neither UNIQUE nor required: the ledger records that a template produced this slot, and
      -- the child may later be deleted on its own.
      child_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (template_id, period_start, sequence)
    );

    WITH periodised AS (
      SELECT occurrence.template_id,
             occurrence.occurrence_date,
             occurrence.child_task_id,
             occurrence.created_at,
             date(
               template.next_occurrence_date,
               '+' || (
                 CAST(
                   (julianday(occurrence.occurrence_date) - julianday(template.next_occurrence_date))
                   / (template.interval_count * (CASE template.frequency WHEN 'weekly' THEN 7 ELSE 1 END))
                   AS INTEGER
                 ) * (template.interval_count * (CASE template.frequency WHEN 'weekly' THEN 7 ELSE 1 END))
               ) || ' days'
             ) AS period_start
        FROM recurrence_occurrences occurrence
        JOIN recurrence_templates template ON template.id = occurrence.template_id
    )
    INSERT INTO recurrence_occurrences_new (template_id, period_start, sequence, child_task_id, created_at)
    SELECT template_id, period_start,
           ROW_NUMBER() OVER (PARTITION BY template_id, period_start ORDER BY occurrence_date) - 1,
           child_task_id, created_at
      FROM periodised;

    DROP TABLE recurrence_occurrences;
    ALTER TABLE recurrence_occurrences_new RENAME TO recurrence_occurrences;
    CREATE INDEX recurrence_occurrences_child_idx ON recurrence_occurrences(child_task_id);

    ALTER TABLE recurrence_templates DROP COLUMN weekdays_json;
  `,
} as const;
