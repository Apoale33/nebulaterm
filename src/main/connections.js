'use strict';
// Connection manager: one unified surface over SSH (ssh2), Serial (serialport)
// and Telnet (raw socket + IAC handling). Each open connection routes its output
// to the renderer through the `emit` callback and into a session log if enabled.

const fs = require('fs');
const { Client } = require('ssh2');
const { SerialPort } = require('serialport');
const { TelnetStream } = require('./telnet');
const { SessionLogger } = require('./logger');

// APPEND (do not replace) legacy algorithms so old IOS/HP gear that only offers
// weak KEX/cipher/host-key types still connects, while keeping ssh2's own
// runtime-computed defaults for the strong ones.
//
// Why append and not a full list: Electron ships BoringSSL, which exposes a
// different cipher set than Node's OpenSSL (e.g. no chacha20-poly1305). Replacing
// the lists with a hardcoded set forced names BoringSSL doesn't support and made
// ssh2 throw "Unsupported algorithm", breaking every SSH connection in the app.
// Appending lets ssh2 pick whatever the current runtime actually supports and just
// adds the weak fallbacks — which only win when the device offers nothing better.
const LEGACY_ALGORITHMS = {
  kex: { append: ['diffie-hellman-group14-sha1', 'diffie-hellman-group-exchange-sha1', 'diffie-hellman-group1-sha1'] },
  serverHostKey: { append: ['ssh-rsa', 'ssh-dss'] },
  cipher: { append: ['aes128-cbc', 'aes192-cbc', 'aes256-cbc', '3des-cbc'] },
  hmac: { append: ['hmac-sha1', 'hmac-sha1-96'] },
};

class ConnectionManager {
  constructor(emit) {
    this.emit = emit;          // (id, event, payload) -> forwarded to renderer
    this.conns = new Map();    // id -> { type, ssh?, port?, stream, logger }
    this._seq = 0;
  }

  _id() { return 'conn_' + (++this._seq) + '_' + Date.now().toString(36); }

  _data(id, buf) {
    const rec = this.conns.get(id);
    if (!rec) return;
    if (rec.logger) rec.logger.write(buf);
    this.emit(id, 'data', buf);
  }

  _status(id, state, message) {
    this.emit(id, 'status', { state, message: message || '' });
  }

  open(cfg) {
    const id = this._id();
    const rec = { type: cfg.type, logger: null, stream: null };
    this.conns.set(id, rec);
    if (cfg.logging) {
      rec.logger = new SessionLogger(cfg.name || cfg.host || cfg.comPort || 'session', cfg.logDir, cfg.logClean);
      if (rec.logger.file) this.emit(id, 'log', { file: rec.logger.file });
    }
    try {
      if (cfg.type === 'ssh') this._openSsh(id, rec, cfg);
      else if (cfg.type === 'serial') this._openSerial(id, rec, cfg);
      else if (cfg.type === 'telnet') this._openTelnet(id, rec, cfg);
      else throw new Error('Unknown connection type: ' + cfg.type);
    } catch (e) {
      this._status(id, 'error', e.message);
      this._cleanup(id);
    }
    return { id, logFile: rec.logger ? rec.logger.file : null };
  }

  _openSsh(id, rec, cfg) {
    const client = new Client();
    rec.ssh = client;
    const cols = cfg.cols || 80, rows = cfg.rows || 24;

    client.on('ready', () => {
      client.shell({ term: 'xterm-256color', cols, rows }, (err, stream) => {
        if (err) { this._status(id, 'error', err.message); this._cleanup(id); return; }
        rec.stream = stream;
        this._status(id, 'connected');
        stream.on('data', (d) => this._data(id, d));
        stream.stderr.on('data', (d) => this._data(id, d));
        stream.on('close', () => { this._status(id, 'closed'); this._cleanup(id); });
      });
    });
    // Some devices authenticate with keyboard-interactive instead of "password".
    client.on('keyboard-interactive', (name, instr, lang, prompts, finish) => {
      finish(prompts.map(() => cfg.password || ''));
    });
    client.on('error', (e) => { this._status(id, 'error', e.message); this._cleanup(id); });
    client.on('close', () => { this._status(id, 'closed'); this._cleanup(id); });

    const conn = {
      host: cfg.host,
      port: Number(cfg.port) || 22,
      username: cfg.username || '',
      readyTimeout: 20000,
      keepaliveInterval: 15000,
      keepaliveCountMax: 4,
    };
    if (cfg.legacyAlgos !== false) conn.algorithms = LEGACY_ALGORITHMS;
    if (cfg.authMethod === 'key') {
      conn.privateKey = fs.readFileSync(cfg.keyPath);
      if (cfg.passphrase) conn.passphrase = cfg.passphrase;
    } else {
      conn.password = cfg.password || '';
      conn.tryKeyboard = true;
    }
    this._status(id, 'connecting');
    client.connect(conn);
  }

  _openSerial(id, rec, cfg) {
    const port = new SerialPort({
      path: cfg.comPort,
      baudRate: Number(cfg.baudRate) || 9600,
      dataBits: Number(cfg.dataBits) || 8,
      stopBits: Number(cfg.stopBits) || 1,
      parity: cfg.parity || 'none',
      rtscts: !!cfg.rtscts,
      autoOpen: false,
    });
    rec.port = port;
    rec.stream = port;
    this._status(id, 'connecting');
    port.open((err) => {
      if (err) { this._status(id, 'error', err.message); this._cleanup(id); return; }
      this._status(id, 'connected');
    });
    port.on('data', (d) => this._data(id, d));
    port.on('error', (e) => this._status(id, 'error', e.message));
    port.on('close', () => { this._status(id, 'closed'); this._cleanup(id); });
  }

  _openTelnet(id, rec, cfg) {
    const t = new TelnetStream();
    rec.stream = t;
    t.cols = cfg.cols || 80;
    t.rows = cfg.rows || 24;
    t.on('connect', () => this._status(id, 'connected'));
    t.on('data', (d) => this._data(id, d));
    t.on('error', (e) => { this._status(id, 'error', e.message); this._cleanup(id); });
    t.on('close', () => { this._status(id, 'closed'); this._cleanup(id); });
    this._status(id, 'connecting');
    t.connect({ host: cfg.host, port: Number(cfg.port) || 23 });
  }

  write(id, data) {
    const rec = this.conns.get(id);
    if (!rec || !rec.stream) return;
    try { rec.stream.write(data); } catch {}
  }

  resize(id, cols, rows) {
    const rec = this.conns.get(id);
    if (!rec || !rec.stream) return;
    try {
      if (rec.type === 'ssh' && rec.stream.setWindow) rec.stream.setWindow(rows, cols, 0, 0);
      else if (rec.type === 'telnet' && rec.stream.setWindow) rec.stream.setWindow(rows, cols);
      // serial: no remote window concept
    } catch {}
  }

  close(id) {
    const rec = this.conns.get(id);
    if (!rec) return;
    try {
      if (rec.type === 'ssh' && rec.ssh) rec.ssh.end();
      else if (rec.type === 'serial' && rec.port && rec.port.isOpen) rec.port.close(() => {});
      else if (rec.type === 'telnet' && rec.stream) rec.stream.end();
    } catch {}
    this._cleanup(id);
  }

  _cleanup(id) {
    const rec = this.conns.get(id);
    if (!rec) return;
    if (rec.logger) { rec.logger.close(); rec.logger = null; }
    this.conns.delete(id);
  }

  closeAll() { for (const id of [...this.conns.keys()]) this.close(id); }
}

module.exports = { ConnectionManager };
