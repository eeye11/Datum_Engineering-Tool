
const { JSDOM } = require("jsdom");

const path = require("path");

const { loadModule, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
/*
 * ========================================================
 * CAN ONE FORCE HAVE ITS MAGNITUDE BOX AND ANOTHER NOT?
 * ========================================================
 *
 * A beam diagram with twenty forces is unreadable with twenty magnitude boxes
 * on it, and turning the whole class off to cope means also losing the three
 * that mattered. So there are two switches, and the relationship between them
 * is the whole design:
 *
 *   THE GLOBAL ONE asks whether magnitudes are wanted on this sheet at all.
 *   THE PER-FEATURE ONE asks whether THIS feature's box is wanted, on a sheet
 *   where they are.
 *
 * The per-feature switch may only ever narrow the global one. That is the part
 * worth testing, because both directions of the obvious mistake are available:
 *
 *   - If the feature's choice were IGNORED, the individual toggles would be
 *     decoration and the student would turn one off and watch nothing happen.
 *   - If the feature's choice were ANDed with the global one, the student
 *     could switch magnitudes on globally, turn one force off, turn magnitudes
 *     off and on again, and find their individual choice silently forgotten.
 *
 * The second is the subtler one, and it is why the preference lives on the
 * feature rather than being derived from the global switch every frame.
 *
 * The engineering rule underneath all of it: none of this touches the force.
 * Showing a box and hiding a box are both presentation.
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
    console.log(
      `  FAIL ${name}${detail ? `\n       ${detail}` : ""}`,
    );
  }
};

const dom = new JSDOM(
  '<!doctype html><html><body><div id="canvas"></div></body></html>',
  { pretendToBeVisual: true },
);

global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;

for (const name of [
  "measurement-core.js",
  "quantities.js",
  "dimension-model.js",
  "annotation-model.js",
]) {
  loadModule(name);
}

const model = global.window.enggAnnotationModel;

const force = (extra = {}, id = "force-1") => ({
  id,
  type: "force",
  name: `Point Force ${id}`,
  geometry: {
    start: { x: 100, y: 100 },
    end: { x: 160, y: 100 },
    magnitude: 100,
    angle: 0,
  },
  style: { stroke: "#000000", lineWidth: 1 },
  ...extra,
});

const scene = (objects, display = {}) => ({
  objects,
  display: { showMagnitudes: true, showUnits: true, ...display },
  scale: { mmPerUnit: 1, unit: "mm" },
  selection: {
    selectedObjectIds: [],
    boxSelectionIds: [],
    hoveredObjectId: null,
  },
  interaction: { phase: "idle", preview: null, previewObjects: [] },
  camera: { zoom: 1, panX: 0, panY: 0 },
  styleDefaults: { stroke: "#000000", lineWidth: 0.5 },
  grid: { visible: false, spacing: 10 },
  snap: { enabled: false },
});

const boxOf = (object, display) =>
  model.derivedAnnotation(object, scene([object], display));

console.log("\n  a force with no opinion follows the sheet\n");

check(
  "a force with nothing said about it has a box",
  Boolean(boxOf(force())),
  "the default is that magnitudes are shown",
);

check(
  "with magnitudes off globally it has none",
  boxOf(force(), { showMagnitudes: false }) === null,
);

console.log("\n  and a force that has said something\n");

const optedOut = force({
  annotationDisplay: { showMagnitude: false },
});

const optedIn = force(
  { annotationDisplay: { showMagnitude: true } },
  "force-2",
);

check(
  "a force switched off has no box even though the sheet shows magnitudes",
  boxOf(optedOut) === null,
  "the per-feature switch is not being read at all",
);

check(
  "a force switched on has a box",
  Boolean(boxOf(optedIn)),
);

check(
  "and the two are distinguishable on the same sheet",
  boxOf(force({ annotationDisplay: { showMagnitude: false } })) === null &&
    Boolean(boxOf(force({}, "force-9"))),
  "every force is behaving identically regardless of its own setting",
);

console.log("\n  THE GLOBAL SWITCH STILL WINS\n");

check(
  "a force that asked to be shown is hidden when the sheet says no",
  boxOf(optedIn, { showMagnitudes: false }) === null,
  "a per-feature preference is overriding the sheet, which inverts the intent",
);

check(
  "a force that asked to be hidden stays hidden when the sheet says yes",
  boxOf(optedOut, { showMagnitudes: true }) === null,
);

console.log("\n  AND THE INDIVIDUAL CHOICE SURVIVES THE GLOBAL ONE\n");

/*
 * The round trip. Magnitudes off, then on again. A feature that had switched
 * itself off must still be off - otherwise every individual choice the student
 * made is lost the moment they use the sheet-wide control, and the per-feature
 * toggles are only meaningful until the next time they are not used.
 */
check(
  "an individual opt-out survives magnitudes being turned off and on again",
  boxOf(optedOut, { showMagnitudes: false }) === null &&
    boxOf(optedOut, { showMagnitudes: true }) === null,
  "the preference is being recomputed from the global switch instead of stored",
);

check(
  "an individual opt-in is likewise unaffected by the round trip",
  Boolean(boxOf(optedIn, { showMagnitudes: false }) === null) &&
    Boolean(boxOf(optedIn, { showMagnitudes: true })),
  "the round trip lost a preference the student had set",
);

console.log("\n  THE PREFERENCE IS READ DEFENSIVELY\n");

check(
  "a feature with no annotationDisplay holder at all is fine",
  Boolean(boxOf(force())),
  "an older document without the field must not break the panel",
);

check(
  "an empty holder means no opinion",
  Boolean(boxOf(force({ annotationDisplay: {} }))),
  "an empty holder is being read as an opt-out",
);

check(
  "an explicit null means no opinion",
  Boolean(
    boxOf(
      force({
        annotationDisplay: { showMagnitude: null },
      }),
    ),
  ),
  "null is being read as an opt-out",
);

check(
  "an explicit undefined means no opinion",
  Boolean(
    boxOf(
      force({
        annotationDisplay: { showMagnitude: undefined },
      }),
    ),
  ),
);

/*
 * A toggle read from a DOM checkbox can arrive as a string. Treating "false"
 * as truthy is how a switch ends up permanently on with no way to explain it.
 */
check(
  'the string "false" reads as off, not on',
  boxOf(
    force({
      annotationDisplay: { showMagnitude: "false" },
    }),
  ) === null,
  'a preference of "false" is being read as true',
);

check(
  'the string "true" reads as on',
  Boolean(
    boxOf(
      force({
        annotationDisplay: { showMagnitude: "true" },
      }),
    ),
  ),
);

console.log("\n  AND NONE OF IT TOUCHES THE FORCE\n");

const untouched = force(
  { annotationDisplay: { showMagnitude: false } },
);

check(
  "switching a box off does not move the force",
  untouched.geometry.start.x === 100 &&
    untouched.geometry.end.x === 160,
  "an annotation setting has leaked into the feature's geometry",
);

check(
  "and does not change its magnitude",
  untouched.geometry.magnitude === 100,
  "an annotation setting has been written into the engineering value",
);

check(
  "and does not change its direction",
  untouched.geometry.angle === 0,
);

console.log("\n  the predicate is available to the panel\n");

check(
  "the panel can ask the same question the renderer asked",
  model.magnitudeShownFor(force()) === true &&
    model.magnitudeShownFor(optedOut) === false &&
    model.magnitudeShownFor(
      optedIn,
      scene([optedIn], { showMagnitudes: false }),
    ) === false,
  "the panel and the renderer would disagree about whether a box is shown",
);

console.log(
  `\n${pass} passed, ${fail} failed`,
);

if (fail > 0) {
  process.exitCode = 1;
}
