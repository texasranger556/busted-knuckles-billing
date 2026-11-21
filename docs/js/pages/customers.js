import { db, uid, alive, useLive, softDelete, useSettings, machineLabel } from '../db.js';
import { html, Header, Section, Field, NumField, Select, Toggle, Loading, Missing, SearchList, useDoc, go, newCustomer, newMachine, MachineFields, Gallery, confirmDialog, Pill, toast, PhoneContactButton } from '../ui.js';
import { money } from '../calc.js';
import { fmtDate } from '../pdf.js';
import { TRAVEL_MODES } from './settings.js';
import { startQuote } from './quotes.js';

export function CustomersPage() {
  const customers = useLive(() => db.customers.orderBy('name').toArray(), []);
  const machines = useLive(() => db.machines.toArray(), []);
  if (!customers || !machines) return html`<${Loading} />`;
  const count = {};
  alive(machines).forEach((m) => { count[m.customerId] = (count[m.customerId] || 0) + 1; });
  const add = async () => { const c = await newCustomer(); if (c) go('/customer/' + c.id); };
  return html`<div class="page">
    <${Header} title="Customers" back="/" right=${html`<button class="btn small primary" onClick=${add}>+ New</button>`} />
    <${SearchList} items=${alive(customers)} filterText=${(c) => [c.name, c.address, ...(c.contacts || []).map((x) => x.name)].join(' ')}
      render=${(c) => html`<strong>${c.name}</strong><small>${[c.address?.split('\n')[0], `${count[c.id] || 0} machine${count[c.id] === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</small>`}
      onPick=${(c) => go('/customer/' + c.id)} empty="No customers yet. Tap + New to add one." />
  </div>`;
}

export function CustomerPage({ id }) {
  const { doc: c, update, missing } = useDoc('customers', id);
  const settings = useSettings();
  const machines = useLive(() => db.machines.where({ customerId: id }).toArray(), [id]);
  if (missing) return html`<${Missing} what="Customer" />`;
  if (!c || !settings) return html`<${Loading} />`;
  const f = (k) => (v) => update({ [k]: v });
  const contacts = c.contacts || [];
  const setContact = (cid, patch) => update({ contacts: contacts.map((x) => (x.id === cid ? { ...x, ...patch } : x)) });
  const makeDefault = (cid) => update({ contacts: contacts.map((x) => ({ ...x, isDefault: x.id === cid })) });
  const importContacts = (list) => {
    const hadDefault = contacts.some((x) => x.isDefault);
    const added = list.map((p, i) => ({ id: uid(), name: p.name || p.org || '', role: p.role, phone: p.phone, email: p.email, isDefault: !hadDefault && i === 0 }));
    const patch = { contacts: [...contacts, ...added] };
    const withAddr = list.find((p) => p.address);
    if (!c.address && withAddr) patch.address = withAddr.address;
    update(patch);
    toast(`Added ${added.length} contact${added.length > 1 ? 's' : ''}`);
  };
  const addContact = () => update({ contacts: [...contacts, { id: uid(), name: '', role: '', phone: '', email: '', isDefault: contacts.length === 0 }] });
  const delContact = async (cid) => {
    if (!(await confirmDialog('Remove contact?', 'This contact will be removed from the customer.', 'Remove', true))) return;
    let next = contacts.filter((x) => x.id !== cid);
    if (next.length && !next.some((x) => x.isDefault)) next = next.map((x, i) => ({ ...x, isDefault: i === 0 }));
    update({ contacts: next });
  };
  const rates = c.rates || {};
  const setRate = (k) => (v) => update({ rates: { ...rates, [k]: v } });
  const del = async () => {
    if (await confirmDialog('Delete customer?', `Delete ${c.name}? Their quotes, jobs, and invoices are kept.`, 'Delete', true)) {
      await softDelete('customers', id); go('/customers');
    }
  };
  const addMachine = async () => { const m = await newMachine(id); if (m) toast('Machine added'); };

  return html`<div class="page">
    <${Header} title=${c.name || 'Customer'} back="/customers" />
    <div class="action-bar">
      <button class="btn primary" onClick=${() => startQuote({ customerId: id })}>New quote</button>
      ${c.phone && html`<a class="btn" href=${'tel:' + c.phone}>📞 Call</a>`}
    </div>

    <${Section} title="Business">
      <${Field} label="Business name" value=${c.name} onInput=${f('name')} />
      <${Field} label="Main phone" type="tel" value=${c.phone} onInput=${f('phone')} />
      <${Field} label="Billing address" multiline rows="3" value=${c.address} onInput=${f('address')} />
      <${Field} label="Job site / yard location" multiline rows="2" value=${c.siteAddress} onInput=${f('siteAddress')} hint="If different from the billing address." />
      <${Field} label="Notes" multiline value=${c.notes} onInput=${f('notes')} />
    <//>

    <${Section} title="Contacts" right=${html`<button class="btn small" onClick=${addContact}>+ Add</button>`}>
      <div class="row-btns left"><${PhoneContactButton} multiple onContacts=${importContacts} /></div>
      ${contacts.length === 0 && html`<p class="empty small">No contacts yet.</p>`}
      ${contacts.map((x) => html`<div class="contact" key=${x.id}>
        <div class="contact-head">
          <button class=${'star' + (x.isDefault ? ' on' : '')} onClick=${() => makeDefault(x.id)} aria-label="Make default contact">${x.isDefault ? '★ Default' : '☆ Make default'}</button>
          <span class="spacer"></span>
          ${x.phone && html`<a class="icon-btn" href=${'tel:' + x.phone} aria-label="Call">📞</a>`}
          <button class="icon-btn" onClick=${() => delContact(x.id)} aria-label="Remove contact">🗑</button>
        </div>
        <div class="grid2">
          <${Field} label="Name" value=${x.name} onInput=${(v) => setContact(x.id, { name: v })} />
          <${Field} label="Role" value=${x.role} placeholder="Maintenance, Accounting…" onInput=${(v) => setContact(x.id, { role: v })} />
        </div>
        <div class="grid2">
          <${Field} label="Mobile" type="tel" value=${x.phone} onInput=${(v) => setContact(x.id, { phone: v })} />
          <${Field} label="Email" type="email" value=${x.email} onInput=${(v) => setContact(x.id, { email: v })} />
        </div>
      </div>`)}
    <//>

    <${Section} title=${`Machines (${alive(machines).length})`} right=${html`<button class="btn small" onClick=${addMachine}>+ Add</button>`}>
      <ul class="list">
        ${alive(machines).map((m) => html`<li key=${m.id}><button class="list-item" onClick=${() => go('/machine/' + m.id)}>
          <strong>${[m.make, m.model].filter(Boolean).join(' ') || 'Machine'}</strong><small>${machineLabel(m)}</small></button></li>`)}
      </ul>
      ${machines && alive(machines).length === 0 && html`<p class="empty small">No machines yet.</p>`}
    <//>

    <${Section} title="Rates & tax for this customer" collapsible open=${!!(c.taxExempt || Object.values(rates).some((v) => v !== '' && v != null))}>
      <p class="hint">Leave blank to use your defaults (shown in grey).</p>
      <${NumField} label="Labor rate" prefix="$" suffix="/h" value=${rates.laborRate} placeholder=${settings.laborRates[0]?.rate} onInput=${setRate('laborRate')} />
      <${Select} label="Travel" value=${rates.travelMode || ''} onChange=${setRate('travelMode')}
        options=${[{ value: '', label: `Default (${TRAVEL_MODES.find((t) => t.value === settings.travelMode)?.label})` }, ...TRAVEL_MODES]} />
      <${NumField} label="Travel rate" prefix="$" value=${rates.travelRate} placeholder=${settings.travelRate} onInput=${setRate('travelRate')} />
      <${NumField} label="Payment due (days)" value=${rates.termsDays} placeholder=${settings.termsDays} onInput=${setRate('termsDays')} />
      <${Toggle} label="Tax exempt" checked=${c.taxExempt} onChange=${f('taxExempt')} hint="E.g. farm equipment, with a PA exemption certificate (REV-1220) on file." />
      ${c.taxExempt && html`<${Field} label="Exemption certificate #" value=${c.exemptCert} onInput=${f('exemptCert')} />`}
    <//>

    <${CustomerHistory} customerId=${id} />
    <div class="pad"><button class="btn danger" onClick=${del}>Delete customer</button></div>
  </div>`;
}

function CustomerHistory({ customerId }) {
  const data = useLive(async () => ({
    quotes: alive(await db.quotes.where({ customerId }).toArray()),
    jobs: alive(await db.jobs.where({ customerId }).toArray()),
    invoices: alive(await db.invoices.where({ customerId }).toArray()),
  }), [customerId]);
  if (!data) return null;
  const rows = [
    ...data.quotes.map((q) => ({ id: q.id, date: q.date, label: `Quote ${q.number}`, status: q.status, href: '/quote/' + q.id })),
    ...data.jobs.map((j) => ({ id: j.id, date: j.startDate || j.createdAt?.slice(0, 10), label: `Job ${j.number}`, status: j.status, href: '/job/' + j.id })),
    ...data.invoices.map((i) => ({ id: i.id, date: i.date, label: `Invoice ${i.number}`, status: i.void ? 'Void' : i.type, href: '/invoice/' + i.id })),
  ].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  if (!rows.length) return null;
  return html`<${Section} title="History" collapsible open=${false}>
    <ul class="list">${rows.map((r) => html`<li key=${r.id}><button class="list-item" onClick=${() => go(r.href)}>
      <strong>${r.label} <${Pill} status=${r.status} /></strong><small>${fmtDate(r.date)}</small></button></li>`)}</ul>
  <//>`;
}

export function MachinePage({ id }) {
  const { doc: m, update, missing } = useDoc('machines', id);
  const customer = useLive(() => (m?.customerId ? db.customers.get(m.customerId) : null), [m?.customerId]);
  const history = useLive(async () => alive(await db.jobs.where({ machineId: id }).toArray())
    .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || '')), [id]);
  if (missing) return html`<${Missing} what="Machine" />`;
  if (!m) return html`<${Loading} />`;
  const del = async () => {
    if (await confirmDialog('Delete machine?', 'Past jobs and invoices are kept.', 'Delete', true)) {
      await softDelete('machines', id); go(m.customerId ? '/customer/' + m.customerId : '/customers');
    }
  };
  return html`<div class="page">
    <${Header} title=${[m.make, m.model].filter(Boolean).join(' ') || 'Machine'} back=${m.customerId ? '/customer/' + m.customerId : true} />
    ${customer && html`<p class="pad sub">Owned by <a href=${'#/customer/' + customer.id}>${customer.name}</a></p>`}
    <div class="action-bar">
      <button class="btn primary" onClick=${() => startQuote({ customerId: m.customerId, machineId: id })}>New quote for this machine</button>
    </div>
    <${Section} title="Details"><${MachineFields} m=${m} set=${update} /><//>
    <${Section} title="Photos"><${Gallery} ownerType="machine" ownerId=${id} /><//>
    <${Section} title="Service history">
      ${history && history.length === 0 && html`<p class="empty small">No jobs yet.</p>`}
      <ul class="list">${(history || []).map((j) => html`<li key=${j.id}><button class="list-item" onClick=${() => go('/job/' + j.id)}>
        <strong>${fmtDate(j.startDate)} · Job ${j.number} <${Pill} status=${j.status} /></strong>
        <small>${[j.meterHours && `${j.meterHours} h`, (j.workPerformed || j.symptoms || '').slice(0, 90)].filter(Boolean).join(' · ')}</small></button></li>`)}</ul>
    <//>
    <div class="pad"><button class="btn danger" onClick=${del}>Delete machine</button></div>
  </div>`;
}
