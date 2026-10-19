/*
 * The DAETUM document envelope.
 *
 * A drawing is saved as a .tex file: the TikZ pictures a reader compiles, and -
 * in a comment block LaTeX ignores - this envelope, which holds the whole
 * document model (sheets, each holding features with their real type,
 * geometry, parent and parameters). That is what makes a reopened drawing
 * selectable, draggable and editable. See file/latex/latex-document.js.
 *
 * The envelope is a compatibility contract, so it owns its version number and
 * migration path.
 *
 * THE RETIRED .enggdraw FORMAT. Drawings used to be saved as bare `.enggdraw`
 * JSON holding this same envelope (format id "enggdraw"). That is no longer
 * written anywhere. It is still READ - an old .enggdraw file opens as a
 * one-way import, and the next save is a .tex - which is why the legacy
 * extension, media type and format ids are kept here and nowhere else.
 */

import enggSheets from "../../components/layout/workspace/sheets.js";

const FORMAT = "daetum-document";

/* Format ids written by older builds, still read. */
const LEGACY_FORMATS = new Set(["enggdraw", "engg-drawing"]);

/*
 * The version this build WRITES.
 */
const CURRENT_VERSION = 2;

/*
 * The oldest version this build can still read.
 */
const MINIMUM_SUPPORTED_VERSION = 1;

/* What a saved drawing is: a .tex file. */
const EXTENSION = "tex";

const MEDIA_TYPE = "application/x-tex";

/* The retired format, accepted by Open as a one-way import and nothing else. */
const LEGACY_EXTENSION = "enggdraw";

const LEGACY_MEDIA_TYPE = "application/vnd.enggdraw+json";

/* Whether a file name is a retired .enggdraw - opened, never written. */
function isLegacyName(name) {
  return String(name || "").toLowerCase().endsWith("." + LEGACY_EXTENSION);
}

/*
 * Wrap a serialised document in the envelope.
 */
function createDocument(document) {
  return {
    format: FORMAT,
    version: CURRENT_VERSION,
    application: "DAETUM",
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

  if (parsed.format !== FORMAT && !LEGACY_FORMATS.has(parsed.format)) {
    return {
      ok: false,
      failure: Failure.WRONG_FORMAT,
      detail: "This is not a DAETUM drawing.",
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
        "This drawing was made with a newer version of DAETUM (file version " +
        version +
        ", this build understands up to " +
        CURRENT_VERSION +
        "). Update DAETUM to open it.",
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

/*
 * A drawing's file name: the name with `.tex`, exactly once. A name carried
 * over from an imported .enggdraw loses that extension, so the first save of
 * an old drawing writes "beam.tex" beside "beam.enggdraw" and never over it.
 */
function withExtension(name) {
  let trimmed = String(name || "").trim();

  if (isLegacyName(trimmed)) {
    trimmed = trimmed.slice(0, trimmed.length - LEGACY_EXTENSION.length - 1);
  }

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
  LEGACY_EXTENSION,
  LEGACY_MEDIA_TYPE,
  MEDIA_TYPE,
  MINIMUM_SUPPORTED_VERSION,
  createDocument,
  isLegacyName,
  migrate,
  readDocument,
  withExtension,
};

export default enggDocumentFile;
