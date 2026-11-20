import { useState } from 'preact/hooks';
import { db, uid, alive, useLive, put, softDelete, getSettings, useSettings, effectiveRates, nextNumber, today, addDays, defaultContact, machineShort } from '../db.js';
import { html, Header, Section, Field, Loading, Missing, useDoc, go, pickCustomer, pickMachine, CustomerMachine, LineItems, TotalsBlock, Segmented, Pill, confirmDialog, useRecord, toast, Gallery } from '../ui.js';
import { newItem, docTotals, money } from '../calc.js';
import { quotePdf, fmtDate } from '../pdf.js';
import { openShare } from '../share.js';
import { startJobFromQuote } from './jobs.js';
import { startInvoice } from './invoices.js';

export const QUOTE_STATUSES = ['Draft', 'Sent', 'Accepted', 'Declined', 'Expired'];

// Pick customer + machine (creating either if needed), then create the draft quote.
export async function startQuote({ customerId, machineId } = {}) {
  let customer = customerId ? await db.customers.get(customerId) : await pickCustomer();
  if (!customer) return;
  let machine = machineId ? await db.machines.get(machineId) : await pickMachine(customer.id);
  const s = await getSettings();
  const rates = effectiveRates(s, customer);
  const items = [newItem('labor', s, rates)];
  if (rates.travelMode !== 'none') items.push(newItem('travel', s, rates));
  const date = today();
  const q = await put('quotes', {
    id: uid(), number: await nextNumber('Q'), date, validUntil: addDays(date, s.quoteValidDays || 30),
    status: 'Draft', customerId: customer.id, machineId: machine?.id || null,
    symptoms: '', items, taxRate: rates.taxRate, notes: '', poNumber: '',
  });
  go('/quote/' + q.id);
}

export function QuotesPage() {
  const [filter, setFilter] = useState('Open');
  const data = useLive(async () => {
    const [quotes, customers, machines, jobs] = await Promise.all([db.quotes.toArray(), db.customers.toArray(), db.machines.toArray(), db.jobs.toArray()]);
    const cm = Object.fromEntries(customers.map((c) => [c.id, c]));
    const mm = Object.fromEntries(machines.map((m) => [m.id, m]));
    const withJob = new Set(alive(jobs).map((j) => j.quoteId).filter(Boolean));
    return alive(quotes).map((q) => ({ ...q, customer: cm[q.customerId], machine: mm[q.machineId], hasJob: withJob.has(q.id) }))
      .sort((a, b) => (b.number || '').localeCompare(a.number || ''));
  }, []);
  if (!data) return html`<${Loading} />`;
  const shown = data.filter((q) => filter === 'All' || (filter === 'Open' ? ['Draft', 'Sent', 'Accepted'].includes(q.status) && !q.hasJob : q.status === filter));
  return html`<div class="page">
    <${Header} title="Quotes" back="/" right=${html`<button class="btn small primary" onClick=${() => startQuote()}>+ New</button>`} />
    <div class="pad"><${Segmented} value=${filter} options=${['Open', 'Accepted', 'Declined', 'All']} onChange=${setFilter} /></div>
    <ul class="list">${shown.map((q) => html`<li key=${q.id}><button class="list-item" onClick=${() => go('/quote/' + q.id)}>
      <strong>${q.number} · ${q.customer?.name || 'No customer'} <${Pill} status=${q.status} />${q.hasJob ? html` <${Pill} status="Has job" />` : ''}</strong>
      <small>${fmtDate(q.date)} · ${machineShort(q.machine)} · ${money(docTotals(q).total)}</small></button></li>`)}</ul>
    ${shown.length === 0 && html`<p class="empty">No quotes here.</p>`}
  </div>`;
}

export function QuotePage({ id }) {
  const { doc: q, update, flush, missing } = useDoc('quotes', id);
  const settings = useSettings();
  const customer = useRecord('customers', q?.customerId);
  const machine = useRecord('machines', q?.machineId);
  const job = useLive(async () => alive(await db.jobs.where({ quoteId: id }).toArray())[0] || null, [id]);
  if (missing) return html`<${Missing} what="Quote" />`;
  if (!q || !settings || customer === undefined || machine === undefined) return html`<${Loading} />`;
  const rates = effectiveRates(settings, customer);
  const f = (k) => (v) => update({ [k]: v });

  const share = async () => {
    await flush();
    const contact = defaultContact(customer);
    const t = docTotals(q);
    const subject = `${settings.name} - Quote ${q.number} - Machine ${machineShort(machine) || 'N/A'}`;
    const hi = contact?.name ? `Hi ${contact.name.split(' ')[0]},` : 'Hello,';
    const body = `${hi}\n\nAttached is quote ${q.number}${machine ? ' for your ' + machineShort(machine) : ''}. Estimated total: ${money(t.total)}${q.validUntil ? ` (valid until ${fmtDate(q.validUntil)})` : ''}.\n\nPlease let me know if you'd like to proceed.\n\nThanks,\n${settings.ownerName || settings.name}\n${settings.name}${settings.phone ? '\n' + settings.phone : ''}`;
    const res = await openShare({
      title: 'Send quote', subject, body, customer, filename: `Quote ${q.number}.pdf`,
      makePdf: () => quotePdf({ settings, quote: q, customer, contact, machine }),
    });
    if (res && q.status === 'Draft') update({ status: 'Sent', sentAt: new Date().toISOString() });
  };
  const del = async () => {
    if (await confirmDialog('Delete quote?', `Delete quote ${q.number}?`, 'Delete', true)) { await softDelete('quotes', id); go('/quotes'); }
  };

  return html`<div class="page">
    <${Header} title=${'Quote ' + q.number} back="/quotes" />
    <div class="action-bar">
      <button class="btn primary" onClick=${share}>📤 Send</button>
      ${job ? html`<button class="btn" onClick=${() => go('/job/' + job.id)}>Open job ${job.number}</button>`
        : html`<button class="btn" onClick=${async () => { await flush(); startJobFromQuote(id); }}>🔧 Start job</button>`}
      <button class="btn" onClick=${async () => { await flush(); startInvoice({ type: 'Deposit', quoteId: id }); }}>Deposit invoice</button>
    </div>

    <${Section} title="Status"><${Segmented} value=${q.status} options=${QUOTE_STATUSES} onChange=${f('status')} /><//>

    <${Section} title="Customer & machine">
      <${CustomerMachine} customer=${customer} machine=${machine}
        onCustomer=${(c) => { update({ customerId: c.id, machineId: null, taxRate: effectiveRates(settings, c).taxRate }); toast('Customer changed – check the rates'); }}
        onMachine=${(m) => update({ machineId: m.id })} />
      <div class="grid2">
        <${Field} label="Quote date" type="date" value=${q.date} onInput=${f('date')} />
        <${Field} label="Valid until" type="date" value=${q.validUntil} onInput=${f('validUntil')} />
      </div>
      <${Field} label="Customer PO #" value=${q.poNumber} onInput=${f('poNumber')} />
    <//>

    <${Section} title="Problem / symptoms">
      <${Field} label="What's wrong?" multiline rows="4" value=${q.symptoms} onInput=${f('symptoms')} hint="Tip: tap the microphone on the keyboard to dictate." />
    <//>

    <${Section} title="Estimate">
      <${LineItems} items=${q.items} onChange=${f('items')} settings=${settings} rates=${rates} />
      <${TotalsBlock} items=${q.items} taxRate=${q.taxRate} taxExempt=${rates.taxExempt} />
    <//>

    <${Section} title="Notes (printed on quote)" collapsible open=${!!q.notes}>
      <${Field} label="Notes" multiline value=${q.notes} onInput=${f('notes')} />
    <//>
    <${Section} title="Photos" collapsible open=${false}><${Gallery} ownerType="quote" ownerId=${id} /><//>
    <div class="pad"><button class="btn danger" onClick=${del}>Delete quote</button></div>
  </div>`;
}

