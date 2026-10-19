/*
 * The native EnggDraw project format.
 *
 * A .enggdraw file is the AUTHORITATIVE, editable document. It holds the whole
 * document model: sheets, each holding features with their real type, geometry,
 * parent and parameters. That is what makes a reopened drawing selectable,
 * draggable and editable.
 *
 * The file format is a compatibility contract, so it owns its own envelope,
 * version number, and migration path.
 */

import enggSheets from "../../components/layout/workspace/sheets.js";

const FORMAT = "enggdraw";

/*
 * The version this build WRITES.
 */
const CURRENT_VERSION = 2;

/*
 * The oldest version this build can still read.
 */
const MINIMUM_SUPPORTED_VERSION = 1;

const EXTENSION = "enggdraw";

const MEDIA_TYPE = "application/vnd.enggdraw+json";

/*
 * Wrap a serialised document in the envelope.
 */
function createDocument(document) {
  return {
    format: FORMAT,
    version: CURRENT_VERSION,
    application: "EnggDraw",
    savedAt: new Date().toISOString(),
    document,
  };
}

const Failure = {
  NOT_JSON: "not-json",
  WRONG_FORMAT: "wrong-format",
  TOO_OLD: "too-old",
  FROM_THE_FUTURE: "from-the-future",
  NO_DOCUMENT: "no-document",
};

/* ------------------------------------------------------- migrations */

const MIGRATIONS = {};

/*
 * Version 1 -> version 2: a drawing became a document of sheets.
 */
MIGRATIONS[1] = function migrateV1ToV2(document) {
  const collection = enggSheets.createCollection();
  const first = collection.sheets[0];

  first.objects = Array.isArray(document?.objects) ? document.objects : [];
  first.units = document?.units || first.units;

  if (document?.snap) {
    first.snap = {
      ...first.snap,
      ...document.snap,
    };
  }

  if (document?.objectSnap) {
    first.objectSnap = {
      ...first.objectSnap,
      ...document.objectSnap,
    };
  }

  if (document?.styleDefaults) {
    first.styleDefaults = {
      ...document.styleDefaults,
    };
  }

  if (document?.camera) {
    first.viewport = {
      zoom: Number(document.camera.zoom) || 1,
      panX: Number(document.camera.panX) || 0,
      panY: Number(document.camera.panY) || 0,
    };
  }

  if (document?.grid) {
    const resolvedGrid = enggSheets.resolveGridSnap(document.grid);

    first.grid = {
      ...first.grid,
      ...resolvedGrid,
    };
  }

  return {
    ...document,
    sheets: enggSheets.serializeCollection(collection).sheets,
    activeSheetId: first.id,
    objects: undefined,

    /*
     * THE RETIRED WORLD SCALE IS NOT WRITTEN OUT.
     *
     * A file opened from an older build carries a `scale` block (and often a
     * per-sheet `scale`). It is dropped here rather than carried forward: one
     * drawing unit is one millimetre now, so keeping the block would persist a
     * setting the application no longer has. Reading it on open is harmless -
     * nothing consults it - which is the whole of the backwards compatibility
     * this needs.
     */
    scale: undefined,
  };
};

function normalize(document) {
  if (!document || typeof document !== "object") {
    return document;
  }

  const collection = enggSheets.createCollection({
    sheets: document.sheets,
    activeSheetId: document.activeSheetId,
  });

  return {
    ...document,
    sheets: collection.sheets,
    activeSheetId: collection.activeSheetId,
  };
}

function migrate(document, fromVersion) {
  let current = document;

  if (!MIGRATIONS[CURRENT_VERSION - 1] && MINIMUM_SUPPORTED_VERSION < CURRENT_VERSION) {
    return null;
  }

  for (let version = fromVersion; version < CURRENT_VERSION; version += 1) {
    const step = MIGRATIONS[version];

    if (!step) {
      return null;
    }

    current = step(current);
  }

  return normalize(current);
}

/* ------------------------------------------------------- reading */

function readDocument(parsed) {
  if (!parsed || typeof parsed !== "object") {
    return {
      ok: false,
      failure: Failure.NOT_JSON,
      detail: "The file does not contain a drawing.",
    };
  }

  const format = parsed.format === "engg-drawing" ? FORMAT : parsed.format;

  if (format !== FORMAT) {
    return {
      ok: false,
      failure: Failure.WRONG_FORMAT,
      detail:
        "This is not an EnggDraw drawing. An EnggDraw file starts with \"format\": \"" +
        FORMAT +
        "\".",
    };
  }

  const version = Number(parsed.version);

  if (!Number.isFinite(version)) {
    return {
      ok: false,
      failure: Failure.NO_DOCUMENT,
      detail: "The file does not say which version it is.",
    };
  }

  if (version > CURRENT_VERSION) {
    return {
      ok: false,
      failure: Failure.FROM_THE_FUTURE,
      detail:
        "This drawing was made with a newer version of EnggDraw (file version " +
        version +
        ", this build understands up to " +
        CURRENT_VERSION +
        "). Update EnggDraw to open it.",
    };
  }

  if (version < MINIMUM_SUPPORTED_VERSION) {
    return {
      ok: false,
      failure: Failure.TOO_OLD,
      detail: "This drawing is too old to open (file version " + version + ").",
    };
  }

  const migrated = migrate(parsed.document, version);

  if (!migrated) {
    return {
      ok: false,
      failure: Failure.NO_DOCUMENT,
      detail: "The file contains no drawing.",
    };
  }

  return {
    ok: true,
    document: migrated,
    migratedFrom: version,
  };
}

/* ------------------------------------------------------- file names */

function withExtension(name) {
  const trimmed = String(name || "").trim();

  if (!trimmed) {
    return "drawing." + EXTENSION;
  }

  return trimmed.toLowerCase().endsWith("." + EXTENSION)
    ? trimmed
    : trimmed + "." + EXTENSION;
}

const enggDocumentFile = {
  CURRENT_VERSION,
  EXTENSION,
  Failure,
  MEDIA_TYPE,
  MINIMUM_SUPPORTED_VERSION,
  createDocument,
  migrate,
  readDocument,
  withExtension,
};

export default enggDocumentFile;
