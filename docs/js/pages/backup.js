import { useState, useEffect } from 'preact/hooks';
import { db, DATA_TABLES, getSettings, saveSettings, today, now, useLive, useSettings } from '../db.js';
import { html, Header, Section, Loading, toast, confirmDialog } from '../ui.js';
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

async function saveOut(blob, name) {
  const file = new File([blob], name, { type: 'application/zip' });
  const r = await shareFiles([file], name, '');
  if (r === null) { downloadBlob(file, name); return true; }
  return r;
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
  const [busy, setBusy] = useState('');
  const [persisted, setPersisted] = useState(null);
  useEffect(() => { navigator.storage?.persisted?.().then(setPersisted).catch(() => {}); }, []);
  if (!settings || !stats) return html`<${Loading} />`;

  const backupData = async () => {
    setBusy('Preparing data backup…');
    try {
      const ok = await saveOut(await buildDataZip(), `BKB-data-${today()}.zip`);
      if (ok) { await saveSettings({ ...(await getSettings()), lastBackupAt: now() }); toast('Backup saved'); }
    } catch (e) { toast('Backup failed: ' + e.message, 4000); } finally { setBusy(''); }
  };
  const backupMedia = async () => {
    setBusy(`Zipping ${stats.count} photos/videos…`);
    try { if (await saveOut(await buildMediaZip(), `BKB-photos-${today()}.zip`)) toast('Photo backup saved'); }
    catch (e) { toast('Photo backup failed: ' + e.message, 4000); } finally { setBusy(''); }
  };
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
      <p>Last backup: <strong>${settings.lastBackupAt ? fmtDate(settings.lastBackupAt.slice(0, 10)) : 'never'}</strong></p>
      <p class="hint">Tap a button, then choose <strong>Drive</strong> (or “Save to Files”) in the share menu. Keep a couple of weeks of backups.</p>
      <button class="btn primary block big" disabled=${!!busy} onClick=${backupData}>💾 Back up data</button>
      <p class="hint">Customers, machines, quotes, jobs, invoices, payments and settings. Small file.</p>
      <button class="btn block" disabled=${!!busy || !stats.count} onClick=${backupMedia}>🖼 Back up photos & videos (${stats.count}, ${mb(stats.bytes)})</button>
      <p class="hint">A separate, larger file. You only need to do this every so often.</p>
    <//>
    <${Section} title="Restore">
      <p class="hint">Choose a <code>BKB-data-….zip</code> and/or <code>BKB-photos-….zip</code> file. Use this when moving to a new phone.</p>
      <label class=${'btn block' + (busy ? ' disabled' : '')}>📂 Choose backup file(s)…<input type="file" accept=".zip,application/zip" multiple hidden onChange=${restore} /></label>
    <//>
    <${Section} title="Storage">
      <p class="hint">${persisted ? '✅ This browser has agreed to keep your data.' : 'For best results on iPhone, open the app from the Home Screen icon (Share → Add to Home Screen).'} Your data stays on this phone. It is not uploaded anywhere.</p>
    <//>
  </div>`;
}
