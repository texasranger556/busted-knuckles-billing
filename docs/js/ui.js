// Shared UI components (Preact + htm, no build step).
import { h, render } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import htm from 'htm';
import { db, put, uid, now, useLive, alive, machineLabel } from './db.js';
import { ITEM_KINDS, lineAmount, money, num, newItem, totals as calcTotals } from './calc.js';
import { canPickContacts, pickPhoneContacts, readVCardFiles } from './contacts.js';

export const html = htm.bind(h);

// ---------- Navigation ----------
export const go = (path) => { location.hash = '#' + path; };
export function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  return { parts: path.split('/').filter(Boolean), query: Object.fromEntries(new URLSearchParams(qs || '')) };
}

// ---------- Toasts & dialogs ----------
let toastHost;
export function toast(msg, ms = 2200) {
  if (!toastHost) { toastHost = document.createElement('div'); toastHost.className = 'toast-host'; document.body.appendChild(toastHost); }
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg;
  toastHost.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// Mount a modal component; resolves with whatever the modal passes to close().
export function openModal(Comp, props = {}) {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    document.body.classList.add('modal-open');
    const close = (val) => {
      render(null, host); host.remove();
      if (!document.querySelector('.modal-backdrop')) document.body.classList.remove('modal-open');
      resolve(val);
    };
    render(html`<${Comp} ...${props} close=${close} />`, host);
  });
}

export function Modal({ title, close, children, wide }) {
  return html`<div class="modal-backdrop" onClick=${(e) => e.target === e.currentTarget && close(null)}>
    <div class=${'modal' + (wide ? ' wide' : '')} role="dialog" aria-label=${title}>
      <div class="modal-head"><h2>${title}</h2><button class="icon-btn" aria-label="Close" onClick=${() => close(null)}>✕</button></div>
      <div class="modal-body">${children}</div>
    </div>
  </div>`;
}

function ConfirmModal({ close, title, message, okText, danger }) {
  return html`<${Modal} title=${title} close=${close}>
    <p>${message}</p>
    <div class="row-btns">
      <button class="btn" onClick=${() => close(false)}>Cancel</button>
      <button class=${'btn ' + (danger ? 'danger' : 'primary')} onClick=${() => close(true)}>${okText}</button>
    </div>
  <//>`;
}
export const confirmDialog = (title, message, okText = 'OK', danger = false) =>
  openModal(ConfirmModal, { title, message, okText, danger }).then(Boolean);

// ---------- Autosaving document editor ----------
// Loads a record once, keeps a local copy, and writes it back shortly after each change.
export function useDoc(table, id) {
  const [doc, setDoc] = useState(null);
  const [missing, setMissing] = useState(false);
  const pending = useRef(null);
  const timer = useRef(null);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (pending.current) { const d = pending.current; pending.current = null; await put(table, d); }
  }, [table]);

  useEffect(() => {
    let live = true;
    setDoc(null); setMissing(false);
    db[table].get(id).then((r) => { if (!live) return; if (r && !r.deleted) setDoc(r); else setMissing(true); });
    const onHide = () => flush();
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      live = false; flush();
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [table, id]);

  const update = useCallback((patch) => {
    setDoc((d) => {
      const next = { ...d, ...(typeof patch === 'function' ? patch(d) : patch) };
      pending.current = next;
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, 500);
      return next;
    });
  }, [flush]);

  return { doc, update, flush, missing };
}

// ---------- Layout ----------
export function Header({ title, back, right }) {
  return html`<header class="page-head">
    ${back !== false ? html`<button class="icon-btn back" aria-label="Back" onClick=${() => (typeof back === 'string' ? go(back) : history.back())}>‹</button>` : html`<span class="back-spacer"></span>`}
    <h1>${title}</h1>
    <div class="head-right">${right}</div>
  </header>`;
}

export function Section({ title, children, right, open = true, collapsible }) {
  const [isOpen, setOpen] = useState(open);
  return html`<section class="card">
    <div class="card-head" onClick=${collapsible ? () => setOpen(!isOpen) : null}>
      <h3>${collapsible ? (isOpen ? '▾ ' : '▸ ') : ''}${title}</h3>${right}
    </div>
    ${isOpen && html`<div class="card-body">${children}</div>`}
  </section>`;
}

export function Loading() { return html`<div class="loading">Loading…</div>`; }
export function Missing({ what = 'Record' }) {
  return html`<div class="page"><${Header} title="Not found" back="/" /><p class="empty">${what} not found. It may have been deleted.</p></div>`;
}

// ---------- Inputs ----------
export function Field({ label, value, onInput, type = 'text', placeholder, hint, inputmode, multiline, rows = 3, autocomplete, children, required }) {
  const common = {
    value: value ?? '', placeholder, inputmode, autocomplete,
    onInput: (e) => onInput && onInput(e.currentTarget.value),
  };
  return html`<label class="field">
    <span class="lbl">${label}${required ? html`<span class="req"> *</span>` : ''}</span>
    ${children || (multiline
      ? html`<textarea rows=${rows} ...${common}></textarea>`
      : html`<input type=${type} ...${common} />`)}
    ${hint && html`<span class="hint">${hint}</span>`}
  </label>`;
}

export function NumField({ label, value, onInput, step = 'any', hint, prefix, suffix, placeholder }) {
  return html`<label class="field">
    <span class="lbl">${label}</span>
    <span class="affix">
      ${prefix && html`<span class="pre">${prefix}</span>`}
      <input type="number" inputmode="decimal" step=${step} value=${value ?? ''} placeholder=${placeholder}
        onInput=${(e) => onInput(e.currentTarget.value === '' ? '' : Number(e.currentTarget.value))} />
      ${suffix && html`<span class="suf">${suffix}</span>`}
    </span>
    ${hint && html`<span class="hint">${hint}</span>`}
  </label>`;
}

export function Select({ label, value, onChange, options, hint }) {
  return html`<label class="field">
    <span class="lbl">${label}</span>
    <select value=${value ?? ''} onChange=${(e) => onChange(e.currentTarget.value)}>
      ${options.map((o) => (typeof o === 'string'
        ? html`<option value=${o} selected=${o === value}>${o}</option>`
        : html`<option value=${o.value} selected=${o.value === value}>${o.label}</option>`))}
    </select>
    ${hint && html`<span class="hint">${hint}</span>`}
  </label>`;
}

export function Toggle({ label, checked, onChange, hint }) {
  return html`<label class="toggle">
    <input type="checkbox" checked=${!!checked} onChange=${(e) => onChange(e.currentTarget.checked)} />
    <span>${label}${hint && html`<br /><small class="hint">${hint}</small>`}</span>
  </label>`;
}

export function Segmented({ value, options, onChange }) {
  return html`<div class="segmented" role="group">
    ${options.map((o) => html`<button type="button" class=${o === value ? 'on' : ''} aria-pressed=${o === value} onClick=${() => onChange(o)}>${o}</button>`)}
  </div>`;
}

export function Pill({ status }) {
  const cls = (status || '').toLowerCase().replace(/[^a-z]+/g, '-');
  return html`<span class=${'pill ' + cls}>${status}</span>`;
}

// ---------- Line items ----------
export function LineItems({ items, onChange, settings, rates }) {
  const set = (id, patch) => onChange(items.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  const del = (id) => onChange(items.filter((it) => it.id !== id));
  const add = (kind) => onChange([...items, newItem(kind, settings, rates)]);
  const markup = Number(settings?.partsMarkupPct) || 0;
  return html`<div class="items">
    ${items.length === 0 && html`<p class="empty small">No line items yet. Add labor, parts, travel, or consumables below.</p>`}
    ${items.map((it) => html`<div class="item" key=${it.id}>
      <div class="item-top">
        <select class="kind" value=${it.kind} aria-label="Item type" onChange=${(e) => set(it.id, { kind: e.currentTarget.value })}>
          ${Object.entries(ITEM_KINDS).map(([k, v]) => html`<option value=${k} selected=${k === it.kind}>${v}</option>`)}
        </select>
        <span class="amt">${money(lineAmount(it))}</span>
        <button class="icon-btn del" aria-label="Remove line" onClick=${() => del(it.id)}>🗑</button>
      </div>
      <input class="desc" placeholder="Description" value=${it.desc} onInput=${(e) => set(it.id, { desc: e.currentTarget.value })} />
      ${it.kind === 'labor' && rates?.laborRates?.length > 1 && html`<div class="chips">
        ${rates.laborRates.map((r) => html`<button type="button" class=${'chip' + (Number(it.rate) === Number(r.rate) ? ' on' : '')}
          onClick=${() => set(it.id, { rate: r.rate, desc: `Labor – ${r.name}` })}>${r.name} ${money(r.rate)}</button>`)}
      </div>`}
      <div class="item-nums">
        <label><span>${it.kind === 'labor' ? 'Hours' : it.kind === 'travel' && it.unit ? (it.unit === 'mi' ? 'Miles' : it.unit === 'hr' ? 'Hours' : 'Qty') : 'Qty'}</span>
          <input type="number" inputmode="decimal" step="any" value=${it.qty} onInput=${(e) => set(it.id, { qty: e.currentTarget.value === '' ? '' : Number(e.currentTarget.value) })} /></label>
        ${it.kind === 'part' && html`<label><span>Your cost</span>
          <input type="number" inputmode="decimal" step="any" value=${it.cost ?? ''} placeholder="opt."
            onInput=${(e) => {
              const v = e.currentTarget.value === '' ? '' : Number(e.currentTarget.value);
              const patch = { cost: v };
              if (v !== '' && markup) patch.rate = Math.round(v * (1 + markup / 100) * 100) / 100;
              else if (v !== '' && !it.rate) patch.rate = v;
              set(it.id, patch);
            }} /></label>`}
        <label><span>${it.kind === 'labor' ? 'Rate' : 'Price'}</span>
          <input type="number" inputmode="decimal" step="any" value=${it.rate} onInput=${(e) => set(it.id, { rate: e.currentTarget.value === '' ? '' : Number(e.currentTarget.value) })} /></label>
        <label class="tax"><span>Tax</span><input type="checkbox" checked=${!!it.taxable} onChange=${(e) => set(it.id, { taxable: e.currentTarget.checked })} /></label>
      </div>
    </div>`)}
    <div class="add-row">
      <button class="btn small" onClick=${() => add('labor')}>+ Labor</button>
      <button class="btn small" onClick=${() => add('part')}>+ Part</button>
      <button class="btn small" onClick=${() => add('travel')}>+ Travel</button>
      <button class="btn small" onClick=${() => add('consumable')}>+ Consumables</button>
      <button class="btn small" onClick=${() => add('misc')}>+ Other</button>
    </div>
  </div>`;
}

export function TotalsBlock({ items, taxRate, taxExempt, lessPrior, priorLabel = 'Less prior invoices' }) {
  const t = calcTotals(items, taxRate, lessPrior);
  return html`<div class="totals">
    ${t.laborHours > 0 && html`<div><span>Labor hours</span><span>${num(t.laborHours)} h</span></div>`}
    <div><span>Subtotal</span><span>${money(t.subtotal)}</span></div>
    <div><span>${taxExempt ? 'Tax (exempt)' : `Tax ${num(taxRate)}%`}</span><span>${money(t.tax)}</span></div>
    <div class="grand"><span>Total</span><span>${money(t.total)}</span></div>
    ${t.lessPrior > 0 && html`<div><span>${priorLabel}</span><span>−${money(t.lessPrior)}</span></div>
      <div class="grand"><span>Amount due</span><span>${money(t.due)}</span></div>`}
  </div>`;
}

// ---------- Photos & video ----------
export async function resizeImage(file, maxDim = 1600, quality = 0.82, mime = 'image/jpeg') {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    const ctx = c.getContext('2d');
    if (mime === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob((b) => res(b || file), mime, quality));
  } catch (e) {
    return file; // e.g. HEIC on a browser that can't decode it — keep the original
  }
}

export function Gallery({ ownerType, ownerId, allowVideo }) {
  const media = useLive(() => db.media.where({ ownerType, ownerId }).toArray(), [ownerType, ownerId]);
  const [urls, setUrls] = useState({});
  const [viewing, setViewing] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!media) return;
    const map = {};
    for (const m of media) map[m.id] = URL.createObjectURL(m.blob);
    setUrls(map);
    return () => Object.values(map).forEach((u) => URL.revokeObjectURL(u));
  }, [media]);

  const addFiles = async (files) => {
    setBusy(true);
    try {
      for (const f of files) {
        const isVideo = f.type.startsWith('video/');
        if (isVideo && f.size > 150 * 1024 * 1024) { toast(`${f.name} is over 150 MB – trim it first`); continue; }
        const blob = isVideo ? f : await resizeImage(f);
        await db.media.put({ id: uid(), ownerType, ownerId, kind: isVideo ? 'video' : 'photo', blob, type: blob.type || f.type, name: f.name, createdAt: now() });
      }
    } finally { setBusy(false); }
  };
  const remove = async (m) => {
    if (await confirmDialog('Delete photo?', 'This permanently removes it from the app.', 'Delete', true)) {
      await db.media.delete(m.id); setViewing(null);
    }
  };
  const accept = allowVideo ? 'image/*,video/*' : 'image/*';
  return html`<div class="gallery">
    <div class="thumbs">
      ${(media || []).map((m) => html`<button class="thumb" key=${m.id} onClick=${() => setViewing(m)} aria-label="View">
        ${m.kind === 'video' ? html`<span class="vid">▶</span>` : html`<img src=${urls[m.id]} alt="" loading="lazy" />`}
      </button>`)}
      ${media && media.length === 0 && html`<span class="empty small">No photos yet.</span>`}
    </div>
    <div class="row-btns left">
      <label class="btn small">📷 Camera<input type="file" accept=${accept} capture="environment" hidden onChange=${(e) => { addFiles([...e.currentTarget.files]); e.currentTarget.value = ''; }} /></label>
      <label class="btn small">🖼 Choose<input type="file" accept=${accept} multiple hidden onChange=${(e) => { addFiles([...e.currentTarget.files]); e.currentTarget.value = ''; }} /></label>
      ${busy && html`<span class="hint">Saving…</span>`}
    </div>
    ${viewing && html`<div class="viewer" onClick=${(e) => e.target === e.currentTarget && setViewing(null)}>
      ${viewing.kind === 'video' ? html`<video src=${urls[viewing.id]} controls playsinline></video>` : html`<img src=${urls[viewing.id]} alt="" />`}
      <div class="row-btns">
        <button class="btn danger" onClick=${() => remove(viewing)}>Delete</button>
        <button class="btn primary" onClick=${() => setViewing(null)}>Close</button>
      </div>
    </div>`}
  </div>`;
}

// ---------- Pickers ----------
export function SearchList({ items, render: renderItem, onPick, placeholder = 'Search…', filterText, empty = 'Nothing found.' }) {
  const [q, setQ] = useState('');
  const ql = q.trim().toLowerCase();
  const shown = ql ? items.filter((it) => filterText(it).toLowerCase().includes(ql)) : items;
  return html`<div>
    ${items.length > 6 && html`<input class="search" type="search" placeholder=${placeholder} value=${q} onInput=${(e) => setQ(e.currentTarget.value)} />`}
    <ul class="list">
      ${shown.map((it) => html`<li key=${it.id}><button class="list-item" onClick=${() => onPick(it)}>${renderItem(it)}</button></li>`)}
    </ul>
    ${shown.length === 0 && html`<p class="empty small">${empty}</p>`}
  </div>`;
}

// ---------- Phone contacts ----------
const isIPhone = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function VcfInput({ onContacts, children, className = 'btn small' }) {
  return html`<label class=${className}>${children}<input type="file" accept=".vcf,text/vcard,text/x-vcard" multiple hidden
    onChange=${async (e) => {
      const files = [...e.currentTarget.files]; e.currentTarget.value = '';
      if (!files.length) return;
      try {
        const list = await readVCardFiles(files);
        if (!list.length) return toast('No contacts found in that file');
        onContacts(list);
      } catch (err) { toast('Could not read contact file'); }
    }} /></label>`;
}

function ContactHelpModal({ close, onContacts }) {
  return html`<${Modal} title="Get details from your contacts" close=${close}>
    ${isIPhone() ? html`
      <h4>Option 1 – Turn on the contact picker (one time)</h4>
      <ol class="steps">
        <li>Open the iPhone <strong>Settings</strong> app → <strong>Apps</strong> → <strong>Safari</strong>.</li>
        <li>Scroll down to <strong>Advanced</strong> → <strong>Feature Flags</strong>.</li>
        <li>Turn on <strong>Contact Picker API</strong>.</li>
        <li>Close and reopen this app. The 📇 button will then open your contacts directly.</li>
      </ol>
      <h4>Option 2 – Share a contact card</h4>
      <ol class="steps">
        <li>In the <strong>Contacts</strong> app, open the person → <strong>Share Contact</strong> → <strong>Save to Files</strong>.</li>
        <li>Come back here and tap the button below, then pick that file.</li>
      </ol>`
    : html`<p>Your browser can't open the contact list directly. In your Contacts app, share the contact as a file (.vcf), save it, then pick it below.</p>`}
    <${VcfInput} className="btn primary block" onContacts=${(list) => { close(); onContacts(list); }}>📂 Choose contact card (.vcf)…<//>
  <//>`;
}

// Button that pulls one or more contacts from the phone. onContacts receives [{ name, org, role, phone, email, address }].
export function PhoneContactButton({ onContacts, multiple = false, label = '📇 From phone contacts', className = 'btn small' }) {
  const click = async () => {
    if (!canPickContacts()) return openModal(ContactHelpModal, { onContacts });
    try {
      const list = await pickPhoneContacts(multiple);
      if (list.length) onContacts(list);
    } catch (e) {
      if (e?.name !== 'AbortError') { console.warn(e); openModal(ContactHelpModal, { onContacts }); }
    }
  };
  return html`<button type="button" class=${className} onClick=${click}>${label}</button>`;
}

function NewCustomerModal({ close }) {
  const [c, setC] = useState({ name: '', phone: '', address: '', contactName: '', contactRole: '', contactPhone: '', contactEmail: '' });
  const s = (k) => (v) => setC({ ...c, [k]: v });
  const fromPhone = ([p]) => setC((cur) => ({
    ...cur,
    name: cur.name || p.org || '',
    address: cur.address || p.address || '',
    phone: cur.phone || p.workPhone || (!p.name ? p.phone : '') || '',
    contactName: p.name || cur.contactName,
    contactRole: p.role || cur.contactRole,
    contactPhone: p.name ? p.phone || cur.contactPhone : cur.contactPhone,
    contactEmail: p.email || cur.contactEmail,
  }));
  const save = async () => {
    if (!c.name.trim()) return toast('Business name is required');
    const contacts = c.contactName.trim() ? [{ id: uid(), name: c.contactName, role: c.contactRole, phone: c.contactPhone, email: c.contactEmail, isDefault: true }] : [];
    const rec = await put('customers', { id: uid(), name: c.name.trim(), phone: c.phone, address: c.address, contacts, rates: {} });
    close(rec);
  };
  return html`<${Modal} title="New customer" close=${close}>
    <${PhoneContactButton} className="btn block" label="📇 Fill in from phone contacts" onContacts=${fromPhone} />
    <${Field} label="Business name" required value=${c.name} onInput=${s('name')} />
    <${Field} label="Main phone" type="tel" value=${c.phone} onInput=${s('phone')} />
    <${Field} label="Address" multiline rows="2" value=${c.address} onInput=${s('address')} />
    <h4>Main contact</h4>
    <${Field} label="Name" value=${c.contactName} onInput=${s('contactName')} />
    <${Field} label="Role" placeholder="Maintenance manager" value=${c.contactRole} onInput=${s('contactRole')} />
    <${Field} label="Mobile" type="tel" value=${c.contactPhone} onInput=${s('contactPhone')} />
    <${Field} label="Email" type="email" value=${c.contactEmail} onInput=${s('contactEmail')} />
    <p class="hint">You can add more contacts and custom rates later on the customer page.</p>
    <div class="row-btns"><button class="btn" onClick=${() => close(null)}>Cancel</button><button class="btn primary" onClick=${save}>Save customer</button></div>
  <//>`;
}

export function MachineFields({ m, set }) {
  const s = (k) => (v) => set({ [k]: v });
  return html`
    <div class="grid2">
      <${Field} label="Make" value=${m.make} onInput=${s('make')} placeholder="Caterpillar" />
      <${Field} label="Model" value=${m.model} onInput=${s('model')} placeholder="320D" />
    </div>
    <${Field} label="Serial number" value=${m.serial} onInput=${s('serial')} autocomplete="off"
      hint="Tip: on iPhone, tap this box, then tap it again and choose “Scan Text” to read the data plate with the camera." />
    <div class="grid2">
      <${Field} label="Year" inputmode="numeric" value=${m.year} onInput=${s('year')} />
      <${Field} label="Unit / fleet #" value=${m.unitNumber} onInput=${s('unitNumber')} />
    </div>
    <div class="grid2">
      <${Field} label="Hours" inputmode="decimal" value=${m.hours} onInput=${s('hours')} />
      <${Field} label="Miles" inputmode="decimal" value=${m.miles} onInput=${s('miles')} />
    </div>
    <${Field} label="Type" value=${m.type} onInput=${s('type')} placeholder="Excavator, dozer, skid steer…" />
    <${Field} label="Notes" multiline value=${m.notes} onInput=${s('notes')} />`;
}

function NewMachineModal({ close, customerId }) {
  const [m, setM] = useState({ make: '', model: '', serial: '', year: '', unitNumber: '', hours: '', miles: '', type: '', notes: '' });
  const save = async () => {
    if (!m.make && !m.model && !m.serial) return toast('Enter at least a make, model, or serial');
    close(await put('machines', { id: uid(), customerId, ...m }));
  };
  return html`<${Modal} title="New machine" close=${close}>
    <${MachineFields} m=${m} set=${(p) => setM({ ...m, ...p })} />
    <div class="row-btns"><button class="btn" onClick=${() => close(null)}>Cancel</button><button class="btn primary" onClick=${save}>Save machine</button></div>
  <//>`;
}

function CustomerPickModal({ close }) {
  const customers = useLive(() => db.customers.orderBy('name').toArray(), []);
  return html`<${Modal} title="Choose customer" close=${close}>
    <button class="btn primary block" onClick=${async () => { const c = await openModal(NewCustomerModal); if (c) close(c); }}>+ New customer</button>
    ${customers ? html`<${SearchList} items=${alive(customers)} filterText=${(c) => c.name + ' ' + (c.contacts || []).map((x) => x.name).join(' ')}
      render=${(c) => html`<strong>${c.name}</strong><small>${c.address || c.phone || ''}</small>`} onPick=${close} empty="No customers yet." />` : html`<${Loading} />`}
  <//>`;
}

function MachinePickModal({ close, customerId }) {
  const machines = useLive(() => db.machines.where({ customerId }).toArray(), [customerId]);
  return html`<${Modal} title="Choose machine" close=${close}>
    <button class="btn primary block" onClick=${async () => { const m = await openModal(NewMachineModal, { customerId }); if (m) close(m); }}>+ New machine</button>
    ${machines ? html`<${SearchList} items=${alive(machines)} filterText=${(m) => machineLabel(m)}
      placeholder="Search make, model, serial…"
      render=${(m) => html`<strong>${[m.make, m.model].filter(Boolean).join(' ') || 'Machine'}</strong><small>${machineLabel(m)}</small>`} onPick=${close} empty="No machines for this customer yet." />` : html`<${Loading} />`}
  <//>`;
}

export const pickCustomer = () => openModal(CustomerPickModal);
export const pickMachine = (customerId) => openModal(MachinePickModal, { customerId });
export const newCustomer = () => openModal(NewCustomerModal);
export const newMachine = (customerId) => openModal(NewMachineModal, { customerId });

// Customer + machine selector row used on quotes, jobs, invoices.
export function CustomerMachine({ customer, machine, onCustomer, onMachine, locked }) {
  return html`<div class="cm">
    <div class="cm-row">
      <div><span class="lbl">Customer</span><div class="val">${customer ? html`<a href=${'#/customer/' + customer.id}>${customer.name}</a>` : html`<em>None selected</em>`}</div></div>
      ${!locked && html`<button class="btn small" onClick=${async () => { const c = await pickCustomer(); if (c) onCustomer(c); }}>${customer ? 'Change' : 'Choose'}</button>`}
    </div>
    <div class="cm-row">
      <div><span class="lbl">Machine</span><div class="val">${machine ? html`<a href=${'#/machine/' + machine.id}>${machineLabel(machine)}</a>` : html`<em>None selected</em>`}</div></div>
      ${!locked && customer && html`<button class="btn small" onClick=${async () => { const m = await pickMachine(customer.id); if (m) onMachine(m); }}>${machine ? 'Change' : 'Choose'}</button>`}
    </div>
  </div>`;
}

export function useRecord(table, id) {
  return useLive(() => (id ? db[table].get(id) : Promise.resolve(null)), [table, id]);
}
