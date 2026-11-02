const assert = require("node:assert/strict");
const { loadModule } = require("./helpers/source-path.cjs");
global.window = {};
loadModule("body-frames.js");
const frames = window.enggBodyFrames;

for (const end of [{ x: 100, y: 0 }, { x: 0, y: 100 }, { x: 60, y: 80 }]) {
  const beam = { type: "beam", geometry: { start: { x: 0, y: 0 }, end, depth: 20 } };
  for (const fraction of [0.01, 0.99]) {
    const click = { x: end.x * fraction, y: end.y * fraction };
    const placement = frames.supportPlacement(beam, click, false, { fixed: true });
    const expected = fraction < 0.5 ? beam.geometry.start : end;
    assert.deepEqual(placement.render, expected, "wall touches the beam endpoint without a sideways offset");
    const direction = fraction < 0.5 ? -1 : 1;
    assert.ok(Math.abs(Math.cos(placement.angle) - end.x / 100 * direction) < 1e-9);
    assert.ok(Math.abs(Math.sin(placement.angle) + end.y / 100 * direction) < 1e-9,
      "hatching faces away from the beam in screen coordinates");
  }
}
