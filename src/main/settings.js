'use strict';
// App-wide settings persisted to settings.json in userData.

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let file = null;
let cache = null;

function defaults() {
  return {
    theme: 'light',            // 'light' | 'dark'
    fontSize: 14,
    fontFamily: "'Cascadia Mono', 'Consolas', 'JetBrains Mono', 'Courier New', monospace",
    cursorStyle: 'bar',        // 'block' | 'bar' | 'underline'
    cursorBlink: true,
    scrollback: 5000,
    logEnabledDefault: false,
    logClean: true,            // strip ANSI escapes from log files
    logDir: path.join(app.getPath('userData'), 'logs'),
    bellSound: false,
    copyOnSelect: true,
    rightClickPaste: true,
    confirmOnQuit: true,       // warn before closing the app with live sessions
    highlightInput: true,      // colorize the commands you type (matched via device echo)
    inputColor: '#4d9fff',     // blue
  };
}

function init() {
  file = path.join(app.getPath('userData'), 'settings.json');
  load();
}

function load() {
  try {
    cache = { ...defaults(), ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    cache = defaults();
  }
}

function get() {
  if (!cache) load();
  return cache;
}

function set(patch) {
  cache = { ...get(), ...patch };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(cache, null, 2), 'utf8');
  } catch (e) {
    console.error('[settings] persist failed:', e.message);
  }
  return cache;
}

module.exports = { init, get, set, defaults };
