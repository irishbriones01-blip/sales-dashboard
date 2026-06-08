// app.js
// Drives the dashboard webpage. It never talks to HubSpot directly — it just
// loads whichever saved data file matches the selected report (see REPORTS
// below) and adds those numbers up however the visitor wants to look at them
// (today, this week, last month, a custom range, etc.).

// ── Report definitions ──
// Each report points at its own data file and lists the columns/cards it
// shows. Adding a new report later just means adding an entry here (plus an
// <option> in the dropdown in index.html) — everything else is generic.
const REPORTS = {
  activities: {
    label: 'Sales Activities',
    dataUrl: 'data/report-activities.json',
    dashboardUrl: 'https://app.hubspot.com/reports-dashboard/47316647/view/19277797',
    metrics: [
      { key: 'pipelineTouch',  label: 'Pipeline Touch' },
      { key: 'emailsSent',     label: 'Emails Sent' },
      { key: 'emailsReceived', label: 'Emails Received' },
      { key: 'smsSent',        label: 'SMS Sent' },
      { key: 'smsReceived',    label: 'SMS Received' },
      { key: 'chatsEngaged',   label: 'Chats Engaged' },
      { key: 'tasksCreated',   label: 'Tasks Created' },
      { key: 'tasksCompleted', label: 'Tasks Completed' },
    ],
    summary: ['pipelineTouch', 'emailsSent', 'smsSent', 'chatsEngaged', 'tasksCompleted'],
  },
  bulk: {
    label: 'Bulk Orders',
    dataUrl: 'data/report-bulk.json',
    dashboardUrl: 'https://app.hubspot.com/reports-dashboard/47316647/view/19513019',
    metrics: [
      { key: 'quotes',          label: 'Quotes Created' },
      { key: 'quotesValue',     label: 'Quotes Value', money: true },
      { key: 'quotesCommitted', label: 'Quotes Committed' },
      { key: 'closedLost',      label: 'Closed Lost Deals' },
      { key: 'bulkConversions', label: 'Bulk Conversions' },
      { key: 'bulkRevenue',     label: 'Bulk Revenue', money: true },
      { key: 'bulkOrders',      label: 'Bulk Orders Written' },
    ],
    summary: ['quotes', 'quotesValue', 'bulkConversions', 'bulkRevenue', 'bulkOrders'],
  },
  teamStore: {
    label: 'Team Store',
    dataUrl: 'data/report-team-store.json',
    dashboardUrl: 'https://app.hubspot.com/reports-dashboard/47316647/view/19795146',
    metrics: [
      { key: 'buildRequests',       label: 'Build Requests' },
      { key: 'wentLive',            label: 'Went Live' },
      { key: 'storesWithRevenue',   label: 'Stores w/ Revenue' },
      { key: 'grossRevenue',        label: 'Gross Revenue', money: true },
      { key: 'convertsWithRevenue', label: 'Open Stores w/ Revenue' },
      { key: 'convertsNoRevenue',   label: 'Open Stores w/ No Revenue' },
      { key: 'transactions',        label: 'TS Transactions' },
    ],
    summary: ['buildRequests', 'wentLive', 'storesWithRevenue', 'grossRevenue', 'transactions'],
  },
};
const DEFAULT_REPORT = 'activities';

// Where "open in HubSpot" links/clicks send people — each report points at
// its own matching HubSpot reports dashboard (set via `dashboardUrl` above).
// (HubSpot doesn't support pre-filtered deep links — we checked both
// dashboards and record lists — so every number/chart for a given report
// opens that report's dashboard; from there, HubSpot's own Owner + Date
// filters narrow it down to the rep and day you're after.)
function hubspotDashboardUrl() {
  return currentReport().dashboardUrl || '';
}

// Wraps a displayed value so it opens the active report's HubSpot dashboard
// in a new tab. Falls back to plain (non-linked) text if a report has no
// dashboardUrl configured.
function hsLink(display) {
  const url = hubspotDashboardUrl();
  if (!url) return `<span>${display}</span>`;
  return `<a class="hs-link" href="${url}" target="_blank" rel="noopener" title="Open in HubSpot">${display}</a>`;
}

const MONTHS_LONG = ['January','February','March','April','May','June',
  'July','August','September','October','November','December'];
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun',
  'Jul','Aug','Sep','Oct','Nov','Dec'];

let chartInstances = [];

let state = {
  activeReport: DEFAULT_REPORT,
  entries: [],          // every saved {date, rep, ...metrics} row for the active report
  generatedAt: null,    // when that report's data file was last produced
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

function currentReport() {
  return REPORTS[state.activeReport] || REPORTS[DEFAULT_REPORT];
}

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

// Numbers display as plain counts; metrics flagged "money" get a $ and cents.
function formatMetric(value, metric) {
  const n = Number(value) || 0;
  if (metric && metric.money) {
    return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return n.toLocaleString();
}

// ── Add up every saved day×rep entry that falls inside [start, end] ──
function aggregateRange(entries, start, end) {
  const metricKeys = currentReport().metrics.map(m => m.key);
  const startKey = formatISO(start);
  const endKey = formatISO(end);
  const totals = {};

  for (const e of entries) {
    if (e.date < startKey || e.date > endKey) continue;
    if (!totals[e.rep]) {
      totals[e.rep] = { rep: e.rep };
      metricKeys.forEach(k => { totals[e.rep][k] = 0; });
    }
    metricKeys.forEach(k => { totals[e.rep][k] += e[k] || 0; });
  }

  return Object.values(totals)
    .filter(r => metricKeys.some(k => r[k] > 0))
    .sort((a, b) => a.rep.localeCompare(b.rep));
}

function applyActiveRange() {
  const range = getRange(state.activeRange);
  state.rows = aggregateRange(state.entries, range.start, range.end);
  renderSummary(state.rows);
  renderCharts(state.rows);
  renderTable(state.rows);

  if (!state.entries.length) {
    setStatus('No saved report data found yet.');
  } else if (!state.rows.length) {
    setStatus(`No activity recorded for ${formatDisplay(range.start, range.end)}.`);
  } else {
    setStatus(`Showing ${state.rows.length} rep${state.rows.length !== 1 ? 's' : ''} for ${formatDisplay(range.start, range.end)}.`);
  }
}

// ── Load the saved data file for whichever report is currently selected ──
async function loadData({ silent = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  if (!silent) showLoading(true);
  hideError();

  const report = currentReport();

  try {
    const res = await fetch(`${report.dataUrl}?_=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Could not load ${report.dataUrl} (HTTP ${res.status})`);
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
    renderCharts([]);
    renderTable([]);
    showError(
      `The "${report.label}" report data could not be loaded. Make sure ${report.dataUrl} exists next to this page.`,
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
  const report = currentReport();
  const sum = key => rows.reduce((acc, r) => acc + (r[key] || 0), 0);

  const cards = [`
    <div class="card" id="cardReps">
      <div class="card-label">Active Reps</div>
      <div class="card-value">${rows.length ? hsLink(rows.length) : '-'}</div>
    </div>`];

  report.summary.forEach(key => {
    const metric = report.metrics.find(m => m.key === key);
    if (!metric) return;
    cards.push(`
    <div class="card">
      <div class="card-label">${escHtml(metric.label)}</div>
      <div class="card-value">${hsLink(formatMetric(sum(key), metric))}</div>
    </div>`);
  });

  document.getElementById('summaryCards').innerHTML = cards.join('');
}

const TOP_N = 5;
const CHART_COLOR = '#ff7a59';

function destroyCharts() {
  chartInstances.forEach(c => c.destroy());
  chartInstances = [];
}

// One small "Top Performers" bar chart per metric in the active report,
// each showing the highest N reps for that metric in the selected range.
function renderCharts(rows) {
  destroyCharts();
  const report = currentReport();
  const grid = document.getElementById('chartsGrid');

  if (!rows.length) {
    grid.innerHTML = '<p class="charts-empty">No activity to chart for this date range.</p>';
    return;
  }

  grid.innerHTML = report.metrics.map(m => `
    <div class="chart-card">
      <div class="chart-card-title">${escHtml(m.label)}</div>
      <div class="chart-canvas-wrap"><canvas id="chart-${m.key}"></canvas></div>
    </div>`).join('');

  report.metrics.forEach(m => {
    const top = [...rows]
      .filter(r => (r[m.key] || 0) > 0)
      .sort((a, b) => (b[m.key] || 0) - (a[m.key] || 0))
      .slice(0, TOP_N);

    const canvas = document.getElementById(`chart-${m.key}`);
    if (!canvas) return;

    if (!top.length) {
      canvas.replaceWith(Object.assign(document.createElement('p'), {
        className: 'charts-empty',
        textContent: 'No activity recorded.',
      }));
      return;
    }

    chartInstances.push(new Chart(canvas, {
      type: 'bar',
      data: {
        labels: top.map(r => r.rep),
        datasets: [{
          data: top.map(r => r[m.key] || 0),
          backgroundColor: CHART_COLOR,
          borderRadius: 4,
          maxBarThickness: 22,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        onClick: () => {
          const url = hubspotDashboardUrl();
          if (url) window.open(url, '_blank', 'noopener');
        },
        onHover: (evt, elements) => {
          evt.native.target.style.cursor = elements.length ? 'pointer' : 'default';
        },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => formatMetric(ctx.parsed.x, m) } },
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: { callback: v => formatMetric(v, m) },
          },
          y: { ticks: { autoSkip: false } },
        },
      },
    }));
  });
}

function renderTable(rows) {
  const report = currentReport();
  const sorted = sortRows(rows, state.sortCol, state.sortDir);
  const thead = document.getElementById('tableHead');
  const tbody = document.getElementById('tableBody');
  const tfoot = document.getElementById('tableFoot');
  const colCount = report.metrics.length + 1;

  thead.innerHTML = `<tr>
    <th class="sortable" data-col="rep">Rep <span class="sort-icon">&#8645;</span></th>
    ${report.metrics.map(m =>
      `<th class="sortable num" data-col="${m.key}">${escHtml(m.label)} <span class="sort-icon">&#8645;</span></th>`
    ).join('')}
  </tr>`;
  const activeTh = thead.querySelector(`th[data-col="${state.sortCol}"]`);
  if (activeTh) activeTh.classList.add(state.sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
  bindSortHeaders();

  if (!sorted.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="${colCount}">No activity recorded for this date range.</td></tr>`;
    tfoot.innerHTML = '';
    return;
  }

  tbody.innerHTML = sorted.map(row => `<tr>
    <td>${escHtml(row.rep || '-')}</td>
    ${report.metrics.map(m => `<td class="num">${hsLink(formatMetric(row[m.key] || 0, m))}</td>`).join('')}
  </tr>`).join('');

  const sum = key => sorted.reduce((a, r) => a + (r[key] || 0), 0);
  tfoot.innerHTML = `<tr>
    <td><strong>Totals</strong></td>
    ${report.metrics.map(m => `<td class="num"><strong>${hsLink(formatMetric(sum(m.key), m))}</strong></td>`).join('')}
  </tr>`;
}

function bindSortHeaders() {
  document.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (state.sortCol === col) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortCol = col;
        state.sortDir = col === 'rep' ? 'asc' : 'desc';
      }
      renderTable(state.rows);
    });
  });
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

// Switches which report is shown: points state at the new report's data file,
// resets sorting if the old sort column doesn't exist on the new report, and
// reloads + re-renders everything.
function switchReport(id) {
  if (!REPORTS[id] || id === state.activeReport) return;
  state.activeReport = id;

  const validCols = ['rep', ...REPORTS[id].metrics.map(m => m.key)];
  if (!validCols.includes(state.sortCol)) {
    state.sortCol = 'rep';
    state.sortDir = 'asc';
  }

  loadData();
}

function exportCSV() {
  if (!state.rows.length) return;
  const report = currentReport();
  const headers = ['Rep', ...report.metrics.map(m => m.label)];
  const cols = ['rep', ...report.metrics.map(m => m.key)];

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
  const slug = report.label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  a.href = url;
  a.download = `${slug}-report_${formatISO(range.start)}_${formatISO(range.end)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(location.search);
  if (params.get('range')) state.activeRange = params.get('range');
  if (params.get('report') && REPORTS[params.get('report')]) state.activeReport = params.get('report');
  if (params.get('tab') === 'about') {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.getElementById('tabAbout').classList.add('active');
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('[data-tab="about"]').classList.add('active');
  }

  document.getElementById('reportPicker').value = state.activeReport;

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

  document.getElementById('reportPicker').addEventListener('change', (e) => {
    switchReport(e.target.value);
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

  loadData();
});
