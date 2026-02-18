// ─────────────────────────────────────────────────────────────
// widgets.js — widget definitions
// Add, remove, or reorder widgets here.
// Each widget needs: id, title, data(), render()
//
// Shared helpers available from core.js:
//   fetchVikunja(projectId?)  fetchGroceries()
//   parseDate(s)  fmtDate(d)  startOfDay(d)  endOfDay(d)  endOfWeek(d)  esc(s)
// ─────────────────────────────────────────────────────────────

// ── Task helpers (shared across the three task columns) ──────
function taskRow(task, metaClass = '') {
  const d = parseDate(task.due_date);
  return `
    <div class="task-item">
      <span class="task-title ${metaClass === 'overdue' ? 'overdue' : ''}">${esc(task.title)}</span>
      <span class="task-meta ${metaClass}">${d ? fmtDate(d) : '—'}</span>
      ${task.description ? `<span class="task-notes">${esc(task.description)}</span>` : ''}
    </div>`;
}

function emptyOr(items, emptyMsg, renderFn) {
  return items.length ? items.map(renderFn).join('') : `<span class="empty-state">${emptyMsg}</span>`;
}

// ── Today & Overdue ──────────────────────────────────────────
registerWidget({
  id: 'tasks-today',
  title: 'Today & Overdue',
  async data() {
    const tasks = await fetchVikunja();
    const eod = endOfDay(new Date());
    return tasks.filter(t => t.due_date && parseDate(t.due_date) <= eod);
  },
  render(tasks) {
    return emptyOr(tasks, 'nothing due', t => {
      const overdue = parseDate(t.due_date) < startOfDay(new Date());
      return taskRow(t, overdue ? 'overdue' : 'due-today');
    });
  },
});

// ── This Week ────────────────────────────────────────────────
registerWidget({
  id: 'tasks-week',
  title: 'This Week',
  async data() {
    const tasks = await fetchVikunja();
    const now = new Date();
    return tasks.filter(t => {
      if (!t.due_date) return false;
      const d = parseDate(t.due_date);
      return d > endOfDay(now) && d <= endOfWeek(now);
    });
  },
  render(tasks) {
    return emptyOr(tasks, 'clear week', t => taskRow(t));
  },
});

// ── Upcoming (later + no due date) ───────────────────────────
registerWidget({
  id: 'tasks-later',
  title: 'Upcoming',
  async data() {
    const tasks = await fetchVikunja();
    const eow = endOfWeek(new Date());
    return tasks.filter(t => !t.due_date || parseDate(t.due_date) > eow);
  },
  render(tasks) {
    return emptyOr(tasks, 'nothing scheduled', t => taskRow(t));
  },
});

// ─────────────────────────────────────────────────────────────
// Add new widgets below. Example:
//
// registerWidget({
//   id: 'groceries',
//   title: 'Groceries',
//   async data() { return fetchGroceries(); },
//   render(items) {
//     return emptyOr(items, 'list is empty', i =>
//       `<div class="task-item"><span class="task-title">${esc(i.name)}</span></div>`
//     );
//   },
// });
// ─────────────────────────────────────────────────────────────
