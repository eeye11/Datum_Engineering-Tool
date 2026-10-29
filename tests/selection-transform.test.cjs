const test = require("node:test");
const assert = require("node:assert/strict");
const model = () => import("../src/shared/selection/selection-transform.js");
const cylinder = {
    id: "cylinder", type: "rectangle", metadata: { thermodynamicsKind: "piston-cylinder" },
    geometry: { position: { x: 10, y: 100 }, width: 80, height: 100, rotation: 0,
        pistonFraction: 0.55, hasStoppers: true, stopperFraction: 0.8 }
};
const cv = { id: "cv", type: "rectangle", geometry: { position: { x: 20, y: 60 }, width: 60, height: 50 } };

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

test("group movement preserves magnitude offsets and resizing scales them as vectors", async () => {
    const { transformSelectionObject } = await model();
    const force = { id: "force", type: "force", geometry: {
        start: { x: 10, y: 20 }, end: { x: 60, y: 20 },
        magnitudeOffset: { x: 30, y: -15 },
        pointOffsets: { station: { x: -5, y: 12 } }
    } };
    const moved = transformSelectionObject(force, { x: 10, y: 20 }, 1, 100, 40);
    assert.deepEqual(moved.geometry.start, { x: 110, y: 60 });
    assert.deepEqual(moved.geometry.magnitudeOffset, { x: 30, y: -15 });
    assert.deepEqual(moved.geometry.pointOffsets, force.geometry.pointOffsets);
    const resized = transformSelectionObject(force, { x: 10, y: 20 }, 2, 100, 40);
    assert.deepEqual(resized.geometry.magnitudeOffset, { x: 60, y: -30 });
    assert.deepEqual(resized.geometry.pointOffsets.station, { x: -10, y: 24 });
    assert.deepEqual(force.geometry.magnitudeOffset, { x: 30, y: -15 });
});

test("force labels default beyond the tail and remain inside selection bounds after moving", async () => {
    const { default: drawing } = await import("../src/shared/model/drawing-state.js");
    const { default: annotations } = await import("../src/features/workspace/model/annotations/annotation-model.js");
    const { default: loads } = await import("../src/features/workspace/model/analysis/load-profile.js");
    const { selectionBounds, transformSelectionObject } = await model();
    const state = drawing.createDrawingState();
    const force = drawing.geometryFactories.force({ x: 0, y: 0 }, { x: 50, y: 0 });
    state.objects = [force];
    const label = annotations.derivedAnnotation(force, state);
    assert.ok(label);
    const drawn = loads.forceGeometry(state, force.geometry);
    const anchor = annotations.annotationAnchor(label, state);
    assert.ok((anchor.x - drawn.tail.x) * (drawn.head.x - drawn.tail.x) +
        (anchor.y - drawn.tail.y) * (drawn.head.y - drawn.tail.y) < 0,
        "default label lies behind the tail, away from the arrowhead");

    force.geometry.magnitudeOffset = { x: 120, y: 80 };
    const movedLabel = annotations.derivedAnnotation(force, state);
    const textBox = annotations.annotationTextBounds(movedLabel, state);
    const box = selectionBounds(state.objects, [force.id], state);
    assert.ok(box.minX <= textBox.minX && box.maxX >= textBox.maxX);
    assert.ok(box.minY <= textBox.minY && box.maxY >= textBox.maxY);

    /*
     * THE ANNOTATION PLACEMENT RE-DERIVES FROM THE MOVED GEOMETRY ITSELF.
     *
     * The placement is a pure function of the feature's current geometry and
     * its stored offset, so re-deriving twice with no change in between is
     * stable (no drift) and finite. A call that mutated the feature in place
     * would make the second derivation differ from the first - which is what
     * an earlier regression did.
     */
    const translatedLabel = annotations.derivedAnnotation(force, state);
    assert.ok(Number.isFinite(translatedLabel.placement.x) && Number.isFinite(translatedLabel.placement.y));
    assert.ok(translatedLabel.placement.x === movedLabel.placement.x && translatedLabel.placement.y === movedLabel.placement.y,
        "re-deriving without an edit is stable");
});

test("truss selection bounds include every joint when the span endpoints share a corner", async () => {
    const { selectionBounds, transformSelectionObject } = await model();
    const corner = { x: 80, y: 0 };
    const truss = {
        id: "truss", type: "truss",
        geometry: {
            start: corner, end: { ...corner },
            members: [
                { start: corner, end: { x: -20, y: 0 } },
                { start: { x: -20, y: 0 }, end: { x: 30, y: 60 } },
                { start: { x: 30, y: 60 }, end: { ...corner } }
            ]
        }
    };
    assert.deepEqual(selectionBounds([truss], [truss.id]),
        { minX: -20, maxX: 80, minY: 0, maxY: 60 });
    const moved = transformSelectionObject(truss, { x: 0, y: 0 }, 1, 10, -15);
    assert.deepEqual(selectionBounds([moved], [truss.id]),
        { minX: -10, maxX: 100, minY: -30, maxY: 45 });
});

test("legacy trusses retain bounds from their span endpoints", async () => {
    const { selectionBounds } = await model();
    const truss = { id: "legacy", type: "truss", geometry: {
        start: { x: 10, y: 20 }, end: { x: 90, y: 50 }
    } };
    assert.deepEqual(selectionBounds([truss], [truss.id]),
        { minX: 10, maxX: 90, minY: 20, maxY: 50 });
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
