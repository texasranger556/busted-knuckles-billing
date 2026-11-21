// App updates: the version lives in sw.js (VERSION). Checking asks the browser to re-fetch sw.js from
// the website; if it changed, the new version downloads all app files and takes over.

export async function getAppVersion() {
  const ctrl = navigator.serviceWorker?.controller;
  if (!ctrl) return null;
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    const t = setTimeout(() => resolve(null), 1500);
    ch.port1.onmessage = (e) => { clearTimeout(t); resolve(e.data); };
    ctrl.postMessage('version', [ch.port2]);
  });
}

const waitForActive = (sw) => new Promise((resolve, reject) => {
  if (sw.state === 'activated') return resolve();
  const t = setTimeout(() => reject(new Error('The update took too long to download. Try again with a better signal.')), 60000);
  sw.addEventListener('statechange', () => {
    if (sw.state === 'activated') { clearTimeout(t); resolve(); }
    if (sw.state === 'redundant') { clearTimeout(t); reject(new Error('The update could not be installed. Try again.')); }
  });
});

// Returns { status: 'current' | 'updated' | 'offline' | 'unsupported' | 'error', version?, message? }
export async function checkForUpdates() {
  if (!('serviceWorker' in navigator)) return { status: 'unsupported' };
  if (!navigator.onLine) return { status: 'offline' };
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return { status: 'unsupported' };
  try {
    await reg.update();
    const incoming = reg.installing || reg.waiting;
    if (!incoming) return { status: 'current', version: await getAppVersion() };
    await waitForActive(incoming);
    return { status: 'updated' };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}
