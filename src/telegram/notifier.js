// Push notifications over Telegram. Unlike the interactive bot (which replies to
// commands), the notifier proactively pushes alerts to a configured set of chat
// IDs when something needs attention — a device that failed to follow a power
// command, or the room drifting out of its commanded state.
//
// The sender is pluggable so the formatting/dispatch logic is unit-testable
// without hitting the Telegram API.

import { TelegramApi } from './api.js';
import { escape } from './menu.js';

let sender = null; // (chatId, text) => Promise
let targets = []; // chat IDs to push to

/**
 * Initialise the notifier.
 * @param {object} opts
 * @param {string} [opts.token]   bot token (a new TelegramApi is created)
 * @param {object} [opts.api]     an existing TelegramApi-like { sendMessage }
 * @param {string[]} [opts.chatIds]
 */
export function initNotifier({ token, api, chatIds } = {}) {
  targets = (chatIds || []).map(String).filter(Boolean);
  if (api) {
    sender = (chat, text) => api.sendMessage(chat, text);
  } else if (token) {
    const client = new TelegramApi(token);
    sender = (chat, text) => client.sendMessage(chat, text);
  }
  return isNotifierEnabled();
}

export function isNotifierEnabled() {
  return typeof sender === 'function' && targets.length > 0;
}

export function notifierTargets() {
  return targets.slice();
}

// Reset (used by tests).
export function resetNotifier() {
  sender = null;
  targets = [];
}

// Push a message to every configured chat. Never throws; returns how many sends
// succeeded so callers/tests can assert on it.
export async function pushMessage(text) {
  if (!isNotifierEnabled()) return { sent: 0, targets: 0 };
  let sent = 0;
  await Promise.all(
    targets.map(async (chat) => {
      try {
        await sender(chat, text);
        sent++;
      } catch {
        /* best-effort: a failed push must not break control flow */
      }
    }),
  );
  return { sent, targets: targets.length };
}

// ---- Message formatters (pure) ---------------------------------------------

export function formatDrift(expected, failures) {
  const head =
    `⚠️ *Power drift* — room expected *${escape(expected.toUpperCase())}* but ` +
    `${failures.length} device(s) are not following:`;
  const lines = failures.map(
    (f) => `✗ ${escape(f.name || f.ip)} (${escape(f.type)}) — actual *${escape(f.actual)}*`,
  );
  return [head, ...lines].join('\n');
}

export function formatRecovery(expected) {
  return `✅ *Power recovered* — all devices now match expected *${escape(
    expected.toUpperCase(),
  )}*.`;
}

export function formatCommandFailure(title, failures) {
  const head = `⚠️ *${escape(title)}* did not fully apply — ${failures.length} device(s) failed:`;
  const lines = failures.map(
    (f) =>
      `✗ ${escape(f.name || f.ip)} (${escape(f.type)}) — expected *${escape(
        f.expected,
      )}*, actual *${escape(f.actual)}*`,
  );
  return [head, ...lines].join('\n');
}
