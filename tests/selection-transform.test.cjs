const test = require("node:test");
const assert = require("node:assert/strict");
const model = () => import("../src/shared/selection/selection-transform.js");
const cylinder = {
    id: "cylinder", type: "rectangle", metadata: { thermodynamicsKind: "piston-cylinder" },
    geometry: { position: { x: 10, y: 100 }, width: 80, height: 100, rotation: 0,
        pistonFraction: 0.55, hasStoppers: true, stopperFraction: 0.8 }
};
const cv = { id: "cv", type: "rectangle", geometry: { position: { x: 20, y: 60 }, width: 60, height: 50 } };

test("a selected force's frame includes its displaced magnitude label", async () => {
    const { selectionBounds } = await model();
    const annotations = (await import("../src/features/workspace/model/annotations/annotation-model.js")).default;
    const force = { id: "force", type: "force", geometry: {
        start: { x: 10, y: 20 }, end: { x: 40, y: 60 }, magnitude: 100,
        magnitudeOffset: { x: 120, y: 80 }
    } };
    const state = { objects: [force], camera: { zoom: 1 }, display: { showMagnitudes: true } };
    const labels = annotations.derivedAnnotations(force, state);
    assert.ok(labels.length > 0);
    const frame = selectionBounds([force], [force.id], state);
    for (const label of labels) {
        const box = annotations.annotationTextBounds(label, state);
        assert.ok(frame.minX <= box.minX && frame.maxX >= box.maxX);
        assert.ok(frame.minY <= box.minY && frame.maxY >= box.maxY);
    }
    assert.ok(frame.minX <= 10 && frame.maxY >= 60);
});

test("moving a force and its magnitude preserves the label offset without doubling the move", async () => {
    const { transformSelectionObject } = await model();
    const force = { id: "force", type: "force", geometry: {
        start: { x: 10, y: 20 }, end: { x: 40, y: 60 },
        magnitudeOffset: { x: -12, y: 8 }
    } };
    const moved = transformSelectionObject(force, { x: 80, y: -30 }, 1, 100, -50);
    assert.deepEqual(moved.geometry.start, { x: 110, y: -30 });
    assert.deepEqual(moved.geometry.end, { x: 140, y: 10 });
    assert.deepEqual(moved.geometry.magnitudeOffset, { x: -12, y: 8 });
    assert.deepEqual(force.geometry.magnitudeOffset, { x: -12, y: 8 });
});

test("group transforms scale label offsets as vectors, including per-point and support labels", async () => {
    const { transformSelectionObject } = await model();
    const object = { id: "load", type: "varying-load", geometry: {
        start: { x: 5, y: 10 },
        magnitudeOffset: { x: 0, y: 0 },
        pointOffsets: { a: { x: 4, y: -2 }, b: { x: -3, y: 5 } },
        supportValueOffsets: { reaction: { x: 1, y: 7 } }
    } };
    const moved = transformSelectionObject(object, { x: 25, y: 30 }, 2, 80, -10);
    assert.deepEqual(moved.geometry.start, { x: 65, y: -20 });
    assert.deepEqual(moved.geometry.magnitudeOffset, { x: 0, y: 0 });
    assert.deepEqual(moved.geometry.pointOffsets, { a: { x: 8, y: -4 }, b: { x: -6, y: 10 } });
    assert.deepEqual(moved.geometry.supportValueOffsets, { reaction: { x: 2, y: 14 } });
});

test("nested cylinder and control volume move together without accumulating deltas", async () => {
    const { transformSelectionObject, selectionBounds } = await model();
    const moved = [cylinder, cv].map(object => transformSelectionObject(object, { x: 0, y: 0 }, 1, 30, -10));
    assert.deepEqual(moved[0].geometry.position, { x: 40, y: 90 });
    assert.deepEqual(moved[1].geometry.position, { x: 50, y: 50 });
    assert.deepEqual(selectionBounds(moved, ["cylinder", "cv"]), { minX: 40, maxX: 120, minY: -10, maxY: 90 });
    assert.deepEqual(transformSelectionObject(cylinder, { x: 0, y: 0 }, 1, 30, -10), moved[0]);
    assert.deepEqual(cylinder.geometry.position, { x: 10, y: 100 });
});

test("group resizing scales sizes and spacing while preserving piston and stopper fractions", async () => {
    const { transformSelectionObject } = await model();
    const anchor = { x: 10, y: 0 };
    const a = transformSelectionObject(cylinder, anchor, 2);
    const b = transformSelectionObject(cv, anchor, 2);
    assert.deepEqual(a.geometry.position, { x: 10, y: 200 });
    assert.equal(a.geometry.width, 160);
    assert.equal(a.geometry.height, 200);
    assert.deepEqual(b.geometry.position, { x: 30, y: 120 });
    assert.equal(b.geometry.width, 120);
    assert.equal(a.geometry.pistonFraction, 0.55);
    assert.equal(a.geometry.stopperFraction, 0.8);
});

test("attached features are included once even if also selected", async () => {
    const { selectionMembers } = await model();
    const child = { id: "load", parentId: "cylinder" };
    const grandchild = { id: "label", parentId: "load" };
    assert.deepEqual(selectionMembers([cylinder, cv, child, grandchild], ["cylinder", "load"]).map(item => item.id),
        ["cylinder", "load", "label"]);
});
