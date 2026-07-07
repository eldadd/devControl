#!/usr/bin/env node
// Entry point. Default action starts the dashboard server. Subcommands:
//   scan    - run one discovery pass and print a summary
//   export  - run a pass and write data/inventory.json
//   serve   - start the web dashboard (default)

import { startServer } from './server/api.js';
import { runAnalysis, ensureSeeded } from './devices/analyzer.js';
import { buildExport, writeExport } from './devices/exporter.js';
import { store } from './devices/deviceStore.js';
import { startTelegramBot } from './telegram/bot.js';
import { initNotifier, isNotifierEnabled } from './telegram/notifier.js';
import { RoomWatcher } from './control/watcher.js';
import { detectCidr, config } from './config.js';

// Configure push notifications + drift watcher if a token and target chats are
// set. Notify targets default to the bot's allowlist when not set explicitly.
function setupNotifications() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatIds = (
    process.env.TELEGRAM_NOTIFY_CHAT_IDS ||
    process.env.TELEGRAM_ALLOWED_CHAT_IDS ||
    ''
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!token || chatIds.length === 0) return;
  initNotifier({ token, chatIds });
  if (isNotifierEnabled()) {
    new RoomWatcher(store).start();
    console.log(
      `Push notifications enabled for ${chatIds.length} chat(s); ` +
        `drift watch every ${config.watch.intervalMs}ms.`,
    );
  }
}

const cmd = process.argv[2] || 'serve';

async function main() {
  switch (cmd) {
    case 'scan': {
      const cidr = process.argv[3] || detectCidr();
      console.log(`Scanning ${cidr || '(no CIDR; simulated fleet)'} ...`);
      const res = await runAnalysis({ cidr });
      const doc = buildExport(store.all(), { cidr: res.cidr });
      console.log(JSON.stringify(doc.summary, null, 2));
      for (const d of store.all()) {
        console.log(`  ${d.ip.padEnd(15)} ${d.type.padEnd(10)} ${d.protocol.padEnd(12)} ${d.power}`);
      }
      break;
    }
    case 'export': {
      const cidr = process.argv[3] || detectCidr();
      await runAnalysis({ cidr });
      const file = writeExport(store.all(), { cidr });
      console.log(`Wrote inventory: ${file}`);
      break;
    }
    case 'telegram': {
      // Run only the Telegram control bot (no web server).
      ensureSeeded();
      const bot = await startTelegramBot();
      if (!bot) {
        console.error('Set TELEGRAM_BOT_TOKEN to run the Telegram control bot.');
        process.exit(1);
      }
      setupNotifications();
      break;
    }
    case 'serve':
    default: {
      startServer();
      // Start the Telegram control bot alongside the dashboard if configured.
      startTelegramBot().catch((e) => console.error(e.message));
      setupNotifications();
      // Optional background re-scan loop.
      if (config.scan.intervalMs > 0) {
        setInterval(() => runAnalysis().catch(() => {}), config.scan.intervalMs);
      }
      break;
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
