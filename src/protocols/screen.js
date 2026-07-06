// Networked display / screen adapter.
//
// Professional displays are a mixed bag: many speak PJLink (same as projectors)
// over 4352, others expose a vendor HTTP/JSON API, and cheaper panels only do
// HDMI-CEC via whatever source is attached. This adapter tries PJLink first
// (widest standard coverage) and otherwise records the display as HTTP-managed
// so the UI can still show it and route power through the room controller.

import * as pjlink from './pjlink.js';

export async function getPower(host, { openPorts = [], password = '' } = {}) {
  if (openPorts.includes(4352)) {
    return pjlink.getPower(host, password).catch(() => 'unknown');
  }
  return 'unknown';
}

export async function setPower(host, on, { openPorts = [], password = '' } = {}) {
  if (openPorts.includes(4352)) {
    return pjlink.setPower(host, on, password);
  }
  // No direct protocol: caller should route through the controller macro.
  throw new Error('screen has no direct power protocol; use controller macro');
}

export const capabilities = ['power'];
