// Telegram control bot: long-polls for updates and dispatches them to the pure
// handlers in handlers.js, then renders the response via the Telegram API. This
// is an alternative control surface to the web dashboard — same store, same
// control/validation engine underneath.
//
// Enable by setting TELEGRAM_BOT_TOKEN. Optionally restrict who can control the
// room with TELEGRAM_ALLOWED_CHAT_IDS (comma-separated chat IDs); when unset the
// bot warns once and responds to anyone who can reach it.

import { TelegramApi } from './api.js';
import { handleCommand, handleCallback } from './handlers.js';
import { store } from '../devices/deviceStore.js';

function parseAllowlist() {
  const raw = process.env.TELEGRAM_ALLOWED_CHAT_IDS || '';
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set(ids);
}

export class TelegramBot {
  constructor(token, { deviceStore = store } = {}) {
    this.api = new TelegramApi(token);
    this.store = deviceStore;
    this.allow = parseAllowlist();
    this.offset = 0;
    this.running = false;
  }

  authorized(chatId) {
    if (this.allow.size === 0) return true; // open mode
    return this.allow.has(String(chatId));
  }

  async start() {
    const me = await this.api.getMe();
    // eslint-disable-next-line no-console
    console.log(`Telegram control bot online: @${me.username}`);
    if (this.allow.size === 0) {
      // eslint-disable-next-line no-console
      console.warn(
        'Telegram bot is in OPEN mode — anyone who messages it can control the ' +
          'room. Set TELEGRAM_ALLOWED_CHAT_IDS to restrict access.',
      );
    }
    this.running = true;
    this.loop();
    return me;
  }

  stop() {
    this.running = false;
  }

  async loop() {
    while (this.running) {
      try {
        const updates = await this.api.getUpdates(this.offset, 30);
        for (const update of updates) {
          this.offset = update.update_id + 1;
          await this.dispatch(update).catch((e) => {
            // eslint-disable-next-line no-console
            console.error('telegram dispatch error:', e.message);
          });
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('telegram getUpdates error:', e.message);
        await new Promise((r) => setTimeout(r, 3000)); // back off on transient errors
      }
    }
  }

  async dispatch(update) {
    if (update.message && update.message.text) {
      const chatId = update.message.chat.id;
      if (!this.authorized(chatId)) {
        return this.api.sendMessage(chatId, '⛔ Not authorized to control this system.');
      }
      const resp = await handleCommand(this.store, update.message.text);
      return this.render(chatId, null, resp);
    }

    if (update.callback_query) {
      const cq = update.callback_query;
      const chatId = cq.message?.chat?.id;
      const messageId = cq.message?.message_id;
      if (!this.authorized(chatId)) {
        return this.api.answerCallbackQuery(cq.id, 'Not authorized');
      }
      const resp = await handleCallback(this.store, cq.data || '');
      await this.api.answerCallbackQuery(cq.id, resp.answer || '').catch(() => {});
      return this.render(chatId, messageId, resp);
    }
  }

  // Turn a handler response into the appropriate Telegram API call.
  async render(chatId, messageId, resp) {
    if (resp.photo) {
      return this.api.sendPhoto(chatId, resp.photo, resp.caption || '');
    }
    if (resp.replace && messageId) {
      try {
        return await this.api.editMessageText(chatId, messageId, resp.text, resp.reply_markup);
      } catch {
        // Editing fails if the content is identical; fall back to a new message.
        return this.api.sendMessage(chatId, resp.text, resp.reply_markup);
      }
    }
    return this.api.sendMessage(chatId, resp.text, resp.reply_markup);
  }
}

// Start the bot if a token is configured. Returns the bot or null.
export async function startTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  const bot = new TelegramBot(token);
  try {
    await bot.start();
    return bot;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('Failed to start Telegram bot:', e.message);
    return null;
  }
}
