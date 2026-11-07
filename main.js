const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const path = require('path'), fs = require('fs'), os = require('os');
const { execFile } = require('child_process');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { print, getPrinters } = require('pdf-to-printer');
const { compose } = require('./compose');

let win;
const DIR = () => app.getPath('userData'), DB = () => path.join(DIR(), 'mulhim.json');
const MM = v => v * 72 / 25.4, cancelled = new Set();

function backup() { // one backup per day, keep last 30
  try {
    const b = path.join(DIR(), 'backups'); fs.mkdirSync(b, { recursive: true });
    const f = path.join(b, 'mulhim-' + new Date().toLocaleDateString('en-CA') + '.json');
    if (fs.existsSync(DB()) && !fs.existsSync(f)) fs.copyFileSync(DB(), f);
    fs.readdirSync(b).sort().slice(0, -30).forEach(x => fs.unlinkSync(path.join(b, x)));
  } catch {}
}
app.whenReady().then(() => {
  backup(); loadSess();
  win = new BrowserWindow({ width: 1320, height: 860, autoHideMenuBar: true, icon: path.join(__dirname, 'build', 'icon.ico'), title: 'ملهم طباعة', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true } });
  win.loadFile('index.html');
});
app.on('window-all-closed', () => app.quit());

ipcMain.handle('store:get', () => { try { return JSON.parse(fs.readFileSync(DB(), 'utf8')); } catch { return null; } });
ipcMain.handle('store:set', (_, d) => { fs.writeFileSync(DB() + '.tmp', JSON.stringify(d)); fs.renameSync(DB() + '.tmp', DB()); return true; });
ipcMain.handle('data:info', () => ({ path: DB(), dir: DIR(), version: app.getVersion(), size: fs.existsSync(DB()) ? fs.statSync(DB()).size : 0 }));
ipcMain.handle('data:open', () => shell.openPath(DIR()));
ipcMain.handle('data:export', async () => {
  const r = await dialog.showSaveDialog({ defaultPath: 'mulhim-backup-' + new Date().toLocaleDateString('en-CA') + '.json' });
  if (r.canceled) return false; fs.copyFileSync(DB(), r.filePath); return true;
});
ipcMain.handle('data:import', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled) return null;
  try { return JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')); } catch { return null; }
});
ipcMain.handle('file:save', async (_, { name, text }) => {
  const r = await dialog.showSaveDialog({ defaultPath: name });
  if (r.canceled) return false; fs.writeFileSync(r.filePath, text, 'utf8'); return true;
});

// printers: Windows-native list first (most reliable), pdf-to-printer as fallback
ipcMain.handle('printers:list', async () => {
  const out = new Map(), errs = [];
  try { (await win.webContents.getPrintersAsync()).forEach(p => out.set(p.name, { name: p.name })); } catch (e) { errs.push('native: ' + e.message); }
  try { (await getPrinters()).forEach(p => { const n = p.name || p.deviceId; if (n && !out.has(n)) out.set(n, { name: n }); }); } catch (e) { errs.push('fallback: ' + e.message); }
  return { list: [...out.values()], errs };
});
ipcMain.handle('printers:test', async (_, { name, label }) => {
  try {
    const d = await PDFDocument.create(), pg = d.addPage([MM(210), MM(297)]), f = await d.embedFont(StandardFonts.HelveticaBold);
    pg.drawText(label, { x: 50, y: 520, size: 60, font: f, color: rgb(0, 0, 0) });
    pg.drawText(name.replace(/[^\x20-\x7e]/g, '?'), { x: 50, y: 470, size: 14, font: f });
    const file = path.join(os.tmpdir(), 'mulhim-test.pdf'); fs.writeFileSync(file, await d.save());
    await print(file, { printer: name, silent: true }); return { ok: true };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
});
ipcMain.handle('printers:purge', async (_, names) => {
  const res = [];
  for (const n of names) await new Promise(r => execFile('powershell', ['-NoProfile', '-Command', `Get-PrintJob -PrinterName '${n.replace(/'/g, "''")}' | Remove-PrintJob`], { windowsHide: true }, e => { res.push(e ? 'خطأ' : 'تمام'); r(); }));
  return res;
});

ipcMain.handle('file:pick', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'], filters: [{ name: 'PDF / صور', extensions: ['pdf', 'jpg', 'jpeg', 'png'] }] });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('file:info', async (_, p) => {
  const ext = path.extname(p).toLowerCase(); let pages = 1;
  if (ext === '.pdf') pages = (await PDFDocument.load(fs.readFileSync(p), { ignoreEncryption: true })).getPageCount();
  return { path: p, name: path.basename(p), type: ext === '.pdf' ? 'pdf' : 'img', pages };
});

ipcMain.handle('job:cancel', (_, id) => { cancelled.add(id); return true; });
ipcMain.handle('job:run', async (_, j) => {
  cancelled.delete(j.id);
  try {
    const f = await compose(j);
    const land = j.layout === 'nup2' || j.layout === 'booklet', dup = j.duplex || j.layout === 'booklet';
    const side = !dup ? 'simplex' : j.edge === 'long' ? 'duplexlong' : j.edge === 'short' ? 'duplexshort' : (land ? 'duplexshort' : 'duplexlong');
    for (const [printer, n] of Object.entries(j.alloc)) {
      if (!n) continue;
      if (cancelled.has(j.id)) break;
      await print(f, { printer, copies: n, silent: true, scale: 'noscale', monochrome: !j.color, orientation: land ? 'landscape' : 'portrait', side, paperSize: j.driverSize || undefined, bin: j.bin || undefined });
    }
    fs.unlink(f, () => {});
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
});

// ---------- Supabase cloud backup (publishable key is safe: RLS limits every row to the signed-in user) ----------
const SB = { url: 'https://hkmtvvowygldmunhxjhz.supabase.co', key: 'sb_publishable_jDaXEn4bHrXdBWZzBLoWqA_jYsMsIJz' };
let sess = null;
const SF = () => path.join(DIR(), 'session.bin');
function loadSess() { try { if (safeStorage.isEncryptionAvailable()) sess = JSON.parse(safeStorage.decryptString(fs.readFileSync(SF()))); } catch {} }
function saveSess() { try { if (sess && safeStorage.isEncryptionAvailable()) fs.writeFileSync(SF(), safeStorage.encryptString(JSON.stringify(sess))); else fs.rmSync(SF(), { force: true }); } catch {} }
async function takeToken(r, email) {
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description || j.msg || j.message || 'خطأ');
  sess = { access: j.access_token, refresh: j.refresh_token, exp: Date.now() + (j.expires_in - 60) * 1000, email: email || sess?.email || j.user?.email || '' };
  saveSess();
}
async function token() {
  if (!sess) throw new Error('مش مسجل دخول');
  if (Date.now() > sess.exp) {
    try {
      await takeToken(await fetch(`${SB.url}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: SB.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: sess.refresh }) }));
    } catch (e) { sess = null; saveSess(); throw new Error('سجّل دخول تاني'); }
  }
  return sess.access;
}
async function rest(p, opt = {}) {
  const t = await token();
  const r = await fetch(SB.url + '/rest/v1/' + p, { ...opt, headers: { apikey: SB.key, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json', ...(opt.headers || {}) } });
  if (!r.ok) throw new Error((await r.text()).slice(0, 200));
  return r.json().catch(() => null);
}
ipcMain.handle('cloud:status', () => ({ in: !!sess, email: sess?.email || '' }));
ipcMain.handle('cloud:logout', () => { sess = null; saveSess(); return true; });
ipcMain.handle('cloud:login', async (_, { email, password }) => {
  try {
    await takeToken(await fetch(`${SB.url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: SB.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }), email);
    return { ok: true, persisted: safeStorage.isEncryptionAvailable() };
  } catch (e) { return { ok: false, error: /invalid|credentials/i.test(e.message) ? 'الإيميل أو الباسورد غلط' : 'مفيش اتصال أو خطأ: ' + e.message }; }
});
ipcMain.handle('cloud:push', async (_, data) => {
  try {
    const day = new Date().toLocaleDateString('en-CA');
    await rest('mulhim_backups?on_conflict=user_id,day', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([{ day, data, app_version: app.getVersion(), updated_at: new Date().toISOString() }]) });
    const old = new Date(Date.now() - 90 * 864e5).toLocaleDateString('en-CA');
    rest('mulhim_backups?day=lt.' + old, { method: 'DELETE' }).catch(() => {});
    return { ok: true, at: Date.now() };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('cloud:list', async () => {
  try { return { ok: true, list: await rest('mulhim_backups?select=day,updated_at,app_version&order=day.desc&limit=30') || [] }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('cloud:pull', async (_, day) => {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('تاريخ غلط');
    const r = await rest(`mulhim_backups?select=data&day=eq.${day}&limit=1`);
    return { ok: true, data: r?.[0]?.data || null };
  } catch (e) { return { ok: false, error: e.message }; }
});
