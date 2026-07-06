// Minimal RFB (VNC) client: enough of the protocol to capture a single
// framebuffer for a thumbnail. Implements the RFB 3.3/3.7/3.8 handshake,
// "None" and "VNC" (DES) authentication, Raw encoding, and one
// FramebufferUpdate. No external dependencies.
//
// This is a read-only capture path used for PC thumbnails. Power actions for
// PCs go through WOL (power-on) and an OS agent / VNC "logout" is out of scope;
// reboot/shutdown are issued via the controller or an SSH/agent hook when
// available (see controlManager).

import net from 'node:net';
import crypto from 'node:crypto';
import { encodePNG, placeholderPNG } from './png.js';
import { config } from '../config.js';

// VNC DES: the password is used as a DES key with each byte's bits reversed.
function vncDesKey(password) {
  const key = Buffer.alloc(8, 0);
  const pw = Buffer.from(password.slice(0, 8), 'latin1');
  pw.copy(key);
  for (let i = 0; i < 8; i++) {
    let b = key[i];
    let r = 0;
    for (let j = 0; j < 8; j++) r |= ((b >> j) & 1) << (7 - j);
    key[i] = r;
  }
  return key;
}

function encryptChallenge(challenge, password) {
  const key = vncDesKey(password);
  const cipher = crypto.createCipheriv('des-ecb', key, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(challenge), cipher.final()]);
}

// Nearest-neighbour downscale of an RGB buffer to (dw x dh).
function downscale(src, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 3);
  for (let y = 0; y < dh; y++) {
    const sy = Math.floor((y * sh) / dh);
    for (let x = 0; x < dw; x++) {
      const sx = Math.floor((x * sw) / dw);
      const si = (sy * sw + sx) * 3;
      const di = (y * dw + x) * 3;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
    }
  }
  return out;
}

/**
 * Connect to a VNC server and capture one frame as a PNG thumbnail.
 * @returns {Promise<{png:Buffer, width:number, height:number, live:boolean}>}
 * Resolves with a placeholder (live:false) if capture fails, so the UI always
 * has an image.
 */
export function captureThumbnail(host, { port = 5900, password = '', seed = 0 } = {}) {
  const { thumbWidth, thumbHeight, connectTimeoutMs } = config.vnc;
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    let stage = 'version';
    let buf = Buffer.alloc(0);
    let fb = null; // { width, height, pixels }
    let numSecTypes = 0;

    const fallback = () =>
      resolve({
        png: placeholderPNG(thumbWidth, thumbHeight, seed),
        width: thumbWidth,
        height: thumbHeight,
        live: false,
      });

    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      socket.destroy();
      fallback();
    };

    socket.setTimeout(connectTimeoutMs);
    socket.once('error', fail);
    socket.once('timeout', fail);
    socket.connect(port, host);

    const need = (n) => buf.length >= n;
    const take = (n) => {
      const out = buf.slice(0, n);
      buf = buf.slice(n);
      return out;
    };

    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      try {
        step();
      } catch {
        fail();
      }
    });

    function step() {
      if (stage === 'version') {
        if (!need(12)) return;
        take(12); // "RFB 003.00x\n"
        socket.write(Buffer.from('RFB 003.008\n', 'ascii'));
        stage = 'security-list';
        return;
      }

      if (stage === 'security-list') {
        if (!need(1)) return;
        numSecTypes = buf[0];
        if (numSecTypes === 0) return fail(); // server rejected; reason follows
        if (!need(1 + numSecTypes)) return;
        take(1);
        const types = Array.from(take(numSecTypes));
        // Prefer None(1); else VNC(2) if we have a password.
        let chosen = types.includes(1) ? 1 : types.includes(2) ? 2 : types[0];
        socket.write(Buffer.from([chosen]));
        stage = chosen === 2 ? 'vnc-challenge' : 'security-result';
        return;
      }

      if (stage === 'vnc-challenge') {
        if (!need(16)) return;
        const challenge = take(16);
        socket.write(encryptChallenge(challenge, password));
        stage = 'security-result';
        return;
      }

      if (stage === 'security-result') {
        if (!need(4)) return;
        const ok = take(4).readUInt32BE(0);
        if (ok !== 0) return fail();
        socket.write(Buffer.from([1])); // ClientInit: shared
        stage = 'server-init';
        return;
      }

      if (stage === 'server-init') {
        if (!need(24)) return;
        const width = buf.readUInt16BE(0);
        const height = buf.readUInt16BE(2);
        const nameLen = buf.readUInt32BE(20);
        if (!need(24 + nameLen)) return;
        take(24);
        take(nameLen);
        fb = { width, height, pixels: Buffer.alloc(width * height * 3) };

        // SetPixelFormat: 32bpp, depth 24, big-endian, true-colour RGB888.
        const spf = Buffer.alloc(20);
        spf[0] = 0; // message type
        spf[4] = 32; // bits-per-pixel
        spf[5] = 24; // depth
        spf[6] = 1; // big-endian
        spf[7] = 1; // true-colour
        spf.writeUInt16BE(255, 8); // red max
        spf.writeUInt16BE(255, 10); // green max
        spf.writeUInt16BE(255, 12); // blue max
        spf[14] = 16; // red shift
        spf[15] = 8; // green shift
        spf[16] = 0; // blue shift
        socket.write(spf);

        // SetEncodings: Raw(0) only.
        const enc = Buffer.alloc(4 + 4);
        enc[0] = 2;
        enc.writeUInt16BE(1, 2);
        enc.writeInt32BE(0, 4);
        socket.write(enc);

        // FramebufferUpdateRequest: full frame, non-incremental.
        const fur = Buffer.alloc(10);
        fur[0] = 3;
        fur[1] = 0;
        fur.writeUInt16BE(0, 2);
        fur.writeUInt16BE(0, 4);
        fur.writeUInt16BE(width, 6);
        fur.writeUInt16BE(height, 8);
        socket.write(fur);

        stage = 'fb-update-header';
        return;
      }

      if (stage === 'fb-update-header') {
        if (!need(1)) return;
        if (buf[0] !== 0) {
          // Not a FramebufferUpdate (e.g. server bell). Skip 1 byte and retry.
          take(1);
          return step();
        }
        if (!need(4)) return;
        // [type=0][padding][rect-count:U16]
        stepRects.remaining = buf.readUInt16BE(2);
        take(4);
        stage = 'fb-rects';
        return step();
      }

      if (stage === 'fb-rects') return stepRects();
    }

    // Rectangle reader kept separate so it can hold cross-chunk state.
    function stepRects() {
      while (stepRects.remaining > 0) {
        if (!need(12)) return;
        const x = buf.readUInt16BE(0);
        const y = buf.readUInt16BE(2);
        const w = buf.readUInt16BE(4);
        const h = buf.readUInt16BE(6);
        const encoding = buf.readInt32BE(8);
        const pixBytes = w * h * 4;
        if (encoding !== 0) return fail(); // only Raw supported
        if (!need(12 + pixBytes)) return;
        take(12);
        const pix = take(pixBytes);
        // Copy RGB (drop alpha/pad byte) into the framebuffer.
        for (let row = 0; row < h; row++) {
          for (let col = 0; col < w; col++) {
            const si = (row * w + col) * 4;
            const dx = x + col;
            const dy = y + row;
            if (dx >= fb.width || dy >= fb.height) continue;
            const di = (dy * fb.width + dx) * 3;
            // 32bpp big-endian RGB888 => bytes are [pad? , R, G, B] per our
            // SetPixelFormat shifts (R<<16,G<<8,B). Byte 0 is MSB.
            fb.pixels[di] = pix[si + 1];
            fb.pixels[di + 1] = pix[si + 2];
            fb.pixels[di + 2] = pix[si + 3];
          }
        }
        stepRects.remaining -= 1;
      }
      // All rectangles read: produce the thumbnail.
      const scaled = downscale(fb.pixels, fb.width, fb.height, thumbWidth, thumbHeight);
      finish({
        png: encodePNG(thumbWidth, thumbHeight, scaled),
        width: thumbWidth,
        height: thumbHeight,
        live: true,
      });
    }
    stepRects.remaining = undefined;
  });
}

// Cheap reachability check used by the validator for PCs.
export function isReachable(host, port = 5900, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (v) => {
      socket.destroy();
      resolve(v);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

export const capabilities = ['thumbnail', 'power-on'];
