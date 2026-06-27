'use strict';
// Validates the TFTP server (multi-block GET + PUT with blksize negotiation) using
// a minimal in-test TFTP client, and the continuous Pinger against loopback.
const dgram = require('dgram');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { TftpServer } = require('../src/main/tftp');
const { Pinger } = require('../src/main/pinger');

const PORT = 6969;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nbtftp-'));
const downContent = Buffer.from('hostname test-device\r\n'.repeat(200)); // ~4200 bytes
fs.writeFileSync(path.join(root, 'down.cfg'), downContent);
const upContent = Buffer.from('interface GigabitEthernet0/1\r\n'.repeat(150)); // ~4500 bytes

const checks = [];
const add = (ok, name) => checks.push([ok, name]);
const strz = (s) => Buffer.concat([Buffer.from(String(s), 'ascii'), Buffer.from([0])]);
function parseOpts(m) { const o = {}; let p = 2; while (p < m.length - 1) { let e = p; while (e < m.length && m[e] !== 0) e++; const k = m.toString('ascii', p, e); p = e + 1; e = p; while (e < m.length && m[e] !== 0) e++; const v = m.toString('ascii', p, e); p = e + 1; if (k) o[k.toLowerCase()] = v; } return o; }

function tftpGet(filename, cb) {
  const cli = dgram.createSocket('udp4'); let data = Buffer.alloc(0); let blksize = 512;
  cli.on('message', (m, ri) => {
    const op = m.readUInt16BE(0);
    if (op === 6) { const o = parseOpts(m); if (o.blksize) blksize = parseInt(o.blksize, 10); cli.send(Buffer.from([0, 4, 0, 0]), ri.port, ri.address); }
    else if (op === 3) { const blk = m.readUInt16BE(2); const chunk = m.subarray(4); data = Buffer.concat([data, chunk]); cli.send(Buffer.from([0, 4, (blk >> 8) & 255, blk & 255]), ri.port, ri.address); if (chunk.length < blksize) { cli.close(); cb(null, data); } }
    else if (op === 5) { cli.close(); cb(new Error('error ' + m.readUInt16BE(2))); }
  });
  cli.send(Buffer.concat([Buffer.from([0, 1]), strz(filename), strz('octet'), strz('blksize'), strz('1024'), strz('tsize'), strz('0')]), PORT, '127.0.0.1');
}

function tftpPut(filename, data, cb) {
  const cli = dgram.createSocket('udp4'); let blksize = 512; let lastLen = blksize;
  const sendBlock = (ri, block) => { const off = (block - 1) * blksize; const chunk = data.subarray(off, off + blksize); lastLen = chunk.length; cli.send(Buffer.concat([Buffer.from([0, 3, (block >> 8) & 255, block & 255]), chunk]), ri.port, ri.address); };
  cli.on('message', (m, ri) => {
    const op = m.readUInt16BE(0);
    if (op === 6) { const o = parseOpts(m); if (o.blksize) blksize = parseInt(o.blksize, 10); sendBlock(ri, 1); }
    else if (op === 4) { const ack = m.readUInt16BE(2); if (ack > 0 && lastLen < blksize) { cli.close(); return cb(null); } sendBlock(ri, ack + 1); }
    else if (op === 5) { cli.close(); cb(new Error('error')); }
  });
  cli.send(Buffer.concat([Buffer.from([0, 2]), strz(filename), strz('octet'), strz('blksize'), strz('512'), strz('tsize'), strz(String(data.length))]), PORT, '127.0.0.1');
}

const srv = new TftpServer(root, () => {});
srv.start(PORT).then(() => {
  tftpGet('down.cfg', (err, data) => {
    add(!err && data && data.equals(downContent), 'TFTP GET multi-block (blksize 1024) matches');
    tftpPut('up.cfg', upContent, (err2) => {
      let putOk = false;
      try { putOk = fs.readFileSync(path.join(root, 'up.cfg')).equals(upContent); } catch {}
      add(!err2 && putOk, 'TFTP PUT multi-block written correctly');
      // pinger
      let host = null;
      const p = new Pinger(['127.0.0.1'], { interval: 500 }, (ev) => { if (ev.type === 'host' && ev.host.ip === '127.0.0.1' && ev.host.up) host = ev.host; });
      p.start();
      setTimeout(() => {
        p.stop();
        add(!!host && host.up && host.recv >= 1 && host.last != null, 'Multi-ping: 127.0.0.1 up with latency');
        srv.stop();
        try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
        let failed = 0;
        console.log('\n  Tools engine tests');
        console.log('  ------------------');
        for (const [ok, n] of checks) { if (!ok) failed++; console.log(`  ${ok ? '✓' : '✗'} ${n}`); }
        console.log('  ------------------');
        console.log(failed ? `  RESULT: FAILED (${failed})\n` : '  RESULT: ALL PASS\n');
        process.exit(failed ? 1 : 0);
      }, 1700);
    });
  });
}).catch((e) => { console.error('server failed:', e.message); process.exit(1); });
