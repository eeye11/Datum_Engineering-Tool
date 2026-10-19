/*
 * ========================================================
 * RUNNING THE RENDERER OUTSIDE A BROWSER
 * ========================================================
 *
 * In a browser every `<script>` shares one global scope, so a module can refer
 * to another by its bare name - `enggLoadProfile.drawnForceEnd(...)` - and find
 * it, because the file that published it onto `window` ran in the same scope.
 * That is how the renderer reaches the Statics profile, the body frames, the
 * feature geometry and the drawing state.
 *
 * UNDER `require` THERE IS NO SHARED SCOPE. Each module is its own function
 * with its own closure, so a bare `enggLoadProfile` is a ReferenceError the
 * first time a feature is drawn - and it fails as "not defined" rather than
 * as "the drawing is wrong", which is a misleading way to fail.
 *
 * So the published names are mirrored onto the global object before anything
 * is drawn. That is a HARNESS arrangement, not a change to the application:
 * the browser needs none of it, and adding it to the renderer itself would
 * have papered over a real coupling.
 *
 * Used by every test that renders, so the list of modules the renderer
 * reaches for is written down once. Adding a module the renderer depends on
 * means adding it here, and the failure it prevents is immediate and obvious.
 */

const MODULES = [
  "enggDrawingState",
  "enggDrawingRenderer",
  "enggDiagramEquations",
  "enggLoadProfile",
  "enggFeatureGeometry",
  "enggBodyFrames",
  "enggDimensionModel",
  "enggQuantities",
  "enggMeasurement",
  "enggAnnotationModel",
  "enggAnalysisDependencies",
];

/*
 * The scripts that must be required BEFORE the mirroring, in dependency order.
 * A module that reaches for another at load time rather than at call time will
 * not find it, which is the same ordering problem the page's script tags solve.
 */
const SCRIPTS = [
  "measurement-core.js",
  "quantities.js",
  "dimension-model.js",
  "annotation-model.js",
  "diagram-equations.js",
  "load-profile.js",
  "body-frames.js",
  "feature-geometry.js",
  "drawing-state.js",
  "renderer.js",
];

/**
 * Build a document with the application modules loaded into it.
 *
 * @param {string} projectRoot  repository root, holding the js/ source tree
 * @param {object} jsdom        the JSDOM class
 * @param {object} require      the caller's require, so paths resolve from it
 */
function createHarness(projectRoot, jsdom, require) {
  const dom = new jsdom(
    '<!doctype html><html><body><div id="canvas"></div></body></html>',
    { pretendToBeVisual: true },
  );

  global.window = dom.window;
  global.document = dom.window.document;
  global.navigator = dom.window.navigator;
  global.requestAnimationFrame = (callback) => setTimeout(callback, 0);
  global.window.requestAnimationFrame = global.requestAnimationFrame;
  global.window.cancelAnimationFrame = (id) => clearTimeout(id);

  /*
   * crypto is not on a JSDOM window, and the drawing state asks for
   * `randomUUID` when it creates a feature. Absent it falls back to a
   * timestamp, which is fine - so this is present only to keep the ids stable
   * within a test that compares two of them.
   */
  global.window.crypto = global.window.crypto || {
    randomUUID: () => "harness-uuid",
  };

  const { loadModule } = require("./helpers/source-path.cjs");

  /*
   * LOADED BY NAME, NOT BY ADDRESS.
   *
   * The sources live in an ownership-based tree - core/, features/,
   * rendering/ and so on - so there is no longer one directory a harness
   * can join a file name onto. `locate` answers "where is this module"
   * from the real tree, which is what lets this harness keep working
   * through a reorganisation instead of breaking on it.
   */
  SCRIPTS.forEach((name) => {
    loadModule(name);
  });

  MODULES.forEach((name) => {
    if (global.window[name]) {
      global[name] = global.window[name];
    }
  });

  const canvas = global.document.getElementById("canvas");

  canvas.getBoundingClientRect = () => ({
    width: 900,
    height: 600,
    left: 0,
    top: 0,
    right: 900,
    bottom: 600,
  });

  return { dom, canvas };
}

module.exports = { createHarness, MODULES, SCRIPTS };
