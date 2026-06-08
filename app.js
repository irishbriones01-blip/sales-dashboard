// app.js
// Drives the dashboard webpage. Unlike the old browser-extension version,
// this never talks to HubSpot directly — it just loads the data file that
// fetch-report.js saves once a day (data/activity.json) and adds those
// numbers up however the visitor wants to look at them (today, this week,
// last month, a custom range, etc.).

const DATA_URL = 'data/activity.json';

const METRIC_KEYS = ['pipelineTouch', 'emailsSent', 'emailsReceived',
  'smsSent', 'smsReceived', 'chatsEngaged', 'tasksCreated', 'tasksCompleted'];

const MONTHS_LONG = ['January','February','March','April','May','June',
  'July','August','September','October','November','December'];
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun',
  'Jul','Aug','Sep','Oct','Nov','Dec'];

let state = {
  entries: [],          // every saved {date, rep, ...metrics} row from the data file
  generatedAt: null,    // when the data file was last produced
  rows: [],             // the per-rep totals for the currently selected range
  loading: false,
  activeRange: 'yesterday',
  customStart: null,
  customEnd: null,
  navYear: new Date().getFullYear(),
  navMonth: new Date().getMonth(),
  sortCol: 'rep',
  sortDir: 'asc',
};

function eod(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function getRange(key) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (key) {
    case 'today':
      return { start: new Date(today), end: eod(today) };
    case 'yesterday': {
      const y = new Date(today);
      y.setDate(today.getDate() - 1);
      return { start: y, end: eod(y) };
    }
    case 'this-week': {
      const dow = today.getDay();
      const s = new Date(today);
      s.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
      return { start: s, end: eod(today) };
    }
    case 'last-week': {
      const dow = today.getDay();
      const endLW = new Date(today);
      endLW.setDate(today.getDate() - (dow === 0 ? 0 : dow));
      const startLW = new Date(endLW);
      startLW.setDate(endLW.getDate() - 6);
      return { start: startLW, end: eod(endLW) };
    }
    case 'this-month':
      return { start: new Date(today.getFullYear(), today.getMonth(), 1), end: eod(today) };
    case 'last-month': {
      const s = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const e = new Date(today.getFullYear(), today.getMonth(), 0);
      return { start: s, end: eod(e) };
    }
    case 'month-nav':
      return {
        start: new Date(state.navYear, state.navMonth, 1),
        end: eod(new Date(state.navYear, state.navMonth + 1, 0))
      };
    case 'custom':
      return {
        start: state.customStart || new Date(today),
        end: state.customEnd ? eod(state.customEnd) : eod(today)
      };
    default:
      return { start: new Date(today), end: eod(today) };
  }
}

function formatISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDisplay(start, end) {
  const fmt = d => `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  if (start.toDateString() === end.toDateString()) return fmt(start);
  return `${fmt(start)} - ${fmt(end)}`;
}

function formatTimestamp(iso) {
  if (!iso) return '–';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '–';
  const datePart = `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  const timePart = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `${datePart} at ${timePart}`;
}

// ── Add up every saved day×rep entry that falls inside [start, end] ──
function aggregateRange(entries, start, end) {
  const startKey = formatISO(start);
  const endKey = formatISO(end);
  const totals = {};

  for (const e of entries) {
    if (e.date < startKey || e.date > endKey) continue;
    if (!totals[e.rep]) {
      totals[e.rep] = { rep: e.rep };
      METRIC_KEYS.forEach(k => { totals[e.rep][k] = 0; });
    }
    METRIC_KEYS.forEach(k => { totals[e.rep][k] += e[k] || 0; });
  }

  return Object.values(totals)
    .filter(r => METRIC_KEYS.some(k => r[k] > 0))
    .sort((a, b) => a.rep.localeCompare(b.rep));
}

function applyActiveRange() {
  const range = getRange(state.activeRange);
  state.rows = aggregateRange(state.entries, range.start, range.end);
  renderSummary(state.rows);
  renderTable(state.rows);

  if (!state.entries.length) {
    setStatus('No saved report data found yet.');
  } else if (!state.rows.length) {
    setStatus(`No activity recorded for ${formatDisplay(range.start, range.end)}.`);
  } else {
    setStatus(`Showing ${state.rows.length} rep${state.rows.length !== 1 ? 's' : ''} for ${formatDisplay(range.start, range.end)}.`);
  }
}

// ── Load the saved data file (produced once a day by fetch-report.js) ──
async function loadData({ silent = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  if (!silent) showLoading(true);
  hideError();

  try {
    const res = await fetch(`${DATA_URL}?_=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Could not load ${DATA_URL} (HTTP ${res.status})`);
    const data = await res.json();

    state.entries = data.entries || [];
    state.generatedAt = data.generatedAt || null;
    document.getElementById('dataFreshness').textContent =
      `Data last updated: ${formatTimestamp(state.generatedAt)}`;

    applyActiveRange();
  } catch (err) {
    state.entries = [];
    state.rows = [];
    renderSummary([]);
    renderTable([]);
    showError(
      'The saved report data could not be loaded. Make sure the daily fetch has run at least once and that data/activity.json exists next to this page.',
      err.message,
      'Could not load report data'
    );
    setStatus('Failed to load report data.');
  } finally {
    state.loading = false;
    showLoading(false);
  }
}

function renderSummary(rows) {
  const sum = key => rows.reduce((acc, r) => acc + (r[key] || 0), 0);
  document.getElementById('valReps').textContent = rows.length || '-';
  document.getElementById('valPipeline').textContent = sum('pipelineTouch').toLocaleString();
  document.getElementById('valEmails').textContent = sum('emailsSent').toLocaleString();
  document.getElementById('valSms').textContent = sum('smsSent').toLocaleString();
  document.getElementById('valTasks').textContent = sum('tasksCompleted').toLocaleString();
  document.getElementById('valChats').textContent = sum('chatsEngaged').toLocaleString();
}

function renderTable(rows) {
  const sorted = sortRows(rows, state.sortCol, state.sortDir);
  const tbody = document.getElementById('tableBody');
  const tfoot = document.getElementById('tableFoot');

  if (!sorted.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="9">No HubSpot activity recorded for this date range.</td></tr>';
    tfoot.innerHTML = '';
    return;
  }

  tbody.innerHTML = sorted.map(row => `<tr>
    <td>${escHtml(row.rep || '-')}</td>
    <td class="num">${row.pipelineTouch || 0}</td>
    <td class="num">${row.emailsSent || 0}</td>
    <td class="num">${row.emailsReceived || 0}</td>
    <td class="num">${row.smsSent || 0}</td>
    <td class="num">${row.smsReceived || 0}</td>
    <td class="num">${row.chatsEngaged || 0}</td>
    <td class="num">${row.tasksCreated || 0}</td>
    <td class="num">${row.tasksCompleted || 0}</td>
  </tr>`).join('');

  const sum = key => sorted.reduce((a, r) => a + (r[key] || 0), 0);
  tfoot.innerHTML = `<tr>
    <td><strong>Totals</strong></td>
    <td class="num"><strong>${sum('pipelineTouch')}</strong></td>
    <td class="num"><strong>${sum('emailsSent')}</strong></td>
    <td class="num"><strong>${sum('emailsReceived')}</strong></td>
    <td class="num"><strong>${sum('smsSent')}</strong></td>
    <td class="num"><strong>${sum('smsReceived')}</strong></td>
    <td class="num"><strong>${sum('chatsEngaged')}</strong></td>
    <td class="num"><strong>${sum('tasksCreated')}</strong></td>
    <td class="num"><strong>${sum('tasksCompleted')}</strong></td>
  </tr>`;
}

function sortRows(rows, col, dir) {
  if (!col) return rows;
  return [...rows].sort((a, b) => {
    let av = a[col] ?? '';
    let bv = b[col] ?? '';
    if (typeof av === 'number' && typeof bv === 'number') {
      return dir === 'asc' ? av - bv : bv - av;
    }
    av = String(av).toLowerCase();
    bv = String(bv).toLowerCase();
    return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
  });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showLoading(on) {
  document.getElementById('loadingSpinner').classList.toggle('hidden', !on);
  document.getElementById('dataTable').classList.toggle('hidden', on);
}

function showError(msg, debug, title = 'Could not load report data') {
  document.getElementById('errorPanel').classList.remove('hidden');
  document.getElementById('errorTitle').textContent = `⚠ ${title}`;
  document.getElementById('errorMsg').textContent = msg;
  const debugEl = document.getElementById('errorDebug');
  if (debugEl && debug) {
    debugEl.textContent = String(debug);
    debugEl.classList.remove('hidden');
  } else if (debugEl) {
    debugEl.classList.add('hidden');
  }
}

function hideError() {
  document.getElementById('errorPanel').classList.add('hidden');
}

function setStatus(msg) {
  document.getElementById('statusMsg').textContent = msg;
}

function updateRangeDisplay() {
  const range = getRange(state.activeRange);
  document.getElementById('rangeDisplay').textContent = 'Showing: ' + formatDisplay(range.start, range.end);
  document.getElementById('monthLabel').textContent = `${MONTHS_LONG[state.navMonth]} ${state.navYear}`;
}

function setActiveFilter(key) {
  state.activeRange = key;
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.range === key);
  });
  document.getElementById('customRange').classList.toggle('hidden', key !== 'custom');
  updateRangeDisplay();
}

function exportCSV() {
  if (!state.rows.length) return;
  const headers = ['Rep','Pipeline Touch','Emails Sent','Emails Received',
    'SMS Sent','SMS Received','Chats Engaged','Tasks Created','Tasks Completed'];
  const cols = ['rep','pipelineTouch','emailsSent','emailsReceived',
    'smsSent','smsReceived','chatsEngaged','tasksCreated','tasksCompleted'];

  const lines = [
    headers.map(h => `"${h}"`).join(','),
    ...sortRows(state.rows, state.sortCol, state.sortDir).map(row =>
      cols.map(c => `"${String(row[c] ?? '').replace(/"/g, '""')}"`).join(',')
    )
  ];

  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const range = getRange(state.activeRange);
  a.href = url;
  a.download = `hubspot-report_${formatISO(range.start)}_${formatISO(range.end)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(location.search);
  if (params.get('range')) state.activeRange = params.get('range');
  if (params.get('tab') === 'about') {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.getElementById('tabAbout').classList.add('active');
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('[data-tab="about"]').classList.add('active');
  }

  const range = getRange(state.activeRange);
  state.navYear = range.start.getFullYear();
  state.navMonth = range.start.getMonth();
  setActiveFilter(state.activeRange);

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      const target = `tab${btn.dataset.tab.charAt(0).toUpperCase() + btn.dataset.tab.slice(1)}`;
      document.getElementById(target).classList.add('active');
    });
  });

  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setActiveFilter(btn.dataset.range);
      if (btn.dataset.range !== 'custom') applyActiveRange();
    });
  });

  document.getElementById('prevMonth').addEventListener('click', () => {
    if (state.navMonth === 0) {
      state.navMonth = 11;
      state.navYear--;
    } else {
      state.navMonth--;
    }
    setActiveFilter('month-nav');
    applyActiveRange();
  });

  document.getElementById('nextMonth').addEventListener('click', () => {
    if (state.navMonth === 11) {
      state.navMonth = 0;
      state.navYear++;
    } else {
      state.navMonth++;
    }
    setActiveFilter('month-nav');
    applyActiveRange();
  });

  document.getElementById('applyCustom').addEventListener('click', () => {
    const s = document.getElementById('customStart').value;
    const e = document.getElementById('customEnd').value;
    if (s) state.customStart = new Date(`${s}T00:00:00`);
    if (e) state.customEnd = new Date(`${e}T00:00:00`);
    updateRangeDisplay();
    applyActiveRange();
  });

  document.getElementById('btnRefresh').addEventListener('click', () => loadData());
  document.getElementById('btnExport').addEventListener('click', exportCSV);

  document.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (state.sortCol === col) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortCol = col;
        state.sortDir = col === 'rep' ? 'asc' : 'desc';
      }
      document.querySelectorAll('th.sortable').forEach(h => {
        h.classList.remove('sort-asc', 'sort-desc');
      });
      th.classList.add(state.sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
      renderTable(state.rows);
    });
  });

  loadData();
});
