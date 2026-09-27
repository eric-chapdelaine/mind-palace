export const goalTagsMigration = {
  version: 7,
  name: "tag type and archive columns",
  sql: String.raw`
    ALTER TABLE tags ADD COLUMN type TEXT CHECK (type IN ('goal'));
    ALTER TABLE tags ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1));
    CREATE INDEX tags_archived_idx ON tags(is_archived, updated_at DESC);
  `,
} as const;