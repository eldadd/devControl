// Background drift watcher. Periodically compares each device's live power state
// against the room's last-commanded ("expected") state and pushes a Telegram
// notification when devices fall out of sync — and a recovery notice once they
// come back. Alerts are debounced: a device is only announced when it newly
// fails, not on every poll.
//
// Dependencies (validate, notify) are injectable so the tick logic is testable
// without a network or timers.

import { validateState } from './validator.js';
import { pushMessage, formatDrift, formatRecovery } from '../telegram/notifier.js';
import { config } from '../config.js';

export class RoomWatcher {
  constructor(store, { validate = validateState, notify = pushMessage, intervalMs } = {}) {
    this.store = store;
    this.validate = validate;
    this.notify = notify;
    this.intervalMs = intervalMs ?? config.watch.intervalMs;
    this.alerted = new Set(); // keys of currently-alerted failures
    this.timer = null;
  }

  // One evaluation pass. Returns a small summary for tests/telemetry.
  async tick() {
    const expected = this.store.getExpected ? this.store.getExpected() : null;
    if (!expected) return { skipped: true };

    const result = await this.validate(this.store, expected);
    const failures = result.report.filter((r) => !r.ok);
    const keyOf = (f) => `${f.ip}:${expected}`;
    const currentKeys = new Set(failures.map(keyOf));

    const newFailures = failures.filter((f) => !this.alerted.has(keyOf(f)));
    if (newFailures.length) {
      await this.notify(formatDrift(expected, failures));
    } else if (this.alerted.size > 0 && failures.length === 0) {
      await this.notify(formatRecovery(expected));
    }

    this.alerted = currentKeys;
    return { expected, failures, newFailures, recovered: failures.length === 0 };
  }

  start() {
    if (this.timer) return this;
    if (this.intervalMs > 0) {
      this.timer = setInterval(() => this.tick().catch(() => {}), this.intervalMs);
      if (this.timer.unref) this.timer.unref(); // don't keep the process alive
    }
    return this;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
