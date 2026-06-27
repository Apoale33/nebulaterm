'use strict';
// End-to-end SSH test against an in-process ssh2 server, driven through the real
// ConnectionManager (the exact code the app uses). Validates password auth, shell
// allocation, bidirectional data, window resize and clean close.
// Run: node scripts/test-ssh-live.js
const crypto = require('crypto');
const { Server } = require('ssh2');
const { ConnectionManager } = require('../src/main/connections');

const hostKey = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
}).privateKey;

let sawResize = false;

const server = new Server({ hostKeys: [hostKey] }, (client) => {
  client.on('authentication', (ctx) => {
    if (ctx.method === 'password' && ctx.username === 'test' && ctx.password === 'pass') return ctx.accept();
    if (ctx.method === 'none') return ctx.reject(['password']);
    return ctx.reject();
  });
  client.on('ready', () => {
    client.on('session', (accept) => {
      const session = accept();
      session.on('pty', (acc) => acc && acc());
      session.on('window-change', (acc, _rej, info) => { sawResize = !!(info && info.cols); if (acc) acc(); });
      session.on('shell', (acc) => {
        const stream = acc();
        stream.write('Welcome to test-ssh\r\n$ ');
        stream.on('data', (d) => {
          stream.write(d); // echo
          if (d.toString().includes('\r')) stream.write('\r\nbuilt-ok\r\n$ ');
        });
      });
    });
  });
});

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  let data = '';
  const states = [];
  const cm = new ConnectionManager((id, event, payload) => {
    if (event === 'data') data += payload.toString();
    if (event === 'status') states.push(payload.state);
  });
  const { id } = cm.open({
    type: 'ssh', host: '127.0.0.1', port, username: 'test', password: 'pass',
    authMethod: 'password', legacyAlgos: true, cols: 80, rows: 24,
  });

  setTimeout(() => cm.write(id, 'show version\r'), 700);
  setTimeout(() => cm.resize(id, 120, 40), 900);
  setTimeout(() => {
    const checks = {
      connected: states.includes('connected'),
      banner: data.includes('Welcome to test-ssh'),
      echo: data.includes('show version'),
      serverReplied: data.includes('built-ok'),
      resizeDelivered: sawResize,
    };
    cm.close(id);
    server.close();
    const ok = Object.values(checks).every(Boolean);
    console.log('\n  SSH live (in-process ssh2 server)');
    console.log('  ---------------------------------');
    for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? '✓' : '✗'} ${k}`);
    console.log('  ---------------------------------');
    console.log(ok ? '  RESULT: OK\n' : '  RESULT: FAIL — ' + JSON.stringify(data) + '\n');
    setTimeout(() => process.exit(ok ? 0 : 1), 100);
  }, 1400);
});
