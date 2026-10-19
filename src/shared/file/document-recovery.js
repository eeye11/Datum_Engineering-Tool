/*
 * Crash recovery.
 *
 * A drawing that exists only in the browser's memory is one closed
 * tab away from being gone, and the usual case for losing work is
 * not a deliberate discard - it is a reload, a crash, or a laptop
 * that slept. So the current document is mirrored into local
 * storage as it is worked on.
 *
 * This is NOT the project's file. It has no name, it is never
 * downloaded, and it is deliberately of no consequence to anyone but
 * the person who made it. Sharing a drawing is the .enggdraw file's
 * job and always will be; this exists only so that a mishap does
 * not destroy work outright.
 *
 * What is kept is the same serialised document the file uses, so
 * recovering and opening a file go through exactly the same code
 * and cannot disagree about what a document is.
 *
 * The cost of the guarantee is kept low deliberately. The copy is
 * written on a pause rather than on every keystroke, because a drag
 * that mutates geometry continuously would otherwise write the
 * whole drawing to storage many times a second.
 */
const STORAGE_KEY = "enggdraw:recovery";

/*
 * How long after a change the recovery copy is written.
 *
 * Long enough that dragging a handle does not write the document
 * on every pointermove, short enough that closing a tab
 * immediately after an edit still has it.
 */
const WRITE_DELAY_MS = 1000;

/*
 * How long a recovery copy is worth offering.
 *
 * Beyond this it is more likely to be a drawing the user finished
 * and deliberately closed than one they are trying to rescue, and
 * offering it back would be noise. Thirty days is long enough to
 * cover a forgotten weekend.
 */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

let timer = null;

/*
 * Read the stored document, if there is a usable one.
 *
 * Returns null rather than throwing for anything wrong with it: a
 * damaged recovery copy must never be the reason the application
 * will not start, and must certainly never be handed to the
 * document loader as though it were good.
 */
function read() {
  let raw;

  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    /*
     * Storage can be unavailable - private browsing, a full
     * quota, or a browser that refuses it entirely. Recovery is
     * a convenience; if it cannot work, the drawing still can.
     */
    return null;
  }

  if (!raw) {
    return null;
  }

  let record;

  try {
    record = JSON.parse(raw);
  } catch (error) {
    discard();

    return null;
  }

  if (!record || !record.document) {
    discard();

    return null;
  }

  const age =
    Date.now() - Number(record.savedAt || 0);

  if (!Number.isFinite(age) || age > MAX_AGE_MS) {
    discard();

    return null;
  }

  return record;
}

/*
 * Store a document, wrapped with the information needed to decide
 * later whether it is worth offering.
 */
function write(document, fileName) {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        savedAt: Date.now(),
        fileName: fileName || null,
        document
      })
    );

    return true;
  } catch (error) {
    return false;
  }
}

/*
 * Schedule a recovery write.
 *
 * Debounced, so a run of changes - a drag, a burst of typing -
 * costs one write rather than one per change. The pending write
 * is dropped by discard(), which is what stops a document the
 * user has already saved from being resurrected as "unsaved work"
 * on the next visit.
 */
function schedule(document, fileName) {
  if (timer !== null) {
    window.clearTimeout(timer);
  }

  timer = window.setTimeout(() => {
    timer = null;

    write(document, fileName);
  }, WRITE_DELAY_MS);
}

/*
 * Drop the recovery copy, and any write that was about to happen.
 *
 * Called when the document is saved, because a saved document is
 * not lost work; leaving its copy behind would offer the user a
 * "recovery" of something they already have on disk.
 */
function discard() {
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }

  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    /* Nothing to do: there is no copy to remove. */
  }
}

/*
 * Whether there is a recovery copy worth telling the user about.
 */
function available() {
  return Boolean(read());
}

/*
 * A short description of what would be recovered, for the prompt.
 */
function describe() {
  const record = read();

  if (!record) {
    return null;
  }

  const sheets = Array.isArray(record.document?.sheets)
    ? record.document.sheets
    : [];

  /*
   * A document is a set of sheets, so the prompt counts what would
   * actually come back: how many sheets, and how much is drawn on
   * them. Counting only the top-level features - which is what a
   * single-sheet document has - would describe a recovered drawing
   * as empty when it is not.
   */
  const count = sheets.length
    ? sheets.reduce(
        (total, sheet) =>
          total +
          (Array.isArray(sheet.objects) ? sheet.objects.length : 0),
        0
      )
    : Array.isArray(record.document?.objects)
      ? record.document.objects.length
      : 0;

  const when = new Date(record.savedAt);

  return {
    fileName: record.fileName || null,
    features: count,
    sheets: sheets.length,
    savedAt: record.savedAt,
    when: Number.isFinite(when.getTime())
      ? when.toLocaleString()
      : null
  };
}

const enggRecovery = {
  MAX_AGE_MS,
  STORAGE_KEY,
  WRITE_DELAY_MS,
  available,
  describe,
  discard,
  read,
  schedule,
  write
};

export default enggRecovery;
