import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodePNG, placeholderPNG } from '../src/protocols/png.js';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test('encodePNG produces a valid PNG signature and IEND', () => {
  const rgb = Buffer.alloc(4 * 4 * 3, 128);
  const png = encodePNG(4, 4, rgb);
  assert.ok(png.subarray(0, 8).equals(PNG_SIG));
  assert.ok(png.includes(Buffer.from('IHDR')));
  assert.ok(png.includes(Buffer.from('IDAT')));
  assert.ok(png.includes(Buffer.from('IEND')));
});

test('placeholderPNG returns a non-trivial buffer', () => {
  const png = placeholderPNG(64, 40, 7);
  assert.ok(png.length > 100);
  assert.ok(png.subarray(0, 8).equals(PNG_SIG));
});
