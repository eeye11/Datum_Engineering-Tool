# Testing DAETUM

| Check                     | Command                                              | Needs           |
| ------------------------- | ---------------------------------------------------- | --------------- |
| Unit and integration tests| `npm test`                                           | Node 22         |
| Lint                      | `npm run lint`                                       | Node 22         |
| Golden-master scenario    | `npm run test:golden -- <url> <out.json>`            | Chrome          |
| No page errors in it      | `node tests/e2e/golden-errors.mjs <out.json>`        | Node 22         |
| Lint + tests + build      | `npm run check`                                      | Node 22         |
| A .tex compiles with TeX  | `node tools/dev/compile-latex.mjs <file.tex>`        | Node 22         |
| Integration API in Chrome | `node tests/e2e/api-check.mjs <url>`                 | Chrome          |
| Visual comparison         | `node tests/e2e/visual-compare.mjs <before> <after> <dir>` | Chrome    |
| Engineering audits        | `node tools/audit/<audit>.cjs`                       | Node 22         |
| Import cycles             | `node tools/refactor/import-cycles.mjs`              | Node 22         |
| Dead CSS selectors        | `node tools/refactor/css-selector-audit.mjs`         | Node 22         |

The browser checks drive an installed Google Chrome through Playwright; no
browser download is needed. Serve the app first, either with
`npm run dev` (http://localhost:5173/), or the source tree as-is:

```bash
node tests/e2e/static-server.mjs . 8125      # source, no build
node tests/e2e/static-server.mjs dist 8126   # the production build
```

---

## `npm test`

`tests/*.test.cjs`, run with `node --test`. Tests load the real modules —
never copies — through `tests/helpers/source-path.cjs`:

```js
const { loadModule, controllerSource } = require("./helpers/source-path.cjs");

const quantities = loadModule("quantities.js").default;  // an ES module, by file name
const editorSource = controllerSource();                  // the editor's code, as text
```

- `loadModule(name)` finds a module under `src/` by file name, loads it
  (Node can `require()` an ES module), and also places its default export
  on `window` under its old global name, so older tests written against
  `window.enggX` keep working.
- `controllerSource()` returns the editor's code in reading order, without
  the import/export lines, for tests that inspect how the editor is written
  or lift one function into a sandbox.
- `tests/helpers/boot-app.cjs` boots the **whole application** from the
  real `index.html` in jsdom. `drawing-module-loads`, `latent-defects` and
  `integration-api` use it.

---

## The golden-master scenario

`tests/e2e/golden-scenario.mjs` drives the running app through every tool
on the toolbar (with the gestures each needs), the Modify tools, delete,
clipboard, fit and zoom, undo/redo, sheet operations, serialisation and
the written-solution reference render. It records the document model, the
rendered SVG, every created feature's panel, and any page errors.
Randomness, ids and the clock are pinned, so two runs of the same build are
byte-identical.

Use it to see exactly what a change did:

```bash
npm run test:golden -- http://localhost:8125/ before.golden.json   # before the change
# … make the change …
npm run test:golden -- http://localhost:8125/ after.golden.json
node tests/e2e/golden-compare.mjs before.golden.json after.golden.json
```

A refactor must report every step identical. A fix should differ only in
the steps it fixes. Ids come from a counter, so a change that creates one
more object renumbers everything after it; `--ignore-ids` compares with
ids replaced by their order of appearance:

```bash
node tests/e2e/golden-compare.mjs --ignore-ids before.golden.json after.golden.json
```

Recordings (`*.golden.json`) are not committed: they depend on the
machine's fonts.

---

## Visual comparison

`tests/e2e/visual-compare.mjs` screenshots two builds in the same states
(the Written Solution page, the drawing workspace, the Statics toolset, a
selected beam's panel) and compares them pixel for pixel, saving any
differing pair. The golden scenario checks behaviour; this checks
appearance, which it cannot see.

---

## Writing a test

- Test behaviour through the real modules (`loadModule`), or the booted
  application (`bootApp`), rather than by matching source text. A test that
  matches source text breaks on any refactor whether or not behaviour
  changed.
- A regression test should fail without the fix. Check that it does.
