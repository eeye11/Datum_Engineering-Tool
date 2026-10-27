const test = require("node:test");
const assert = require("node:assert/strict");
const box = { position: { x: 0, y: 20 }, width: 40, height: 20, rotation: 0 };

test("uniform and triangular boundary stresses have the expected arrow lengths", async () => {
    const { boundaryStressDrawing } = await import("../src/shared/geometry/boundary-stress.js");
    assert.equal(boundaryStressDrawing(box).paths.length, 0);
    const uniform = boundaryStressDrawing({ ...box, top_normalStart: 1, top_normalEnd: 1 }).paths;
    assert.equal(uniform.length, 8); // seven arrows and the envelope
    const lengths = uniform.slice(0, 7).map(({ points }) => Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y));
    assert.ok(lengths.every(length => Math.abs(length - lengths[0]) < 1e-9));
    const triangular = boundaryStressDrawing({ ...box, top_normalStart: 0, top_normalEnd: 1 }).paths;
    assert.equal(triangular.length, 7); // zero end has no arrow
    const envelope = triangular.at(-1).points;
    assert.ok(envelope.every((point, index) => index === 0 || point.y > envelope[index - 1].y));
});

test("signed boundary values reverse arrows and quadratic profiles stay curved", async () => {
    const { boundaryStressDrawing } = await import("../src/shared/geometry/boundary-stress.js");
    const positive = boundaryStressDrawing({ ...box, right_shearStart: 1, right_shearEnd: 1 }).paths;
    const negative = boundaryStressDrawing({ ...box, right_shearStart: -1, right_shearEnd: -1 }).paths;
    assert.equal(positive.length, 7);
    for (let i = 0; i < 7; i++) {
        assert.deepEqual(positive[i].points[0], negative[i].points[1]);
        assert.deepEqual(positive[i].points[1], negative[i].points[0]);
    }
    const curve = boundaryStressDrawing({ ...box, top_normalEnd: 1, top_profile: "quadratic", top_normalLabel: "6pxb" });
    const points = curve.paths.at(-1).points;
    assert.ok(points[3].y - points[0].y < (points[6].y - points[0].y) / 2);
    assert.equal(curve.labels[0].text, "6pxb");
});
