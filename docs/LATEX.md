# LaTeX: saving, opening and writing drawings as code

DAETUM saves a document as a `.tex` file, opens it again, and lets a student
write LaTeX drawing code and see it drawn. **DAETUM's own code does all of
it** — nothing runs TeX, no server is needed, and it works offline on the
static site. The code it writes and reads is the standard TikZ drawing
language, so the same file compiles in any LaTeX installation or Overleaf,
and any AI model given the file can read it.

| What | Where in the app | Code |
| --- | --- | --- |
| Save as LaTeX | File → Download → **LaTeX (.tex)** | `src/file/latex/latex-document.js` (`writeLatexDocument`) |
| Open a `.tex` | File → Open | `src/editor/commands/document-commands.js` (`applyOpenedLatex`) |
| Write code, see it drawn | Insert → **LaTeX Code…** | `src/ui/editors/latex-editor.js`, `src/editor/commands/latex-commands.js` |
| The drawing → commands | — | `src/file/latex/svg-to-tikz.js` |
| What each feature is, in words | — | `src/file/latex/feature-description.js` |
| Code → features | — | `src/file/latex/latex-reader.js` (`readLatexDrawing`) |

---

## The `.tex` file

```latex
% =====================================================================
% Bridge - engineering drawing exported from DAETUM
% ... how to read this file ...
% =====================================================================
\documentclass[tikz, border=5mm]{standalone}
\usepackage[T1]{fontenc}
\usepackage{amssymb}
\renewcommand{\familydefault}{\sfdefault}
\definecolor{daetum1}{HTML}{193335}

\begin{document}

% ---------------------------------------------------------------------
% Sheet 1 of 2: "Beam"
% Features (2):
%   1. Beam "Beam 1", from (0, 0) to (200, 0), length 200 drawing units, depth 12 drawing units.
%   2. Pin support "Support A", on Beam "Beam 1", at (0, -8), 0 drawing units from its start.
% ---------------------------------------------------------------------
\begin{tikzpicture}[x=1mm, y=1mm, scale=0.708]
  % 1. Beam "Beam 1", from (0, 0) to (200, 0), length 200 drawing units, depth 12 drawing units.
  \draw[draw=daetum1, line width=0.677pt] (0,-1.5) -- (200,-1.5) -- ...;
  ...
\end{tikzpicture}

\end{document}

% DAETUM DOCUMENT DATA ... (comment lines: the full drawing)
```

- **One file, every sheet**: each sheet is one `tikzpicture`, which the
  `standalone` class makes one page.
- **The picture is the canvas.** Each sheet is drawn by the ordinary
  renderer and its SVG is converted to commands, so the `.tex` looks like the
  canvas for every feature type — including ones added later — with no
  second implementation of how anything looks.
- **Every feature is described** in a comment above its commands, and each
  sheet starts with its feature list. Lengths are in drawing units, as
  drawn; loads and moments keep their units. This is what lets an AI model
  understand the drawing rather than just its lines.
- **Coordinates are drawing units, y up**, written with `x=1mm, y=1mm`.
  The picture's `scale` fits it to a page; strokes and text are sized from
  the page, as they are from the screen.
- **It reopens exactly.** The whole document, as its JSON envelope in base64
  (see [FILE-FORMAT.md](FILE-FORMAT.md)),
  follows `\end{document}` as comment lines. LaTeX ignores it; DAETUM opens
  it with every feature editable.
- **It compiles.** Text is escaped; engineering symbols become LaTeX/amssymb
  symbols; any other uncommon character is declared so pdflatex prints its
  code point instead of stopping.

### Opening

A `.tex` with DAETUM's data opens as that document, and **is the save target**:
Save writes the same `.tex` again, picture and embedded document together. (An
older `.enggdraw` opens too, as an import; it is never written, and Save offers
the same name as `.tex`.) A `.tex` without the data (hand-written, or from
another program) opens in the LaTeX code editor instead, where the student
sees what DAETUM can draw from it and inserts it.

---

## The LaTeX code editor

Insert → **LaTeX Code…** opens a floating window: code on the left, a live
preview on the right (drawn by the export renderer, so it is what the canvas
will show), and the lines that could not be drawn below — click one to
select it in the code.

- **Insert into drawing** adds the features to the current sheet as one undo
  step and selects them.
- **From drawing** shows the current sheet as code.
- **–** minimises it to a small bar that keeps the code; **Esc** does the
  same. **×** closes it.

### What the reader understands

| Written | Becomes |
| --- | --- |
| `\draw (0,0) -- (4,0);` | Line |
| `\draw (0,0) -- (1,0) -- (1,1);` | Polyline |
| `... -- cycle;` with 3 points | Triangle |
| `(0,0) rectangle (4,2)`, or a closed axis-aligned 4-point path | Rectangle |
| other closed paths | Closed polyline |
| `(1,1) circle[radius=0.5]`, `circle (3mm)` | Circle |
| `(3,0) arc[start angle=0, end angle=90, radius=3]`, `arc (0:90:3)` | Arc |
| `\draw[->] ...`, `<-`, `-Stealth`, `-{Latex}` on two points | Arrow annotation (head where LaTeX puts it) |
| `\node at (x,y) {text}`, inline `node {text}` | Note (text converted: `$30^\circ$` → 30°) |
| `\coordinate (A) at (x,y);` | A name usable as `(A)` |

Coordinates: `(x,y)` in the picture's units (`x`/`y` options; LaTeX's default
1 cm = **10 drawing units**), absolute lengths (`2cm`, `5mm`, `10pt`), polar
`(angle:radius)`, relative `++(dx,dy)` and `+(dx,dy)`, corners `-|` and `|-`.
Styles: colours (named, `red!50`, `\definecolor`), `draw=`, `fill=`,
`line width=`, `thin`…`ultra thick`, `dashed`, `dotted`, `dash dot`.
Scopes: `\begin{scope}[shift=..., rotate=..., scale=...]`.

A picture's own `scale` changes only its printed size and is not applied, so
a picture DAETUM wrote reads back at its own coordinates.

### What it reports instead of drawing

Loops (`\foreach`), macros (`\def`, `\newcommand`), coordinate calculations
(`$...$`), `\pic`, `\shade`, `\clip`, plots and undefined names are listed
with their line numbers and skipped. Curves (`..controls..`) are drawn as
straight segments; ellipses as closed polylines; node outlines are not drawn
(their text is). Options DAETUM has no use for are listed as information.

A DAETUM export read **without** its data block comes back as the shapes it
is drawn with — a beam as a rectangle, a support as a triangle and a line —
not as engineering features. The data block is what reopens those exactly.

---

## Checking LaTeX output

`npm test` covers the writer (`tests/latex-export.test.cjs`) and the reader
(`tests/latex-reader.test.cjs`).

To prove a file compiles with a real TeX engine:

```bash
node tools/dev/compile-latex.mjs drawing.tex            # every picture compiles?
node tools/dev/compile-latex.mjs drawing.tex --svg out/ # and keep TeX's output
```

This uses `node-tikzjax` (TeX compiled to WebAssembly, a dependency of the
optional server) as a **test harness only** — the application never runs it.
