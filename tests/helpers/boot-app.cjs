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
  global.KeyboardEvent = window.KeyboardEvent;
  global.MouseEvent = window.MouseEvent;
  global.XMLSerializer = window.XMLSerializer;
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

module.exports = { bootApp, projectRoot, whenReady };
