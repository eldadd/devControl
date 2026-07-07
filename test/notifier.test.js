import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeviceStore } from '../src/devices/deviceStore.js';
import { simulatedFleet } from '../src/devices/simulator.js';
import { validateState, powerRoom } from '../src/control/validator.js';
import { RoomWatcher } from '../src/control/watcher.js';
import { config } from '../src/config.js';
import {
  initNotifier,
  resetNotifier,
  isNotifierEnabled,
  pushMessage,
  formatDrift,
  formatRecovery,
} from '../src/telegram/notifier.js';

function seededStore() {
  const store = new DeviceStore();
  store.devices.clear();
  for (const d of simulatedFleet()) store.upsert(d);
  return store;
}

// A fake Telegram api that records every sendMessage.
function fakeApi() {
  const sent = [];
  return { sent, sendMessage: async (chat, text) => sent.push({ chat, text }) };
}

test('notifier pushes to every configured chat', async () => {
  resetNotifier();
  const api = fakeApi();
  initNotifier({ api, chatIds: ['111', '222'] });
  assert.equal(isNotifierEnabled(), true);
  const res = await pushMessage('hello');
  assert.equal(res.sent, 2);
  assert.deepEqual(
    api.sent.map((s) => s.chat),
    ['111', '222'],
  );
  resetNotifier();
});

test('notifier is a no-op when not configured', async () => {
  resetNotifier();
  const res = await pushMessage('nobody-listening');
  assert.equal(res.sent, 0);
});

test('formatDrift and formatRecovery include the expected state', () => {
  const msg = formatDrift('on', [{ name: 'Main Projector', type: 'projector', actual: 'off' }]);
  assert.match(msg, /Power drift/);
  assert.match(msg, /Main Projector/);
  assert.match(msg, /ON/);
  assert.match(formatRecovery('off'), /recovered/i);
});

test('watcher alerts on new drift, debounces, then sends recovery', async () => {
  const store = seededStore();
  store.setExpected('on');
  // Mark everything on, then knock a projector offline.
  for (const d of store.all()) d.power = 'on';
  const projector = store.byType('projector')[0];
  projector.power = 'off';

  const messages = [];
  const watcher = new RoomWatcher(store, {
    notify: async (text) => messages.push(text),
    intervalMs: 0,
  });

  // First tick: new failure -> one drift alert.
  let r = await watcher.tick();
  assert.equal(r.newFailures.length, 1);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /Main Projector/);

  // Second tick, same failure -> debounced, no new message.
  r = await watcher.tick();
  assert.equal(r.newFailures.length, 0);
  assert.equal(messages.length, 1);

  // Projector recovers -> recovery message.
  projector.power = 'on';
  r = await watcher.tick();
  assert.equal(r.recovered, true);
  assert.equal(messages.length, 2);
  assert.match(messages[1], /recovered/i);
});

test('watcher skips when no expected state is set', async () => {
  const store = seededStore();
  const watcher = new RoomWatcher(store, { notify: async () => {}, intervalMs: 0 });
  const r = await watcher.tick();
  assert.equal(r.skipped, true);
});

test('powerRoom pushes a command-failure alert when a device does not follow', async () => {
  resetNotifier();
  const api = fakeApi();
  initNotifier({ api, chatIds: ['999'] });

  // Don't wait the full settle window for this deliberately-failing case.
  config.validation.settleMs = 0;
  const store = seededStore();
  // Force the projector to ignore power commands by making it non-simulated with
  // no real endpoint: stub its type handling via a getter that stays off.
  const projector = store.byType('projector')[0];
  Object.defineProperty(projector, 'power', {
    get: () => 'off',
    set: () => {},
    configurable: true,
  });

  const res = await powerRoom(store, true, { });
  assert.equal(res.converged, false);
  assert.ok(api.sent.length >= 1);
  assert.match(api.sent[0].text, /did not fully apply/);
  resetNotifier();
});
