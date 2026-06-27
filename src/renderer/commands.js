'use strict';
/* Vendor command cheat-sheet. Exposed as window.NEBULA_COMMANDS and rendered by
   the Commands drawer. A command is a string, or { c, note, danger }.
   `paging` is the command that disables the terminal pager for that platform. */

window.NEBULA_COMMANDS = {
  vendors: [
    {
      id: 'cisco-ios', name: 'Cisco IOS / IOS-XE', paging: 'terminal length 0',
      groups: [
        { name: 'System & info', cmds: ['show version', 'show inventory', 'show running-config', 'show startup-config', 'show processes cpu sorted', 'show environment all'] },
        { name: 'Interfaces', cmds: ['show ip interface brief', 'show interfaces status', 'show interfaces description', 'show interfaces counters errors', 'show interface GigabitEthernet0/1'] },
        { name: 'L2 / VLAN', cmds: ['show vlan brief', 'show mac address-table', 'show interfaces trunk', 'show spanning-tree', 'show etherchannel summary'] },
        { name: 'L3 / routing', cmds: ['show ip route', 'show ip arp', 'show ip ospf neighbor', 'show ip bgp summary', 'show ip protocols'] },
        { name: 'Neighbors', cmds: ['show cdp neighbors', 'show cdp neighbors detail', 'show lldp neighbors'] },
        { name: 'Diagnostics', cmds: ['ping', 'traceroute', 'show logging', 'show processes memory sorted'] },
        { name: 'Config & save', cmds: ['configure terminal', 'copy running-config startup-config', { c: 'write memory' }, { c: 'reload', danger: true }, { c: 'write erase', danger: true }] },
      ],
    },
    {
      id: 'cisco-nxos', name: 'Cisco NX-OS', paging: 'terminal length 0',
      groups: [
        { name: 'System & info', cmds: ['show version', 'show inventory', 'show module', 'show running-config', 'show feature'] },
        { name: 'Interfaces', cmds: ['show ip interface brief vrf all', 'show interface status', 'show interface brief', 'show interface description'] },
        { name: 'L2 / VLAN', cmds: ['show vlan', 'show mac address-table', 'show spanning-tree', 'show port-channel summary', 'show vpc'] },
        { name: 'L3 / routing', cmds: ['show ip route vrf all', 'show ip arp', 'show ip ospf neighbor', 'show bgp ipv4 unicast summary'] },
        { name: 'Neighbors', cmds: ['show cdp neighbors', 'show lldp neighbors'] },
        { name: 'Config & save', cmds: ['configure terminal', 'copy running-config startup-config', { c: 'reload', danger: true }, { c: 'write erase', danger: true }] },
      ],
    },
    {
      id: 'aruba-aoss', name: 'HPE Aruba (AOS-Switch / ProCurve)', paging: 'no page',
      groups: [
        { name: 'System & info', cmds: ['show version', 'show system', 'show running-config', 'show config', 'show modules', 'show flash'] },
        { name: 'Interfaces', cmds: ['show interfaces brief', 'show interfaces', 'show interface 1', 'show name'] },
        { name: 'L2 / VLAN', cmds: ['show vlans', 'show mac-address', 'show spanning-tree', 'show trunks', 'show lacp'] },
        { name: 'L3 / routing', cmds: ['show ip route', 'show ip', 'show arp'] },
        { name: 'Neighbors', cmds: ['show lldp info remote-device', 'show cdp neighbors'] },
        { name: 'Config & save', cmds: ['configure', { c: 'write memory' }, { c: 'reload', danger: true }, { c: 'erase startup-config', danger: true }] },
      ],
    },
    {
      id: 'hpe-comware', name: 'HPE Comware (FlexFabric / 59xx)', paging: 'screen-length disable',
      groups: [
        { name: 'System & info', cmds: ['display version', 'display device', 'display current-configuration', 'display saved-configuration', 'display diagnostic-information'] },
        { name: 'Interfaces', cmds: ['display interface brief', 'display interface', 'display interface description', 'display counters inbound interface'] },
        { name: 'L2 / VLAN', cmds: ['display vlan brief', 'display vlan all', 'display mac-address', 'display stp brief', 'display link-aggregation verbose'] },
        { name: 'L3 / routing', cmds: ['display ip routing-table', 'display arp', 'display ospf peer', 'display bgp peer'] },
        { name: 'Neighbors', cmds: ['display lldp neighbor-information verbose', 'display lldp neighbor-information list'] },
        { name: 'Config & save', cmds: ['system-view', { c: 'save' }, { c: 'reboot', danger: true }, { c: 'reset saved-configuration', danger: true }] },
      ],
    },
    {
      id: 'huawei-vrp', name: 'Huawei VRP', paging: 'screen-length 0 temporary',
      groups: [
        { name: 'System & info', cmds: ['display version', 'display device', 'display current-configuration', 'display saved-configuration', 'display health'] },
        { name: 'Interfaces', cmds: ['display interface brief', 'display ip interface brief', 'display interface description', 'display interface'] },
        { name: 'L2 / VLAN', cmds: ['display vlan', 'display mac-address', 'display stp brief', 'display eth-trunk', 'display port vlan'] },
        { name: 'L3 / routing', cmds: ['display ip routing-table', 'display arp', 'display ospf peer', 'display bgp peer'] },
        { name: 'Neighbors', cmds: ['display lldp neighbor brief', 'display lldp neighbor'] },
        { name: 'Config & save', cmds: ['system-view', { c: 'save' }, { c: 'reboot', danger: true }, { c: 'reset saved-configuration', danger: true }] },
      ],
    },
    {
      id: 'juniper-junos', name: 'Juniper Junos', paging: 'set cli screen-length 0',
      groups: [
        { name: 'System & info', cmds: ['show version', 'show chassis hardware', 'show system uptime', 'show configuration', 'show configuration | display set'] },
        { name: 'Interfaces', cmds: ['show interfaces terse', 'show interfaces descriptions', 'show interfaces diagnostics optics', 'show interfaces ge-0/0/0'] },
        { name: 'L2 / VLAN', cmds: ['show vlans', 'show ethernet-switching table', 'show spanning-tree bridge', 'show lacp interfaces'] },
        { name: 'L3 / routing', cmds: ['show route', 'show route summary', 'show arp', 'show ospf neighbor', 'show bgp summary'] },
        { name: 'Neighbors', cmds: ['show lldp neighbors'] },
        { name: 'Config & save', cmds: ['configure', 'commit check', { c: 'commit' }, 'rollback', { c: 'request system reboot', danger: true }] },
      ],
    },
    {
      id: 'arista-eos', name: 'Arista EOS', paging: 'terminal length 0',
      groups: [
        { name: 'System & info', cmds: ['show version', 'show inventory', 'show running-config', 'show startup-config', 'show processes top once'] },
        { name: 'Interfaces', cmds: ['show ip interface brief', 'show interfaces status', 'show interfaces description', 'show interfaces counters errors'] },
        { name: 'L2 / VLAN', cmds: ['show vlan', 'show mac address-table', 'show spanning-tree', 'show port-channel summary', 'show mlag'] },
        { name: 'L3 / routing', cmds: ['show ip route', 'show ip arp', 'show ip ospf neighbor', 'show ip bgp summary'] },
        { name: 'Neighbors', cmds: ['show lldp neighbors', 'show cdp neighbors'] },
        { name: 'Config & save', cmds: ['configure', 'copy running-config startup-config', { c: 'write memory' }, { c: 'reload', danger: true }] },
      ],
    },
    {
      id: 'mikrotik', name: 'MikroTik RouterOS', paging: null,
      groups: [
        { name: 'System & info', cmds: ['/system resource print', '/system identity print', '/system routerboard print', '/export', '/export compact'] },
        { name: 'Interfaces', cmds: ['/interface print', '/interface ethernet print', '/interface vlan print', '/interface bridge print'] },
        { name: 'L2 / bridge', cmds: ['/interface bridge host print', '/interface bridge vlan print'] },
        { name: 'L3 / routing', cmds: ['/ip address print', '/ip route print', '/ip arp print', '/ip neighbor print'] },
        { name: 'Services', cmds: ['/ip dhcp-server lease print', '/ip firewall filter print', '/ip dns print'] },
        { name: 'System', cmds: [{ c: '/system reboot', danger: true }, '/quit'] },
      ],
    },
    {
      id: 'linux', name: 'Linux host', paging: null,
      groups: [
        { name: 'System & info', cmds: ['uname -a', 'hostnamectl', 'uptime', 'cat /etc/os-release', 'lscpu'] },
        { name: 'Interfaces', cmds: ['ip -br a', 'ip -br link', 'ip a', 'ethtool eth0', 'nmcli device show'] },
        { name: 'Routing / L3', cmds: ['ip r', 'ip neigh', 'cat /etc/resolv.conf', 'arp -n'] },
        { name: 'Sockets / ports', cmds: ['ss -tulpn', 'netstat -tulpn', 'ss -s'] },
        { name: 'Diagnostics', cmds: ['ping -c 4 8.8.8.8', 'traceroute 8.8.8.8', 'mtr -rwc 10 8.8.8.8', 'dmesg | tail -50'] },
        { name: 'Services', cmds: ['systemctl status', 'journalctl -xe --no-pager | tail -50', { c: 'reboot', danger: true }, { c: 'shutdown now', danger: true }] },
      ],
    },
    {
      id: 'generic', name: 'Generic / unknown', paging: null,
      groups: [
        { name: 'Try these', cmds: [{ c: '?', note: 'context help on most CLIs' }, 'help', 'show version', 'display version', 'enable', 'exit'] },
        { name: 'Tip', cmds: [{ c: 'terminal length 0', note: 'Cisco/Arista: stop paging' }, { c: 'screen-length disable', note: 'HPE/Huawei: stop paging' }] },
      ],
    },
  ],
};
