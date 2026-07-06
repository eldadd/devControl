// Wake-on-LAN: send a magic packet to power on a PC by MAC address.
// The magic packet is 6 bytes of 0xFF followed by the target MAC repeated 16
// times, broadcast as UDP to port 9 (and 7). Requires the NIC to have WOL
// enabled in BIOS/OS; there is no acknowledgement, so callers should validate
// via a follow-up reachability/VNC check.

import dgram from 'node:dgram';

function macToBytes(mac) {
  const clean = mac.replace(/[^0-9a-fA-F]/g, '');
  if (clean.length !== 12) throw new Error(`invalid MAC: ${mac}`);
  return Buffer.from(clean, 'hex');
}

export function wake(mac, { broadcast = '255.255.255.255', port = 9 } = {}) {
  return new Promise((resolve, reject) => {
    const macBuf = macToBytes(mac);
    const packet = Buffer.alloc(6 + 16 * 6, 0xff);
    for (let i = 0; i < 16; i++) macBuf.copy(packet, 6 + i * 6);

    const socket = dgram.createSocket('udp4');
    socket.once('error', (e) => {
      socket.close();
      reject(e);
    });
    socket.bind(() => {
      socket.setBroadcast(true);
      socket.send(packet, 0, packet.length, port, broadcast, (err) => {
        socket.close();
        if (err) reject(err);
        else resolve(true);
      });
    });
  });
}

export const capabilities = ['power-on'];
