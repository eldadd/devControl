// Power orchestration + validation engine.
//
// Requirement: "will follow the controller (Crestron/AMX) if it exists and
// validate, when powering on, that all devices power on, and vice versa."
//
// Behaviour:
//   - If a controller exists, the room power command is issued through the
//     controller's macro (the controller is the source of truth). Otherwise we
//     fan the command out to each device directly.
//   - After issuing, we poll every device's power state until it converges to
//     the expected state or a settle timeout elapses.
//   - We return a per-device report of expected vs actual, flagging any device
//     that failed to follow — e.g. a projector that stayed off when the room
//     was powered on, or a PC that stayed on when the room went off.

import { config } from '../config.js';
import {
  setDevicePower,
  runControllerMacro,
  rebootDevice as _reboot,
} from './controlManager.js';
import {
  isNotifierEnabled,
  pushMessage,
  formatCommandFailure,
} from '../telegram/notifier.js';
import * as pjlink from '../protocols/pjlink.js';
import * as vnc from '../protocols/vnc.js';
import * as screen from '../protocols/screen.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Read a device's *actual* current power without changing it.
async function readPower(device, password = '') {
  if (device.simulated) return device.power;
  try {
    switch (device.type) {
      case 'projector': {
        const p = await pjlink.getPower(device.ip, password);
        return p === 'cooling' ? 'off' : p === 'warming' ? 'on' : p;
      }
      case 'pc':
        return (await vnc.isReachable(device.ip)) ? 'on' : 'off';
      case 'screen': {
        const p = await screen
          .getPower(device.ip, { openPorts: device.openPorts, password })
          .catch(() => 'unknown');
        return p;
      }
      case 'controller':
        return device.power; // controllers report their own program state
      default:
        return 'unknown';
    }
  } catch {
    return 'unknown';
  }
}

// Normalize transient states to on/off for comparison.
function normalize(p) {
  if (p === 'on' || p === 'warming') return 'on';
  if (p === 'off' || p === 'cooling' || p === 'standby') return 'off';
  return p; // unknown / rebooting
}

/**
 * Power the whole room on or off, following the controller if present, then
 * validate convergence.
 * @param {DeviceStore} store
 * @param {boolean} on
 * @param {object} [opts]
 * @returns {Promise<{expected:string, viaController:boolean, converged:boolean, report:Array}>}
 */
export async function powerRoom(store, on, opts = {}) {
  const { password = '' } = opts;
  const expected = on ? 'on' : 'off';
  const controller = store.controller();
  // Everything except the controller itself must follow.
  const targets = store.all().filter((d) => d.type !== 'controller');

  let viaController = false;
  if (controller) {
    viaController = true;
    const macro = on ? 'power-on' : 'power-off';
    const res = await runControllerMacro(controller, macro, store.controllerMap);
    // If the controller couldn't run the macro (e.g. no learned join on real
    // hardware), fall back to direct fan-out so the room still responds.
    if (!res.ok) {
      viaController = false;
      await fanOut(targets, on, password);
    } else if (controller.simulated) {
      // Simulated controller drives its downstream simulated devices.
      for (const d of targets) await setDevicePower(d, on, { password });
    }
  } else {
    await fanOut(targets, on, password);
  }

  const report = await waitForConvergence(targets, expected, password);
  const converged = report.every((r) => r.ok);

  // Record what we commanded so the drift watcher has a baseline, and push an
  // immediate alert if the command didn't fully take.
  if (store.setExpected) store.setExpected(expected);
  if (!converged && isNotifierEnabled()) {
    const failures = report.filter((r) => !r.ok);
    await pushMessage(
      formatCommandFailure(`Room power ${on ? 'ON' : 'OFF'}`, failures),
    ).catch(() => {});
  }

  return { expected, viaController, converged, report };
}

async function fanOut(targets, on, password) {
  await Promise.all(targets.map((d) => setDevicePower(d, on, { password }).catch(() => {})));
}

// Poll until every target matches `expected` or the settle timeout elapses.
async function waitForConvergence(targets, expected, password) {
  const deadline = Date.now() + config.validation.settleMs;
  let report = [];
  // Loop at least once even if settleMs is tiny.
  do {
    report = await Promise.all(
      targets.map(async (d) => {
        const actual = normalize(await readPower(d, password));
        d.power = actual === 'on' || actual === 'off' ? actual : d.power;
        return {
          ip: d.ip,
          name: d.name,
          type: d.type,
          expected,
          actual,
          ok: actual === expected,
        };
      }),
    );
    if (report.every((r) => r.ok)) break;
    if (Date.now() >= deadline) break;
    await sleep(config.validation.pollIntervalMs);
  } while (Date.now() < deadline);
  return report;
}

// Validate current room state matches an expectation WITHOUT changing anything.
export async function validateState(store, expected, opts = {}) {
  const { password = '' } = opts;
  const targets = store.all().filter((d) => d.type !== 'controller');
  const report = await Promise.all(
    targets.map(async (d) => {
      const actual = normalize(await readPower(d, password));
      return { ip: d.ip, name: d.name, type: d.type, expected, actual, ok: actual === expected };
    }),
  );
  return { expected, converged: report.every((r) => r.ok), report };
}
