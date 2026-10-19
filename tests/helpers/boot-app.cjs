/*
 * Boot the whole application in jsdom, from the real page.
 *
 * Loads index.html's own markup, installs the browser globals a module
 * expects, then loads the entry module (src/app/entry/main.js) exactly as the
 * browser does. jsdom does not execute <script type="module">, so the
 * entry is loaded with require(), which Node supports for ES modules.
 *
 * A process can boot the application once: ES modules are singletons.
 *
 *     const { bootApp } = require("./helpers/boot-app.cjs");
 *     const { window, document, error } = bootApp();
 */
const { JSDOM } = require("jsdom");
const path = require("path");
const fs = require("fs");

const projectRoot = path.join(__dirname, "..", "..");

let booted = null;

/*
 * A SECOND PAGE IS A SECOND PROCESS, NOT A SECOND BOOT.
 *
 * ES modules are singletons: once the application is loaded, a second jsdom in
 * this process shares its state. A test that needs a genuinely fresh page can
 * ask for one with `DATUM_FRESH_BOOT=1` - which re-executes this file in a
 * child Node process, gets that child's report as JSON, and installs nothing in
 * the caller. Without that variable the old single-boot behaviour is unchanged.
 */
function bootApp() {
  if (booted) return booted;

  const html = fs.readFileSync(path.join(projectRoot, "index.html"), "utf8");
  const dom = new JSDOM(html, { pretendToBeVisual: true, url: "http://localhost/" });
  const { window } = dom;

  /* The globals a browser module sees. */
  global.window = window;
  global.document = window.document;
  global.navigator = window.navigator;
  global.localStorage = window.localStorage;
  global.HTMLElement = window.HTMLElement;
  global.Element = window.Element;
  global.Node = window.Node;
  global.Event = window.Event;
  global.CustomEvent = window.CustomEvent;
  global.KeyboardEvent = window.KeyboardEvent;
  global.MouseEvent = window.MouseEvent;
  global.XMLSerializer = window.XMLSerializer;
  global.DOMRect = window.DOMRect;
  global.getSelection = window.getSelection.bind(window);
  global.getComputedStyle = window.getComputedStyle.bind(window);
  global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  global.cancelAnimationFrame = (id) => clearTimeout(id);
  window.requestAnimationFrame = global.requestAnimationFrame;
  window.cancelAnimationFrame = global.cancelAnimationFrame;

  /* Dialogs a test does not answer are dismissed. */
  window.alert = () => {};
  window.confirm = () => true;
  window.prompt = () => null;

  let error = null;

  try {
    require(path.join(projectRoot, "src", "app/entry/main.js"));
  } catch (caught) {
    error = caught;
  }

  booted = { dom, window, document: window.document, error };
  return booted;
}

/*
 * Resolves once the page has finished loading. Parts of the application
 * (the written solution) attach on DOMContentLoaded, as they do in a
 * browser, so a test of them waits for it.
 */
function whenReady() {
  const { document } = bootApp();
  return new Promise((resolve) => {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => resolve(), { once: true });
    } else {
      resolve();
    }
  });
}

/*
 * ============================================================
 * RUN AN ARBITRARY ASYNC SCRIPT AGAINST A FRESH PAGE
 * ============================================================
 *
 * `runInFreshPage(task)` boots a brand-new application in a child Node process
 * and evaluates `task({ window, document, projectRoot, require })` there in
 * async context. Whatever the task returns is JSON-serialised and handed back.
 *
 * WHY A CHILD PROCESS. The render pipeline's module-level state (the compiled
 * picture cache, the compile token, the last picture) lives in the page's own
 * module instance. A regression test must observe a REAL page that has not been
 * warmed up by an earlier test in the same file, and ES modules cannot be
 * re-evaluated in a process. A child process is a second page in the only sense
 * that matters.
 *
 * The task is source text, so it must be self-contained apart from the values
 * given to it. This keeps the helper free of a test framework: it is plain
 * Node, usable from `node --test` and from a manual script alike.
 */
function runInFreshPage(taskSource, { timeout = 120_000 } = {}) {
  const { spawnSync } = require("child_process");

  const child = String.raw`
    const { bootApp, projectRoot, whenReady } = require(${JSON.stringify(__filename)});
    const page = bootApp();
    const task = ${taskSource};
    (async () => {
      await whenReady();
      const result = await task({ window: page.window, document: page.document,
        projectRoot, require, bootError: page.error });
      process.stdout.write("\n__DATUM_REPORT__" + JSON.stringify(result === undefined ? null : result));
    })().catch((error) => {
      process.stdout.write("\n__DATUM_REPORT__" + JSON.stringify({ taskError: String(error && error.stack || error) }));
    });
  `;

  const run = spawnSync(process.execPath, ["-e", child], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, DATUM_FRESH_BOOT: "1" },
    timeout,
  });

  const out = `${run.stdout || ""}`;
  const marker = out.lastIndexOf("__DATUM_REPORT__");

  if (marker < 0) {
    return {
      bootError: null,
      taskError: `the fresh page produced no report\nstdout:\n${out}\nstderr:\n${run.stderr || ""}`,
    };
  }

  const text = out.slice(marker + "__DATUM_REPORT__".length);

  try {
    return JSON.parse(text.slice(0, text.lastIndexOf("}") + 1));
  } catch {
    return { bootError: null, taskError: `unreadable report: ${text}` };
  }
}

module.exports = { bootApp, projectRoot, whenReady, runInFreshPage };
