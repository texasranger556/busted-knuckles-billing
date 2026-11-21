// Getting contact details from the phone: the Contact Picker API (Android Chrome; iPhone behind a Safari
// setting) or a contact card file (.vcf) shared from the Contacts app. Both copy details once; there is
// no live link to the phone's address book.
// Each result: { name, org, role, phone, workPhone?, email, address }

export const canPickContacts = () => !!(navigator.contacts && navigator.contacts.select && window.isSecureContext);

export async function pickPhoneContacts(multiple = false) {
  const supported = (await navigator.contacts.getProperties?.()) || ['name', 'email', 'tel'];
  const props = ['name', 'email', 'tel', 'address'].filter((p) => supported.includes(p));
  const picked = await navigator.contacts.select(props, { multiple });
  return (picked || []).map((c) => ({
    name: (c.name || [])[0] || '',
    org: '',
    role: '',
    phone: (c.tel || [])[0] || '',
    email: (c.email || [])[0] || '',
    address: formatAddress((c.address || [])[0]),
  })).filter((c) => c.name || c.phone || c.email);
}

function formatAddress(a) {
  if (!a) return '';
  const street = (a.addressLine || []).join(', ');
  const cityLine = [a.city, [a.region, a.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [street, cityLine].filter(Boolean).join('\n');
}

// ---------- vCard (.vcf) ----------
const unescape = (v) => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

export function parseVCards(text) {
  // Unfold continuation lines (a line starting with a space or tab continues the previous one).
  const lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const cards = [];
  let cur = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^BEGIN:VCARD$/i.test(line)) { cur = { tels: [], emails: [] }; continue; }
    if (/^END:VCARD$/i.test(line)) { if (cur) cards.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const head = line.slice(0, i).replace(/^item\d+\./i, '');
    const value = line.slice(i + 1);
    const [prop, ...params] = head.split(';');
    const p = params.join(';').toUpperCase();
    switch (prop.toUpperCase()) {
      case 'FN': cur.fn = unescape(value); break;
      case 'N': {
        const [last, first] = value.split(';').map(unescape);
        cur.n = [first, last].filter(Boolean).join(' ');
        break;
      }
      case 'ORG': cur.org = unescape(value.split(';')[0]); break;
      case 'TITLE': cur.title = unescape(value); break;
      case 'TEL': cur.tels.push({ v: value.replace(/^tel:/i, ''), cell: /CELL|MOBILE|IPHONE/.test(p), work: /WORK|MAIN/.test(p), pref: /PREF/.test(p) }); break;
      case 'EMAIL': cur.emails.push({ v: value, pref: /PREF/.test(p) }); break;
      case 'ADR': if (!cur.adr) {
        // PO box; extended; street; city; region; postal code; country
        const [, , street, city, region, zip] = value.split(';').map(unescape);
        const cityLine = [city, [region, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
        cur.adr = [street, cityLine].filter(Boolean).join('\n');
      } break;
      default: break;
    }
  }
  return cards.map((c) => {
    const tel = c.tels.find((t) => t.cell) || c.tels.find((t) => t.pref) || c.tels[0];
    const email = c.emails.find((e) => e.pref) || c.emails[0];
    const work = c.tels.find((t) => t.work && !t.cell && t !== tel);
    const name = c.fn || c.n || '';
    return {
      // A card for a business (no person's name) has FN equal to the company name.
      name: name && name !== c.org ? name : '',
      org: c.org || (!c.n ? name : '') || '',
      role: c.title || '',
      phone: tel?.v || '',
      workPhone: work?.v || '',
      email: email?.v || '',
      address: c.adr || '',
    };
  }).filter((c) => c.name || c.org || c.phone || c.email);
}

export async function readVCardFiles(files) {
  const out = [];
  for (const f of files) out.push(...parseVCards(await f.text()));
  return out;
}
