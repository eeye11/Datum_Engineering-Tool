const { JSDOM } = require("jsdom");
const { createHarness } = require("./harness-renderer.cjs");
const { modulePath, loadModule } = require("./helpers/source-path.cjs");

const projectRoot = require("path").join(__dirname, "..");
createHarness(projectRoot, JSDOM, require);

const drawingStateModel = require(modulePath("drawing-state.js")).default;
const snapModule = loadModule("object-snap.js");
const snap = snapModule.default || snapModule;
const state = drawingStateModel.createDrawingState();
const bounds = { width: 800, height: 600 };

const near = (actual, expected) => Math.abs(actual - expected) < 1e-9;
let failures = 0;

function check(name, condition) {
    if (!condition) {
        failures += 1;
        console.error(`FAIL ${name}`);
    }
}

check("grid snapping is enabled by default", state.grid.snapToGrid === true);

{
    state.grid.spacing = 10;
    const result = snap.resolveConstructionPoint(
        { x: 12.1, y: -7.6 },
        state,
        bounds
    );

    check(
        "construction points round to grid spacing",
        near(result.effectiveConstructionPoint.x, 10) &&
            near(result.effectiveConstructionPoint.y, -10)
    );
}

{
    state.objects = [
        {
            id: "line-1",
            type: "line",
            geometry: {
                start: { x: 12, y: 2 },
                end: { x: 30, y: 2 }
            }
        }
    ];

    const result = snap.resolveConstructionPoint(
        { x: 12.1, y: 2.1 },
        state,
        bounds
    );

    check(
        "a nearby object snap wins over the grid",
        result.snapCandidate?.type === "endpoint" &&
            near(result.effectiveConstructionPoint.x, 12) &&
            near(result.effectiveConstructionPoint.y, 2)
    );
}

{
    state.objects = [];
    state.grid.snapToGrid = false;

    const result = snap.resolveConstructionPoint(
        { x: 12.1, y: -7.6 },
        state,
        bounds
    );

    check(
        "disabling grid snap leaves the pointer unsnapped",
        near(result.effectiveConstructionPoint.x, 12.1) &&
            near(result.effectiveConstructionPoint.y, -7.6)
    );
}

{
    state.grid.snapToGrid = true;
    state.grid.visible = false;
    state.grid.spacing = 10;
    state.camera.zoom = 3;
    state.camera.panX = 123;
    state.camera.panY = -45;

    const result = snap.resolveConstructionPoint(
        { x: 14, y: -16 },
        state,
        bounds
    );

    check(
        "grid snap remains world-coordinate based when hidden, panned, and zoomed",
        near(result.effectiveConstructionPoint.x, 10) &&
            near(result.effectiveConstructionPoint.y, -20)
    );
}

if (failures) {
    process.exitCode = 1;
} else {
    console.log("Grid snapping tests passed.");
}
