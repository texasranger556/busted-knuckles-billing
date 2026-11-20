import { useState, useEffect } from 'preact/hooks';
import { db, uid, alive, useLive, put, softDelete, getSettings, useSettings, effectiveRates, nextNumber, today, machineShort } from '../db.js';
import { html, Header, Section, Field, Loading, Missing, useDoc, go, pickCustomer, pickMachine, CustomerMachine, LineItems, TotalsBlock, Segmented, Pill, confirmDialog, useRecord, toast, Gallery, openModal, Modal, SearchList } from '../ui.js';
import { newItem, copyItems, docTotals, money, num, round2 } from '../calc.js';
import { fmtDate } from '../pdf.js';
import { startInvoice } from './invoices.js';

export const JOB_STATUSES = ['Planned', 'In Progress', 'Waiting on Parts', 'Complete'];

async function openQuotesWithoutJob() {
  const [quotes, jobs, customers, machines] = await Promise.all([db.quotes.toArray(), db.jobs.toArray(), db.customers.toArray(), db.machines.toArray()]);
  const used = new Set(alive(jobs).map((j) => j.quoteId).filter(Boolean));
  const cm = Object.fromEntries(customers.map((c) => [c.id, c]));
  const mm = Object.fromEntries(machines.map((m) => [m.id, m]));
  return alive(quotes).filter((q) => !used.has(q.id) && !['Declined', 'Expired'].includes(q.status))
    .map((q) => ({ ...q, customer: cm[q.customerId], machine: mm[q.machineId] }))
    .sort((a, b) => (b.number || '').localeCompare(a.number || ''));
}

function StartJobModal({ close }) {
  const quotes = useLive(openQuotesWithoutJob, []);
  return html`<${Modal} title="Start a job" close=${close}>
    <button class="btn block" onClick=${() => close({ blank: true })}>New job without a quote</button>
    <h4>Or start from an open quote</h4>
    ${quotes ? html`<${SearchList} items=${quotes} filterText=${(q) => `${q.number} ${q.customer?.name} ${machineShort(q.machine)}`}
      render=${(q) => html`<strong>${q.number} · ${q.customer?.name || ''}</strong><small>${machineShort(q.machine)} · ${money(docTotals(q).total)}</small>`}
      onPick=${(q) => close({ quoteId: q.id })} empty="No open quotes." />` : html`<${Loading} />`}
  <//>`;
}

export async function startJob() {
  const choice = await openModal(StartJobModal);
  if (!choice) return;
  if (choice.quoteId) return startJobFromQuote(choice.quoteId);
  const customer = await pickCustomer();
  if (!customer) return;
  const machine = await pickMachine(customer.id);
  const s = await getSettings();
  const rates = effectiveRates(s, customer);
  const items = [newItem('labor', s, rates, { qty: 0 })];
  if (rates.travelMode !== 'none') items.push(newItem('travel', s, rates));
  const j = await put('jobs', {
    id: uid(), number: await nextNumber('J'), quoteId: null, customerId: customer.id, machineId: machine?.id || null,
    status: 'In Progress', startDate: today(), completedDate: '', symptoms: '', items, taxRate: rates.taxRate,
    laborLog: [], workPerformed: '', meterHours: machine?.hours || '', meterMiles: machine?.miles || '', poNumber: '',
  });
  go('/job/' + j.id);
}

export async function startJobFromQuote(quoteId) {
  const existing = alive(await db.jobs.where({ quoteId }).toArray())[0];
  if (existing) return go('/job/' + existing.id);
  const q = await db.quotes.get(quoteId);
  const machine = q.machineId ? await db.machines.get(q.machineId) : null;
  const j = await put('jobs', {
    id: uid(), number: await nextNumber('J'), quoteId, customerId: q.customerId, machineId: q.machineId,
    status: 'In Progress', startDate: today(), completedDate: '', symptoms: q.symptoms, items: copyItems(q.items), taxRate: q.taxRate,
    laborLog: [], workPerformed: '', meterHours: machine?.hours || '', meterMiles: machine?.miles || '', poNumber: q.poNumber || '',
  });
  if (['Draft', 'Sent'].includes(q.status)) await put('quotes', { ...q, status: 'Accepted' });
  go('/job/' + j.id);
}

export function JobsPage() {
  const [filter, setFilter] = useState('Active');
  const data = useLive(async () => {
    const [jobs, customers, machines] = await Promise.all([db.jobs.toArray(), db.customers.toArray(), db.machines.toArray()]);
    const cm = Object.fromEntries(customers.map((c) => [c.id, c]));
    const mm = Object.fromEntries(machines.map((m) => [m.id, m]));
    return alive(jobs).map((j) => ({ ...j, customer: cm[j.customerId], machine: mm[j.machineId] }))
      .sort((a, b) => (b.number || '').localeCompare(a.number || ''));
  }, []);
  if (!data) return html`<${Loading} />`;
  const shown = data.filter((j) => filter === 'All' || (filter === 'Active' ? j.status !== 'Complete' : j.status === 'Complete'));
  return html`<div class="page">
    <${Header} title="Jobs" back="/" right=${html`<button class="btn small primary" onClick=${startJob}>+ New</button>`} />
    <div class="pad"><${Segmented} value=${filter} options=${['Active', 'Complete', 'All']} onChange=${setFilter} /></div>
    <ul class="list">${shown.map((j) => html`<li key=${j.id}><button class="list-item" onClick=${() => go('/job/' + j.id)}>
      <strong>${j.number} · ${j.customer?.name || 'No customer'} <${Pill} status=${j.status} /></strong>
      <small>${fmtDate(j.startDate)} · ${machineShort(j.machine)} · ${money(docTotals(j).total)}</small></button></li>`)}</ul>
    ${shown.length === 0 && html`<p class="empty">No jobs here.</p>`}
  </div>`;
}

function Timer({ job, update }) {
  const [, tick] = useState(0);
  useEffect(() => { if (!job.timerStart) return; const t = setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(t); }, [job.timerStart]);
  if (!job.timerStart) {
    return html`<button class="btn small" onClick=${() => update({ timerStart: new Date().toISOString() })}>⏱ Start timer</button>`;
  }
  const hrs = (Date.now() - new Date(job.timerStart).getTime()) / 3600000;
  const stop = () => {
    const rounded = Math.max(0.25, Math.round(hrs * 4) / 4);
    update((d) => ({ timerStart: null, laborLog: [...(d.laborLog || []), { id: uid(), date: today(), hours: rounded, note: '' }] }));
    toast(`Logged ${rounded} h`);
  };
  return html`<span class="timer">⏱ Running ${num(Math.floor(hrs))}h ${Math.floor((hrs % 1) * 60)}m</span>
    <button class="btn small primary" onClick=${stop}>Stop & log</button>`;
}

export function JobPage({ id }) {
  const { doc: j, update, flush, missing } = useDoc('jobs', id);
  const settings = useSettings();
  const customer = useRecord('customers', j?.customerId);
  const machine = useRecord('machines', j?.machineId);
  const quote = useRecord('quotes', j?.quoteId);
  const invoices = useLive(async () => alive(await db.invoices.where({ jobId: id }).toArray()), [id]);
  if (missing) return html`<${Missing} what="Job" />`;
  if (!j || !settings || customer === undefined || machine === undefined) return html`<${Loading} />`;
  const rates = effectiveRates(settings, customer);
  const f = (k) => (v) => update({ [k]: v });
  const log = j.laborLog || [];
  const logged = round2(log.reduce((a, e) => a + (Number(e.hours) || 0), 0));
  const setLog = (lid, patch) => update({ laborLog: log.map((e) => (e.id === lid ? { ...e, ...patch } : e)) });

  const setStatus = (status) => {
    const patch = { status };
    if (status === 'Complete' && !j.completedDate) patch.completedDate = today();
    if (status !== 'Complete') patch.completedDate = '';
    update(patch);
  };
  const setMeter = (k, mk) => async (v) => {
    update({ [k]: v });
    if (machine && Number(v) > (Number(machine[mk]) || 0)) await put('machines', { ...machine, [mk]: v });
  };
  const useLogged = () => {
    const items = [...j.items];
    const i = items.findIndex((it) => it.kind === 'labor');
    if (i >= 0) items[i] = { ...items[i], qty: logged };
    else items.unshift(newItem('labor', settings, rates, { qty: logged }));
    update({ items });
    toast(`Labor set to ${logged} h`);
  };
  const invoiceNow = async () => {
    await flush();
    startInvoice({ type: j.status === 'Complete' ? 'Final' : 'Partial', jobId: id });
  };
  const del = async () => {
    if (await confirmDialog('Delete job?', `Delete job ${j.number}?`, 'Delete', true)) { await softDelete('jobs', id); go('/jobs'); }
  };

  return html`<div class="page">
    <${Header} title=${'Job ' + j.number} back="/jobs" />
    <div class="action-bar">
      <button class="btn primary" onClick=${invoiceNow}>🧾 ${j.status === 'Complete' ? 'Final invoice' : 'Partial invoice'}</button>
      ${quote && html`<button class="btn" onClick=${() => go('/quote/' + quote.id)}>Quote ${quote.number}</button>`}
    </div>

    <${Section} title="Status">
      <${Segmented} value=${j.status} options=${JOB_STATUSES} onChange=${setStatus} />
      <div class="grid2">
        <${Field} label="Started" type="date" value=${j.startDate} onInput=${f('startDate')} />
        <${Field} label="Completed" type="date" value=${j.completedDate} onInput=${f('completedDate')} />
      </div>
    <//>

    <${Section} title="Customer & machine">
      <${CustomerMachine} customer=${customer} machine=${machine}
        onCustomer=${(c) => update({ customerId: c.id, machineId: null, taxRate: effectiveRates(settings, c).taxRate })}
        onMachine=${(m) => update({ machineId: m.id, meterHours: m.hours || '', meterMiles: m.miles || '' })} />
      <div class="grid2">
        <${Field} label="Machine hours" inputmode="decimal" value=${j.meterHours} onInput=${setMeter('meterHours', 'hours')} />
        <${Field} label="Machine miles" inputmode="decimal" value=${j.meterMiles} onInput=${setMeter('meterMiles', 'miles')} />
      </div>
      <${Field} label="Customer PO #" value=${j.poNumber} onInput=${f('poNumber')} />
    <//>

    <${Section} title="Problem / symptoms" collapsible open=${!!j.symptoms}>
      <${Field} label="Reported problem" multiline value=${j.symptoms} onInput=${f('symptoms')} />
    <//>

    <${Section} title=${`Labor log (${num(logged)} h)`}>
      <div class="row-btns left"><${Timer} job=${j} update=${update} /></div>
      ${log.map((e) => html`<div class="log-row" key=${e.id}>
        <input type="date" value=${e.date} aria-label="Date" onInput=${(ev) => setLog(e.id, { date: ev.currentTarget.value })} />
        <input type="number" inputmode="decimal" step="0.25" value=${e.hours} aria-label="Hours" onInput=${(ev) => setLog(e.id, { hours: ev.currentTarget.value === '' ? '' : Number(ev.currentTarget.value) })} />
        <span class="suf">h</span>
        <button class="icon-btn" aria-label="Remove" onClick=${() => update({ laborLog: log.filter((x) => x.id !== e.id) })}>🗑</button>
        <input class="note" placeholder="What was done" value=${e.note} onInput=${(ev) => setLog(e.id, { note: ev.currentTarget.value })} />
      </div>`)}
      <div class="row-btns left">
        <button class="btn small" onClick=${() => update({ laborLog: [...log, { id: uid(), date: today(), hours: '', note: '' }] })}>+ Add day</button>
        ${logged > 0 && html`<button class="btn small" onClick=${useLogged}>Use ${num(logged)} h on labor line</button>`}
      </div>
    <//>

    <${Section} title="Labor, materials & charges">
      <${LineItems} items=${j.items} onChange=${f('items')} settings=${settings} rates=${rates} />
      <${TotalsBlock} items=${j.items} taxRate=${j.taxRate} taxExempt=${rates.taxExempt} />
    <//>

    <${Section} title="Work performed">
      <${Field} label="Details (printed on the invoice)" multiline rows="5" value=${j.workPerformed} onInput=${f('workPerformed')} hint="Tip: tap the microphone on the keyboard to dictate." />
    <//>

    <${Section} title="Photos & videos"><${Gallery} ownerType="job" ownerId=${id} allowVideo /><//>

    ${invoices && invoices.length > 0 && html`<${Section} title="Invoices">
      <ul class="list">${invoices.map((i) => html`<li key=${i.id}><button class="list-item" onClick=${() => go('/invoice/' + i.id)}>
        <strong>${i.number} · ${i.type} ${i.void ? html`<${Pill} status="Void" />` : ''}</strong><small>${fmtDate(i.date)} · ${money(docTotals(i).due)}</small></button></li>`)}</ul>
    <//>`}
    <div class="pad"><button class="btn danger" onClick=${del}>Delete job</button></div>
  </div>`;
}
