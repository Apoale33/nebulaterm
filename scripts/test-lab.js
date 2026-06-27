'use strict';
// Boots the device lab and connects to it through the REAL ConnectionManager —
// Telnet to the switch, SSH to the router — verifying the simulated CLI responds.
require('./lab.js'); // starts the lab servers on load
const { ConnectionManager } = require('../src/main/connections');

setTimeout(() => {
  let tdata = '';
  const cmT = new ConnectionManager((id, ev, p) => { if (ev === 'data') tdata += p.toString(); });
  const tc = cmT.open({ type: 'telnet', host: '127.0.0.1', port: 2323, cols: 80, rows: 24 });
  setTimeout(() => cmT.write(tc.id, '\r'), 350);                         // Enter at password
  setTimeout(() => cmT.write(tc.id, 'enable\r'), 650);
  setTimeout(() => cmT.write(tc.id, 'show ip interface brief\r'), 950);

  setTimeout(() => {
    const telnetOk = tdata.includes('User Access Verification') && tdata.includes('Interface') && tdata.includes('10.0.0.1');

    let sdata = '';
    const cmS = new ConnectionManager((id, ev, p) => { if (ev === 'data') sdata += p.toString(); });
    const sc = cmS.open({ type: 'ssh', host: '127.0.0.1', port: 2223, username: 'admin', password: 'cisco', authMethod: 'password', legacyAlgos: true, cols: 80, rows: 24 });
    setTimeout(() => cmS.write(sc.id, 'show version\r'), 800);
    setTimeout(() => {
      const sshOk = sdata.includes('edge-rtr-01') && sdata.includes('ISR4331');
      console.log('\n  Device lab end-to-end (via ConnectionManager)');
      console.log('  ---------------------------------------------');
      console.log(`  ${telnetOk ? '✓' : '✗'} Telnet → core-sw-01: login, enable, show ip int brief`);
      console.log(`  ${sshOk ? '✓' : '✗'} SSH → edge-rtr-01: shell, show version`);
      console.log('  ---------------------------------------------');
      console.log(telnetOk && sshOk ? '  RESULT: OK\n' : '  RESULT: FAIL\n');
      process.exit(telnetOk && sshOk ? 0 : 1);
    }, 1600);
  }, 1500);
}, 500);
