# Strata CLI

A terminal monitor for the [Strata](https://github.com/Niko1221/Strata) inference
server — the same numbers the [Strata Widget](https://github.com/wahackr/Strata-Dashboard)
draws in its Electron window, rendered in your shell, for as many servers as you
point at. No dependencies: Node 24 and ANSI only.

```
✷ Strata CLI  ·  1 server  ·  refresh 0.5s  ·  theme dark  ·  ./strata.json
╭─ ▸ ✷ Home · ● idle 25ms ───────────────────────────────────────────────────────────────╮
│ http://127.0.0.1:8080  ·  qwen3.8-flash-next                                           │
│        z     srv-1    ● idle                                                           │
│  ╭───────╮     Waiting for a request                                                   │
│  ╱ ─   ─ ╲     last: 94 tokens at 54.4 tok/s                                           │
│   ╲  ‿  ╱      ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░    │
│  ╰───────╯     refresh 0.5 s · key config                                              │
│   Speed  54.4 t/s ▁▂▃▆█▇▄▂▁▁      PCIe   Gen3 x16 · … ▁▁▁▁▁▁▁▁▁▁                       │
│   GPU 0  Tesla P40                 ░░░░░░░░  0% · 21.9/23 GB · 62 °C · 52 W · Gen3 x16 │
│   GPU 1  RTX 4070                  ░░░░░░░░  0% · 11.8/12 GB · 46 °C · 24 W · Gen3 x16 │
│   CPU    0 % ▁▁▁▁▁▁▁▁▁▁           Disk   0.0 MB/s · … ▁▁▁▁▁▁▁▁▁▁                       │
│   Ctx  51%  █████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░  66,280 / 128k           │
│   Cache 16,902 experts · 20.5 GB    RAM 48.1 / 62 GB     ████████░░                    │
│   Last 01:13:46 PM  Done · 66,186 in / 66,141 reused / 94 out · 54.4 t/s               │
╰────────────────────────────────────────────────────────────────────────────────────────╯
q quit · space refresh · c compact · d theme · m mascot · 1-9 focus · ↑/↓ select
```

Two GPUs in one server, so the GPU %/VRAM/Temp/Power cards become one row per
slot — that is the `GPU 0` / `GPU 1` pair above, and why the panel is taller
than it used to be. See [Multi-GPU](#multi-gpu).

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
| `--color [auto\|16\|256\|truecolor\|console\|never]` | force a palette depth |
| `--ascii` / `--no-ascii` | force ASCII glyphs / force the Unicode glyphs (`--utf8` = `--no-ascii`) |
| `--once` | poll each server once, print, exit |
| `--json` | with `--once`, raw payloads for piping |

Keys in the live view: `q` quit · `space` refresh now · `c` compact · `d` theme ·
`m` mascot · `1-9` focus a server · `↑`/`↓` select.

**Color.** Auto paints 24-bit when `COLORTERM` says `truecolor`, 256-color names
when `TERM` says `256color`, and the 8 ANSI names otherwise. The last case
matters: quantizing the lime accent `#b8f36b` to the nearest 256-color slot
lands on yellow, so on a plain terminal (Alpine's tty, `TERM=linux`) the accent
is the bright-green ANSI name instead. Indexed colors are written as `38;5;n` —
a bare palette index is a different SGR verb, where `8` conceals and `10` sets
the background. `NO_COLOR` turns color off and `FORCE_COLOR` turns it on for
pipes; an explicit `--color` beats both.

`TERM=linux` decides the palette before `COLORTERM` is even read, so a
`truecolor` value inherited from a GUI terminal cannot smuggle 24-bit codes into
the kernel vconsole: auto there means `console`, and `--color console` forces
it. In that mode muted text is light grey (`37`) instead of the dark grey (`90`)
that disappears on a black console, borders are cyan (`36`) for the same reason,
and status keeps its recognizable red/green/yellow (`91/92/93`). Borders are
painted in the border color everywhere, rather than inheriting whatever color
the row happened to use.

**Glyphs.** The box drawing, block sparklines and mascot are Unicode. Auto
detects a terminal that can't render them — no UTF-8 locale (`LANG=C` over ssh),
`TERM=dumb`, `unknown` or `linux` (the kernel console's cp437 font has no
half-blocks) — and replaces every glyph with a same-width ASCII twin: boxes
become `+ - | / \`, the state dot `*`, separators `.`, the mascot a `- o x _ ~`
face, gauges a bracketed `[######----]` where `#` is filled and `-` is not, and
sparklines the seven-step scale ` .-+=*#`. One cell in, one cell out, so the box
still lines up. Nothing fills with `@` and no gauge is a run of dots: on a
framebuffer that lacks the half-block glyph, `█` and `░` collapse into each
other, and an all-empty bar of dots read as a full one. A blank sparkline cell
means no traffic — a nonzero sample never maps to it. `--ascii` forces the
fallback, `--no-ascii` forces Unicode, and `STRATA_ASCII=1` / `STRATA_ASCII=0`
do the same for shells you can't pass flags to. The whole preview again in the
ASCII set, which is what `TERM=linux` and any non-UTF-8 shell sees:

```
* Strata CLI  .  1 server  .  refresh 0.5s  .  theme dark  .  ./strata.json
+- > * Home . * idle 25ms ---------------------------------------------------------------+
| http://127.0.0.1:8080  .  qwen3.8-flash-next                                           |
|        z     srv-1    * idle                                                           |
|  .-------.     Waiting for a request                                                   |
|  | -   - |     last: 94 tokens at 54.4 tok/s                                           |
|   |  _  |      [------------------------------------------------------------------]    |
|  '-------'     refresh 0.5 s . key config                                              |
|   Speed  54.4 t/s  .-+#*=.        PCIe   Gen3 x16 . ~                                  |
|   GPU 0  Tesla P40                 [------]  0% . 21.9/23 GB . 62 C  . 52 W . Gen3 x16 |
|   GPU 1  RTX 4070                  [------]  0% . 11.8/12 GB . 46 C  . 24 W . Gen3 x16 |
|   CPU    0 %                      Disk   0.0 MB/s . ~                                  |
|   Ctx  51%  [########################-----------------------]  66,280 / 128k           |
|   Cache 16,902 experts . 20.5 GB    RAM 48.1 / 62 GB     [######--]                    |
|   Last 01:13:46 PM  Done . 66,186 in / 66,141 reused / 94 out . 54.4 t/s               |
+----------------------------------------------------------------------------------------+
q quit . space refresh . c compact . d theme . m mascot . 1-9 focus . ^/v select
```

**Blank screen?** Three things can hide the frame, in the order they are usually
the culprit:

- **Colors.** When literally nothing shows, borders included, that is conceal
  rather than a dark theme. Test with `--color never`: if the frame appears, the
  terminal is mishandling your color codes. Indexed colors must be `38;5;n` — a
  bare palette index is conceal (`8`) or background (`10`) — and `--color 16`
  falls back to the eight ANSI names.
- **Glyphs.** Box drawing and the block sparklines arriving as `â”€` or `?` mean
  the terminal is not on a UTF-8 locale. Auto detects this; `--ascii` forces it
  and `STRATA_ASCII=1` sets it for a shell you cannot pass flags to.
- **No alternate screen.** `TERM=dumb` or `unknown` ignores the screen switch, so
  the frame is drawn inline instead — which overwrites the lines below it rather
  than clearing your scrollback.

`--once` sidesteps all three: no screen switch, no cursor movement, one plain
frame you can redirect.

**Visible but hard to read?** That is contrast, not concealment. `--color
console` brightens muted text and borders on the kernel vconsole; `--theme
light` helps on a white-backed terminal, and `--color never` removes color from
the comparison entirely. The ASCII gauges and sparkline scale are legible even
with color off.

**Redrawing.** Each frame homes the cursor, rewrites every line, and erases
whatever is left below the last one, so toggling `c` for compact mode or
shrinking the terminal never leaves rows of the previous frame behind. The
screen is cleared once on entry, not per frame, so the widget doesn't flicker
while the mascot animates. That entry switch uses the alternate screen so your
scrollback survives the session, and is skipped when `TERM` doesn't advertise
one — there the frame draws inline instead of landing on a screen nothing paints.

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

## Multi-GPU

When `hardware.gpus[]` reports more than one GPU, the consolidated GPU %/VRAM/
Temp/Power cards are replaced by one row per GPU; Speed pairs with PCIe and CPU
with Disk. Single-GPU servers keep today's cards. PCIe stays one card — the
payload only carries server-wide PCIe fields (see issue #4 for per-GPU PCIe).

```
│   Speed  54.4 t/s ▁▂▃▆█▇▄▂▁▁      PCIe   Gen3 x16 · … ▁▁▁▁▁▁▁▁▁▁                       │
│   GPU 0  Tesla P40                 ░░░░░░░░  0% · 21.9/23 GB · 62 °C · 52 W · Gen3 x16 │
│   GPU 1  RTX 4070                  ░░░░░░░░  0% · 11.8/12 GB · 46 °C · 24 W · Gen3 x16 │
│   CPU    0 % ▁▁▁▁▁▁▁▁▁▁           Disk   0.0 MB/s · … ▁▁▁▁▁▁▁▁▁▁                       │
```

The panel is `13 + N` rows, so a tall multi-GPU view collapses to the compact
strip (which badges a multi-GPU server as `GPU 0% ×2`) before it would scroll.
Boxes span the full terminal width.

## Layout

```
bin/strata.js          argument parsing, --once / --json, entry point
strata-cli/config.js   config discovery, credential precedence, clamping
strata-cli/client.js   fetch + per-server poll timer (no overlapping polls)
strata-cli/derive.js   payload -> numbers
strata-cli/format.js   numbers, sparklines, bars, palette, ANSI widths, ASCII glyphs
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
terminal width, that every escape `paint()` emits is a foreground code rather
than conceal or background, that color and the ASCII fallback change no line
geometry, that an ascii frame holds no byte above U+007F, and that every mascot
frame is the same size. The multi-GPU cases check the `13 + N` row height, the
collapse to the compact strip, and per-slot PCIe. Nothing needs a server or a
TTY.

Against a live server:

```bash
node bin/strata.js --server http://<host>:8080 --key <key> --interval 1s
```
