/*
 * ========================================================
 * IS EVERY FEATURE CLASSIFIED ONCE, AND IN ONE PLACE?
 * ========================================================
 *
 * The AFD/SFD/BMD diagrams were filed under GEOMETRY in the old Feature Tree.
 *
 * That was not a mislabelled heading. The classifier read
 * `engineering.discipline`, and the diagram factory was the one statics factory
 * that never set it - so the diagrams had no statics identity at all and every
 * reader of that field answered "geometry". Any fix that only relabelled the
 * heading would have left the model disagreeing with it, and the next new
 * statics feature would have been filed the same way.
 *
 * THE TREE IS GONE; THE FACT IS NOT. The legacy Feature Tree was removed when
 * the inspector's Features tab replaced it - so the classifier function this
 * file used to lift no longer exists, and a test that kept looking for it would
 * be guarding a deleted interface. What is still true, and still worth a check,
 * is the thing underneath: a feature's TYPE is its identity, its NAME says what
 * it is, and the Features schema classifies what it is given.
 *
 * So these read the real factories and the real schema, rather than a classifier
 * over them. The regression they prevent is unchanged: a feature that is not
 * distinguishable from the thing it happens to share an implementation with is
 * a feature no surface can describe correctly, whatever is doing the describing.
 */

const path = require("path");
const { locate } = require("./helpers/source-path.cjs");

let pass = 0;
let fail = 0;

const check = (name, ok, detail) => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ""}`);
  }
};

const src = (file) => require(locate(path.basename(file)));

const model = src("src/shared/model/drawing-state.js").default;
const featureTypes = src("src/shared/model/feature-types.js");
const schema = src("src/components/layout/panels/feature-schema.js");

const { drawingState } = src("features/workspace/editor-state.js");

/* Build a feature through the model's own factory. */
const make = (type, geometry) => model.createGeometryObject(type, geometry || {}, {});

const groupsOf = (object) => schema.groupsFor(object).map((group) => group.id);

console.log("\n  a feature's type is its identity\n");

check(
  "a Point Force is its own type, not a generic Line",
  make("force", { start: { x: 0, y: 0 }, end: { x: 10, y: 10 } }).type === "force",
);

check(
  "a Pin Support is its own type",
  make("pin-support", { position: { x: 0, y: 0 } }).type === "pin-support",
);

check(
  "an Arc is its own type",
  make("arc", { center: { x: 0, y: 0 }, radius: 5, startAngle: 0, endAngle: 1 }).type === "arc",
);

check(
  "a Regular Polygon is its own type",
  make("polygon", { center: { x: 0, y: 0 }, radius: 5, sides: 6, rotation: 0 }).type === "polygon",
);

console.log("\n  a feature is named for what it is\n");

const NAMES = {
  point: "Point",
  line: "Line",
  triangle: "Triangle",
  rectangle: "Rectangle",
  circle: "Circle",
  arc: "Arc",
  polygon: "Polygon",
  "freeform-polygon": "Freeform Polygon",
  "coordinate-system-2d": "2D Coordinate System",
  force: "Point Load",
  "pin-support": "Pin Support",
  "roller-support": "Roller Support",
  "fixed-support": "Fixed Support",
  "smooth-support": "Smooth Support",
  moment: "Applied Moment",
  load: "Distributed Load",
  "varying-load": "Varying Distributed Load",
  beam: "Beam",
  truss: "Truss",
  cable: "Cable",
  shaft: "Shaft",
  particle: "Particle",
  "rigid-body": "Rigid Body",
  dimension: "Dimension"
};

Object.entries(NAMES).forEach(([type, label]) => {
  const object = make(type, {});

  check(`a ${type} is called "${label}"`, object.name === label, `got: ${object.name}`);
});

console.log("\n  the Features schema classifies what it is given\n");

const line = make("line", { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } });
const point = make("point", { position: { x: 0, y: 0 } });
const circle = make("circle", { center: { x: 0, y: 0 }, radius: 5 });
const polygon = make("polygon", { center: { x: 0, y: 0 }, radius: 5, sides: 6 });
const arc = make("arc", { center: { x: 0, y: 0 }, radius: 5, startAngle: 0, endAngle: 1 });
const axes = make("coordinate-system-2d", { origin: { x: 0, y: 0 }, axisLength: 25 });
const force = make("force", { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } });
const support = make("pin-support", { position: { x: 0, y: 0 } });
const beam = make("beam", { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } });

check(
  "a Line offers Line and Appearance",
  groupsOf(line).includes("line") && groupsOf(line).includes("appearance"),
  groupsOf(line).join(", "),
);

check(
  "a Point offers Marker, not Line",
  groupsOf(point).includes("marker") && !groupsOf(point).includes("line"),
  groupsOf(point).join(", "),
);

check(
  "a Circle offers Fill and Appearance",
  groupsOf(circle).includes("fill") && groupsOf(circle).includes("appearance"),
  groupsOf(circle).join(", "),
);

check(
  "a Regular Polygon offers Shape",
  groupsOf(polygon).includes("shape"),
  groupsOf(polygon).join(", "),
);

check(
  "an Arc offers Line and no Fill",
  groupsOf(arc).includes("line") && !groupsOf(arc).includes("fill"),
  groupsOf(arc).join(", "),
);

check(
  "a Coordinate System offers Axes and Labels",
  groupsOf(axes).includes("axes") && groupsOf(axes).includes("labels"),
  groupsOf(axes).join(", "),
);

console.log("\n  no Geometry leaks into another category\n");

/*
 * A STATICS FEATURE IS NOT GIVEN GEOMETRY'S PANEL. This is the check the old
 * file's "nothing else has been swept into it" section was really making,
 * restated against the surface that now does the classifying.
 */
check(
  "a Point Force is not offered Marker, Shape or Fill",
  ["marker", "shape", "fill"].every((id) => !groupsOf(force).includes(id)),
  groupsOf(force).join(", "),
);

check(
  "a Circle is not offered Marker or Shape",
  ["marker", "shape"].every((id) => !groupsOf(circle).includes(id)),
  groupsOf(circle).join(", "),
);

check(
  "a Pin Support is not offered Line or Fill",
  ["line", "fill"].every((id) => !groupsOf(support).includes(id)),
  groupsOf(support).join(", "),
);

check(
  "a Beam is not offered Marker or Shape",
  ["marker", "shape"].every((id) => !groupsOf(beam).includes(id)),
  groupsOf(beam).join(", "),
);

console.log("\n  a support is a support, whatever it is attached to\n");

/*
 * A support is drawn along its parent body's centreline, so it reuses the
 * geometry system - but it is NOT a line and must never be presented as one.
 * This is the property the old "geometry and statics share the line
 * implementation, so this must be decided by discipline" check guarded.
 */
check(
  "the four support types are recognised as supports",
  ["pin-support", "roller-support", "fixed-support", "smooth-support"].every((type) =>
    featureTypes.isSupportType(type)
  ),
);

check("a Line is not a support", !featureTypes.isSupportType("line"));

check(
  "the three connection types are recognised as connections",
  ["pin-connection", "fixed-connection", "slider-connection"].every((type) =>
    featureTypes.isConnectionType(type)
  ),
);

check("a Beam is not a connection", !featureTypes.isConnectionType("beam"));

console.log("\n  the drawing holds what the factory made\n");

const before = model.snapshotDrawing(drawingState);
const storedLine = model.addObject(
  drawingState,
  make("line", { start: { x: 0, y: 0 }, end: { x: 5, y: 0 } })
);
const storedSupport = model.addObject(drawingState, make("pin-support", { position: { x: 0, y: 0 } }));

check(
  "both features are on the sheet",
  drawingState.objects.includes(storedLine) && drawingState.objects.includes(storedSupport),
);

check(
  "and they are distinct objects, not one shared shape",
  storedLine.id !== storedSupport.id && storedLine.type !== storedSupport.type,
);

/*
 * The sheet is put back as it was found, so this file leaves no objects behind
 * for whatever runs next in the same process.
 */
model.restoreObjects(drawingState, before.objects);

check(
  "the sheet is left as it was found",
  !drawingState.objects.includes(storedLine) && !drawingState.objects.includes(storedSupport),
);

console.log(`\n${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
