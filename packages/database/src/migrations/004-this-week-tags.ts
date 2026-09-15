export const thisWeekTagsMigration = {
  version: 4,
  name: "this week and weekday scheduling tags",
  sql: String.raw`
    INSERT OR IGNORE INTO tags (public_id, title, description, created_at, updated_at) VALUES
      ('mind-palace:this-week', 'this-week', 'Committed to the current week; the scheduler only plans tasks carrying this tag (directly or through a parent tag).', '2026-09-10T00:00:00.000Z', '2026-09-10T00:00:00.000Z'),
      ('mind-palace:sunday', 'sunday', 'Committed to Sunday; the scheduler must place the task on Sunday.', '2026-09-10T00:00:00.000Z', '2026-09-10T00:00:00.000Z'),
      ('mind-palace:monday', 'monday', 'Committed to Monday; the scheduler must place the task on Monday.', '2026-09-10T00:00:00.000Z', '2026-09-10T00:00:00.000Z'),
      ('mind-palace:tuesday', 'tuesday', 'Committed to Tuesday; the scheduler must place the task on Tuesday.', '2026-09-10T00:00:00.000Z', '2026-09-10T00:00:00.000Z'),
      ('mind-palace:wednesday', 'wednesday', 'Committed to Wednesday; the scheduler must place the task on Wednesday.', '2026-09-10T00:00:00.000Z', '2026-09-10T00:00:00.000Z'),
      ('mind-palace:thursday', 'thursday', 'Committed to Thursday; the scheduler must place the task on Thursday.', '2026-09-10T00:00:00.000Z', '2026-09-10T00:00:00.000Z'),
      ('mind-palace:friday', 'friday', 'Committed to Friday; the scheduler must place the task on Friday.', '2026-09-10T00:00:00.000Z', '2026-09-10T00:00:00.000Z'),
      ('mind-palace:saturday', 'saturday', 'Committed to Saturday; the scheduler must place the task on Saturday.', '2026-09-10T00:00:00.000Z', '2026-09-10T00:00:00.000Z');

    INSERT OR IGNORE INTO tag_parents (child_tag_id, parent_tag_id, created_at)
      SELECT child.id, parent.id, '2026-09-10T00:00:00.000Z' FROM tags child, tags parent
       WHERE child.title = 'sunday' AND parent.title = 'this-week';
    INSERT OR IGNORE INTO tag_parents (child_tag_id, parent_tag_id, created_at)
      SELECT child.id, parent.id, '2026-09-10T00:00:00.000Z' FROM tags child, tags parent
       WHERE child.title = 'monday' AND parent.title = 'this-week';
    INSERT OR IGNORE INTO tag_parents (child_tag_id, parent_tag_id, created_at)
      SELECT child.id, parent.id, '2026-09-10T00:00:00.000Z' FROM tags child, tags parent
       WHERE child.title = 'tuesday' AND parent.title = 'this-week';
    INSERT OR IGNORE INTO tag_parents (child_tag_id, parent_tag_id, created_at)
      SELECT child.id, parent.id, '2026-09-10T00:00:00.000Z' FROM tags child, tags parent
       WHERE child.title = 'wednesday' AND parent.title = 'this-week';
    INSERT OR IGNORE INTO tag_parents (child_tag_id, parent_tag_id, created_at)
      SELECT child.id, parent.id, '2026-09-10T00:00:00.000Z' FROM tags child, tags parent
       WHERE child.title = 'thursday' AND parent.title = 'this-week';
    INSERT OR IGNORE INTO tag_parents (child_tag_id, parent_tag_id, created_at)
      SELECT child.id, parent.id, '2026-09-10T00:00:00.000Z' FROM tags child, tags parent
       WHERE child.title = 'friday' AND parent.title = 'this-week';
    INSERT OR IGNORE INTO tag_parents (child_tag_id, parent_tag_id, created_at)
      SELECT child.id, parent.id, '2026-09-10T00:00:00.000Z' FROM tags child, tags parent
       WHERE child.title = 'saturday' AND parent.title = 'this-week';
  `,
} as const;