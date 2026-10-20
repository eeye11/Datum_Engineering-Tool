# DAETUM - Anuj

DAETUM is where an engineering student writes up a solution: the **written
working** (LaTeX, usually produced by the OCR tool from a handwritten page)
and the **drawings** it refers to — free body diagrams, beams and trusses,
loads and supports, dimensions, and shear-force, bending-moment and
axial-force diagrams. The two are submitted together to the autograder.

```
handwritten page ─► OCR ─► LaTeX ─► DAETUM ─► submission ─► autograder
```

## For students

Open DAETUM in a web browser. Nothing to install.

- **Written Solution** — paste or correct your LaTeX on the left, see it
  rendered on the right. Put a drawing in your solution with *Insert Reference*.
- **Engineering Drawing** — choose a toolset across the top (Geometry,
  Annotate, Statics…), then a tool on the left. The status bar at the bottom
  always says what the current tool expects next. `Esc` cancels, `Ctrl+Z`
  undoes.
- **Save** keeps your work as a `.tex` file that compiles anywhere and that
  DAETUM reopens with every feature editable. (Older `.enggdraw` files still
  open, and are saved as `.tex` from then on.) **Insert → LaTeX Code…** draws LaTeX you write
  (see [docs/LATEX.md](docs/LATEX.md)).
  DAETUM also keeps a recovery copy in your browser in case the tab closes.

## For developers

Requires [Node.js](https://nodejs.org/) 22.12 or newer.

```bash
npm install
npm run dev        # http://localhost:5173, reloads as you edit
npm test           # unit and integration tests (node:test)
npm run lint       # ESLint
npm run build      # static site in dist/ — host it anywhere
npm start          # serve dist/ plus TikZ rendering (optional server)
```

### Publishing

Every push to `main` builds the site and publishes it with GitHub Pages
(`.github/workflows/pages.yml`), at
`https://<owner>.github.io/Datum_Engineerint-Tool/`. A repository admin
turns this on once: **Settings → Pages → Source: GitHub Actions**. The
build is plain static files, so `dist/` can equally be copied to any web
host, including a university one, at any path.

### Checking a change

`npm run test:golden -- <url> <out.json>` drives the running app through every
tool in Chrome and records what it produced. Recording before and after a
change, then `node tests/e2e/golden-compare.mjs before.json after.json`,
shows exactly what the change did. See [docs/TESTING.md](docs/TESTING.md).

### Where things are

```
index.html               the page shell and app mount points
src/app/entry/main.js    app entry (imports in startup order)
src/app/                 app-level hooks (automation, error logging)
src/components/          layout + DOM wiring (menu, toolbar, panels, workspace)
src/features/workspace/  editor behaviours by domain (annotate, geometry, statics, ...)
src/shared/              shared model, rendering, file/persistence, solution, integration, ui primitives
src/tool-library/        tool manifests/templates and the registry loader
server/                  optional Node server (TikZ -> SVG)
tests/                   node:test suites; tests/e2e/ browser scenarios
docs/                    architecture, integration, file format, LaTeX, testing
scripts/                 developer diagnostics and one-off probes
```
Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before changing the code,
and [docs/TOOL-MAP.md](docs/TOOL-MAP.md) to find where a toolbar command lives.

## For other tools

DAETUM exposes a small, versioned API — in the page as `window.datum`, and to
an embedding page over `postMessage` — for reading and loading documents,
rendering a sheet to SVG, and reading or setting the LaTeX solution. See
[docs/INTEGRATION.md](docs/INTEGRATION.md). The saved-file format is
specified in [docs/FILE-FORMAT.md](docs/FILE-FORMAT.md).

## Design principles

- **DAETUM documents; it does not solve.** The analysis tools help a student
  draw and label their own reasoning. Nothing works out an unknown or
  reports a solution.
- **A dimension measures geometry; an annotation states meaning.** A beam's
  length is a dimension of the geometry; "250 N at 30°" is an annotation.
- **A reference is not a picture.** A drawing in the written solution is
  rendered from the sheet's current contents every time.
