import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeviceStore } from '../src/devices/deviceStore.js';
import { simulatedFleet } from '../src/devices/simulator.js';
import { mainMenu, devicesMenu, deviceMenu, escape } from '../src/telegram/menu.js';
import { handleCommand, handleCallback } from '../src/telegram/handlers.js';

function seededStore() {
  const store = new DeviceStore();
  store.devices.clear();
  for (const d of simulatedFleet()) store.upsert(d);
  return store;
}

test('mainMenu reports the controller and room buttons', () => {
  const menu = mainMenu(seededStore());
  assert.match(menu.text, /Controller/);
  const labels = menu.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
  assert.ok(labels.includes('room:on'));
  assert.ok(labels.includes('room:off'));
  assert.ok(labels.includes('menu:devices'));
});

test('devicesMenu lists every device with a dev: callback', () => {
  const store = seededStore();
  const menu = devicesMenu(store);
  const buttons = menu.reply_markup.inline_keyboard.flat();
  const devButtons = buttons.filter((b) => b.callback_data.startsWith('dev:'));
  assert.equal(devButtons.length, store.all().length);
});

test('deviceMenu for a projector offers on/off but not restart', () => {
  const store = seededStore();
  const projector = store.byType('projector')[0];
  const menu = deviceMenu(projector);
  const cbs = menu.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
  assert.ok(cbs.includes(`pwr:${projector.ip}:on`));
  assert.ok(cbs.includes(`pwr:${projector.ip}:off`));
  assert.ok(!cbs.some((c) => c.startsWith('reboot:')));
});

test('/menu command returns the main menu', async () => {
  const resp = await handleCommand(seededStore(), '/menu');
  assert.match(resp.text, /devControlAnalyzer/);
});

test('room:on callback powers the room on and validates', async () => {
  const store = seededStore();
  const resp = await handleCallback(store, 'room:on');
  assert.match(resp.text, /Room power ON/);
  assert.match(resp.answer, /followed/);
  for (const d of store.all().filter((x) => x.type !== 'controller')) {
    assert.equal(d.power, 'on');
  }
});

test('pwr callback toggles a single device', async () => {
  const store = seededStore();
  const pc = store.byType('pc')[0];
  const resp = await handleCallback(store, `pwr:${pc.ip}:on`);
  assert.equal(store.get(pc.ip).power, 'on');
  assert.match(resp.answer, /Power ON sent/);
});

test('thumb callback returns a PNG photo payload', async () => {
  const store = seededStore();
  const pc = store.byType('pc')[0];
  const resp = await handleCallback(store, `thumb:${pc.ip}`);
  assert.ok(Buffer.isBuffer(resp.photo));
  assert.ok(resp.photo.length > 100);
});

test('escape neutralizes Markdown control characters', () => {
  assert.equal(escape('a_b*c`d[e'), 'a\\_b\\*c\\`d\\[e');
});
