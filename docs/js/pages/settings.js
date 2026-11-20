import { useState, useEffect, useRef } from 'preact/hooks';
import { getSettings, saveSettings } from '../db.js';
import { html, Header, Section, Field, NumField, Select, Toggle, Loading, resizeImage, toast, go } from '../ui.js';
import { ITEM_KINDS } from '../calc.js';

export const TRAVEL_MODES = [
  { value: 'none', label: 'No travel charge (or include in labor)' },
  { value: 'flat', label: 'Flat fee per trip / service call' },
  { value: 'mile', label: 'Per mile' },
  { value: 'hour', label: 'Per hour of drive time' },
];

const blobToDataURL = (blob) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });

export function SettingsPage() {
  const [s, setS] = useState(null);
  const timer = useRef();
  const latest = useRef();
  useEffect(() => { getSettings().then(setS); return () => { clearTimeout(timer.current); if (latest.current) saveSettings(latest.current); }; }, []);
  if (!s) return html`<${Loading} />`;
  const update = (patch) => {
    const next = { ...s, ...patch };
    setS(next); latest.current = next;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { saveSettings(next); latest.current = null; }, 400);
  };
  const f = (k) => (v) => update({ [k]: v });
  const setRate = (i, patch) => update({ laborRates: s.laborRates.map((r, j) => (i === j ? { ...r, ...patch } : r)) });

  const onLogo = async (e) => {
    const file = e.currentTarget.files[0]; e.currentTarget.value = '';
    if (!file) return;
    const blob = await resizeImage(file, 500, 0.92, 'image/png');
    update({ logo: await blobToDataURL(blob) });
    toast('Logo saved');
  };

  return html`<div class="page">
    <${Header} title="Settings" back="/" />
    <p class="hint pad">Changes save automatically.</p>

    <${Section} title="Your business">
      <div class="logo-row">
        ${s.logo ? html`<img class="logo-prev" src=${s.logo} alt="Logo" />` : html`<div class="logo-prev empty">No logo</div>`}
        <div class="row-btns left">
          <label class="btn small">Choose logo<input type="file" accept="image/*" hidden onChange=${onLogo} /></label>
          ${s.logo && html`<button class="btn small" onClick=${() => update({ logo: null })}>Remove</button>`}
        </div>
      </div>
      <${Field} label="Business name" value=${s.name} onInput=${f('name')} />
      <${Field} label="Your name" value=${s.ownerName} onInput=${f('ownerName')} />
      <${Field} label="Phone" type="tel" value=${s.phone} onInput=${f('phone')} />
      <${Field} label="Email" type="email" value=${s.email} onInput=${f('email')} />
      <${Field} label="Address" multiline rows="3" value=${s.address} onInput=${f('address')} />
    <//>

    <${Section} title="Labor rates">
      <p class="hint">The first rate is the default. Add others for after-hours, emergency, or weekend work.</p>
      ${s.laborRates.map((r, i) => html`<div class="rate-row" key=${i}>
        <input value=${r.name} aria-label="Rate name" onInput=${(e) => setRate(i, { name: e.currentTarget.value })} />
        <span class="affix"><span class="pre">$</span><input type="number" inputmode="decimal" step="any" value=${r.rate} aria-label="Rate per hour"
          onInput=${(e) => setRate(i, { rate: Number(e.currentTarget.value) || 0 })} /><span class="suf">/h</span></span>
        ${i > 0 && html`<button class="icon-btn" aria-label="Remove rate" onClick=${() => update({ laborRates: s.laborRates.filter((_, j) => j !== i) })}>🗑</button>`}
      </div>`)}
      <button class="btn small" onClick=${() => update({ laborRates: [...s.laborRates, { name: 'Emergency', rate: s.laborRates[0]?.rate || 0 }] })}>+ Add rate</button>
    <//>

    <${Section} title="Travel">
      <${Select} label="How do you charge for travel?" value=${s.travelMode} options=${TRAVEL_MODES} onChange=${f('travelMode')} />
      ${s.travelMode !== 'none' && html`<${NumField} label=${{ flat: 'Fee per trip', mile: 'Rate per mile', hour: 'Rate per hour' }[s.travelMode]}
        prefix="$" value=${s.travelRate} onInput=${f('travelRate')} />`}
      <p class="hint">You can still add, change, or remove travel on any quote or invoice, and set a different method per customer.</p>
    <//>

    <${Section} title="Sales tax">
      <${NumField} label="Sales tax rate" suffix="%" value=${s.taxRate} onInput=${f('taxRate')}
        hint="PA: 6% (Allegheny County 7%, Philadelphia 8%)." />
      <span class="lbl">Taxable by default</span>
      ${Object.entries(ITEM_KINDS).map(([k, v]) => html`<${Toggle} key=${k} label=${v} checked=${s.taxableDefaults?.[k]}
        onChange=${(c) => update({ taxableDefaults: { ...s.taxableDefaults, [k]: c } })} />`)}
      <p class="hint">In Pennsylvania, repair labor on equipment is generally taxable as well as parts. Farm and some manufacturing customers can be exempt
        (form REV-1220). Mark those customers “tax exempt” on their customer page. Check with your accountant.</p>
    <//>

    <${Section} title="Quotes, invoices & terms">
      <${NumField} label="Payment due (days after invoice)" value=${s.termsDays} onInput=${f('termsDays')} hint="0 = due on receipt" />
      <${NumField} label="Default deposit" suffix="% of quote" value=${s.depositPct} onInput=${f('depositPct')} />
      <${NumField} label="Quotes valid for" suffix="days" value=${s.quoteValidDays} onInput=${f('quoteValidDays')} />
      <${NumField} label="Parts markup" suffix="%" value=${s.partsMarkupPct} onInput=${f('partsMarkupPct')}
        hint="When you enter your cost for a part, the price is calculated with this markup. 0 = no markup." />
      <${Field} label="Quote disclaimer" multiline value=${s.quoteDisclaimer} onInput=${f('quoteDisclaimer')} />
      <${Field} label="Payment instructions (on invoices)" multiline value=${s.paymentInstructions} onInput=${f('paymentInstructions')}
        hint="E.g. “Venmo @your-name · PayPal you@gmail.com · Checks payable to …”" />
      <${Field} label="Invoice footer note" multiline rows="2" value=${s.invoiceNotes} onInput=${f('invoiceNotes')} />
    <//>

    <${Section} title="Backup">
      <${NumField} label="Remind me to back up every" suffix="days" value=${s.backupReminderDays} onInput=${f('backupReminderDays')} />
      <button class="btn" onClick=${() => go('/backup')}>Backup & restore…</button>
    <//>
    <p class="hint pad center">Busted Knuckles Billing · data is stored only on this device</p>
  </div>`;
}
