'use strict';
// Live loopback test for the Telnet engine: spins up a TCP server that performs
// real IAC option negotiation, connects with TelnetStream over a real socket,
// and verifies clean bidirectional data. Run: node scripts/test-telnet-live.js
const net = require('net');
const { TelnetStream } = require('../src/main/telnet');

const IAC = 255, WILL = 251, DO = 253, SB = 250, SE = 240, TTYPE = 24;

const server = net.createServer((sock) => {
  let sawWillTtype = false, sawTtypeName = false;
  sock.write(Buffer.from('Welcome to test-router\r\n'));
  sock.write(Buffer.from([IAC, DO, TTYPE]));          // ask client for terminal type
  setTimeout(() => sock.write(Buffer.from([IAC, SB, TTYPE, 1, IAC, SE])), 40); // TTYPE SEND
  setTimeout(() => sock.write(Buffer.from('login: ')), 120);
  sock.on('data', (buf) => {
    // Detect IAC WILL TTYPE and the SB ... IS "XTERM-256COLOR" reply from client
    for (let i = 0; i < buf.length - 2; i++) {
      if (buf[i] === IAC && buf[i + 1] === WILL && buf[i + 2] === TTYPE) sawWillTtype = true;
      if (buf[i] === IAC && buf[i + 1] === SB && buf[i + 2] === TTYPE) sawTtypeName = true;
    }
    const txt = buf.toString('latin1');
    if (txt.includes('admin')) sock.write(Buffer.from('Password: '));
    sock.__flags = { sawWillTtype, sawTtypeName };
  });
  server.__sock = sock;
});

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  const t = new TelnetStream();
  let got = '';
  let connected = false;
  t.on('connect', () => { connected = true; setTimeout(() => t.write('admin\r\n'), 160); });
  t.on('data', (d) => { got += d.toString('latin1'); });
  t.connect({ host: '127.0.0.1', port });

  setTimeout(() => {
    const flags = (server.__sock && server.__sock.__flags) || {};
    const checks = {
      connected,
      bannerClean: got.includes('Welcome to test-router'),
      promptReceived: got.includes('login: ') && got.includes('Password: '),
      noRawIAC: !got.includes('\xff'),
      negotiatedTtype: !!flags.sawWillTtype,
      sentTtypeName: !!flags.sawTtypeName,
    };
    const ok = Object.values(checks).every(Boolean);
    console.log('\n  Telnet live loopback');
    console.log('  --------------------');
    for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? '✓' : '✗'} ${k}`);
    console.log('  --------------------');
    console.log(ok ? '  RESULT: OK\n' : '  RESULT: FAIL — ' + JSON.stringify(got) + '\n');
    t.end(); server.close(); process.exit(ok ? 0 : 1);
  }, 500);
});
