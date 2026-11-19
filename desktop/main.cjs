// DnD Map desktop app for the DM: runs the game server on this computer and
// opens the DM screen. Players join from their phones by scanning the QR or
// opening the link shown under Invite; they don't install anything.
const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

if (!app.requestSingleInstanceLock()) app.quit();

let server = null;
let win = null;

/** A secret kept with the app's data, so restoring games after a crash is safe. */
function secretKey(dir) {
  const file = path.join(dir, 'secret-key');
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { /* first run */ }
  const key = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, key, { mode: 0o600 });
  return key;
}

function openWindow(url) {
  win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 900, minHeight: 600,
    backgroundColor: '#0e0d12', title: 'DnD Map', autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.loadURL(url);
  // Links like "Get Ollama" open in the normal browser.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/.test(target) && !target.startsWith(url)) shell.openExternal(target);
    return { action: 'deny' };
  });
  win.on('closed', () => { win = null; });
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(async () => {
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]) : null);
  const data = app.getPath('userData');
  try {
    const { startServer } = require('./app/server.cjs');
    server = await startServer({
      port: Number(process.env.PORT) || 3000,
      dataDir: path.join(data, 'games'),
      staticDir: path.join(__dirname, 'app', 'public'),
      secretKey: secretKey(data),
      anthropicKey: process.env.ANTHROPIC_API_KEY || null,
      aiModel: process.env.AI_MODEL || null,
      ollamaUrl: process.env.OLLAMA_URL || null,
      ollamaModel: process.env.OLLAMA_MODEL || null,
    });
  } catch (e) {
    dialog.showErrorBox('DnD Map could not start', String(e && e.stack || e));
    app.quit();
    return;
  }
  openWindow(server.url);
  app.on('activate', () => { if (!win) openWindow(server.url); });
  // Test hook for CI: load the page, save a picture of the window, and quit.
  if (process.env.DNDMAP_SMOKE) {
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(process.env.DNDMAP_SMOKE, img.toPNG());
      console.log(`smoke ok: ${server.url} -> ${process.env.DNDMAP_SMOKE}`);
      app.quit();
    }, 2500));
  }
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

let quitting = false;
app.on('before-quit', (e) => {
  if (quitting || !server) return;
  // Save every game before leaving.
  e.preventDefault();
  quitting = true;
  server.close().catch(() => {}).finally(() => app.quit());
});
