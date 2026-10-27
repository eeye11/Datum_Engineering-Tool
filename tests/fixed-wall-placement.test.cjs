const test = require("node:test");
const assert = require("node:assert/strict");

test("cantilever walls sit at either beam end with the hatch facing away from the beam", async () => {
    const { default: frames } = await import("../src/shared/geometry/body-frames.js");
    for (const end of [{ x: 100, y: 0 }, { x: 60, y: 80 }]) {
        const start = { x: 0, y: 0 };
        const beam = { type: "beam", geometry: { start, end } };
        for (const [attachment, expected, sign] of [
            [{ x: end.x * 0.1, y: end.y * 0.1 }, start, -1],
            [{ x: end.x * 0.9, y: end.y * 0.9 }, end, 1]
        ]) {
            const placement = frames.supportPlacement(beam, attachment, false, { fixed: true });
            assert.deepEqual(placement.render, expected);
            assert.deepEqual(placement.attachment, expected);
            const dot = Math.cos(placement.orientation) * end.x + Math.sin(placement.orientation) * end.y;
            assert.ok(dot * sign > 0, "hatching points into the wall, away from the span");
        }
    }
});
