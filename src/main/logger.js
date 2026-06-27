'use strict';
// Per-connection session logging. Writes terminal output to a timestamped file.
// By default it strips ANSI/VT escape sequences so the log opens cleanly in any
// text editor (handy for capturing switch/router config dumps). The stripper is
// stateful and buffers a partial escape sequence across data chunks.

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function defaultLogDir() {
  return path.join(app.getPath('userData'), 'logs');
}

class SessionLogger {
  constructor(name, dir, clean = true) {
    this.stream = null;
    this.file = null;
    this.clean = clean;
    this._pending = '';
    try {
      const d = dir || defaultLogDir();
      fs.mkdirSync(d, { recursive: true });
      const safe = String(name || 'session').replace(/[^\w.-]+/g, '_').slice(0, 60) || 'session';
      const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
      this.file = path.join(d, `${safe}_${ts}.log`);
      this.stream = fs.createWriteStream(this.file, { flags: 'a' });
      this._raw(`\r\n===== NebulaTerm log — ${safe} — ${new Date().toISOString()} =====\r\n`);
    } catch (e) {
      console.error('[logger] init failed:', e.message);
      this.stream = null;
    }
  }

  _raw(s) { if (this.stream) { try { this.stream.write(s); } catch {} } }

  write(data) {
    if (!this.stream) return;
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
    if (!this.clean) { try { this.stream.write(buf); } catch {} return; }
    const text = this._strip(buf.toString('latin1')); // latin1 preserves bytes 1:1
    if (text) { try { this.stream.write(Buffer.from(text, 'latin1')); } catch {} }
  }

  _strip(input) {
    let s = this._pending + input;
    this._pending = '';
    let out = '';
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === '\x1b') {
        if (i + 1 >= s.length) { this._pending = s.slice(i); break; }
        const n = s[i + 1];
        if (n === '[') {                                  // CSI: ESC [ … final 0x40-0x7E
          let j = i + 2;
          while (j < s.length && !(s.charCodeAt(j) >= 0x40 && s.charCodeAt(j) <= 0x7e)) j++;
          if (j >= s.length) { this._pending = s.slice(i); break; }
          i = j + 1; continue;
        } else if (n === ']') {                           // OSC: ESC ] … BEL or ESC \
          let j = i + 2;
          while (j < s.length && s[j] !== '\x07' && !(s[j] === '\x1b' && s[j + 1] === '\\')) j++;
          if (j >= s.length) { this._pending = s.slice(i); break; }
          i = s[j] === '\x07' ? j + 1 : j + 2; continue;
        } else if (n === '(' || n === ')') {              // charset designator
          if (i + 2 >= s.length) { this._pending = s.slice(i); break; }
          i += 3; continue;
        } else { i += 2; continue; }                      // ESC + single char
      } else if (c === '\r' || c === '\n' || c === '\t' || c >= ' ') {
        out += c; i++;
      } else {
        i++;                                              // drop stray control bytes
      }
    }
    return out;
  }

  close() {
    if (this.stream) {
      try { this.stream.end(`\r\n===== closed — ${new Date().toISOString()} =====\r\n`); } catch {}
      this.stream = null;
    }
  }
}

module.exports = { SessionLogger, defaultLogDir };
