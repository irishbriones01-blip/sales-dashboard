// import-excel-reports.js
//
// One-off / repeatable helper: reads the 3 Excel reports exported from
// SharePoint (saved into imports/) and converts each one's "Raw Data" sheet
// into a {date, rep, ...metrics} JSON file — the same shape as activity.json
// — so the dashboard can show them as extra report views.
//
// Usage: node import-excel-reports.js
//
// Re-run this any time you save fresh exports into imports/ to refresh
// the numbers shown on the dashboard.

const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

const IMPORTS_DIR = path.join(__dirname, 'imports');
const OUT_DIR = path.join(__dirname, 'data');

// Excel stores dates as "serial numbers" (days since Dec 30, 1899).
// This turns one into a normal "YYYY-MM-DD" string.
function excelDateToISO(serial) {
  const ms = Math.round((Number(serial) - 25569) * 86400 * 1000);
  return new Date(ms).toISOString().slice(0, 10);
}

function num(v) {
  return typeof v === 'number' ? v : 0;
}

// Each report: which file to read, what to name the output, and how to
// rename its columns into the short keys the dashboard uses internally.
const REPORTS = [
  {
    file: 'Sales Inputs and Outcomes (Activities).xlsx',
    out: 'report-activities.json',
    label: 'Sales Activities',
    columns: {
      'Pipeline Calls':                 'pipelineTouch',
      '# Emails Sent (Outbound)':       'emailsSent',
      '# Emails Received (Inbound)':    'emailsReceived',
      '# SMS Sent (Outbound)':          'smsSent',
      '# SMS Received (Inbound)':       'smsReceived',
      '# Chats Engaged':                'chatsEngaged',
      'Tasks Created':                  'tasksCreated',
      'Tasks Completed':                'tasksCompleted',
    }
  },
  {
    file: 'Sales Inputs and Outcomes (Bulk).xlsx',
    out: 'report-bulk.json',
    label: 'Bulk Orders',
    columns: {
      '# Quotes Created':       'quotes',
      '$ Quotes Created':       'quotesValue',
      'Quotes Committed':       'quotesCommitted',
      'Closed Lost Deals':      'closedLost',
      'Bulk Conversions':       'bulkConversions',
      'Bulk Revenue Written':   'bulkRevenue',
      '# Bulk Orders Written':  'bulkOrders',
    }
  },
  {
    file: 'Sales Inputs and Outcomes (Team Store).xlsx',
    out: 'report-team-store.json',
    label: 'Team Store',
    columns: {
      '# Store Build Requests':         'buildRequests',
      '# Store Open (Went Live)':       'wentLive',
      '# Stores with Revenue':          'storesWithRevenue',
      'Open Store Gross Revenue':       'grossRevenue',
      '# Open Stores w/ Revenue':       'convertsWithRevenue',
      '# Open Stores w/ No Revenue':    'convertsNoRevenue',
      'TS Transactions':                'transactions',
    }
  },
];

fs.mkdirSync(OUT_DIR, { recursive: true });

for (const report of REPORTS) {
  const filePath = path.join(IMPORTS_DIR, report.file);
  if (!fs.existsSync(filePath)) {
    console.log(`Skipping "${report.label}" — file not found: imports/${report.file}`);
    continue;
  }

  const wb = xlsx.readFile(filePath);
  const sheet = wb.Sheets['Raw Data'];
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const header = rows[0];
  const colIndex = {};
  header.forEach((h, i) => { colIndex[h] = i; });

  const missing = Object.keys(report.columns).filter(c => !(c in colIndex));
  if (missing.length) {
    console.log(`! "${report.label}": expected column(s) not found, skipping them: ${missing.join(', ')}`);
  }

  const entries = rows.slice(1)
    .filter(r => r[0] !== '' && r[1] !== '')
    .map(r => {
      const entry = { date: excelDateToISO(r[0]), rep: String(r[1]).trim() };
      for (const [colName, key] of Object.entries(report.columns)) {
        if (colName in colIndex) entry[key] = num(r[colIndex[colName]]);
      }
      return entry;
    });

  entries.sort((a, b) => a.date === b.date ? a.rep.localeCompare(b.rep) : a.date.localeCompare(b.date));

  const outFile = path.join(OUT_DIR, report.out);
  fs.writeFileSync(outFile, JSON.stringify({
    label: report.label,
    source: report.file,
    generatedAt: new Date().toISOString(),
    entries,
  }, null, 2));

  const dates = entries.map(e => e.date);
  console.log(`✔ ${report.label.padEnd(16)} → data/${report.out}  ` +
    `(${entries.length} day×rep entries, ${dates[0]} to ${dates[dates.length - 1]})`);
}
