# Developer tools

Nothing here ships with the application.

## `audit/` — engineering audits

System-wide checks of the Statics model run against the real modules in
jsdom (`statics-harness.cjs`): loads, vectors, dependencies, persistence,
selection, degenerate geometry, the renderer's arrows.

```bash
node tools/audit/audit-full-scene.cjs
```

All pass except `audit-loads.cjs` and `audit-vectors.cjs`, which were
already failing on `main` before the restructure (their expectations
predate later changes to load and vector geometry) and need updating by
someone who owns those features.

## `archive/` — no longer maintained

The per-feature browser QA scripts (`archive/qa/`) and one-off diagnostics
that had accumulated in the repository root (`archive/scratch/`). Kept for
the record; see `archive/README.md`. For whole-application checks use the
golden-master scenario in `tests/e2e/`, which CI runs.

## `refactor/` — analysis and codemods

| Script                  | What it does                                                        |
| ----------------------- | ------------------------------------------------------------------- |
| `import-cycles.mjs`     | Lists import cycles in `src/`. Run it when you add imports.          |
| `strict-audit.mjs`      | Finds code whose meaning changes in a strict ES module.              |
| `analyze-controller.mjs`| Maps a file's top-level declarations, references and mutable state.  |
| `smoke.mjs`             | Loads the page in Chrome, draws a line, reports any error.           |
| `to-esm.mjs`            | The codemod that turned the classic scripts into ES modules.         |
| `split-controller.mjs`  | The codemod that split the 39,000-line controller into `src/editor/`.|
| `move-to-src.sh`        | The renames that created `src/`.                                     |

The last three were run once, during the restructure, and are kept as the
record of exactly how it was done.

## `dev/` — one-off diagnostics

Small scripts written while chasing a specific defect, kept because they are
the fastest way back into the same corner. Each reaches the real modules
(usually through `tests/harness-renderer.cjs`) and prints what it finds, so
none of them asserts anything and none is part of the suite.

| Script                       | What it answers                                          |
| ---------------------------- | -------------------------------------------------------- |
| `trace-length-pipeline.mjs`  | Where a length is converted, step by step                 |
| `audit-statics-bounds.cjs`   | Whether Statics geometry sits inside its own bounds       |
| `probe-support-*.cjs`        | How a support attaches, and where it lands                |
| `fix-support-*.cjs`          | One-off rewrites from the support-placement work          |
| `show-support-*.cjs`         | Which branch draws a given support symbol                 |
| `inspect-*.mjs`              | What a panel or a print SVG actually contains             |
| `check*.cjs`, `list-types.cjs` | Marker and feature-type sanity checks                    |
| `eol-diag.cjs`               | Line-ending differences that break a patch                |
| `find-*.cjs`                 | Locating the code that handles a given construct          |
| `patch-file.mjs`             | Applies a targeted edit to a file                         |
| `show-callsites.cjs`         | Who calls a function                                      |

They are development scratch, not tooling the application depends on: nothing
in `src/` imports them and the build never sees them. Run one directly, e.g.

```bash
node tools/dev/trace-length-pipeline.mjs
```
