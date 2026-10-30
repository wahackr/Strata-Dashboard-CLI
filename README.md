# Strata CLI

A terminal monitor for the [Strata](https://github.com/Niko1221/Strata) inference
server — the same numbers the [Strata Widget](https://github.com/wahackr/Strata-Dashboard)
draws in its Electron window, rendered in your shell, for as many servers as you
point at. No dependencies: Node 24 and ANSI only.

```
✳ Strata CLI  ·  2 servers  ·  refresh 1.0s  ·  theme dark  ·  ./strata.json
╭─ ▸ ✳ Home · ● generating 12ms ─────────────────────────────────────────────╮
│ http://127.0.0.1:8080  ·  qwen3.8-flash-next-gyro-gyro-m                    │
│      ✳  ·  ✳        ● srv-1 ● generating                                   │
│     ╭───────╮       Reading prompt                                         │
│    ╱  ◕   ◕ ╲       4,200 / 13,107 tokens · 32%                            │
│    ╲   o    ╱       ████████░░░░░░░░░░░░░░░░                               │
│     ╰───────╯       refresh 1.0s · key env:STRATA_HOME_KEY                 │
│  Speed 42.1 t/s ▁▂▄▆█▇▅▂▃▄   GPU  87 % ▅▆▇█▇▆▅▃▄▅                          │
│  VRAM  13.2 / 24 GB ▃▄▅▆▇█   Temp 61 °C ▄▄▅▆▆▇▇█▇▆                          │
│  Power 210 W ▅▆▇█▇▆▅▃         PCIe Gen5 x16 ▁▂▃▄                           │
│  CPU   12 % ▂▃▂▄▅             Disk 41.2 MB/s ▃▄▅▆                          │
│   Ctx  34% ████░░░░░░░░░░░░░░░░░░  44.2k / 131k                            │
│   Cache 10,918 experts · 13.3 GB  RAM 21.4 / 31 GB ████░░░░░░              │
│   Last  12:03:41  Done · 4.2k in / 1.1k reused / 312 out · 41.2 t/s        │
╰────────────────────────────────────────────────────────────────────────────╯
q quit · space refresh · c compact · d theme · m mascot · 1-9 focus · ↑/↓ select
```

## Run

```bash
npm install      # nothing to fetch; run straight from the repo
node bin/strata.js
```

or `npm start`. With no config file it watches `http://127.0.0.1:8080` with no
key, exactly like the widget's first run.

One snapshot instead of the live view (works over SSH pipes and in CI):

```bash
node bin/strata.js --once
node bin/strata.js --once --json | jq '.[0].metrics.live'
```

## Config

`strata.json` in the working directory, `$STRATA_CONFIG`, or
`~/.config/strata-cli/config.json` — in that order. See `config.example.json`:

```json
{
  "refreshMs": 1000,
  "timeoutMs": 4000,
  "theme": "dark",
  "compact": false,
  "mascot": true,
  "servers": [
    { "name": "Home", "url": "http://127.0.0.1:8080", "apiKeyEnv": "STRATA_HOME_KEY" },
    { "name": "Office", "url": "http://192.168.1.20:8080",
      "apiKey": "bearer-key", "refreshMs": 2000, "timeoutMs": 6000 }
  ]
}
```

- **Multiple servers** — one panel per entry, each with its own URL, key, and
  refresh rate. Per-server `refreshMs` / `timeoutMs` override the global value.
- **Credentials** — `apiKey` in the file, or `apiKeyEnv` naming an environment
  variable. An environment variable beats a stale key in the file, so a rotated
  key never silently stays the old one. Strata is unauthenticated by default, so
  an absent key is fine.
- **Permissions** — a config file readable by other users warns, because it may
  hold keys. `chmod 600 strata.json`. `strata.json` is gitignored.
- **Refresh rate** — `refreshMs` (floor 250ms). The mascot animates on its own
  125ms clock, so a 5s refresh interval still looks alive between polls.

A flat single-server file (`{ "url": …, "apiKey": … }`) is accepted and treated
as one server, matching the widget's migration of old `settings.json` files.

## Flags

| Flag | Effect |
|---|---|
| `--config <file>` | use this config file |
| `--server <url>` | watch this server instead of the file; repeatable |
| `--name <name>` / `--key <key>` | label / Bearer key for the preceding `--server` |
| `--interval <1500\|1.5s>` | refresh rate for every server |
| `--timeout <ms>` | metrics request timeout (`/health` always gets 6s) |
| `--theme <dark\|light>` | theme |
| `--compact` | one line per server, like the widget's compact strip |
| `--no-mascot` / `--no-color` | drop the blob / drop ANSI |
| `--once` | poll each server once, print, exit |
| `--json` | with `--once`, raw payloads for piping |

Keys in the live view: `q` quit · `space` refresh now · `c` compact · `d` theme ·
`m` mascot · `1-9` focus a server · `↑`/`↓` select.

## What it reuses from the widget

| Widget | Here |
|---|---|
| `electron/main.js` `request()` / `pollOnce()` | `strata-cli/client.js` — `GET /metrics` then `GET /health`, Bearer auth, 4s/6s timeouts, `{ ok, status, metrics, health, auth }` payload |
| `main.js` `trayStateFor()` | `client.js` `stateOf()` — queued outranks `live.state`, a failed poll is `error` |
| `renderer/renderer.js` cards + formatting | `strata-cli/derive.js` — same speed/prefill pairing, per-GPU lines, VRAM/temp/power/PCIe/CPU/disk, context fraction, expert cache, RAM |
| `renderer/styles.css` palette | `strata-cli/format.js` `PALETTES` — same greens, ambers, reds for light and dark |
| SVG sparklines / donut / progress bars | `format.js` `spark()` / `bar()` block glyphs |
| Compact tab-bar strip | `--compact` one-line-per-server strip |
| Codex-style tray dot | the animated blob's face and the `●` state tag |

Two deliberate departures from the widget: polls never overlap (a tick that is
still in flight is skipped, instead of queueing fetches against a slow server),
and the config file is the source of truth rather than a settings overlay.

## Layout

```
bin/strata.js          argument parsing, --once / --json, entry point
strata-cli/config.js   config discovery, credential precedence, clamping
strata-cli/client.js   fetch + per-server poll timer (no overlapping polls)
strata-cli/derive.js   payload -> numbers
strata-cli/format.js   numbers, sparklines, bars, palette, ANSI widths
strata-cli/mascot.js   the Claude blob: face per state, frames per tick
strata-cli/render.js   boxes, panels, compact strips, header
strata-cli/app.js      animation clock, key handling, screen setup
test/                  geometry + config assertions against the widget's fixture
```

## Test

```bash
npm run check   # syntax check every source file
npm test        # config, polling, derived numbers, layout geometry, mascot frames
```

`test/config.js` covers server lists, credential precedence, refresh clamping
and permission warnings. `test/client.js` stubs `fetch` and asserts URL joining,
the Bearer header, the 401/timeout/503 shapes, and that a poll never overlaps
the one before it. `test/render.js` renders against `test/metrics.json` (copied
from the widget's fixture) and asserts that every drawn line fits the requested
terminal width, that color codes never change line geometry, and that every
mascot frame is the same size. Nothing needs a server or a TTY.

Against a live server:

```bash
node bin/strata.js --server http://<host>:8080 --key <key> --interval 1s
```
