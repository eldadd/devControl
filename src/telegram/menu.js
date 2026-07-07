// Pure menu-building helpers for the Telegram control bot. These produce
// Telegram inline-keyboard payloads and message text. They contain no I/O so
// they are unit-testable in isolation.
//
// Callback-data scheme (Telegram caps callback_data at 64 bytes):
//   menu:main | menu:devices | menu:scan
//   room:on | room:off | room:validate
//   dev:<ip>            device detail
//   pwr:<ip>:on|off     set device power
//   reboot:<ip>         restart a PC
//   thumb:<ip>          send a VNC thumbnail

const TYPE_ICON = {
  pc: '🖥️',
  projector: '📽️',
  screen: '📺',
  controller: '🎛️',
  unknown: '❔',
};

const POWER_ICON = {
  on: '🟢',
  off: '⚪',
  warming: '🟡',
  cooling: '🟡',
  rebooting: '🟡',
  standby: '⚪',
  unknown: '❔',
};

export function powerIcon(power) {
  return POWER_ICON[power] || '❔';
}

export function typeIcon(type) {
  return TYPE_ICON[type] || '❔';
}

// Root menu.
export function mainMenu(store) {
  const controller = store.controller();
  const controllerLine = controller
    ? `${typeIcon('controller')} Controller: *${escape(controller.vendor)}* (${escape(
        controller.name || controller.ip,
      )})`
    : '⚠️ No controller found — room actions use direct fan-out.';

  const counts = store.all().reduce((m, d) => ((m[d.type] = (m[d.type] || 0) + 1), m), {});
  const summary = Object.entries(counts)
    .map(([k, v]) => `${v} ${k}`)
    .join(' · ');

  return {
    text:
      `*devControlAnalyzer*\n${controllerLine}\n\n` +
      `${store.all().length} devices — ${escape(summary || 'none')}`,
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🔌 Room On', callback_data: 'room:on' },
          { text: '⭘ Room Off', callback_data: 'room:off' },
        ],
        [{ text: '✅ Validate power state', callback_data: 'room:validate' }],
        [
          { text: '📟 Devices', callback_data: 'menu:devices' },
          { text: '🔍 Scan network', callback_data: 'menu:scan' },
        ],
      ],
    },
  };
}

// List of devices, each a button leading to its detail view.
export function devicesMenu(store) {
  const order = { controller: 0, projector: 1, screen: 2, pc: 3, unknown: 4 };
  const devices = [...store.all()].sort(
    (a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9),
  );
  const rows = devices.map((d) => [
    {
      text: `${powerIcon(d.power)} ${typeIcon(d.type)} ${d.name || d.ip}`,
      callback_data: `dev:${d.ip}`,
    },
  ]);
  rows.push([{ text: '« Back', callback_data: 'menu:main' }]);
  return {
    text: '*Devices* — tap one to control it',
    reply_markup: { inline_keyboard: rows },
  };
}

// Detail view for one device with capability-appropriate action buttons.
export function deviceMenu(device) {
  if (!device) {
    return { text: 'Device not found.', reply_markup: backOnly('menu:devices') };
  }
  const caps = device.capabilities || [];
  const actions = [];
  if (caps.includes('power-on') || caps.includes('macro-power-on')) {
    actions.push({ text: '🔌 On', callback_data: `pwr:${device.ip}:on` });
  }
  if (caps.includes('power-off') || caps.includes('macro-power-off')) {
    actions.push({ text: '⭘ Off', callback_data: `pwr:${device.ip}:off` });
  }
  if (caps.includes('reboot')) {
    actions.push({ text: '♻️ Restart', callback_data: `reboot:${device.ip}` });
  }

  const rows = [];
  if (actions.length) rows.push(actions);
  if (device.type === 'pc' && caps.includes('thumbnail')) {
    rows.push([{ text: '🖼️ Thumbnail', callback_data: `thumb:${device.ip}` }]);
  }
  rows.push([
    { text: '« Devices', callback_data: 'menu:devices' },
    { text: '⌂ Main', callback_data: 'menu:main' },
  ]);

  const lines = [
    `${powerIcon(device.power)} *${escape(device.name || device.ip)}*`,
    `Type: ${escape(device.type)}  ·  Power: *${escape(device.power)}*`,
    `IP: \`${escape(device.ip)}\`  ·  ${escape(device.vendor || 'unknown')}${
      device.model ? ' ' + escape(device.model) : ''
    }`,
    `Protocol: ${escape(device.protocol)}`,
    caps.length ? `Capabilities: ${escape(caps.join(', '))}` : 'No direct control.',
  ];
  return { text: lines.join('\n'), reply_markup: { inline_keyboard: rows } };
}

// Format a validator report (from powerRoom / validateState) as a message.
export function validationMessage(title, result) {
  const via = result.viaController ? 'via controller macro' : 'direct fan-out';
  const header = result.converged
    ? `✅ *${escape(title)}* — all devices followed (${via})`
    : `⚠️ *${escape(title)}* — mismatch, some devices did not follow (${via})`;
  const rows = (result.report || [])
    .map(
      (r) =>
        `${r.ok ? '✓' : '✗'} ${escape(r.name || r.ip)} — expected *${escape(
          r.expected,
        )}*, actual *${escape(r.actual)}*`,
    )
    .join('\n');
  return {
    text: `${header}\n\n${rows}`,
    reply_markup: backOnly('menu:main'),
  };
}

function backOnly(target) {
  return { inline_keyboard: [[{ text: '« Back', callback_data: target }]] };
}

// Escape Telegram Markdown (legacy) special characters in dynamic text.
export function escape(s) {
  return String(s == null ? '' : s).replace(/([_*`\[])/g, '\\$1');
}
