// Data layer: IndexedDB via Dexie. Everything stays on the device.
// Sync-ready conventions: UUID ids, updatedAt on every record, soft delete (deleted: true).
import Dexie, { liveQuery } from 'dexie';
import { useState, useEffect } from 'preact/hooks';

export const db = new Dexie('busted-knuckles-billing');
db.version(1).stores({
  meta: 'key',                                   // settings, counters
  customers: 'id, name, updatedAt',
  machines: 'id, customerId, serial, updatedAt',
  quotes: 'id, number, customerId, machineId, status, date, updatedAt',
  jobs: 'id, number, quoteId, customerId, machineId, status, updatedAt',
  invoices: 'id, number, type, jobId, quoteId, customerId, date, updatedAt',
  payments: 'id, number, customerId, date, updatedAt',
  media: 'id, [ownerType+ownerId], createdAt',
});

export const DATA_TABLES = ['meta', 'customers', 'machines', 'quotes', 'jobs', 'invoices', 'payments'];

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2));
export const now = () => new Date().toISOString();
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const addDays = (isoDate, days) => {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d + Number(days || 0));
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};

// ---------- Settings ----------
export const DEFAULT_SETTINGS = {
  name: 'Busted Knuckles',
  ownerName: '',
  phone: '',
  email: '',
  address: '',
  logo: null, // data URL (PNG), resized
  laborRates: [
    { name: 'Standard', rate: 95 },
    { name: 'After-hours / Weekend', rate: 140 },
  ],
  travelMode: 'none', // none | flat | mile | hour
  travelRate: 0,
  taxRate: 6, // PA state rate. Allegheny 7, Philadelphia 8.
  taxableDefaults: { labor: true, part: true, travel: true, consumable: true, misc: true },
  partsMarkupPct: 0,
  termsDays: 15,
  depositPct: 50,
  quoteValidDays: 30,
  quoteDisclaimer: 'This is an estimate. Actual charges may vary based on conditions found during repair. Additional work will be discussed before proceeding.',
  invoiceNotes: 'Thank you for your business!',
  paymentInstructions: 'Payment accepted by cash, check, Venmo, or PayPal.',
  backupReminderDays: 7,
  lastBackupAt: null,
};

export async function getSettings() {
  const row = await db.meta.get('settings');
  return { ...DEFAULT_SETTINGS, ...(row?.value || {}) };
}
export async function saveSettings(value) {
  await db.meta.put({ key: 'settings', value, updatedAt: now() });
}
export function useSettings() {
  return useLive(() => getSettings(), []);
}

// Customer-specific overrides on top of business defaults.
export function effectiveRates(settings, customer) {
  const o = customer?.rates || {};
  const pick = (k) => (o[k] !== undefined && o[k] !== null && o[k] !== '' ? o[k] : settings[k]);
  const laborRates = settings.laborRates.map((r, i) =>
    i === 0 && o.laborRate !== undefined && o.laborRate !== null && o.laborRate !== ''
      ? { ...r, rate: Number(o.laborRate) } : r);
  return {
    laborRates,
    travelMode: pick('travelMode'),
    travelRate: Number(pick('travelRate')) || 0,
    termsDays: Number(pick('termsDays')) || 0,
    taxRate: customer?.taxExempt ? 0 : Number(pick('taxRate')) || 0,
    taxExempt: !!customer?.taxExempt,
  };
}

// ---------- Document numbers: Q-2026-001 ----------
export async function nextNumber(prefix) {
  const year = new Date().getFullYear();
  const key = `counter-${prefix}-${year}`;
  return db.transaction('rw', db.meta, async () => {
    const row = await db.meta.get(key);
    const n = (row?.value || 0) + 1;
    await db.meta.put({ key, value: n, updatedAt: now() });
    return `${prefix}-${year}-${String(n).padStart(3, '0')}`;
  });
}

// ---------- Generic helpers ----------
export async function put(table, rec) {
  const r = { ...rec, updatedAt: now() };
  if (!r.createdAt) r.createdAt = r.updatedAt;
  await db[table].put(r);
  return r;
}
export async function softDelete(table, id) {
  const rec = await db[table].get(id);
  if (rec) await db[table].put({ ...rec, deleted: true, updatedAt: now() });
}
export const alive = (rows) => (rows || []).filter((r) => !r.deleted);
export async function all(table) {
  return alive(await db[table].toArray());
}

// Live query hook: re-renders when the underlying data changes.
export function useLive(fn, deps = []) {
  const [val, setVal] = useState(undefined);
  useEffect(() => {
    const sub = liveQuery(fn).subscribe({ next: setVal, error: (e) => console.error(e) });
    return () => sub.unsubscribe();
  }, deps);
  return val;
}

// Persistent storage: asks the browser not to evict data (important on iPhone).
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch (e) { /* not supported */ }
}

// ---------- Domain lookups ----------
export function machineLabel(m) {
  if (!m) return '';
  const mm = [m.year, m.make, m.model].filter(Boolean).join(' ');
  return [mm, m.serial ? `SN ${m.serial}` : '', m.unitNumber ? `Unit ${m.unitNumber}` : ''].filter(Boolean).join(' · ');
}
export function machineShort(m) {
  if (!m) return '';
  return [m.make, m.model, m.serial ? `SN ${m.serial}` : ''].filter(Boolean).join(' ');
}
export function defaultContact(c) {
  const list = c?.contacts || [];
  return list.find((x) => x.isDefault) || list[0] || null;
}
