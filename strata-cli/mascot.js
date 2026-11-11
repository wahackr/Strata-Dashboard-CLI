// A head-only ASCII bunny. State changes the eyes and accessory; every frame
// reserves the same space, so blinking and drifting z's never move the panel.
const { pad } = require("./format.js");

const W = 14;
const H = 8; // accessory row + seven head rows

const FACE = {
  idle: { eyes: "-   -", mouth: "x" },
  reading: { eyes: "o   o", mouth: "x" },
  generating: { eyes: ".   .", mouth: "x" },
  queued: { eyes: "~   ~", mouth: "x" },
  error: { eyes: "x   x", mouth: "x" },
};

// The bunny uses the same readable ASCII face in every terminal.
const ASCII_FACE = FACE;
const ACCESSORY = {
  idle: ["", "          z", "           z", "            z"],
  reading: [" .", "   .", "     .", "       ."],
  generating: [" *       *", "   *   *", " *   *   *", "   *   *"],
  queued: ["      .", "      ..", "      ...", "      ...."],
  error: ["      !", "      !!", "      !", "     !!!"],
};

const BURST = ["✳", "✷", "✶", "✴", "✹"];

function stateList() {
  return Object.keys(FACE);
}

function frame(state, tick, ascii = false) {
  const key = FACE[state] ? state : "idle";
  const t = tick ?? 0;
  const face = FACE[key];
  // Briefly open sleepy eyes once per sixteen animation ticks.
  const eyes = key === "idle" && t % 16 === 15 ? ".   ." : face.eyes;
  const accessoryTick = key === "idle" ? Math.floor(t / 4) : t;
  const accessory = ACCESSORY[key][accessoryTick % ACCESSORY[key].length];
  return [
    accessory,
    "    _   _",
    "   | | | |",
    "   | |_| |",
    "  /       \\",
    ` |  ${eyes}  |`,
    ` |    ${face.mouth}    |`,
    "  \\_______/",
  ].map((row) => pad(row, W));
}

// Keep a small face in the compact strip; the full head lives in the panel.
function inline(state, ascii = false) {
  const key = FACE[state] ? state : "idle";
  return `(${FACE[key].eyes})`;
}

function burst(tick) {
  return BURST[(tick ?? 0) % BURST.length];
}

module.exports = { frame, inline, burst, stateList, W, H, FACE, ASCII_FACE };
