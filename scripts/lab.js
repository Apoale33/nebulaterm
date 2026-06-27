'use strict';
/* NebulaTerm device lab — simulated Cisco-style devices you can connect to from
   NebulaTerm over Telnet AND SSH, so you can test the client without real gear.
   Two devices (a switch and a router) with a realistic IOS-like CLI: enable mode,
   config mode, line editing/echo, and believable `show` output.

   Run:  npm run lab        (or double-click lab.bat)
   Stop: Ctrl+C
*/
const net = require('net');
const crypto = require('crypto');
let Server;
try { ({ Server } = require('ssh2')); } catch { Server = null; }

// ---------- device data ----------
const devices = [
  {
    host: 'core-sw-01', kind: 'switch', model: 'WS-C3560CX-12PC-S', ios: '15.2(4)E10',
    serial: 'FOC2145X0AB', uptime: '8 weeks, 4 days, 2 hours',
    ints: [
      { n: 'GigabitEthernet0/1', ip: 'unassigned', st: 'up', vlan: '10', desc: 'AP-Floor1' },
      { n: 'GigabitEthernet0/2', ip: 'unassigned', st: 'up', vlan: '10', desc: 'PC-Reception' },
      { n: 'GigabitEthernet0/3', ip: 'unassigned', st: 'down', vlan: '10', desc: '' },
      { n: 'GigabitEthernet0/4', ip: 'unassigned', st: 'up', vlan: '20', desc: 'IP-Phone-201' },
      { n: 'GigabitEthernet0/11', ip: 'unassigned', st: 'up', vlan: 'trunk', desc: 'Uplink-core-sw-02' },
      { n: 'GigabitEthernet0/12', ip: 'unassigned', st: 'up', vlan: 'trunk', desc: 'Uplink-edge-rtr-01' },
      { n: 'Vlan1', ip: 'unassigned', st: 'admin', desc: '' },
      { n: 'Vlan99', ip: '10.0.0.1', st: 'up', desc: 'MGMT' },
    ],
    vlans: [
      { id: 1, name: 'default', ports: 'Gi0/5, Gi0/6, Gi0/7' },
      { id: 10, name: 'USERS', ports: 'Gi0/1, Gi0/2, Gi0/3' },
      { id: 20, name: 'VOICE', ports: 'Gi0/4' },
      { id: 99, name: 'MGMT', ports: '' },
    ],
    neighbors: [
      { dev: 'core-sw-02', local: 'Gig 0/11', plat: 'WS-C3560CX', port: 'Gig 0/11' },
      { dev: 'edge-rtr-01', local: 'Gig 0/12', plat: 'ISR4331', port: 'Gig 0/0/1' },
    ],
    routes: [['C', '10.0.0.0/24', 'directly connected, Vlan99'], ['S*', '0.0.0.0/0', '10.0.0.254']],
  },
  {
    host: 'edge-rtr-01', kind: 'router', model: 'ISR4331/K9', ios: '16.09.06',
    serial: 'FDO2233A1BC', uptime: '21 weeks, 6 days',
    ints: [
      { n: 'GigabitEthernet0/0/0', ip: '203.0.113.2', st: 'up', desc: 'WAN-to-ISP' },
      { n: 'GigabitEthernet0/0/1', ip: '10.0.0.254', st: 'up', desc: 'LAN-to-core-sw-01' },
      { n: 'GigabitEthernet0/0/2', ip: 'unassigned', st: 'admin', desc: '' },
      { n: 'Loopback0', ip: '10.255.255.1', st: 'up', desc: 'Router-ID' },
    ],
    vlans: [],
    neighbors: [{ dev: 'core-sw-01', local: 'Gig 0/0/1', plat: 'WS-C3560CX', port: 'Gig 0/12' }],
    routes: [
      ['S*', '0.0.0.0/0', '203.0.113.1'],
      ['C', '10.0.0.0/24', 'directly connected, GigabitEthernet0/0/1'],
      ['C', '203.0.113.0/30', 'directly connected, GigabitEthernet0/0/0'],
      ['C', '10.255.255.1/32', 'directly connected, Loopback0'],
    ],
  },
];

// ---------- formatting helpers ----------
const pad = (s, n) => { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); };
const NL = '\r\n';

function banner(d) {
  return `${NL}${d.host} ${d.model} — simulated lab device (NebulaTerm)${NL}IOS ${d.ios} · uptime ${d.uptime}${NL}`;
}
function statusPair(st) {
  if (/admin/i.test(st)) return ['administratively down', 'down'];
  if (/down/i.test(st)) return ['down', 'down'];
  return ['up', 'up'];
}
function showVersion(d) {
  return [
    `Cisco IOS Software, ${d.model} Software, Version ${d.ios}, RELEASE SOFTWARE (fc1)`,
    'Copyright (c) 1986-2024 by Cisco Systems, Inc.', '',
    `${d.host} uptime is ${d.uptime}`,
    'System returned to ROM by power-on',
    `System image file is "flash:${d.kind === 'router' ? 'isr4300' : 'c3560cx'}-universalk9.SPA.bin"`, '',
    `cisco ${d.model} (revision 1.0) with 524288K bytes of memory.`,
    `Processor board ID ${d.serial}`,
    `${d.kind === 'router' ? '3' : '12'} Gigabit Ethernet interfaces`,
    'Configuration register is 0x2102',
  ].join(NL);
}
function ipIntBrief(d) {
  let o = 'Interface                  IP-Address      OK? Method Status                Protocol';
  for (const i of d.ints) {
    const ip = i.ip && i.ip !== 'unassigned' ? i.ip : 'unassigned';
    const [status, proto] = statusPair(i.st);
    o += NL + `${pad(i.n, 26)} ${pad(ip, 15)} YES ${pad(ip === 'unassigned' ? 'unset' : 'NVRAM', 6)} ${pad(status, 21)} ${proto}`;
  }
  return o;
}
function intStatus(d) {
  let o = 'Port      Name               Status       Vlan       Duplex  Speed Type';
  for (const i of d.ints.filter((x) => /^Gig/.test(x.n))) {
    const st = /admin/i.test(i.st) ? 'disabled' : (i.st === 'up' ? 'connected' : 'notconnect');
    o += NL + `${pad(i.n.replace('GigabitEthernet', 'Gi'), 9)} ${pad(i.desc.slice(0, 18), 18)} ${pad(st, 12)} ${pad(i.vlan || '1', 10)} a-full  a-1000 10/100/1000BaseTX`;
  }
  return o;
}
function intDesc(d) {
  let o = 'Interface                      Status         Protocol Description';
  for (const i of d.ints) {
    const [s, p] = statusPair(i.st);
    o += NL + `${pad(i.n, 30)} ${pad(s, 14)} ${pad(p, 8)} ${i.desc}`;
  }
  return o;
}
function vlanBrief(d) {
  if (!d.vlans.length) return '% Command only available on a switch';
  let o = 'VLAN Name                             Status    Ports' + NL +
    '---- -------------------------------- --------- -------------------------------';
  for (const v of d.vlans) o += NL + `${pad(v.id, 4)} ${pad(v.name, 32)} ${pad('active', 9)} ${v.ports}`;
  return o;
}
function macTable(d) {
  if (!d.vlans.length) return '% Command only available on a switch';
  const rows = [
    [10, '00d0.2a3f.1101', 'DYNAMIC', 'Gi0/1'],
    [10, '08cc.68a2.55fe', 'DYNAMIC', 'Gi0/2'],
    [20, '0011.2233.4455', 'DYNAMIC', 'Gi0/4'],
    [99, '0000.0c07.ac63', 'STATIC', 'Vl99'],
  ];
  let o = '          Mac Address Table' + NL + '-------------------------------------------' + NL +
    'Vlan    Mac Address       Type        Ports' + NL + '----    -----------       --------    -----';
  for (const r of rows) o += NL + `${pad(r[0], 8)}${pad(r[1], 18)}${pad(r[2], 12)}${r[3]}`;
  return o;
}
function ipRoute(d) {
  let o = 'Codes: C - connected, S - static, S* - default' + NL + NL;
  o += d.routes.map(([code, net2, via]) => `${pad(code, 3)} ${pad(net2, 18)} ${via.startsWith('directly') ? 'is ' + via : '[1/0] via ' + via}`).join(NL);
  return o;
}
function cdpNeighbors(d) {
  let o = 'Device ID        Local Intrfce     Holdtme   Capability  Platform   Port ID';
  for (const n of d.neighbors) o += NL + `${pad(n.dev, 16)} ${pad(n.local, 17)} ${pad('163', 9)} ${pad('R S I', 11)} ${pad(n.plat, 10)} ${n.port}`;
  return o;
}
function pingOut(t) {
  return `Type escape sequence to abort.${NL}Sending 5, 100-byte ICMP Echos to ${t}, timeout is 2 seconds:${NL}!!!!!${NL}Success rate is 100 percent (5/5), round-trip min/avg/max = 1/2/4 ms`;
}
function helpText() {
  return ['Exec commands:', '  enable / disable        configure terminal', '  show <subcommand>       ping <ip>', '  write memory            terminal length 0', '  exit / end / ?'].join(NL);
}
function showHelp() {
  return ['  version                 ip interface brief', '  running-config          interfaces status', '  vlan brief              mac address-table', '  ip route                cdp neighbors', '  interfaces description   inventory'].join(NL);
}

function matchCmd(typed, full) {
  const t = typed.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const f = full.split(/\s+/);
  if (t.length !== f.length) return false;
  for (let i = 0; i < t.length; i++) if (!f[i].startsWith(t[i])) return false;
  return true;
}
function showHandler(d, body) {
  const c = body.replace(/\s+/g, ' ').trim();
  const m = (full) => matchCmd(c, full);
  if (m('show version')) return showVersion(d);
  if (m('show ip interface brief')) return ipIntBrief(d);
  if (m('show running-config') || m('show startup-config')) return 'Building configuration...' + NL + NL + runningConfig(d);
  if (m('show vlan brief') || m('show vlan')) return vlanBrief(d);
  if (m('show interfaces status')) return intStatus(d);
  if (m('show interfaces description')) return intDesc(d);
  if (m('show mac address-table')) return macTable(d);
  if (m('show ip route')) return ipRoute(d);
  if (m('show cdp neighbors') || m('show lldp neighbors')) return cdpNeighbors(d);
  if (m('show inventory')) return `NAME: "Chassis", DESCR: "${d.model}"${NL}PID: ${d.model} , VID: V01, SN: ${d.serial}`;
  if (m('show ip protocols')) return 'Routing Protocol is "static"';
  return null;
}
function runningConfig(d) {
  let o = `Current configuration : 2143 bytes${NL}!${NL}version ${d.ios.split('(')[0]}${NL}hostname ${d.host}${NL}!${NL}no ip domain-lookup${NL}!`;
  for (const i of d.ints) {
    o += `${NL}interface ${i.n}`;
    if (i.desc) o += `${NL} description ${i.desc}`;
    if (i.ip && i.ip !== 'unassigned') o += `${NL} ip address ${i.ip} 255.255.255.0`;
    else if (d.kind === 'switch' && /^Gig/.test(i.n)) {
      if (i.vlan === 'trunk') o += `${NL} switchport mode trunk`;
      else o += `${NL} switchport access vlan ${i.vlan || '1'}`;
    }
    o += `${NL}!`;
  }
  o += `${NL}line con 0${NL}line vty 0 4${NL} transport input ssh telnet${NL}!${NL}end`;
  return o;
}

function handle(d, mode, line) {
  const cmd = line.trim();
  if (cmd === '') return { out: '', mode };
  const lc = cmd.toLowerCase();
  if (matchCmd(cmd, 'enable')) return { out: '', mode: 'enable' };
  if (matchCmd(cmd, 'disable')) return { out: '', mode: 'user' };
  if (matchCmd(cmd, 'configure terminal')) {
    if (mode === 'user') return { out: invalid(), mode };
    return { out: 'Enter configuration commands, one per line.  End with CNTL/Z.', mode: 'config' };
  }
  if (matchCmd(cmd, 'end')) return { out: '', mode: mode === 'config' ? 'enable' : mode };
  if (matchCmd(cmd, 'exit') || matchCmd(cmd, 'quit') || matchCmd(cmd, 'logout')) {
    if (mode === 'config') return { out: '', mode: 'enable' };
    if (mode === 'enable') return { out: '', mode: 'user' };
    return { out: '', mode, close: true };
  }
  if (matchCmd(cmd, 'terminal length 0') || /^term(inal)? length \d+$/i.test(lc) || matchCmd(cmd, 'terminal monitor')) return { out: '', mode };
  if (matchCmd(cmd, 'write memory') || matchCmd(cmd, 'copy running-config startup-config') || lc === 'wr') return { out: 'Building configuration...' + NL + '[OK]', mode };
  if (matchCmd(cmd, 'reload')) return { out: 'Proceed with reload? [confirm] (lab — ignored)', mode };
  if (lc.startsWith('ping ')) return { out: pingOut(cmd.split(/\s+/)[1] || '10.0.0.1'), mode };
  if (cmd === '?' || lc === 'help') return { out: helpText(), mode };
  if (lc === 'show ?' || lc === 'sh ?') return { out: showHelp(), mode };

  let body = lc, allow = mode !== 'config';
  if (mode === 'config' && lc.startsWith('do ')) { body = lc.slice(3); allow = true; }
  if (allow) { const sh = showHandler(d, body); if (sh != null) return { out: sh, mode }; }

  if (mode === 'config' && /^(interface|vlan|hostname|ip|no|switchport|description|shutdown|spanning-tree) /i.test(lc)) return { out: '', mode };
  return { out: invalid(), mode };
}
function invalid() { return "% Invalid input detected at '^' marker."; }
const promptSuffix = (m) => (m === 'user' ? '>' : m === 'config' ? '(config)#' : '#');

// ---------- interactive session (shared by Telnet + SSH) ----------
class Session {
  constructor(d, write, end, needPassword) {
    this.d = d; this.write = write; this.end = end;
    this.mode = 'user'; this.line = ''; this.stage = needPassword ? 'password' : 'shell';
  }
  begin() {
    if (this.stage === 'password') this.write(`${NL}${this.d.host} remote console${NL}${NL}User Access Verification${NL}${NL}Password: `);
    else { this.write(banner(this.d)); this.prompt(); }
  }
  prompt() { this.write(`${NL}${this.d.host}${promptSuffix(this.mode)} `); }
  feed(buf) { for (let i = 0; i < buf.length; i++) this.char(buf[i]); }
  char(code) {
    if (this.stage === 'password') {
      if (code === 13) { this.stage = 'shell'; this.write(banner(this.d)); this.prompt(); }
      return; // accept any password, no echo
    }
    if (code === 13) {
      this.write(NL);
      const res = handle(this.d, this.mode, this.line);
      this.line = '';
      if (res.out) this.write(res.out + NL);
      this.mode = res.mode;
      if (res.close) { this.write('Connection closed by foreign host.' + NL); return this.end(); }
      this.prompt();
    } else if (code === 10) { /* LF: ignore */ }
    else if (code === 127 || code === 8) { if (this.line.length) { this.line = this.line.slice(0, -1); this.write('\b \b'); } }
    else if (code === 3) { this.write('^C'); this.line = ''; this.prompt(); }
    else if (code >= 32 && code < 127) { this.line += String.fromCharCode(code); this.write(String.fromCharCode(code)); }
  }
}

// strip inbound Telnet IAC negotiation so it never reaches the CLI
class IacStrip {
  constructor() { this.state = 'data'; }
  push(buf) {
    const out = [];
    for (const b of buf) {
      switch (this.state) {
        case 'data': if (b === 255) this.state = 'iac'; else out.push(b); break;
        case 'iac': if (b === 255) { out.push(255); this.state = 'data'; } else if (b === 250) this.state = 'sb'; else if (b >= 251 && b <= 254) this.state = 'opt'; else this.state = 'data'; break;
        case 'opt': this.state = 'data'; break;
        case 'sb': if (b === 255) this.state = 'sbiac'; break;
        case 'sbiac': this.state = (b === 240) ? 'data' : 'sb'; break;
      }
    }
    return Buffer.from(out);
  }
}

// ---------- servers ----------
const LAB = [
  { device: devices[0], telnet: 2323, ssh: 2222 },
  { device: devices[1], telnet: 2324, ssh: 2223 },
];

function startTelnet(device, port) {
  const server = net.createServer((sock) => {
    sock.setNoDelay(true);
    sock.write(Buffer.from([255, 251, 1, 255, 251, 3])); // IAC WILL ECHO, IAC WILL SGA
    const strip = new IacStrip();
    const sess = new Session(device, (s) => { try { sock.write(Buffer.from(s, 'latin1')); } catch {} }, () => sock.end(), true);
    sess.begin();
    sock.on('data', (buf) => { const clean = strip.push(buf); if (clean.length) sess.feed(clean); });
    sock.on('error', () => {});
  });
  server.listen(port, '127.0.0.1');
  return server;
}

function startSsh(device, port, hostKey) {
  if (!Server) return null;
  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    client.on('authentication', (ctx) => {
      if (ctx.method === 'none') return ctx.reject(['password', 'keyboard-interactive']);
      return ctx.accept(); // lab: accept any username/password
    });
    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept();
        session.on('pty', (a) => a && a());
        session.on('window-change', (a) => a && a());
        session.on('shell', (a) => {
          const stream = a();
          const sess = new Session(device, (s) => { try { stream.write(Buffer.from(s, 'latin1')); } catch {} },
            () => { try { stream.exit(0); } catch {} try { stream.end(); } catch {} }, false);
          sess.begin();
          stream.on('data', (d) => sess.feed(d));
        });
      });
    });
    client.on('error', () => {});
  });
  server.listen(port, '127.0.0.1');
  return server;
}

const hostKey = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
}).privateKey;

const servers = [];
for (const { device, telnet, ssh } of LAB) {
  servers.push(startTelnet(device, telnet));
  servers.push(startSsh(device, ssh, hostKey));
}

console.log('\n  NebulaTerm device lab — simulated Cisco-style devices (local only)\n');
for (const { device, telnet, ssh } of LAB) {
  console.log(`   ${pad(device.host, 12)} (${pad(device.kind, 6)})  Telnet 127.0.0.1:${telnet}   ${Server ? 'SSH 127.0.0.1:' + ssh : 'SSH n/a (ssh2 missing)'}`);
}
console.log('\n   SSH login: any username / any password (e.g. admin / cisco)');
console.log('   Telnet: press Enter at the password prompt');
console.log('   Try: enable · show ip interface brief · show running-config · show version · ?');
console.log('\n   In NebulaTerm → Quick Connect → Telnet 127.0.0.1 port 2323 (or SSH 2222).');
console.log('   Press Ctrl+C to stop the lab.\n');

process.on('SIGINT', () => { for (const s of servers) { try { s.close(); } catch {} } process.exit(0); });
