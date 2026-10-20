const test = require("node:test");
const assert = require("node:assert/strict");

test("midpoint snaps straight from either side within the drag tolerance", async () => {
    const { setProcessBendFromPoint } = await import("../src/features/workspace/model/thermodynamics/process-curves.js");
    const horizontal = { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] };
    for (const y of [-6, -2, 0, 2, 6]) {
        setProcessBendFromPoint(horizontal, 0, { x: 50, y }, 6);
        assert.equal(horizontal.segmentBends[0], 0);
    }
    setProcessBendFromPoint(horizontal, 0, { x: 50, y: 7 }, 6);
    assert.equal(horizontal.segmentBends[0], 0.07);
    const vertical = { points: [{ x: 20, y: 0 }, { x: 20, y: 100 }] };
    setProcessBendFromPoint(vertical, 0, { x: 25, y: 50 }, 6);
    assert.equal(vertical.segmentBends[0], 0);
    // At twice the zoom, the same six-pixel radius is three world units.
    setProcessBendFromPoint(horizontal, 0, { x: 50, y: 4 }, 3);
    assert.equal(horizontal.segmentBends[0], 0.04);
});

test("dragging the midpoint bends only its segment and can straighten it again", async () => {
    const { processBendPoint, setProcessBendFromPoint, processSegmentPoints } = await import("../src/features/workspace/model/thermodynamics/process-curves.js");
    const geometry = { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] };
    assert.deepEqual(processBendPoint(geometry, 0), { x: 50, y: 0 });
    setProcessBendFromPoint(geometry, 0, { x: 50, y: 30 });
    assert.deepEqual(processBendPoint(geometry, 0), { x: 50, y: 30 });
    assert.deepEqual(processSegmentPoints(geometry, 0)[32], processBendPoint(geometry, 0));
    assert.equal(geometry.segmentBends[1], undefined);
    setProcessBendFromPoint(geometry, 0, { x: 50, y: -20 });
    assert.equal(geometry.segmentBends[0], -0.2);
    setProcessBendFromPoint(geometry, 0, { x: 50, y: 0 });
    assert.equal(geometry.segmentBends[0], 0);
    const collapsed = { points: [{ x: 0, y: 0 }, { x: 0, y: 0 }] };
    setProcessBendFromPoint(collapsed, 0, { x: 10, y: 10 });
    assert.equal(collapsed.segmentBends, undefined);
});

test("process bends preserve states, curve either way, and leave other segments straight", async () => {
    const { processSegmentPoints, processPathPoints } = await import("../src/features/workspace/model/thermodynamics/process-curves.js");
    const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
    const geometry = { points, segmentBends: [0.3] };
    const curved = processSegmentPoints(geometry, 0);
    assert.deepEqual(curved[0], points[0]);
    assert.deepEqual(curved.at(-1), points[1]);
    assert.deepEqual(curved[32], { x: 50, y: 30 });
    assert.deepEqual(processSegmentPoints(geometry, 1), points.slice(1));
    assert.deepEqual(processPathPoints(geometry).at(-1), points[2]);
    assert.deepEqual(processSegmentPoints({ ...geometry, segmentBends: [-0.3] }, 0)[32], { x: 50, y: -30 });
    assert.deepEqual(processSegmentPoints({ points }, 0), points.slice(0, 2));
});

test("process bend follows rotation and scaling of its states", async () => {
    const { processSegmentPoints } = await import("../src/features/workspace/model/thermodynamics/process-curves.js");
    const geometry = { points: [{ x: 20, y: 10 }, { x: 20, y: 210 }], segmentBends: [0.3] };
    assert.deepEqual(processSegmentPoints(geometry, 0)[32], { x: -40, y: 110 });
});
