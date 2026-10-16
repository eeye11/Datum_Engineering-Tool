/*
 * ========================================================
 * USER TEMPLATES
 * ========================================================
 *
 * A template is a USER-CREATED starting document. DAETUM ships none: the library
 * begins empty, and a template exists only because the user made one from an
 * `.enggdraw` file they already had.
 *
 * WHAT A TEMPLATE IS
 * ------------------
 * A stored COPY of a document, plus the name the user gave it:
 *
 *     { id, name, createdAt, document, preview }
 *
 * `document` is the whole editable document - the same shape a `.enggdraw` file
 * carries - so using a template goes through the SAME loader a file does. There
 * is no second drawing format, and nothing here knows how a feature is built.
 *
 * WHY THE DOCUMENT IS COPIED
 * --------------------------
 * The source `.enggdraw` is an ordinary file the user owns. It may be moved,
 * renamed or deleted at any moment, so a template cannot depend on it still
 * being there. The document is copied into DAETUM's own storage at the moment
 * the template is created, and the template keeps working whatever happens to
 * the file it came from.
 *
 * THE TEMPLATE IS A SNAPSHOT, NOT A LINK
 * --------------------------------------
 * Editing the source file later does NOT change the template, and using the
 * template never writes back to the source. Both are deliberate: a starting
 * point that silently changed under the user would be worse than useless.
 */
const STORAGE_KEY = "datum:templates";

/*
 * How many templates are kept.
 *
 * Higher than the recents cap because templates are deliberate, few, and the
 * whole point of keeping them - a person who has made twenty course set-ups
 * wants all twenty. It is a guard against unbounded growth, not a display limit.
 */
const MAX_TEMPLATES = 40;

function storage() {
  try {
    return window.localStorage;
  } catch (error) {
    return null;
  }
}

/*
 * A template id.
 *
 * Random and prefixed, so it is recognisable in storage and cannot collide with
 * a feature id or a sheet id. The id never changes, so a template's preview and
 * its name stay attached to the same entry through a rename.
 */
function newTemplateId() {
  const random =
    globalThis.crypto && typeof globalThis.crypto.randomUUID === "function"
      ? globalThis.crypto.randomUUID().replace(/-/g, "")
      : Math.random().toString(16).slice(2) +
        Math.random().toString(16).slice(2);

  return `template_${random.slice(0, 12)}`;
}

function isTemplate(entry) {
  return (
    entry &&
    typeof entry === "object" &&
    typeof entry.id === "string" &&
    typeof entry.name === "string" &&
    entry.document &&
    typeof entry.document === "object"
  );
}

function readAll() {
  const store = storage();

  if (!store) {
    return [];
  }

  let raw;

  try {
    raw = store.getItem(STORAGE_KEY);
  } catch (error) {
    return [];
  }

  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);

    return Array.isArray(parsed) ? parsed.filter(isTemplate) : [];
  } catch (error) {
    /*
     * A damaged library is reported and reset rather than carried around. The
     * user's own `.enggdraw` files are untouched by this - only DAETUM's copies
     * are lost, and a template can be made again from the source.
     */
    if (typeof console !== "undefined" && console.warn) {
      console.warn(
        "[DAETUM] The template library could not be read and was reset.",
        error
      );
    }

    try {
      store.removeItem(STORAGE_KEY);
    } catch (ignored) {
      /* Nothing more to do. */
    }

    return [];
  }
}

function writeAll(templates) {
  const store = storage();

  if (!store) {
    return false;
  }

  try {
    store.setItem(STORAGE_KEY, JSON.stringify(templates));

    return true;
  } catch (error) {
    /*
     * The previews are the largest part of an entry and the least important, so
     * they are dropped and the library retried before giving up. The template's
     * DOCUMENT is what must survive; a preview can be regenerated.
     */
    try {
      store.setItem(
        STORAGE_KEY,
        JSON.stringify(
          templates.map((template) => ({ ...template, preview: null }))
        )
      );

      return true;
    } catch (ignored) {
      if (typeof console !== "undefined" && console.error) {
        console.error("[DAETUM] Templates could not be saved.", error);
      }

      return false;
    }
  }
}

/* ---------------------------------------------------------- */
/* THE LIBRARY                                                 */
/* ---------------------------------------------------------- */

/*
 * Every template, newest first, WITHOUT its document.
 *
 * The Open popup renders this list, and it never needs the documents - those
 * are large and only matter at the moment a template is actually used. Keeping
 * them out of the listing is what stops the popup paying for the whole stored
 * library on every open.
 */
/*
 * A template's display name, WITHOUT a file extension.
 *
 * The name is whatever the user typed, and a user is free to type
 * "statics.enggdraw" - or to accept a default that arrived from a source file
 * before this rule existed. So the extension is stripped where the name is
 * SHOWN, not only where it is created: a display rule that depends on every
 * writer having remembered it is a rule that holds until the first writer
 * forgets.
 *
 * Only the FINAL `.enggdraw` goes, so `Statics.V2.Final.enggdraw` reads
 * `Statics.V2.Final` - the rest of the name is the user's.
 */
function displayName(name) {
  const trimmed = String(name || "").trim();

  const suffix = ".enggdraw";

  return trimmed.toLowerCase().endsWith(suffix)
    ? trimmed.slice(0, -suffix.length)
    : trimmed;
}

function list() {
  return readAll()
    .slice()
    .reverse()
    .map((template) => ({
      id: template.id,
      name: displayName(template.name),
      createdAt: Number(template.createdAt) || 0,
      preview: template.preview || null
    }));
}

/*
 * One template's stored document, or null.
 */
function documentFor(id) {
  const template = readAll().find((entry) => entry.id === id);

  return template ? template.document : null;
}

/*
 * A deep copy of a template's document, ready to become a new working drawing.
 *
 * A COPY, always. Handing out the stored object would let the loaded document
 * and the template be the same object, so editing the drawing would edit the
 * template - the one thing a template must never allow.
 */
function copyDocumentFor(id) {
  const document = documentFor(id);

  if (!document) {
    return null;
  }

  try {
    return JSON.parse(JSON.stringify(document));
  } catch (error) {
    if (typeof console !== "undefined" && console.error) {
      console.error(
        "[DAETUM] A template's document could not be copied.",
        error
      );
    }

    return null;
  }
}

/* ---------------------------------------------------------- */
/* MANAGING                                                    */
/* ---------------------------------------------------------- */

/*
 * Add a template.
 *
 *   addTemplate({ name, document, preview })
 *
 * The document is the validated document from an `.enggdraw` the user chose.
 * This function does not read, parse or validate anything - that is the file
 * pipeline's job, and the caller has already done it, so a template can only
 * ever be created from a document DAETUM could actually open.
 *
 * Returns the new template's id, or null when it could not be stored.
 */
function addTemplate({ name, document, preview } = {}) {
  const trimmed = String(name || "").trim();

  if (!trimmed || !document || typeof document !== "object") {
    return null;
  }

  const templates = readAll();

  const template = {
    id: newTemplateId(),
    name: trimmed,
    createdAt: Date.now(),
    document: JSON.parse(JSON.stringify(document)),
    preview: preview || null
  };

  templates.push(template);

  while (templates.length > MAX_TEMPLATES) {
    templates.shift();
  }

  writeAll(templates);

  return template.id;
}

/*
 * Rename a template.
 *
 * Only the display name changes. The id and the stored document are untouched,
 * which is what makes a rename safe: nothing that referenced the template can
 * be broken by it.
 *
 * A typed extension is stripped, so a name that arrives as "statics.enggdraw"
 * is stored the way it will be shown. The display rule would catch it anyway -
 * this just keeps what is stored and what is seen the same thing.
 */
function renameTemplate(id, name) {
  const trimmed = displayName(String(name || "").trim());

  if (!trimmed) {
    return false;
  }

  const templates = readAll();

  const template = templates.find((entry) => entry.id === id);

  if (!template) {
    return false;
  }

  template.name = trimmed;

  writeAll(templates);

  return true;
}

/*
 * Remove a template.
 *
 * This deletes DAETUM's stored copy and NOTHING else. The `.enggdraw` the
 * template was made from is the user's file, is not referenced here, and is
 * never touched - removing a template is not a file deletion.
 */
function deleteTemplate(id) {
  const templates = readAll();

  const remaining = templates.filter((entry) => entry.id !== id);

  if (remaining.length === templates.length) {
    return false;
  }

  writeAll(remaining);

  return true;
}

/*
 * Store a preview image for a template.
 *
 * Read-only with respect to the document: a preview is a picture of the drawing
 * and nothing about the drawing changes because one was taken.
 */
function setPreview(id, preview) {
  const templates = readAll();

  const template = templates.find((entry) => entry.id === id);

  if (!template) {
    return false;
  }

  template.preview = preview || null;

  writeAll(templates);

  return true;
}

function count() {
  return readAll().length;
}

function clear() {
  const store = storage();

  if (store) {
    try {
      store.removeItem(STORAGE_KEY);
    } catch (error) {
      /* Nothing to do. */
    }
  }
}

const enggTemplates = {
  MAX_TEMPLATES,
  STORAGE_KEY,
  addTemplate,
  clear,
  copyDocumentFor,
  count,
  deleteTemplate,
  displayName,
  documentFor,
  list,
  renameTemplate,
  setPreview
};

export default enggTemplates;
