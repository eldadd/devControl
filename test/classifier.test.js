import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, DeviceType } from '../src/scanner/deviceClassifier.js';

test('crestron port classifies as controller', () => {
  const d = classify({ ip: '10.0.0.10', openPorts: [41794, 80] });
  assert.equal(d.type, DeviceType.CONTROLLER);
  assert.equal(d.vendor, 'Crestron');
});

test('amx port classifies as controller', () => {
  const d = classify({ ip: '10.0.0.11', openPorts: [1319] });
  assert.equal(d.type, DeviceType.CONTROLLER);
  assert.equal(d.vendor, 'AMX');
});

test('pjlink port classifies as projector', () => {
  const d = classify({ ip: '10.0.0.31', openPorts: [4352, 80] });
  assert.equal(d.type, DeviceType.PROJECTOR);
  assert.equal(d.protocol, 'pjlink');
});

test('vnc port classifies as pc', () => {
  const d = classify({ ip: '10.0.0.21', openPorts: [5900, 22] });
  assert.equal(d.type, DeviceType.PC);
});

test('bare http classifies as screen', () => {
  const d = classify({ ip: '10.0.0.42', openPorts: [80] });
  assert.equal(d.type, DeviceType.SCREEN);
});
