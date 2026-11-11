// The Claude blob, drawn in box-drawing characters. One soft oblong body with
// four face rows; state picks the face, the tick picks the frame. Frames are
// emitted at a fixed cell size so an animation never nudges the panel layout.
const { center, pad, asciiize } = require("./format.js");

const W = 12; // mascot cell width, in terminal cells
const H = 5;  // accessory row + four body rows

const FACE = {
  idle: { eyes: "─   ─", mouth: "‿" },
  reading: { eyes: "◕   ◕", mouth: "o" },
  generating: { eyes: "◕   ◕", mouth: "o" },
  queued: { eyes: "◡   ◡", mouth: "‿" },
  error: { eyes: "✕   ✕", mouth: "﹏" },
};

// The same faces without the box-drawing and dingbat glyphs. Eyes stay five
// cells wide and the mouths one, so the ASCII body rows are the same width as
// the Unicode ones and the panel geometry does not move when the glyphs do.
const ASCII_FACE = {
  idle: { eyes: "-   -", mouth: "_" },
  reading: { eyes: "o   o", mouth: "o" },
  generating: { eyes: "o   o", mouth: "o" },
  queued: { eyes: "-   -", mouth: "~" },
  error: { eyes: "x   x", mouth: "x" },
};

const ACCESSORY = {
  // A dozing z drifts right across the four frames.
  idle: ["         ", "      z  ", "    z    ", "  z      "],
  // Reading: dots scan left to right over the prompt being read.
  reading: [" ·  ·  · ", "  ·  ·  ·", "   ·  · ", " ·   ·   "],
  // Generating: sparks pop around the head.
  generating: ["✳  ·  ✳ ", " ·  ✳  · ", "✳ ·   ✳  ", "  ✳  ·  ✳"],
  // Queued: a little queue grows.
  queued: ["    ·    ", "    ··   ", "    ···  ", "    ···· "],
  // Error: an alarm that pulses.
  error: ["    !    ", "    !!   ", "    !    ", "   !!!   "],
};

const BURST = ["✳", "✷", "✶", "✴", "✹"];

function stateList() {
  return Object.keys(FACE);
}

// lean alternates the body's horizontal center by one cell: the blob wobbles
// instead of sitting perfectly still.
function frame(state, tick, ascii = false) {
  const key = FACE[state] ? state : "idle";
  const face = ascii ? ASCII_FACE[key] : FACE[key];
  const acc = ascii ? asciiize(ACCESSORY[key][(tick ?? 0) % ACCESSORY[key].length]) : ACCESSORY[key][(tick ?? 0) % ACCESSORY[key].length];
  const lean = (tick ?? 0) % 2;
  const w = W - lean;
  const art = ascii
    ? [".-------.", `| ${face.eyes} |`, `| ${center(face.mouth, 3)} |`, "'-------'"]
    : ["╭───────╮", `╱ ${face.eyes} ╲`, `╲ ${center(face.mouth, 3)} ╱`, "╰───────╯"];
  return [
    pad(center(acc, W), W),
    pad(center(art[0], w), W),
    pad(center(art[1], w), W),
    pad(center(art[2], w), W),
    pad(center(art[3], w), W),
  ];
}

// Same blob, one line, for the compact strip: eyes carry the state.
function inline(state, ascii = false) {
  const key = FACE[state] ? state : "idle";
  return ascii ? `(${ASCII_FACE[key].eyes})` : `╲${FACE[key].eyes}╱`;
}

function burst(tick) {
  return BURST[(tick ?? 0) % BURST.length];
}

module.exports = { frame, inline, burst, stateList, W, H, FACE, ASCII_FACE };
