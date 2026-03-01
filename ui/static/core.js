// ─────────────────────────────────────────────────────────────
// core.js — widget registry, renderer, data layer, clock
// Do not put widget definitions here. See widgets.js.
// ─────────────────────────────────────────────────────────────

// ── Widget Registry ──────────────────────────────────────────
const WIDGETS = [];

function registerWidget(widget) {
    WIDGETS.push(widget);
}

// ── Shared utilities ─────────────────────────────────────────
// escape HTML
function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function startOfDay(d) { const r = new Date(d); r.setHours(0, 0, 0, 0); return r; }
function endOfDay(d) { const r = new Date(d); r.setHours(23, 59, 59, 999); return r; }
function endOfWeek(d) {
    const r = new Date(d);
    r.setDate(r.getDate() + (6 - r.getDay()));
    r.setHours(23, 59, 59, 999);
    return r;
}
function parseDate(s) {
    if (s == null || s === '' || s === '0001-01-01T00:00:00Z') return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
}

function fmtDate(d) {
    console.log(JSON.stringify(d));
    if (!d) return '';
    const now = new Date();
    const diff = d - now;
    const days = Math.round(Math.abs(diff) / 86400000);
    const hasTime = d.getHours() || d.getMinutes() || d.getSeconds();
    const timeStr = hasTime ? ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
    if (d < startOfDay(now)) return `${days}d overdue${timeStr}`;
    if (d <= endOfDay(now)) return 'today' + timeStr;
    if (days === 1) return 'tomorrow' + timeStr;
    if (days < 7) return `${days}d` + timeStr;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + timeStr;
}

// ── Data layer ───────────────────────────────────────────────
// Centralised fetchers with 60s cache. Widgets import these
// rather than fetching independently, so the API is hit once
// per refresh cycle regardless of how many widgets consume it.

const _cache = {};

async function cachedFetch(key, url, ttl = 60000) {
    const now = Date.now();
    if (_cache[key] && now - _cache[key].ts < ttl) return _cache[key].data;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    const data = await res.json();
    _cache[key] = { data, ts: now };
    return data;
}

function bustCache() {
    Object.keys(_cache).forEach(k => delete _cache[k]);
}

// Convenience fetchers widgets can call
async function fetchVikunja(projectId) {
    const url = '/todos/vikunja' + (projectId ? `?project_id=${projectId}` : '');
    return cachedFetch(`vikunja:${projectId ?? 'default'}`, url);
}

async function fetchGroceries() {
    return cachedFetch('groceries', '/groceries/');
}

async function fetchTodo(todoId) {
    const res = await fetch(`/todos/vikunja/${todoId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

async function updateTodo(todoId, fields) {
    const res = await fetch(`/todos/vikunja/${todoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

async function createTodo(title, description, dueDate) {
    const body = { title };
    if (description) body.notes = description;
    if (dueDate) body.due_date = dueDate;
    const res = await fetch(`/todos/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

async function deleteTodo(todoId) {
    const res = await fetch(`/todos/vikunja/${todoId}`, {
        method: 'DELETE',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// ── Modal System ───────────────────────────────────────────────
let _modalCallback = null;
let _onModalClose = null;

function openModal(renderFn, onAction, onClose) {
    const existing = document.getElementById('modal-overlay');
    if (existing) existing.remove();

    _modalCallback = onAction;
    _onModalClose = onClose;
    const overlay = document.createElement('div');
    overlay.id = 'modal-overlay';
    overlay.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="modal" id="modal"></div>`;
    document.body.appendChild(overlay);

    const modal = document.getElementById('modal');
    modal.innerHTML = renderFn();

    document.querySelector('.modal-backdrop').addEventListener('click', closeModal);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
}

function closeModal() {
    if (window.flatpickrInstances && window.flatpickrInstances.some(fp => fp.isOpen)) {
        return;
    }
    const overlay = document.getElementById('modal-overlay');
    if (overlay) overlay.remove();
    _modalCallback = null;
    if (_onModalClose) {
        _onModalClose();
        _onModalClose = null;
    }
}

function refreshModal(renderFn) {
    const modal = document.getElementById('modal');
    if (modal) modal.innerHTML = renderFn();
}

function getModalCallback() {
    return _modalCallback;
}

// ── Renderer ─────────────────────────────────────────────────
let _isFirstRender = true;

async function renderWidget(widget, container, animate = false) {
    const el = document.createElement('div');
    el.className = 'widget';
    if (animate) el.classList.add('animate-in');
    el.id = `widget-${widget.id}`;
    el.innerHTML = `
    <div class="widget-header">
      <span class="widget-title">${esc(widget.title)}</span>
      <span class="widget-count" id="count-${widget.id}">—</span>
    </div>
    <div class="task-list" id="list-${widget.id}">
      <span class="loading">loading…</span>
    </div>`;
    container.appendChild(el);

    try {
        const data = await widget.data();
        const countEl = document.getElementById(`count-${widget.id}`);
        const listEl = document.getElementById(`list-${widget.id}`);
        countEl.textContent = data.length;
        countEl.className = `widget-count ${data.length > 0 ? 'has-items' : ''}`;
        listEl.innerHTML = widget.render(data);
    } catch (e) {
        const listEl = document.getElementById(`list-${widget.id}`);
        if (listEl) listEl.innerHTML = `<span class="error-state">error: ${esc(e.message)}</span>`;
    }
}

async function renderAll() {
    const content = document.getElementById('content');
    const isFirst = _isFirstRender;
    _isFirstRender = false;

    // On subsequent renders, don't clear - just update existing widgets
    if (!isFirst) {
        const widgets = WIDGETS.map(w => w.id);
        for (const id of widgets) {
            const widget = WIDGETS.find(w => w.id === id);
            if (widget) {
                const container = document.getElementById(`widget-${id}`);
                if (container) {
                    try {
                        const data = await widget.data();
                        const countEl = container.querySelector(`#count-${widget.id}`);
                        const listEl = container.querySelector(`#list-${widget.id}`);
                        if (countEl) {
                            countEl.textContent = data.length;
                            countEl.className = `widget-count ${data.length > 0 ? 'has-items' : ''}`;
                        }
                        if (listEl) listEl.innerHTML = widget.render(data);
                    } catch (e) {
                        const listEl = container.querySelector(`#list-${widget.id}`);
                        if (listEl) listEl.innerHTML = `<span class="error-state">error: ${esc(e.message)}</span>`;
                    }
                }
            }
        }
        return;
    }

    // First render - create everything from scratch
    content.innerHTML = '';
    bustCache();

    // Update integration status dots
    try {
        await fetchVikunja();
        document.getElementById('vikunja-dot').className = 'status-dot ok';
    } catch {
        document.getElementById('vikunja-dot').className = 'status-dot err';
    }

    // Render widgets in parallel — each fails independently
    WIDGETS.forEach(w => renderWidget(w, content, true));
}

// ── Clock ────────────────────────────────────────────────────
function updateClock() {
    document.getElementById('clock').textContent =
        new Date().toLocaleString('en-US', {
            weekday: 'short', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
}

// ── Boot ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    updateClock();
    setInterval(updateClock, 1000);
    setInterval(renderAll, 5 * 60 * 1000);
    renderAll();
});
