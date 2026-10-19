
const path = require("path");

const { loadModule, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
/*
 * The feature factories for dimensions and annotations, tested directly.
 *
 * These exist because of a bug that was invisible from every other
 * angle. A dimension created through the factory was a perfectly
 * well-formed feature: it was named, numbered, selectable, savable
 * and undoable, and it appeared in the Features list. It simply drew
 * nothing and could not be measured.
 *
 * The reason was a shape mismatch. The factory put a dimension's
 * measurement under `content`, while the dimension model reads
 * `dimension.sourceRefs` and `dimension.placement` straight off the
 * feature. Every lookup landed on undefined, so the measurement
 * resolved to nothing. Because nothing THREW, no error surfaced
 * anywhere - the dimension was just quietly empty.
 *
 * The same applied to annotations, whose model reads its own
 * `textMode`, `sourceFeatureId` and `placement` the same way. An
 * annotation created through the factory could not resolve its source
 * feature, so it could not update when that feature changed.
 *
 * So the assertions here are about SHAPE, not about drawing: that the
 * model can find what it needs on a feature the factory actually
 * built. A test that only checked "a dimension was created" would have
 * passed throughout.
 *
 * Pure module, so it runs in Node.
 */

global.window = {
  crypto: { randomUUID: () => "factory-uuid" }
};

loadModule("measurement-core.js");

global.window.enggDrawingState = {
  polygonVertices: () => []
};
global.window.enggFeatureGeometry = {
  rectangleCorners: () => []
};

loadModule("dimension-model.js");
loadModule("annotation-model.js");
loadModule("drawing-state.js");

const state = global.window.enggDrawingState;
const dimensionModel = global.window.enggDimensionModel;
const annotationModel = global.window.enggAnnotationModel;
const factories = state.geometryFactories;

let pass = 0;
let fail = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(
      `  FAIL ${name}\n       expected ${JSON.stringify(expected)}` +
        `\n       actual   ${JSON.stringify(actual)}`
    );
  }
};

/*
 * A drawing holding one line, which is what a linear dimension of it
 * refers to.
 */
const line = {
  id: "line-1",
  name: "Line",
  type: "line",
  geometry: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
  style: {},
  metadata: {}
};

const document_ = (objects) => ({
  scale: { mmPerUnit: 1, unit: "mm" },
  objects
});

console.log("\nA dimension built by the factory is measurable");
const built = factories.dimension({
  dimensionType: "linear",
  refs: [
    { kind: "between", featureId: "line-1", anchor: "start" },
    { kind: "between", featureId: "line-1", anchor: "end" }
  ],
  placement: { x: 50, y: -20 }
});

const scene = document_([line, built]);

check("it is a dimension", built.type, "dimension");
check(
  "the model can find its measurement type",
  built.dimensionType,
  "linear"
);
check(
  "and its references",
  built.sourceRefs.length,
  2
);
check(
  "so it actually measures",
  dimensionModel.measurementFor(built, scene).value,
  100
);
/*
 * THE UNIT IS PART OF THE VALUE.
 *
 * This expected a bare "100.00", on the reasoning that the figure and its
 * unit were separate concerns. But a dimension with no unit is ambiguous with
 * every other quantity of the same magnitude on the sheet, and the unit is
 * not a decoration over the number - it is what makes the number mean one
 * particular thing. "100 mm" and "100 N" are different claims, and printing
 * only the figure asks the reader to guess which one is on the sheet.
 */
check(
  "and reads out with its unit, always",
  dimensionModel.formatMeasurement(built, scene),
  "100.00 mm"
);

check(
  "and never as a bare figure",
  String(dimensionModel.formatMeasurement(built, scene))
    .trim()
    .match(/^[\d.]+$/),
  null,
);

console.log("\nIt follows the geometry it refers to");
line.geometry.end = { x: 140, y: 0 };
check(
  "a longer line gives a longer dimension",
  dimensionModel.measurementFor(built, scene).value,
  140
);

console.log("\nIt has somewhere to be drawn");
check(
  "the placement survives the factory",
  built.placement,
  { x: 50, y: -20 }
);
check(
  "so the model can work out its graphics",
  typeof dimensionModel.graphicsFor(built, scene),
  "object"
);

console.log("\nAn annotation built by the factory can find its feature");
const force = {
  id: "force-1",
  name: "Point Force",
  type: "force",
  geometry: {
    start: { x: 0, y: 0 },
    end: { x: 0, y: -30 },
    position: { x: 0, y: 0 },
    magnitude: 250,
    angle: -90,
    unit: "N"
  },
  style: {},
  metadata: {}
};

const label = factories.annotation({
  kind: "force-value",
  sourceFeatureId: "force-1",
  position: { x: 5, y: -35 },
  leader: { enabled: true }
});

const labelled = document_([force, label]);

check("it is an annotation", label.type, "annotation");
check(
  "the model can find its source feature",
  label.sourceFeatureId,
  "force-1"
);
check(
  "and says what that feature says",
  annotationModel.textFor(label, labelled),
  "F = 250.0 N"
);

console.log("\nAnd keeps updating from it");
force.geometry.magnitude = 300;
check(
  "a changed force changes the label",
  annotationModel.textFor(label, labelled),
  "F = 300.0 N"
);

console.log("\nZoom is a view, not a measurement");

/*
 * Zoom must never change what a dimension SAYS.
 *
 * A dimension that read 100 mm at 100% and 200 mm at 200% would be
 * reporting screen size rather than geometry - the failure this guards
 * against is a dimension whose value or graphics are ever derived from
 * pixels. The model works in world units and is handed no zoom at all,
 * so what is asserted here is that a document carrying a different zoom
 * factor produces identical output.
 */
const atZoom = (zoom) => {
  const zoomed = {
    ...scene,
    camera: { zoom, panX: 0, panY: 0 }
  };

  return {
    value: dimensionModel.measurementFor(built, zoomed).value,
    text: dimensionModel.formatMeasurement(built, zoomed),
    graphics: dimensionModel.graphicsFor(built, zoomed)
  };
};

const normal = atZoom(1);
const doubled = atZoom(2);
const halved = atZoom(0.5);

check("the value is the same at 200%", doubled.value, normal.value);
check("and the same at 50%", halved.value, normal.value);
check("and so is the text", doubled.text, normal.text);
check(
  "and the dimension line is the same world-space pair",
  doubled.graphics.line,
  normal.graphics.line
);
check(
  "including where its text sits",
  doubled.graphics.textFrame,
  normal.graphics.textFrame
);

console.log("\nAnd pan is only a view too");
check(
  "panning leaves the measurement alone",
  dimensionModel.measurementFor(
    built,
    { ...scene, camera: { zoom: 2, panX: 40, panY: -25 } }
  ).value,
  normal.value
);

console.log("\nThe link and the placement stay separate facts");
check(
  "the label is where it was put",
  label.placement,
  { x: 5, y: -35 }
);
check(
  "and begins under automatic placement, not the student's",
  label.placementMode,
  "auto"
);

/*
 * Moving it is what makes the position the student's - and it is the
 * move, not the creation, that must not disturb the source link.
 */
annotationModel.moveAnnotation(label, { x: 300, y: 150 });

check(
  "a move takes charge of the position",
  label.placementMode,
  "manual"
);
check(
  "the label goes where it was moved",
  label.placement,
  { x: 300, y: 150 }
);
check(
  "and is still the same label on the same feature",
  label.sourceFeatureId,
  "force-1"
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
