'use strict';
// Tests the scanner: target parsing (CIDR / mask / range / single / errors) and a
// live loopback TCP sweep (an open port + a closed port that returns RST).
// Run: node scripts/test-scan.js
const assert = require('assert');
const net = require('net');
const { parseTargets, startScan } = require('../src/main/scanner');

const checks = [];
const ok = (n) => checks.push(['✓', n]);
const ko = (n, e) => checks.push(['✗', n + (e ? ' — ' + e.message : '')]);

function t(name, fn) { try { fn(); ok(name); } catch (e) { ko(name, e); } }

t('CIDR /30 → 2 hosts', () => { const r = parseTargets('10.0.0.0/30'); assert.deepStrictEqual(r, ['10.0.0.1', '10.0.0.2']); });
t('IP + mask → 2 hosts', () => { const r = parseTargets('10.0.0.0 255.255.255.252'); assert.strictEqual(r.length, 2); });
t('/31 → 2 usable (RFC 3021)', () => { assert.strictEqual(parseTargets('10.0.0.0/31').length, 2); });
t('/32 → single host', () => { assert.deepStrictEqual(parseTargets('10.0.0.5/32'), ['10.0.0.5']); });
t('short range a.b.c.10-12 → 3', () => { assert.deepStrictEqual(parseTargets('192.168.1.10-12'), ['192.168.1.10', '192.168.1.11', '192.168.1.12']); });
t('full range → 3', () => { assert.strictEqual(parseTargets('192.168.1.1-192.168.1.3').length, 3); });
t('single IP → 1', () => { assert.deepStrictEqual(parseTargets('8.8.8.8'), ['8.8.8.8']); });
t('/8 rejected (too large)', () => { assert.ok(parseTargets('10.0.0.0/8').error); });
t('garbage rejected', () => { assert.ok(parseTargets('not-an-ip').error); });
t('bad octet rejected', () => { assert.ok(parseTargets('10.0.0.299/24').error); });

// Live loopback TCP sweep
const server = net.createServer(() => {});
server.listen(0, '127.0.0.1', () => {
  const openPort = server.address().port;
  const closedPort = openPort + 1; // nothing listening → localhost returns RST → "closed" → still "up"
  const found = [];
  startScan(
    { targets: ['127.0.0.1'], ports: [openPort, closedPort], ping: false, rdns: false, timeout: 800, concurrency: 8 },
    (ev) => {
      if (ev.type === 'result') found.push(ev.host);
      if (ev.type === 'done') {
        t('loopback host detected up', () => assert.strictEqual(found.length === 1 && found[0].up, true));
        t('open port detected', () => assert.strictEqual(found[0].ports[openPort], 'open'));
        t('closed port = RST (proves up without ICMP)', () => assert.strictEqual(found[0].ports[closedPort], 'closed'));
        t('latency measured', () => assert.ok(found[0].latency != null));

        let failed = 0;
        console.log('\n  Scanner tests');
        console.log('  -------------');
        for (const [s, n] of checks) { if (s === '✗') failed++; console.log('  ' + s + ' ' + n); }
        console.log('  -------------');
        console.log(failed ? `  RESULT: FAILED (${failed})\n` : '  RESULT: ALL PASS\n');
        server.close();
        process.exit(failed ? 1 : 0);
      }
    }
  );
});
