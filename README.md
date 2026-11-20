# Busted Knuckles Billing

Quotes, jobs, invoices and payments for a one-person heavy-equipment repair business.
It runs on iPhone and Android, installs to the home screen, and **works with no cell signal**.

**App link:** https://texasranger556.github.io/busted-knuckles-billing/

> 🔒 **Privacy:** All business data (customers, invoices, photos) is stored **only on the phone**.
> GitHub only hosts the app's code. No customer data is ever uploaded.

---

## Install on a phone

The app must be opened once with an internet connection. After that it works offline.

### iPhone (Safari)
1. Open **Safari** (it must be Safari, not Chrome or Gmail's built-in browser) and go to
   https://texasranger556.github.io/busted-knuckles-billing/
2. Tap the **Share** button (square with an up arrow).
3. Scroll down and tap **Add to Home Screen**, then **Add**.
4. From now on, **always open it from the "BK Billing" home-screen icon**.
   This keeps the data safe. iPhone may clear website data that is only opened in Safari.

### Android (Chrome)
1. Open **Chrome** and go to the link above.
2. Tap **Install** when prompted, or use the **⋮ menu → Add to Home screen / Install app**.
3. Open it from the **BK Billing** icon.

### First-time setup
Tap **⚙️ Settings** and fill in the business name, logo, phone, email, address, labor rates,
travel method, sales tax rate (PA default 6%), and payment terms. Everything saves automatically.

---

## Everyday use

| To do this… | Tap |
|---|---|
| Write an estimate | **New Quote** → pick or add the customer → pick or add the machine |
| Start work | **Start Job** → pick an open quote, or start without one |
| Bill the customer | **Invoice** → Deposit (from a quote), Partial (job in progress), or Final (completed job) |
| Log money received | **Record Payment** → pick the invoice(s), then send a receipt |

- The **home screen to-do list** shows jobs ready to invoice, unpaid invoices, and open quotes, each with a one-tap next step.
- **Send** creates a PDF and opens the phone's share menu (Messages, Gmail, etc.).
  The share menu can't fill in recipients, so use **Copy email** in the send screen and paste it into the To: line.
  To send a pre-addressed text or email *without* the PDF, use **Send without the PDF**.
- **Final invoices automatically subtract** deposits and partial invoices already billed for the same quote or job.
- **Dictate** symptoms and work notes with the microphone key on the keyboard.
- **Serial numbers:** on iPhone, tap the serial-number box, tap it again, and choose **Scan Text** to read the data plate with the camera.

### Sales tax (Pennsylvania)
PA generally taxes **repair labor as well as parts** on equipment. Each line item has its own **Tax** checkbox, and the defaults are set in Settings.
Customers with an exemption certificate (e.g. farm equipment, REV-1220) can be marked **Tax exempt** on their customer page.
*Confirm your situation with your accountant.*

---

## Backups (important!)

Data lives only on the phone. If the phone is lost or replaced, **the backup is the only copy**.

1. Home → **💾 Backup** (the app reminds you weekly; change this in Settings).
2. **Back up data** → choose **Drive** in the share menu to save it to Google Drive.
   Files are named by date, e.g. `BKB-data-2026-11-20.zip`.
3. Every so often, also do **Back up photos & videos** (a separate, larger file: `BKB-photos-….zip`).

**Restore / new phone:** install the app, then Backup → **Choose backup file(s)** and pick the newest
`BKB-data-….zip` (and `BKB-photos-….zip` if you have one). ⚠️ Restoring **replaces** everything currently on that phone.

---

## For the maintainer

### Publish on GitHub Pages (one time)
The app is plain HTML/JS in the [`docs/`](docs/) folder. There is no build step and nothing to install.

1. Create a **public** repository named `busted-knuckles-billing` under `texasranger556`
   (free GitHub Pages requires a public repo; the repo contains code only, no customer data).
2. Push this folder:
   ```bash
   git init -b main
   git add .
   git commit -m "Initial release"
   git remote add origin https://github.com/texasranger556/busted-knuckles-billing.git
   git push -u origin main
   ```
3. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch →
   Branch: `main`, folder: `/docs` → Save.**
4. After a minute or two the app is live at https://texasranger556.github.io/busted-knuckles-billing/

### Releasing an update
Phones cache the app for offline use, so they only pick up changes when the cache version changes.

1. Edit the files in `docs/`.
2. In [`docs/sw.js`](docs/sw.js), **bump `VERSION`** (e.g. `bkb-v1` → `bkb-v2`). If you add a new file, add it to `FILES`.
3. Commit and push. Phones get the update the next time the app is opened with signal, and use it from the following launch.

Updates never touch the data stored on the phone.

### Run locally
```bash
cd docs
python3 -m http.server 8000
# open http://localhost:8000
```
To test on a phone before publishing, the app needs HTTPS (or `localhost`), so publishing to GitHub Pages is the easiest way to test.

### How it's built
- **No build step:** ES modules loaded directly through an import map. Libraries are vendored in `docs/js/vendor/`:
  Preact + htm (UI), Dexie (IndexedDB), jsPDF + autoTable (PDFs), JSZip (backups).
- **Offline:** `sw.js` caches every app file. Data is stored in IndexedDB in the browser.
- **Sync-ready data model:** UUID record IDs, an `updatedAt` time on every record, and soft deletes (`deleted: true`).
  This allows adding online sync later without restructuring.

| File | Purpose |
|---|---|
| `docs/js/db.js` | Database schema, settings, numbering (`Q-2026-001`, `J-…`, `INV-…`, `PMT-…`) |
| `docs/js/calc.js` | Line items, tax, totals, invoice balances, prior-billing credits |
| `docs/js/ui.js` | Shared components: autosave, fields, line-item editor, photos, pickers |
| `docs/js/pdf.js` | Quote, invoice, and receipt PDFs |
| `docs/js/share.js` | Share sheet, SMS and mailto links |
| `docs/js/pages/*.js` | Screens: home & reports, customers & machines, quotes, jobs, invoices, payments, settings, backup |

### Roadmap ideas
- Read the serial number from a photo of the data plate (on-device text recognition, with a cloud fallback when online)
- Customer signature on quote approval and job completion
- Mileage log for tax deductions
- Online sync and multi-user accounts (e.g. Supabase) so friends in the trade can use it
- Back up directly to Google Drive
