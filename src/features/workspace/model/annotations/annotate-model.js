import { MATH_SYMBOL_GROUPS } from "../../../../shared/symbols/math-symbol-catalog.js";
import { noteTextStyle, noteFontPixels, noteTextWidth } from "../../../../shared/typography/note-text-style.js";
/*
 * ========================================================
 * THE ANNOTATE FEATURES
 * ========================================================
 *
 * These are the drawing-side annotations: the marks a student puts ON a
 * drawing to explain it. They are not measurements - a Smart Dimension
 * measures, a Note does not - and they are not Statics features. They are
 * the engineering-drawing equivalent of a drafting pen.
 *
 * WHY THEY ARE ONE MODULE AND ONE FEATURE TYPE
 * --------------------------------------------
 * Every one of them is the same SHAPE of thing: a piece of content (text,
 * a symbol, a value), positioned in the drawing, optionally pointing at a
 * feature, with a style. What differs is the content and how it is drawn -
 * not what it IS. So they share a single feature type, `annotate`, with a
 * `kind` deciding the specifics:
 *
 *     kind        what it is                        geometry it carries
 *     ───────     ─────────────────────────────     ────────────────────
 *     note        free prose / equations            placement
 *     label       a short feature identifier        placement + target
 *     leader      text on a pointed line            start (target), end
 *     callout     text in a box on a leader         start (target), end
 *     arrow       a free-standing direction mark    start, end
 *     symbol      an engineering symbol             placement
 *     tolerance   a toleranced value                placement + target
 *     table       a grid of values                  placement, rows, cols
 *
 * The reason this is ONE type rather than eight is the same reason a
 * dimension is one type however it is measured: the selection, move,
 * delete, undo, save and panel code is identical for all eight, and
 * splitting them into eight types would mean eight copies of that code -
 * eight chances to fall out of step. A new annotation kind is added HERE,
 * in its data, not in the interaction layer.
 *
 * WHAT IS AUTHORITATIVE
 * ---------------------
 * Positions are stored in DRAWING units, never screen pixels, so an
 * annotation survives zoom, pan, Fit, resizing and save/reload (spec 65).
 * A leader's two ends are stored as the target point and the text point,
 * so it moves with the drawing rather than being pinned to the viewport.
 *
 * THE FEATURE'S OWN NAME IS NOT ITS TEXT
 * --------------------------------------
 * `name` identifies the feature in the Features list ("Note 1"); the text
 * is what is drawn. They are separate so renaming a note does not change
 * what it SAYS, and editing what it says does not rename the feature.
 */

/*
 * The kinds, and what each one is.
 *
 * `geometric` marks the kinds whose creation is a start-and-end gesture -
 * the ones that take BOTH the click-move-click and the drag workflow. The
 * rest are placed with a single click, which is the honest interaction for
 * a thing that sits at a point.
 *
 * `targeted` marks the kinds that attach to a feature under the cursor.
 */
export const ANNOTATE_KINDS = {
  note: {
    label: "Note",
    geometric: false,
    targeted: false,
    text: "Note"
  },
  label: {
    label: "Label",
    geometric: false,
    targeted: true,
    text: "A"
  },
  leader: {
    label: "Leader",
    geometric: true,
    targeted: true,
    text: "Leader"
  },
  callout: {
    label: "Callout",
    geometric: true,
    targeted: true,
    text: "Callout"
  },
  arrow: {
    label: "Arrow",
    geometric: true,
    targeted: false,
    text: ""
  },
  symbol: {
    label: "Symbol",
    geometric: false,
    targeted: false,
    text: "Symbol"
  },
  tolerance: {
    label: "Tolerance",
    geometric: false,
    targeted: true,
    text: "±0.00"
  },
  table: {
    label: "Table",
    geometric: false,
    targeted: false,
    text: ""
  }
};

/*
 * The symbol library the Symbol tool offers.
 *
 * Grouped the way an engineer looks for them rather than alphabetically,
 * Every entry has a glyph; Greek and mathematical entries also share their
 * TeX representation with the source and SVG exporters.
 */
export const SYMBOL_LIBRARY = [
  {
    id: "gdt",
    label: "Datum / GD&T",
    symbols: [
      { id: "datum", label: "Datum", text: "⌖" },
      { id: "flatness", label: "Flatness", text: "⏥" },
      { id: "parallelism", label: "Parallelism", text: "∥" },
      { id: "perpendicularity", label: "Perpendicularity", text: "⊥" },
      { id: "position", label: "Position", text: "⌖" },
      { id: "concentricity", label: "Concentricity", text: "◎" }
    ]
  },
  {
    id: "surface",
    label: "Surface Finish",
    symbols: [
      { id: "surface-finish", label: "Surface Finish", text: "⏓" },
      { id: "roughness", label: "Roughness Ra", text: "Ra" }
    ]
  },
  {
    id: "weld",
    label: "Weld",
    symbols: [
      { id: "fillet-weld", label: "Fillet Weld", text: "▷" },
      { id: "groove-weld", label: "Groove Weld", text: "⊻" }
    ]
  },
  {
    id: "center",
    label: "Center / Centerline",
    symbols: [
      { id: "centerline", label: "Centerline", text: "℄" },
      { id: "center-mark", label: "Center Mark", text: "⊕" }
    ]
  },
  {
    id: "section",
    label: "Section",
    symbols: [
      { id: "section", label: "Section Marker", text: "A–A" },
      { id: "detail", label: "Detail Marker", text: "Ⓐ" }
    ]
  },
  {
    id: "reference",
    label: "Reference",
    symbols: [
      { id: "reference", label: "Reference", text: "REF" },
      { id: "basic-dimension", label: "Basic Dimension", text: "▭" }
    ]
  },
  {
    id: "other",
    label: "Other Engineering Symbols",
    symbols: [
      { id: "diameter", label: "Diameter", text: "Ø" },
      { id: "radius", label: "Radius", text: "R" },
      { id: "degree", label: "Degree", text: "°" },
      { id: "plus-minus", label: "Plus / Minus", text: "±" },
      { id: "square", label: "Square", text: "□" },
      { id: "counterbore", label: "Counterbore", text: "⌴" },
      { id: "countersink", label: "Countersink", text: "⌵" },
      { id: "delta", label: "Delta", text: "Δ" },
      { id: "micro", label: "Micro", text: "µ" }
    ]
  },

  ...MATH_SYMBOL_GROUPS
];

/* Every symbol, flat, keyed by id, for lookup from a stored feature. */
export const SYMBOL_BY_ID = Object.fromEntries(
  SYMBOL_LIBRARY.flatMap((group) =>
    group.symbols.map((symbol) => [symbol.id, symbol])
  )
);

/*
 * The tolerance modes, and the engineering meaning of each.
 *
 * A tolerance states how far a dimension may vary. The MODE decides which
 * values are meaningful - a symmetric tolerance has one ± value, a limit
 * tolerance has two absolute limits - and the panel offers only the fields
 * the chosen mode actually needs (spec 50).
 */
export const TOLERANCE_MODES = {
  symmetric: {
    label: "Symmetric (±)",
    fields: ["value"],
    text: (values) => `±${formatNumber(values.value)}`
  },
  deviation: {
    label: "Deviation (+/−)",
    fields: ["upper", "lower"],
    text: (values) =>
      `${signed(values.upper)} / ${signed(values.lower)}`
  },
  limits: {
    label: "Limits",
    fields: ["upper", "lower"],
    text: (values) =>
      `${formatNumber(values.upper)} / ${formatNumber(values.lower)}`
  },
  basic: {
    label: "Basic (theoretical)",
    fields: [],
    text: () => "□"
  }
};

function formatNumber(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "0";
  }

  return String(Math.round(number * 100) / 100);
}

function signed(value) {
  const number = Number(value) || 0;

  return `${number >= 0 ? "+" : ""}${formatNumber(number)}`;
}

/*
 * ========================================================
 * CREATION
 * ========================================================
 */

function newId(kind) {
  const random =
    typeof globalThis.crypto === "object" &&
    globalThis.crypto &&
    typeof globalThis.crypto.randomUUID === "function"
      ? globalThis.crypto.randomUUID().replace(/-/g, "")
      : Math.random().toString(16).slice(2);

  return `${kind}-${random.slice(0, 8)}`;
}

/*
 * Build an annotation feature.
 *
 * Everything a kind needs is assembled here, so the factory in
 * drawing-state is a straight pass-through and the interaction layer never
 * has to know what fields a table has that an arrow does not.
 */
export function createAnnotate({
  kind = "note",
  text = null,
  position = { x: 0, y: 0 },
  start = null,
  end = null,
  anchor = null,
  targetFeatureId = null,
  anchorRef = null,
  symbolId = null,
  toleranceMode = "symmetric",
  toleranceValues = {},
  rows = 3,
  columns = 3,
  cells = null,
  bends = null,
  style = {},
  name
} = {}) {
  const definition = ANNOTATE_KINDS[kind] || ANNOTATE_KINDS.note;

  /*
   * THE STORED TEXT STARTS EMPTY, NOT AS A PLACEHOLDER.
   *
   * `definition.text` used to be seeded here as the content - "Note",
   * "Leader", "±0.00" - which put a word on the drawing the student never
   * chose and made "has the student written anything yet?" unanswerable. What
   * an empty annotation DISPLAYS is now its placeholder (see displayTextOf),
   * and what it STORES is the empty string. A caller that supplies real text
   * still gets it stored.
   */
  const resolvedText =
    text === null || text === undefined
      ? ""
      : text;

  const geometry = {
    /* Where a point-placed annotation sits, in drawing units. */
    position: {
      x: Number(position?.x) || 0,
      y: Number(position?.y) || 0
    }
  };

  /*
   * A GEOMETRIC KIND CARRIES ITS TWO ENDS.
   *
   * `start` is the pointed end - what the leader touches, or where the
   * arrow flies from - and `end` is where the content sits. Both are
   * drawing coordinates, so the whole annotation is anchored to the
   * drawing and not to the screen.
   */
  if (definition.geometric && start && end) {
    geometry.start = {
      x: Number(start.x) || 0,
      y: Number(start.y) || 0
    };

    geometry.end = {
      x: Number(end.x) || 0,
      y: Number(end.y) || 0
    };
    if (kind === "callout") geometry.position = {...geometry.end};
    /*
     * A LEADER OR CALLOUT MAY CARRY BENDS - the ordered intermediate points
     * between attachment and endpoint. They are stored on the geometry rather
     * than derived, so they save, load, undo and copy with the feature like every
     * other part of it. An arrow carries none: it is a straight mark.
     */
    if (
      (kind === "leader" || kind === "callout") &&
      Array.isArray(bends) &&
      bends.length
    ) {
      geometry.bends = bends
        .filter(
          (bend) =>
            bend &&
            Number.isFinite(Number(bend.x)) &&
            Number.isFinite(Number(bend.y))
        )
        .map((bend) => ({
          x: Number(bend.x),
          y: Number(bend.y)
        }));
    }
  }

  if (kind === "symbol") {
    geometry.symbolId = symbolId || "datum";
  }

  /*
   * ========================================================
   * A LABEL'S ANCHOR IS A POINT ON THE FEATURE IT NAMES
   * ========================================================
   *
   * A label is a POINT-ASSOCIATED annotation: it marks a place on a body and
   * states the body's name there. The place it marks is the ANCHOR, and the text
   * may be moved away from it - which is what the optional leader exists to
   * bridge (see `labelLeaderGap`).
   *
   * The anchor is stored as `geometry.start`, the SAME field a leader's
   * attachment uses, so the renderer, the handles and the leader drawing all
   * read one point and cannot disagree about where the label is attached. The
   * text sits at `geometry.position`, moved on its own.
   *
   * `anchor` is accepted as an explicit point; when it is absent the label's own
   * placement is the anchor, which is the state a label created by a single
   * click is in until its text is dragged away.
   */
  if (kind === "label") {
    const anchorPoint = anchor || position || { x: 0, y: 0 };

    geometry.start = {
      x: Number(anchorPoint.x) || 0,
      y: Number(anchorPoint.y) || 0
    };
  }

  if (kind === "tolerance") {
    geometry.toleranceMode = TOLERANCE_MODES[toleranceMode]
      ? toleranceMode
      : "symmetric";
    geometry.toleranceValues = {
      ...toleranceValues
    };
  }

  if (kind === "table") {
    geometry.rows = clampCount(rows, 1, 50);
    geometry.columns = clampCount(columns, 1, 20);
    geometry.cells = normaliseCells(
      cells,
      geometry.rows,
      geometry.columns
    );
  }

  return {
    id: newId(kind),
    type: "annotate",
    annotateKind: kind,
    name: name || definition.label,
    text: String(resolvedText ?? ""),

    /*
     * WHO the annotation points at. A label, a leader, a callout and a
     * tolerance may all be about a feature; a note, an arrow, a symbol and
     * a table are their own thing. Kept as one field with a null default
     * so the same move/select code serves every kind.
     */
    targetFeatureId: targetFeatureId || null,
    ...(anchorRef ? {anchorRef:structuredClone(anchorRef)} : {}),

    geometry,

    style: {
      fontSize: 12,
      stroke: "#000000",
      align: kind === "callout" ? "center" : "left",
      arrowhead: ["arrow", "leader", "callout"].includes(kind) ? "closed" : "none",
      leaderStyle: "straight",
      ...style
    },

    visible: true
  };
}

function clampCount(value, min, max) {
  const number = Math.round(Number(value));

  if (!Number.isFinite(number)) {
    return min;
  }

  return Math.min(max, Math.max(min, number));
}

/*
 * A grid of cell strings, made to fit the declared size.
 *
 * A stored table with the wrong number of cells would render as a grid
 * with holes in it, so the cell list is reconciled against rows×columns
 * on the way in - kept where it exists, blank where it does not. The table
 * therefore always has exactly the cells its size says it has.
 */
function normaliseCells(cells, rows, columns) {
  const total = rows * columns;
  const given = Array.isArray(cells) ? cells : [];

  return Array.from({ length: total }, (_, index) =>
    given[index] === undefined || given[index] === null
      ? ""
      : String(given[index])
  );
}

/*
 * ========================================================
 * THE PLACEHOLDER SYSTEM
 * ========================================================
 *
 * A text-bearing annotation created without content is a VALID FEATURE that
 * says what the student still has to write. The prompt is a PLACEHOLDER: it is
 * drawn so the empty annotation is visible and legible on the sheet, but it is
 * NOT the student's content and is never stored as such.
 *
 *     content = ""                    the truth
 *     placeholder = "Enter note"      what is shown until there is content
 *
 * NOT the other way round:
 *
 *     content = "Enter note"          a word the student never chose,
 *                                     saved, searched and exported as theirs
 *
 * The distinction matters for saving, searching, exporting, editing and for
 * answering "has the student actually written anything here yet?" - which is a
 * question `hasContent` answers and "is the text non-empty" would answer wrong,
 * because a placeholder makes the stored text non-empty while the content is
 * still empty.
 *
 * EVERY PROMPT IS CONTEXTUAL. "Enter note", "Enter label", "Enter datum" -
 * never a generic "Text"/"Value"/"Input" where a more useful word is possible.
 * A new text-bearing kind follows the same pattern: "Enter <what the student is
 * expected to provide>".
 */
export const PLACEHOLDERS = {
  note: "Enter note",
  label: "Enter label",
  leader: "Enter text",
  callout: "Enter callout",
  symbol: "Enter value",
  tolerance: "Enter tolerance",
  table: "Enter text"
};

/*
 * The prompt for one annotation, which for a symbol depends on WHAT the
 * symbol needs: a datum carries an identifier, a value-carrying symbol a
 * value, and a reference a reference. The kind alone is not always enough.
 */
export function placeholderOf(annotation) {
  if (!annotation) {
    return PLACEHOLDERS.note;
  }

  const kind = annotation.annotateKind;

  if (kind === "symbol") {
    const symbol = SYMBOL_BY_ID[annotation.geometry?.symbolId];

    if (symbol?.placeholder) {
      return symbol.placeholder;
    }

    return PLACEHOLDERS.symbol;
  }

  return PLACEHOLDERS[kind] || "Enter text";
}

/*
 * IS THERE ANY CONTENT, as against a placeholder?
 *
 * The stored text and the drawn content are two different questions: a
 * tolerance's content is composed from its values and a symbol's from its
 * symbol, so neither reads `annotation.text` at all. This asks the same
 * question `displayTextOf` answers, without drawing anything.
 */
export function hasContent(annotation) {
  if (!annotation) {
    return false;
  }

  const kind = annotation.annotateKind;
  const geometry = annotation.geometry || {};

  if (kind === "tolerance") {
    const mode =
      TOLERANCE_MODES[geometry.toleranceMode] ||
      TOLERANCE_MODES.symmetric;

    const values = geometry.toleranceValues || {};

    /*
     * A tolerance has content once every field its mode needs is a real
     * value. A symmetric tolerance with no value, or limits with no upper,
     * is still waiting for the student.
     */
    return mode.fields.every(
      (field) =>
        values[field] !== undefined &&
        values[field] !== null &&
        String(values[field]).trim() !== ""
    );
  }

  if (kind === "symbol") {
    const symbol = SYMBOL_BY_ID[geometry.symbolId];

    /*
     * A symbol WITH a symbol id always has something to draw - the glyph
     * itself - so it is never "empty" in the sense a note can be. Its
     * placeholder applies only to the extra value it may carry.
     */
    return Boolean(symbol && String(annotation.text || "").trim() !== "");
  }

  if (kind === "arrow") {
    return true;
  }

  return String(annotation.text || "").trim() !== "";
}

/*
 * WHAT TO DRAW.
 *
 * The real content when there is any, and the contextual placeholder when
 * there is not - so an empty note is still a visible, editable thing on the
 * sheet rather than nothing at all. The placeholder is returned for DISPLAY
 * only; nothing here writes it back onto the feature.
 */
export function displayTextOf(annotation) {
  if (hasContent(annotation)) {
    return textOf(annotation);
  }

  /*
   * AN ARROW HAS NO TEXT AT ALL, so it never gets a placeholder - there is
   * nothing the student was ever going to type.
   */
  if (annotation.annotateKind === "arrow") {
    return "";
  }

  /*
   * A TABLE'S CONTENT IS ITS CELLS, so a bare table is not "waiting for text"
   * in the way a note is - its empty cells are edited individually and the
   * grid itself is the content. It draws no table-level placeholder.
   */
  if (annotation.annotateKind === "table") {
    return "";
  }

  /*
   * A SYMBOL ALWAYS DRAWS ITS GLYPH. Its placeholder belongs to the value it
   * may carry, which the symbol renderer draws beneath the glyph - so the
   * glyph is still returned here, not replaced.
   */
  if (annotation.annotateKind === "symbol") {
    return textOf(annotation);
  }

  return placeholderOf(annotation);
}

/*
 * Whether what is being drawn is a PLACEHOLDER rather than the student's
 * content. The renderer uses this to draw it in a muted style, so the sheet
 * distinguishes "not written yet" from "written, and it says this".
 */
export function isPlaceholder(annotation) {
  if (!annotation || annotation.annotateKind === "arrow") {
    return false;
  }

  if (
    annotation.annotateKind === "table" ||
    annotation.annotateKind === "symbol"
  ) {
    return false;
  }

  return !hasContent(annotation);
}

/*
 * What an annotation SAYS, as drawn.
 *
 * A tolerance and a symbol render from their own data rather than from
 * free text, because what they state is composed from fields the panel
 * edits - so the drawn text cannot disagree with the values behind it.
 */
export function textOf(annotation) {
  if (!annotation) {
    return "";
  }

  const kind = annotation.annotateKind;
  const geometry = annotation.geometry || {};

  if (kind === "tolerance") {
    const mode =
      TOLERANCE_MODES[geometry.toleranceMode] ||
      TOLERANCE_MODES.symmetric;

    return mode.text(geometry.toleranceValues || {});
  }

  if (kind === "symbol") {
    const symbol = SYMBOL_BY_ID[geometry.symbolId];

    return symbol ? symbol.text : annotation.text || "";
  }

  return annotation.text || "";
}

/*
 * ========================================================
 * THE LEADER PATH: ATTACHMENT -> BENDS -> ENDPOINT
 * ========================================================
 *
 * A leader or a callout is a PEN: an attachment point, zero or more bends, and
 * an endpoint. The bends are the whole reason a leader is useful - they carry
 * the pen around the drawing so it reaches the text without crossing the thing
 * it is annotating - and they are ONE ordered list, not a collection of
 * unrelated segments.
 *
 *     attachment  ->  bend 1  ->  bend 2  ->  endpoint
 *
 * Each consecutive pair is one straight segment, which is why the list is the
 * authoritative shape: inserting a bend and moving a bend are both edits to the
 * SAME list, and the rendered line is always exactly the list joined up. There
 * is deliberately no per-segment object to keep in step.
 */
export function leaderPathPoints(annotation) {
  const geometry = annotation?.geometry;

  if (!geometry?.start || !geometry?.end) {
    return [];
  }

  const bends = Array.isArray(geometry.bends) ? geometry.bends : [];

  return [
    geometry.start,
    ...bends.filter(
      (bend) => bend && Number.isFinite(bend.x) && Number.isFinite(bend.y)
    ),
    geometry.end
  ];
}

/*
 * Insert a bend into a leader's path.
 *
 * The new bend is placed at the MIDPOINT of the segment it splits, so the
 * drawn line does not move when the bend is added - the student then drags it
 * where they want it. Inserting at the segment's midpoint rather than at an
 * index the caller guesses keeps the path CONTINUOUS by construction: the
 * segments either side of it still join the same points they did.
 *
 * `segmentIndex` names the segment whose midpoint is used: 0 is the first
 * segment (attachment -> first bend or endpoint).
 */
export function addLeaderBend(annotation, segmentIndex = 0) {
  const path = leaderPathPoints(annotation);

  if (path.length < 2) {
    return -1;
  }

  const index = Math.min(
    Math.max(0, Math.trunc(Number(segmentIndex)) || 0),
    path.length - 2
  );

  const from = path[index];
  const to = path[index + 1];

  const midpoint = {
    x: (from.x + to.x) / 2,
    y: (from.y + to.y) / 2
  };

  const geometry = annotation.geometry;

  if (!Array.isArray(geometry.bends)) {
    geometry.bends = [];
  }

  /*
   * The bend's index in the STORED list is its index in the path minus the
   * attachment point, which is not stored among the bends.
   */
  geometry.bends.splice(index, 0, midpoint);

  return index;
}

/*
 * Remove a bend and RECONNECT its neighbours.
 *
 * Deleting from the ordered list reconnects the two segments that met at the
 * bend automatically - the segments either side simply become a straight line
 * between the points that remain - so the path can never be left broken.
 */
export function removeLeaderBend(annotation, index) {
  const geometry = annotation?.geometry;

  if (!geometry || !Array.isArray(geometry.bends)) {
    return false;
  }

  const at = Math.trunc(Number(index));

  if (!Number.isFinite(at) || at < 0 || at >= geometry.bends.length) {
    return false;
  }

  geometry.bends.splice(at, 1);

  return true;
}

/*
 * Whether this annotation's kind carries a bendable path.
 */
export function hasLeaderPath(kind) {
  return kind === "leader" || kind === "callout";
}

/*
 * ========================================================
 * HOW MANY ELBOWS A ROUTE MAY HAVE
 * ========================================================
 *
 * A LEADER takes ONE elbow in V1: either a straight route, or a single bend
 * that carries the pen around the thing it annotates. A callout may take more,
 * because a reference balloon often has to reach further across a drawing.
 *
 * Stated HERE, with the kinds, so the panel's Add Bend control, the drag and
 * any future caller read the SAME limit - a second copy of "one" at a call
 * site is a second place for it to become "two".
 */
export function maxBendsFor(kind) {
  if (kind === "leader") {
    return 1;
  }

  if (kind === "callout") {
    return 3;
  }

  return 0;
}

/*
 * Whether this annotation has a drawn body beyond a single point, so the
 * interaction layer and the renderer agree about which kinds flow from a
 * gesture and which do not.
 */
export function isGeometricKind(kind) {
  return ANNOTATE_KINDS[kind]?.geometric === true;
}

/*
 * ========================================================
 * A LABEL'S LEADER APPEARS WITH DISTANCE, AND HIDES AGAIN
 * ========================================================
 *
 * A label sits at the place it marks while its text sits where it is legible,
 * and a small offset needs no line between them. Once the text is more than
 * about 2.5 text heights from the anchor, a leader is drawn so the reader can
 * tell which letter belongs to which point; bring the text back close and the
 * leader disappears.
 *
 * THE THRESHOLD IS IN TEXT HEIGHTS, NOT CANVAS PIXELS, because it is about how
 * the two read together rather than about how far apart they are drawn. That is
 * what makes it correct at every zoom: the gap is measured in the SAME world
 * units as the geometry and compared against the text's own world height, so
 * zooming in does not make a leader appear where none was.
 *
 * Returns whether a leader should be drawn, plus the two endpoints - the anchor
 * and the text position - so the caller draws exactly the line this decided on.
 */
export function labelLeaderGap(annotation, options = {}) {
  const geometry = annotation?.geometry;

  if (!geometry?.start || !geometry?.position) {
    return { show: false, from: null, to: null };
  }

  const fontSize = Number(annotation.style?.fontSize) || 12;

  /*
   * THE WORLD LENGTH OF ONE FONT PIXEL.
   *
   * The threshold is stated in text heights, and a text height is the font size
   * converted into drawing units by the caller's scale. Without a scale the
   * font's own size is used, which keeps the rule meaningful in a model-only
   * context (tests, export) rather than silently doing nothing.
   */
  const worldPerFont =
    Number.isFinite(options.worldPerFontUnit) && options.worldPerFontUnit > 0
      ? options.worldPerFontUnit
      : 1;

  const gapPx =
    Math.hypot(
      geometry.position.x - geometry.start.x,
      geometry.position.y - geometry.start.y
    ) / worldPerFont;

  const thresholdPx = 2.5 * fontSize;

  return {
    show: gapPx > thresholdPx,
    from: { x: geometry.start.x, y: geometry.start.y },
    to: { x: geometry.position.x, y: geometry.position.y }
  };
}

/*
 * ========================================================
 * LABEL NAMES: ONE DRAWING-WIDE SEQUENCE, A..Z then AA, AB
 * ========================================================
 *
 * A label is a short identifier, and a drawing reads best when its labels
 * run A, B, C... rather than "Label 1", "Label 2". The sequence is
 * CONTINUOUS ACROSS THE WHOLE DRAWING - not restarted per body or region -
 * because a reader scans the sheet as one document.
 *
 * IT REUSES THE LOWEST FREE NAME. Delete C and the next label is C again,
 * so a sheet tidied by deleting a stray label does not carry a gap. The
 * sequence is spreadsheets' own column order: A..Z, then AA, AB, ... AZ, BA.
 *
 * The FIRST free name is taken, not the count of labels, so the rule is
 * "fill the first gap" rather than "one more than the last" - which is what
 * makes reuse fall out of the same rule instead of being a second one.
 */
function labelSequenceName(index) {
  let name = "";
  let n = index;

  do {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);

  return name;
}

/*
 * The next label name for a document.
 *
 * Read from the DRAWING STATE, so the sequence is drawing-wide. `state` is
 * optional: without one the first name, "A", is returned, which is the
 * honest answer when there is no drawing yet.
 */
export function nextLabelName(state) {
  const taken = new Set(
    (state?.objects || [])
      .filter(
        (object) =>
          object?.type === "annotate" &&
          object.annotateKind === "label"
      )
      .map((object) => String(object.name || ""))
  );

  /*
   * Bounded generously rather than by a magic count: the sequence is
   * effectively infinite (A..Z, AA..ZZ, AAA...), and the loop stops at the
   * first free name long before any bound is reached on a real sheet. The
   * bound exists only so a pathological document cannot spin forever.
   */
  for (let index = 0; index < 26 * 27; index += 1) {
    const candidate = labelSequenceName(index);

    if (!taken.has(candidate)) {
      return candidate;
    }
  }

  return "A";
}

/*
 * ========================================================
 * MOVEMENT
 * ========================================================
 *
 * One function moves any annotation by a world-space delta. A point-placed
 * one moves its position; a geometric one moves BOTH ends by the same
 * delta, so it keeps its shape and its length and simply relocates - which
 * is what dragging a leader or an arrow means.
 */
export function translateAnnotation(annotation, dx, dy) {
  if (!annotation || !annotation.geometry) {
    return;
  }

  const geometry = annotation.geometry;

  if (geometry.position) {
    geometry.position = {
      x: geometry.position.x + dx,
      y: geometry.position.y + dy
    };
  }

  if (geometry.start) {
    geometry.start = {
      x: geometry.start.x + dx,
      y: geometry.start.y + dy
    };
  }

  if (geometry.end) {
    geometry.end = {
      x: geometry.end.x + dx,
      y: geometry.end.y + dy
    };
  }

  /*
   * A LEADER'S BENDS MOVE WITH IT.
   *
   * Every point of the path is translated by the same delta, so the whole pen
   * relocates and keeps its shape - which is what dragging a leader means. A
   * bend left behind would tear the path apart.
   */
  if (Array.isArray(geometry.bends)) {
    geometry.bends = geometry.bends.map((bend) => ({
      x: bend.x + dx,
      y: bend.y + dy
    }));
  }
}

/*
 * The points that bound an annotation, for Fit, the selection box and hit
 * testing. Computed from the stored geometry, so it is right at any zoom.
 */
export function textBoundsOf(annotation, state = {}) {
  if (!annotation || annotation.visible === false) return null;
  if (annotation.annotateKind === "callout") return calloutBox(annotation, state);
  const at = annotation.geometry?.position || annotation.geometry?.end || annotation.geometry?.start;
  const text = displayTextOf(annotation);
  if (!at || !text) return null;
  const zoom = Number(state.camera?.zoom) || 1;
  const scale = 2.4 * zoom;
  const typography = noteTextStyle(annotation.style);
  const baseFont = Number(annotation.style?.fontSize) || 12;
  const font = noteFontPixels(annotation.style, zoom);
  const lines = String(text).split("\n");
  const isNote = annotation.annotateKind === "note";
  const width = noteTextWidth(text, annotation.style, font) / scale;
  const lineHeight = isNote ? font * typography.lineSpacing : baseFont * 1.2;
  const height = (font * 1.2 + (lines.length - 1) * lineHeight) / scale;
  const align = annotation.style?.align;
  const indent = isNote ? typography.indent : 0;
  const left = at.x + indent - (align === "center" ? width / 2 : align === "right" ? width : 0);
  const padding = 3 / scale;
  return { minX: left - padding, maxX: left + width + padding,
    minY: at.y - height / 2 - padding, maxY: at.y + height / 2 + padding };
}

export function calloutBox(annotation, state = {}) {
  const at = annotation.geometry?.end || annotation.geometry?.position;
  if (!at) return null;
  const zoom = Number(state.camera?.zoom) || 1;
  const scale = 2.4 * zoom;
  const font = noteFontPixels(annotation.style, zoom);
  const text = displayTextOf(annotation);
  let width = Math.max(20, noteTextWidth(text, annotation.style, font) + 10) / scale;
  let height = Math.max(20, String(text).split("\n").length * font * 1.2 + 6) / scale;
  if (annotation.style?.calloutShape === "circle") width = height = Math.hypot(width,height);
  return {minX:at.x-width/2,maxX:at.x+width/2,minY:at.y-height/2,maxY:at.y+height/2};
}

export function boundsOf(annotation, state = {}) {  if (!annotation || !annotation.geometry) {
    return [];
  }

  const geometry = annotation.geometry;
  const points = [];
  const textBox = textBoundsOf(annotation, state);
  if (textBox) points.push({x:textBox.minX,y:textBox.minY}, {x:textBox.maxX,y:textBox.maxY});

  if (geometry.position) {
    points.push(geometry.position);
  }

  if (geometry.start) {
    points.push(geometry.start);
  }

  if (geometry.end) {
    points.push(geometry.end);
  }

  /*
   * AND EVERY BEND, so Fit, box selection and the selection box all cover the
   * pen the student can actually see - a leader swept up by a box that crosses
   * one of its bends must be selected.
   */
  if (Array.isArray(geometry.bends)) {
    geometry.bends.forEach((bend) => {
      if (bend && Number.isFinite(bend.x) && Number.isFinite(bend.y)) {
        points.push(bend);
      }
    });
  }

  if (annotation.annotateKind === "table") {
    points.push({
      x: geometry.position.x + tableWidthOf(annotation),
      y: geometry.position.y + tableHeightOf(annotation)
    });
  }

  return points;
}

const TABLE_CELL_W = 60;
const TABLE_CELL_H = 22;

export function tableWidthOf(annotation) {
  const columns = Number(annotation?.geometry?.columns) || 1;

  return columns * TABLE_CELL_W;
}

export function tableHeightOf(annotation) {
  const rows = Number(annotation?.geometry?.rows) || 1;

  return rows * TABLE_CELL_H;
}

/*
 * WHICH CELL A POINT IS IN, from the table's own geometry.
 *
 * The table is a grid of fixed cell size anchored at its position, so a world
 * point maps to a cell by simple division - the SAME layout the renderer draws
 * from, so a double-click lands in the cell the student sees. Returns the cell
 * INDEX (row * columns + column), or null when the point is outside the table.
 */
export function tableCellAt(annotation, point) {
  const geometry = annotation?.geometry;

  if (!geometry?.position || !point) {
    return null;
  }

  const rows = Math.max(1, Number(geometry.rows) || 1);
  const columns = Math.max(1, Number(geometry.columns) || 1);

  const dx = point.x - geometry.position.x;
  const dy = point.y - geometry.position.y;

  if (dx < 0 || dy < 0) {
    return null;
  }

  const column = Math.floor(dx / TABLE_CELL_W);
  const row = Math.floor(dy / TABLE_CELL_H);

  if (row >= rows || column >= columns) {
    return null;
  }

  return row * columns + column;
}

/*
 * ========================================================
 * TABLE ROW AND COLUMN OPERATIONS
 * ========================================================
 *
 * Every one of these REBUILDS the cell grid from the stored rows and columns,
 * moving each existing cell to its place in the new shape - so a row added at
 * the bottom leaves every cell above it untouched, a column added at the right
 * leaves the rest of each row in order, and a deletion removes the right cells
 * and keeps the others. There is one reconcile function (`resizeCells`) behind
 * all four, so the arithmetic that maps old positions to new cannot be written
 * four times and diverge.
 *
 * The table's OWN `rows`/`columns` are the source of truth; the cell list is
 * always exactly rows*columns long, which is what stops a grid with holes.
 */
function resizeCells(cells, oldRows, oldColumns, newRows, newColumns, mapper) {
  const grid = [];

  for (let row = 0; row < newRows; row += 1) {
    grid.push(new Array(newColumns).fill(""));
  }

  for (let row = 0; row < oldRows; row += 1) {
    for (let column = 0; column < oldColumns; column += 1) {
      const target = mapper(row, column, oldRows, oldColumns);

      if (!target) {
        continue;
      }

      const [nextRow, nextColumn] = target;

      if (
        nextRow >= 0 &&
        nextRow < newRows &&
        nextColumn >= 0 &&
        nextColumn < newColumns
      ) {
        grid[nextRow][nextColumn] = cells[row * oldColumns + column] ?? "";
      }
    }
  }

  return grid.flat();
}

function tableShape(annotation) {
  const geometry = annotation?.geometry || {};

  return {
    rows: Math.max(1, Number(geometry.rows) || 1),
    columns: Math.max(1, Number(geometry.columns) || 1),
    cells: Array.isArray(geometry.cells) ? geometry.cells : []
  };
}

function applyShape(annotation, rows, columns, cells) {
  annotation.geometry.rows = rows;
  annotation.geometry.columns = columns;
  annotation.geometry.cells = cells;
}

/* Append a row at the bottom; every existing cell keeps its position. */
export function addTableRow(annotation, at = null) {
  const { rows, columns, cells } = tableShape(annotation);

  const index =
    at === null || at === undefined
      ? rows
      : Math.max(0, Math.min(rows, Math.trunc(at)));

  const next = resizeCells(cells, rows, columns, rows + 1, columns, (row, column) =>
    row >= index ? [row + 1, column] : [row, column]
  );

  applyShape(annotation, rows + 1, columns, next);

  return true;
}

/* Delete a row; the rows below move up and nothing else changes. */
export function deleteTableRow(annotation, at = null) {
  const { rows, columns, cells } = tableShape(annotation);

  if (rows <= 1) {
    return false;
  }

  const index =
    at === null || at === undefined
      ? rows - 1
      : Math.max(0, Math.min(rows - 1, Math.trunc(at)));

  const next = resizeCells(cells, rows, columns, rows - 1, columns, (row, column) =>
    row === index ? null : row > index ? [row - 1, column] : [row, column]
  );

  applyShape(annotation, rows - 1, columns, next);

  return true;
}

/* Append a column at the right; each row's cells keep their order. */
export function addTableColumn(annotation, at = null) {
  const { rows, columns, cells } = tableShape(annotation);

  const index =
    at === null || at === undefined
      ? columns
      : Math.max(0, Math.min(columns, Math.trunc(at)));

  const next = resizeCells(cells, rows, columns, rows, columns + 1, (row, column) =>
    column >= index ? [row, column + 1] : [row, column]
  );

  applyShape(annotation, rows, columns + 1, next);

  return true;
}

/* Delete a column; the columns to its right move left. */
export function deleteTableColumn(annotation, at = null) {
  const { rows, columns, cells } = tableShape(annotation);

  if (columns <= 1) {
    return false;
  }

  const index =
    at === null || at === undefined
      ? columns - 1
      : Math.max(0, Math.min(columns - 1, Math.trunc(at)));

  const next = resizeCells(cells, rows, columns, rows, columns - 1, (row, column) =>
    column === index ? null : column > index ? [row, column - 1] : [row, column]
  );

  applyShape(annotation, rows, columns - 1, next);

  return true;
}

/*
 * ========================================================
 * THE PUBLIC SURFACE
 * ========================================================
 */
const enggAnnotate = {
  ANNOTATE_KINDS,
  SYMBOL_LIBRARY,
  SYMBOL_BY_ID,
  TOLERANCE_MODES,
  createAnnotate,
  textOf,
  PLACEHOLDERS,
  placeholderOf,
  hasContent,
  displayTextOf,
  isPlaceholder,
  isGeometricKind,
  labelLeaderGap,
  labelSequenceName,
  nextLabelName,
  leaderPathPoints,
  addLeaderBend,
  removeLeaderBend,
  hasLeaderPath,
  maxBendsFor,
  translateAnnotation,
  boundsOf,
  textBoundsOf,
  calloutBox,
  tableWidthOf,
  tableHeightOf,
  tableCellAt,
  addTableRow,
  addTableColumn,
  deleteTableRow,
  deleteTableColumn,
  TABLE_CELL_W,
  TABLE_CELL_H
};

export default enggAnnotate;
