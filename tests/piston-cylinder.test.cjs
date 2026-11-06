const test = require("node:test");
const assert = require("node:assert/strict");

const model = () => import("../src/features/workspace/model/thermodynamics/piston-cylinder.js");
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

test("piston can sit above or below the stoppers and still stays inside the cylinder", async () => {
    const { cylinderPoint, setPistonFromPoint, setStoppersFromPoint, pistonFraction, stopperFraction } = await model();
    const g = { ...geometry(), hasStoppers: true, stopperFraction: 0.8 };
    setPistonFromPoint(g, cylinderPoint(g, 0.5, 1.5));
    assert.equal(pistonFraction(g), 0.95);
    setPistonFromPoint(g, cylinderPoint(g, 0.5, 0.92));
    assert.equal(pistonFraction(g), 0.92);
    setStoppersFromPoint(g, cylinderPoint(g, 0.09, 0.4));
    assert.equal(stopperFraction(g), 0.4);
    assert.equal(pistonFraction(g), 0.92);
    setPistonFromPoint(g, cylinderPoint(g, 0.5, 0.2));
    assert.equal(pistonFraction(g), 0.2);
    setPistonFromPoint(g, cylinderPoint(g, 0.5, -1));
    assert.equal(pistonFraction(g), 0.05);
    assert.equal(g.height, 100);
    assert.equal(g.width, 80);
});

test("piston can drop onto lower stoppers in a rotated cylinder", async () => {
    const { cylinderPoint, setPistonFromPoint, pistonFraction, setStoppersFromPoint } = await model();
    const g = { ...geometry(), rotation: 90, hasStoppers: true, stopperFraction: 0.4 };
    setPistonFromPoint(g, cylinderPoint(g, 0.5, 0.8));
    assert.ok(Math.abs(pistonFraction(g) - 0.8) < 1e-9);
    // The piston extends 0.04 below its height; its underside rests on
    // the stops' top face, which is 0.04 above their stored height.
    setPistonFromPoint(g, cylinderPoint(g, 0.5, 0.48));
    assert.ok(Math.abs(pistonFraction(g) - 0.48) < 1e-9);
    setStoppersFromPoint(g, cylinderPoint(g, 0.09, 0.3));
    assert.ok(Math.abs(pistonFraction(g) - 0.48) < 1e-9);
});

test("stopper adjustment follows a rotated cylinder and stays within its walls", async () => {
    const { cylinderPoint, setStoppersFromPoint, stopperFraction, stopperPaths } = await model();
    const g = { ...geometry(), rotation: 90, hasStoppers: true };
    setStoppersFromPoint(g, cylinderPoint(g, 0.91, 0.65));
    assert.ok(Math.abs(stopperFraction(g) - 0.65) < 1e-9);
    assert.equal(stopperPaths(g).length, 2);
    setStoppersFromPoint(g, cylinderPoint(g, 0.91, 2));
    assert.equal(stopperFraction(g), 0.95);
    assert.deepEqual(stopperPaths(geometry()), []);
});

test("piston snaps flush to either stopper face and releases when dragged away", async () => {
    const { cylinderPoint, setPistonFromPoint, pistonFraction } = await model();
    for (const rotation of [0, 90]) {
        const g = { ...geometry(), rotation, hasStoppers: true, stopperFraction: 0.4 };
        for (const target of [0.4, 0.48]) {
            for (const offset of [-0.015, 0.015]) {
                setPistonFromPoint(g, cylinderPoint(g, 0.5, target + offset));
                assert.ok(Math.abs(pistonFraction(g) - target) < 1e-9);
            }
        }
        for (const target of [0.2, 0.7]) {
            setPistonFromPoint(g, cylinderPoint(g, 0.5, target));
            assert.ok(Math.abs(pistonFraction(g) - target) < 1e-9);
        }
    }
});
