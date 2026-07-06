// Dashboard front-end. Talks to the REST API in src/server/api.js. No build
// step, no framework — plain DOM.

const $ = (id) => document.getElementById(id);
const api = (p, opts) => fetch(p, opts).then((r) => r.json());

const TYPE_ICON = {
  pc: '🖥️',
  projector: '📽️',
  screen: '📺',
  controller: '🎛️',
  unknown: '❔',
};

let devices = [];

function pwrDot(power) {
  const on = power === 'on';
  const warn = power === 'warming' || power === 'rebooting';
  const cls = on ? 'on' : warn ? 'warn' : '';
  return `<span class="pwr-dot ${cls}" title="${power}"></span>`;
}

function actions(d) {
  const caps = d.capabilities || [];
  const btns = [];
  if (caps.includes('power-on') || caps.includes('macro-power-on')) {
    btns.push(`<button class="btn btn-on" data-act="on" data-ip="${d.ip}">On</button>`);
  }
  if (caps.includes('power-off') || caps.includes('macro-power-off')) {
    btns.push(`<button class="btn btn-off" data-act="off" data-ip="${d.ip}">Off</button>`);
  }
  if (caps.includes('reboot')) {
    btns.push(`<button class="btn" data-act="reboot" data-ip="${d.ip}">Restart</button>`);
  }
  return btns.join('');
}

function card(d) {
  const isPc = d.type === 'pc';
  const thumb = isPc
    ? `<img class="thumb" src="/api/devices/${d.ip}/thumbnail?t=${Date.now()}" alt="${d.name}" loading="lazy" />`
    : `<div class="thumb-placeholder">${TYPE_ICON[d.type] || '❔'}</div>`;

  return `
    <div class="card" data-ip="${d.ip}">
      <div class="card-head">
        <div>
          <div class="card-title">${pwrDot(d.power)} ${d.name || d.ip}</div>
          <div class="card-meta">${d.ip} · ${d.vendor || 'unknown'}${d.model ? ' ' + d.model : ''} · ${d.protocol}</div>
        </div>
        <span class="type-pill">${d.type}</span>
      </div>
      ${thumb}
      <div class="card-actions">${actions(d) || '<span class="card-meta">no direct control</span>'}</div>
    </div>`;
}

function render() {
  // Controller first, then projectors, screens, pcs.
  const order = { controller: 0, projector: 1, screen: 2, pc: 3, unknown: 4 };
  const sorted = [...devices].sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9));
  $('grid').innerHTML = sorted.map(card).join('');

  const controller = devices.find((d) => d.type === 'controller');
  const badge = $('controllerBadge');
  if (controller) {
    badge.textContent = `${controller.vendor} controller`;
    badge.className = 'badge badge-on';
  } else {
    badge.textContent = 'No controller (direct mode)';
    badge.className = 'badge badge-muted';
  }

  const counts = devices.reduce((m, d) => ((m[d.type] = (m[d.type] || 0) + 1), m), {});
  $('stats').textContent = `${devices.length} devices — ` +
    Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ');
}

async function load() {
  const data = await api('/api/devices');
  devices = data.devices || [];
  render();
}

async function deviceAction(ip, act) {
  if (act === 'reboot') {
    await api(`/api/devices/${ip}/reboot`, { method: 'POST' });
  } else {
    await api(`/api/devices/${ip}/power`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ on: act === 'on' }),
    });
  }
  await load();
}

function renderValidation(result, title) {
  const panel = $('validationPanel');
  panel.classList.remove('hidden');
  const via = result.viaController ? 'via controller macro' : 'direct fan-out';
  const status = result.converged
    ? '<span class="badge badge-on">All devices followed ✓</span>'
    : '<span class="badge badge-warn">Mismatch — some devices did not follow</span>';
  const rows = (result.report || [])
    .map(
      (r) => `<div class="report-row">
        <span>${r.name || r.ip} <span class="card-meta">(${r.type})</span></span>
        <span class="${r.ok ? 'ok' : 'bad'}">expected ${r.expected} · actual ${r.actual} ${r.ok ? '✓' : '✕'}</span>
      </div>`,
    )
    .join('');
  panel.innerHTML = `<h3>${title} — ${via} ${status}</h3>${rows}`;
}

async function roomPower(on) {
  $('validationPanel').classList.remove('hidden');
  $('validationPanel').innerHTML = `<h3>Powering room ${on ? 'ON' : 'OFF'} and validating…</h3>`;
  const result = await api('/api/room/power', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ on }),
  });
  renderValidation(result, `Room power ${on ? 'ON' : 'OFF'}`);
  await load();
}

async function validate() {
  const anyOn = devices.some((d) => d.type !== 'controller' && d.power === 'on');
  const result = await api('/api/room/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expected: anyOn ? 'on' : 'off' }),
  });
  renderValidation(result, `Validate (expected ${anyOn ? 'on' : 'off'})`);
}

async function scan() {
  const cidr = $('cidr').value.trim();
  $('scan').disabled = true;
  $('progress').textContent = 'Scanning…';
  const poll = setInterval(async () => {
    const p = await api('/api/scan/progress');
    if (p.total) $('progress').textContent = `Probed ${p.done}/${p.total} — found ${p.found}`;
  }, 500);
  try {
    await api('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cidr }),
    });
    await load();
    $('progress').textContent = 'Scan complete.';
  } finally {
    clearInterval(poll);
    $('scan').disabled = false;
  }
}

// Event wiring.
$('grid').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (btn) deviceAction(btn.dataset.ip, btn.dataset.act);
});
$('roomOn').addEventListener('click', () => roomPower(true));
$('roomOff').addEventListener('click', () => roomPower(false));
$('validate').addEventListener('click', validate);
$('scan').addEventListener('click', scan);

// Refresh PC thumbnails periodically.
setInterval(() => {
  document.querySelectorAll('img.thumb').forEach((img) => {
    const base = img.src.split('?')[0];
    img.src = `${base}?t=${Date.now()}`;
  });
}, 15000);

load();
