// Orchestrates a full discovery pass: scan the network, classify each host,
// learn its control protocol, and merge the result into the store. Falls back
// to (or augments with) a simulated fleet when configured, so there is always
// something to control.

import { scanNetwork } from '../scanner/networkScanner.js';
import { classify } from '../scanner/deviceClassifier.js';
import { learnFleet } from '../protocols/protocolLearner.js';
import { simulatedFleet } from './simulator.js';
import { store } from './deviceStore.js';
import { writeExport } from './exporter.js';
import { config, detectCidr } from '../config.js';

let running = false;
let lastProgress = { done: 0, total: 0, found: 0 };

export function scanProgress() {
  return { running, ...lastProgress };
}

/**
 * Run one discovery + learning pass.
 * @param {{cidr?:string, password?:string, persist?:boolean}} [opts]
 */
export async function runAnalysis(opts = {}) {
  if (running) return { skipped: true, reason: 'scan-in-progress' };
  running = true;
  lastProgress = { done: 0, total: 0, found: 0 };

  const raw = (opts.cidr || detectCidr() || '').trim();
  // Only scan when we have a syntactically valid IPv4 CIDR; otherwise fall
  // through to the simulated fleet.
  const cidr = /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(raw) ? raw : '';
  try {
    let devices = [];
    if (cidr) {
      const found = await scanNetwork(cidr, (p) => {
        lastProgress = p;
      });
      devices = found.map(classify);
      await learnFleet(devices, { password: opts.password || '' });
    }

    // If nothing real answered (dev/offline) or simulation is forced on, add the
    // simulated fleet so the analyzer is demonstrable.
    if (config.simulate && devices.length === 0) {
      devices = simulatedFleet();
    }

    for (const d of devices) store.upsert(d);
    if (opts.persist !== false) {
      store.persist();
      writeExport(store.all(), { cidr });
    }
    return { cidr, count: devices.length, devices: store.all() };
  } finally {
    running = false;
  }
}

// Ensure the store is populated at startup (simulated fleet if empty & enabled).
export function ensureSeeded() {
  if (store.all().length === 0 && config.simulate) {
    for (const d of simulatedFleet()) store.upsert(d);
    store.persist();
    writeExport(store.all(), { cidr: 'simulated' });
  }
}
