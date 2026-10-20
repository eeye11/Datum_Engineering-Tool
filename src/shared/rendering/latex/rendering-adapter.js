/*
 * ============================================================
 * RENDERING ADAPTER
 * ============================================================
 *
 * The one client-side door to DAETUM's existing TikZ rendering service.
 *
 * There is ONE renderer in this application: the server's TikZJax pipeline at
 * `POST /api/render-tikz` (server/tikz.js). This module does not compile
 * anything itself, does not spawn a process, and does not add a second engine -
 * it calls that endpoint. Everything that needs to draw TikZ source goes
 * through here, so there is a single place where the request is shaped and a
 * single place where a failure is turned into something the UI can show.
 *
 * THE TWO REPRESENTATIONS, AND THE WRAPPER.
 *
 *   - The DRAWING SOURCE is what the Source tab shows and the student edits: a
 *     tikzpicture, nothing else.
 *   - The RENDERER WRAPPER is what the server needs to compile it: the document
 *     class, the packages and the document environment. The server adds these
 *     itself (server/tikz.js `documentFor`), so the client sends the picture
 *     unchanged.
 *
 * This module therefore sends the drawing source AS IT IS and does not build a
 * second, client-side copy of the preamble. The only adjustment it makes is to
 * ensure the input is a picture at all, so that a bare set of commands - which
 * a student may well type while halfway through - still renders as the picture
 * it would become. That adjustment is the adapter's whole job.
 *
 * SECURITY. The source is untrusted input. It is sent to the existing endpoint,
 * which runs TeX inside its own sandbox with its own timeout; this module adds
 * no execution path of its own and passes the text through untouched.
 */

export const RENDER_ENDPOINT = "/api/render-tikz";

/*
 * ============================================================
 * THE WRAPPER, MADE EXPLICIT
 * ============================================================
 *
 * `wrapForRendering` is exported so the boundary between "the drawing" and "the
 * infrastructure that compiles it" is visible in one named function rather than
 * being an implicit fact about the server. Nothing in the Source tab ever calls
 * it - the tab shows `source`, never this - but a future embed into the Written
 * Solution needs to know the picture is already self-contained, and this is
 * where that is decided.
 */
export function wrapForRendering(source) {
    let text = String(source ?? "").trim();

    if (text === "") {
        return "\\begin{tikzpicture}\n\\end{tikzpicture}";
    }

    /*
     * A PICTURE THAT IS NEVER CLOSED IS CLOSED HERE.
     *
     * The source can be halfway through an edit: the student has typed
     * `\begin{tikzpicture}` and the `\end` has not been written yet. TeX would
     * stop at the missing end and return nothing for the whole document, so the
     * wrapper - which already owns the document's own boundaries - supplies the
     * one that is missing. The student's text is NOT edited: this is the text
     * that is compiled, and it is thrown away with the response.
     */
    const begins = (text.match(/\\begin\s*\{tikzpicture\}/g) || []).length;
    const ends = (text.match(/\\end\s*\{tikzpicture\}/g) || []).length;

    if (begins > ends) {
        text += `\n\\end{tikzpicture}`.repeat(begins - ends);
    }

    if (/\\begin\s*\{tikzpicture\}/.test(text)) {
        return text;
    }

    /*
     * Commands without a picture. They are wrapped so they compile as the
     * picture they were meant to be, rather than being sent as a document body
     * whose coordinates would be read at the page's own origin.
     */
    return `\\begin{tikzpicture}\n${text}\n\\end{tikzpicture}`;
}

/*
 * ============================================================
 * RENDER DRAWING SOURCE TO AN SVG ELEMENT
 * ============================================================
 *
 * Resolves with the root `<svg>` element the service returned. Rejects with an
 * Error whose message is safe to show a student: "TikZ is still loading", the
 * compiler's own complaint, or a network failure. It never rejects with an
 * object whose `message` is a stack trace.
 *
 * The caller owns what happens next. The Source tab keeps the draft on failure
 * and leaves the last successful drawing on the canvas; nothing is thrown away
 * here.
 */
/*
 * A failure that says nothing about the source: the request never arrived, or
 * the engine is not loaded yet. Flagged so the caller retries it rather than
 * reporting the drawing as broken.
 */
function transientError(message, cause) {
    const error = new Error(message, cause ? { cause } : undefined);

    error.transient = true;

    return error;
}

/*
 * `anchorOrigin` asks the service to place the picture by its (0,0) rather than
 * by its bounding box (see server/tikz.js), which is what the Drawing Space
 * needs to lay the picture over the object model. The source text sent is the
 * same either way.
 */export async function renderDrawingSource(source, { signal, anchorOrigin = false } = {}) {
    let response;

    try {
        response = await fetch(RENDER_ENDPOINT, {
            body: JSON.stringify({ tikz: wrapForRendering(source), ...(anchorOrigin ? { anchorOrigin: true } : {}) }),
            headers: { "Content-Type": "application/json" },
            method: "POST",
            signal
        });
    } catch (error) {
        /*
         * An aborted request is not a failure to report - the student simply
         * typed again. It is re-thrown as an abort so the caller can tell the
         * two apart and stay silent.
         */
        if (error && error.name === "AbortError") {
            throw error;
        }

        throw transientError("The drawing could not be sent to the renderer. Check the connection to the DAETUM server.", error);
    }

    let payload = await response.json().catch(() => null);

    if (!response.ok || !payload || !payload.success) {
        const message =
            (payload && payload.error) ||
            `The renderer returned an error (${response.status}).`;

        /*
         * A SERVICE THAT IS NOT THERE IS NOT A VERDICT ON THE SOURCE.
         *
         * 503 is "still loading"; 404 and 405 mean the endpoint does not exist
         * or does not accept a POST where this page is served - a static host, or
         * a dev server without the proxy. Neither says anything about the TikZ
         * the student wrote, so both are TRANSIENT: the last good drawing stays,
         * a retry is scheduled, and no error is put in front of the student. Only
         * a real compile rejection (422, or the compiler's own message) is an
         * error about the source.
         */
        if (response.status === 503 || response.status === 404 || response.status === 405) {
            throw transientError(message);
        }

        throw new Error(message);
    }

    const holder = document.createElement("div");
    holder.innerHTML = payload.svg;

    const svg = holder.querySelector("svg") || holder.firstElementChild;

    if (!svg) {
        throw new Error("The renderer returned no drawing.");
    }

    return svg;
}

/*
 * The render endpoint's readiness, when the service exposes it. Absent is not a
 * failure: an older server simply does not answer this, and the UI treats an
 * unknown readiness as "try to render and see".
 */
export async function rendererStatus() {
    try {
        const response = await fetch("/api/health");

        if (!response.ok) {
            return "unknown";
        }

        const payload = await response.json();

        return payload.tikz || "unknown";
    } catch {
        return "unknown";
    }
}

export default {
    RENDER_ENDPOINT,
    wrapForRendering,
    renderDrawingSource,
    rendererStatus
};
