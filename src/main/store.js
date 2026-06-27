'use strict';
// Encrypted session store. Session metadata lives in sessions.json under the
// app's userData dir; passwords and key passphrases are encrypted at rest with
// Electron safeStorage (DPAPI on Windows, Keychain on macOS, libsecret on Linux).
// Secrets never leave the main process and are never written in clear text.

const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

let sessionsFile = null;
let db = { version: 1, sessions: [] };

const EDITABLE = [
  'name', 'type', 'host', 'port', 'username', 'authMethod', 'keyPath',
  'folder', 'tags', 'comPort', 'baudRate', 'dataBits', 'parity', 'stopBits',
  'rtscts', 'legacyAlgos', 'logging', 'color', 'notes', 'vendor'
];

function init() {
  sessionsFile = path.join(app.getPath('userData'), 'sessions.json');
  load();
}

function load() {
  try {
    db = JSON.parse(fs.readFileSync(sessionsFile, 'utf8'));
    if (!Array.isArray(db.sessions)) db.sessions = [];
  } catch {
    db = { version: 1, sessions: [] };
  }
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(sessionsFile), { recursive: true });
    fs.writeFileSync(sessionsFile, JSON.stringify(db, null, 2), 'utf8');
  } catch (e) {
    console.error('[store] persist failed:', e.message);
  }
}

function encryptionAvailable() {
  try { return safeStorage.isEncryptionAvailable(); } catch { return false; }
}

function encryptSecret(plain) {
  if (!plain) return '';
  if (!encryptionAvailable()) return '';
  try { return safeStorage.encryptString(plain).toString('base64'); }
  catch { return ''; }
}

function decryptSecret(b64) {
  if (!b64) return '';
  try { return safeStorage.decryptString(Buffer.from(b64, 'base64')); }
  catch { return ''; }
}

// Shape returned to the renderer: secrets replaced by booleans.
function sanitize(s) {
  const { password, passphrase, ...rest } = s;
  return { ...rest, hasPassword: !!password, hasPassphrase: !!passphrase };
}

function listSessions() {
  return db.sessions
    .slice()
    .sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0))
    .map(sanitize);
}

function getRaw(id) { return db.sessions.find((s) => s.id === id) || null; }

function upsertSession(input) {
  const now = Date.now();
  let s = db.sessions.find((x) => x.id === input.id);
  if (!s) {
    s = { id: input.id || genId(), createdAt: now };
    db.sessions.push(s);
  }
  for (const f of EDITABLE) if (f in input) s[f] = input[f];
  // Secrets: only touch when the key is present. '' clears, a value re-encrypts.
  if ('password' in input) s.password = input.password ? encryptSecret(input.password) : '';
  if ('passphrase' in input) s.passphrase = input.passphrase ? encryptSecret(input.passphrase) : '';
  s.updatedAt = now;
  persist();
  return sanitize(s);
}

function deleteSession(id) {
  db.sessions = db.sessions.filter((s) => s.id !== id);
  persist();
}

function touchSession(id) {
  const s = getRaw(id);
  if (s) { s.lastUsed = Date.now(); persist(); }
}

// Decrypted credentials for the main process at connect time only.
function resolveCreds(id) {
  const s = getRaw(id);
  if (!s) return { password: '', passphrase: '' };
  return { password: decryptSecret(s.password), passphrase: decryptSecret(s.passphrase) };
}

function genId() {
  return 'sess_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

module.exports = {
  init, listSessions, getRaw, upsertSession, deleteSession,
  touchSession, resolveCreds, encryptionAvailable, sanitize,
};
