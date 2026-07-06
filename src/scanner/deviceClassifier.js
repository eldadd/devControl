// Turns a raw scan result (ip + open ports) into a typed device with a guessed
// role and the control protocol we'll use for it. This is deliberately
// heuristic: the protocol learner (src/protocols/protocolLearner.js) later
// refines/confirms these guesses by actually talking to the device.

import { KNOWN_PORTS } from '../config.js';

export const DeviceType = {
  PC: 'pc',
  PROJECTOR: 'projector',
  SCREEN: 'screen',
  CONTROLLER: 'controller',
  UNKNOWN: 'unknown',
};

// Given open ports, rank the most likely role. Order matters: controllers and
// projectors have distinctive ports, so they win over generic http/vnc.
export function classify({ ip, openPorts }) {
  const has = (p) => openPorts.includes(p);
  const services = openPorts.map((p) => KNOWN_PORTS[p]).filter(Boolean);

  let type = DeviceType.UNKNOWN;
  let protocol = 'unknown';
  let vendor = 'unknown';

  if (has(41794)) {
    type = DeviceType.CONTROLLER;
    protocol = 'crestron-cip';
    vendor = 'Crestron';
  } else if (has(1319)) {
    type = DeviceType.CONTROLLER;
    protocol = 'amx-icsp';
    vendor = 'AMX';
  } else if (has(4352)) {
    type = DeviceType.PROJECTOR;
    protocol = 'pjlink';
  } else if (has(5900) || has(5901)) {
    type = DeviceType.PC;
    protocol = 'vnc';
  } else if (services.includes('http') || services.includes('https')) {
    // A bare web endpoint is ambiguous: could be a networked display, a smart
    // screen, or a PC. Default to screen; the learner may reclassify.
    type = DeviceType.SCREEN;
    protocol = 'http';
  }

  return {
    id: ip.replace(/\./g, '-'),
    ip,
    openPorts,
    services,
    type,
    protocol,
    vendor,
    name: `${type}@${ip}`,
    power: 'unknown', // on | off | unknown
    reachable: true,
    learned: false, // set true once the protocol learner confirms control
    capabilities: [], // e.g. ['power','reboot','thumbnail']
    lastSeen: new Date().toISOString(),
  };
}
