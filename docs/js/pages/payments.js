import { useState, useEffect } from 'preact/hooks';
import { db, uid, alive, useLive, put, softDelete, getSettings, nextNumber, today, defaultContact } from '../db.js';
import { html, Header, Section, Field, Select, Loading, Missing, go, Pill, confirmDialog, toast, parseHash } from '../ui.js';
import { money, round2, invoicesWithBalance } from '../calc.js';
import { receiptPdf, fmtDate } from '../pdf.js';
import { openShare } from '../share.js';

export const METHODS = ['Cash', 'Check', 'Venmo', 'PayPal', 'Zelle', 'Card', 'Other'];

export function recordPayment({ invoiceId } = {}) {
  go('/payment/new' + (invoiceId ? '?invoice=' + invoiceId : ''));
}

export function PaymentsPage() {
  const data = useLive(async () => {
    const [pays, customers] = await Promise.all([db.payments.toArray(), db.customers.toArray()]);
    const cm = Object.fromEntries(customers.map((c) => [c.id, c]));
    return alive(pays).map((p) => ({ ...p, customer: cm[p.customerId] })).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.number || '').localeCompare(a.number || ''));
  }, []);
  if (!data) return html`<${Loading} />`;
  return html`<div class="page">
    <${Header} title="Payments" back="/" right=${html`<button class="btn small primary" onClick=${() => recordPayment()}>+ New</button>`} />
    <ul class="list">${data.map((p) => html`<li key=${p.id}><button class="list-item" onClick=${() => go('/payment/' + p.id)}>
      <strong>${money(p.amount)} · ${p.customer?.name || ''}</strong><small>${p.number} · ${fmtDate(p.date)} · ${p.method}${p.reference ? ' #' + p.reference : ''}</small></button></li>`)}</ul>
    ${data.length === 0 && html`<p class="empty">No payments recorded yet.</p>`}
  </div>`;
}

export async function sendReceipt(paymentId) {
  const [s, p] = await Promise.all([getSettings(), db.payments.get(paymentId)]);
  const customer = await db.customers.get(p.customerId);
  const invs = await invoicesWithBalance();
  const lines = await Promise.all((p.allocations || []).map(async (a) => {
    const inv = invs.find((i) => i.id === a.invoiceId);
    return { number: inv?.number || '', applied: a.amount, balanceAfter: inv?.balance ?? 0, machine: inv?.machineId ? await db.machines.get(inv.machineId) : null };
  }));
  const nums = lines.map((l) => l.number).join(', ');
  const subject = `${s.name} - Payment Receipt ${p.number} - Invoice ${nums}`;
  const contact = defaultContact(customer);
  const hi = contact?.name ? `Hi ${contact.name.split(' ')[0]},` : 'Hello,';
  const remaining = round2(lines.reduce((a, l) => a + l.balanceAfter, 0));
  const body = `${hi}\n\nThank you! I received your payment of ${money(p.amount)} (${p.method}${p.reference ? ' #' + p.reference : ''}) on ${fmtDate(p.date)} for invoice ${nums}.\nPayment reference: ${p.number}\n${remaining > 0 ? `Remaining balance: ${money(remaining)}` : 'Paid in full.'}\n\n${s.ownerName || s.name}\n${s.name}${s.phone ? '\n' + s.phone : ''}`;
  await openShare({
    title: 'Send receipt', subject, body, customer, filename: `Receipt ${p.number}.pdf`,
    makePdf: () => receiptPdf({ settings: s, payment: p, customer, lines }),
  });
}

export function PaymentPage({ id }) {
  const isNew = id === 'new';
  const { query } = parseHash();
  const [p, setP] = useState(null);
  const [missing, setMissing] = useState(false);
  const invs = useLive(invoicesWithBalance, []);
  const customers = useLive(() => db.customers.toArray(), []);

  useEffect(() => {
    if (!isNew) { db.payments.get(id).then((r) => (r && !r.deleted ? setP(r) : setMissing(true))); return; }
    setP({ id: uid(), date: today(), method: 'Check', reference: '', notes: '', customerId: null, allocations: [], _fromInvoice: query.invoice || null });
  }, [id]);
  useEffect(() => {
    // Pre-select the invoice we came from, defaulting to its full balance.
    if (p && p._fromInvoice && invs) {
      const inv = invs.find((i) => i.id === p._fromInvoice);
      if (inv) setP({ ...p, _fromInvoice: null, customerId: inv.customerId, allocations: [{ invoiceId: inv.id, amount: inv.balance }] });
    }
  }, [p?._fromInvoice, invs]);

  if (missing) return html`<${Missing} what="Payment" />`;
  if (!p || !invs || !customers) return html`<${Loading} />`;
  const cm = Object.fromEntries(customers.map((c) => [c.id, c]));
  const allocOf = (invId) => p.allocations.find((a) => a.invoiceId === invId);
  // Invoices this payment can apply to: open ones, plus any already on this payment (when editing).
  const prevApplied = (invId) => (isNew ? 0 : allocOf(invId)?.amount || 0);
  const candidates = invs.filter((i) => !i.void && (i.balance > 0.004 || allocOf(i.id)))
    .filter((i) => !p.customerId || i.customerId === p.customerId)
    .map((i) => ({ ...i, open: round2(i.balance + (isNew ? 0 : prevApplied(i.id))) }))
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const total = round2(p.allocations.reduce((a, x) => a + (Number(x.amount) || 0), 0));

  const toggle = (inv, on) => {
    let allocations = p.allocations.filter((a) => a.invoiceId !== inv.id);
    if (on) allocations = [...allocations, { invoiceId: inv.id, amount: inv.open }];
    setP({ ...p, customerId: allocations.length ? inv.customerId : (isNew ? null : p.customerId), allocations });
  };
  const setAmt = (invId, v) => setP({ ...p, allocations: p.allocations.map((a) => (a.invoiceId === invId ? { ...a, amount: v === '' ? '' : Number(v) } : a)) });
  const f = (k) => (v) => setP({ ...p, [k]: v });

  const save = async () => {
    const allocations = p.allocations.filter((a) => Number(a.amount) > 0).map((a) => ({ ...a, amount: round2(a.amount) }));
    if (!allocations.length) return toast('Select an invoice and enter an amount');
    for (const a of allocations) {
      const inv = candidates.find((c) => c.id === a.invoiceId);
      if (inv && a.amount > inv.open + 0.004 && !(await confirmDialog('Overpayment?', `${money(a.amount)} is more than the ${money(inv.open)} owed on ${inv.number}. Save anyway?`, 'Save'))) return;
    }
    const { _fromInvoice, ...rest } = p;
    const rec = await put('payments', { ...rest, allocations, amount: round2(allocations.reduce((s, a) => s + a.amount, 0)), number: p.number || await nextNumber('PMT') });
    toast('Payment saved');
    setP(rec);
    if (await confirmDialog('Payment saved', 'Send a receipt to the customer?', 'Send receipt')) await sendReceipt(rec.id);
    if (isNew) go('/payment/' + rec.id);
  };
  const del = async () => {
    if (await confirmDialog('Delete payment?', 'The invoices will show as unpaid again.', 'Delete', true)) { await softDelete('payments', id); go('/payments'); }
  };

  return html`<div class="page">
    <${Header} title=${isNew ? 'Record payment' : 'Payment ' + p.number} back=${true} />
    ${!isNew && html`<div class="action-bar"><button class="btn primary" onClick=${() => sendReceipt(id)}>📤 Send receipt</button></div>`}
    <${Section} title=${p.customerId ? `Invoices – ${cm[p.customerId]?.name || ''}` : 'Which invoice is being paid?'}>
      ${candidates.length === 0 && html`<p class="empty small">No unpaid invoices.</p>`}
      ${candidates.map((inv) => {
        const a = allocOf(inv.id);
        return html`<div class=${'pay-inv' + (a ? ' on' : '')} key=${inv.id}>
          <label class="toggle"><input type="checkbox" checked=${!!a} onChange=${(e) => toggle(inv, e.currentTarget.checked)} />
            <span><strong>${inv.number}</strong> ${!p.customerId ? `· ${cm[inv.customerId]?.name || ''} ` : ''}<${Pill} status=${inv.status} /><br />
            <small class="hint">${fmtDate(inv.date)} · ${inv.type} · owed ${money(inv.open)}</small></span></label>
          ${a && html`<span class="affix"><span class="pre">$</span><input type="number" inputmode="decimal" step="any" value=${a.amount} aria-label="Amount" onInput=${(e) => setAmt(inv.id, e.currentTarget.value)} /></span>`}
        </div>`;
      })}
      ${p.customerId && isNew && html`<button class="link" onClick=${() => setP({ ...p, customerId: null, allocations: [] })}>Show all customers</button>`}
    <//>
    <${Section} title="Payment">
      <div class="big-total">${money(total)}</div>
      <${Field} label="Date received" type="date" value=${p.date} onInput=${f('date')} />
      <${Select} label="Method" value=${p.method} options=${METHODS} onChange=${f('method')} />
      <${Field} label=${p.method === 'Check' ? 'Check #' : 'Reference / transaction #'} value=${p.reference} onInput=${f('reference')} />
      <${Field} label="Notes" multiline rows="2" value=${p.notes} onInput=${f('notes')} />
    <//>
    <div class="pad stack">
      <button class="btn primary block big" onClick=${save}>${isNew ? 'Save payment' : 'Save changes'}</button>
      ${!isNew && html`<button class="btn danger" onClick=${del}>Delete payment</button>`}
    </div>
  </div>`;
}
