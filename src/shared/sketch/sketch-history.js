/*
 * ============================================================
 * SHARED UNDO / REDO FOR A SKETCH DOCUMENT
 * ============================================================
 *
 * One history, over the one document. Every sketch tool uses it, so undo means
 * the same thing everywhere: the last MODEL change is reversed, and nothing
 * else.
 *
 * WHAT IS NOT A HISTORY STEP
 * --------------------------
 * A zoom, a pan, a selection, a tab change or a hover is not a change to the
 * sketch. Recording them would make Undo a button that sometimes does nothing
 * visible, and would let a viewport change sit between a student and the edit
 * they actually want back. So the history records only what the document's
 * revision counts - which is the same rule the source synchronisation uses.
 *
 * SNAPSHOTS, NOT DIFFS
 * --------------------
 * A sketch is small - a few hundred points at most - and a snapshot is exact.
 * A diff would have to know how to invert every operation, and the first one it
 * got wrong would corrupt the drawing in a way the student could not undo. The
 * cost of a snapshot is a few kilobytes; the cost of a wrong inverse is their
 * work.
 */

const DEFAULT_LIMIT = 100;

/* A deep copy, so a snapshot cannot be changed by later edits. */
function snapshot(document) {
  return JSON.parse(JSON.stringify(document));
}

export function createHistory(document, { limit = DEFAULT_LIMIT } = {}) {
  return {
    present: snapshot(document),
    past: [],
    future: [],
    limit,
  };
}

/*
 * Record a new state.
 *
 * A state whose revision has not moved is the SAME state - a no-op edit, a
 * re-render, a selection - and recording it would put a step in the history
 * that undoes to itself. The revision is the document's own answer to "did
 * anything change?", so it is what decides.
 */
export function commit(history, document) {
  if (!document) {
    return history;
  }

  if (document.revision === history.present?.revision) {
    return { ...history, present: snapshot(document) };
  }

  const past = [...history.past, history.present].slice(-history.limit);

  return {
    present: snapshot(document),
    past,
    future: [],
    limit: history.limit,
  };
}

/* Undo: the previous state becomes present, and this one becomes redoable. */
export function undo(history) {
  if (!history.past.length) {
    return { history, document: history.present };
  }

  const previous = history.past[history.past.length - 1];

  return {
    history: {
      present: previous,
      past: history.past.slice(0, -1),
      future: [history.present, ...history.future].slice(0, history.limit),
      limit: history.limit,
    },
    document: previous,
  };
}

/* Redo: the next state becomes present again. */
export function redo(history) {
  if (!history.future.length) {
    return { history, document: history.present };
  }

  const next = history.future[0];

  return {
    history: {
      present: next,
      past: [...history.past, history.present].slice(-history.limit),
      future: history.future.slice(1),
      limit: history.limit,
    },
    document: next,
  };
}

export function canUndo(history) {
  return Boolean(history?.past?.length);
}

export function canRedo(history) {
  return Boolean(history?.future?.length);
}

/*
 * A COPY OF THE PRESENT, for a caller that is about to mutate it.
 *
 * The history holds snapshots, and handing one out by reference would let a
 * caller's edit reach back into the past. Every read of the present goes
 * through here.
 */
export function current(history) {
  return snapshot(history.present);
}

export default {
  createHistory,
  commit,
  undo,
  redo,
  canUndo,
  canRedo,
  current,
};
