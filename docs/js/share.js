// Sharing: PDF via the phone's share sheet (default), or a pre-addressed text/email summary.
import { useState, useEffect } from 'preact/hooks';
import { html, Modal, openModal, toast } from './ui.js';

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function smsLink(phones, body) {
  const nums = phones.map((p) => p.replace(/[^\d+]/g, '')).filter(Boolean);
  if (isIOS()) {
    if (nums.length > 1) return `sms:/open?addresses=${nums.join(',')}&body=${encodeURIComponent(body)}`;
    return `sms:${nums[0] || ''}&body=${encodeURIComponent(body)}`;
  }
  return `sms:${nums.join(',')}?body=${encodeURIComponent(body)}`;
}

export function mailtoLink(emails, subject, body) {
  return `mailto:${emails.map(encodeURIComponent).join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

export async function shareFiles(files, title, text) {
  if (navigator.canShare && navigator.canShare({ files })) {
    try { await navigator.share({ files, title, text }); return true; }
    catch (e) { if (e.name === 'AbortError') return false; throw e; }
  }
  return null; // not supported
}

function ShareModal({ close, title, subject, body, smsBody, filename, makePdf, customer }) {
  const contacts = (customer?.contacts || []).filter((c) => c.phone || c.email);
  const [sel, setSel] = useState(() => {
    const d = contacts.find((c) => c.isDefault) || contacts[0];
    return d ? { [d.id]: true } : {};
  });
  const [file, setFile] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    // Build the PDF up front so the Share tap opens the share sheet immediately (iPhone requires that).
    Promise.resolve().then(makePdf).then((blob) => setFile(new File([blob], filename, { type: 'application/pdf' })))
      .catch((e) => { console.error(e); setErr('Could not create the PDF: ' + e.message); });
  }, []);
  const chosen = contacts.filter((c) => sel[c.id]);
  const emails = chosen.map((c) => c.email).filter(Boolean);
  const phones = chosen.map((c) => c.phone).filter(Boolean);
  if (!chosen.length && customer?.phone) phones.push(customer.phone);

  const sendPdf = async () => {
    if (!file) return;
    try {
      const r = await shareFiles([file], subject, body);
      if (r === null) { downloadBlob(file, filename); toast('PDF downloaded – attach it to your message'); close('download'); }
      else if (r) close('shared');
    } catch (e) { setErr(e.message); }
  };
  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); toast('Copied'); } catch (e) { toast('Could not copy'); }
  };
  return html`<${Modal} title=${title} close=${close}>
    ${contacts.length > 0 ? html`<div class="field"><span class="lbl">Send to</span>
      ${contacts.map((c) => html`<label class="toggle" key=${c.id}>
        <input type="checkbox" checked=${!!sel[c.id]} onChange=${(e) => setSel({ ...sel, [c.id]: e.currentTarget.checked })} />
        <span><strong>${c.name}</strong>${c.role ? ` · ${c.role}` : ''}${c.isDefault ? ' ★' : ''}<br /><small class="hint">${[c.phone, c.email].filter(Boolean).join(' · ')}</small></span>
      </label>`)}
    </div>` : html`<p class="hint">No contacts saved for this customer. Add them on the customer page to pre-fill recipients.</p>`}
    <div class="subject"><span class="lbl">Subject</span><div>${subject}</div></div>
    ${err && html`<p class="error">${err}</p>`}
    <button class="btn primary block big" disabled=${!file} onClick=${sendPdf}>${file ? '📄 Send PDF (Messages, Gmail…)' : 'Preparing PDF…'}</button>
    ${emails.length > 0 && html`<p class="hint">The share sheet can't pre-fill recipients. Copy the addresses, then paste them in the To: line.
      <button class="link" onClick=${() => copy(emails.join(', '))}>Copy ${emails.length > 1 ? 'emails' : 'email'}</button></p>`}
    <details class="more"><summary>Send without the PDF (pre-addressed)</summary>
      <div class="row-btns left">
        <a class="btn" href=${mailtoLink(emails, subject, body)} onClick=${() => setTimeout(() => close('email'), 300)}>✉️ Email summary</a>
        <a class="btn" href=${smsLink(phones, smsBody || `${subject}\n\n${body}`)} onClick=${() => setTimeout(() => close('sms'), 300)}>💬 Text summary</a>
      </div>
      <button class="link" disabled=${!file} onClick=${() => file && downloadBlob(file, filename)}>Download PDF</button>
    </details>
  <//>`;
}

export const openShare = (props) => openModal(ShareModal, props);
