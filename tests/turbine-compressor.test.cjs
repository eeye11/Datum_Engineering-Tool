const test = require("node:test");
const assert = require("node:assert/strict");

test("turbine/compressor casing matches the reference and follows rotation", async () => {
    const { turbineCompressorPoints } = await import("../src/features/workspace/model/thermodynamics/turbine-compressor.js");
    const { cylinderPoint } = await import("../src/features/workspace/model/thermodynamics/piston-cylinder.js");
    const g = { position: { x: 10, y: 100 }, width: 90, height: 60, rotation: 0 };
    const points = turbineCompressorPoints(g);
    assert.deepEqual(points, [{ x: 10, y: 100 }, { x: 100, y: 80 }, { x: 100, y: 60 }, { x: 10, y: 40 }, { x: 10, y: 100 }]);
    const rotated = { ...g, rotation: 90 };
    assert.deepEqual(turbineCompressorPoints(rotated)[1], cylinderPoint(rotated, 1, 2 / 3));
    assert.deepEqual(turbineCompressorPoints(rotated)[0], turbineCompressorPoints(rotated).at(-1));
});
