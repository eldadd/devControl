// Protocol learning: given a classified device, actually talk to it to confirm
// which control protocol works, discover its current power state, enrich its
// identity (name/vendor/model), and record the concrete capabilities we can
// offer in the UI. This is the "learns the devices' control protocol" step.
//
// Everything here is best-effort and non-destructive: we only query, never
// change power state during learning.

import { DeviceType } from '../scanner/deviceClassifier.js';
import * as pjlink from './pjlink.js';
import * as crestron from './crestron.js';
import * as amx from './amx.js';
import * as vnc from './vnc.js';
import * as screen from './screen.js';

// Learn/confirm control for a single device. Mutates and returns the device.
export async function learnDevice(device, { password = '' } = {}) {
  device.capabilities = [];
  try {
    switch (device.type) {
      case DeviceType.PROJECTOR: {
        const power = await pjlink.getPower(device.ip, password);
        device.power = power === 'cooling' ? 'off' : power === 'warming' ? 'on' : power;
        const info = await pjlink.getInfo(device.ip, password).catch(() => ({}));
        if (info.name) device.name = info.name;
        if (info.vendor) device.vendor = info.vendor;
        if (info.model) device.model = info.model;
        device.protocol = 'pjlink';
        device.capabilities = ['power-on', 'power-off', 'status'];
        device.learned = true;
        break;
      }
      case DeviceType.PC: {
        const reachable = await vnc.isReachable(device.ip);
        device.power = reachable ? 'on' : 'off';
        device.protocol = 'vnc';
        // Power-on via WOL requires a MAC; reboot/off via controller or agent.
        device.capabilities = ['thumbnail', 'power-on', 'reboot', 'power-off', 'status'];
        device.learned = true;
        break;
      }
      case DeviceType.SCREEN: {
        const power = await screen
          .getPower(device.ip, { openPorts: device.openPorts, password })
          .catch(() => 'unknown');
        device.power = power;
        device.protocol = device.openPorts.includes(4352) ? 'pjlink' : 'http';
        device.capabilities = device.openPorts.includes(4352)
          ? ['power-on', 'power-off', 'status']
          : ['power-on', 'power-off']; // routed via controller
        device.learned = device.openPorts.includes(4352);
        break;
      }
      case DeviceType.CONTROLLER: {
        const adapter = device.vendor === 'AMX' ? amx : crestron;
        const info = await adapter.getInfo(device.ip).catch(() => ({}));
        if (info.info) device.info = info.info;
        device.protocol = device.vendor === 'AMX' ? 'amx-icsp' : 'crestron-cip';
        device.capabilities = ['macro-power-on', 'macro-power-off', 'source-of-truth'];
        device.learned = true;
        break;
      }
      default:
        device.capabilities = [];
    }
  } catch (err) {
    device.learnError = String(err.message || err);
  }
  device.lastSeen = new Date().toISOString();
  return device;
}

// Learn a whole fleet with bounded concurrency.
export async function learnFleet(devices, opts = {}) {
  const limit = 16;
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, devices.length) }, async () => {
    while (i < devices.length) {
      const d = devices[i++];
      await learnDevice(d, opts);
    }
  });
  await Promise.all(runners);
  return devices;
}
