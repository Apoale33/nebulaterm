'use strict';
// Headless smoke test: boots the Electron main process WITHOUT a window and
// exercises the real engine — Telnet IAC parsing, encrypted session round-trip
// (safeStorage), and native module loading (ssh2, serialport). Run: npm run smoke

const { app } = require('electron');
const assert = require('assert');

app.whenReady().then(async () => {
  const results = [];
  const pass = (n, extra) => results.push(['PASS', n + (extra ? ' — ' + extra : '')]);
  const fail = (n, e) => results.push(['FAIL', n, e && e.message]);

  // 1) Telnet IAC stripping + negotiation
  try {
    const { TelnetStream } = require('./telnet');
    const t = new TelnetStream();
    const sent = [];
    t.socket = { write: (b) => sent.push(Buffer.from(b)), destroyed: false, destroy() {} };
    let clean = Buffer.alloc(0);
    t.on('data', (d) => { clean = Buffer.concat([clean, d]); });
    // "Hi" + IAC DO TTYPE(24) + "!"  -> data must be "Hi!", and we must answer WILL TTYPE
    t._onData(Buffer.from([0x48, 0x69, 255, 253, 24, 0x21]));
    assert.strictEqual(clean.toString(), 'Hi!');
    const reply = Buffer.concat(sent);
    assert.ok(reply.includes(Buffer.from([255, 251, 24])), 'expected IAC WILL TTYPE');
    pass('telnet IAC stripping + negotiation');
  } catch (e) { fail('telnet IAC stripping + negotiation', e); }

  // 2) Encrypted session store round-trip
  try {
    const store = require('./store');
    store.init();
    const rec = store.upsertSession({
      name: '__smoke__', type: 'ssh', host: '127.0.0.1', port: 22,
      username: 'tester', authMethod: 'password', password: 'p@ss-w0rd!',
    });
    assert.ok(rec.id, 'session id assigned');
    assert.strictEqual(rec.hasPassword, true, 'hasPassword flag set');
    assert.strictEqual('password' in rec, false, 'secret not leaked to sanitized record');
    const creds = store.resolveCreds(rec.id);
    const enc = store.encryptionAvailable();
    if (enc) assert.strictEqual(creds.password, 'p@ss-w0rd!', 'decrypt matches');
    store.deleteSession(rec.id);
    assert.ok(!store.getRaw(rec.id), 'session deleted');
    pass('encrypted session round-trip', enc ? 'safeStorage active' : 'encryption unavailable on host');
  } catch (e) { fail('encrypted session round-trip', e); }

  // 3) Native modules load inside Electron
  try { require('ssh2').Client; pass('require ssh2'); } catch (e) { fail('require ssh2', e); }
  try {
    const { SerialPort } = require('serialport');
    const ports = await SerialPort.list();
    pass('serialport native binding', ports.length + ' port(s) enumerated');
  } catch (e) { fail('serialport native binding', e); }

  // 4) Settings persistence
  try {
    const settings = require('./settings');
    settings.init();
    const before = settings.get().fontSize;
    settings.set({ fontSize: before + 1 });
    assert.strictEqual(settings.get().fontSize, before + 1);
    settings.set({ fontSize: before });
    pass('settings persistence');
  } catch (e) { fail('settings persistence', e); }

  // 5) SSH connect end-to-end IN THIS RUNTIME — guards the Electron/BoringSSL
  // algorithm trap (BoringSSL lacks chacha20-poly1305; a replaced cipher list
  // forcing it made ssh2 throw "Unsupported algorithm" and broke every SSH login).
  await new Promise((resolve) => {
    try {
      const crypto = require('crypto');
      const { Server } = require('ssh2');
      const { ConnectionManager } = require('./connections');
      const hostKey = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
        publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
      }).privateKey;
      const server = new Server({ hostKeys: [hostKey] }, (client) => {
        client.on('authentication', (ctx) => ctx.accept());
        client.on('ready', () => client.on('session', (accept) => {
          const s = accept();
          s.on('pty', (a) => a && a());
          s.on('shell', (a) => { const st = a(); st.write('ok\r\n'); });
        }));
      });
      let done = false;
      const finish = (ok, msg) => { if (done) return; done = true; ok ? pass('ssh connect in this runtime (BoringSSL-safe)') : fail('ssh connect in this runtime', new Error(msg)); try { server.close(); } catch {} resolve(); };
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        let data = '';
        const cm = new ConnectionManager((id, ev, p) => {
          if (ev === 'data') { data += p.toString(); if (data.includes('ok')) finish(true); }
          if (ev === 'status' && p.state === 'error') finish(false, p.message);
        });
        cm.open({ type: 'ssh', host: '127.0.0.1', port, username: 'x', password: 'x', authMethod: 'password', legacyAlgos: true, cols: 80, rows: 24 });
        setTimeout(() => finish(false, 'timeout / no shell data'), 2500);
      });
    } catch (e) { fail('ssh connect in this runtime', e); resolve(); }
  });

  let failed = 0;
  console.log('\n  NebulaTerm smoke test');
  console.log('  ---------------------');
  for (const r of results) {
    if (r[0] === 'FAIL') { failed++; console.log(`  ✗ ${r[1]}${r[2] ? '  (' + r[2] + ')' : ''}`); }
    else console.log(`  ✓ ${r[1]}`);
  }
  console.log('  ---------------------');
  console.log(failed ? `  RESULT: FAILED (${failed})\n` : `  RESULT: ALL PASS\n`);
  app.exit(failed ? 1 : 0);
});
