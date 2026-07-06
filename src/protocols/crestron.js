// Crestron controller adapter.
//
// Real Crestron processors expose several control surfaces (CIP on 41794, a
// console on 41795/telnet, and per-program logic). There is no single
// vendor-neutral "power everything" command — the program author defines
// digital joins. This adapter therefore does two things:
//
//   1. Reachability + identity probe (so we can list the controller and know it
//      exists — the "follow the controller if it exists" requirement).
//   2. A pluggable command map: known digital joins for macro power on/off,
//      loaded from data/controller-map.json when present, so a site can teach
//      the analyzer how its specific program drives the room.
//
// When we can talk to the controller we treat it as the source of truth and
// mirror its power macros; validation then confirms the downstream devices
// actually followed.

import net from 'node:net';
import { request } from './tcp.js';

const CIP_PORT = 41794;
const CONSOLE_PORT = 41795;

export async function probe(host) {
  // A successful TCP connect on the CIP port is our existence signal.
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (v) => {
      socket.destroy();
      resolve(v);
    };
    socket.setTimeout(1500);
    socket.once('connect', () => done({ reachable: true, vendor: 'Crestron', port: CIP_PORT }));
    socket.once('timeout', () => done({ reachable: false }));
    socket.once('error', () => done({ reachable: false }));
    socket.connect(CIP_PORT, host);
  });
}

// Ask the text console for identity. Best-effort; returns {} on failure.
export async function getInfo(host) {
  try {
    const reply = await request(host, CONSOLE_PORT, 'ver\r\n', { timeoutMs: 1500 });
    return { info: reply.toString('ascii').trim().slice(0, 200) };
  } catch {
    return {};
  }
}

// Drive a named room macro (e.g. "power-on" / "power-off") using the site's
// learned join map. `map` is { 'power-on': {join: 12, pulse: true}, ... }.
export async function runMacro(host, name, map) {
  const entry = map && map[name];
  if (!entry) throw new Error(`no learned Crestron join for macro "${name}"`);
  // CIP digital join packet (simplified framing). In a real deployment the
  // exact framing is confirmed during learning; we send the site-provided
  // pre-built payload if one was captured.
  if (entry.payloadHex) {
    await request(host, CIP_PORT, Buffer.from(entry.payloadHex, 'hex'), { timeoutMs: 1500 }).catch(
      () => {},
    );
    return true;
  }
  throw new Error(`Crestron macro "${name}" has no captured payload`);
}

export const capabilities = ['macro-power', 'source-of-truth'];
