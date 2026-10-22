const test = require("node:test");
const assert = require("node:assert/strict");

test("drawing axes follows the dragged width and height in every direction", async () => {
    const { coordinateSystemFromDrag } = await import("../src/shared/geometry/coordinate-system.js");
    for (const x of [-40, 40]) {
        for (const y of [-20, 20]) {
            const axes = coordinateSystemFromDrag({ x: 0, y: 0 }, { x, y });
            assert.equal(axes.rotation, 0);
            assert.equal(axes.xPositiveLength, 40);
            assert.equal(axes.yPositiveLength, 20);
            assert.deepEqual(axes.origin, { x: Math.min(0, x), y: Math.min(0, y) });
            assert.equal(axes.origin.x + axes.xPositiveLength, Math.max(0, x));
            assert.equal(axes.origin.y + axes.yPositiveLength, Math.max(0, y));
        }
    }
    assert.equal(coordinateSystemFromDrag({ x: 0, y: 0 }, { x: 0, y: 0 }), null);
});

test("coordinate systems expose only two positive arms, including rotated systems", async () => {
    const { coordinateSystemArms } = await import("../src/shared/geometry/feature-handles.js");
    const g = { origin: { x: 4, y: 5 }, xPositiveLength: 20, yPositiveLength: 10,
        xNegativeLength: 100, yNegativeLength: 100 };
    const arms = coordinateSystemArms(g);
    assert.deepEqual(arms.map(arm => arm.kind), ["xPositive", "yPositive"]);
    assert.deepEqual(arms.map(arm => arm.end), [{ x: 24, y: 5 }, { x: 4, y: 15 }]);
    const rotated = coordinateSystemArms({ ...g, rotation: Math.PI / 2 });
    assert.ok(Math.abs(rotated[0].end.x - 4) < 1e-9);
    assert.ok(Math.abs(rotated[0].end.y - 25) < 1e-9);
    assert.ok(Math.abs(rotated[1].end.x + 6) < 1e-9);
    assert.equal(coordinateSystemArms({ ...g, showYAxis: false }).length, 1);
});
