// HTTP server: serves the control dashboard and a small REST API. Built on the
// Node http module (no framework) so the app has zero runtime dependencies.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { store } from '../devices/deviceStore.js';
import { runAnalysis, scanProgress, ensureSeeded } from '../devices/analyzer.js';
import { buildExport } from '../devices/exporter.js';
import {
  setDevicePower,
  rebootDevice,
  getThumbnail,
} from '../control/controlManager.js';
import { powerRoom, validateState } from '../control/validator.js';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(__dirname, '..', 'web');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.join(WEB_DIR, rel);
  if (!file.startsWith(WEB_DIR)) {
    res.writeHead(403);
    return res.end('forbidden');
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const seg = parts.slice(1);
  const method = req.method;

  // GET /api/devices
  if (method === 'GET' && seg[0] === 'devices' && seg.length === 1) {
    return sendJSON(res, 200, { devices: store.all(), controller: store.controller() || null });
  }

  // GET /api/inventory  -> the exportable JSON document
  if (method === 'GET' && seg[0] === 'inventory') {
    return sendJSON(res, 200, buildExport(store.all(), { cidr: 'live' }));
  }

  // GET /api/scan/progress
  if (method === 'GET' && seg[0] === 'scan' && seg[1] === 'progress') {
    return sendJSON(res, 200, scanProgress());
  }

  // POST /api/scan  { cidr?, password? }
  if (method === 'POST' && seg[0] === 'scan') {
    const body = await readBody(req);
    const result = await runAnalysis({ cidr: body.cidr, password: body.password });
    return sendJSON(res, 200, result);
  }

  // GET /api/devices/:ip/thumbnail  -> PNG
  if (method === 'GET' && seg[0] === 'devices' && seg[2] === 'thumbnail') {
    const device = store.get(seg[1]);
    if (!device) return sendJSON(res, 404, { error: 'unknown device' });
    const png = await getThumbnail(device, { password: '' });
    if (!png) return sendJSON(res, 404, { error: 'no thumbnail for type' });
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
    return res.end(png);
  }

  // POST /api/devices/:ip/power  { on: bool }
  if (method === 'POST' && seg[0] === 'devices' && seg[2] === 'power') {
    const device = store.get(seg[1]);
    if (!device) return sendJSON(res, 404, { error: 'unknown device' });
    const body = await readBody(req);
    const result = await setDevicePower(device, !!body.on);
    store.persist();
    return sendJSON(res, 200, { device: store.get(seg[1]), result });
  }

  // POST /api/devices/:ip/reboot
  if (method === 'POST' && seg[0] === 'devices' && seg[2] === 'reboot') {
    const device = store.get(seg[1]);
    if (!device) return sendJSON(res, 404, { error: 'unknown device' });
    const result = await rebootDevice(device);
    return sendJSON(res, 200, { device, result });
  }

  // POST /api/room/power  { on: bool }  -> follow controller + validate
  if (method === 'POST' && seg[0] === 'room' && seg[1] === 'power') {
    const body = await readBody(req);
    const result = await powerRoom(store, !!body.on);
    store.persist();
    return sendJSON(res, 200, result);
  }

  // POST /api/room/validate  { expected: 'on'|'off' }
  if (method === 'POST' && seg[0] === 'room' && seg[1] === 'validate') {
    const body = await readBody(req);
    const result = await validateState(store, body.expected === 'off' ? 'off' : 'on');
    return sendJSON(res, 200, result);
  }

  return sendJSON(res, 404, { error: 'unknown endpoint' });
}

export function createServer() {
  ensureSeeded();
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      return serveStatic(res, url.pathname);
    } catch (err) {
      sendJSON(res, 500, { error: String(err.message || err) });
    }
  });
}

export function startServer() {
  const server = createServer();
  server.listen(config.server.port, config.server.host, () => {
    // eslint-disable-next-line no-console
    console.log(
      `devControlAnalyzer dashboard: http://${config.server.host}:${config.server.port}`,
    );
  });
  return server;
}
