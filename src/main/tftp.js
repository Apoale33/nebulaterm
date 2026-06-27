'use strict';
// Minimal but real TFTP server (RFC 1350 + options RFC 2347/2348: blksize, tsize).
// Network engineers use this to back up / restore switch configs and push IOS
// images: `copy running-config tftp://<your-ip>/sw.cfg`. Serves and receives files
// under a single root directory; filenames are sanitised to that directory.

const dgram = require('dgram');
const fs = require('fs');
const path = require('path');

const OP = { RRQ: 1, WRQ: 2, DATA: 3, ACK: 4, ERROR: 5, OACK: 6 };

function readStr(buf, off) { let e = off; while (e < buf.length && buf[e] !== 0) e++; return [buf.toString('ascii', off, e), e + 1]; }
function packStr(...vals) {
  const bufs = [];
  for (const v of vals) { bufs.push(Buffer.from(String(v), 'ascii'), Buffer.from([0])); }
  return Buffer.concat(bufs);
}
function dataHeader(op, block) { const b = Buffer.alloc(4); b.writeUInt16BE(op, 0); b.writeUInt16BE(block, 2); return b; }

class TftpServer {
  constructor(root, emit) { this.root = root; this.emit = emit; this.sock = null; this.transfers = new Set(); }

  start(port = 69) {
    return new Promise((resolve, reject) => {
      try { fs.mkdirSync(this.root, { recursive: true }); } catch {}
      const sock = dgram.createSocket('udp4');
      sock.once('error', (e) => { try { sock.close(); } catch {} reject(e); });
      sock.on('message', (msg, rinfo) => this._onRequest(msg, rinfo));
      sock.bind(port, () => {
        this.sock = sock; this.port = port;
        this.emit({ type: 'listening', port, root: this.root });
        resolve({ port, root: this.root });
      });
    });
  }
  stop() {
    for (const t of [...this.transfers]) t.close();
    this.transfers.clear();
    if (this.sock) { try { this.sock.close(); } catch {} this.sock = null; this.emit({ type: 'stopped' }); }
  }
  safePath(name) {
    const base = path.basename(String(name).replace(/\\/g, '/'));
    if (!base || base === '.' || base === '..' || base.includes('/')) return null;
    return path.join(this.root, base);
  }
  sendError(rinfo, code, message) {
    const b = Buffer.concat([dataHeader(OP.ERROR, code), Buffer.from(message, 'ascii'), Buffer.from([0])]);
    const s = dgram.createSocket('udp4');
    s.send(b, rinfo.port, rinfo.address, () => { try { s.close(); } catch {} });
  }
  _onRequest(msg, rinfo) {
    if (msg.length < 4) return;
    const op = msg.readUInt16BE(0);
    if (op !== OP.RRQ && op !== OP.WRQ) return;
    let [filename, o] = readStr(msg, 2);
    let [, o2] = readStr(msg, o); // mode (we always use octet)
    const opts = {};
    let p = o2;
    while (p < msg.length - 1) {
      const [k, p1] = readStr(msg, p); const [v, p2] = readStr(msg, p1);
      if (!k) break; opts[k.toLowerCase()] = v; if (p2 <= p) break; p = p2;
    }
    const file = this.safePath(filename);
    if (!file) return this.sendError(rinfo, 2, 'Access violation');
    if (op === OP.RRQ) new ReadTransfer(this, file, filename, rinfo, opts).begin();
    else new WriteTransfer(this, file, filename, rinfo, opts).begin();
  }
}

class Transfer {
  constructor(server, file, name, peer, opts) {
    Object.assign(this, { server, file, name, peer, opts });
    this.blksize = 512; this.timeout = 3000; this.retries = 0; this.maxRetries = 5; this.closed = false;
    if (opts.blksize) { const b = parseInt(opts.blksize, 10); if (b >= 8 && b <= 65464) this.blksize = b; }
    this.sock = dgram.createSocket('udp4');
    this.sock.on('error', () => this.close());
    this.sock.on('message', (m, ri) => { this.peer = ri; this._onMsg(m); });
    server.transfers.add(this);
  }
  _send(pkt, expectReply) {
    if (this.closed) return;
    this.sock.send(pkt, this.peer.port, this.peer.address);
    clearTimeout(this.timer);
    if (expectReply) this.timer = setTimeout(() => this._retry(pkt), this.timeout);
  }
  _retry(pkt) {
    if (this.closed) return;
    if (++this.retries > this.maxRetries) { this.server.emit({ type: 'error', file: this.name, message: 'timed out' }); return this.close(); }
    this._send(pkt, true);
  }
  buildOack(extra) {
    const parts = [];
    if ('blksize' in this.opts) parts.push('blksize', String(this.blksize));
    if ('timeout' in this.opts) parts.push('timeout', this.opts.timeout);
    if ('tsize' in this.opts) parts.push('tsize', String(extra.tsize));
    if (!parts.length) return null;
    return Buffer.concat([Buffer.from([0, OP.OACK]), packStr(...parts)]);
  }
  close() {
    if (this.closed) return; this.closed = true;
    clearTimeout(this.timer); clearTimeout(this.idle); clearTimeout(this.dally);
    if (this.fd != null) { try { fs.closeSync(this.fd); } catch {} }
    try { this.sock.close(); } catch {}
    this.server.transfers.delete(this);
  }
}

class ReadTransfer extends Transfer { // server -> client (GET)
  begin() {
    try { this.stat = fs.statSync(this.file); this.fd = fs.openSync(this.file, 'r'); }
    catch { return this.server.sendError(this.peer, 1, 'File not found'); }
    this.block = 0; this.lastLen = this.blksize;
    this.server.emit({ type: 'start', dir: 'get', file: this.name, peer: this.peer.address, size: this.stat.size });
    const oack = this.buildOack({ tsize: this.stat.size });
    if (oack) { this.awaitOackAck = true; this._send(oack, true); }
    else { this.block = 1; this._sendData(); }
  }
  _sendData() {
    const off = (this.block - 1) * this.blksize;
    const buf = Buffer.alloc(this.blksize);
    const n = fs.readSync(this.fd, buf, 0, this.blksize, off);
    this.lastLen = n;
    this._send(Buffer.concat([dataHeader(OP.DATA, this.block), buf.subarray(0, n)]), true);
    this.server.emit({ type: 'progress', dir: 'get', file: this.name, bytes: off + n, total: this.stat.size });
  }
  _onMsg(m) {
    const op = m.readUInt16BE(0);
    if (op === OP.ERROR) return this.close();
    if (op !== OP.ACK) return;
    const ack = m.readUInt16BE(2);
    if (this.awaitOackAck) { if (ack === 0) { this.awaitOackAck = false; this.retries = 0; this.block = 1; this._sendData(); } return; }
    if (ack !== this.block) return; // stale ack, our retransmit covers loss
    this.retries = 0;
    if (this.lastLen < this.blksize) { this.server.emit({ type: 'done', dir: 'get', file: this.name, bytes: this.stat.size }); return this.close(); }
    this.block++; this._sendData();
  }
}

class WriteTransfer extends Transfer { // client -> server (PUT)
  begin() {
    try { this.fd = fs.openSync(this.file, 'w'); }
    catch { return this.server.sendError(this.peer, 2, 'Access violation'); }
    this.block = 0; this.bytes = 0;
    this.server.emit({ type: 'start', dir: 'put', file: this.name, peer: this.peer.address, size: parseInt(this.opts.tsize, 10) || 0 });
    const oack = this.buildOack({ tsize: parseInt(this.opts.tsize, 10) || 0 });
    if (oack) this._send(oack, true);   // client replies with DATA #1
    else this._sendAck(0);              // ACK 0 -> client sends DATA #1
    this._arm();
  }
  _arm() { clearTimeout(this.idle); this.idle = setTimeout(() => { this.server.emit({ type: 'error', file: this.name, message: 'timed out' }); this.close(); }, this.timeout * (this.maxRetries + 1)); }
  _sendAck(n) { this.sock.send(Buffer.from([0, OP.ACK, (n >> 8) & 255, n & 255]), this.peer.port, this.peer.address); }
  _onMsg(m) {
    const op = m.readUInt16BE(0);
    if (op === OP.ERROR) return this.close();
    if (op !== OP.DATA) return;
    clearTimeout(this.timer); // data is flowing — stop retransmitting the OACK
    const blk = m.readUInt16BE(2);
    const data = m.subarray(4);
    if (blk === ((this.block + 1) & 0xffff)) {
      try { fs.writeSync(this.fd, data, 0, data.length, this.bytes); } catch { return this.server.sendError(this.peer, 3, 'Disk full'); }
      this.bytes += data.length; this.block = blk; this._sendAck(blk);
      this.server.emit({ type: 'progress', dir: 'put', file: this.name, bytes: this.bytes, total: parseInt(this.opts.tsize, 10) || 0 });
      if (data.length < this.blksize) {
        // Final block: ACK is sent above; dally (keep the socket open) so a lost
        // final ACK can be re-sent on the client's retransmit, instead of closing
        // immediately and dropping it.
        this.server.emit({ type: 'done', dir: 'put', file: this.name, bytes: this.bytes });
        this.done = true; clearTimeout(this.idle);
        this.dally = setTimeout(() => this.close(), 1500);
      } else this._arm();
    } else {
      this._sendAck(this.block); // duplicate / final retransmit -> re-ack
    }
  }
}

module.exports = { TftpServer };
