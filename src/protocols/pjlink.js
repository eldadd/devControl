// PJLink Class 1 adapter for projectors (TCP 4352).
// Implements the subset we need: power query/set and info query. Authentication
// (when the projector challenges with a nonce) is negotiated using MD5 of
// nonce+password, per the PJLink spec.
//
// Reference: JBMIA PJLink Class 1 specification. Commands are ASCII lines of the
// form "%1POWR ?\r" (query) or "%1POWR 1\r" (power on). Responses look like
// "%1POWR=0\r" (0=off, 1=on, 2=cooling, 3=warming).

import net from 'node:net';
import crypto from 'node:crypto';
import { config } from '../config.js';

const PORT = 4352;

// Open a connection, perform the (optional) auth handshake, run one command,
// return the parsed response body. `password` may be empty for open projectors.
function command(host, body, password = '') {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let stage = 'greeting';
    let buf = '';
    let settled = false;

    const done = (err, val) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve(val);
    };

    socket.setTimeout(config.vnc?.connectTimeoutMs || 3000);
    socket.once('error', done);
    socket.once('timeout', () => done(new Error('pjlink timeout')));
    socket.connect(PORT, host);

    socket.on('data', (chunk) => {
      buf += chunk.toString('ascii');
      const nl = buf.indexOf('\r');
      if (nl === -1) return;
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);

      if (stage === 'greeting') {
        // "PJLINK 0" (no auth) or "PJLINK 1 <8-hex-nonce>" (auth required).
        const m = line.match(/^PJLINK\s+(\d)(?:\s+([0-9a-fA-F]+))?/);
        if (!m) return done(new Error(`unexpected greeting: ${line}`));
        let prefix = '';
        if (m[1] === '1') {
          const nonce = m[2] || '';
          prefix = crypto
            .createHash('md5')
            .update(nonce + password)
            .digest('hex');
        }
        stage = 'command';
        socket.write(`${prefix}${body}\r`);
        return;
      }

      // Command response line, e.g. "%1POWR=0" or "%1POWR=ERR3".
      const rm = line.match(/^%1[A-Z]{4}=(.*)$/);
      if (rm) return done(null, rm[1]);
      done(new Error(`unexpected response: ${line}`));
    });
  });
}

export async function getPower(host, password = '') {
  const val = await command(host, '%1POWR ?', password);
  switch (val) {
    case '0':
      return 'off';
    case '1':
      return 'on';
    case '2':
      return 'cooling';
    case '3':
      return 'warming';
    default:
      return 'unknown';
  }
}

export async function setPower(host, on, password = '') {
  const val = await command(host, `%1POWR ${on ? '1' : '0'}`, password);
  if (val.startsWith('ERR')) throw new Error(`pjlink error: ${val}`);
  return true;
}

export async function getInfo(host, password = '') {
  const [name, manuf, model] = await Promise.all([
    command(host, '%1NAME ?', password).catch(() => ''),
    command(host, '%1INF1 ?', password).catch(() => ''),
    command(host, '%1INF2 ?', password).catch(() => ''),
  ]);
  return { name, vendor: manuf, model };
}

export const capabilities = ['power', 'reboot'];
