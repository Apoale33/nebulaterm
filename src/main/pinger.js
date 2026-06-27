'use strict';
// Continuous multi-ping: pings every host in a range on a repeating interval and
// streams per-host stats (up/down, last/min/avg/max latency, loss %). Stoppable.
// Uses the system `ping` (works without admin). For very large ranges use the
// one-shot scanner instead; this is for live monitoring of a set of hosts.

const { exec } = require('child_process');

function icmpPing(ip, timeout) {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const cmd = isWin ? `ping -n 1 -w ${timeout} ${ip}` : `ping -c 1 -W ${Math.max(1, Math.ceil(timeout / 1000))} ${ip}`;
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

class Pinger {
  constructor(targets, opts, emit) {
    this.targets = targets;
    this.interval = Math.max(300, opts.interval || 1000);
    this.timeout = opts.timeout || 1000;
    this.concurrency = Math.min(opts.concurrency || 24, 64);
    this.emit = emit;
    this.stopped = false;
    this.stats = new Map();
    for (const ip of targets) this.stats.set(ip, { ip, sent: 0, recv: 0, last: null, min: null, max: null, sum: 0, avg: null, loss: 0, up: false });
  }
  start() { this._round(); }
  stop() { this.stopped = true; clearTimeout(this.timer); this.emit({ type: 'stopped' }); }

  async _round() {
    if (this.stopped) return;
    const t0 = Date.now();
    let i = 0;
    const worker = async () => {
      while (i < this.targets.length && !this.stopped) {
        const ip = this.targets[i++];
        const r = await icmpPing(ip, this.timeout);
        if (this.stopped) return;
        this._update(ip, r);
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, this.targets.length) }, worker));
    if (this.stopped) return;
    this.emit({ type: 'round', at: Date.now() });
    const wait = Math.max(0, this.interval - (Date.now() - t0));
    this.timer = setTimeout(() => this._round(), wait);
  }
  _update(ip, r) {
    const s = this.stats.get(ip);
    s.sent++;
    if (r.up) {
      s.recv++; s.up = true; s.last = r.ms;
      if (r.ms != null) { if (s.min == null || r.ms < s.min) s.min = r.ms; if (s.max == null || r.ms > s.max) s.max = r.ms; s.sum += r.ms; }
      s.avg = s.recv ? Math.round(s.sum / s.recv) : null;
    } else { s.up = false; s.last = null; }
    s.loss = Math.round((1 - s.recv / s.sent) * 100);
    this.emit({ type: 'host', host: { ip: s.ip, up: s.up, last: s.last, min: s.min, max: s.max, avg: s.avg, loss: s.loss, sent: s.sent, recv: s.recv } });
  }
}

module.exports = { Pinger };
