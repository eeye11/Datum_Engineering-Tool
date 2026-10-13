const test = require("node:test");
const assert = require("node:assert/strict");

test("saturation dome remains inside its frame and joins at a single peak", async () => {
    const { saturationPaths } = await import("../src/features/thermodynamics/saturation-curve.js");
    const g = { position: { x: 0, y: 100 }, width: 100, height: 100, rotation: 0 };
    const paths = saturationPaths(g);
    const dome = paths[3];
    assert.equal(dome.length, 65);
    assert.deepEqual(dome[32], { x: 45, y: 82 });
    assert.ok(dome.every(point => point.x >= 0 && point.x <= 100 && point.y >= 0 && point.y <= 100));
    assert.ok(Math.abs(dome[0].y - 25) < 1e-9);
    assert.ok(Math.abs(dome.at(-1).y - 24) < 1e-9);
    const resized = saturationPaths({ ...g, width: 200, height: 200, position: { x: 0, y: 200 } });
    assert.deepEqual(resized[3][32], { x: 90, y: 164 });
});
