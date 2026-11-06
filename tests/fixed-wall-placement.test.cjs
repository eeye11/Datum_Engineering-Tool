const test = require("node:test");
const assert = require("node:assert/strict");

/*
 * A FIXED support's wall sits ON the member's face: the render point is the
 * attachment pushed OUT along the member's normal by its half depth, and the
 * hatch orientation points into the wall, away from the span.
 */
test("fixed walls sit on the member's face with the hatch facing away from the beam", async () => {
    const { default: frames } = await import("../src/shared/geometry/body-frames.js");
    for (const end of [{ x: 100, y: 0 }, { x: 60, y: 80 }]) {
        const start = { x: 0, y: 0 };
        const beam = { type: "beam", geometry: { start, end } };
        const frame = frames.frameOf(beam);
        for (const [attachment, sign] of [
            [{ x: end.x * 0.1, y: end.y * 0.1 }, -1],
            [{ x: end.x * 0.9, y: end.y * 0.9 }, 1]
        ]) {
            const placement = frames.supportPlacement(beam, attachment, false, { fixed: true });
            /* The attachment stays where the user pinned it. */
            assert.deepEqual(placement.attachment, attachment);
            /* The wall is the attachment pushed out to the face by halfDepth. */
            assert.ok(
                Math.abs(placement.render.x - (attachment.x + frame.normal.x * placement.side * frame.halfDepth)) < 1e-9,
                "render sits on the member's face along the normal"
            );
            assert.ok(
                Math.abs(placement.render.y - (attachment.y + frame.normal.y * placement.side * frame.halfDepth)) < 1e-9,
                "render sits on the member's face along the normal"
            );
            const dot = Math.cos(placement.orientation) * end.x + Math.sin(placement.orientation) * end.y;
            assert.ok(dot * sign > 0, "hatching points into the wall, away from the span");
        }
    }
});
