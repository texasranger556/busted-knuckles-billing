import { useState } from 'preact/hooks';
import { db, alive, useLive, useSettings, today, machineShort, getSettings, changesSinceBackup, describeChanges, isInstalled, isPhone } from '../db.js';
import { startBackup } from './backup.js';
import { html, Header, Section, Loading, go, Pill, Segmented } from '../ui.js';
import { docTotals, money, num, round2, invoicesWithBalance, daysBetween } from '../calc.js';
import { fmtDate } from '../pdf.js';
import { startJobFromQuote, startJob } from './jobs.js';
import { startInvoice, shareInvoice } from './invoices.js';
import { startQuote } from './quotes.js';
import { recordPayment } from './payments.js';
import { downloadBlob } from '../share.js';

// Everything the to-do lists and reports need, in one pass.
export async function overview() {
  const [quotes, jobs, invoices, payments, customers, machines] = await Promise.all([
    db.quotes.toArray(), db.jobs.toArray(), invoicesWithBalance(), db.payments.toArray(), db.customers.toArray(), db.machines.toArray()]);
  const cm = Object.fromEntries(customers.map((c) => [c.id, c]));
  const mm = Object.fromEntries(machines.map((m) => [m.id, m]));
  const dec = (r) => ({ ...r, customer: cm[r.customerId], machine: mm[r.machineId] });
  const q = alive(quotes).map(dec), j = alive(jobs).map(dec), inv = invoices.map(dec);
  const quoteWithJob = new Set(j.map((x) => x.quoteId).filter(Boolean));
  const finalBilled = new Set(inv.filter((i) => !i.void && i.type === 'Final' && i.jobId).map((i) => i.jobId));
  return {
    quotes: q, jobs: j, invoices: inv, payments: alive(payments).map(dec),
    quotesNoJob: q.filter((x) => !quoteWithJob.has(x.id) && ['Draft', 'Sent', 'Accepted'].includes(x.status)),
    unbilledJobs: j.filter((x) => x.status === 'Complete' && !finalBilled.has(x.id)),
    unpaid: inv.filter((i) => !i.void && i.balance > 0.004).sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || '')),
  };
}

const overdueDays = (i) => (i.dueDate ? daysBetween(i.dueDate, today()) : 0);

export function UnpaidList({ list, limit }) {
  const shown = limit ? list.slice(0, limit) : list;
  return html`<ul class="list">${shown.map((i) => html`<li key=${i.id} class="todo">
    <button class="list-item" onClick=${() => go('/invoice/' + i.id)}>
      <strong>${i.number} · ${i.customer?.name || ''} <${Pill} status=${i.status} /></strong>
      <small>${money(i.balance)} due${overdueDays(i) > 0 ? html` · <span class="overdue">${overdueDays(i)} days overdue</span>` : i.dueDate ? ` · due ${fmtDate(i.dueDate)}` : ''}</small></button>
    <div class="todo-btns"><button class="btn small" onClick=${() => shareInvoice(i.id)}>Re-send</button><button class="btn small" onClick=${() => recordPayment({ invoiceId: i.id })}>Paid</button></div>
  </li>`)}</ul>`;
}
export function UnbilledList({ list, limit }) {
  const shown = limit ? list.slice(0, limit) : list;
  return html`<ul class="list">${shown.map((j) => html`<li key=${j.id} class="todo">
    <button class="list-item" onClick=${() => go('/job/' + j.id)}>
      <strong>${j.number} · ${j.customer?.name || ''}</strong>
      <small>Completed ${fmtDate(j.completedDate)} · ${machineShort(j.machine)} · ${money(docTotals(j).total)}</small></button>
    <div class="todo-btns"><button class="btn small primary" onClick=${() => startInvoice({ type: 'Final', jobId: j.id })}>Invoice</button></div>
  </li>`)}</ul>`;
}
export function QuotesNoJobList({ list, limit }) {
  const shown = limit ? list.slice(0, limit) : list;
  return html`<ul class="list">${shown.map((q) => html`<li key=${q.id} class="todo">
    <button class="list-item" onClick=${() => go('/quote/' + q.id)}>
      <strong>${q.number} · ${q.customer?.name || ''} <${Pill} status=${q.status} /></strong>
      <small>${fmtDate(q.date)} · ${machineShort(q.machine)} · ${money(docTotals(q).total)}</small></button>
    <div class="todo-btns"><button class="btn small" onClick=${() => startJobFromQuote(q.id)}>Start job</button></div>
  </li>`)}</ul>`;
}

export function HomePage() {
  const settings = useSettings();
  const o = useLive(overview, []);
  const changes = useLive(async () => changesSinceBackup((await getSettings()).lastBackupAt), []);
  if (!settings || !o || !changes) return html`<${Loading} />`;
  const days = settings.lastBackupAt ? daysBetween(settings.lastBackupAt.slice(0, 10), today()) : null;
  const remindDays = Number(settings.backupReminderDays);
  // Remind only when something changed, and the last backup is old enough (daily by default).
  // Money records (invoices/payments) never wait more than a day.
  const moneyChanged = changes.invoices + changes.payments > 0;
  const backupDue = remindDays > 0 && changes.total > 0 && (days === null || days >= remindDays || (moneyChanged && days >= 1));
  const inBrowserTab = isPhone() && !isInstalled();
  const owed = round2(o.unpaid.reduce((a, i) => a + i.balance, 0));
  const setupNeeded = !settings.phone && !settings.email;
  return html`<div class="page home">
    <header class="home-head">
      ${settings.logo ? html`<img src=${settings.logo} alt="" class="home-logo" />` : html`<span class="home-mark">🔧</span>`}
      <div><h1>${settings.name || 'Busted Knuckles Billing'}</h1>${owed > 0 && html`<p class="sub">${money(owed)} owed to you</p>`}</div>
      <button class="icon-btn" aria-label="Settings" onClick=${() => go('/settings')}>⚙️</button>
    </header>
    ${setupNeeded && html`<button class="banner info" onClick=${() => go('/settings')}>👋 Start here: add your business info, logo, and rates in Settings ›</button>`}
    ${inBrowserTab && html`<div class="banner danger">⚠️ <strong>You're in a browser tab, not the installed app.</strong> Data entered here is kept separately and can be erased by the browser.
      Install it: tap <strong>Share → Add to Home Screen</strong> (iPhone) or <strong>⋮ → Install app</strong> (Android), then always open it from the icon.</div>`}
    ${backupDue && html`<button class="banner warn" onClick=${() => startBackup('data')}>💾 <strong>Not backed up:</strong> ${describeChanges(changes)}${days === null ? ' (never backed up)' : days > 0 ? ` · last backup ${days} day${days > 1 ? 's' : ''} ago` : ''}<br /><u>Tap to back up now</u></button>`}

    <div class="big-btns">
      <button class="big-btn" onClick=${() => startQuote()}><span>📝</span>New Quote</button>
      <button class="big-btn" onClick=${() => startJob()}><span>🔧</span>Start Job</button>
      <button class="big-btn" onClick=${() => startInvoice()}><span>🧾</span>Invoice</button>
      <button class="big-btn" onClick=${() => recordPayment()}><span>💵</span>Record Payment</button>
    </div>

    ${o.unbilledJobs.length > 0 && html`<${Section} title=${`Ready to invoice (${o.unbilledJobs.length})`}>
      <${UnbilledList} list=${o.unbilledJobs} limit=${5} />
      ${o.unbilledJobs.length > 5 && html`<button class="link" onClick=${() => go('/reports/unbilled')}>See all</button>`}<//>`}
    ${o.unpaid.length > 0 && html`<${Section} title=${`Waiting on payment (${o.unpaid.length})`}>
      <${UnpaidList} list=${o.unpaid} limit=${5} />
      ${o.unpaid.length > 5 && html`<button class="link" onClick=${() => go('/reports/unpaid')}>See all</button>`}<//>`}
    ${o.quotesNoJob.length > 0 && html`<${Section} title=${`Open quotes (${o.quotesNoJob.length})`}>
      <${QuotesNoJobList} list=${o.quotesNoJob} limit=${5} />
      ${o.quotesNoJob.length > 5 && html`<button class="link" onClick=${() => go('/reports/quotes')}>See all</button>`}<//>`}
    ${o.unbilledJobs.length + o.unpaid.length + o.quotesNoJob.length === 0 && html`<p class="empty">All caught up. 👍</p>`}

    <nav class="nav-grid">
      <button onClick=${() => go('/customers')}>👥 Customers</button>
      <button onClick=${() => go('/quotes')}>📝 Quotes</button>
      <button onClick=${() => go('/jobs')}>🔧 Jobs</button>
      <button onClick=${() => go('/invoices')}>🧾 Invoices</button>
      <button onClick=${() => go('/payments')}>💵 Payments</button>
      <button onClick=${() => go('/reports')}>📊 Reports</button>
      <button onClick=${() => go('/backup')}>💾 Backup</button>
      <button onClick=${() => go('/settings')}>⚙️ Settings</button>
    </nav>
  </div>`;
}

// ---------- Reports ----------
const TABS = { totals: 'Totals', unpaid: 'Unpaid', unbilled: 'Unbilled jobs', quotes: 'Quotes w/o job' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function sumPeriod(o, inPeriod) {
  const quotes = o.quotes.filter((q) => inPeriod(q.date));
  const jobsDone = o.jobs.filter((j) => j.status === 'Complete' && inPeriod(j.completedDate));
  const invs = o.invoices.filter((i) => !i.void && inPeriod(i.date));
  const pays = o.payments.filter((p) => inPeriod(p.date));
  const sum = (arr, fn) => round2(arr.reduce((a, x) => a + fn(x), 0));
  return {
    quoteCount: quotes.length, quoted: sum(quotes, (q) => docTotals(q).total), quotedHours: sum(quotes, (q) => docTotals(q).laborHours),
    jobCount: jobsDone.length, jobTotal: sum(jobsDone, (j) => docTotals(j).total), jobHours: sum(jobsDone, (j) => docTotals(j).laborHours),
    notInvoiced: sum(o.unbilledJobs.filter((j) => inPeriod(j.completedDate)), (j) => docTotals(j).total),
    invoiced: sum(invs, (i) => i.t.due), unpaid: sum(invs, (i) => Math.max(0, i.balance)), paid: sum(pays, (p) => Number(p.amount) || 0),
  };
}

function Totals({ o }) {
  const [mode, setMode] = useState('Month');
  const [month, setMonth] = useState(today().slice(0, 7));
  const [year, setYear] = useState(today().slice(0, 4));
  const prefix = mode === 'Month' ? month : year;
  const r = sumPeriod(o, (d) => !!d && d.startsWith(prefix));
  const years = [...new Set([today().slice(0, 4), ...o.invoices.map((i) => i.date?.slice(0, 4)), ...o.quotes.map((q) => q.date?.slice(0, 4))].filter(Boolean))].sort().reverse();
  const row = (k, v, strong) => html`<div class=${'kv' + (strong ? ' strong' : '')}><span>${k}</span><span>${v}</span></div>`;
  return html`<div>
    <div class="pad row-btns left">
      <${Segmented} value=${mode} options=${['Month', 'Year']} onChange=${setMode} />
      ${mode === 'Month' ? html`<input type="month" value=${month} aria-label="Month" onInput=${(e) => e.currentTarget.value && setMonth(e.currentTarget.value)} />`
        : html`<select value=${year} aria-label="Year" onChange=${(e) => setYear(e.currentTarget.value)}>${years.map((y) => html`<option selected=${y === year}>${y}</option>`)}</select>`}
    </div>
    <${Section} title="Quoted">${row(`${r.quoteCount} quotes`, money(r.quoted), true)}${row('Labor hours quoted', num(r.quotedHours) + ' h')}<//>
    <${Section} title="Jobs completed">${row(`${r.jobCount} jobs`, money(r.jobTotal), true)}${row('Labor hours', num(r.jobHours) + ' h')}<//>
    <${Section} title="Cash flow">
      ${row('Completed jobs not invoiced', money(r.notInvoiced))}
      ${row('Invoiced', money(r.invoiced))}
      ${row('Still unpaid (of invoiced)', money(r.unpaid))}
      ${row('Payments received', money(r.paid), true)}
    <//>
    ${mode === 'Year' && html`<${Section} title=${`${year} by month`}>
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>Month</th><th>Quoted</th><th>Jobs</th><th>Invoiced</th><th>Paid</th></tr></thead>
        <tbody>${MONTHS.map((m, i) => {
          const p = `${year}-${String(i + 1).padStart(2, '0')}`;
          const x = sumPeriod(o, (d) => !!d && d.startsWith(p));
          return html`<tr><td>${m}</td><td>${money(x.quoted)}</td><td>${money(x.jobTotal)}</td><td>${money(x.invoiced)}</td><td>${money(x.paid)}</td></tr>`;
        })}</tbody>
      </table></div>
    <//>`}
    <${Section} title="Export for your accountant">
      <div class="row-btns left">
        <button class="btn small" onClick=${() => exportCsv(o, 'invoices', prefix)}>Invoices CSV</button>
        <button class="btn small" onClick=${() => exportCsv(o, 'payments', prefix)}>Payments CSV</button>
      </div>
      <p class="hint">Exports the selected ${mode.toLowerCase()} (${prefix}). Opens in Excel or Google Sheets.</p>
    <//>
  </div>`;
}

function exportCsv(o, kind, prefix) {
  const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  let rows;
  if (kind === 'invoices') {
    rows = [['Invoice', 'Type', 'Date', 'Due', 'Customer', 'Machine', 'Subtotal', 'Taxable', 'Sales tax', 'Total', 'Less prior', 'Amount billed', 'Paid', 'Balance', 'Status']];
    o.invoices.filter((i) => i.date?.startsWith(prefix)).forEach((i) => rows.push([i.number, i.type, i.date, i.dueDate, i.customer?.name, machineShort(i.machine),
      i.t.subtotal, i.t.taxable, i.t.tax, i.t.total, i.t.lessPrior, i.t.due, i.paid, i.balance, i.status]));
  } else {
    const invNum = Object.fromEntries(o.invoices.map((i) => [i.id, i.number]));
    rows = [['Payment', 'Date', 'Customer', 'Method', 'Reference', 'Amount', 'Invoices']];
    o.payments.filter((p) => p.date?.startsWith(prefix)).forEach((p) => rows.push([p.number, p.date, p.customer?.name, p.method, p.reference, p.amount,
      (p.allocations || []).map((a) => `${invNum[a.invoiceId]} (${a.amount})`).join('; ')]));
  }
  const csv = rows.map((r) => r.map(esc).join(',')).join('\r\n');
  downloadBlob(new Blob([csv], { type: 'text/csv' }), `BKB-${kind}-${prefix}.csv`);
}

export function ReportsPage({ tab = 'totals' }) {
  const o = useLive(overview, []);
  if (!o) return html`<${Loading} />`;
  const agingBuckets = () => {
    const b = { 'Not yet due': 0, '1–30 days': 0, '31–60 days': 0, '61–90 days': 0, '90+ days': 0 };
    for (const i of o.unpaid) {
      const d = overdueDays(i);
      b[d <= 0 ? 'Not yet due' : d <= 30 ? '1–30 days' : d <= 60 ? '31–60 days' : d <= 90 ? '61–90 days' : '90+ days'] += i.balance;
    }
    return b;
  };
  return html`<div class="page">
    <${Header} title="Reports" back="/" />
    <div class="tabs">${Object.entries(TABS).map(([k, v]) => html`<button class=${k === tab ? 'on' : ''} onClick=${() => go('/reports/' + k)}>${v}</button>`)}</div>
    ${tab === 'totals' && html`<${Totals} o=${o} />`}
    ${tab === 'unpaid' && html`<div>
      <${Section} title="Aging">${Object.entries(agingBuckets()).map(([k, v]) => html`<div class="kv"><span>${k}</span><span>${money(v)}</span></div>`)}<//>
      <${UnpaidList} list=${o.unpaid} />${o.unpaid.length === 0 && html`<p class="empty">Nothing owed. 👍</p>`}</div>`}
    ${tab === 'unbilled' && html`<div><${UnbilledList} list=${o.unbilledJobs} />${o.unbilledJobs.length === 0 && html`<p class="empty">No completed jobs waiting for an invoice.</p>`}</div>`}
    ${tab === 'quotes' && html`<div><${QuotesNoJobList} list=${o.quotesNoJob} />${o.quotesNoJob.length === 0 && html`<p class="empty">No open quotes.</p>`}</div>`}
  </div>`;
}
