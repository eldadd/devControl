// Maps Telegram commands and callback-button presses to control actions and
// response payloads. Kept transport-free (returns plain objects) so the routing
// and control logic are unit-testable without hitting the Telegram API.
//
// A handler returns: {
//   text?, reply_markup?,   -> render as a message (edit or send)
//   photo?, caption?,       -> send a PNG photo instead of text
//   answer?,                -> optional toast for answerCallbackQuery
//   replace?: bool          -> true = edit the current message, false = new msg
// }

import { mainMenu, devicesMenu, deviceMenu, validationMessage } from './menu.js';
import { setDevicePower, rebootDevice, getThumbnail } from '../control/controlManager.js';
import { powerRoom, validateState } from '../control/validator.js';
import { runAnalysis } from '../devices/analyzer.js';

// Slash commands typed by the user.
export async function handleCommand(store, text) {
  const cmd = text.trim().split(/\s+/)[0].toLowerCase().replace(/@.*$/, '');
  switch (cmd) {
    case '/start':
    case '/menu':
      return { ...mainMenu(store), replace: false };
    case '/devices':
      return { ...devicesMenu(store), replace: false };
    case '/help':
      return {
        text:
          'devControlAnalyzer bot\n\n' +
          '/menu — main control menu\n' +
          '/devices — list & control devices\n' +
          '/help — this message\n\n' +
          'Use the on-screen buttons to power the room on/off (following the ' +
          'controller and validating), control individual devices, view PC ' +
          'thumbnails, or run a network scan.',
        replace: false,
      };
    default:
      return { ...mainMenu(store), replace: false };
  }
}

// Inline-button presses.
export async function handleCallback(store, data) {
  const [ns, ...rest] = data.split(':');

  if (ns === 'menu') {
    if (rest[0] === 'main') return { ...mainMenu(store), replace: true };
    if (rest[0] === 'devices') return { ...devicesMenu(store), replace: true };
    if (rest[0] === 'scan') {
      const res = await runAnalysis({});
      return {
        ...mainMenu(store),
        replace: true,
        answer: `Scan complete — ${res.count ?? store.all().length} devices`,
      };
    }
  }

  if (ns === 'room') {
    if (rest[0] === 'on' || rest[0] === 'off') {
      const on = rest[0] === 'on';
      const result = await powerRoom(store, on);
      store.persist();
      return {
        ...validationMessage(`Room power ${on ? 'ON' : 'OFF'}`, result),
        replace: true,
        answer: result.converged ? 'All devices followed' : 'Some devices did not follow',
      };
    }
    if (rest[0] === 'validate') {
      const anyOn = store.all().some((d) => d.type !== 'controller' && d.power === 'on');
      const result = await validateState(store, anyOn ? 'on' : 'off');
      return {
        ...validationMessage(`Validate (expected ${anyOn ? 'on' : 'off'})`, result),
        replace: true,
      };
    }
  }

  if (ns === 'dev') {
    const ip = rest.join(':');
    return { ...deviceMenu(store.get(ip)), replace: true };
  }

  if (ns === 'pwr') {
    const ip = rest[0];
    const on = rest[1] === 'on';
    const device = store.get(ip);
    if (!device) return { answer: 'Unknown device', replace: true, ...deviceMenu(null) };
    const result = await setDevicePower(device, on);
    store.persist();
    const answer = result.ok
      ? `Power ${on ? 'ON' : 'OFF'} sent`
      : `Not applied: ${result.reason || 'error'}`;
    return { ...deviceMenu(store.get(ip)), replace: true, answer };
  }

  if (ns === 'reboot') {
    const ip = rest[0];
    const device = store.get(ip);
    if (!device) return { answer: 'Unknown device', replace: true, ...deviceMenu(null) };
    const result = await rebootDevice(device);
    return {
      ...deviceMenu(store.get(ip)),
      replace: true,
      answer: result.ok ? 'Restart sent' : `Not applied: ${result.reason || 'error'}`,
    };
  }

  if (ns === 'thumb') {
    const ip = rest[0];
    const device = store.get(ip);
    if (!device) return { answer: 'Unknown device', replace: true, ...deviceMenu(null) };
    const png = await getThumbnail(device);
    if (!png) return { answer: 'No thumbnail available', replace: true, ...deviceMenu(device) };
    return {
      photo: png,
      caption: `${device.name || device.ip} — ${device.power}`,
      answer: '',
    };
  }

  return { ...mainMenu(store), replace: true, answer: '' };
}
