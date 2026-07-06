// AMX controller adapter (ICSP on 1319, telnet console on 23).
//
// As with Crestron, room power is defined by the NetLinx program via channel
// events, not a universal command. We probe for existence/identity and drive
// site-learned channel pulses from the controller map.

import net from 'node:net';
import { request } from './tcp.js';

const ICSP_PORT = 1319;
const TELNET_PORT = 23;

export async function probe(host) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (v) => {
      socket.destroy();
      resolve(v);
    };
    socket.setTimeout(1500);
    socket.once('connect', () => done({ reachable: true, vendor: 'AMX', port: ICSP_PORT }));
    socket.once('timeout', () => done({ reachable: false }));
    socket.once('error', () => done({ reachable: false }));
    socket.connect(ICSP_PORT, host);
  });
}

export async function getInfo(host) {
  try {
    const reply = await request(host, TELNET_PORT, 'show device\r\n', { timeoutMs: 1500 });
    return { info: reply.toString('ascii').trim().slice(0, 200) };
  } catch {
    return {};
  }
}

export async function runMacro(host, name, map) {
  const entry = map && map[name];
  if (!entry) throw new Error(`no learned AMX channel for macro "${name}"`);
  if (entry.payloadHex) {
    await request(host, ICSP_PORT, Buffer.from(entry.payloadHex, 'hex'), { timeoutMs: 1500 }).catch(
      () => {},
    );
    return true;
  }
  throw new Error(`AMX macro "${name}" has no captured payload`);
}

export const capabilities = ['macro-power', 'source-of-truth'];
