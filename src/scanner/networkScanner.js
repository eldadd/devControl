// Sweeps a CIDR range, probing each host for the ports we care about.
// Uses raw TCP connect probes (net.Socket) so it needs no privileges and no
// external tooling. A host that answers on any probed port is "up".

import net from 'node:net';
import { expandCidr } from './cidr.js';
import { config } from '../config.js';

// Attempt a TCP connect to host:port. Resolves true if the connection is
// accepted before the timeout, false otherwise. Never rejects.
function probePort(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (open) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

// Probe one host across all configured ports. Returns { ip, openPorts } or null.
async function probeHost(ip, ports, timeoutMs) {
  const results = await Promise.all(
    ports.map(async (port) => ({ port, open: await probePort(ip, port, timeoutMs) })),
  );
  const openPorts = results.filter((r) => r.open).map((r) => r.port);
  return openPorts.length ? { ip, openPorts } : null;
}

// Run tasks with bounded concurrency.
async function pool(items, limit, worker) {
  const out = [];
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return out;
}

/**
 * Scan a CIDR range.
 * @param {string} cidr e.g. "192.168.1.0/24"
 * @param {(progress:{done:number,total:number,found:number})=>void} [onProgress]
 * @returns {Promise<Array<{ip:string, openPorts:number[]}>>}
 */
export async function scanNetwork(cidr, onProgress) {
  const hosts = expandCidr(cidr);
  const { ports, connectTimeoutMs, concurrency } = config.scan;
  let done = 0;
  let found = 0;
  const results = await pool(hosts, concurrency, async (ip) => {
    const res = await probeHost(ip, ports, connectTimeoutMs);
    done++;
    if (res) found++;
    if (onProgress) onProgress({ done, total: hosts.length, found });
    return res;
  });
  return results.filter(Boolean);
}
