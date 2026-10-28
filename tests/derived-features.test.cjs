
const { JSDOM } = require("jsdom");

const path = require("path");

const { controllerSource, loadModule, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
/*
 * ========================================================
 * DO COMPONENTS AND RESULTANTS FOLLOW THEIR SOURCES?
 * ========================================================
 *
 * Two reports:
 *
 *   1. Force Components draws a REPLICA of the parent force.
 *   2. Neither Components nor Resultant updates when the source changes.
 *
 * ========================================================
 * THE REPLICA
 * ========================================================
 *
 * A Components object stores the whole vector on itself - `original`, and
 * the legacy `start`/`end` - because its renderer and hit test read them,
 * and because it IS a reading of the source. Storing it is defensible.
 *
 * DRAWING it is not. The renderer's test was `showOriginal !== false`,
 * which draws the original whenever the field is absent - and nothing ever
 * writes that field, so it was absent on every Components object ever
 * created. The feature therefore drew the force AND its two components:
 * the student saw their own force twice, and the tool read as a copy of it
 * with a triangle drawn over the top.
 *
 * The Features panel had the same wrong default, and the two cancelled out
 * to "always on": unticking the checkbox set the field to `false`, and
 * `false !== false` is false, so nothing appeared to happen.
 *
 * The default is now OFF, and only an explicit `true` turns it on. Showing
 * the decomposed vector alongside its components is genuinely useful for
 * checking the work, so it stays available - it just is not the default.
 *
 * ========================================================
 * THE UPDATING
 * ========================================================
 *
 * Every individual function works: `refreshAnalysis`, `deriveResultant`
 * and `deriveForceComponents` all produce correct values when called
 * directly. What was missing was the COMMIT reaching them.
 *
 * `analysis-dependencies` registers itself with the state module at the
 * end of its own load, so `drawing-state` must already be loaded. Loaded
 * the other way round the registration finds nothing, the state module
 * never learns where the registry is, and `commitDrawingChange` silently
 * refreshes nothing.
 *
 * That is a failure with no error, no empty value and no stack: every
 * function passes when called directly, and the product still stops
 * following its source. So these go through the COMMIT - the only path a
 * student's edit takes - rather than calling the refresh themselves, which
 * would prove the function works rather than that the product updates.
 */


const projectRoot = path.join(__dirname, "..");

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

const drawingDir = sourceDir();

/*
 * LOAD ORDER IS PART OF THE SUBJECT, NOT A DETAIL OF THE HARNESS.
 * `drawing-state` before `analysis-dependencies`, because the latter
 * registers itself into the former as it loads. Get it backwards and the
 * registry is never attached - silently.
 */
function loadModules() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    pretendToBeVisual: true,
  });

  global.window = dom.window;
  global.document = dom.window.document;
  global.window.crypto = {
    randomUUID: () => "test-uuid",
  };
  global.requestAnimationFrame = cb => setTimeout(cb, 0);
  global.window.requestAnimationFrame = global.requestAnimationFrame;

  for (const name of [
    "diagram-equations.js",
    "body-frames.js",
    "load-profile.js",
    "feature-geometry.js",
    "drawing-state.js",
    "analysis-dependencies.js",
    "renderer.js",
  ]) {
    loadModule(name);
  }

  for (const name of [
    "enggDrawingState",
    "enggDrawingRenderer",
    "enggDiagramEquations",
    "enggAnalysisDependencies",
    /*
     * The renderer reaches the Statics profile by its bare name, which only
     * resolves because in a browser every script shares one scope. Under
     * `require` it does not, so the published modules are mirrored onto the
     * global object - without this the renderer throws on its first feature.
     */
    "enggLoadProfile",
    "enggFeatureGeometry",
    "enggBodyFrames",
  ]) {
    if (global.window[name]) {
      global[name] = global.window[name];
    }
  }

  return dom;
}

loadModules();

const D = global.window.enggAnalysisDependencies;
const S = global.window.enggDrawingState;

const near = (a, b, tolerance = 1e-6) =>
  Math.abs(a - b) < tolerance;

function stateWith(objects) {
  return {
    objects,
    selection: {
      selectedObjectIds: [],
      boxSelectionIds: [],
      hoveredObjectId: null,
    },
    interaction: {},
    history: { past: [], future: [] },
    camera: { zoom: 1 },
  };
}

/*
 * A force of the given magnitude and angle, tail at the origin.
 *
 * THE ID IS AN ARGUMENT rather than part of a geometry-override object.
 * It was a single `overrides` spread into `geometry`, so
 * `makeForce({ id: "a" })` set a field named `id` INSIDE the geometry and
 * left the force's real id as "force-1" - and a resultant looking for two
 * sources found one, or none, and reported no result. A helper that quietly
 * ignores its own arguments is worse than no helper.
 */
function makeForce(id, magnitude, angle) {
  const radians = (angle * Math.PI) / 180;

  return {
    id,
    type: "force",
    name: id,
    geometry: {
      start: { x: 0, y: 0 },
      position: { x: 0, y: 0 },
      magnitude,
      angle,
      unit: "N",
      end: {
        x: Math.cos(radians) * magnitude,
        y: Math.sin(radians) * magnitude,
      },
    },
    engineering: { discipline: "statics" },
  };
}

const makeComponents = sourceId => ({
  id: "comp-1",
  type: "force-components",
  name: "Force Components 1",
  geometry: {},
  engineering: {
    discipline: "statics",
    analysisKind: "force-components",
    sourceFeatureIds: [sourceId],
  },
});

const makeResultant = sourceIds => ({
  id: "res-1",
  type: "resultant",
  name: "Resultant 1",
  geometry: {},
  engineering: {
    discipline: "statics",
    analysisKind: "resultant",
    sourceFeatureIds: sourceIds,
  },
});

console.log("\n  the components are derived from the force\n");

{
  const force = makeForce("force-1", 100, 30);
  const comps = makeComponents("force-1");

  D.refreshAnalysis(comps, stateWith([force, comps]));

  check(
    "Fx is the horizontal projection",
    near(
      comps.geometry.horizontal.end.x,
      100 * Math.cos(Math.PI / 6),
    ) &&
      near(
        comps.geometry.horizontal.end.y,
        comps.geometry.horizontal.start.y,
      ),
    `Fx end: ${JSON.stringify(comps.geometry.horizontal.end)}`,
  );

  check(
    "Fy is the vertical projection",
    near(
      comps.geometry.vertical.end.y,
      100 * Math.sin(Math.PI / 6),
    ),
    `Fy end: ${JSON.stringify(comps.geometry.vertical.end)}`,
  );

  check(
    "and they share one origin, which is what makes it a decomposition",
    near(
      comps.geometry.horizontal.start.x,
      comps.geometry.vertical.start.x,
    ) &&
      near(
        comps.geometry.horizontal.start.y,
        comps.geometry.vertical.start.y,
      ),
  );
}

console.log("\n  and the replica is not on by default\n");

{
  const force = makeForce("force-1", 100, 30);
  const comps = makeComponents("force-1");

  D.refreshAnalysis(comps, stateWith([force, comps]));

  check(
    "the original vector is not switched on",
    comps.geometry.showOriginal !== true,
    `showOriginal: ${comps.geometry.showOriginal} - an absent field must mean OFF`,
  );
}

console.log("\n  a resultant sums its sources\n");

{
  const a = makeForce("a", 100, 0);
  const b = makeForce("b", 100, 90);
  const resultant = makeResultant(["a", "b"]);

  D.refreshAnalysis(
    resultant,
    stateWith([a, b, resultant]),
  );

  check(
    "the magnitude is the vector sum, not the sum of magnitudes",
    near(resultant.geometry.magnitude, Math.hypot(100, 100)),
    `magnitude: ${resultant.geometry.magnitude}`,
  );

  check(
    "the direction is that of the sum",
    near(resultant.geometry.angle, 45),
    `angle: ${resultant.geometry.angle}`,
  );
}

console.log(
  "\n  and they follow the source - THROUGH THE COMMIT\n",
);

/*
 * The commit, not the refresh function. `commitDrawingChange` refreshes
 * before it snapshots, so a student's edit is one call.
 */
{
  const force = makeForce("force-1", 100, 30);
  const comps = makeComponents("force-1");
  const resultant = makeResultant(["force-1"]);

  const state = stateWith([force, comps, resultant]);

  S.commitDrawingChange(state, S.snapshotDrawing(state));

  check(
    "a components object follows its force's magnitude",
    near(
      comps.geometry.horizontal.end.x,
      100 * Math.cos(Math.PI / 6),
    ),
    `Fx end x: ${comps.geometry.horizontal?.end?.x}`,
  );

  check(
    "a resultant follows it too",
    near(resultant.geometry.magnitude, 100),
    `resultant magnitude: ${resultant.geometry.magnitude}`,
  );

  /*
   * THE EDIT: a different force, as the panel writes it - through
   * `setForceVector`, which states the new value and turns the drawn arrow to
   * the new direction at the length it was drawn.
   */
  global.window.enggLoadProfile.setForceVector(force.geometry, 200, 90);

  S.commitDrawingChange(
    state,
    S.snapshotDrawing(state),
  );

  /*
   * VALUES AND DRAWING, EACH FROM ITS OWN SOURCE. The components STATE the
   * force's value (`forceX`/`forceY`) and are DRAWN as the projections of its
   * drawn arrow - which turned to 90 degrees at its drawn length, 100.
   */
  check(
    "it follows the magnitude",
    near(Math.hypot(comps.geometry.forceX, comps.geometry.forceY), 200),
    `value (${comps.geometry.forceX}, ${comps.geometry.forceY})`,
  );

  check(
    "it follows the direction",
    near(comps.geometry.forceY, 200) &&
      near(comps.geometry.vertical.end.y - comps.geometry.vertical.start.y, 100) &&
      near(comps.geometry.horizontal.end.x - comps.geometry.horizontal.start.x, 0),
    `value Fy ${comps.geometry.forceY}; drawn Fy ${comps.geometry.vertical.end.y - comps.geometry.vertical.start.y}`,
  );

  check(
    "and so does the resultant",
    near(resultant.geometry.magnitude, 200),
    `resultant magnitude: ${resultant.geometry.magnitude}`,
  );

  check(
    "with the resultant's direction following too",
    near(resultant.geometry.angle, 90),
    `resultant angle: ${resultant.geometry.angle}`,
  );
}

console.log(
  "\n  and when the force is dragged, not just retyped\n",
);

{
  const force = makeForce("force-1", 100, 30);
  const comps = makeComponents("force-1");

  const state = stateWith([force, comps]);

  S.commitDrawingChange(state, S.snapshotDrawing(state));

  check(
    "it starts at the force's application point",
    near(comps.geometry.origin.x, 0),
    `origin: ${JSON.stringify(comps.geometry.origin)}`,
  );

  /* A DRAG: the point moves and nothing else about the force changes. */
  /* A move translates the whole force - its drawn arrow with it. */
  force.geometry.end = {
    x: force.geometry.end.x + 40,
    y: force.geometry.end.y + 60,
  };
  force.geometry.start = { x: 40, y: 60 };
  force.geometry.position = { x: 40, y: 60 };

  S.commitDrawingChange(
    state,
    S.snapshotDrawing(state),
  );

  check(
    "the components move with it",
    near(comps.geometry.origin.x, 40) &&
      near(comps.geometry.origin.y, 60),
    `origin now: ${JSON.stringify(comps.geometry.origin)}`,
  );

  check(
    "and moving it did not change its magnitude",
    near(
      Math.hypot(
        comps.geometry.horizontal.end.x -
          comps.geometry.horizontal.start.x,
        comps.geometry.vertical.end.y -
          comps.geometry.vertical.start.y,
      ),
      100,
    ),
    "moving a force does not change how big it is",
  );
}

/*
 * ========================================================
 * THE REPLICA, CHECKED ON THE CANVAS
 * ========================================================
 *
 * The model stores the whole vector; whether it is DRAWN is only visible
 * by looking at the canvas. Two shafts when it is off, three when it is
 * explicitly asked for - because the point of the change is that it became
 * a choice rather than being removed.
 *
 * THE SAME WINDOW AS EVERYTHING ELSE. These modules close over the `window`
 * they were loaded against, and `require` caches by path, so creating a
 * second DOM and re-requiring gives back the first window's modules and an
 * empty second one. One window throughout.
 */
console.log("\n  and the canvas shows two shafts, not three\n");

{
  const canvas = global.document.createElement("div");

  global.document.body.appendChild(canvas);

  canvas.getBoundingClientRect = () => ({
    width: 900,
    height: 600,
    left: 0,
    top: 0,
    right: 900,
    bottom: 600,
  });

  const base = {
    selection: {
      selectedObjectIds: [],
      boxSelectionIds: [],
      hoveredObjectId: null,
    },
    interaction: {
      phase: "idle",
      preview: null,
      previewObjects: [],
    },
    camera: { zoom: 1, panX: 0, panY: 0 },
    styleDefaults: { stroke: "#000000", lineWidth: 0.5 },
    grid: { visible: false, spacing: 10 },
    snap: { enabled: false },
  };

  const source = makeForce("force-1", 100, 30);

  const components = {
    ...makeComponents("force-1"),
    style: { stroke: "#000000", lineWidth: 0.5 },
  };

  const shaftsWith = showOriginal => {
    D.refreshAnalysis(
      components,
      stateWith([source, components]),
    );

    global.enggDrawingRenderer.renderDrawing(
      {
        ...base,
        objects: [
          source,
          {
            ...components,
            geometry: { ...components.geometry, showOriginal },
          },
        ],
      },
      canvas,
    );

    const group = canvas.querySelector(
      '.drawing-feature[data-feature-id="comp-1"]',
    );

    return group
      /* The dashed parallelogram guides are construction, not shafts. */
      ? group.querySelectorAll("line:not([stroke-dasharray])").length
      : 0;
  };

  const off = shaftsWith(undefined);

  check(
    "a fresh components feature draws exactly two shafts",
    off === 2,
    `drew ${off} - a third would be a copy of the force it is decomposing`,
  );

  const on = shaftsWith(true);

  check(
    "and three when the original is explicitly asked for",
    on === 3,
    `drew ${on}`,
  );
}

/*
 * ========================================================
 * PARENTED, SO THE TREE CAN NEST IT
 * ========================================================
 *
 * The dependency list says what a Components object READS; `parentId` says
 * where it LIVES. Only the second one puts it in the Feature Tree - and the
 * tool was recording the first without the second, so a decomposition that
 * computed perfectly sat at the top of the sheet beside nothing instead of
 * under the force it describes.
 *
 * A resultant of SEVERAL forces has no single body, so it is parented to
 * the first of them: that is the force whose application point it is drawn
 * from, and therefore the one whose motion it follows.
 *
 * The two creation paths are checked at the SOURCE, because that is where
 * the parent is set and they are the only place it can be - the model has
 * no way to invent a parent the tool did not give it.
 */
console.log("\n  and the tool parents it to the force\n");

{
  const source = controllerSource();

  /* Comments stripped: they DESCRIBE this, which is the trap. */
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  const componentsPath = code.indexOf(
    "resolved =",
  );

  const resultantPath = code.indexOf("resultant =");

  const componentsAdds = code.indexOf(
    "addObject",
    componentsPath,
  );

  const resultantAdds = code.indexOf(
    "addObject",
    resultantPath,
  );

  check(
    "the components path sets a parent before it is added",
    /resolved\.parentId/.test(
      code.slice(componentsPath, componentsAdds),
    ),
    "a decomposition with no parent sits at the top of the sheet",
  );

  check(
    "the resultant path sets a parent before it is added",
    /resultant\.parentId/.test(
      code.slice(resultantPath, resultantAdds),
    ),
    "a resultant with no parent sits at the top of the sheet",
  );

  check(
    "the parent is the force's own, not a guess",
    /*
     * The components belong to the FORCE ITSELF (`force.id`) - or, as they
     * once did, to the force's own parent - never to a guessed neighbour.
     */
    /force\.(parentId|id)/.test(code.slice(componentsPath, componentsAdds)) &&
      /forces\[0\]\.parentId/.test(
        code.slice(resultantPath, resultantAdds),
      ),
    "taken from the force itself, so it follows when the force moves",
  );
}

console.log(`\n${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
