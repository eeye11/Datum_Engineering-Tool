const test = require("node:test");
const assert = require("node:assert/strict");

test("process plot axes use the snapped drawing bounds", async () => {
    const { processDiagramPaths } = await import("../src/features/workspace/model/thermodynamics/saturation-curve.js");
    const geometry = { position: { x: 10, y: 60 }, width: 40, height: 50, rotation: 0 };
    const [axes] = processDiagramPaths(geometry, { metadata: { thermodynamicsKind: "process-plot" } });
    assert.deepEqual(axes, [{ x: 10, y: 60 }, { x: 10, y: 10 }, { x: 50, y: 10 }]);
    for (const point of axes) {
        assert.equal(point.x % 5, 0);
        assert.equal(point.y % 5, 0);
    }
});
