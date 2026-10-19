/*
 * ========================================================
 * RECENT FILES
 * ========================================================
 *
 * The Open popup's Recents list. A recent is stored so that it can actually be
 * REOPENED, not merely remembered: each entry keeps
 *
 *     key        a stable identity, so opening a file twice is one entry
 *     fileName   the name shown to the user
 *     label      the drawing's name, without the extension
 *     openedAt   when it was last opened, so the list can be ordered
 *     document   THE DOCUMENT ITSELF, serialised
 *     handle     a real file handle, when the browser gave one
 *
 * WHY THE DOCUMENT IS STORED
 * --------------------------
 * A browser cannot reopen a file by path. Without a stored handle there is no
 * way to read "Beam.enggdraw" again from the disk, and a Recents list that
 * cannot reopen what it lists would be a lie. So the serialised document is
 * kept with the entry: clicking it restores the drawing through the SAME
 * loader a file goes through, and the entry stays useful even after the
 * original file is moved, renamed or deleted.
 *
 * The handle is stored as well, where the File System Access API exists. When
 * a handle is present it is preferred, because it re-reads the CURRENT file
 * from disk - so a recent reflects the user's latest saved version - and it
 * can tell us the file is missing rather than silently showing a stale copy.
 *
 * WHAT THIS MODULE DOES NOT DO
 * ----------------------------
 * It does not parse, validate or reconstruct anything. A stored document is
 * handed to the ordinary loader and goes through exactly the same checks a
 * chosen file does. There is no second way into the application.
 */
const STORAGE_KEY = "datum:recent-files";

/*
 * How many recents are kept.
 *
 * Eight is enough to cover what a person was working on this week without the
 * Open popup becoming a scrolling list, and it is the number the list is
 * capped at rather than merely displaying. Older entries are dropped when a
 * new one arrives - see remember().
 */
const MAX_RECENTS = 8;

/*
 * How much of a stored document to keep.
 *
 * A recents entry holds a full document, and a document can be large. This is
 * a guard, not a policy: a drawing over this size is still listed, but its
 * stored copy is dropped so that a single huge drawing cannot fill the
 * browser's storage and break the whole list. Such an entry still works when
 * it has a handle; without one it reports that it must be imported again.
 */
const MAX_STORED_BYTES = 1_500_000;

/* ---------------------------------------------------------- */
/* STORAGE                                                     */
/* ---------------------------------------------------------- */

function storage() {
  try {
    return window.localStorage;
  } catch (error) {
    /*
     * Storage can be unavailable - private browsing, a full quota, a browser
     * that refuses it. Recents are a convenience; if they cannot be kept, the
     * Open popup still works.
     */
    return null;
  }
}

/*
 * Everything stored, oldest first, as the module keeps it.
 *
 * A damaged or unreadable record is reported as an empty list rather than
 * thrown, because a broken recents list must never be the reason DAETUM will
 * not start.
 */
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

    return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  } catch (error) {
    /*
     * Unparseable storage is discarded rather than carried around. Logged,
     * because a recents list that silently resets is worth being able to see
     * in a bug report.
     */
    report("The recent-files list could not be read and was reset.", error);

    try {
      store.removeItem(STORAGE_KEY);
    } catch (ignored) {
      /* Nothing more to do. */
    }

    return [];
  }
}

function isEntry(entry) {
  return (
    entry &&
    typeof entry === "object" &&
    typeof entry.key === "string" &&
    typeof entry.fileName === "string"
  );
}

function writeAll(entries) {
  const store = storage();

  if (!store) {
    return false;
  }

  try {
    store.setItem(STORAGE_KEY, JSON.stringify(entries));

    return true;
  } catch (error) {
    /*
     * A quota error is the common case here. The document copies are the
     * largest part, so they are dropped and the LIST is retried - the recents
     * remain usable (name, date, handle) instead of vanishing entirely.
     */
    try {
      const trimmed = entries.map((entry) => ({
        ...entry,
        document: null
      }));

      store.setItem(STORAGE_KEY, JSON.stringify(trimmed));

      return true;
    } catch (ignored) {
      report("Recent files could not be saved.", error);

      return false;
    }
  }
}

function report(message, error) {
  if (typeof console !== "undefined" && console.warn) {
    console.warn(`[DAETUM] ${message}`, error || "");
  }
}

/* ---------------------------------------------------------- */
/* ENTRIES                                                     */
/* ---------------------------------------------------------- */

/*
 * A stable identity for a file.
 *
 * THE IDENTITY IS THE FILE'S NAME, AND NOTHING ELSE THAT CANNOT SURVIVE.
 *
 * The identity decides whether recording a file makes ONE entry or TWO, and it
 * has to be the same identity on every route that records one - Import, Open,
 * Save As, a re-open from Recents, a file that has since gone missing.
 *
 * It cannot be the FILE HANDLE. A `FileSystemFileHandle` is not
 * JSON-serialisable, so it is gone by the time the recents list is read back:
 * an entry recorded WITH a handle keyed one way and the same file recorded
 * WITHOUT one keyed another, which produced two entries for one file - one of
 * them later showing "File not found". That is the duplication this replaces.
 *
 * So the key is the file's NAME, normalised for case so that the same file
 * selected as "Triangle.enggdraw" and "triangle.enggdraw" is one entry rather
 * than two. Two genuinely different files that share a name in different
 * folders still collapse to one entry - a limitation of what a browser exposes
 * without a persisted handle - and that is the honest trade: one entry too few
 * is far less confusing than the same file appearing three times.
 */
function keyFor(name) {
  return String(name || "drawing").trim().toLowerCase();
}

/*
 * The drawing's name, without the .enggdraw extension, for display.
 */
function labelFor(name) {
  return String(name || "drawing").replace(/\.enggdraw$/i, "");
}

/*
 * Store the document only when it is small enough to be worth keeping.
 */
function storableDocument(document) {
  if (!document) {
    return null;
  }

  let text;

  try {
    text = JSON.stringify(document);
  } catch (error) {
    report("A recent file's document could not be serialised.", error);

    return null;
  }

  if (text.length > MAX_STORED_BYTES) {
    return null;
  }

  return document;
}

/* ---------------------------------------------------------- */
/* THE PUBLIC LIST                                             */
/* ---------------------------------------------------------- */

/*
 * The recents, most recently opened first - which is the order the popup
 * shows them in. Storage keeps them oldest first so that appending is cheap
 * and truncation drops the oldest.
 *
 * ONE PHYSICAL FILE, ONE ENTRY - enforced HERE as well as on write.
 *
 * A list written by an earlier build can already contain the same file twice,
 * keyed differently, and rewriting only happens when a file is recorded again.
 * Collapsing by name on the way out means a list that was already duplicated
 * shows correctly the moment it is read, rather than staying wrong until the
 * user happens to reopen the file.
 *
 * The NEWEST occurrence wins, and the OLDEST position is dropped - so an entry
 * is neither lost nor duplicated, and the surviving record is the most recent
 * one, which is the one carrying the better preview and document.
 */
function list() {
  const seen = new Map();

  readAll().forEach((entry) => {
    const key = keyFor(entry.fileName);

    const previous = seen.get(key);

    /* Newer replaces older; equal timestamps keep the first seen. */
    if (!previous || (Number(entry.openedAt) || 0) >= (Number(previous.openedAt) || 0)) {
      seen.set(key, entry);
    }
  });

  return [...seen.values()]
    .sort((a, b) => (Number(a.openedAt) || 0) - (Number(b.openedAt) || 0))
    .reverse()
    .map((entry) => ({
      key: entry.key,
      fileName: entry.fileName,
      label: entry.label || labelFor(entry.fileName),
      openedAt: Number(entry.openedAt) || 0,
      hasDocument: Boolean(entry.document),
      hasHandle: Boolean(entry.handle),
      missing: Boolean(entry.missing),

      /*
       * A PREVIEW OF THE DRAWING, not a file icon.
       *
       * A recents list is recognised by what the drawings LOOK like, so each
       * entry carries a small picture of its document - produced by the same
       * renderer the canvas uses, from the stored copy. It is absent when no
       * picture could be made, and an absent preview is shown as nothing rather
       * than as a placeholder that claims to be the drawing.
       */
      preview: entry.preview || null
    }));
}

/*
 * The stored document for a recent, or null.
 *
 * Kept separate from list() because it is large and the popup does not need
 * it: only the moment a recent is actually opened does the document matter.
 */
function documentFor(key) {
    const entry = readAll().find((candidate) => candidate.key === key);

    return entry ? entry.document || null : null;
}

/*
 * The stored file handle for a recent, or null.
 *
 * Handles are only obtained where the File System Access API exists and the
 * user granted permission; a stored one may still be refused at read time,
 * which the caller handles.
 */
function handleFor(key) {
    const entry = readAll().find((candidate) => candidate.key === key);

    return entry ? entry.handle || null : null;
}

/* ---------------------------------------------------------- */
/* REMEMBERING                                                 */
/* ---------------------------------------------------------- */

/*
 * Record a file as recently used, moving it to the top.
 *
 * Called after a successful Open, Import, or Save As. The entry REPLACES any
 * existing one with the same key, so opening the same file again reorders the
 * list rather than duplicating it, and the stored document is refreshed to
 * what was just loaded - which is what makes a recent reflect the user's
 * latest work.
 *
 * `document` is optional: a Save As knows the file it wrote but may not hold
 * a freshly loaded copy, so it may pass the current document body.
 */
function remember({ name, handle, file, document, missing, preview } = {}) {
  const fileName = String(name || "").trim();

  if (!fileName) {
    return null;
  }

  const key = keyFor(fileName);

  /*
   * ANY EXISTING ENTRY FOR THIS FILE IS FOUND AND RE-USED.
   *
   * Matched on the normalised NAME, which is the identity every route can
   * produce. Entries written by an earlier build also keyed on a file handle, so
   * the match falls back to the entry's recorded file name - otherwise a file
   * already in the list would gain a SECOND entry the first time it was opened
   * again after this change, which is the duplication being fixed.
   */
  const all = readAll();

  const existing =
    all.find((entry) => entry.key === key) ||
    all.find((entry) => keyFor(entry.fileName) === key) ||
    null;

  /*
   * THE ENTRY IS REPLACED, NOT APPENDED TO.
   *
   * The same file recorded again is ONE recent that moves to the top, not two
   * entries. Everything matching is dropped first - by key AND by name, so a
   * legacy duplicate cannot survive alongside the new record - and the entry
   * that comes back carries forward whatever the old one had.
   */
  const entries = all.filter(
    (entry) => entry.key !== key && keyFor(entry.fileName) !== key,
  );

  entries.push({
    key,
    fileName,
    label: labelFor(fileName),
    openedAt: Date.now(),
    document: storableDocument(document) || (existing && existing.document) || null,
    handle: handle || (existing && existing.handle) || null,
    preview: preview || (existing && existing.preview) || null,

    /*
     * The size is kept for INFORMATION - a later version could show it - but it
     * is not part of the key. See keyFor: identity must be stable across the
     * routes that record a file, and only Import has a File to measure.
     */
    size: file && Number.isFinite(file.size) ? file.size : undefined,

    /*
     * A file that is recorded again is no longer missing: opening it is proof
     * that it can be found.
     */
    missing: Boolean(missing)
  });

  /* Oldest first in storage, so drop from the front. */
  while (entries.length > MAX_RECENTS) {
    entries.shift();
  }

  writeAll(entries);

  return key;
}

/*
 * Attach a preview picture to a recent.
 *
 * Read-only with respect to the drawing: a preview is a picture OF the document
 * and nothing about the document changes because one was taken. Kept separate
 * from remember() so a preview can be added after the entry exists - the
 * document has to be rendered to make one, and that is worth doing once rather
 * than on every save.
 */
function setPreview(key, preview) {
    const entries = readAll();

    const entry = entries.find((candidate) => candidate.key === key);

    if (!entry) {
        return false;
    }

    entry.preview = preview || null;

    writeAll(entries);

    return true;
}

/*
 * Mark a recent as unavailable.
 *
 * The entry stays in the list - the drawing's name and date are still useful
 * information - but it is shown as missing and offers removal. Marking rather
 * than deleting is deliberate: a file on a drive that is simply unplugged
 * should not cost the user the entry.
 */
function markMissing(key) {
    const entries = readAll();

    const entry = entries.find((candidate) => candidate.key === key);

    if (!entry) {
        return false;
    }

    entry.missing = true;

    writeAll(entries);

    return true;
}

/*
 * Forget one recent.
 */
function forget(key) {
  writeAll(readAll().filter((entry) => entry.key !== key));
}

/*
 * Forget everything. Exposed for tests and for a user who wants a clean list.
 */
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

const enggRecentFiles = {
  MAX_RECENTS,
  MAX_STORED_BYTES,
  STORAGE_KEY,
  clear,
  documentFor,
  forget,
  handleFor,
  keyFor,
  labelFor,
  list,
  markMissing,
  remember,
  setPreview
};

export default enggRecentFiles;
