# The `.enggdraw` file format

A `.enggdraw` file is the **authoritative, editable** DAETUM document: every
feature keeps its real type, geometry, parent and parameters, so opening a
file gives back a drawing that can be selected, dragged, edited and saved
again. It is JSON, UTF-8, with the media type
`application/vnd.enggdraw+json`.

The format is owned by [`src/file/document-file.js`](../src/file/document-file.js).
A `.tex` saved by DAETUM carries the same envelope, base64-encoded in a
comment block after `\end{document}` — see [LATEX.md](LATEX.md).
That module is the only place that reads or writes the envelope, and the only
place a migration from an older version may live.

---

## The envelope

```json
{
  "format": "enggdraw",
  "version": 2,
  "application": "EnggDraw",
  "savedAt": "2026-10-05T14:03:12.000Z",
  "document": { … }
}
```

| Field         | Meaning                                                                 |
| ------------- | ----------------------------------------------------------------------- |
| `format`      | Always `"enggdraw"`. Checked first; anything else is refused. (`"engg-drawing"`, from early builds, is accepted as an alias.) |
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
  "objects": [ … ], "scale": { … }, "camera": { … }, "grid": { … },
  "snap": { … }, "objectSnap": { … }, "styleDefaults": { … }, "statics": { … }
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
  "grid": { "visible": true, "spacing": 5 },
  "snap": { "enabled": true, "spacing": 1 },
  "objectSnap": { "enabled": true, "tolerancePx": 10, "inferenceTolerancePx": 24 },
  "styleDefaults": { "stroke": "#000000", "fill": "none", "lineWidth": 0.5, "lineType": "solid", "opacity": 1 },
  "scale": { … }
}
```

- **`id`** is permanent and is what a written-solution reference names
  (`[DRAWING_REFERENCE:sheet_8f31a2c4]`). It never changes when the sheet is
  renamed or moved.
- **`name`** is what the student sees and may change at any time.
- **`scale`** is the sheet's *Universal Length Scale*: how drawing units map
  to millimetres. It is established by the first real length on the sheet.

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

Drawing units become millimetres through the sheet's `scale`; a dimension
stores *references* to geometry, not a number, so it stays correct when the
geometry moves.

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
[`src/core/model/drawing-state.js`](../src/core/model/drawing-state.js)
(`geometryFactories`). Analysis features are *readings* of other features and
are recomputed from their sources on load
([`src/features/analysis/analysis-dependencies.js`](../src/features/analysis/analysis-dependencies.js)).

---

## Changing the format

1. Make the change in the state model.
2. Bump `CURRENT_VERSION` in `document-file.js`.
3. Add a migration step from the previous version to `migrate()`, so every
   file already saved still opens.
4. Add a round-trip test (see `tests/document-roundtrip.test.cjs`).
5. Update this document.
