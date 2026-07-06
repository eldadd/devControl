// Exports the discovered/learned fleet to a JSON document. This is the
// "export them to json" deliverable — a portable inventory of every device,
// its role, control protocol, learned capabilities, and current power state.

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

export function buildExport(devices, { cidr = '' } = {}) {
  const byType = (t) => devices.filter((d) => d.type === t).length;
  return {
    schema: 'devcontrolanalyzer/inventory@1',
    generatedAt: new Date().toISOString(),
    network: { cidr },
    summary: {
      total: devices.length,
      pcs: byType('pc'),
      projectors: byType('projector'),
      screens: byType('screen'),
      controllers: byType('controller'),
      unknown: byType('unknown'),
    },
    devices: devices.map((d) => ({
      id: d.id,
      ip: d.ip,
      name: d.name,
      type: d.type,
      vendor: d.vendor,
      model: d.model || null,
      protocol: d.protocol,
      openPorts: d.openPorts,
      services: d.services,
      power: d.power,
      capabilities: d.capabilities,
      learned: d.learned,
      lastSeen: d.lastSeen,
    })),
  };
}

export function writeExport(devices, opts = {}) {
  const doc = buildExport(devices, opts);
  fs.mkdirSync(config.dataDir, { recursive: true });
  const file = path.join(config.dataDir, 'inventory.json');
  fs.writeFileSync(file, JSON.stringify(doc, null, 2));
  return file;
}
