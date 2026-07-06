// Shared helper: open a TCP connection, send a payload, collect the reply, and
// close. Used by the text-based control protocols (PJLink, Crestron, AMX).

import net from 'node:net';

export function request(host, port, payload, { timeoutMs = 3000, expectBytes = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const chunks = [];
    let settled = false;

    const finish = (err, data) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve(data);
    };

    socket.setTimeout(timeoutMs);
    socket.once('error', (e) => finish(e));
    socket.once('timeout', () => finish(new Error('timeout')));
    socket.once('connect', () => {
      if (payload) socket.write(payload);
    });
    socket.on('data', (d) => {
      chunks.push(d);
      const buf = Buffer.concat(chunks);
      if (expectBytes && buf.length >= expectBytes) finish(null, buf);
    });
    socket.once('close', () => finish(null, Buffer.concat(chunks)));
    socket.connect(port, host);
  });
}
