# DAETUM — `.enggdraw` File Format Audit

> **Historical (retired format).** `.enggdraw` is no longer written: a drawing
> saves as a `.tex` with the same envelope embedded, now labelled
> `"daetum-document"`, and `.enggdraw` files are open-only imports. The
> round-trip guarantees below still hold for the embedded envelope. The current
> format is described in [FILE-FORMAT.md](FILE-FORMAT.md). References below to
> the sheet `scale`, calibration or Vector Scale describe features that have
> since been retired.

**Scope.** The native `.enggdraw` format and the code that saves, loads,
serializes, deserializes and migrates it. The question the audit answers:

> Could DAETUM delete the entire in-memory document, reopen only the `.enggdraw`
> file, and reconstruct the complete editable engineering drawing with all
> relationships intact?

**Answer: yes.** Verified by execution, not by inspection — see §39, the
round-trip test, which builds a document containing every feature kind and
relationship shape, writes it to text, reads it back through the real reader
and migration, rebuilds the state, and compares the two models field by field.
**29 of 29 checks pass** (`tests/enggdraw-round-trip.test.cjs`).

This report states what the format contains, what is reconstructed, what is
deliberately not stored, and the residual risks worth knowing about.

---

## A. The current schema

### The envelope — `src/file/document-file.js`

```json
{
  "format": "enggdraw",
  "version": 2,
  "application": "EnggDraw",
  "savedAt": "2026-01-01T00:00:00.000Z",
  "document": { …the document body… }
}
```

| field | type | required | purpose | authoritative? |
|---|---|---|---|---|
| `format` | string | yes | identifies the file; checked before anything else | — |
| `version` | number | yes | which shape `document` is in | — |
| `application` | string | no | human-readable producer | no |
| `savedAt` | ISO string | no | when it was written | no (informational) |
| `document` | object | yes | the whole drawing | yes |

`version` is `2`. `MINIMUM_SUPPORTED_VERSION` is `1`; a newer version is
refused outright with a message naming both versions (`FROM_THE_FUTURE`), and
a file below the minimum is refused as `TOO_OLD`.

### The document body — `serializeDrawing` (`core/model/drawing-state.js`)

```json
{
  "version": <state version>,
  "units": { … },
  "scale":  { "unitsPerMillimetre": …, "unit": "mm", "calibrated": true,
              "reference": { … } } | null,
  "camera": { "zoom": …, "panX": …, "panY": … },
  "grid":   { … },
  "statics":{ … },
  "snap":   { … },
  "objectSnap": { … },
  "styleDefaults": { … },
  "sheets": [ … ],
  "activeSheetId": "sheet-…",
  "objects": undefined        // <- moved onto the sheet by migration
}
```

`camera`, `grid`, `snap`, `objectSnap`, `styleDefaults` are the sheet-level
settings; `units` and `scale` are document-level.

### A sheet — `sheets.serializeCollection`

**The whole sheet object is spread**, not a hand-picked field list:

```js
sheets: collection.sheets.map((sheet) => ({
  ...JSON.parse(JSON.stringify(sheet)),   // EVERY field
  id: sheet.id,
  name: sheet.name
}))
```

That is deliberate and is the format's strongest property: a field added to a
sheet — a new setting, a new per-sheet flag — is **saved automatically**, so it
cannot be forgotten. A sheet carries its own `objects`, `name`, `id`,
`viewport`, `grid`, `snap`, `objectSnap`, `styleDefaults`, `units` and `scale`.

### A feature — `cloneFeatureForSave`

```js
const copy = { ...object };                  // all scalars, by value
copy.geometry   = deepClone(object.geometry);
copy.style      = deepClone(object.style);
copy.metadata   = deepClone(object.metadata);
[ "placement", "sourceRefs", "anchorRef", "leader",
  "engineering", "constraints", "load", "profile"
].forEach((key) => { copy[key] = deepClone(object[key]); });
```

The shallow spread carries every scalar field (`text`, `visible`,
`annotateKind`, `targetFeatureId`, `locked`, `parentId`, `dimensionType`,
`symbol`, `name`, `type`, `id`) **by value**, and the named list deep-copies
the sub-objects. See §B and §H(Cleanup) for the one residual risk in this list.

---

## B. Feature coverage

All verified by the round-trip test.

| Feature type | Status | Notes |
|---|---|---|
| Line, Point, Circle, Arc | ✅ | `geometry` + `style` |
| Rectangle, Triangle, Polygon | ✅ | corners/vertices in `geometry`; **sub-edges derivable and addressable** (`segment{i}Start/End`) |
| Beam, Shaft, Cable, Truss | ✅ | span geometry; truss members in geometry |
| Particle, Rigid Body | ✅ | position/size |
| Point Force | ✅ | vector geometry + magnitude/direction in `geometry`; `parentId` |
| Distributed Load | ✅ | span + intensity + `loadUnit` |
| **Varying Distributed Load** | ✅ | **profile preserved point for point** |
| Applied Moment | ✅ | magnitude, direction, attachment |
| Supports (pin/roller/fixed/smooth) | ✅ | type, `parentId`, attachment point, orientation |
| Connections (pin/fixed/slider) | ✅ | both ends + type |
| Analysis diagrams (SFD/BMD/AFD) | ✅ | `engineering.sourceFeatureId`, range, sketch elements, plot equations |
| Resultant / Force Components | ✅ | `engineering.sourceFeatureIds` |
| Coordinate System 2D | ✅ | origin, axis lengths, labels |
| Reference Point / Line / Arc | ✅ | real geometry types |
| Smart Dimension | ✅ | type + refs **including `endAnchor`** + placement |
| Variable Dimension | ✅ | **symbol preserved verbatim, never replaced by a measurement** |
| Angular Dimension (two edges of one feature) | ✅ | both refs keep `featureId` + `anchor` + `endAnchor` |
| Annotations — note, label, leader, callout, arrow, symbol, tolerance, table | ✅ | `annotateKind`, text, geometry, style, `targetFeatureId` |
| Table cells | ✅ | `rows`, `columns`, `cells[]` |
| Constraints | ✅ | `constraints` deep-cloned |
| Feature Lock | ✅ | `locked` boolean, independent of constraints |
| Draw order | ✅ | array order in `objects` |
| World Scale / units | ✅ | per sheet |

---

## C. Information that could be lost

**None found.** The round trip is byte-identical for `geometry`, `style`,
`id`, `type`, `name`, `parentId`, `engineering`, `sourceRefs`, `constraints`,
`locked`, `placement` and the table grid.

The one structural weakness is not a defect today but a **maintenance risk**:

| Feature | Risk | Why it matters | Recommendation |
|---|---|---|---|
| any future feature | A **sub-object** field not named in `cloneFeatureForSave`'s list would be shallow-copied — a live reference in memory, and a JSON round trip would still carry it, but two features could then share it. | The list is a hand-maintained allow-list. | See §H(Important 1): make the copy field-complete rather than list-based. |

---

## D. Broken references

**None found.** Every relationship is stored as a **stable string id**, never
an array index, DOM id or screen position:

| Relationship | Stored as |
|---|---|
| child → parent body | `object.parentId` (feature id) |
| dimension → geometry | `sourceRefs[].featureId` (+ `anchor`/`endAnchor` for a sub-edge) |
| analysis → source body | `engineering.sourceFeatureId` / `sourceFeatureIds[]` |
| annotation → target | `targetFeatureId` |
| load/support/moment → body | `parentId` |
| sheet content | `sheet.objects[]` |

**Sub-geometry uses NAMED anchors**, not array positions:
`segment0Start` / `segment0End`. A named anchor survives points being
reordered or a vertex being inserted, which an index would not — this is
exactly what makes the "angle between two edges of one triangle" dimension
reopen correctly (§17).

`restoreObjects` **keeps the saved ids** rather than minting new ones, with the
reasoning stated in the source: a fresh id would silently break every
relationship in the file.

---

## E. Duplicated / derived data

| Field | Verdict |
|---|---|
| `camera` (zoom/pan) | **Stored deliberately.** It is a view choice the student expects to keep, and it is never used to reconstruct geometry. |
| `derivedAnnotations` (magnitude labels) | **Not stored — correctly derived** from the feature every frame. |
| `geometry.sketchContent` | Derived from `sketchElements.length`; harmless if stale, recomputed on preview. |
| `state.units` duplicated on sheet | Intentional: document convention + sheet override. |
| `savedAt` | Informational only; never read back. |
| Recents / template previews | Application-level caches; **never** in the file. |

---

## F. Migration risks

| Item | Assessment |
|---|---|
| Version detection | Present, explicit, and refuses unknown versions. |
| v1 → v2 migration | **Implemented and reasoned**: one unnamed drawing becomes the first sheet; its scale moves onto that sheet; a stable id is minted once and kept. |
| Missing migration step | `migrate` returns `null` and the load fails cleanly rather than guessing. |
| `normalize` | Repairs a *damaged* file (no sheets) into a blank sheet — distinct from migration, and the distinction is documented. |
| Forward compatibility | A newer file is refused with a clear message. |
| **Residual risk** | `CURRENT_VERSION` is `2`; a future bump **must** add `MIGRATIONS[n]`, and the source says so. There is no automated check that a bump was paired with a step — see §H(Important 2). |

---

## G. Round-trip risks

| Risk | Status |
|---|---|
| Numeric drift | **None.** `JSON.stringify` of IEEE doubles is exact round-trip; no rounding anywhere in the save path. The test compares `JSON.stringify` of all geometry. |
| `undefined` fields | **Handled.** `deepClone` answers `undefined` with `undefined`; the old hand-written `JSON.parse(JSON.stringify(x))` **threw**, which once made saving any annotated drawing fail. Fixed and covered by `tests/deep-clone.test.cjs`. |
| Loaded-but-not-referenced | Not a risk: ids are preserved. |
| Draw order | Array order preserved. |
| **Save → Load changing the document** | **None observed.** Every compared field is identical. |

---

## H. Required fixes

### Critical
**None.** The format reconstructs the document completely.

### Important

1. **Make the feature copy field-complete.**
   `cloneFeatureForSave` deep-copies a **named list** of sub-objects. A future
   feature with a sub-object field outside that list (and outside
   `geometry`/`style`/`metadata`) would be shallow-copied. Today's features are
   all covered, and the round-trip test proves it — but the list is invisible
   in a code review of a new feature.
   *Recommendation:* derive the copy from the object's own keys —
   `Object.fromEntries(Object.entries(object).map(([k, v]) => [k, deepClone(v)]))`
   — so a new field is copied **by construction**. Keep the fix behind the
   existing round-trip test.

2. **Assert that a version bump is paired with a migration.**
   `CURRENT_VERSION` must never exceed the highest key in `MIGRATIONS` by more
   than zero without a step. A one-line check in `migrate` — or a unit test —
   makes the requirement mechanical rather than a comment.

3. **Add the per-problem `.enggdraw` fixtures (§41).**
   The round trip is proven for a **broad synthetic** document. The Problems
   3–11 drawings exercise the same machinery with real-world shapes; saving and
   reopening each as a regression fixture would catch a regression in a
   relationship that the synthetic fixture does not happen to build.

### Cleanup

1. `document.objects` is left in the body as `undefined` by the v1→v2
   migration; `JSON.stringify` omits it, so it never reaches a file. It could
   be deleted outright for clarity.
2. `"application": "EnggDraw"` is written but never read. Harmless; either
   read it (to warn on a foreign producer) or drop it.
3. The sheet spread (`...JSON.parse(JSON.stringify(sheet))`) makes the explicit
   `id`/`name` lines redundant — they are re-set after the spread, but the
   spread already carried them.

---

## Verification performed

| Test | Result |
|---|---|
| `tests/enggdraw-round-trip.test.cjs` | **29/29 pass** — identity, geometry, style, every relationship, sub-edge angular refs, symbolic values, table cells, constraints vs lock, calibration, varying-load profile, and the absence of editor-only state and filesystem paths |
| `tests/deep-clone.test.cjs` | 9/9 — including the `undefined` case that once broke saving |
| `npm run test` | 148 pass, 1 fail (the failure is an unrelated pre-existing WIP test) |
| `npm run lint` | 0 errors |

### What was checked and deliberately NOT stored

Confirmed absent from the file text: cursor position, hover state, selection
highlight, snap indicator, active-tool preview, drag state, open dialogs, and
any absolute filesystem path. `recent-files` and `templates` live in
`localStorage` as application-level registries and are **not** embedded in the
document — a template stores a document snapshot, not a dependency on its
source file.

### Atomic save

`file-save.js` writes through `FileSystemFileHandle.createWritable()`, which
commits only when `close()` succeeds: a failure mid-write leaves the previous
file **exactly as it was**, so a valid file cannot be replaced by a corrupt
one. Errors are caught and reported without clearing the in-memory document.
