
const { JSDOM } = require("jsdom");

const path = require("path");
const fs = require("fs");

const { controllerSource, loadModule, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
/*
 * ========================================================
 * A MAGNITUDE ANNOTATION: MAGNITUDE + UNIT, AND NOTHING ELSE
 * ========================================================
 *
 * The regression matrix the magnitude-annotation specification asks
 * for, stated as the acceptance conditions rather than as a restatement
 * of the implementation:
 *
 *   - a force annotation states its MAGNITUDE and its UNIT, and never
 *     an angle - the arrow already communicates direction, and a number
 *     beside it can only ever disagree with the arrow if one is edited
 *     without the other;
 *   - the unit is part of the quantity and is always printed; there is
 *     no Show Unit control, globally or per feature;
 *   - the annotation is a drawing-space object: its TEXT is derived from
 *     its source every frame, and its PLACE is the student's own, stored
 *     so that a magnitude edit moves the number and not the box;
 *   - a manual placement survives a source change, a hide/show, and a
 *     round trip through JSON.
 *
 * Run against the annotation model - the one place that decides what the
 * text says and where the box sits - so a change anywhere else cannot
 * hide a failure here.
 */


const projectRoot = path.join(__dirname, "..");
const dir = sourceDir();

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

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
});

global.window = dom.window;
global.document = dom.window.document;

loadModule("measurement-core.js");
loadModule("quantities.js");
loadModule("annotation-model.js");

const model = global.window.enggAnnotationModel;

const scene = (objects, display = {}) => ({
  objects,
  display: { showMagnitudes: true, showUnits: true, ...display },
});

/*
 * WHAT A NUMBER-AND-ANGLE ANNOTATION WOULD LOOK LIKE.
 *
 * Any angle the system might append - a degree sign, the word "deg", a
 * Greek theta, an at-sign magnitude/direction form, or a sense word -
 * has to be caught, because a regression could reintroduce any one of
 * them and the others would read as clean.
 */
const ANGLE_MARKERS = /°|θ|\bdeg\b|\brad\b|@|\bCW\b|\bCCW\b|clockwise|counter.?clockwise/i;

const read = (type, kind, geometry, extra = {}) => {
  const object = { id: "src-1", type, geometry };
  const annotation = {
    id: "ann-1",
    annotationKind: kind,
    textMode: "auto",
    sourceFeatureId: "src-1",
    ...extra,
  };

  return {
    annotation,
    object,
    text: model.textFor(annotation, scene([object])),
  };
};

console.log("\n  MAGNITUDE ONLY - AN ANGLE IS NEVER APPENDED\n");

const matrix = [
  [
    "Point Force",
    "force",
    "force-value",
    { start: { x: 0, y: 0 }, end: { x: 60, y: 0 }, magnitude: 100, angle: 30, direction: 30 },
    /100/,
  ],
  [
    "Distributed Load",
    "load",
    "load-value",
    { start: { x: 0, y: 0 }, end: { x: 60, y: 0 }, intensity: 5, angle: 90, direction: 90 },
    /5/,
  ],
  [
    "Applied Moment",
    "moment",
    "moment-value",
    { magnitude: 25, angle: 45, clockwise: true },
    /25/,
  ],
  [
    "Resultant",
    "resultant",
    "resultant-value",
    /* The value is the one the STUDENT states; the app never works it out. */
    { magnitude: 150, angle: 20, direction: 20, statedValue: "150" },
    /150/,
  ],
];

for (const [label, type, kind, geometry, magnitudePattern] of matrix) {
  const { text } = read(type, kind, geometry);

  check(
    `${label} produces an annotation at all`,
    typeof text === "string" && text.length > 0,
    `got ${JSON.stringify(text)}`,
  );

  check(
    `${label} states no angle`,
    !ANGLE_MARKERS.test(String(text)),
    `${label}: ${JSON.stringify(text)}`,
  );

  check(
    `${label} states its magnitude`,
    magnitudePattern.test(String(text)),
    `${label}: ${JSON.stringify(text)}`,
  );
}

console.log("\n  AND THE UNIT IS ALWAYS THERE\n");

check(
  "a point force reads as a magnitude with newtons",
  /100(\.0+)?\s*N/.test(read("force", "force-value", { magnitude: 100, angle: 30 }).text),
  JSON.stringify(read("force", "force-value", { magnitude: 100, angle: 30 }).text),
);

check(
  "a distributed load reads as an intensity with a length unit",
  /5(\.0+)?\s*kN\/m/.test(
    read("load", "load-value", { intensity: 5, direction: 90 }).text,
  ),
  JSON.stringify(read("load", "load-value", { intensity: 5, direction: 90 }).text),
);

check(
  "a moment reads in newton-metres",
  /25(\.0+)?\s*N·m/.test(
    read("moment", "moment-value", { magnitude: 25, angle: 45, clockwise: true }).text,
  ),
  JSON.stringify(
    read("moment", "moment-value", { magnitude: 25, angle: 45, clockwise: true }).text,
  ),
);

/*
 * THE UNIT IS NOT A CHOICE. An explicit `showUnits: false` - the field a
 * drawing saved before the control was removed still carries - must not
 * be able to strip the unit off, because "100" and "100 N" are not the
 * same statement.
 */
{
  const withoutUnits = read(
    "force",
    "force-value",
    { magnitude: 100, angle: 30 },
    {},
  );

  const withFlagOff = model.textFor(
    { id: "a", annotationKind: "force-value", textMode: "auto", sourceFeatureId: "src-1" },
    scene([{ id: "src-1", type: "force", geometry: { magnitude: 100, angle: 30 } }], {
      showUnits: false,
    }),
  );

  check(
    "an explicit showUnits:false cannot strip the unit",
    /\bN\b/.test(String(withFlagOff)),
    `read: ${JSON.stringify(withFlagOff)}`,
  );

  check(
    "and the number is unchanged by the flag",
    /100(\.0+)?/.test(String(withoutUnits.text)) &&
      /100(\.0+)?/.test(String(withFlagOff)),
    `${JSON.stringify(withoutUnits.text)} vs ${JSON.stringify(withFlagOff)}`,
  );
}

console.log("\n  A VARYING LOAD STATES w1 AND w2, WITH NO ANGLE\n");

{
  const object = {
    id: "src-1",
    type: "varying-load",
    geometry: {
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
      points: [
        { x: 0, y: 0, magnitude: 5 },
        { x: 100, y: 0, magnitude: 10 },
      ],
    },
  };

  const readPoint = (index) =>
    model.textFor(
      {
        id: `a${index}`,
        annotationKind: "load-profile-value",
        textMode: "auto",
        sourceFeatureId: "src-1",
        anchorRef: { index },
      },
      scene([object]),
    );

  const w1 = readPoint(0);
  const w2 = readPoint(1);

  /*
   * A load intensity is stated in kN/m, which is the unit the
   * application's quantity system uses for a distributed load - the
   * point of the check is that a UNIT is present and it is the right
   * KIND of unit, not that a particular prefix was chosen.
   */
  check(
    "w1 states its intensity with a per-metre unit",
    /5(\.0+)?\s*kN\/m/.test(String(w1)),
    JSON.stringify(w1),
  );
  check(
    "w2 states its intensity with a per-metre unit",
    /10(\.0+)?\s*kN\/m/.test(String(w2)),
    JSON.stringify(w2),
  );
  check("w1 carries no angle", !ANGLE_MARKERS.test(String(w1)), JSON.stringify(w1));
  check("w2 carries no angle", !ANGLE_MARKERS.test(String(w2)), JSON.stringify(w2));
}

console.log("\n  FORCE COMPONENTS STATE Fx AND Fy, WITH NO ANGLE\n");

{
  /* Fx and Fy as the student stated them - the app does not resolve them. */
  const { text } = read("force", "force-components", {
    magnitude: 100,
    angle: 0,
    statedFx: "100",
    statedFy: "0",
  });

  check(
    "the components are both stated",
    /Fx/.test(String(text)) && /Fy/.test(String(text)),
    JSON.stringify(text),
  );

  check(
    "each carries its own unit",
    (String(text).match(/\bN\b/g) || []).length === 2,
    JSON.stringify(text),
  );

  check(
    "and no angle is appended",
    !ANGLE_MARKERS.test(String(text)),
    JSON.stringify(text),
  );
}

console.log("\n  THE BOX IS INDEPENDENT OF THE FORCE\n");

/*
 * THE PLACE IS STORED, THE TEXT IS DERIVED.
 *
 * This is the whole design: the magnitude box is a drawing-space
 * annotation whose text comes from the force on every frame, but whose
 * position is the student's own. Moving the box must never move the
 * force; editing the force must never move the box.
 */
{
  const geometry = {
    start: { x: 100, y: 100 },
    end: { x: 160, y: 100 },
    magnitude: 100,
    angle: 0,
    magnitudeOffset: { x: 30, y: -20 },
  };

  const object = { id: "force-1", type: "force", name: "Point Force 1", geometry };
  const plain = model.derivedAnnotation(
    { id: "force-1", type: "force", geometry: { ...geometry, magnitudeOffset: null } },
    scene([{ id: "force-1", type: "force", geometry: { ...geometry, magnitudeOffset: null } }]),
  );

  const moved = model.derivedAnnotation(object, scene([object]));

  check(
    "the moved box is drawn where it was put",
    moved.placement.x === plain.placement.x + 30 &&
      moved.placement.y === plain.placement.y - 20,
    `moved to ${JSON.stringify(moved.placement)}, natural ${JSON.stringify(plain.placement)}`,
  );

  check(
    "and is marked as moved, so renderer and pick agree",
    moved.moved === true,
  );

  check(
    "moving the box did not move the force",
    object.geometry.start.x === 100 && object.geometry.start.y === 100,
    `force is at ${JSON.stringify(object.geometry.start)}`,
  );

  check(
    "a moved box still states the force's magnitude",
    /100(\.0+)?/.test(String(model.textFor(moved, scene([object])))),
    JSON.stringify(model.textFor(moved, scene([object]))),
  );

  /*
   * AND EDITING THE FORCE MOVES THE NUMBER, AND RE-ANCHORS THE BOX.
   *
   * The box's stored position is an OFFSET from where it naturally falls, and
   * the force it describes is what that natural position is measured from. So
   * editing the magnitude keeps the student's offset but follows the new
   * endpoint: the box moves with the arrow it belongs to, and does not fall
   * back onto the application point.
   */
  const edited = {
    id: "force-1",
    type: "force",
    geometry: { ...geometry, magnitude: 250 },
  };

  const afterEdit = model.derivedAnnotation(edited, scene([edited]));

  check(
    "editing the magnitude updates a moved box",
    /250(\.0+)?/.test(String(model.textFor(afterEdit, scene([edited])))),
    JSON.stringify(model.textFor(afterEdit, scene([edited]))),
  );

  /*
   * THE OFFSET IS PRESERVED, measured against the box's own natural anchor -
   * which is what "the student's place is kept" means once the arrow the box
   * describes has itself moved.
   */
  const plainEdited = model.derivedAnnotation(
    { id: "force-1", type: "force", geometry: { ...geometry, magnitude: 250, magnitudeOffset: null } },
    scene([
      { id: "force-1", type: "force", geometry: { ...geometry, magnitude: 250, magnitudeOffset: null } },
    ]),
  );

  check(
    "and the box keeps its own offset rather than falling onto the new endpoint",
    Math.abs(afterEdit.placement.x - (plainEdited.placement.x + 30)) < 1e-6 &&
      Math.abs(afterEdit.placement.y - (plainEdited.placement.y - 20)) < 1e-6,
    `box at ${JSON.stringify(afterEdit.placement)}, natural ${JSON.stringify(plainEdited.placement)}`,
  );

  check(
    "so it did not snap back onto the application point",
    afterEdit.moved === true,
    `moved = ${afterEdit.moved}`,
  );
}

console.log("\n  PLACEMENT PERSISTS ACROSS A SAVE AND RELOAD\n");

{
  const geometry = {
    start: { x: 100, y: 100 },
    end: { x: 160, y: 100 },
    magnitude: 100,
    angle: 0,
    magnitudeOffset: { x: 50, y: -35 },
  };

  const object = { id: "force-1", type: "force", geometry };

  /* The round trip a saved document makes: through JSON. */
  const reloaded = JSON.parse(JSON.stringify(object));

  const before = model.derivedAnnotation(object, scene([object]));
  const after = model.derivedAnnotation(reloaded, scene([reloaded]));

  check(
    "a moved box returns to its custom location",
    after.placement.x === before.placement.x &&
      after.placement.y === before.placement.y,
    `${JSON.stringify(before.placement)} vs ${JSON.stringify(after.placement)}`,
  );

  check(
    "and it is still marked as moved",
    after.moved === true,
  );
}

console.log("\n  NO SHOW UNIT CONTROL ANYWHERE\n");

/*
 * The control is gone from the model AND from the application source.
 * The model is checked because that is where the setting could hide; the
 * drawing controller is checked because a control is offered there.
 */
check(
  "the annotation model offers no unit toggle",
  !Object.keys(model.KINDS).some((kind) => /show.?unit/i.test(kind)),
  Object.keys(model.KINDS).join(", "),
);

{
  const code = controllerSource();

  check(
    "and the drawing controller builds no Show Unit control",
    !code.includes('label: "Show Unit"') &&
      !code.includes("data-feature-show-unit"),
    "a Show Unit control is still being built in a feature panel",
  );

  check(
    "nor a global one",
    !/id=["']drawingUnitsToggle["']/.test(code) &&
      !/key:\s*["']showUnits["']/.test(code),
    "a global units toggle is still in the display controls",
  );

  check(
    "nor is a dead handler left behind",
    !/data-feature-show-unit[\s\S]{0,400}addEventListener/.test(code),
  );
}

console.log(`\n${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
