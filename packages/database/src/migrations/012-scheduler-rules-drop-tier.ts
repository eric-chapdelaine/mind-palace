/**
 * Scheduler rules carry no objective tier. The worker optimizes a single weighted objective, so a
 * soft rule is just a weight. This rebuilds `scheduler_rules` without the `tier` column; column
 * removal needs a drop/recreate, so the runner toggles foreign keys off around it.
 */
export const schedulerRulesDropTierMigration = {
  version: 12,
  name: "scheduler rules drop tier",
  // Column removal needs a drop/recreate; the runner toggles foreign_keys off around it.
  foreignKeysOff: true,
  sql: String.raw`
    CREATE TABLE scheduler_rules_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      condition_json TEXT NOT NULL,
      effect_json TEXT NOT NULL,
      strength_kind TEXT NOT NULL CHECK (strength_kind IN ('hard', 'soft')),
      weight REAL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (strength_kind = 'hard' OR weight IS NOT NULL)
    );

    INSERT INTO scheduler_rules_new
      (id, public_id, title, enabled, condition_json, effect_json, strength_kind, weight, reason, created_at, updated_at)
      SELECT id, public_id, title, enabled, condition_json, effect_json, strength_kind, weight, reason, created_at, updated_at
      FROM scheduler_rules;

    DROP TABLE scheduler_rules;
    ALTER TABLE scheduler_rules_new RENAME TO scheduler_rules;
  `,
} as const;
