/**
 * Scheduler rules. Rules are data: the CP-SAT worker compiles each enabled rule into either a
 * hard constraint or a soft term assigned to a named objective tier. Tags referenced by a rule
 * are selectors — seeded (`mind-palace:*`) or user-created — and carry no behavior on their own.
 *
 * The seeded rows are the default rule set: weekday pins plus the two built-in placement /
 * fragmentation policies. They are ordinary rules and can be edited or disabled like any other.
 */
export const schedulerRulesMigration = {
  version: 11,
  name: "scheduler rules",
  sql: String.raw`
    CREATE TABLE scheduler_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      condition_json TEXT NOT NULL,
      effect_json TEXT NOT NULL,
      strength_kind TEXT NOT NULL CHECK (strength_kind IN ('hard', 'soft')),
      tier TEXT CHECK (tier IS NULL OR tier IN ('style', 'fragmentation', 'placement')),
      weight REAL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (strength_kind = 'hard' OR (tier IS NOT NULL AND weight IS NOT NULL))
    );

    -- Seeded default rules. Weekday tags are children of mind-palace:this-week; each pin is a
    -- hard day restriction. days use Python date.weekday() order: 0 = Monday .. 6 = Sunday.
    INSERT OR IGNORE INTO scheduler_rules
      (public_id, title, enabled, condition_json, effect_json, strength_kind, tier, weight, reason, created_at, updated_at)
    VALUES
      ('mind-palace:rule:weekday-monday', 'Pinned to Monday', 1,
       '{"taskHasTag":"mind-palace:monday"}', '{"type":"assignDays","days":[0]}', 'hard', NULL, NULL,
       'Pinned to Monday', '2026-10-11T00:00:00.000Z', '2026-10-11T00:00:00.000Z'),
      ('mind-palace:rule:weekday-tuesday', 'Pinned to Tuesday', 1,
       '{"taskHasTag":"mind-palace:tuesday"}', '{"type":"assignDays","days":[1]}', 'hard', NULL, NULL,
       'Pinned to Tuesday', '2026-10-11T00:00:00.000Z', '2026-10-11T00:00:00.000Z'),
      ('mind-palace:rule:weekday-wednesday', 'Pinned to Wednesday', 1,
       '{"taskHasTag":"mind-palace:wednesday"}', '{"type":"assignDays","days":[2]}', 'hard', NULL, NULL,
       'Pinned to Wednesday', '2026-10-11T00:00:00.000Z', '2026-10-11T00:00:00.000Z'),
      ('mind-palace:rule:weekday-thursday', 'Pinned to Thursday', 1,
       '{"taskHasTag":"mind-palace:thursday"}', '{"type":"assignDays","days":[3]}', 'hard', NULL, NULL,
       'Pinned to Thursday', '2026-10-11T00:00:00.000Z', '2026-10-11T00:00:00.000Z'),
      ('mind-palace:rule:weekday-friday', 'Pinned to Friday', 1,
       '{"taskHasTag":"mind-palace:friday"}', '{"type":"assignDays","days":[4]}', 'hard', NULL, NULL,
       'Pinned to Friday', '2026-10-11T00:00:00.000Z', '2026-10-11T00:00:00.000Z'),
      ('mind-palace:rule:weekday-saturday', 'Pinned to Saturday', 1,
       '{"taskHasTag":"mind-palace:saturday"}', '{"type":"assignDays","days":[5]}', 'hard', NULL, NULL,
       'Pinned to Saturday', '2026-10-11T00:00:00.000Z', '2026-10-11T00:00:00.000Z'),
      ('mind-palace:rule:weekday-sunday', 'Pinned to Sunday', 1,
       '{"taskHasTag":"mind-palace:sunday"}', '{"type":"assignDays","days":[6]}', 'hard', NULL, NULL,
       'Pinned to Sunday', '2026-10-11T00:00:00.000Z', '2026-10-11T00:00:00.000Z'),
      ('mind-palace:rule:prefer-earlier', 'Prefer earlier', 1,
       '{"always":true}', '{"type":"preferEarlier"}', 'soft', 'placement', 1,
       'Front-load the week', '2026-10-11T00:00:00.000Z', '2026-10-11T00:00:00.000Z'),
      ('mind-palace:rule:minimize-chunks', 'Minimize chunks', 1,
       '{"always":true}', '{"type":"minimizeChunks"}', 'soft', 'fragmentation', 1,
       'Keep work contiguous', '2026-10-11T00:00:00.000Z', '2026-10-11T00:00:00.000Z');
  `,
} as const;
