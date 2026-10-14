/*
 * ========================================================
 * WHERE THE APPLICATION'S SOURCE FILES LIVE
 * ========================================================
 *
 * Every test loads the real modules from the real source tree, so every
 * test needs to know where that tree is. It used to answer with the
 * literal string "js/engineering-drawing" - and that path stopped being
 * true when the sources were reorganised by ownership into `core/`,
 * `features/`, `rendering/` and so on.
 *
 * A TEST THAT HARD-CODES A DIRECTORY IS A TEST THAT BREAKS ON A MOVE.
 *
 * So the layout lives here, once, and a test asks for a module BY NAME:
 *
 *     const { modulePath } = require("./helpers/source-path.cjs");
 *
 *     require(modulePath("quantities.js"));
 *
 * The lookup is by BASENAME rather than by full path, because a test's
 * subject is "the quantities module", not "the quantities module at a
 * particular address". That is what makes this resilient: moving a file
 * between folders needs a change in ONE table below, not in every test
 * that happens to load it.
 *
 * The tree is scanned rather than tabulated by hand, so a module added
 * to the application is loadable from a test the moment it exists,
 * without anyone remembering to register it.
 */
const fs = require("fs");
const path = require("path");

const SOURCE_ROOT = path.join(__dirname, "..", "..", "src");

/* Folders that hold application source, in no particular order. */
const SKIP = new Set(["node_modules", ".git"]);

/*
 * Every .js file under js/, as { basename -> full path }.
 *
 * Built once per process. A duplicate basename would be ambiguous - two
 * files answering to one lookup - so it is reported rather than silently
 * resolved to whichever the walk happened to reach first.
 */
function collect(dir, found, duplicates) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) {
      continue;
    }

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      collect(full, found, duplicates);
      continue;
    }

    if (!entry.name.endsWith(".js")) {
      continue;
    }

    if (found.has(entry.name)) {
      duplicates.add(entry.name);
    }

    found.set(entry.name, full);
  }
}

const found = new Map();
const duplicates = new Set();

if (fs.existsSync(SOURCE_ROOT)) {
  collect(SOURCE_ROOT, found, duplicates);
}

/*
 * The absolute path of a source module, by its file name.
 *
 * Throws rather than returning undefined: a test that cannot find the
 * module it is about to exercise should stop with a message naming the
 * file, not carry on and fail later for a reason that looks like a
 * defect in the module.
 */
function modulePath(name) {
  const resolved = found.get(name);

  if (!resolved) {
    throw new Error(
      `No source module named "${name}" under ${SOURCE_ROOT}.\n` +
        `Known modules: ${[...found.keys()].sort().join(", ")}`
    );
  }

  return resolved;
}

/* The directory a group of modules lives in - for a test loading many. */
function sourceDir() {
  return SOURCE_ROOT;
}

/*
 * The path of a module, usable where a DIRECTORY used to be passed.
 *
 * Tests commonly build their own path:
 *
 *     const dir = path.join(projectRoot, "js", "engineering-drawing");
 *     require(path.join(dir, name));
 *
 * The files are no longer in one directory, so a `dir` cannot satisfy
 * that call - but a LOOKUP can. `locate(name)` is that lookup, and it is
 * deliberately callable with the same shape: `locate("drawing.js")` is
 * the path, so a test's existing `path.join(dir, name)` becomes
 * `locate(name)` with no other change.
 *
 * An absolute path passed through is returned unchanged, so
 * `locate(path.join(dir, name))` where dir was already a real directory
 * still works. That keeps the helper safe to apply everywhere rather
 * than only where the pattern matched perfectly.
 */
function locate(name) {
  if (typeof name !== "string" || name.length === 0) {
    throw new Error(`locate() needs a module file name, got ${name}`);
  }

  /* An absolute path is already an answer. */
  if (path.isAbsolute(name)) {
    return name;
  }

  return modulePath(path.basename(name));
}

/*
 * Load an application module, the way a test needs it.
 *
 * The sources are ES modules: each one `export default`s the object it
 * used to publish on `window` (enggMeasurement, enggDrawingState, ...).
 * Node can require() an ES module directly, and that returns its exports;
 * this also places the default export on `window` (or the global object
 * when a test has not stubbed one) under its old global name. Tests
 * written against `window.enggX` therefore keep working unchanged, while
 * new tests can simply use the returned exports.
 *
 * A module's own imports are loaded with it, exactly as in the browser.
 */
const DEFAULT_EXPORT = /^export default (\w+);/m;

function loadModule(name) {
  const file = locate(name);
  const exported = require(file);
  const declared = fs.readFileSync(file, "utf8").match(DEFAULT_EXPORT);
  const target = globalThis.window || globalThis;

  if (declared && exported.default !== undefined) {
    target[declared[1]] = exported.default;
  }

  return exported;
}

/*
 * The drawing controller's source, as one text.
 *
 * Several tests read the controller's source to check how it is written,
 * or lift a function out of it by name and run it in a sandbox. The
 * controller is split across the modules under src/editor/, so this gathers
 * them in a stable order - a function is found wherever it lives - and
 * leaves out the module syntax (import lines and `export` keywords), which
 * is about how the files connect rather than what the code does, and which
 * a sandbox cannot evaluate.
 */
function controllerSource() {
  const editorDir = path.join(SOURCE_ROOT, "editor");
  const files = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js")) files.push(full);
    }
  })(editorDir);
  /*
   * Reading order: the table of contents at the top of editor/index.js,
   * then anything it does not list. A test that slices "from this function
   * to the next" relies on the two being adjacent, as they are in that order.
   */
  const indexFile = path.join(editorDir, "index.js");
  const toc = [
    ...fs.readFileSync(indexFile, "utf8").matchAll(/^ \*\s{3}((?:[a-z-]+\/)*[a-z-]+\.js)\s/gm),
  ].map((m) => path.join(editorDir, m[1]));
  const rank = (file) => {
    const at = toc.indexOf(file);
    return at < 0 ? toc.length + (file === indexFile ? 1 : 0) : at;
  };

  return files
    .sort((a, b) => rank(a) - rank(b) || path.basename(a).localeCompare(path.basename(b)))
    .map((file) =>
      fs
        .readFileSync(file, "utf8")
        /* A Windows checkout may have CRLF; the patterns below expect LF. */
        .replace(/\r\n/g, "\n")
        .replace(/^import[^;]*;\n/gm, "")
        .replace(/^export (?=(?:async )?function |const |let |class )/gm, "")
        .replace(/^export \{[^}]*\}(?: from "[^"]*")?;\n/gm, ""),
    )
    .join("\n");
}

/*
 * The renderer's source, as one text.
 *
 * The renderer is split by concern across src/rendering/ (primitives,
 * dimensions, annotations, analysis, vectors, symbols, the per-feature
 * dispatch, overlays, preview, and renderer.js itself). A test that reads
 * "the renderer" to check how something is drawn gets all of it, in the order
 * the code was originally written, so a function is found wherever it lives.
 */
const RENDERER_PARTS = [
  "svg-primitives.js",
  "analysis-render.js",
  "dimension-render.js",
  "annotation-render.js",
  "entity-render.js",
  "vector-render.js",
  "symbol-render.js",
  "overlay-render.js",
  "preview-render.js",
  "renderer.js",
];

function rendererSource() {
  return RENDERER_PARTS.map((name) => fs.readFileSync(modulePath(name), "utf8")).join("\n");
}

/*
 * A stylesheet's text, with its local @imports expanded in place.
 *
 * editor.css is a list of @imports - one file per part of the editor, in
 * cascade order - so a test that reads "the editor's CSS" needs the files it
 * imports, in that order. `name` is relative to src/styles/.
 */
const IMPORT = /^@import url\("([^"]+)"\);\s*$/gm;

function stylesheetSource(name, from = path.join(SOURCE_ROOT, "styles")) {
  const file = path.resolve(from, name);
  return fs
    .readFileSync(file, "utf8")
    .replace(IMPORT, (_, target) => stylesheetSource(target, path.dirname(file)));
}

module.exports = {
  SOURCE_ROOT,
  controllerSource,
  rendererSource,
  stylesheetSource,
  duplicates,
  loadModule,
  locate,
  modulePath,
  sourceDir,
  // The complete map, for a test that wants to assert on the layout.
  modules: found,
};
