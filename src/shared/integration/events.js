/*
 * Change notifications for the integration API.
 *
 * The editor and the written solution report changes here; the API's
 * on(event, listener) subscribes to them. A listener that throws is
 * reported to the console and does not stop the others, or the editor.
 */
const listeners = new Map();

export const DATUM_EVENTS = Object.freeze(["documentchange", "solutionchange"]);

export function onDatumEvent(event, listener) {
    if (!DATUM_EVENTS.includes(event)) {
        throw new Error(`Unknown DAETUM event "${event}". Known events: ${DATUM_EVENTS.join(", ")}.`);
    }

    if (typeof listener !== "function") {
        throw new Error("A DAETUM event listener must be a function.");
    }

    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(listener);

    return () => listeners.get(event)?.delete(listener);
}

export function emitDatumEvent(event, detail = {}) {
    for (const listener of listeners.get(event) || []) {
        try {
            listener({ type: event, ...detail });
        } catch (error) {
            console.error(`A "${event}" listener failed:`, error);
        }
    }
}
