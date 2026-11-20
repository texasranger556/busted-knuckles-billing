// PDF generation for quotes, invoices, and payment receipts (jsPDF + autoTable, loaded as globals).
import { ITEM_KINDS, lineAmount, money, num, docTotals, round2 } from './calc.js';
import { machineLabel } from './db.js';

const fmtDate = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};
export { fmtDate };

const ACCENT = [196, 90, 18];
const INK = [33, 33, 33];
const MUTED = [110, 110, 110];

function header(pdf, s, title, number, rows) {
  const W = pdf.internal.pageSize.getWidth();
  let y = 40;
  let x = 40;
  if (s.logo) {
    try {
      const props = pdf.getImageProperties(s.logo);
      const h = 56, w = Math.min(140, (props.width / props.height) * h);
      pdf.addImage(s.logo, 'PNG', 40, y, w, h);
      x = 40 + w + 14;
    } catch (e) { /* bad image; skip */ }
  }
  pdf.setTextColor(...INK).setFont('helvetica', 'bold').setFontSize(15).text(s.name || '', x, y + 14);
  pdf.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...MUTED);
  const info = [s.ownerName, ...(s.address || '').split('\n'), s.phone, s.email].filter(Boolean);
  info.forEach((line, i) => pdf.text(line, x, y + 28 + i * 11));

  pdf.setTextColor(...ACCENT).setFont('helvetica', 'bold').setFontSize(20).text(title.toUpperCase(), W - 40, y + 14, { align: 'right' });
  pdf.setTextColor(...INK).setFontSize(10).text(number || '', W - 40, y + 30, { align: 'right' });
  pdf.setFont('helvetica', 'normal').setFontSize(9);
  rows.filter(Boolean).forEach(([k, v], i) => {
    pdf.setTextColor(...MUTED).text(k, W - 130, y + 46 + i * 12, { align: 'right' });
    pdf.setTextColor(...INK).text(String(v), W - 40, y + 46 + i * 12, { align: 'right' });
  });
  return Math.max(y + 28 + info.length * 11, y + 46 + rows.filter(Boolean).length * 12) + 16;
}

function partyBlock(pdf, y, customer, contact, machine, extra = []) {
  const W = pdf.internal.pageSize.getWidth();
  pdf.setDrawColor(...ACCENT).setLineWidth(1.2).line(40, y, W - 40, y);
  y += 16;
  pdf.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...MUTED).text('BILL TO', 40, y);
  pdf.text('EQUIPMENT', W / 2 + 10, y);
  pdf.setFont('helvetica', 'normal').setFontSize(10).setTextColor(...INK);
  const left = [customer?.name, ...((customer?.billingAddress || customer?.address || '').split('\n')),
    contact ? `Attn: ${contact.name}${contact.role ? ' (' + contact.role + ')' : ''}` : '', customer?.phone].filter(Boolean);
  const m = machine || {};
  const right = machine ? [
    [m.year, m.make, m.model].filter(Boolean).join(' '),
    m.serial && `Serial: ${m.serial}`,
    m.unitNumber && `Unit #: ${m.unitNumber}`,
    ...extra,
  ].filter(Boolean) : extra.filter(Boolean);
  left.forEach((t, i) => pdf.text(t, 40, y + 14 + i * 12));
  right.forEach((t, i) => pdf.text(t, W / 2 + 10, y + 14 + i * 12, { maxWidth: W / 2 - 50 }));
  return y + 14 + Math.max(left.length, right.length) * 12 + 10;
}

function textBlock(pdf, y, title, text) {
  if (!text) return y;
  const W = pdf.internal.pageSize.getWidth();
  const lines = pdf.setFontSize(9.5).splitTextToSize(text, W - 80);
  if (y + 24 + lines.length * 12 > pdf.internal.pageSize.getHeight() - 40) { pdf.addPage(); y = 50; }
  pdf.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...MUTED).text(title.toUpperCase(), 40, y);
  pdf.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(...INK).text(lines, 40, y + 13);
  return y + 13 + lines.length * 12 + 10;
}

function itemsTable(pdf, y, items) {
  pdf.autoTable({
    startY: y,
    margin: { left: 40, right: 40 },
    head: [['Type', 'Description', 'Qty', 'Rate', 'Amount']],
    body: items.map((it) => [
      ITEM_KINDS[it.kind] || '',
      it.desc + (it.taxable ? '' : ' *'),
      num(it.qty) + (it.kind === 'labor' ? ' h' : it.unit ? ' ' + it.unit : ''),
      money(it.rate), money(lineAmount(it)),
    ]),
    styles: { fontSize: 9, cellPadding: 5, textColor: INK },
    headStyles: { fillColor: ACCENT, textColor: 255, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 70 }, 2: { halign: 'right', cellWidth: 55 }, 3: { halign: 'right', cellWidth: 65 }, 4: { halign: 'right', cellWidth: 75 } },
    alternateRowStyles: { fillColor: [248, 244, 240] },
    didParseCell: (d) => { if (d.section === 'head' && d.column.index >= 2) d.cell.styles.halign = 'right'; },
  });
  return pdf.lastAutoTable.finalY + 10;
}

function totalsBlock(pdf, y, rows) {
  const W = pdf.internal.pageSize.getWidth();
  if (y + rows.length * 15 > pdf.internal.pageSize.getHeight() - 40) { pdf.addPage(); y = 50; }
  rows.forEach(([k, v, bold], i) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(bold ? 11 : 9.5).setTextColor(...INK);
    pdf.text(k, W - 140, y + i * 15, { align: 'right' });
    pdf.text(v, W - 40, y + i * 15, { align: 'right' });
  });
  return y + rows.length * 15 + 10;
}

function footer(pdf, s) {
  const n = pdf.internal.getNumberOfPages();
  const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight();
  for (let i = 1; i <= n; i++) {
    pdf.setPage(i);
    pdf.setFontSize(8).setTextColor(...MUTED).text(`${s.name || ''}  ·  ${s.phone || ''}  ·  Page ${i} of ${n}`, W / 2, H - 20, { align: 'center' });
  }
}

function newPdf() {
  const { jsPDF } = window.jspdf;
  return new jsPDF({ unit: 'pt', format: 'letter' });
}

function taxRows(t, doc, customer) {
  const rows = [['Subtotal', money(t.subtotal)]];
  if (customer?.taxExempt) rows.push([`Sales tax (exempt${customer.exemptCert ? ' #' + customer.exemptCert : ''})`, money(0)]);
  else rows.push([`Sales tax ${num(doc.taxRate)}%`, money(t.tax)]);
  return rows;
}

export function quotePdf({ settings: s, quote: q, customer, contact, machine }) {
  const pdf = newPdf();
  const t = docTotals(q);
  let y = header(pdf, s, 'Quote', q.number, [['Date', fmtDate(q.date)], q.validUntil && ['Valid until', fmtDate(q.validUntil)], q.poNumber && ['PO #', q.poNumber]]);
  y = partyBlock(pdf, y, customer, contact, machine, [machine?.hours && `Hours: ${machine.hours}`]);
  y = textBlock(pdf, y, 'Reported problem', q.symptoms);
  y = itemsTable(pdf, y, q.items || []);
  y = totalsBlock(pdf, y, [...taxRows(t, q, customer), ['Estimated total', money(t.total), true]]);
  if ((q.items || []).some((i) => !i.taxable)) y = textBlock(pdf, y, '', '* Non-taxable item');
  y = textBlock(pdf, y, 'Notes', q.notes);
  y = textBlock(pdf, y, 'Terms', s.quoteDisclaimer);
  footer(pdf, s);
  return pdf.output('blob');
}

export function invoicePdf({ settings: s, invoice: inv, customer, contact, machine, priors = [], paid = 0 }) {
  const pdf = newPdf();
  const t = docTotals(inv);
  const typeLabel = { Deposit: 'Deposit Invoice', Partial: 'Progress Invoice', Final: 'Invoice' }[inv.type] || 'Invoice';
  let y = header(pdf, s, typeLabel, inv.number, [
    ['Date', fmtDate(inv.date)], ['Due', fmtDate(inv.dueDate)], inv.terms && ['Terms', inv.terms],
    inv.poNumber && ['PO #', inv.poNumber], inv.refNumber && ['Ref', inv.refNumber]]);
  y = partyBlock(pdf, y, customer, contact, machine, [inv.meterHours && `Hours at service: ${inv.meterHours}`]);
  y = textBlock(pdf, y, 'Work performed', inv.workPerformed);
  y = itemsTable(pdf, y, inv.items || []);
  const rows = [...taxRows(t, inv, customer), ['Total', money(t.total), true]];
  if (t.lessPrior > 0) {
    rows.push(['Less previously billed', '-' + money(t.lessPrior)]);
  }
  if (paid > 0) rows.push(['Payments received', '-' + money(paid)]);
  rows.push(['BALANCE DUE', money(round2(t.due - paid)), true]);
  y = totalsBlock(pdf, y, rows);
  if (t.lessPrior > 0 && priors.length) {
    y = textBlock(pdf, y, 'Previously billed', priors.map((p) => `${p.number} (${p.type}, ${fmtDate(p.date)}): ${money(p.billed)}`).join('\n'));
  }
  if ((inv.items || []).some((i) => !i.taxable)) y = textBlock(pdf, y, '', '* Non-taxable item');
  y = textBlock(pdf, y, 'Payment', s.paymentInstructions);
  y = textBlock(pdf, y, 'Notes', inv.notes || s.invoiceNotes);
  footer(pdf, s);
  return pdf.output('blob');
}

export function receiptPdf({ settings: s, payment: p, customer, lines }) {
  // lines: [{ number, applied, balanceAfter, machine }]
  const pdf = newPdf();
  let y = header(pdf, s, 'Payment Receipt', p.number, [['Date', fmtDate(p.date)], ['Method', p.method], p.reference && ['Reference', p.reference]]);
  y = partyBlock(pdf, y, customer, null, null, []);
  pdf.autoTable({
    startY: y, margin: { left: 40, right: 40 },
    head: [['Invoice', 'Equipment', 'Amount applied', 'Remaining balance']],
    body: lines.map((l) => [l.number, l.machine ? machineLabel(l.machine) : '', money(l.applied), money(l.balanceAfter)]),
    styles: { fontSize: 9, cellPadding: 5 }, headStyles: { fillColor: ACCENT, textColor: 255 },
    columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' } },
    didParseCell: (d) => { if (d.section === 'head' && d.column.index >= 2) d.cell.styles.halign = 'right'; },
  });
  y = pdf.lastAutoTable.finalY + 14;
  y = totalsBlock(pdf, y, [['Total received', money(p.amount), true]]);
  y = textBlock(pdf, y, 'Notes', p.notes);
  y = textBlock(pdf, y, '', 'Thank you for your payment!');
  footer(pdf, s);
  return pdf.output('blob');
}
