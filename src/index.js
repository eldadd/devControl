#!/usr/bin/env node
// Entry point. Default action starts the dashboard server. Subcommands:
//   scan    - run one discovery pass and print a summary
//   export  - run a pass and write data/inventory.json
//   serve   - start the web dashboard (default)

import { startServer } from './server/api.js';
import { runAnalysis } from './devices/analyzer.js';
import { buildExport, writeExport } from './devices/exporter.js';
import { store } from './devices/deviceStore.js';
import { detectCidr, config } from './config.js';

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
    case 'serve':
    default: {
      startServer();
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
