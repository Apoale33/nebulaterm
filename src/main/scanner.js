'use strict';
// Network scanner engine. Parses a target spec (CIDR, IP + mask, range or single
// IP) into a host list, then sweeps it: TCP connect probes (no admin needed — an
// RST/"connection refused" still proves the host is up) plus optional ICMP ping
// via the system `ping`, plus optional reverse DNS. Results stream back as they
// complete so the UI stays live.

const net = require('net');
const dns = require('dns');
const { exec } = require('child_process');

const MAX_HOSTS = 8192;

function ipToInt(ip) {
  const p = String(ip).trim().split('.');
  if (p.length !== 4) return null;
  let n = 0;
  for (const part of p) {
    const x = Number(part);
    if (!Number.isInteger(x) || x < 0 || x > 255 || part === '') return null;
    n = (n * 256) + x;
  }
  return n >>> 0;
}
function intToIp(n) {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}
function maskToPrefix(mask) {
  const n = ipToInt(mask);
  if (n === null) return null;
  let count = 0, seenZero = false;
  for (let i = 31; i >= 0; i--) {
    if ((n >>> i) & 1) { if (seenZero) return null; count++; }
    else seenZero = true;
  }
  return count;
}

function hostsFromCidr(base, pfx) {
  if (pfx < 0 || pfx > 32) return { error: 'Invalid prefix /' + pfx };
  const count = Math.pow(2, 32 - pfx);
  const mask = pfx === 0 ? 0 : (0xffffffff << (32 - pfx)) >>> 0;
  const network = (base & mask) >>> 0;
  let start = network, end = (network + count - 1) >>> 0;
  if (pfx <= 30) { start = (network + 1) >>> 0; end = (network + count - 2) >>> 0; }
  const total = end - start + 1;
  if (total > MAX_HOSTS) return { error: `Range too large: ${total} hosts (max ${MAX_HOSTS}). Use a smaller prefix.` };
  const list = [];
  for (let n = start; n <= end; n++) list.push(intToIp(n >>> 0));
  return list;
}
function rangeList(a, b) {
  if (b < a) return { error: 'Range end is before start' };
  if (b - a + 1 > MAX_HOSTS) return { error: `Range too large: ${b - a + 1} hosts (max ${MAX_HOSTS}).` };
  const list = [];
  for (let n = a; n <= b; n++) list.push(intToIp(n >>> 0));
  return list;
}

function parseTargets(input) {
  input = String(input || '').trim();
  let m;
  if ((m = input.match(/^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/))) {
    const base = ipToInt(m[1]); if (base === null) return { error: 'Invalid IP in CIDR' };
    return hostsFromCidr(base, Number(m[2]));
  }
  if ((m = input.match(/^(\d+\.\d+\.\d+\.\d+)[\s/]+(\d+\.\d+\.\d+\.\d+)$/))) {
    const base = ipToInt(m[1]); const pfx = maskToPrefix(m[2]);
    if (base === null || pfx === null) return { error: 'Invalid IP or mask' };
    return hostsFromCidr(base, pfx);
  }
  if ((m = input.match(/^(\d+\.\d+\.\d+\.\d+)\s*-\s*(\d+\.\d+\.\d+\.\d+)$/))) {
    const a = ipToInt(m[1]), b = ipToInt(m[2]);
    if (a === null || b === null) return { error: 'Invalid IP in range' };
    return rangeList(a, b);
  }
  if ((m = input.match(/^(\d+\.\d+\.\d+)\.(\d+)\s*-\s*(\d+)$/))) {
    const a = ipToInt(`${m[1]}.${m[2]}`), b = ipToInt(`${m[1]}.${m[3]}`);
    if (a === null || b === null) return { error: 'Invalid range' };
    return rangeList(a, b);
  }
  const single = ipToInt(input);
  if (single !== null) return [intToIp(single)];
  return { error: 'Could not parse target. Use 10.0.0.0/24, 10.0.0.0 255.255.255.0, or 10.0.0.1-50.' };
}

function tcpProbe(ip, port, timeout) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const sock = new net.Socket();
    let done = false;
    const fin = (state) => { if (done) return; done = true; try { sock.destroy(); } catch {} resolve({ state, ms: Date.now() - t0 }); };
    sock.setTimeout(timeout);
    sock.once('connect', () => fin('open'));
    sock.once('timeout', () => fin('filtered'));
    sock.once('error', (e) => fin(e && e.code === 'ECONNREFUSED' ? 'closed' : 'filtered'));
    try { sock.connect(port, ip); } catch { fin('filtered'); }
  });
}

function icmpPing(ip, timeout) {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const cmd = isWin
      ? `ping -n 1 -w ${timeout} ${ip}`
      : `ping -c 1 -W ${Math.max(1, Math.ceil(timeout / 1000))} ${ip}`;
    exec(cmd, { windowsHide: true, timeout: timeout + 1500 }, (_err, stdout) => {
      const out = String(stdout || '');
      const up = /ttl[=\s]/i.test(out);
      let ms = null;
      const m = out.match(/[=<]\s*(\d+(?:[.,]\d+)?)\s*ms/i);
      if (m) ms = parseFloat(m[1].replace(',', '.'));
      resolve({ up, ms });
    });
  });
}

function reverseDns(ip, timeout) {
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve(null); } }, timeout);
    dns.reverse(ip, (err, names) => {
      if (done) return; done = true; clearTimeout(t);
      resolve(err ? null : (names && names[0]) || null);
    });
  });
}

// emit(event): {type:'result'|'progress'|'done', ...}
function startScan(opts, emit) {
  const targets = opts.targets;
  const ports = (opts.ports || []).filter((p) => p > 0 && p < 65536);
  const timeout = opts.timeout || 900;
  const concurrency = Math.min(opts.concurrency || 64, 128);
  const total = targets.length;
  let i = 0, active = 0, done = 0, stopped = false, finished = false;

  function finish() { if (finished) return; finished = true; emit({ type: 'done', done, total, stopped }); }

  async function probe(ip) {
    const r = { ip, up: false, latency: null, ports: {}, host: null };
    if (ports.length) {
      const results = await Promise.all(ports.map((p) => tcpProbe(ip, p, timeout)));
      ports.forEach((p, idx) => {
        const s = results[idx];
        r.ports[p] = s.state;
        if (s.state === 'open') { r.up = true; if (r.latency == null || s.ms < r.latency) r.latency = s.ms; }
        else if (s.state === 'closed') { r.up = true; }
      });
    }
    if (opts.ping) {
      const pr = await icmpPing(ip, timeout);
      if (pr.up) { r.up = true; if (r.latency == null && pr.ms != null) r.latency = pr.ms; }
    }
    if (r.up && opts.rdns) r.host = await reverseDns(ip, 1500);
    return r;
  }

  function pump() {
    if (stopped) { if (active === 0) finish(); return; }
    while (active < concurrency && i < total) {
      const ip = targets[i++];
      active++;
      probe(ip).then((res) => {
        done++;
        emit({ type: 'result', host: res });
        emit({ type: 'progress', done, total });
        active--;
        if (done >= total) finish();
        else pump();
      });
    }
    if (active === 0 && i >= total) finish();
  }

  pump();
  return { stop() { stopped = true; } };
}

module.exports = { parseTargets, startScan, ipToInt, intToIp, maskToPrefix, MAX_HOSTS };
