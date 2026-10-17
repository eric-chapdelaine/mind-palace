export const mealModeTagsMigration = {
  version: 14,
  name: "cook and eat-out meal tags",
  sql: String.raw`
    INSERT OR IGNORE INTO tags (public_id, title, description, created_at, updated_at) VALUES
      ('mind-palace:cook', 'cook', 'This meal is cooked at home.', '2026-10-17T00:00:00.000Z', '2026-10-17T00:00:00.000Z'),
      ('mind-palace:eat-out', 'eat-out', 'This meal is eaten out. Rules can key on it to count a meal out as an outing.', '2026-10-17T00:00:00.000Z', '2026-10-17T00:00:00.000Z');
  `,
} as const;
