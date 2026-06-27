'use strict';
// Minimal, correct Telnet client stream.
// Network gear speaks Telnet with IAC option negotiation; a raw TCP socket would
// dump negotiation bytes into the terminal as garbage. This wrapper strips IAC,
// answers negotiation sanely, advertises a terminal type and window size (NAWS),
// and exposes a small ssh2/serialport-like surface (write / setWindow / end + events).

const net = require('net');
const { EventEmitter } = require('events');

const IAC = 255, DONT = 254, DO = 253, WONT = 252, WILL = 251, SB = 250, SE = 240;
const OPT_ECHO = 1, OPT_SGA = 3, OPT_TTYPE = 24, OPT_NAWS = 31;
const SUB_SEND = 1, SUB_IS = 0;
const TTYPE_NAME = 'XTERM-256COLOR';

class TelnetStream extends EventEmitter {
  constructor() {
    super();
    this.socket = null;
    this.state = 'data';
    this.optVerb = 0;
    this.sb = [];
    this.cols = 80;
    this.rows = 24;
    this._nawsActive = false;
  }

  connect({ host, port = 23, timeout = 20000 }) {
    this.socket = net.createConnection({ host, port });
    this.socket.setNoDelay(true);
    this.socket.setKeepAlive(true, 15000); // keep idle sessions alive across NAT/firewalls
    this.socket.setTimeout(timeout, () => {
      if (!this._connected) this.emit('error', new Error('Connection timed out'));
    });
    this.socket.on('connect', () => {
      this._connected = true;
      this.socket.setTimeout(0);
      this.emit('connect');
    });
    this.socket.on('data', (buf) => this._onData(buf));
    this.socket.on('error', (err) => this.emit('error', err));
    this.socket.on('close', () => this.emit('close'));
    return this;
  }

  write(data) {
    if (!this.socket || this.socket.destroyed) return;
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
    if (buf.includes(IAC)) {
      const out = [];
      for (const b of buf) { out.push(b); if (b === IAC) out.push(IAC); } // escape 0xFF
      this.socket.write(Buffer.from(out));
    } else {
      this.socket.write(buf);
    }
  }

  setWindow(rows, cols) {
    this.rows = rows; this.cols = cols;
    if (this._nawsActive) this._sendNaws();
  }

  end() { if (this.socket) this.socket.destroy(); }
  get destroyed() { return !this.socket || this.socket.destroyed; }

  _send(bytes) {
    if (this.socket && !this.socket.destroyed) this.socket.write(Buffer.from(bytes));
  }

  _sendNaws() {
    const payload = [(this.cols >> 8) & 255, this.cols & 255, (this.rows >> 8) & 255, this.rows & 255];
    const esc = [];
    for (const b of payload) { esc.push(b); if (b === IAC) esc.push(IAC); }
    this._send([IAC, SB, OPT_NAWS, ...esc, IAC, SE]);
  }

  _onData(buf) {
    const out = [];
    for (let i = 0; i < buf.length; i++) {
      const b = buf[i];
      switch (this.state) {
        case 'data':
          if (b === IAC) this.state = 'iac';
          else out.push(b);
          break;
        case 'iac':
          if (b === IAC) { out.push(IAC); this.state = 'data'; }        // escaped 0xFF -> literal
          else if (b === SB) { this.state = 'sb'; this.sb = []; }
          else if (b === WILL || b === WONT || b === DO || b === DONT) { this.optVerb = b; this.state = 'opt'; }
          else { this.state = 'data'; }                                 // NOP/GA/etc. -> ignore
          break;
        case 'opt':
          this._negotiate(this.optVerb, b);
          this.state = 'data';
          break;
        case 'sb':
          if (b === IAC) this.state = 'sb_iac';
          else this.sb.push(b);
          break;
        case 'sb_iac':
          if (b === IAC) { this.sb.push(IAC); this.state = 'sb'; }       // escaped 0xFF in subneg
          else if (b === SE) { this._subneg(this.sb); this.state = 'data'; }
          else { this.state = 'data'; }                                 // malformed -> recover
          break;
      }
    }
    if (out.length) this.emit('data', Buffer.from(out));
  }

  _negotiate(verb, opt) {
    if (verb === DO) {
      if (opt === OPT_SGA || opt === OPT_TTYPE) this._send([IAC, WILL, opt]);
      else if (opt === OPT_NAWS) { this._send([IAC, WILL, opt]); this._nawsActive = true; this._sendNaws(); }
      else this._send([IAC, WONT, opt]);
    } else if (verb === DONT) {
      this._send([IAC, WONT, opt]);
      if (opt === OPT_NAWS) this._nawsActive = false;
    } else if (verb === WILL) {
      if (opt === OPT_ECHO || opt === OPT_SGA) this._send([IAC, DO, opt]);
      else this._send([IAC, DONT, opt]);
    } else if (verb === WONT) {
      this._send([IAC, DONT, opt]);
    }
  }

  _subneg(data) {
    if (data[0] === OPT_TTYPE && data[1] === SUB_SEND) {
      const name = Buffer.from(TTYPE_NAME, 'ascii');
      this._send([IAC, SB, OPT_TTYPE, SUB_IS, ...name, IAC, SE]);
    }
  }
}

module.exports = { TelnetStream };
