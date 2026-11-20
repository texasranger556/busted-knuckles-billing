import { useState, useEffect } from 'preact/hooks';
import { db, uid, alive, useLive, put, getSettings, useSettings, effectiveRates, nextNumber, today, addDays, defaultContact, machineShort } from '../db.js';
import { html, Header, Section, Field, Toggle, Loading, Missing, useDoc, go, pickCustomer, pickMachine, CustomerMachine, LineItems, TotalsBlock, Segmented, Pill, confirmDialog, useRecord, openModal, Modal, SearchList } from '../ui.js';
import { newItem, copyItems, docTotals, money, round2, invoicesWithBalance, priorInvoices, daysBetween } from '../calc.js';
import { invoicePdf, fmtDate } from '../pdf.js';
import { openShare } from '../share.js';
import { recordPayment } from './payments.js';

export const termsText = (days) => (Number(days) > 0 ? `Net ${days}` : 'Due on receipt');

function PickSourceModal({ close, type: initialType }) {
  const [type, setType] = useState(initialType || 'Final');
  const data = useLive(async () => {
    const [quotes, jobs, customers, machines] = await Promise.all([db.quotes.toArray(), db.jobs.toArray(), db.customers.toArray(), db.machines.toArray()]);
    const cm = Object.fromEntries(customers.map((c) => [c.id, c]));
    const mm = Object.fromEntries(machines.map((m) => [m.id, m]));
    const dec = (r) => ({ ...r, customer: cm[r.customerId], machine: mm[r.machineId] });
    return { quotes: alive(quotes).filter((q) => q.status !== 'Declined').map(dec), jobs: alive(jobs).map(dec) };
  }, []);
  const list = !data ? null
    : type === 'Deposit' ? data.quotes
      : type === 'Partial' ? data.jobs.filter((j) => j.status !== 'Complete')
        : data.jobs.filter((j) => j.status === 'Complete');
  const what = { Deposit: 'quote', Partial: 'job in progress', Final: 'completed job' }[type];
  return html`<${Modal} title="New invoice" close=${close}>
    <${Segmented} value=${type} options=${['Deposit', 'Partial', 'Final']} onChange=${setType} />
    <p class="hint">${{ Deposit: 'Bill a deposit up front, based on a quote.', Partial: 'Bill for work done so far on a job that is still in progress.', Final: 'Bill a completed job. Deposits and partial invoices are subtracted automatically.' }[type]}</p>
    <h4>Choose a ${what}</h4>
    ${list ? html`<${SearchList} items=${[...list].sort((a, b) => (b.number || '').localeCompare(a.number || ''))}
      filterText=${(r) => `${r.number} ${r.customer?.name} ${machineShort(r.machine)}`}
      render=${(r) => html`<strong>${r.number} · ${r.customer?.name || ''}</strong><small>${machineShort(r.machine)} · ${money(docTotals(r).total)}</small>`}
      onPick=${(r) => close({ type, [type === 'Deposit' ? 'quoteId' : 'jobId']: r.id })} empty=${`No ${what}s.`} />` : html`<${Loading} />`}
    <button class="link" onClick=${() => close({ type, blank: true })}>Or start a blank invoice (no ${what})</button>
  <//>`;
}

export async function startInvoice(opts = {}) {
  let { type, quoteId, jobId, blank } = opts;
  if (!quoteId && !jobId) {
    const r = await openModal(PickSourceModal, { type });
    if (!r) return;
    ({ type, quoteId, jobId, blank } = r);
  }
  const s = await getSettings();
  const date = today();
  let inv = { id: uid(), type, date, items: [], notes: '', workPerformed: '', poNumber: '', lessPrior: type !== 'Deposit', priorBilled: 0, void: false };

  if (type === 'Deposit' && quoteId) {
    const q = await db.quotes.get(quoteId);
    const qt = docTotals(q);
    Object.assign(inv, {
      quoteId, jobId: null, customerId: q.customerId, machineId: q.machineId, taxRate: q.taxRate, poNumber: q.poNumber || '',
      items: [{ id: uid(), kind: 'misc', desc: `Deposit for Quote ${q.number} (${s.depositPct}% of ${money(qt.total)})`, qty: 1, rate: round2((qt.total * (Number(s.depositPct) || 0)) / 100), taxable: false }],
      refNumber: q.number,
    });
  } else if (jobId) {
    const j = await db.jobs.get(jobId);
    Object.assign(inv, {
      jobId, quoteId: j.quoteId || null, customerId: j.customerId, machineId: j.machineId, taxRate: j.taxRate,
      items: copyItems(j.items), workPerformed: j.workPerformed || '', meterHours: j.meterHours || '', poNumber: j.poNumber || '', refNumber: j.number,
    });
  } else {
    const c = await pickCustomer();
    if (!c) return;
    const m = await pickMachine(c.id);
    const rates = effectiveRates(s, c);
    Object.assign(inv, { quoteId: null, jobId: null, customerId: c.id, machineId: m?.id || null, taxRate: rates.taxRate, items: [newItem('labor', s, rates)], lessPrior: false });
  }
  const customer = await db.customers.get(inv.customerId);
  const rates = effectiveRates(s, customer);
  inv.dueDate = addDays(date, rates.termsDays);
  inv.terms = termsText(rates.termsDays);
  if (inv.lessPrior) inv.priorBilled = await priorBilledFor(inv);
  inv.number = await nextNumber('INV');
  inv = await put('invoices', inv);
  go('/invoice/' + inv.id);
}

async function priorDetails(inv) {
  const priors = await priorInvoices(inv);
  return priors.map((p) => ({ ...p, billed: docTotals(p).due }));
}
async function priorBilledFor(inv) {
  return round2((await priorDetails(inv)).reduce((a, p) => a + p.billed, 0));
}

export function InvoicesPage() {
  const [filter, setFilter] = useState('Unpaid');
  const data = useLive(async () => {
    const [invs, customers] = await Promise.all([invoicesWithBalance(), db.customers.toArray()]);
    const cm = Object.fromEntries(customers.map((c) => [c.id, c]));
    return invs.map((i) => ({ ...i, customer: cm[i.customerId] })).sort((a, b) => (b.number || '').localeCompare(a.number || ''));
  }, []);
  if (!data) return html`<${Loading} />`;
  const shown = data.filter((i) => filter === 'All' || (filter === 'Unpaid' ? i.balance > 0 && !i.void : filter === 'Paid' ? i.status === 'Paid in Full' : i.void));
  const owed = round2(shown.reduce((a, i) => a + Math.max(0, i.balance), 0));
  return html`<div class="page">
    <${Header} title="Invoices" back="/" right=${html`<button class="btn small primary" onClick=${() => startInvoice()}>+ New</button>`} />
    <div class="pad"><${Segmented} value=${filter} options=${['Unpaid', 'Paid', 'Void', 'All']} onChange=${setFilter} /></div>
    ${filter === 'Unpaid' && html`<p class="pad sub">Total owed: <strong>${money(owed)}</strong></p>`}
    <ul class="list">${shown.map((i) => html`<li key=${i.id}><button class="list-item" onClick=${() => go('/invoice/' + i.id)}>
      <strong>${i.number} · ${i.customer?.name || ''} <${Pill} status=${i.status} /></strong>
      <small>${i.type} · ${fmtDate(i.date)} · ${i.balance > 0 ? `${money(i.balance)} due` : money(i.t.due)}${i.balance > 0 && i.dueDate && daysBetween(i.dueDate, today()) > 0 ? ` · ${daysBetween(i.dueDate, today())} days overdue` : ''}</small></button></li>`)}</ul>
    ${shown.length === 0 && html`<p class="empty">No invoices here.</p>`}
  </div>`;
}

export async function shareInvoice(invId) {
  const [s, inv] = await Promise.all([getSettings(), db.invoices.get(invId)]);
  const [customer, machine, all] = await Promise.all([db.customers.get(inv.customerId), inv.machineId ? db.machines.get(inv.machineId) : null, invoicesWithBalance()]);
  const me = all.find((x) => x.id === invId);
  const priors = inv.lessPrior ? await priorDetails(inv) : [];
  const contact = defaultContact(customer);
  const balance = me ? me.balance : docTotals(inv).due;
  const subject = `${s.name} - Invoice ${inv.number} - Machine ${machineShort(machine) || 'N/A'}`;
  const hi = contact?.name ? `Hi ${contact.name.split(' ')[0]},` : 'Hello,';
  const body = `${hi}\n\nAttached is invoice ${inv.number}${machine ? ' for work on your ' + machineShort(machine) : ''}. Amount due: ${money(balance)}${inv.dueDate ? `, due ${fmtDate(inv.dueDate)}` : ''}.\n\n${s.paymentInstructions || ''}\n\nThank you,\n${s.ownerName || s.name}\n${s.name}${s.phone ? '\n' + s.phone : ''}`;
  const res = await openShare({
    title: 'Send invoice', subject, body, customer, filename: `Invoice ${inv.number}.pdf`,
    makePdf: () => invoicePdf({ settings: s, invoice: inv, customer, contact, machine, priors, paid: me?.paid || 0 }),
  });
  if (res && !inv.sentAt) await put('invoices', { ...(await db.invoices.get(invId)), sentAt: new Date().toISOString() });
}

export function InvoicePage({ id }) {
  const { doc: inv, update, flush, missing } = useDoc('invoices', id);
  const settings = useSettings();
  const customer = useRecord('customers', inv?.customerId);
  const machine = useRecord('machines', inv?.machineId);
  const job = useRecord('jobs', inv?.jobId);
  const quote = useRecord('quotes', inv?.quoteId);
  const priors = useLive(async () => (inv ? priorDetails(inv) : []), [inv?.id, inv?.jobId, inv?.quoteId]);
  const pays = useLive(async () => alive(await db.payments.toArray()).filter((p) => (p.allocations || []).some((a) => a.invoiceId === id)), [id]);
  const priorSum = priors ? round2(priors.reduce((a, p) => a + p.billed, 0)) : null;
  useEffect(() => {
    if (inv && priorSum !== null && inv.lessPrior && !inv.void && priorSum !== inv.priorBilled) update({ priorBilled: priorSum });
  }, [priorSum, inv?.lessPrior]);
  if (missing) return html`<${Missing} what="Invoice" />`;
  if (!inv || !settings || customer === undefined || machine === undefined) return html`<${Loading} />`;
  const rates = effectiveRates(settings, customer);
  const f = (k) => (v) => update({ [k]: v });
  const t = docTotals(inv);
  const paid = round2((pays || []).reduce((a, p) => a + (p.allocations.find((x) => x.invoiceId === id)?.amount || 0), 0));
  const balance = inv.void ? 0 : round2(t.due - paid);
  const status = inv.void ? 'Void' : balance <= 0.004 ? 'Paid in Full' : paid > 0 ? 'Partially Paid' : 'Unpaid';

  const voidIt = async () => {
    if (inv.void) { update({ void: false }); return; }
    if (paid > 0) return confirmDialog('Has payments', 'Delete the payments on this invoice before voiding it.', 'OK');
    if (await confirmDialog('Void invoice?', `Invoice ${inv.number} will be kept for your records but marked void and not counted as owed.`, 'Void', true)) update({ void: true });
  };

  return html`<div class="page">
    <${Header} title=${'Invoice ' + inv.number} back="/invoices" />
    <div class="status-banner"><${Pill} status=${status} /><span>${inv.type} invoice</span><strong>${money(balance)} due</strong></div>
    <div class="action-bar">
      <button class="btn primary" disabled=${inv.void} onClick=${async () => { await flush(); shareInvoice(id); }}>📤 Send</button>
      ${balance > 0 && html`<button class="btn" onClick=${async () => { await flush(); recordPayment({ invoiceId: id }); }}>💵 Record payment</button>`}
      ${job && html`<button class="btn" onClick=${() => go('/job/' + job.id)}>Job ${job.number}</button>`}
      ${quote && !job && html`<button class="btn" onClick=${() => go('/quote/' + quote.id)}>Quote ${quote.number}</button>`}
    </div>

    <${Section} title="Details">
      <${Segmented} value=${inv.type} options=${['Deposit', 'Partial', 'Final']} onChange=${f('type')} />
      <${CustomerMachine} customer=${customer} machine=${machine}
        onCustomer=${(c) => update({ customerId: c.id, machineId: null, taxRate: effectiveRates(settings, c).taxRate })}
        onMachine=${(m) => update({ machineId: m.id })} />
      <div class="grid2">
        <${Field} label="Invoice date" type="date" value=${inv.date} onInput=${f('date')} />
        <${Field} label="Due date" type="date" value=${inv.dueDate} onInput=${f('dueDate')} />
      </div>
      <div class="grid2">
        <${Field} label="Terms" value=${inv.terms} onInput=${f('terms')} />
        <${Field} label="Customer PO #" value=${inv.poNumber} onInput=${f('poNumber')} />
      </div>
    <//>

    ${inv.type !== 'Deposit' && html`<${Section} title="Work performed">
      <${Field} label="Printed on the invoice" multiline rows="4" value=${inv.workPerformed} onInput=${f('workPerformed')} />
    <//>`}

    <${Section} title="Charges">
      <${LineItems} items=${inv.items} onChange=${f('items')} settings=${settings} rates=${rates} />
      ${priors && priors.length > 0 && html`<${Toggle} label=${`Subtract previously billed (${money(priorSum)})`} checked=${inv.lessPrior}
        onChange=${(c) => update({ lessPrior: c, priorBilled: c ? priorSum : 0 })}
        hint=${priors.map((p) => `${p.number} ${p.type} ${money(p.billed)}`).join(' · ')} />`}
      <${TotalsBlock} items=${inv.items} taxRate=${inv.taxRate} taxExempt=${rates.taxExempt} lessPrior=${inv.lessPrior ? inv.priorBilled : 0} priorLabel="Less previously billed" />
    <//>

    <${Section} title=${`Payments (${money(paid)})`}>
      ${(pays || []).length === 0 && html`<p class="empty small">No payments yet.</p>`}
      <ul class="list">${(pays || []).map((p) => html`<li key=${p.id}><button class="list-item" onClick=${() => go('/payment/' + p.id)}>
        <strong>${p.number} · ${money(p.allocations.find((x) => x.invoiceId === id)?.amount)}</strong><small>${fmtDate(p.date)} · ${p.method}${p.reference ? ' #' + p.reference : ''}</small></button></li>`)}</ul>
    <//>

    <${Section} title="Notes (printed on invoice)" collapsible open=${!!inv.notes}>
      <${Field} label="Notes" multiline value=${inv.notes} placeholder=${settings.invoiceNotes} onInput=${f('notes')} />
    <//>
    <div class="pad"><button class="btn danger" onClick=${voidIt}>${inv.void ? 'Un-void invoice' : 'Void invoice'}</button></div>
  </div>`;
}
