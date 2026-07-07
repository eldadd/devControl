// In-memory device registry with JSON persistence. The store is the single
// source of truth the API and UI read from. Devices are keyed by IP.

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

const FILE = () => path.join(config.dataDir, 'devices.json');

export class DeviceStore {
  constructor() {
    this.devices = new Map();
    this.controllerMap = {}; // learned controller macro joins
    this.roomExpected = null; // 'on' | 'off' | null — last commanded room state
    this._load();
  }

  // The power state the room was last commanded into. The drift watcher
  // compares live device state against this to detect devices that fell out.
  setExpected(state) {
    this.roomExpected = state === 'on' || state === 'off' ? state : null;
  }

  getExpected() {
    return this.roomExpected;
  }

  _load() {
    try {
      const raw = JSON.parse(fs.readFileSync(FILE(), 'utf8'));
      for (const d of raw.devices || []) this.devices.set(d.ip, d);
    } catch {
      /* first run: no file yet */
    }
    try {
      const mapPath = path.join(config.dataDir, 'controller-map.json');
      this.controllerMap = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
    } catch {
      /* optional */
    }
  }

  // Merge a freshly scanned/learned device, preserving learned fields.
  upsert(device) {
    const existing = this.devices.get(device.ip);
    const merged = existing ? { ...existing, ...device } : device;
    this.devices.set(device.ip, merged);
    return merged;
  }

  get(ip) {
    return this.devices.get(ip);
  }

  all() {
    return [...this.devices.values()];
  }

  byType(type) {
    return this.all().filter((d) => d.type === type);
  }

  controller() {
    return this.all().find((d) => d.type === 'controller');
  }

  remove(ip) {
    return this.devices.delete(ip);
  }

  persist() {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(
      FILE(),
      JSON.stringify(
        { updated: new Date().toISOString(), devices: this.all() },
        null,
        2,
      ),
    );
  }
}

export const store = new DeviceStore();
