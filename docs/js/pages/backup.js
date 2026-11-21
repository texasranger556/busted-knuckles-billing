import { useState, useEffect } from 'preact/hooks';
import { db, DATA_TABLES, getSettings, saveSettings, today, now, useLive, useSettings, changesSinceBackup, describeChanges, isInstalled } from '../db.js';
import { html, Header, Section, Loading, toast, confirmDialog, openModal, Modal } from '../ui.js';
import { fmtDate } from '../pdf.js';
import { shareFiles, downloadBlob } from '../share.js';

const APP = 'busted-knuckles-billing';
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' };
const mb = (n) => (n / 1048576).toFixed(n > 10485760 ? 0 : 1) + ' MB';

export async function buildDataZip() {
  const zip = new window.JSZip();
  const data = {};
  for (const t of DATA_TABLES) data[t] = await db[t].toArray();
  zip.file('manifest.json', JSON.stringify({ app: APP, kind: 'data', version: 1, createdAt: now() }, null, 2));
  zip.file('data.json', JSON.stringify(data));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

export async function buildMediaZip() {
  const zip = new window.JSZip();
  const rows = await db.media.toArray();
  const meta = rows.map(({ blob, ...m }) => {
    const file = `media/${m.id}.${EXT[m.type] || (m.kind === 'video' ? 'mp4' : 'jpg')}`;
    zip.file(file, blob);
    return { ...m, file };
  });
  zip.file('manifest.json', JSON.stringify({ app: APP, kind: 'media', version: 1, createdAt: now(), count: rows.length }, null, 2));
  zip.file('media.json', JSON.stringify(meta));
  return zip.generateAsync({ type: 'blob', compression: 'STORE' }); // photos/videos are already compressed
}

// Step 1 builds the zip; step 2 is a separate tap that opens the share menu (iPhone requires the
// share to happen right after a tap, and zipping photos can take several seconds).
function SaveBackupModal({ close, kind }) {
  const [file, setFile] = useState(null);
  const [err, setErr] = useState(null);
  const t = new Date();
  const hhmm = String(t.getHours()).padStart(2, '0') + String(t.getMinutes()).padStart(2, '0');
  const name = `BKB-${kind === 'media' ? 'photos' : 'data'}-${today()}-${hhmm}.zip`;
  useEffect(() => {
    (kind === 'media' ? buildMediaZip() : buildDataZip())
      .then((blob) => setFile(new File([blob], name, { type: 'application/zip' })))
      .catch((e) => setErr(e.message));
  }, []);
  const save = async () => {
    try {
      const r = await shareFiles([file], name, '');
      if (r === null) { downloadBlob(file, name); close(true); } else if (r) close(true);
    } catch (e) { setErr(e.message); }
  };
  return html`<${Modal} title=${kind === 'media' ? 'Back up photos & videos' : 'Back up data'} close=${close}>
    ${err ? html`<p class="error">Backup failed: ${err}</p>`
      : !file ? html`<p>Preparing backup…</p>`
        : html`<p><strong>${name}</strong> (${mb(file.size)}) is ready.</p>
          <p class="hint">Tap below, then choose <strong>Drive</strong> (or <strong>Save to Files</strong>).</p>`}
    <button class="btn primary block big" disabled=${!file} onClick=${save}>${file ? '💾 Save backup…' : 'Preparing…'}</button>
  <//>`;
}

export async function startBackup(kind = 'data') {
  const ok = await openModal(SaveBackupModal, { kind });
  if (!ok) return false;
  await saveSettings({ ...(await getSettings()), [kind === 'media' ? 'lastMediaBackupAt' : 'lastBackupAt']: now() });
  toast(kind === 'media' ? 'Photo backup saved' : 'Backup saved');
  return true;
}

export async function restoreZip(file) {
  const zip = await window.JSZip.loadAsync(file);
  const manifest = JSON.parse(await zip.file('manifest.json')?.async('string') || '{}');
  if (manifest.app !== APP) throw new Error(`${file.name} is not a Busted Knuckles backup.`);
  if (manifest.kind === 'data') {
    const data = JSON.parse(await zip.file('data.json').async('string'));
    await db.transaction('rw', DATA_TABLES.map((t) => db[t]), async () => {
      for (const t of DATA_TABLES) { await db[t].clear(); if (data[t]?.length) await db[t].bulkPut(data[t]); }
    });
    return `Restored data from ${fmtDate(manifest.createdAt?.slice(0, 10))}`;
  }
  if (manifest.kind === 'media') {
    const meta = JSON.parse(await zip.file('media.json').async('string'));
    await db.media.clear();
    for (const m of meta) {
      const f = zip.file(m.file);
      if (!f) continue;
      const blob = new Blob([await f.async('arraybuffer')], { type: m.type });
      const { file: _, ...rest } = m;
      await db.media.put({ ...rest, blob });
    }
    return `Restored ${meta.length} photos/videos`;
  }
  throw new Error('Unknown backup type.');
}

export function BackupPage() {
  const settings = useSettings();
  const stats = useLive(async () => {
    const media = await db.media.toArray();
    return { count: media.length, bytes: media.reduce((a, m) => a + (m.blob?.size || 0), 0) };
  }, []);
  const changes = useLive(async () => changesSinceBackup((await getSettings()).lastBackupAt), []);
  const [busy, setBusy] = useState('');
  const [persisted, setPersisted] = useState(null);
  useEffect(() => { navigator.storage?.persisted?.().then(setPersisted).catch(() => {}); }, []);
  if (!settings || !stats) return html`<${Loading} />`;

  const backupData = () => startBackup('data');
  const backupMedia = () => startBackup('media');
  const restore = async (e) => {
    const files = [...e.currentTarget.files]; e.currentTarget.value = '';
    if (!files.length) return;
    if (!(await confirmDialog('Restore from backup?', 'This REPLACES what is on this phone with the backup. Back up first if you are unsure.', 'Restore', true))) return;
    setBusy('Restoring…');
    try {
      // Data first so settings/counters come back before media.
      files.sort((a, b) => (a.name.includes('photos') ? 1 : 0) - (b.name.includes('photos') ? 1 : 0));
      for (const f of files) toast(await restoreZip(f), 3500);
    } catch (err) { toast('Restore failed: ' + err.message, 5000); } finally { setBusy(''); }
  };

  return html`<div class="page">
    <${Header} title="Backup & restore" back="/" />
    ${busy && html`<div class="banner info">${busy}</div>`}
    <${Section} title="Back up">
      <p>Last data backup: <strong>${settings.lastBackupAt ? fmtDate(settings.lastBackupAt.slice(0, 10)) : 'never'}</strong>
        ${changes?.total > 0 ? html`<br /><span class="overdue">Not backed up yet: ${describeChanges(changes)}</span>` : settings.lastBackupAt ? html`<br /><span class="hint">✅ Everything is backed up</span>` : ''}</p>
      <p class="hint">Tap a button, then choose <strong>Drive</strong> (or “Save to Files”) in the share menu. Keep a couple of weeks of backups.</p>
      <button class="btn primary block big" disabled=${!!busy} onClick=${backupData}>💾 Back up data</button>
      <p class="hint">Customers, machines, quotes, jobs, invoices, payments and settings. Small file.</p>
      <button class="btn block" disabled=${!!busy || !stats.count} onClick=${backupMedia}>🖼 Back up photos & videos (${stats.count}, ${mb(stats.bytes)})</button>
      <p class="hint">A separate, larger file. Last photo backup: ${settings.lastMediaBackupAt ? fmtDate(settings.lastMediaBackupAt.slice(0, 10)) : 'never'}${changes?.photos ? ` · ${changes.photos} new since last data backup` : ''}.</p>
    <//>
    <${Section} title="Restore">
      <p class="hint">Choose a <code>BKB-data-….zip</code> and/or <code>BKB-photos-….zip</code> file. Use this when moving to a new phone.</p>
      <label class=${'btn block' + (busy ? ' disabled' : '')}>📂 Choose backup file(s)…<input type="file" accept=".zip,application/zip" multiple hidden onChange=${restore} /></label>
    <//>
    <${Section} title="Keeping your data safe">
      <ul class="safety">
        <li>${isInstalled() ? '✅ Running as the installed app.' : '⚠️ Running in a browser tab. Install it: Share → Add to Home Screen, then always use the icon.'}</li>
        <li>${persisted ? '✅ The phone has agreed not to clear this app\'s data to free up space.' : '⚠️ The phone has not promised to keep this data. Backups are extra important.'}</li>
        <li>⚠️ <strong>Deleting the app icon deletes all of its data.</strong> Back up first.</li>
        <li>Your data is stored only on this phone, so a lost or broken phone means relying on your latest backup.</li>
      </ul>
    <//>
  </div>`;
}
