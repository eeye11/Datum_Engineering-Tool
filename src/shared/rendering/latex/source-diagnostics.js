/*
 * ============================================================
 * SOURCE GENERATION PROBLEMS
 * ============================================================
 *
 * An object that is in the model but could not be written into the source is
 * the one failure the student cannot see for themselves: the Source tab simply
 * lacks its block and the Drawing Space simply lacks its picture. So every
 * writer that has to leave an object out says so HERE, by object id, and the
 * Source tab lists what is recorded beside its own diagnostics.
 *
 * A problem is cleared the moment the same object is written successfully, so
 * the list always describes the drawing as it is now, not its history.
 */

const problems = new Map();

function announce() {
    const target = globalThis.document;

    if (!target || typeof target.dispatchEvent !== "function") {
        return;
    }

    try {
        const view = target.defaultView || globalThis;
        const Custom = view.CustomEvent || globalThis.CustomEvent;

        if (typeof Custom === "function") {
            target.dispatchEvent(new Custom("datum:source-generation-changed", { detail: { count: problems.size } }));
        }
    } catch {
        /* Reporting must never be the thing that breaks generation. */
    }
}

/*
 * Record that `object` was left out of the source, and why. Repeating the same
 * problem for the same object is silent, so a redraw loop cannot flood the
 * console or the event listeners.
 */
export function reportSourceGenerationProblem(object, problem) {
    const id = object && object.id;

    if (!id) {
        return;
    }

    const message = String(problem instanceof Error ? problem.message : problem ?? "unknown error");
    const previous = problems.get(id);

    if (previous && previous.message === message) {
        return;
    }

    problems.set(id, {
        id,
        type: object.type || "",
        name: object.name || "",
        message
    });

    try {
        if (typeof console !== "undefined" && console.warn) {
            console.warn(`[DAETUM] "${object.name || id}" (${object.type}) was left out of the source: ${message}.`);
        }
    } catch {
        /* As above. */
    }

    announce();
}

/* The object was written; whatever was wrong with it before no longer is. */
export function clearSourceGenerationProblem(id) {
    if (id && problems.delete(id)) {
        announce();
    }
}

/* Forget every problem - a new document, or a sheet with different objects. */
export function clearSourceGenerationProblems() {
    if (problems.size) {
        problems.clear();
        announce();
    }
}

/* Whether `id` was left out of the source by a writer that tried and failed. */
export function hasSourceGenerationProblem(id) {
    return problems.has(id);
}

/* What is wrong now, one entry per object that has no source. */
export function sourceGenerationProblems() {
    return [...problems.values()];
}

export default {
    reportSourceGenerationProblem,
    clearSourceGenerationProblem,
    clearSourceGenerationProblems,
    hasSourceGenerationProblem,
    sourceGenerationProblems
};
