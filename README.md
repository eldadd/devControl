# devControlAnalyzer

Discovers the devices on an AV/meeting-room network, learns how to control each
one, and presents a single dashboard to run them — VNC thumbnails and
restart/power buttons for PCs, power control for projectors and screens, and a
one-click **Power Room On/Off** that **follows the room controller
(Crestron/AMX) when one exists and then validates that every device actually
followed**.

Built on the Node.js standard library only — **zero runtime dependencies**, no
build step. Runs with a bundled simulated fleet out of the box so you can see
the whole flow without any hardware.

## What it does

1. **Scans the network** (`src/scanner`) — a concurrent TCP sweep of a CIDR
   range, fingerprinting each host by the ports it answers on.
2. **Classifies devices** into PC / projector / screen / controller
   (`deviceClassifier.js`).
3. **Learns the control protocol** (`src/protocols/protocolLearner.js`) — talks
   to each device to confirm the right adapter, read its current power state,
   and record concrete capabilities.
4. **Exports the inventory to JSON** (`src/devices/exporter.js` →
   `data/inventory.json`), a portable record of every device, role, protocol,
   and capability.
5. **Presents a control dashboard** (`src/web`) — VNC thumbnails for PCs with
   On / Off / Restart, projector and screen power tiles, and controller status.
6. **Follows the controller and validates power** (`src/control/validator.js`) —
   room power is issued through the controller's learned macro when present
   (otherwise fanned out directly), then every device is polled until it
   converges to the expected state. Any device that fails to follow is flagged.

## Quick start

```bash
# start the dashboard (simulated fleet by default)
npm start
# open http://localhost:8700

# one-off discovery pass, printed as a summary
npm run scan            # or: node src/index.js scan 192.168.1.0/24

# discovery pass that writes data/inventory.json
npm run export

# run the test suite
npm test
```

## Protocol coverage

| Device       | Discovery port(s)      | Control protocol / adapter                        |
| ------------ | ---------------------- | ------------------------------------------------- |
| PC           | 5900/5901 (VNC), 22    | VNC thumbnail capture; Wake-on-LAN power-on       |
| Projector    | 4352 (PJLink)          | PJLink Class 1 power query/set (`pjlink.js`)       |
| Screen       | 4352 (PJLink) or 80    | PJLink where supported, else routed via controller |
| Controller   | 41794 (Crestron CIP)   | Existence/identity probe + learned macro joins    |
| Controller   | 1319 (AMX ICSP)        | Existence/identity probe + learned channel pulses |

The VNC client (`src/protocols/vnc.js`) and PNG encoder (`src/protocols/png.js`)
are implemented from scratch against the standard library — the RFB handshake
(incl. VNC/DES auth), Raw-encoding framebuffer capture, downscale, and PNG
output, with a graceful placeholder when a machine is off or unreachable.

## Controller macros (real hardware)

Room power on a real Crestron/AMX system is defined by the installed program
(digital joins / channel events), so the analyzer needs the exact packet for
your room. Capture it once during commissioning and drop it into
`data/controller-map.json` (see `data/controller-map.example.json`). The
analyzer then reuses that macro and **validates the downstream devices actually
followed** — catching a projector that stayed off or a display that never woke.

## Configuration

All settings have sensible defaults and can be overridden with environment
variables (see `src/config.js`):

| Variable            | Default | Purpose                                        |
| ------------------- | ------- | ---------------------------------------------- |
| `PORT`              | 8700    | Dashboard HTTP port                            |
| `SCAN_CIDR`         | auto    | Range to scan (auto-derived from the host NIC) |
| `SCAN_CONCURRENCY`  | 128     | Parallel host probes                           |
| `SIMULATE`          | on      | Add a simulated fleet when nothing real answers |
| `VNC_THUMB_WIDTH`   | 320     | Thumbnail width (px)                           |
| `VALIDATE_SETTLE_MS`| 8000    | How long to wait for power convergence         |

## REST API

| Method | Path                             | Description                              |
| ------ | -------------------------------- | ---------------------------------------- |
| GET    | `/api/devices`                   | Current fleet + controller               |
| GET    | `/api/inventory`                 | Exportable JSON inventory document       |
| POST   | `/api/scan`                      | Run a discovery pass `{cidr?, password?}`|
| GET    | `/api/scan/progress`             | Live scan progress                       |
| GET    | `/api/devices/:ip/thumbnail`     | PNG thumbnail (PCs)                       |
| POST   | `/api/devices/:ip/power`         | Set device power `{on:bool}`             |
| POST   | `/api/devices/:ip/reboot`        | Restart a PC                             |
| POST   | `/api/room/power`                | Follow controller + validate `{on:bool}` |
| POST   | `/api/room/validate`             | Validate current state `{expected}`      |

## Project layout

```
src/
  config.js              configuration + CIDR auto-detect
  index.js               CLI entry (serve | scan | export)
  scanner/               CIDR expansion, TCP sweep, classification
  protocols/             pjlink, wol, vnc, png, crestron, amx, screen, learner
  devices/               store, exporter, simulator, analysis orchestrator
  control/               controlManager (routing) + validator (follow/validate)
  server/                zero-dependency HTTP + REST API
  web/                   dashboard (index.html, app.js, styles.css)
test/                    node:test unit tests
```

## Notes on safety

Learning is strictly read-only (queries, never state changes). Destructive PC
actions (shutdown/reboot on real hardware) require an OS agent or SSH hook and
are intentionally not wired to a default path — the capability is advertised but
returns a clear reason until configured, so the analyzer never silently powers
down a machine.

## License

MIT
