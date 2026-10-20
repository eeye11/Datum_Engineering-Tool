# The DAETUM document format

A drawing is saved as a **`.tex` file**. It compiles anywhere as a normal
LaTeX/TikZ document, and it carries the **authoritative, editable** DAETUM
document inside it: every feature keeps its real type, geometry, parent and
parameters, so opening the file gives back a drawing that can be selected,
dragged, edited and saved again.

The document travels as a JSON **envelope**, base64-encoded in a comment block
after `\end{document}` (between `%% DAETUM-DOCUMENT-BEGIN` and
`%% DAETUM-DOCUMENT-END`) — see [LATEX.md](LATEX.md). LaTeX ignores it.

The envelope is owned by [`src/shared/file/document-file.js`](../src/shared/file/document-file.js);
the `.tex` around it by [`src/shared/file/latex/latex-document.js`](../src/shared/file/latex/latex-document.js).
`document-file.js` is the only place that reads or writes the envelope, and the
only place a migration from an older version may live.

### The retired `.enggdraw` format

Older builds saved a bare JSON envelope as `.enggdraw`
(`application/vnd.enggdraw+json`). That format is **retired, and import-only**:

- an `.enggdraw` file still **opens**, with every feature editable;
- it is **never written**. Save on an imported `.enggdraw` runs Save As, and
  the suggested name is the same name with `.tex` (`Beam.enggdraw` →
  `Beam.tex`), so the old file is never overwritten;
- envelopes whose `format` is `"enggdraw"` (or `"engg-drawing"`, from early
  builds) are read as aliases, including inside a `.tex` written by an older
  build.

---

## The envelope

```json
{
  "format": "daetum-document",
  "version": 2,
  "application": "DAETUM",
  "savedAt": "2026-10-19T14:03:12.000Z",
  "document": { … }
}
```

| Field         | Meaning                                                                 |
| ------------- | ----------------------------------------------------------------------- |
| `format`      | `"daetum-document"`. Checked first; anything else is refused, except the retired aliases `"enggdraw"` and `"engg-drawing"`, which are read. |
| `version`     | The shape of `document`. This build writes **2** and reads **1–2**.     |
| `application` | The writer. Informational.                                              |
| `savedAt`     | ISO-8601 time of writing. Informational.                                |
| `document`    | The document body, below.                                               |

**Compatibility rule.** A file is always written at the current version and
read at whatever version it was written, then migrated forward. A file
*newer* than the build is refused (`"from-the-future"`) rather than
misread; one older than the minimum supported version is refused
(`"too-old"`).

---

## The document body

```json
{
  "sheets": [ { …sheet… }, … ],
  "activeSheetId": "sheet_8f31a2c4",

  "version": 1, "units": "mm",
  "objects": [ … ], "camera": { … }, "grid": { … },
  "snap": { … }, "objectSnap": { … }, "styleDefaults": { … }
}
```

`sheets` is the document. The remaining top-level fields mirror the active
sheet; they are what a version-1 (single-drawing) file contained, and are
kept so that such a file still opens.

### A sheet

```json
{
  "id": "sheet_8f31a2c4",
  "name": "Free body diagram",
  "version": 1,
  "units": "mm",
  "objects": [ …features… ],
  "viewport": { "zoom": 1, "panX": 0, "panY": 0 },
  "grid": { "visible": true, "spacing": 7.5 },
  "snap": { "enabled": true, "spacing": 1 },
  "objectSnap": { "enabled": true, "tolerancePx": 10, "inferenceTolerancePx": 24 },
  "styleDefaults": { "stroke": "#000000", "fill": "none", "lineWidth": 0.5, "lineType": "solid", "opacity": 1 }
}
```

- **`id`** is permanent and is what a written-solution reference names
  (`[DRAWING_REFERENCE:sheet_8f31a2c4]`). It never changes when the sheet is
  renamed or moved.
- **`name`** is what the student sees and may change at any time.

A sheet no longer has a `scale`. The world-length scale (calibrating drawing
units to real millimetres) is retired; a `scale` in an older file is ignored
and not written back. Statics `vectorScale` settings are ignored the same way.

### A feature

Every feature has the same outer shape:

```json
{
  "id": "beam-00000042-…",
  "name": "Beam 1",
  "type": "beam",
  "geometry": { "start": { "x": -93, "y": -16 }, "end": { "x": 47.08, "y": -16 }, "depth": 12 },
  "style": { "stroke": "#000000", "fill": "none", "lineWidth": 0.5, "lineType": "solid", "opacity": 1 },
  "metadata": {},
  "engineering": { "plane": "XY", "discipline": "statics", "staticsType": "beam" },
  "parentId": "…"
}
```

| Field         | Meaning                                                                 |
| ------------- | ----------------------------------------------------------------------- |
| `id`          | Unique within the document.                                             |
| `type`        | What the feature is — see below. Decides how `geometry` is read.        |
| `geometry`    | Positions in **drawing units** (y up). Shape depends on `type`.         |
| `style`       | How it is drawn. Never affects a measurement.                           |
| `engineering` | The Statics/engineering meaning (discipline, Statics type, magnitudes). |
| `parentId`    | Present on features attached to a body (a load on a beam, a support).   |

Lengths are read in drawing units, as drawn. A dimension stores *references*
to geometry, not a number, so it stays correct when the geometry moves.

A force or load arrow is **as long as it was drawn**: a point force stores its
drawn arrow length, and a distributed or varying load stores `arrowLength`, its
drawn arrow height (a varying load tapers by intensity ratio). The magnitude or
intensity is the label only and never resizes the arrow.

### Feature types

| Group       | Types |
| ----------- | ----- |
| Geometry    | `point`, `line`, `polyline`, `triangle`, `rectangle`, `circle`, `arc`, `polygon`, `coordinate-system-2d` |
| Bodies      | `particle`, `rigid-body`, `beam`, `truss`, `cable`, `shaft` |
| Loads       | `force` (point force), `load` (distributed), `varying-load`, `moment`, `couple` |
| Supports    | `pin-support`, `roller-support`, `fixed-support`, `smooth-support` |
| Connections | `pin-connection`, `fixed-connection`, `slider-connection` |
| Analysis    | `resultant`, `force-components`, `analysis-diagram` (SFD/BMD/AFD) |
| Annotation  | `dimension`, `annotation` |

The geometry each type stores is defined by its factory in
[`src/shared/model/drawing-state.js`](../src/shared/model/drawing-state.js)
(`geometryFactories`). Analysis features are *readings* of other features and
are recomputed from their sources on load
([`src/features/workspace/model/analysis/analysis-dependencies.js`](../src/features/workspace/model/analysis/analysis-dependencies.js)).

---

## Changing the format

1. Make the change in the state model.
2. Bump `CURRENT_VERSION` in `document-file.js`.
3. Add a migration step from the previous version to `migrate()`, so every
   file already saved still opens.
4. Add a round-trip test (see `tests/document-roundtrip.test.cjs`).
5. Update this document.
