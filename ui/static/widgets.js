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
  const taskId = task.id;
  const isDone = task.done;
  return `
    <div class="task-item ${isDone ? 'completed' : ''}" data-task-id="${taskId}">
      <input type="checkbox" class="task-checkbox" ${isDone ? 'checked' : ''} onclick="event.stopPropagation();toggleTaskStatus(${taskId}, ${!isDone})">
      <span class="task-title ${metaClass === 'overdue' ? 'overdue' : ''} ${isDone ? 'done' : ''}" onclick="openTaskModal(${taskId})">${esc(task.title)}</span>
      <span class="task-meta ${metaClass}">${d ? fmtDate(d) : '—'}</span>
      ${task.description ? `<span class="task-notes" style="grid-column: 2 / -1;">${esc(task.description.slice(0, 80))}${task.description.length > 80 ? '...' : ''}</span>` : ''}
    </div>`;
}

async function toggleTaskStatus(taskId, done) {
  try {
    const task = await fetchTodo(taskId);
    const dueDateRaw = task.due_date;
    const hasValidDueDate = dueDateRaw && dueDateRaw !== '0001-01-01T00:00:00Z';
    const updateFields = { done };
    if (hasValidDueDate) {
      updateFields.due_date = dueDateRaw;
    }
    await updateTodo(taskId, updateFields);
    bustCache();
    renderAll();
  } catch (e) {
    console.error('Failed to toggle status:', e);
  }
}

// ── New Task Modal ──────────────────────────────────────────────
let _newTaskFlatpickr = null;
let _newTaskDueDate = null;

async function openNewTaskModal() {
  _newTaskDueDate = null;
  openModal(
    () => {
      const html = renderNewTaskModal();
      setTimeout(initNewTaskDatePicker, 0);
      return html;
    },
    null,
    () => renderAll()
  );
}

function renderNewTaskModal() {
  return `
    <div class="modal-header">
      <h2>New Task</h2>
      <button class="modal-close" onclick="closeModal()">&times;</button>
    </div>
    <div class="modal-body">
      <div class="modal-field">
        <label>Title</label>
        <input type="text" id="new-task-title" class="task-input" placeholder="Task title..." autofocus 
          onkeydown="if(event.key==='Enter')createNewTask()">
      </div>
      <div class="modal-field">
        <label>Due Date</label>
        <input type="text" id="new-task-duedate" class="task-input" placeholder="Click to set due date...">
      </div>
      <div class="modal-field">
        <label>Description</label>
        <textarea id="new-task-description" class="task-description-input" placeholder="Add a description..."
          onkeydown="if(event.key==='Enter'&&event.ctrlKey)createNewTask()"></textarea>
      </div>
      <button class="btn-create-task" onclick="createNewTask()">Create Task</button>
    </div>`;
}

function initNewTaskDatePicker() {
  const edit = document.getElementById('new-task-duedate');
  if (!edit) return;
  
  _newTaskFlatpickr = flatpickr(edit, {
    enableTime: true,
    dateFormat: 'Y-m-d H:i',
    defaultDate: null,
    minDate: 'today',
    onClose: (dates, dateStr, instance) => {
      _newTaskDueDate = dates[0] ? dates[0].toISOString() : null;
    }
  });
}

async function createNewTask() {
  const titleInput = document.getElementById('new-task-title');
  const descInput = document.getElementById('new-task-description');
  
  const title = titleInput?.value?.trim();
  if (!title) {
    titleInput?.focus();
    return;
  }
  
  const description = descInput?.value?.trim() || null;
  
  try {
    await createTodo(title, description, _newTaskDueDate);
    closeModal();
  } catch (e) {
    console.error('Failed to create task:', e);
  }
}

let _currentTaskId = null;

async function openTaskModal(taskId) {
  _currentTaskId = taskId;
  try {
    const todo = await fetchTodo(taskId);
    _currentDueDate = todo.due_date && todo.due_date !== '0001-01-01T00:00:00Z' ? todo.due_date : null;
    openModal(
      () => renderTodoModal(todo),
      null,
      () => renderAll()
    );
  } catch (e) {
    console.error('Failed to open task modal:', e);
  }
}

function renderTodoModal(todo) {
  const d = todo.due_date ? parseDate(todo.due_date) : null;
  const hasTime = d && (d.getHours() || d.getMinutes() || d.getSeconds());
  const dueDateDisplay = d 
    ? d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) +
      (hasTime ? ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '')
    : '<span class="muted">Click to set due date...</span>';
  const descriptionHtml = todo.description 
    ? marked.parse(todo.description, { breaks: true }) 
    : '<span class="muted">Click to add description...</span>';
  return `
    <div class="modal-header">
      <h2>${esc(todo.title)}</h2>
      <button class="modal-close" onclick="closeModal()">&times;</button>
    </div>
    <div class="modal-body">
      <div class="modal-field">
        <label>Due Date</label>
        <div id="duedate-view" class="clickable-field" onclick="enableDueDateEdit()">${dueDateDisplay}</div>
        <input type="text" id="duedate-edit" class="task-date-input" style="display:none">
      </div>
      <div class="modal-field">
        <label>Status</label>
        <label class="status-toggle">
          <input type="checkbox" id="task-status" ${todo.done ? 'checked' : ''} onchange="saveTaskStatus()">
          <span>${todo.done ? 'Completed' : 'TODO'}</span>
        </label>
      </div>
      <div class="modal-field">
        <label>Description</label>
        <div id="description-view" class="markdown-body description-view" onclick="enableDescriptionEdit()">${descriptionHtml}</div>
        <textarea id="description-edit" class="task-description-input" style="display:none" 
          onblur="saveDescription()" onkeydown="handleDescriptionKeydown(event)">${esc(todo.description ?? '')}</textarea>
      </div>
      <button class="btn-delete-task" onclick="confirmDeleteTask()">Delete Task</button>
    </div>`;
}

async function saveTaskStatus() {
  const checkbox = document.getElementById('task-status');
  if (!checkbox || !_currentTaskId) return;
  
  const done = checkbox.checked;
  const statusLabel = checkbox.nextElementSibling;
  
  try {
    await updateTodo(_currentTaskId, { done });
    if (statusLabel) {
      statusLabel.textContent = done ? 'Completed' : 'TODO';
    }
    bustCache();
  } catch (e) {
    console.error('Failed to save status:', e);
    checkbox.checked = !done;
  }
}

function confirmDeleteTask() {
  if (!_currentTaskId) return;
  if (confirm('Are you sure you want to delete this task?')) {
    deleteTask();
  }
}

async function deleteTask() {
  if (!_currentTaskId) return;
  try {
    await deleteTodo(_currentTaskId);
    closeModal();
    bustCache();
    renderAll();
  } catch (e) {
    console.error('Failed to delete task:', e);
  }
}

let _currentDueDate = null;
let _flatpickrInstance = null;

window.flatpickrInstances = [];

function enableDueDateEdit() {
  const view = document.getElementById('duedate-view');
  const edit = document.getElementById('duedate-edit');
  if (view && edit) {
    view.style.display = 'none';
    edit.style.display = 'block';
    
    _flatpickrInstance = flatpickr(edit, {
      enableTime: true,
      dateFormat: 'Y-m-d H:i',
      defaultDate: _currentDueDate || null,
      minDate: 'today',
      onClose: (dates, dateStr, instance) => {
        _flatpickrInstance = null;
        window.flatpickrInstances = window.flatpickrInstances.filter(fp => fp !== instance);
        saveDueDate(dates[0]);
      },
      onOpen: () => {
        window.flatpickrInstances.push(_flatpickrInstance);
      }
    });
    _flatpickrInstance.open();
    edit.focus();
  }
}

function saveDueDate(date) {
  const edit = document.getElementById('duedate-edit');
  const view = document.getElementById('duedate-view');
  if (!edit || !_currentTaskId) return;
  
  const due_date = date ? date.toISOString() : null;
  
  async function doSave() {
    try {
      await updateTodo(_currentTaskId, { due_date });
      const updated = await fetchTodo(_currentTaskId);
      const d = updated.due_date ? parseDate(updated.due_date) : null;
      const hasTime = d && (d.getHours() || d.getMinutes() || d.getSeconds());
      const display = d 
        ? d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) + 
          (hasTime ? ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '')
        : '<span class="muted">Click to set due date...</span>';
      if (view) {
        view.innerHTML = display;
        view.style.display = 'block';
      }
      edit.style.display = 'none';
      bustCache();
    } catch (e) {
      console.error('Failed to save due date:', e);
    }
  }
  
  doSave();
}

function enableDescriptionEdit() {
  const view = document.getElementById('description-view');
  const edit = document.getElementById('description-edit');
  if (view && edit) {
    view.style.display = 'none';
    edit.style.display = 'block';
    edit.focus();
  }
}

function handleDescriptionKeydown(e) {
  if (e.key === 'Escape') {
    saveDescription();
  }
}

async function saveDescription() {
  const edit = document.getElementById('description-edit');
  const view = document.getElementById('description-view');
  if (!edit || !_currentTaskId) return;
  
  const description = edit.value;
  try {
    await updateTodo(_currentTaskId, { description });
    const updated = await fetchTodo(_currentTaskId);
    const descriptionHtml = updated.description 
      ? marked.parse(updated.description, { breaks: true }) 
      : '<span class="muted">Click to add description...</span>';
    if (view) {
      view.innerHTML = descriptionHtml;
      view.style.display = 'block';
    }
    edit.style.display = 'none';
    bustCache();
  } catch (e) {
    console.error('Failed to save description:', e);
  }
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
    const filtered = tasks.filter(t => {
      const d = parseDate(t.due_date);
      return d && d <= eod;
    });
    return filtered.sort((a, b) => {
      const da = parseDate(a.due_date);
      const db = parseDate(b.due_date);
      if (!da || !db) return da ? -1 : 1;
      return da - db;
    });
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
    const filtered = tasks.filter(t => {
      if (!t.due_date) return false;
      const d = parseDate(t.due_date);
      return d > endOfDay(now) && d <= endOfWeek(now);
    });
    return filtered.sort((a, b) => {
      const da = parseDate(a.due_date);
      const db = parseDate(b.due_date);
      if (!da || !db) return da ? -1 : 1;
      return da - db;
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
    const filtered = tasks.filter(t => {
      const d = parseDate(t.due_date);
      return !d || d > eow;
    });
    return filtered.sort((a, b) => {
      const da = parseDate(a.due_date);
      const db = parseDate(b.due_date);
      if (!da || !db) return da ? -1 : 1;
      return da - db;
    });
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
