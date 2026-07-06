// Produces a small simulated fleet so the dashboard, control actions and the
// validation engine are fully demonstrable without physical AV hardware.
// Enabled via config.simulate (default on). Simulated devices carry
// `simulated: true` and keep an internal power state the control layer mutates.

import { DeviceType } from '../scanner/deviceClassifier.js';

export function simulatedFleet(base = '10.0.0') {
  const now = () => new Date().toISOString();
  const mk = (last, over) => ({
    id: `${base}-${last}`.replace(/\./g, '-'),
    ip: `${base}.${last}`,
    openPorts: [],
    services: [],
    type: DeviceType.UNKNOWN,
    protocol: 'unknown',
    vendor: 'unknown',
    name: '',
    power: 'off',
    reachable: true,
    learned: true,
    simulated: true,
    capabilities: [],
    lastSeen: now(),
    ...over,
  });

  return [
    mk(10, {
      type: DeviceType.CONTROLLER,
      vendor: 'Crestron',
      protocol: 'crestron-cip',
      name: 'Room A Processor',
      openPorts: [41794, 41795, 80],
      services: ['crestron-cip', 'http'],
      power: 'on',
      capabilities: ['macro-power-on', 'macro-power-off', 'source-of-truth'],
    }),
    mk(21, {
      type: DeviceType.PC,
      vendor: 'Dell',
      protocol: 'vnc',
      name: 'Presenter PC',
      mac: 'AA:BB:CC:00:00:21',
      openPorts: [5900, 22, 3389],
      services: ['vnc', 'ssh'],
      power: 'off',
      capabilities: ['thumbnail', 'power-on', 'reboot', 'power-off', 'status'],
    }),
    mk(22, {
      type: DeviceType.PC,
      vendor: 'HP',
      protocol: 'vnc',
      name: 'Rack PC',
      mac: 'AA:BB:CC:00:00:22',
      openPorts: [5900, 22],
      services: ['vnc', 'ssh'],
      power: 'off',
      capabilities: ['thumbnail', 'power-on', 'reboot', 'power-off', 'status'],
    }),
    mk(31, {
      type: DeviceType.PROJECTOR,
      vendor: 'Epson',
      protocol: 'pjlink',
      name: 'Main Projector',
      model: 'EB-L200',
      openPorts: [4352, 80],
      services: ['pjlink', 'http'],
      power: 'off',
      capabilities: ['power-on', 'power-off', 'status'],
    }),
    mk(41, {
      type: DeviceType.SCREEN,
      vendor: 'Samsung',
      protocol: 'pjlink',
      name: 'Left Display',
      model: 'QM55B',
      openPorts: [4352, 80],
      services: ['pjlink', 'http'],
      power: 'off',
      capabilities: ['power-on', 'power-off', 'status'],
    }),
    mk(42, {
      type: DeviceType.SCREEN,
      vendor: 'LG',
      protocol: 'http',
      name: 'Right Display',
      model: '55UL3J',
      openPorts: [80],
      services: ['http'],
      power: 'off',
      capabilities: ['power-on', 'power-off'],
    }),
  ];
}
