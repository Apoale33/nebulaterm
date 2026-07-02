'use strict';
const { app, BrowserWindow, ipcMain, Menu, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { SerialPort } = require('serialport');
const store = require('./store');
const settings = require('./settings');
const { ConnectionManager } = require('./connections');
const { parseTargets, startScan } = require('./scanner');
const { TftpServer } = require('./tftp');
const { Pinger } = require('./pinger');

const activeScans = new Map();
const activePings = new Map();
let tftpServer = null;

const SITE_URL = 'https://packetnebula.com';
const SMOKE = process.env.NEBULA_SMOKE === '1';
const SHOT = process.env.NEBULA_SHOT === '1';

let mainWindow = null;
let connections = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 880,
    minHeight: 540,
    show: !SMOKE,
    backgroundColor: '#0f141a',
    title: 'NebulaTerm',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; for (const w of [...toolWindows]) { try { w.close(); } catch {} } });

  // Safety: warn before quitting while sessions are still connected.
  let forceClose = false;
  mainWindow.on('close', (e) => {
    if (forceClose || SMOKE || SHOT) return;
    const n = connections ? connections.conns.size : 0;
    if (n > 0 && settings.get().confirmOnQuit) {
      const choice = dialog.showMessageBoxSync(mainWindow, {
        type: 'warning',
        buttons: ['Cancel', 'Close anyway'],
        defaultId: 0, cancelId: 0,
        title: 'NebulaTerm',
        message: `${n} active session${n > 1 ? 's' : ''} still connected`,
        detail: 'Closing NebulaTerm will disconnect them.',
      });
      if (choice === 0) { e.preventDefault(); return; }
    }
    forceClose = true;
  });

  if (SMOKE) wireUiSmoke();
  if (SHOT) wireScreenshot();
}

// Render real screenshots of the UI for the README, fully headless via
// webContents.capturePage(). Seeds demo sessions + a presentation terminal
// (no real connection) so the shots show the app in use.
function wireScreenshot() {
  const wc = mainWindow.webContents;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const outDir = path.join(__dirname, '..', '..', 'assets');
  fs.mkdirSync(outDir, { recursive: true });

  const B = '\x1b[1m\x1b[38;2;31;111;235m', R = '\x1b[0m'; // typed commands: bold button-blue
  const demoLines = [
    'core-sw-01> ' + B + 'enable' + R,
    'core-sw-01# ' + B + 'show ip interface brief' + R,
    'Interface              IP-Address      OK? Method Status                Protocol',
    'GigabitEthernet0/0     10.0.0.1        YES NVRAM  up                    up',
    'GigabitEthernet0/1     unassigned      YES NVRAM  administratively down down',
    'GigabitEthernet0/2     10.10.20.1      YES manual up                    up',
    'TenGigabitEthernet1/1  10.255.0.1      YES NVRAM  up                    up',
    'Vlan1                  10.0.0.1        YES NVRAM  up                    up',
    'core-sw-01# ' + B + 'show version | include IOS' + R,
    'Cisco IOS Software, C3560CX Software, Version 15.2(4)E10, RELEASE SOFTWARE',
    'core-sw-01# ',
  ];
  const seed = `
    window.__nebulaDemo.seed([
      { id:'d1', type:'ssh', name:'core-sw-01', host:'10.0.0.1', port:22, username:'admin', folder:'Datacenter', authMethod:'password', hasPassword:true, legacyAlgos:true, logging:true, color:'#18874d' },
      { id:'d2', type:'ssh', name:'core-sw-02', host:'10.0.0.2', port:22, username:'admin', folder:'Datacenter', authMethod:'password', hasPassword:true, color:'#18874d' },
      { id:'d3', type:'ssh', name:'edge-fw-01', host:'10.0.0.254', port:22, username:'netadmin', folder:'Datacenter', authMethod:'key', hasPassword:false, color:'#cf3a3a' },
      { id:'d4', type:'serial', name:'console-3850', comPort:'COM3', baudRate:9600, folder:'Lab Bench', color:'#d1741f' },
      { id:'d5', type:'telnet', name:'old-router', host:'192.168.1.1', port:23, folder:'Lab Bench' },
      { id:'d6', type:'ssh', name:'home-server', host:'192.168.1.50', port:22, username:'steph', authMethod:'key', color:'#0891b2' }
    ]);
    window.__nebulaDemo.fakeTerm({ name:'core-sw-01', type:'ssh', host:'10.0.0.1', port:22, username:'admin', vendor:'cisco-ios', logging:true, log:'logs/core-sw-01_2026-06-24.log' }, ${JSON.stringify(demoLines)});
  `;

  wc.on('did-finish-load', async () => {
    try {
      await wait(1000);
      await wc.executeJavaScript(seed);
      await wait(1300);
      let img = await wc.capturePage();
      fs.writeFileSync(path.join(outDir, 'screenshot.png'), img.toPNG());

      // Commands docked to the right (terminal stays visible beside it)
      await wc.executeJavaScript(`window.__nebulaDemo.openTool('commands');`);
      await wait(700);
      img = await wc.capturePage();
      fs.writeFileSync(path.join(outDir, 'commands.png'), img.toPNG());

      // Multi-ping docked (sparkline history) + Subnet popped out to a floating window
      await wc.executeJavaScript(`
        window.__nebulaDemo.openTool('multiping');
        window.__nebulaDemo.seedPing([
          {ip:'10.0.0.1',up:true,last:1,avg:1,loss:0},
          {ip:'10.0.0.2',up:true,last:2,avg:2,loss:0},
          {ip:'10.0.0.10',up:true,last:6,avg:5,loss:0},
          {ip:'10.0.0.20',up:false,last:null,avg:null,loss:100},
          {ip:'10.0.0.50',up:true,last:3,avg:3,loss:0},
          {ip:'10.0.0.254',up:true,last:1,avg:1,loss:0}
        ]);
        window.__nebulaDemo.openTool('subnet');
        window.__nebulaDemo.floatTool('subnet');
        setTimeout(() => {
          const subs = [...document.querySelectorAll('.fpanel-body input[type=text]')];
          for (const i of subs) { if (i.placeholder && i.placeholder.includes('255.255')) { i.value='10.0.0.0/24'; i.dispatchEvent(new Event('input')); } }
          const fp = document.querySelector('#float-layer .fpanel');
          if (fp) { fp.style.left='300px'; fp.style.top='340px'; }
        }, 80);
      `);
      await wait(900);
      img = await wc.capturePage();
      fs.writeFileSync(path.join(outDir, 'tools.png'), img.toPNG());

      // Welcome screen
      await wc.executeJavaScript(`window.__nebulaDemo.reset();`);
      await wait(700);
      img = await wc.capturePage();
      fs.writeFileSync(path.join(outDir, 'welcome.png'), img.toPNG());
      console.log('Screenshots written to', outDir);
      app.exit(0);
    } catch (e) {
      console.error('screenshot failed:', e);
      app.exit(1);
    }
  });
}

// Headless renderer check: load the UI in a hidden window, confirm xterm/nebula
// and the DOM initialized, and fail on any uncaught renderer error.
function wireUiSmoke() {
  const wc = mainWindow.webContents;
  const errors = [];
  const bad = /uncaught|is not defined|cannot read|failed to load|refused to|syntaxerror/i;
  wc.on('console-message', (...a) => {
    const msg = typeof a[2] === 'string' ? a[2] : (a[0] && a[0].message) || '';
    if (msg && bad.test(msg)) errors.push(msg);
  });
  wc.on('render-process-gone', (_e, d) => errors.push('render-process-gone: ' + d.reason));
  wc.on('did-fail-load', (_e, code, desc, url) => errors.push(`did-fail-load ${code} ${desc} ${url}`));
  wc.on('did-finish-load', async () => {
    await new Promise((r) => setTimeout(r, 1200));
    let probe = {};
    try {
      probe = await wc.executeJavaScript(`(() => ({
        terminal: typeof window.Terminal !== 'undefined',
        nebula: typeof window.nebula !== 'undefined',
        fit: !!(window.FitAddon && window.FitAddon.FitAddon),
        search: !!(window.SearchAddon && window.SearchAddon.SearchAddon),
        welcome: !!document.querySelector('.welcome'),
        sidebar: !!document.querySelector('#session-list'),
      }))()`);
    } catch (e) { errors.push('probe failed: ' + e.message); }
    // Detached tool window (#tool=…) renders in its own OS window
    try {
      const tw = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false } });
      const derr = [];
      tw.webContents.on('console-message', (...a) => { const m = typeof a[2] === 'string' ? a[2] : (a[0] && a[0].message) || ''; if (m && bad.test(m)) derr.push(m); });
      await new Promise((res) => { tw.webContents.once('did-finish-load', res); tw.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), { hash: 'tool=multiping' }); });
      await new Promise((r) => setTimeout(r, 900));
      probe.detachedWindow = await tw.webContents.executeJavaScript(`!!document.querySelector('.detached-host') && document.body.classList.contains('detached')`) && derr.length === 0;
      tw.destroy();
    } catch (e) { probe.detachedWindow = false; errors.push('detached: ' + e.message); }

    const ok = Object.values(probe).every(Boolean);
    console.log('\n  NebulaTerm UI smoke');
    console.log('  -------------------');
    for (const [k, v] of Object.entries(probe)) console.log(`  ${v ? '✓' : '✗'} ${k}`);
    if (errors.length) { console.log('  renderer errors:'); errors.forEach((e) => console.log('   ! ' + e)); }
    console.log('  -------------------');
    console.log(ok && !errors.length ? '  RESULT: UI OK\n' : '  RESULT: UI FAILED\n');
    app.exit(ok && !errors.length ? 0 : 1);
  });
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

// Engine events (scan / ping / tftp) go to every window, so a tool detached into
// its own OS window receives them too. Each window ignores ids it didn't start.
function broadcast(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) { if (!w.isDestroyed()) w.webContents.send(channel, payload); }
}

const toolWindows = new Set();
const TOOL_WIN = {
  scanner: { title: 'IP scanner', w: 400, h: 540 },
  multiping: { title: 'Multi-ping', w: 580, h: 560 },
  tftp: { title: 'TFTP server', w: 460, h: 540 },
  subnet: { title: 'Subnet calculator', w: 380, h: 380 },
};
function createToolWindow(key) {
  const def = TOOL_WIN[key];
  if (!def) return { error: 'not detachable' };
  const w = new BrowserWindow({
    width: def.w, height: def.h, minWidth: 300, minHeight: 220,
    title: 'NebulaTerm — ' + def.title,
    backgroundColor: '#0f141a',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  });
  w.setMenuBarVisibility(false);
  w.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), { hash: 'tool=' + key });
  toolWindows.add(w);
  w.on('closed', () => toolWindows.delete(w));
  return { ok: true };
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const m = (action) => () => send('menu:action', action);
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'Session',
      submenu: [
        { label: 'New Session…', accelerator: 'CmdOrCtrl+N', click: m('new-session') },
        { label: 'Quick Connect…', accelerator: 'CmdOrCtrl+Shift+N', click: m('quick-connect') },
        { type: 'separator' },
        { label: 'Import sessions…', click: m('import-sessions') },
        { label: 'Export sessions…', click: m('export-sessions') },
        { type: 'separator' },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: m('close-tab') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Copy', accelerator: 'CmdOrCtrl+Shift+C', click: m('copy') },
        { label: 'Paste', accelerator: 'CmdOrCtrl+Shift+V', click: m('paste') },
        { label: 'Find…', accelerator: 'CmdOrCtrl+F', click: m('find') },
        { type: 'separator' },
        { label: 'Clear Terminal', click: m('clear') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Theme', accelerator: 'CmdOrCtrl+T', click: m('toggle-theme') },
        { label: 'Increase Font Size', accelerator: 'CmdOrCtrl+=', click: m('font-inc') },
        { label: 'Decrease Font Size', accelerator: 'CmdOrCtrl+-', click: m('font-dec') },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: m('settings') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'PacketNebula.com', click: () => shell.openExternal(SITE_URL) },
        { label: 'Free Network Tools', click: () => shell.openExternal(SITE_URL + '/tools/') },
        { type: 'separator' },
        { label: 'About NebulaTerm', click: m('about') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpc() {
  ipcMain.handle('sessions:list', () => store.listSessions());
  ipcMain.handle('sessions:save', (_e, s) => store.upsertSession(s));
  ipcMain.handle('sessions:delete', (_e, id) => { store.deleteSession(id); return true; });
  ipcMain.handle('sessions:export', async () => {
    const r = await dialog.showSaveDialog(mainWindow, { title: 'Export sessions', defaultPath: 'nebulaterm-sessions.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled) return { canceled: true };
    try {
      const list = store.listSessions();
      fs.writeFileSync(r.filePath, JSON.stringify({ nebulaterm: 'sessions', version: 1, sessions: list }, null, 2), 'utf8');
      return { ok: true, count: list.length };
    } catch (e) { return { error: e.message }; }
  });
  ipcMain.handle('sessions:import', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Import sessions', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled) return { canceled: true };
    try {
      const data = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
      const list = Array.isArray(data) ? data : (data.sessions || []);
      let n = 0;
      for (const s of list) {
        if (!s || typeof s !== 'object') continue;
        const { id, hasPassword, hasPassphrase, createdAt, updatedAt, lastUsed, ...rest } = s;
        store.upsertSession(rest); n++;
      }
      return { ok: true, count: n };
    } catch (e) { return { error: e.message }; }
  });
  ipcMain.handle('crypto:available', () => store.encryptionAvailable());

  ipcMain.handle('serial:list', async () => {
    try {
      const ports = await SerialPort.list();
      return ports.map((p) => ({
        path: p.path,
        manufacturer: p.manufacturer || '',
        serialNumber: p.serialNumber || '',
        pnpId: p.pnpId || '',
        friendlyName: p.friendlyName || '',
      }));
    } catch {
      return [];
    }
  });

  ipcMain.handle('settings:get', () => settings.get());
  ipcMain.handle('settings:set', (_e, patch) => settings.set(patch));

  ipcMain.handle('conn:open', (_e, cfg) => {
    const s = settings.get();
    const launch = { ...cfg };
    if (cfg.sessionId) {
      const creds = store.resolveCreds(cfg.sessionId);
      if (!launch.password) launch.password = creds.password;
      if (!launch.passphrase) launch.passphrase = creds.passphrase;
      store.touchSession(cfg.sessionId);
    }
    launch.logClean = s.logClean;
    if (launch.logging && !launch.logDir) launch.logDir = s.logDir;
    return connections.open(launch);
  });

  ipcMain.on('conn:write', (_e, { id, data }) => connections.write(id, data));
  ipcMain.on('conn:resize', (_e, { id, cols, rows }) => connections.resize(id, cols, rows));
  ipcMain.on('conn:close', (_e, { id }) => connections.close(id));

  // Network scanner
  ipcMain.handle('scan:parse', (_e, input) => {
    const r = parseTargets(input);
    return Array.isArray(r) ? { ok: true, count: r.length, first: r[0], last: r[r.length - 1] } : r;
  });
  ipcMain.handle('scan:start', (_e, opts) => {
    const targets = parseTargets(opts.input);
    if (!Array.isArray(targets)) return targets; // { error }
    const scanId = 'scan_' + Date.now();
    const handle = startScan({ ...opts, targets }, (ev) => broadcast('scan:event', { scanId, ...ev }));
    activeScans.set(scanId, handle);
    return { scanId, total: targets.length };
  });
  ipcMain.on('scan:stop', (_e, { scanId }) => {
    const h = activeScans.get(scanId);
    if (h) { h.stop(); activeScans.delete(scanId); }
  });

  // Multi-ping (continuous)
  ipcMain.handle('ping:start', (_e, { input, interval }) => {
    const targets = parseTargets(input);
    if (!Array.isArray(targets)) return targets;
    if (targets.length > 256) return { error: `Too many hosts for live ping: ${targets.length} (max 256). Use the IP scanner for big ranges.` };
    const pingId = 'ping_' + Date.now();
    const p = new Pinger(targets, { interval: Number(interval) || 1000 }, (ev) => broadcast('ping:event', { pingId, ...ev }));
    activePings.set(pingId, p); p.start();
    return { pingId, total: targets.length, targets };
  });
  ipcMain.on('ping:stop', (_e, { pingId }) => {
    const p = activePings.get(pingId);
    if (p) { p.stop(); activePings.delete(pingId); }
  });

  // TFTP server
  ipcMain.handle('tftp:start', async (_e, { root, port }) => {
    try {
      if (tftpServer) { tftpServer.stop(); tftpServer = null; }
      const dir = root || path.join(app.getPath('userData'), 'tftp');
      const srv = new TftpServer(dir, (ev) => broadcast('tftp:event', ev));
      const res = await srv.start(Number(port) || 69);
      tftpServer = srv;
      return { ok: true, ...res };
    } catch (e) {
      const p = port || 69;
      if (e.code === 'EACCES') return { error: `Port ${p} is blocked (try a port above 1024).` };
      if (e.code === 'EADDRINUSE') return { error: `Port ${p} is already in use (another TFTP server?).` };
      return { error: e.message };
    }
  });
  ipcMain.handle('tftp:stop', () => { if (tftpServer) { tftpServer.stop(); tftpServer = null; } return { ok: true }; });
  ipcMain.handle('tftp:reveal', () => { if (tftpServer) shell.openPath(tftpServer.root); return true; });
  ipcMain.handle('dialog:chooseDir', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Choose folder', properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });

  // Local consoles + config file
  ipcMain.handle('app:openConsole', (_e, which) => {
    if (process.platform !== 'win32') return { error: 'Windows only' };
    exec(which === 'powershell' ? 'start "" powershell.exe' : 'start "" cmd.exe', { windowsHide: false });
    return { ok: true };
  });
  ipcMain.handle('tool:detach', (_e, key) => createToolWindow(key));
  ipcMain.handle('dialog:openConfig', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Select a config file to send',
      properties: ['openFile'],
      filters: [{ name: 'Config files', extensions: ['cfg', 'conf', 'txt', 'ios', 'rsc', 'set'] }, { name: 'All files', extensions: ['*'] }],
    });
    if (r.canceled) return null;
    try {
      const text = fs.readFileSync(r.filePaths[0], 'utf8');
      return { path: r.filePaths[0], name: path.basename(r.filePaths[0]), text, lineCount: text.split(/\r?\n/).length };
    } catch (e) { return { error: e.message }; }
  });

  ipcMain.handle('dialog:openKey', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Select OpenSSH private key',
      properties: ['openFile'],
      filters: [
        { name: 'Private keys', extensions: ['pem', 'key', 'rsa', 'ed25519', 'ecdsa'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('dialog:chooseLogDir', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose log folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('app:openExternal', (_e, url) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return true;
  });
}

app.whenReady().then(() => {
  settings.init();
  store.init();
  connections = new ConnectionManager((id, event, payload) => send('conn:event', { id, event, payload }));
  buildMenu();
  registerIpc();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (connections) connections.closeAll();
  if (tftpServer) { tftpServer.stop(); tftpServer = null; }
  for (const p of activePings.values()) p.stop();
  activePings.clear();
  if (process.platform !== 'darwin') app.quit();
});
