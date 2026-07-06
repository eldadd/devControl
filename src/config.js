// Central configuration. Values can be overridden with environment variables so
// the same build runs in dev (simulated devices) and on a real AV network.

import os from 'node:os';

function envInt(name, fallback) {
  const v = process.env[name];
  if (v === undefined) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(name, fallback) {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(v);
}

// Ports we fingerprint devices with. Each maps to a candidate device role /
// control protocol handled by an adapter in src/protocols.
export const KNOWN_PORTS = {
  22: 'ssh',
  23: 'telnet', // AMX / many controllers, and PJLink-over-telnet-ish gear
  80: 'http',
  443: 'https',
  4352: 'pjlink', // projectors (PJLink standard)
  5900: 'vnc', // PCs / KVM
  5901: 'vnc',
  41794: 'crestron-cip', // Crestron control port
  1319: 'amx-icsp', // AMX ICSP
  8080: 'http-alt',
  9: 'wol', // Wake-on-LAN (UDP; listed for reference)
};

export const config = {
  // HTTP server for the control dashboard + REST API.
  server: {
    host: process.env.HOST || '0.0.0.0',
    port: envInt('PORT', 8700),
  },

  scan: {
    // CIDR to scan. If empty we auto-derive from the host's primary interface.
    cidr: process.env.SCAN_CIDR || '',
    // Milliseconds to wait for a TCP connect when probing a port.
    connectTimeoutMs: envInt('SCAN_CONNECT_TIMEOUT_MS', 400),
    // How many host probes to run at once.
    concurrency: envInt('SCAN_CONCURRENCY', 128),
    ports: Object.keys(KNOWN_PORTS).map(Number),
    // Re-scan interval for the background scanner (ms). 0 disables.
    intervalMs: envInt('SCAN_INTERVAL_MS', 0),
  },

  // When no real hardware answers, generate a small simulated fleet so the UI
  // and validation engine are demonstrable. Auto-on unless explicitly disabled.
  simulate: envBool('SIMULATE', true),

  // Where discovered devices + learned protocols are persisted.
  dataDir: process.env.DATA_DIR || 'data',

  vnc: {
    // Target thumbnail size (px). Framebuffers are downscaled to fit.
    thumbWidth: envInt('VNC_THUMB_WIDTH', 320),
    thumbHeight: envInt('VNC_THUMB_HEIGHT', 200),
    connectTimeoutMs: envInt('VNC_TIMEOUT_MS', 2500),
  },

  validation: {
    // After issuing a power command, how long to wait before confirming the
    // whole fleet reached the expected state, and how often to poll.
    settleMs: envInt('VALIDATE_SETTLE_MS', 8000),
    pollIntervalMs: envInt('VALIDATE_POLL_MS', 1000),
  },
};

// Derive the primary IPv4 CIDR of this host if none was configured.
export function detectCidr() {
  if (config.scan.cidr) return config.scan.cidr;
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const addr of ifaces[name] || []) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return `${addr.address}/${prefixFromNetmask(addr.netmask)}`;
      }
    }
  }
  return '';
}

function prefixFromNetmask(mask) {
  return mask
    .split('.')
    .map((o) => Number.parseInt(o, 10).toString(2))
    .join('')
    .split('')
    .filter((b) => b === '1').length;
}
