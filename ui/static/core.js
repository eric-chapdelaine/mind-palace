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
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function startOfDay(d) { const r = new Date(d); r.setHours(0,0,0,0); return r; }
function endOfDay(d)   { const r = new Date(d); r.setHours(23,59,59,999); return r; }
function endOfWeek(d) {
  const r = new Date(d);
  r.setDate(r.getDate() + (6 - r.getDay()));
  r.setHours(23,59,59,999);
  return r;
}
function parseDate(s) { return s ? new Date(s) : null; }

function fmtDate(d) {
  if (!d) return '';
  const now  = new Date();
  const diff = d - now;
  const days = Math.round(Math.abs(diff) / 86400000);
  if (d < startOfDay(now)) return `${days}d overdue`;
  if (d <= endOfDay(now))  return 'today';
  if (days === 1)          return 'tomorrow';
  if (days < 7)            return `${days}d`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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

// ── Renderer ─────────────────────────────────────────────────
async function renderWidget(widget, container) {
  const el = document.createElement('div');
  el.className = 'widget';
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
    const listEl  = document.getElementById(`list-${widget.id}`);
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
  WIDGETS.forEach(w => renderWidget(w, content));
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
