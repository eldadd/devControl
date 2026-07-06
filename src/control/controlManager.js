// Routes control actions (power on/off, reboot, thumbnail) to the correct
// protocol adapter for a device. Simulated devices short-circuit to an internal
// state change so the whole pipeline is exercisable without hardware.

import * as pjlink from '../protocols/pjlink.js';
import * as wol from '../protocols/wol.js';
import * as vnc from '../protocols/vnc.js';
import * as screen from '../protocols/screen.js';
import * as crestron from '../protocols/crestron.js';
import * as amx from '../protocols/amx.js';
import { placeholderPNG } from '../protocols/png.js';
import { config } from '../config.js';

function simSet(device, on) {
  device.power = on ? 'on' : 'off';
  device.lastSeen = new Date().toISOString();
  return { ok: true, simulated: true, power: device.power };
}

// Power a single device on/off. Returns a result object; never throws for
// expected "no direct protocol" cases (those return ok:false with a reason).
export async function setDevicePower(device, on, { password = '' } = {}) {
  if (device.simulated) return simSet(device, on);

  try {
    switch (device.type) {
      case 'projector':
        await pjlink.setPower(device.ip, on, password);
        device.power = on ? 'on' : 'off';
        return { ok: true, power: device.power };

      case 'screen':
        if (device.openPorts.includes(4352)) {
          await screen.setPower(device.ip, on, { openPorts: device.openPorts, password });
          device.power = on ? 'on' : 'off';
          return { ok: true, power: device.power };
        }
        return { ok: false, reason: 'route-via-controller' };

      case 'pc':
        if (on) {
          if (!device.mac) return { ok: false, reason: 'no-mac-for-wol' };
          await wol.wake(device.mac);
          return { ok: true, note: 'WOL sent; confirm via validation' };
        }
        // Graceful PC shutdown needs an OS agent/SSH hook; route via controller
        // if none is configured for this device.
        return { ok: false, reason: 'no-shutdown-agent' };

      default:
        return { ok: false, reason: 'unsupported-type' };
    }
  } catch (err) {
    return { ok: false, reason: String(err.message || err) };
  }
}

export async function rebootDevice(device) {
  if (device.simulated) {
    device.power = 'rebooting';
    setTimeout(() => (device.power = 'on'), 500);
    return { ok: true, simulated: true };
  }
  if (device.type === 'pc') {
    // Real reboot requires an SSH/agent hook, tracked as a capability but not
    // implemented here to avoid destructive default behaviour.
    return { ok: false, reason: 'reboot-needs-agent' };
  }
  return { ok: false, reason: 'unsupported' };
}

// Fetch a thumbnail PNG for a PC. Simulated PCs get a deterministic placeholder;
// real PCs are captured over VNC (falling back to a placeholder on failure).
export async function getThumbnail(device, { password = '' } = {}) {
  if (device.type !== 'pc') return null;
  const seed = Number.parseInt(device.ip.split('.').pop(), 10) || 1;
  if (device.simulated || device.power !== 'on') {
    return placeholderPNG(config.vnc.thumbWidth, config.vnc.thumbHeight, seed);
  }
  const port = device.openPorts.includes(5901) ? 5901 : 5900;
  const res = await vnc.captureThumbnail(device.ip, { port, password, seed });
  return res.png;
}

// Run a controller room macro (power-on / power-off) if a controller exists and
// the site has a learned macro for it.
export async function runControllerMacro(controller, macro, controllerMap) {
  if (!controller) return { ok: false, reason: 'no-controller' };
  if (controller.simulated) {
    controller.power = macro === 'power-off' ? 'standby' : 'on';
    return { ok: true, simulated: true };
  }
  const adapter = controller.vendor === 'AMX' ? amx : crestron;
  try {
    await adapter.runMacro(controller.ip, macro, controllerMap);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: String(err.message || err) };
  }
}
