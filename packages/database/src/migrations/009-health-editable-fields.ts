export const healthEditableFieldsMigration = {
  version: 9,
  name: "editable health titles and notes",
  sql: String.raw`
    ALTER TABLE health_activities RENAME COLUMN title TO provider_title;
    ALTER TABLE health_activities ADD COLUMN title TEXT;
    ALTER TABLE health_activities ADD COLUMN notes TEXT;
    ALTER TABLE sleep_sessions ADD COLUMN notes TEXT;
  `,
} as const;
