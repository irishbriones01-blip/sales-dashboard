// fetch-report.js
// Fetches HubSpot activity for a date range, counts it up per rep PER DAY,
// and saves the result as one JSON file the dashboard webpage can read.
//
// Saving day-by-day (instead of one grand total) means the webpage can add
// the numbers up however someone wants to look at them — today, this week,
// last month, a custom range — without us having to re-run this script for
// every possible view.
//
// Usage:  node fetch-report.js 2026-05-01 2026-05-31
//
// Metric definitions (confirmed with the team):
//   pipelineTouch  = calls logged by the rep
//   emailsSent     = emails with direction "EMAIL"           (outgoing)
//   emailsReceived = emails with direction "INCOMING_EMAIL"  (incoming)
//   smsSent/Received = communications where channel type contains "SMS",
//                      split by whether it was logged from the CRM (sent) or not (received)
//   tasksCreated   = tasks created within the range (by hs_createdate)
//   tasksCompleted = tasks with status COMPLETED whose hs_timestamp falls in the range
//   chatsEngaged   = conversation threads associated with the rep in the range

const fs = require('fs');
const path = require('path');

const envContent = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
const token = (envContent.match(/^HUBSPOT_API_TOKEN=(.+)$/m) || [])[1]?.trim();
if (!token) { console.error('No token found in .env'); process.exit(1); }

const HEADERS = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

const [, , startArg, endArg] = process.argv;
if (!startArg || !endArg) {
  console.error('Usage: node fetch-report.js YYYY-MM-DD YYYY-MM-DD');
  process.exit(1);
}
const startMs = new Date(`${startArg}T00:00:00.000Z`).getTime();
const endMs = new Date(`${endArg}T23:59:59.999Z`).getTime();

// Turns a HubSpot timestamp (ms-since-epoch, as a string or number) into
// a day bucket like "2026-05-14" so same-day activity groups together.
function dayKey(hsTimestamp) {
  if (!hsTimestamp) return null;
  // HubSpot usually sends "ms since epoch" as a string, but a few properties
  // come back as plain ISO date strings — handle both.
  const asNumber = Number(hsTimestamp);
  const d = new Date(Number.isFinite(asNumber) && String(hsTimestamp).trim() !== '' ? asNumber : hsTimestamp);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

// ── Search a CRM object type for records whose `timestampProperty` falls in range ──
async function searchAll(objectType, properties, timestampProperty) {
  const all = [];
  let after;
  do {
    const body = {
      filterGroups: [{
        filters: [
          { propertyName: timestampProperty, operator: 'GTE', value: String(startMs) },
          { propertyName: timestampProperty, operator: 'LTE', value: String(endMs) },
        ]
      }],
      properties,
      limit: 100,
      ...(after ? { after } : {})
    };
    const res = await fetch(`https://api.hubapi.com/crm/v3/objects/${objectType}/search`, {
      method: 'POST', headers: HEADERS, body: JSON.stringify(body)
    });
    if (!res.ok) {
      console.log(`  ! ${objectType} search failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
      break;
    }
    const data = await res.json();
    all.push(...(data.results || []));
    after = data.paging?.next?.after;
  } while (after);
  return all;
}

async function fetchOwnerMap() {
  const map = {};
  let after;
  do {
    const url = new URL('https://api.hubapi.com/crm/v3/owners');
    url.searchParams.set('limit', '100');
    if (after) url.searchParams.set('after', after);
    const res = await fetch(url, { headers: HEADERS });
    const data = await res.json();
    for (const o of data.results || []) {
      map[o.id] = [o.firstName, o.lastName].filter(Boolean).join(' ') || o.email || `Owner ${o.id}`;
    }
    after = data.paging?.next?.after;
  } while (after);
  return map;
}

// Adds one to a rep's count for a given metric, on a given day.
// `bucket` ends up looking like: { "2026-05-14|12345": { date, ownerId, pipelineTouch: 3, ... } }
function bump(bucket, hsTimestamp, ownerId, metricKey) {
  const date = dayKey(hsTimestamp);
  if (!date || !ownerId) return;
  const key = `${date}|${ownerId}`;
  if (!bucket[key]) bucket[key] = { date, ownerId };
  bucket[key][metricKey] = (bucket[key][metricKey] || 0) + 1;
}

async function run() {
  console.log(`Fetching activity for ${startArg} → ${endArg} (grouped by day) ...\n`);

  const ownerMap = await fetchOwnerMap();
  console.log(`Loaded ${Object.keys(ownerMap).length} reps`);

  const buckets = {};

  console.log('Calls (→ pipeline touches)...');
  const calls = await searchAll('calls', ['hubspot_owner_id', 'hs_timestamp'], 'hs_timestamp');
  calls.forEach(c => bump(buckets, c.properties.hs_timestamp, c.properties.hubspot_owner_id, 'pipelineTouch'));
  console.log(`  ${calls.length} calls`);

  console.log('Emails (→ sent / received)...');
  const emails = await searchAll('emails', ['hubspot_owner_id', 'hs_email_direction', 'hs_timestamp'], 'hs_timestamp');
  emails.forEach(e => bump(buckets, e.properties.hs_timestamp, e.properties.hubspot_owner_id,
    e.properties.hs_email_direction === 'INCOMING_EMAIL' ? 'emailsReceived' : 'emailsSent'));
  console.log(`  ${emails.length} emails`);

  console.log('Tasks created...');
  const tasksCreated = await searchAll('tasks', ['hubspot_owner_id', 'hs_createdate'], 'hs_createdate');
  tasksCreated.forEach(t => bump(buckets, t.properties.hs_createdate, t.properties.hubspot_owner_id, 'tasksCreated'));
  console.log(`  ${tasksCreated.length} created`);

  console.log('Tasks completed...');
  const tasksInRange = await searchAll('tasks', ['hubspot_owner_id', 'hs_task_status', 'hs_timestamp'], 'hs_timestamp');
  const completed = tasksInRange.filter(t => t.properties.hs_task_status === 'COMPLETED');
  completed.forEach(t => bump(buckets, t.properties.hs_timestamp, t.properties.hubspot_owner_id, 'tasksCompleted'));
  console.log(`  ${completed.length} completed (of ${tasksInRange.length} due/scheduled in range)`);

  console.log('Communications (→ SMS sent / received)...');
  try {
    const comms = await searchAll('communications',
      ['hubspot_owner_id', 'hs_communication_channel_type', 'hs_communication_logged_from', 'hs_timestamp'], 'hs_timestamp');
    const sms = comms.filter(c => /sms/i.test(c.properties.hs_communication_channel_type || ''));
    sms.forEach(c => bump(buckets, c.properties.hs_timestamp, c.properties.hubspot_owner_id,
      c.properties.hs_communication_logged_from === 'CRM' ? 'smsSent' : 'smsReceived'));
    console.log(`  ${comms.length} communications, ${sms.length} SMS`);
  } catch (e) { console.log(`  (skipped: ${e.message})`); }

  console.log('Conversations (→ chats engaged)...');
  try {
    const url = new URL('https://api.hubapi.com/conversations/v3/conversations/threads');
    url.searchParams.set('limit', '100');
    const res = await fetch(url, { headers: HEADERS });
    if (res.ok) {
      const data = await res.json();
      console.log(`  ${(data.results || []).length} thread(s) seen (owner-level breakdown not yet wired up)`);
    } else {
      console.log(`  ! conversations fetch failed: ${res.status}`);
    }
  } catch (e) { console.log(`  (skipped: ${e.message})`); }

  // ── Turn the day+rep buckets into a flat list the webpage can sum however it likes ──
  const entries = Object.values(buckets).map(b => ({
    date: b.date,
    rep: ownerMap[b.ownerId] || `Owner ${b.ownerId}`,
    pipelineTouch:  b.pipelineTouch  || 0,
    emailsSent:     b.emailsSent     || 0,
    emailsReceived: b.emailsReceived || 0,
    smsSent:        b.smsSent        || 0,
    smsReceived:    b.smsReceived    || 0,
    chatsEngaged:   b.chatsEngaged   || 0,
    tasksCreated:   b.tasksCreated   || 0,
    tasksCompleted: b.tasksCompleted || 0,
  }));

  entries.sort((a, b) => a.date === b.date ? a.rep.localeCompare(b.rep) : a.date.localeCompare(b.date));

  const outDir = path.join(__dirname, 'data');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'activity.json');
  fs.writeFileSync(outFile, JSON.stringify(
    { start: startArg, end: endArg, generatedAt: new Date().toISOString(), entries }, null, 2
  ));

  // ── Quick same-range totals, just so we can eyeball that things look sane ──
  const totals = {};
  entries.forEach(e => {
    if (!totals[e.rep]) totals[e.rep] = { rep: e.rep, pipelineTouch: 0, emailsSent: 0, emailsReceived: 0, smsSent: 0, smsReceived: 0, chatsEngaged: 0, tasksCreated: 0, tasksCompleted: 0 };
    for (const k of Object.keys(totals[e.rep])) if (k !== 'rep') totals[e.rep][k] += e[k];
  });
  const summary = Object.values(totals).sort((a, b) => a.rep.localeCompare(b.rep));

  console.log(`\nDone — ${entries.length} day×rep entr${entries.length === 1 ? 'y' : 'ies'} across ${summary.length} rep(s) with activity.`);
  console.log(`Saved to data/${path.basename(outFile)}`);
  console.log('\nPreview (totals for the whole range):');
  summary.slice(0, 10).forEach(r => console.log(
    `  ${r.rep.padEnd(22)} touches=${r.pipelineTouch}  emails(sent/recv)=${r.emailsSent}/${r.emailsReceived}  ` +
    `sms(sent/recv)=${r.smsSent}/${r.smsReceived}  chats=${r.chatsEngaged}  tasks(created/done)=${r.tasksCreated}/${r.tasksCompleted}`
  ));
}

run().catch(err => console.error('Fatal error:', err));
