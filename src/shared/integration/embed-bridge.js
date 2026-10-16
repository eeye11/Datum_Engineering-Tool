/*
 * ============================================================
 * USING DAETUM FROM ANOTHER PAGE (iframe + postMessage)
 * ============================================================
 *
 * A tool that shows DAETUM inside its own page - an OCR review screen, a
 * course platform - loads it in an iframe and talks to it with
 * postMessage. This bridge maps those messages onto the integration API
 * (datum-api.js). It is OFF unless the page is embedded AND the embedding
 * origin is named in the URL, so a page that merely frames DAETUM cannot
 * read a student's work:
 *
 *   <iframe src="https://daetum.example/?embedOrigin=https://grader.example">
 *
 * Several origins may be given, comma-separated.
 *
 * PROTOCOL
 * --------
 * The parent sends a request:
 *
 *   { type: "datum:request", id: <any>, method: "getDocument", params: [] }
 *
 * and DAETUM answers with the same id:
 *
 *   { type: "datum:response", id, ok: true,  result }
 *   { type: "datum:response", id, ok: false, error: "message" }
 *
 * Changes are pushed without being asked for:
 *
 *   { type: "datum:event", event: "documentchange" | "solutionchange" }
 *
 * and once the editor is ready:
 *
 *   { type: "datum:ready", apiVersion, documentVersion }
 *
 * Methods: getDocument, loadDocument, listSheets, renderSheetSvg,
 * getSolution, setSolution - see docs/INTEGRATION.md.
 */
const METHODS = new Set([
    "getDocument",
    "loadDocument",
    "listSheets",
    "renderSheetSvg",
    "getSolution",
    "setSolution"
]);

/* The origins allowed to talk to this page, from ?embedOrigin=a,b. */
export function allowedEmbedOrigins(search = window.location.search) {
    const value = new URLSearchParams(search).get("embedOrigin") || "";

    return value
        .split(",")
        .map(origin => origin.trim())
        .filter(origin => /^https?:\/\/[^/]+$/.test(origin));
}

export function installEmbedBridge(api, { origins = allowedEmbedOrigins(), host = window } = {}) {
    if (host.parent === host || origins.length === 0) {
        return false;
    }

    const parent = host.parent;
    const post = message => origins.forEach(origin => parent.postMessage(message, origin));

    host.addEventListener("message", async event => {
        if (!origins.includes(event.origin) || event.source !== parent) return;

        const message = event.data;
        if (!message || message.type !== "datum:request") return;

        const reply = body =>
            parent.postMessage({ type: "datum:response", id: message.id, ...body }, event.origin);

        if (!METHODS.has(message.method)) {
            reply({ ok: false, error: `Unknown method "${message.method}".` });
            return;
        }

        try {
            const params = Array.isArray(message.params) ? message.params : [];
            reply({ ok: true, result: await api[message.method](...params) });
        } catch (error) {
            reply({ ok: false, error: String(error?.message || error) });
        }
    });

    api.on("documentchange", () => post({ type: "datum:event", event: "documentchange" }));
    api.on("solutionchange", () => post({ type: "datum:event", event: "solutionchange" }));
    post({ type: "datum:ready", apiVersion: api.API_VERSION, documentVersion: api.documentVersion });

    return true;
}
