// The Claude blob, drawn in box-drawing characters. One soft oblong body with
// four face rows; state picks the face, the tick picks the frame. Frames are
// emitted at a fixed cell size so an animation never nudges the panel layout.
const { center, pad } = require("./format.js");

const W = 12; // mascot cell width, in terminal cells
const H = 5;  // accessory row + four body rows

const FACE = {
  idle: { eyes: "─   ─", mouth: "‿" },
  reading: { eyes: "◕   ◕", mouth: "o" },
  generating: { eyes: "◕   ◕", mouth: "o" },
  queued: { eyes: "◡   ◡", mouth: "‿" },
  error: { eyes: "✕   ✕", mouth: "﹏" },
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
function frame(state, tick) {
  const key = FACE[state] ? state : "idle";
  const face = FACE[key];
  const acc = ACCESSORY[key][(tick ?? 0) % ACCESSORY[key].length];
  const lean = (tick ?? 0) % 2;
  const w = W - lean;
  return [
    pad(center(acc, W), W),
    pad(center("╭───────╮", w), W),
    pad(center(`╱ ${face.eyes} ╲`, w), W),
    pad(center(`╲ ${center(face.mouth, 3)} ╱`, w), W),
    pad(center("╰───────╯", w), W),
  ];
}

// Same blob, one line, for the compact strip: eyes carry the state.
function inline(state) {
  const key = FACE[state] ? state : "idle";
  return `╲${FACE[key].eyes}╱`;
}

function burst(tick) {
  return BURST[(tick ?? 0) % BURST.length];
}

module.exports = { frame, inline, burst, stateList, W, H, FACE };
