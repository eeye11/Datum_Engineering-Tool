const test = require("node:test");
const assert = require("node:assert/strict");

test("stress element angle is visible by default and measures from horizontal to its face", async () => {
    const { stressAngleMark } = await import("../src/shared/geometry/stress-element.js");
    const { default: geometry } = await import("../src/shared/geometry/feature-geometry.js");
    const g = { position: { x: 0, y: 20 }, width: 20, height: 20 };
    assert.equal(stressAngleMark({ ...g, rotation: 0 }), null);
    assert.equal(stressAngleMark({ ...g, rotation: 360 }), null);
    for (const rotation of [30, -45, 90]) {
        const mark = stressAngleMark({ ...g, rotation });
        assert.equal(mark.text, `${rotation}°`);
        assert.deepEqual(mark.reference[0], geometry.rectangleCorners({ ...g, rotation })[3]);
        assert.deepEqual(mark.face[0], geometry.rectangleCorners({ ...g, rotation })[2]);
        assert.deepEqual(mark.perpendicular[0], geometry.rectangleCorners({ ...g, rotation })[0]);
        assert.ok(Math.hypot(mark.arc[0].x - mark.reference[0].x, mark.arc[0].y - mark.reference[0].y) > g.width);
        assert.equal(mark.reference[0].y, mark.reference[1].y);
        const [from, to] = mark.face;
        assert.ok(Math.abs(Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI - rotation) < 1e-9);
        assert.equal(stressAngleMark({ ...g, rotation, showAngle: false }), null);
    }
});

test("stress arrow types have distinct defaults and independent colour overrides", async () => {
    const { stressArrows, STRESS_COLOURS } = await import("../src/shared/geometry/stress-element.js");
    const g = { position: { x: 0, y: 20 }, width: 20, height: 20,
        normalStressX: 1, normalStressY: -1, shearStress: 1 };
    const defaults = stressArrows(g);
    assert.equal(new Set(defaults.map(arrow => arrow.colour)).size, 3);
    const custom = stressArrows({ ...g, normalStressXColour: "#a855f7" });
    for (const arrow of custom) {
        assert.equal(arrow.colour, arrow.key === "normalStressX" ? "#a855f7" : STRESS_COLOURS[arrow.key]);
    }
    assert.deepEqual(custom.map(arrow => arrow.points), defaults.map(arrow => arrow.points));
});

test("normal stress reverses for compression and shear arrows balance opposite faces", async () => {
    const { stressArrowPaths } = await import("../src/shared/geometry/stress-element.js");
    const g = { position: { x: -10, y: 10 }, width: 20, height: 20, rotation: 0 };
    assert.equal(stressArrowPaths(g).length, 0);
    const tension = stressArrowPaths({ ...g, normalStressX: 1 });
    const compression = stressArrowPaths({ ...g, normalStressX: -1 });
    assert.equal(tension.length, 2);
    for (let i = 0; i < 2; i++) {
        assert.deepEqual(tension[i][0], compression[i][1]);
        assert.deepEqual(tension[i][1], compression[i][0]);
    }
    const shear = stressArrowPaths({ ...g, shearStress: 1 });
    assert.equal(shear.length, 4);
    const resultant = shear.reduce((sum, path) => ({ x: sum.x + path[1].x - path[0].x, y: sum.y + path[1].y - path[0].y }), { x: 0, y: 0 });
    assert.ok(Math.hypot(resultant.x, resultant.y) < 1e-9);
    const torque = shear.reduce((sum, [from, to]) => sum + from.x * (to.y - from.y) - from.y * (to.x - from.x), 0);
    assert.ok(Math.abs(torque) < 1e-9);
    const rotated = stressArrowPaths({ ...g, normalStressX: 1, rotation: 90 });
    assert.ok(Math.abs(rotated[0][0].x) < 1e-9);
    assert.ok(Math.abs(rotated[0][0].y - tension[0][0].x) < 1e-9);
});

test("resizing a rotated stress element keeps it square and its opposite corner fixed", async () => {
    const { resizeStressElement } = await import("../src/shared/geometry/stress-element.js");
    const { default: geometry } = await import("../src/shared/geometry/feature-geometry.js");
    for (const rotation of [0, 30, -45, 90]) {
        const original = { position: { x: 0, y: 20 }, width: 20, height: 20, rotation };
        for (let index = 0; index < 4; index++) {
            const corners = geometry.rectangleCorners(original);
            const opposite = corners[(index + 2) % 4];
            const point = {
                x: opposite.x + 2 * (corners[index].x - opposite.x),
                y: opposite.y + 2 * (corners[index].y - opposite.y)
            };
            const resized = resizeStressElement(original, index, point);
            assert.equal(resized.width, resized.height);
            assert.equal(resized.rotation, rotation);
            assert.ok(Math.abs(resized.width - 40) < 1e-9);
            assert.ok(geometry.rectangleCorners(resized).some(p => Math.hypot(p.x - opposite.x, p.y - opposite.y) < 1e-9));
        }
    }
});
