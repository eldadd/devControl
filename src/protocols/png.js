// Tiny PNG encoder (truecolor RGB, no external deps). Used to turn captured VNC
// framebuffers into thumbnails. Uses the built-in zlib for IDAT compression.

import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/**
 * Encode raw RGB pixels to a PNG buffer.
 * @param {number} width
 * @param {number} height
 * @param {Buffer} rgb  width*height*3 bytes, row-major
 * @returns {Buffer}
 */
export function encodePNG(width, height, rgb) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Prepend a filter-type byte (0 = none) to each scanline.
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }

  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Generate a simple placeholder thumbnail (diagonal gradient + label band) when
// a real framebuffer can't be captured. Keeps the UI populated for offline or
// simulated devices.
export function placeholderPNG(width, height, seed = 0) {
  const rgb = Buffer.alloc(width * height * 3);
  const r0 = (seed * 53) % 128;
  const g0 = (seed * 97) % 128;
  const b0 = (seed * 29) % 128;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const t = (x + y) / (width + height);
      rgb[i] = Math.min(255, r0 + t * 120);
      rgb[i + 1] = Math.min(255, g0 + t * 120);
      rgb[i + 2] = Math.min(255, b0 + t * 160);
    }
  }
  return encodePNG(width, height, rgb);
}
