import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeviceStore } from '../src/devices/deviceStore.js';
import { simulatedFleet } from '../src/devices/simulator.js';
import { powerRoom, validateState } from '../src/control/validator.js';

function seededStore() {
  const store = new DeviceStore();
  store.devices.clear();
  for (const d of simulatedFleet()) store.upsert(d);
  return store;
}

test('powerRoom(on) drives all devices on via controller and converges', async () => {
  const store = seededStore();
  const res = await powerRoom(store, true);
  assert.equal(res.viaController, true);
  assert.equal(res.converged, true);
  for (const r of res.report) assert.equal(r.actual, 'on', `${r.name} should be on`);
});

test('powerRoom(off) drives all devices off and converges', async () => {
  const store = seededStore();
  await powerRoom(store, true);
  const res = await powerRoom(store, false);
  assert.equal(res.converged, true);
  for (const r of res.report) assert.equal(r.actual, 'off', `${r.name} should be off`);
});

test('validateState flags a device that did not follow', async () => {
  const store = seededStore();
  await powerRoom(store, true);
  // Simulate a projector that failed to power on.
  const projector = store.byType('projector')[0];
  projector.power = 'off';
  const res = await validateState(store, 'on');
  assert.equal(res.converged, false);
  const bad = res.report.find((r) => r.ip === projector.ip);
  assert.equal(bad.ok, false);
});

test('controller is excluded from follow targets', async () => {
  const store = seededStore();
  const res = await powerRoom(store, true);
  assert.ok(!res.report.some((r) => r.type === 'controller'));
});
