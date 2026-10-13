const test = require("node:test");
const assert = require("node:assert/strict");

const model = () => import("../src/features/thermodynamics/piston-cylinder.js");
const geometry = () => ({ position: { x: 10, y: 120 }, width: 80, height: 100, rotation: 0 });

test("piston slides vertically without changing cylinder size or location", async () => {
    const { cylinderPoint, setPistonFromPoint, pistonFraction } = await model();
    const g = geometry();
    setPistonFromPoint(g, { x: 500, y: 90 });
    assert.equal(pistonFraction(g), 0.7);
    assert.deepEqual(cylinderPoint(g, 0.5, pistonFraction(g)), { x: 50, y: 90 });
    assert.deepEqual(g.position, { x: 10, y: 120 });
    assert.equal(g.height, 100);
    assert.equal(g.width, 80);
});

test("piston stays inside cylinder when dragged past either end", async () => {
    const { setPistonFromPoint, pistonFraction } = await model();
    const g = geometry();
    setPistonFromPoint(g, { x: 50, y: 300 });
    assert.equal(pistonFraction(g), 0.95);
    setPistonFromPoint(g, { x: 50, y: -300 });
    assert.equal(pistonFraction(g), 0.05);
});

test("piston height follows the cylinder axis after rotation and resizing", async () => {
    const { cylinderPoint, setPistonFromPoint, pistonFraction } = await model();
    const g = { ...geometry(), rotation: 90, height: 200 };
    setPistonFromPoint(g, cylinderPoint(g, 0.8, 0.3));
    assert.ok(Math.abs(pistonFraction(g) - 0.3) < 1e-9);
    g.height = 400;
    assert.ok(Math.abs(g.height * pistonFraction(g) - 120) < 1e-9);
});
