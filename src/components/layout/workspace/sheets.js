/*
 * Drawing sheets: the first-class parts a DAETUM document is made of.
 *
 * A document is not one drawing, it is an ordered list of drawings. A
 * structural problem, its free body diagram, its shear force diagram
 * and its bending moment diagram are four separate sheets, each with
 * its own features, its own view and its own grid - and a sheet is a
 * thing a student can rename, duplicate, reorder and delete, exactly
 * like a worksheet in Excel.
 *
 * THE TWO IDENTITIES
 * ------------------
 * Every sheet carries TWO names, and keeping them apart is the whole
 * reason this module exists:
 *
 *   id    "sheet_8f31a"    permanent, minted once, never changes
 *   name  "Free Body Diagram"   what the user typed, changes freely
 *
 * Anything that points AT a sheet - a figure reference in the written
 * solution, a cross-reference, a caption - points at the id. The name
 * is a label the user is free to change at any moment, so a reference
 * built on it would silently start pointing at nothing the first time
 * somebody tidied up their tabs. The id is never reassigned, not on
 * rename, not on reorder, not on duplicate (a duplicate mints a new
 * one), so a reference made today still resolves in a file saved next
 * year.
 *
 * WHY SHEETS OWN THEIR CONTENT
 * ----------------------------
 * A sheet carries a full copy of the drawing state: its features, its
 * parent/child links, its units, its snapping, its style defaults, its
 * camera and its grid. Not "its own geometry" - its own EVERYTHING.
 * That is what makes switching sheets feel like switching documents
 * rather than hiding things, and it is why two sheets can show the
 * same figure at completely different zooms without either one
 * knowing the other exists.
 *
 * The live editor works on ONE sheet at a time. Rather than teach
 * every feature, every snapping candidate and every hit-test about
 * sheets - which would mean threading a sheet filter through thousands
 * of lines that have no business knowing - the editor loads the active
 * sheet's content into the single state it already has, and switching
 * sheets saves what is in that state back onto the sheet it came from
 * and loads the next one in. The consequence is the guarantee we
 * actually need: an inactive sheet has nothing in the editor at all,
 * so it cannot be selected, snapped to, dragged, or accidentally
 * modified by a tool that was still active when the user switched.
 *
 * The editor owns the live state object; this module owns the
 * collection and the rules about it. Neither knows about files.
 */
import { activeSourceManager } from "../../../shared/rendering/latex/drawing-source-manager.js";
import { reconcileSourceWithObjects } from "../../../shared/rendering/latex/source-synchronization.js";

const SHEET_ID_PREFIX = "sheet_";

/*
 * A sheet id.
 *
 * Short, prefixed so that it is recognisable in a saved file, and
 * random rather than sequential so that ids never collide and never
 * imply an order. The order lives in the list; the id must not
 * carry it, because reordering must not be able to change anything
 * that points at a sheet.
 */
function newSheetId() {
  const random =
    globalThis.crypto &&
    typeof globalThis.crypto.randomUUID === "function"
      ? globalThis.crypto.randomUUID().replace(/-/g, "")
      : Math.random().toString(16).slice(2) +
        Math.random().toString(16).slice(2);

  return SHEET_ID_PREFIX + random.slice(0, 8);
}

function isSheetId(value) {
  return (
    typeof value === "string" &&
    value.length > SHEET_ID_PREFIX.length
  );
}

/*
 * An id that is not in use.
 *
 * Only needed for hand-written or repaired files, where a duplicated
 * id would silently merge two sheets into one. Random ids make it
 * vanishingly unlikely, but a file is user-editable and a merge is
 * silent data loss, so it is checked rather than assumed.
 */
function uniqueSheetId(collection) {
  const taken = new Set(
    (collection.sheets || []).map((sheet) => sheet.id)
  );

  let id = newSheetId();

  while (taken.has(id)) {
    id = newSheetId();
  }

  return id;
}

/*
 * The name a new sheet gets when the user has not named it.
 *
 * Numbered by POSITION among the unnamed default names, so the tabs
 * read "Sheet 1, Sheet 2, Sheet 3" the way the user expects. A sheet
 * that has been renamed is left alone - the count only grows to
 * avoid reusing a name that is already on screen.
 */
function defaultSheetName(collection) {
  const used = new Set(
    (collection.sheets || []).map((sheet) => sheet.name)
  );

  let index = (collection.sheets || []).length + 1;

  while (used.has(`Sheet ${index}`)) {
    index += 1;
  }

  return `Sheet ${index}`;
}

/*
 * The content of a sheet that has never been drawn on.
 *
 * Deliberately the SAME shape a loaded sheet has, so that every read
 * of a sheet can assume its fields exist. A sheet is never
 * "partly present"; it is either fully here or it is a file that
 * needs repairing.
 */
function createSheetContent(overrides) {
  return {
    version: 1,
    units: "mm",
    objects: [],
    snap: {
      enabled: true,
      spacing: 1
    },
    objectSnap: {
      enabled: true,
      tolerancePx: 10,
      inferenceTolerancePx: 24
    },
    styleDefaults: {
      stroke: "#000000",
      fill: "none",
      lineWidth: 0.5,
      lineType: "solid",
      opacity: 1
    },
    viewport: {
      zoom: 1,
      panX: 0,
      panY: 0
    },
    grid: resolveGridSnap({
      visible: true,
      spacing: 7.5,
      /*
       * GRID SNAP IS ITS OWN SETTING, NOT THE GRID'S VISIBILITY.
       *
       * Visibility says whether the ruled sheet is DRAWN; `snapToGrid` says
       * whether an input coordinate is CONSTRAINED to that lattice. They move
       * together by default - showing the grid turns snapping on - but they are
       * two facts and the user can part them: the grid can stay visible with
       * snapping off, which is the whole point of having both.
       *
       * Stored on the sheet so a drawing reopened shows the state it was saved
       * with, rather than whichever sheet happened to be written last.
       */
      snapToGrid: true,
      ...(overrides?.grid || {})
    }),


    /*
     * THE SHEET'S DRAWING SOURCE.
     *
     * Each sheet is its own picture: the TikZ that draws THIS sheet's
     * features. `null` for a sheet that has never had one - it is created
     * empty by the source manager when the sheet is first shown, rather
     * than being guessed at here.
     */
    source: null,

    ...overrides
  };
}

/*
 * ============================================================
 * GRID SNAP IS RESOLVED ONCE, FOR EVERY SHEET THAT EVER EXISTS
 * ============================================================
 *
 * A drawing saved before grid snap was its own setting carries a grid with a
 * `visible` flag and a `spacing`, and nothing else. The merged result above
 * would then keep this factory's default `snapToGrid: true` even when the saved
 * grid was hidden - so an old file with the grid off would come back with grid
 * snapping on, contradicting the very rule the switch applies.
 *
 * The resolution is written HERE, at the one funnel every sheet passes through
 * - new, loaded, duplicated, migrated - rather than at each call site. A sheet
 * cannot arrive without an answer, and there is no second place for the rule to
 * disagree with itself.
 *
 * The fallback follows VISIBILITY, which is exactly what the Grid switch does:
 * a sheet with no recorded grid-snap state is treated as the drawing it was,
 * where showing the grid meant snapping to it.
 */
function resolveGridSnap(grid) {
  if (!grid || typeof grid !== "object") {
    return grid;
  }

  if (grid.snapToGrid !== undefined) {
    return grid;
  }

  return {
    ...grid,
    snapToGrid: grid.visible !== false
  };
}

function createSheet(collection, options = {}) {
  const content = createSheetContent(options.content);

  const sheet = {
    id: options.id || uniqueSheetId(collection),
    name: options.name || defaultSheetName(collection),
    version: content.version,
    units: content.units,
    objects: content.objects,
    snap: content.snap,
    objectSnap: content.objectSnap,
    styleDefaults: content.styleDefaults,
    viewport: content.viewport,
    grid: content.grid,


    /*
     * THE SHEET'S OWN DRAWING SOURCE.
     *
     * Listed here for the same reason the scale is: a field left out of
     * this object is a field the sheet does not have. A duplicated sheet
     * would otherwise silently lose the picture it was duplicated from,
     * and one read back from a file would lose it entirely.
     */
    source: content.source
      ? { ...content.source }
      : null
  };

  /*
   * A supplied id is only honoured when nothing is using it. A file
   * that lists the same id twice would otherwise present two tabs
   * that both answer to one reference.
   */
  if (
    (collection.sheets || []).some(
      (candidate) => candidate.id === sheet.id
    )
  ) {
    sheet.id = uniqueSheetId(collection);
  }

  if (options.at === undefined || options.at === null) {
    (collection.sheets =
      collection.sheets || []).push(sheet);
  } else {
    collection.sheets.splice(
      Math.max(
        0,
        Math.min(options.at, collection.sheets.length)
      ),
      0,
      sheet
    );
  }

  return sheet;
}

/*
 * The document's sheets, from whatever a file or the editor had.
 *
 * A document ALWAYS has at least one sheet. Not because a drawing
 * needs content - a blank document is perfectly valid - but because
 * the editor, the file format and every reference all ask "which
 * sheet?" without a way to express "none". Answering that question
 * once, here, is what keeps the null case out of every other module.
 */
function createCollection(input) {
  const collection = {
    version: 1,
    sheets: [],
    activeSheetId: null
  };

  const sheets = Array.isArray(input?.sheets)
    ? input.sheets
    : null;

  if (!sheets || !sheets.length) {
    const first = createSheet(collection);

    collection.activeSheetId = first.id;

    return collection;
  }

  collection.sheets = sheets.map((sheet) => {
    /*
     * A sheet is stored FLAT: its own id, name, objects, viewport
     * and grid sit side by side, because that is what a saved file
     * should look like and what a person reading one expects to
     * find. So a stored sheet IS its own content; the wrapper only
     * ever existed while a sheet was being created.
     *
     * A sheet that has been given its fields through a `content`
     * object instead is still accepted, so a caller holding a
     * partially built sheet is not left with a half-populated one.
     */
    const source = sheet?.content
      ? { ...sheet, ...sheet.content }
      : sheet || {};

    const content = createSheetContent(source);

    return {
      id: isSheetId(sheet?.id)
        ? sheet.id
        : newSheetId(),
      name:
        typeof sheet?.name === "string" && sheet.name.trim()
          ? sheet.name
          : "Sheet",
      version: content.version,
      units: content.units,
      objects: Array.isArray(content.objects)
        ? content.objects
        : [],
      snap: content.snap,
      objectSnap: content.objectSnap,
      styleDefaults: content.styleDefaults,
      viewport: content.viewport,
      grid: content.grid,

    };
  });

  /*
   * An id repeated in a file would make two tabs that a single
   * reference cannot tell apart. The second one is given a fresh id
   * rather than dropped, so nothing the user saved is lost.
   */
  const taken = new Set();

  collection.sheets.forEach((sheet) => {
    while (taken.has(sheet.id)) {
      sheet.id = newSheetId();
    }

    taken.add(sheet.id);
  });

  /*
   * The active sheet is restored by id, and falls back to the first
   * sheet only when the id is unknown. Falling back rather than
   * failing is deliberate: a file whose active sheet was removed by
   * hand should still open onto a usable drawing.
   */
  const requested = input?.activeSheetId;

  collection.activeSheetId =
    taken.has(requested)
      ? requested
      : collection.sheets[0].id;

  return collection;
}

function sheetById(collection, sheetId) {
  return (
    (collection?.sheets || []).find(
      (sheet) => sheet.id === sheetId
    ) || null
  );
}

function activeSheet(collection) {
  return (
    sheetById(collection, collection?.activeSheetId) ||
    (collection?.sheets || [])[0] ||
    null
  );
}

function sheetIndex(collection, sheetId) {
  return (collection?.sheets || []).findIndex(
    (sheet) => sheet.id === sheetId
  );
}

/*
 * Add a blank sheet and make it active.
 *
 * Blank rather than a copy of the sheet in front of it: a new sheet
 * is a new drawing, and silently duplicating the student's work
 * every time they press + would be a surprising way to lose track of
 * what is where. Duplicate is an explicit act, available on the tab.
 */
function addSheet(collection, options = {}) {
  const sheet = createSheet(collection, options);

  collection.activeSheetId = sheet.id;

  return sheet;
}

/*
 * Rename a sheet.
 *
 * The id is NOT touched. This is the entire reason a sheet has an id
 * at all, and the reason a reference made before the rename still
 * resolves after it.
 */
function renameSheet(collection, sheetId, name) {
  const sheet = sheetById(collection, sheetId);

  if (!sheet) {
    return null;
  }

  const trimmed = String(name || "").trim();

  if (!trimmed) {
    return sheet;
  }

  sheet.name = trimmed;

  return sheet;
}

/*
 * Copy a sheet, contents and all, as an independent drawing.
 *
 * Two things make a copy a real copy rather than an alias:
 *
 *   - The new sheet gets its OWN id, so a reference to the original
 *     still points at the original and a new reference to the copy
 *     points at the copy.
 *
 *   - Every feature inside gets its OWN id, remapped together with
 *     the parent links that point at them. Copying features without
 *     remapping would give two sheets sets of identically-named ids;
 *     that survives today (they are separate lists) and corrupts the
 *     moment anything compares or crosses over - a paste between
 *     sheets, a reference to a feature, a delete that finds two
 *     things where it expected one.
 *
 * The parent ids are remapped through the SAME table, so a force
 * copied along with its beam is still the beam's child in the copy,
 * exactly as it was in the original.
 */
function duplicateSheet(collection, sheetId, options = {}) {
  const source = sheetById(collection, sheetId);

  if (!source) {
    return null;
  }

  const idMap = new Map();

  const objects = source.objects.map((object) => {
    const copyId = newFeatureId(object.type);

    idMap.set(object.id, copyId);

    return JSON.parse(
      JSON.stringify(object)
    );
  });

  objects.forEach((object, index) => {
    const original = source.objects[index];

    object.id = idMap.get(object.id) || newFeatureId(original.type);

    if (original.parentId && idMap.has(original.parentId)) {
      object.parentId = idMap.get(original.parentId);
    } else if (original.parentId) {
      /*
       * A parent that is not in this sheet cannot be remapped. A
       * child is only ever a child of something on its own sheet,
       * so this is a damaged file; the link is dropped rather than
       * left pointing at an id that means nothing here.
       */
      object.parentId = undefined;
    }
  });

  const index = sheetIndex(collection, source.id);

  const copy = createSheet(collection, {
    name:
      options.name ||
      nextCopyName(collection, source.name),
    at: index === -1 ? undefined : index + 1,
    content: {
      version: source.version,
      units: source.units,
      objects,
      snap: JSON.parse(JSON.stringify(source.snap)),
      objectSnap: JSON.parse(
        JSON.stringify(source.objectSnap)
      ),
      styleDefaults: JSON.parse(
        JSON.stringify(source.styleDefaults)
      ),
      viewport: { ...source.viewport },
      grid: { ...source.grid },

    }
  });

  collection.activeSheetId = copy.id;

  return copy;
}

/*
 * A free name for a duplicate.
 *
 * "FBD" duplicated becomes "FBD copy", and duplicating the copy
 * becomes "FBD copy 2" rather than "FBD copy copy".
 */
function nextCopyName(collection, name) {
  const used = new Set(
    (collection.sheets || []).map((sheet) => sheet.name)
  );

  const base = name || "Sheet";

  if (!used.has(`${base} copy`)) {
    return `${base} copy`;
  }

  let index = 2;

  while (used.has(`${base} copy ${index}`)) {
    index += 1;
  }

  return `${base} copy ${index}`;
}

/*
 * Remove a sheet.
 *
 * The last sheet is never removed. A document with no sheets cannot
 * be edited, cannot be saved and cannot be recovered, so the one
 * case where deletion would leave the user with nothing is refused
 * rather than handled.
 *
 * The new active sheet is the neighbour the user was already looking
 * at - the one to the right, or the one to the left if the deleted
 * sheet was last - so that deleting a middle tab does not jump the
 * view somewhere unrelated.
 */
function deleteSheet(collection, sheetId) {
  if ((collection?.sheets || []).length <= 1) {
    return null;
  }

  const index = sheetIndex(collection, sheetId);

  if (index === -1) {
    return null;
  }

  const wasActive =
    collection.activeSheetId === sheetId;

  collection.sheets.splice(index, 1);

  if (wasActive) {
    collection.activeSheetId =
      collection.sheets[
        Math.min(index, collection.sheets.length - 1)
      ].id;
  }

  return true;
}

/*
 * Move a sheet one place left or right.
 *
 * Only the ORDER changes. Ids, contents, viewports and every
 * reference are untouched, which is exactly what makes reordering
 * safe: nothing that points at a sheet can be broken by moving it,
 * because nothing that points at a sheet knows where it is.
 */
function moveSheet(collection, sheetId, delta) {
  const index = sheetIndex(collection, sheetId);

  if (index === -1) {
    return false;
  }

  const next = index + delta;

  if (next < 0 || next >= collection.sheets.length) {
    return false;
  }

  const [sheet] = collection.sheets.splice(index, 1);

  collection.sheets.splice(next, 0, sheet);

  return true;
}

/*
 * Put a sheet at a position, for dragging a tab.
 *
 * Same guarantee as moveSheet: the sheet keeps its id, so a drag
 * cannot break a reference. The clamp means a tab dragged past the
 * end lands at the end rather than disappearing.
 */
function reorderSheet(collection, sheetId, targetIndex) {
  const index = sheetIndex(collection, sheetId);

  if (index === -1) {
    return false;
  }

  const next = Math.max(
    0,
    Math.min(
      Number(targetIndex) || 0,
      collection.sheets.length - 1
    )
  );

  if (next === index) {
    return false;
  }

  const [sheet] = collection.sheets.splice(index, 1);

  collection.sheets.splice(next, 0, sheet);

  return true;
}

/*
 * A feature id, minted the same way features are minted when they
 * are drawn. Duplicating a sheet has to produce ids that cannot
 * collide with the ones it copied, in the same way drawing a feature
 * produces an id that cannot collide with an existing one.
 */
function newFeatureId(type) {
  const generated =
    globalThis.crypto &&
    typeof globalThis.crypto.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return `${type || "feature"}-${generated}`;
}

/*
 * A sheet carries content, not a live editor state: no selection,
 * no in-progress tool, no undo history.
 *
 * Those are properties of a SESSION - what the student is doing right
 * now - not of a drawing. Saving them would mean reopening a file
 * mid-drag, with a feature half-placed and a selection still
 * highlighted. The editor keeps its own; the sheet keeps the drawing.
 */
function captureSheetContent(state) {
  return {
    version: state.version,
    units: state.units,
    objects: JSON.parse(JSON.stringify(state.objects)),
    snap: { ...state.snap },
    objectSnap: { ...state.objectSnap },
    styleDefaults: { ...state.styleDefaults },
    viewport: {
      zoom: state.camera.zoom,
      panX: state.camera.panX,
      panY: state.camera.panY
    },
    grid: { ...state.grid },


    /*
     * THE SHEET'S DRAWING SOURCE, CAPTURED WITH IT.
     *
     * The manager holds the ACTIVE sheet's source - that is the sheet
     * being edited - so capture is a read of the manager, not of the
     * editor state. The serialized form carries the draft and the last
     * rendered version, so a sheet switched away from and back to keeps
     * both its text and its rendering state.
     */
    source: activeSourceManager().serialize()
  };
}

/*
 * Put a captured editor state onto a sheet.
 *
 * The whole editor state in, the whole sheet out. Written as one
 * operation on purpose: a sheet whose features are current but whose
 * viewport is two edits old is worse than one that is simply wrong,
 * because it looks right.
 *
 * The fields are taken from what was captured, never left as they
 * were. A grid left over from the sheet the user just left would
 * mean two sheets silently disagreeing about whether a grid is on,
 * and the next export would reproduce whichever was written last.
 */
function applySheetContent(sheet, content) {
  if (!sheet) {
    return sheet;
  }

  const next = createSheetContent(content);

  sheet.version = next.version;
  sheet.units = next.units;

  sheet.objects = JSON.parse(
    JSON.stringify(next.objects)
  );

  sheet.snap = { ...next.snap };
  sheet.objectSnap = { ...next.objectSnap };
  sheet.styleDefaults = {
    ...next.styleDefaults
  };
  sheet.viewport = { ...next.viewport };
  sheet.grid = { ...next.grid };


  /*
   * THE SHEET'S DRAWING SOURCE, WRITTEN BACK WITH IT.
   *
   * The manager holds the active sheet's source; this is where a sheet
   * being left behind receives its copy. Taken from what was captured,
   * never left as it was - the same rule every other field here follows.
   */
  sheet.source = next.source
    ? { ...next.source }
    : null;

  return sheet;
}

/*
 * Put a sheet's content into a live editor state.
 *
 * The mirror of applySheetContent, and the reason switching sheets
 * needs no other code: the editor IS the active sheet. Its features
 * are the sheet's features, its camera is the sheet's view, its grid
 * is the sheet's grid - including that grid's visibility, which is
 * why a sheet can arrive with the grid off and mean it.
 *
 * Nothing that belonged to the previous sheet survives into this
 * one. Selection, hover and a half-drawn tool all refer to geometry
 * that is no longer on screen; carrying them across is how a drag
 * that began on one sheet ends up moving a feature on another.
 */
function loadSheet(state, sheet) {
  if (!sheet) {
    return state;
  }

  const content = createSheetContent(sheet);

  state.version = content.version;
  state.units = content.units;

  state.objects = JSON.parse(
    JSON.stringify(content.objects)
  );

  state.snap = { ...content.snap };
  state.objectSnap = { ...content.objectSnap };
  state.styleDefaults = {
    ...content.styleDefaults
  };
  state.grid = { ...content.grid };


  /*
   * THE SHEET'S DRAWING SOURCE, LOADED WITH IT.
   *
   * The manager becomes this sheet's source - or an empty one when the
   * sheet has never had any, from which the reconciliation below adds the
   * sheet's objects. A source is not carried across sheets, for the same
   * reason a selection is not: it belongs to the picture it draws.
   *
   * RECONCILIATION. A sheet loaded from a file that predates the source,
   * or whose text was emptied, does not describe its objects. The text is
   * brought up to date by ADDING the missing objects - never by rewriting
   * what is there, so a student's own TikZ and formatting survive. This is
   * the one place a load can leave the two representations disagreeing, so
   * it is the one place reconciliation runs.
   */
  const manager = activeSourceManager();

  manager.restore(content.source || null);

  /*
   * A SHEET IS A DIFFERENT PICTURE. The compiled results for the sheet the
   * student came from say nothing about this one, so they are dropped before
   * anything is asked to draw - a cached picture keyed on a revision number
   * would otherwise be reused for a completely different drawing.
   *
   * REACHED BY NAME, NOT BY IMPORT. `canvas-render.js` imports the editor
   * state, which imports this module, so a direct import would close a cycle
   * and the module would read its own imports half-built. The border between
   * modules is crossed through the published object instead.
   */
  globalThis.enggDrawingPictureCache?.reset?.();

  /*
   * AND THE NEW SHEET'S SOURCE IS MADE TO REPRESENT ITS OBJECTS, from the
   * writers that know each one's type - never from an empty `object.source`.
   */
  reconcileSourceWithObjects(manager, state.objects, { state });

  state.camera.zoom =
    Number(content.viewport.zoom) || 1;
  state.camera.panX =
    Number(content.viewport.panX) || 0;
  state.camera.panY =
    Number(content.viewport.panY) || 0;

  /*
   * Nothing that belonged to the previous sheet survives into this
   * one. Selection, hover, a half-drawn tool and a running
   * manipulation all refer to geometry that is no longer on screen;
   * carrying them across is how a drag that began on one sheet ends
   * up moving a feature on another.
   */
  state.selection.selectedObjectIds = [];
  state.selection.boxSelectionIds = [];
  state.selection.hoveredObjectId = null;

  return state;
}

/*
 * The document, as it is written to a file or to the recovery copy.
 *
 * Sheets AND the active one, because "which sheet was I on" is part
 * of the document, not part of the window. Reopening a file should
 * put the student back where they left off, exactly as the existing
 * format already restores the camera, the units and the grid.
 */
function serializeCollection(collection) {
  return {
    version: 1,
    sheets: (collection.sheets || []).map((sheet) => ({
      ...JSON.parse(JSON.stringify(sheet)),
      id: sheet.id,
      name: sheet.name
    })),
    activeSheetId: collection.activeSheetId
  };
}

const enggSheets = {
  SHEET_ID_PREFIX,
  activeSheet,
  addSheet,
  applySheetContent,
  captureSheetContent,
  createCollection,
  createSheetContent,
  defaultSheetName,
  deleteSheet,
  duplicateSheet,
  isSheetId,
  loadSheet,
  moveSheet,
  newSheetId,
  renameSheet,
  reorderSheet,
  resolveGridSnap,
  serializeCollection,
  sheetById,
  sheetIndex
};

export default enggSheets;
