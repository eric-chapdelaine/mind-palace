export const exampleTagsMigration = {
  version: 2,
  name: "example tag hierarchy",
  sql: String.raw`
    INSERT OR IGNORE INTO tags (public_id, title, description, created_at, updated_at) VALUES
      ('example:personal', 'personal', 'Personal commitments and interests.', '2026-09-10T00:00:00.000Z', '2026-09-10T00:00:00.000Z'),
      ('example:home', 'home', 'Household tasks and projects.', '2026-09-10T00:00:00.000Z', '2026-09-10T00:00:00.000Z'),
      ('example:errands', 'errands', 'Tasks completed away from home.', '2026-09-10T00:00:00.000Z', '2026-09-10T00:00:00.000Z'),
      ('example:exercise', 'exercise', 'Movement and training.', '2026-09-10T00:00:00.000Z', '2026-09-10T00:00:00.000Z'),
      ('example:deep-work', 'deep_work', 'Focused work without interruptions.', '2026-09-10T00:00:00.000Z', '2026-09-10T00:00:00.000Z'),
      ('example:admin', 'admin', 'Administrative work.', '2026-09-10T00:00:00.000Z', '2026-09-10T00:00:00.000Z'),
      ('example:shopping', 'shopping', 'Items to purchase.', '2026-09-10T00:00:00.000Z', '2026-09-10T00:00:00.000Z'),
      ('example:recipes', 'recipes', 'Meals and recipe ideas.', '2026-09-10T00:00:00.000Z', '2026-09-10T00:00:00.000Z');

    INSERT OR IGNORE INTO tag_parents (child_tag_id, parent_tag_id, created_at)
      SELECT child.id, parent.id, '2026-09-10T00:00:00.000Z' FROM tags child, tags parent
       WHERE child.title = 'home' AND parent.title = 'personal';
    INSERT OR IGNORE INTO tag_parents (child_tag_id, parent_tag_id, created_at)
      SELECT child.id, parent.id, '2026-09-10T00:00:00.000Z' FROM tags child, tags parent
       WHERE child.title = 'errands' AND parent.title = 'personal';
    INSERT OR IGNORE INTO tag_parents (child_tag_id, parent_tag_id, created_at)
      SELECT child.id, parent.id, '2026-09-10T00:00:00.000Z' FROM tags child, tags parent
       WHERE child.title = 'health' AND parent.title = 'personal';
    INSERT OR IGNORE INTO tag_parents (child_tag_id, parent_tag_id, created_at)
      SELECT child.id, parent.id, '2026-09-10T00:00:00.000Z' FROM tags child, tags parent
       WHERE child.title = 'exercise' AND parent.title = 'health';
    INSERT OR IGNORE INTO tag_parents (child_tag_id, parent_tag_id, created_at)
      SELECT child.id, parent.id, '2026-09-10T00:00:00.000Z' FROM tags child, tags parent
       WHERE child.title = 'exercise' AND parent.title = 'outside';
    INSERT OR IGNORE INTO tag_parents (child_tag_id, parent_tag_id, created_at)
      SELECT child.id, parent.id, '2026-09-10T00:00:00.000Z' FROM tags child, tags parent
       WHERE child.title = 'deep_work' AND parent.title = 'work';
    INSERT OR IGNORE INTO tag_parents (child_tag_id, parent_tag_id, created_at)
      SELECT child.id, parent.id, '2026-09-10T00:00:00.000Z' FROM tags child, tags parent
       WHERE child.title = 'admin' AND parent.title = 'work';
    INSERT OR IGNORE INTO tag_parents (child_tag_id, parent_tag_id, created_at)
      SELECT child.id, parent.id, '2026-09-10T00:00:00.000Z' FROM tags child, tags parent
       WHERE child.title = 'shopping' AND parent.title = 'errands';
    INSERT OR IGNORE INTO tag_parents (child_tag_id, parent_tag_id, created_at)
      SELECT child.id, parent.id, '2026-09-10T00:00:00.000Z' FROM tags child, tags parent
       WHERE child.title = 'recipes' AND parent.title = 'home';
  `,
} as const;