# Changes: restructure, thermodynamics merge, LaTeX

A summary of the work done from 13 to 15 October 2026. It covers what changed
at each stage and how it was done. Every stage was checked against the version
before it in the same way, described under [How every stage was checked](#how-every-stage-was-checked).
The detail for any line is in its commit message (`git log`).

| Stage | Branch | Merged |
| --- | --- | --- |
| 1. Restructure | `restructure/v2` | into `main` (`9943c79`) |
| 2. Thermodynamics merge | `port/thermodynamics` | into `main` (PR #27, `0312dc5`) |
| 3. LaTeX save, open and editor | `feature/latex` | not yet |
| 4. Menu flyout fix | `feature/latex` | not yet |

---

## How every stage was checked

Before anything changed, the original `main` was recorded so that every later
step could be compared against it. A stage was only accepted when every check
below passed.

| Check | What it proves |
| --- | --- |
| `npm run lint`, `npm test` (now 253 tests), `npm run build` | The code is clean, the tests pass and the site builds. |
| **Golden scenario**: every toolbar tool, Move/Rotate/Mirror, clipboard, sheets, export and the written solution, run in Chrome and compared step by step with `main` | **Behaviour** is unchanged (66/66 steps identical). |
| **Visual comparison**: four screens compared pixel by pixel with `main` | **Appearance** is unchanged. |
| **Integration API check** in Chrome | Other tools can still drive DAETUM. |

The checks ran against a frozen copy of each commit, so later edits could not
affect the result.

---

## 1. Restructure (`restructure/v2`)

**Goal:** organise the codebase so it scales to eleven categories and runs
efficiently, **without changing the interface**.

| What | How |
| --- | --- |
| **Fixed a real bug on `main`**: after Mirror or Copy→Paste the drawing could no longer be saved, and even switching sheets crashed. | `addObject` returns the stored object, but Mirror and Paste were treating it as an id. Fixed, with a regression test (`tests/mirror-paste-identity.test.cjs`). |
| **Repaired the golden scenario**, which had drifted from the UI and gave timing-dependent results. | Updated the tool ids, used press-drag-release for path tools, routed Modify tools through the menu bar, and waited for submenus instead of pausing for a fixed time. Two runs are now identical. |
| **Faster dragging.** Every pointer movement redrew the whole sheet, twice during a drag. | `requestRender()` batches redraws to at most one per animation frame. Clicks and commits still draw immediately. |
| **Editor in folders.** 70 modules had been in one flat folder. | `editor/interaction`, `toolbar`, `workspace`, `panels`, `commands`, plus one folder per category (`geometry`, `annotate`, `statics`). The files were moved with `git mv` and their imports rewritten by a script. No code changed. |
| **Feature types declared once.** Support and connection type lists were repeated by hand in many files. | They now come from the registry (`isSupportType`, `SUPPORT_TYPES` …) in `core/model/feature-types.js`. |
| **Renderer split.** It was one 9,600-line file. | Nine focused modules in `rendering/`. Declarations were moved verbatim, and the modules depend on each other in one direction only. |
| **Renderer table.** The per-type drawing function was 2,853 lines. | `appendEntity` now loops over `ENTITY_RENDERERS`, a table of `{ matches, draw }` entries. Each draw function lives in `rendering/entities/`. A new feature type is one function plus one table entry. |
| **Stylesheet split.** `editor.css` was 8,200 lines. | Eleven themed files in `styles/editor/`, imported in the original order. The built CSS is byte-identical. |
| **CI** | Every push now runs every tool in Chrome and fails on any page error. `npm run check` runs lint, tests and build. |
| **Cleanup** | 290+ scratch and QA scripts were moved unchanged to `tools/archive/` with a README. |
| **Docs** | README, ARCHITECTURE, CODE-MAP and BRANCHING describe the new layout, including the shape a new category should take. |

## 2. Thermodynamics merge (`port/thermodynamics`)

**Goal:** bring in the `category/thermodynamics` work (10 commits by soniaap3105 and
eeye11) that was not merged before the restructure.

| What | How |
| --- | --- |
| Control volume, piston-cylinder with stoppers, saturation curve, process path, constant T/P lines, the dotted line type, and group move/resize | Merged with history and authorship kept. The new editor files went to `editor/thermodynamics/`. |
| 108 imports still used the old flat paths | Rewritten by a script that maps old paths to the new folders. |
| `renderer.js` changes | Ported by hand into the split renderer: the dotted line style, `entities/draw-thermodynamics.js` with three table entries, the group frame and handles, and the tool previews. |
| The branch failed 4 of its own tests | The "only Select may drag" check now runs before a moved selection is placed, so an armed tool always gets the click. The new click-to-place and free-move code moved into named helpers. Behaviour otherwise follows the branch, including drag → release → click to place everywhere. |
| **Proof** | Each thermodynamics tool, used in Chrome on the branch and on the merged code, gave **identical** results: 36/36 comparisons covering the SVG, selection frame, preview, data and panel. Group move matched step for step. |

## 3. LaTeX: save, open and write (`feature/latex`)

**Goal:** a universal `.tex` that compiles anywhere, that any AI model can
read, and that DAETUM can reopen, plus a code editor that draws what you
write. DAETUM does all of this with its own code. No TeX engine and no
server are involved. See [LATEX.md](LATEX.md).

| What | How |
| --- | --- |
| **File → Download → LaTeX** | `file/latex/latex-document.js` writes one `standalone` file with one picture per sheet. Each picture is the renderer's own SVG converted to drawing code (`svg-to-tikz.js`), so it matches the canvas for every feature type. |
| **Readable by people and AI** | `feature-description.js` writes a sentence above each feature (type, position, real lengths, loads with their units) and a feature list for each sheet. |
| **Exact reopen** | The whole document is embedded as a base64 comment after `\end{document}`. LaTeX ignores it. |
| **File → Open accepts `.tex`** | A DAETUM `.tex` opens as the original document. It never becomes the save target, so Save writes `name.enggdraw` and the `.tex` is never overwritten. A `.tex` without DAETUM data opens in the code editor. |
| **Insert → LaTeX Code…** | `latex-reader.js` turns common drawing code into editable lines, polylines, triangles, rectangles, circles, arcs, arrows and notes. Anything it cannot draw is listed by line number. `ui/editors/latex-editor.js` shows code and a live preview side by side, and has Insert (one undo step), From drawing, and minimise/restore. |
| **Proof** | All 63 golden-scenario sheets compile with a real TeX engine (`tools/dev/compile-latex.mjs`, used as a test harness only) and match the canvas side by side. Reopening gives identical documents. 23 new tests. |

## 4. Menu flyout fix (`feature/latex`)

**Problem:** File → Download opened *inside* the File menu, behind a sideways
scrollbar.

**Fix:** submenus now fly out beside their row and are placed against the
window, as in desktop apps. They open to the right, or to the left when there
isn't room, and move up instead of running off the bottom of the window. The
cause was CSS: the menu panel scrolls vertically, and that forces it to clip
horizontally as well (`ui/menubar/menu-bar.js`, `placeSubmenu`). Checked at
three window sizes.

---

## Branches and what to do with them

- `feature/latex` holds stages 3 and 4 and has not been pushed.
- After merging, category owners should merge `main` into their `category/*`
  branch before continuing, so they pick up the new folder layout.
- `toolbar-changes` (5 commits) was never merged into `main` and predates the
  restructure.
