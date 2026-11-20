import { render } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { html, parseHash } from './ui.js';
import { requestPersistence } from './db.js';
import { HomePage, ReportsPage } from './pages/reports.js';
import { SettingsPage } from './pages/settings.js';
import { CustomersPage, CustomerPage, MachinePage } from './pages/customers.js';
import { QuotesPage, QuotePage } from './pages/quotes.js';
import { JobsPage, JobPage } from './pages/jobs.js';
import { InvoicesPage, InvoicePage } from './pages/invoices.js';
import { PaymentsPage, PaymentPage } from './pages/payments.js';
import { BackupPage } from './pages/backup.js';

function route() {
  const { parts } = parseHash();
  const [a, b] = parts;
  switch (a) {
    case undefined: return html`<${HomePage} />`;
    case 'settings': return html`<${SettingsPage} />`;
    case 'customers': return html`<${CustomersPage} />`;
    case 'customer': return html`<${CustomerPage} id=${b} key=${b} />`;
    case 'machine': return html`<${MachinePage} id=${b} key=${b} />`;
    case 'quotes': return html`<${QuotesPage} />`;
    case 'quote': return html`<${QuotePage} id=${b} key=${b} />`;
    case 'jobs': return html`<${JobsPage} />`;
    case 'job': return html`<${JobPage} id=${b} key=${b} />`;
    case 'invoices': return html`<${InvoicesPage} />`;
    case 'invoice': return html`<${InvoicePage} id=${b} key=${b} />`;
    case 'payments': return html`<${PaymentsPage} />`;
    case 'payment': return html`<${PaymentPage} id=${b} key=${b} />`;
    case 'reports': return html`<${ReportsPage} tab=${b || 'totals'} key=${b} />`;
    case 'backup': return html`<${BackupPage} />`;
    default: return html`<${HomePage} />`;
  }
}

function App() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const onHash = () => { setTick((n) => n + 1); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return html`<main>${route()}</main>`;
}

const root = document.getElementById('app');
root.textContent = ''; // remove the static "Loading…" placeholder
render(html`<${App} />`, root);
requestPersistence();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW registration failed', e));
}
