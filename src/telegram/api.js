// Thin wrapper over the Telegram Bot API using global fetch (no dependencies).
// Only the methods the control bot needs are implemented.

const BASE = 'https://api.telegram.org';

export class TelegramApi {
  constructor(token) {
    if (!token) throw new Error('missing Telegram bot token');
    this.token = token;
    this.base = `${BASE}/bot${token}`;
  }

  async call(method, params = {}) {
    const res = await fetch(`${this.base}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const json = await res.json();
    if (!json.ok) {
      const err = new Error(`telegram ${method} failed: ${json.description || res.status}`);
      err.telegram = json;
      throw err;
    }
    return json.result;
  }

  getMe() {
    return this.call('getMe');
  }

  // Long-poll for updates. `timeout` is the server-side long-poll seconds.
  getUpdates(offset, timeout = 30) {
    return this.call('getUpdates', {
      offset,
      timeout,
      allowed_updates: ['message', 'callback_query'],
    });
  }

  sendMessage(chatId, text, replyMarkup) {
    return this.call('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      reply_markup: replyMarkup,
    });
  }

  editMessageText(chatId, messageId, text, replyMarkup) {
    return this.call('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      reply_markup: replyMarkup,
    });
  }

  answerCallbackQuery(callbackQueryId, text = '') {
    return this.call('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text,
    });
  }

  // Send a PNG buffer as a photo via multipart/form-data.
  async sendPhoto(chatId, pngBuffer, caption = '') {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    if (caption) form.append('caption', caption);
    form.append('photo', new Blob([pngBuffer], { type: 'image/png' }), 'thumbnail.png');
    const res = await fetch(`${this.base}/sendPhoto`, { method: 'POST', body: form });
    const json = await res.json();
    if (!json.ok) throw new Error(`telegram sendPhoto failed: ${json.description || res.status}`);
    return json.result;
  }
}
