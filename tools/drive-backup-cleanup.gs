/**
 * Busted Knuckles Billing – Google Drive backup cleanup
 *
 * Runs once a day inside your own Google account (Google Apps Script) and keeps only the newest
 * backups. Older ones are moved to the Drive Trash, where Google keeps them 30 more days.
 *
 * It finds backups anywhere in your Drive by file name, so it works no matter which folder they
 * were saved to:  BKB-data-YYYY-MM-DD.zip  and  BKB-photos-YYYY-MM-DD.zip
 *
 * Setup: see "Automatically keep only the last N backups" in the README.
 */

// ---- Settings: change these numbers if you like ----
const KEEP_DATA_BACKUPS = 14;   // newest data backups to keep (each is tiny, a few KB)
const KEEP_PHOTO_BACKUPS = 3;   // newest photo/video backups to keep (these can be large)

/** The daily job. You can also run it by hand from the editor to test it. */
function cleanUpBackups() {
  const data = trimBackups_('BKB-data-', KEEP_DATA_BACKUPS);
  const photos = trimBackups_('BKB-photos-', KEEP_PHOTO_BACKUPS);
  console.log(`Data backups: kept ${data.kept}, trashed ${data.trashed}. ` +
              `Photo backups: kept ${photos.kept}, trashed ${photos.trashed}.`);
}

function trimBackups_(prefix, keep) {
  const files = [];
  const it = DriveApp.searchFiles(`title contains '${prefix}' and trashed = false`);
  while (it.hasNext()) {
    const f = it.next();
    // Double-check the name, and only touch files you own.
    if (f.getName().indexOf(prefix) === 0 && /\.zip$/i.test(f.getName()) &&
        f.getOwner() && f.getOwner().getEmail() === Session.getEffectiveUser().getEmail()) {
      files.push(f);
    }
  }
  // Newest first (by when the file was uploaded to Drive).
  files.sort((a, b) => b.getDateCreated().getTime() - a.getDateCreated().getTime());
  const keepCount = Math.max(1, keep); // never delete the only backup
  const old = files.slice(keepCount);
  old.forEach((f) => f.setTrashed(true));
  return { kept: files.length - old.length, trashed: old.length };
}

/** Run this ONCE to schedule cleanUpBackups every day around 3 AM. Safe to run again. */
function installDailyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'cleanUpBackups')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('cleanUpBackups').timeBased().everyDays(1).atHour(3).create();
  console.log('Daily cleanup scheduled.');
}
