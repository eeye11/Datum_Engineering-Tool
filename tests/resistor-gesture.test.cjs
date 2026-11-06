const { test } = require("node:test");
const assert = require("node:assert/strict");

test("electric work follows the dragged envelope in all four directions", async () => {
    const { resistorGeometryFromDrag, resistorPoints } = await import("../src/features/workspace/model/thermodynamics/resistor.js");
    for (const x of [-40, 40]) {
        for (const y of [-20, 20]) {
            const geometry = resistorGeometryFromDrag({ x: 0, y: 0 }, { x, y });
            const points = resistorPoints(geometry);
            assert.deepEqual(points[0], { x: 0, y: 0 });
            assert.deepEqual(points.at(-1), { x: 0, y });
            assert.ok(points.some(point => Math.abs(point.x - x) < 1e-9));
            assert.ok(points.every(point => point.x * x >= 0));
        }
    }
});

test("horizontal and vertical drags produce a usable nonzero resistor", async () => {
    const { resistorGeometryFromDrag, resistorPoints } = await import("../src/features/workspace/model/thermodynamics/resistor.js");
    for (const cursor of [{ x: 40, y: 0 }, { x: 0, y: -40 }]) {
        const points = resistorPoints(resistorGeometryFromDrag({ x: 0, y: 0 }, cursor));
        assert.ok(points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));
        assert.ok(Math.max(...points.map(point => point.x)) > 0);
        assert.ok(Math.min(...points.map(point => point.y)) < 0);
    }
});
