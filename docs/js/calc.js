// Money math and document totals. All amounts in dollars, rounded to cents.
import { db, alive, uid } from './db.js';

export const round2 = (n) => Math.round((Number(n) || 0) * 100 + Number.EPSILON) / 100;
export const money = (n) =>
  (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
export const num = (n) => (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

export const ITEM_KINDS = {
  labor: 'Labor',
  part: 'Part',
  travel: 'Travel',
  consumable: 'Consumables',
  misc: 'Other',
};
export const TRAVEL_UNITS = { flat: 'trip', mile: 'mi', hour: 'hr', none: '' };

export function lineAmount(it) {
  return round2((Number(it.qty) || 0) * (Number(it.rate) || 0));
}

export function newItem(kind, settings, rates, extra = {}) {
  const taxable = settings?.taxableDefaults?.[kind] ?? true;
  const base = { id: uid(), kind, desc: '', qty: 1, rate: 0, taxable };
  if (kind === 'labor') {
    const r = rates?.laborRates?.[0] || settings?.laborRates?.[0] || { name: 'Labor', rate: 0 };
    Object.assign(base, { desc: `Labor – ${r.name}`, qty: 1, rate: r.rate });
  } else if (kind === 'travel') {
    const mode = rates?.travelMode || 'flat';
    const label = { flat: 'Travel / service call', mile: 'Travel (miles)', hour: 'Travel time', none: 'Travel' }[mode];
    Object.assign(base, { desc: label, qty: mode === 'flat' || mode === 'none' ? 1 : 0, rate: rates?.travelRate || 0, unit: TRAVEL_UNITS[mode] });
  } else if (kind === 'consumable') {
    base.desc = 'Shop supplies / consumables';
  }
  return { ...base, ...extra };
}

export function copyItems(items) {
  return (items || []).map((it) => ({ ...it, id: uid() }));
}

// taxRate is a percent (6 = 6%).
export function totals(items, taxRate, lessPrior = 0) {
  let subtotal = 0, taxable = 0, laborHours = 0;
  for (const it of items || []) {
    const a = lineAmount(it);
    subtotal += a;
    if (it.taxable) taxable += a;
    if (it.kind === 'labor') laborHours += Number(it.qty) || 0;
  }
  subtotal = round2(subtotal);
  const tax = round2((taxable * (Number(taxRate) || 0)) / 100);
  const total = round2(subtotal + tax);
  const due = round2(total - (Number(lessPrior) || 0));
  return { subtotal, taxable: round2(taxable), tax, total, lessPrior: round2(lessPrior), due, laborHours };
}

export function docTotals(doc) {
  return totals(doc.items, doc.taxRate, doc.lessPrior ? doc.priorBilled || 0 : 0);
}

// ---------- Invoice balances ----------
export async function paymentsByInvoice() {
  const map = {};
  for (const p of alive(await db.payments.toArray())) {
    for (const a of p.allocations || []) {
      map[a.invoiceId] = round2((map[a.invoiceId] || 0) + (Number(a.amount) || 0));
    }
  }
  return map;
}

export function invoiceStatus(inv, paid) {
  if (inv.void) return 'Void';
  const due = docTotals(inv).due;
  if (paid >= due - 0.004 && due > 0) return 'Paid in Full';
  if (due <= 0) return 'Paid in Full';
  if (paid > 0) return 'Partially Paid';
  return 'Unpaid';
}

// Enriches invoices with paid, balance, and status.
export async function invoicesWithBalance() {
  const [invs, paid] = await Promise.all([db.invoices.toArray(), paymentsByInvoice()]);
  return alive(invs).map((inv) => {
    const t = docTotals(inv);
    const p = paid[inv.id] || 0;
    return { ...inv, t, paid: p, balance: inv.void ? 0 : round2(t.due - p), status: invoiceStatus(inv, p) };
  });
}

// Prior invoices in the same quote → job chain (for deducting deposits / progress bills).
export async function priorInvoices(inv) {
  const invs = alive(await db.invoices.toArray()).filter((x) => x.id !== inv.id && !x.void);
  let quoteId = inv.quoteId;
  if (inv.jobId && !quoteId) quoteId = (await db.jobs.get(inv.jobId))?.quoteId;
  return invs.filter((x) =>
    (inv.jobId && x.jobId === inv.jobId) || (quoteId && x.quoteId === quoteId))
    .filter((x) => (x.createdAt || '') < (inv.createdAt || '~'));
}

export function daysBetween(a, b) {
  const pa = new Date(a + 'T00:00:00'), pb = new Date(b + 'T00:00:00');
  return Math.round((pb - pa) / 86400000);
}
