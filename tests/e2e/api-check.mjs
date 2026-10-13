/*
 * THE INTEGRATION API, IN A REAL BROWSER.
 *
 *   node tests/e2e/api-check.mjs [datumUrl=http://localhost:8125/]
 *
 * Exercises window.datum the way another tool would, and the postMessage
 * bridge from a parent page on a DIFFERENT origin (served here on its own
 * port), which is how an OCR review screen or a course platform embeds
 * Datum. Exits non-zero on any failure.
 */
import http from "http";
import { chromium } from "@playwright/test";

const datumUrl = process.argv[2] || "http://localhost:8125/";
const datumOrigin = new URL(datumUrl).origin;
const PARENT_PORT = 8131;
const parentOrigin = `http://localhost:${PARENT_PORT}`;

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
    if (ok) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ""}`); }
};

/* A parent page on another origin that embeds Datum and calls it over postMessage. */
const parentHtml = `<!doctype html><meta charset="utf-8"><title>grader</title>
<iframe id="datum" style="width:1400px;height:900px" src="${datumUrl}?embedOrigin=${encodeURIComponent(parentOrigin)}"></iframe>
<script>
  window.events = [];
  window.ready = null;
  const pending = new Map();
  let next = 0;
  window.addEventListener("message", ({ origin, data }) => {
    if (origin !== ${JSON.stringify(datumOrigin)}) return;
    if (data.type === "datum:ready") window.ready = data;
    if (data.type === "datum:event") window.events.push(data.event);
    if (data.type === "datum:response") { pending.get(data.id)?.(data); pending.delete(data.id); }
  });
  window.call = (method, ...params) => new Promise(resolve => {
    const id = ++next;
    pending.set(id, resolve);
    document.getElementById("datum").contentWindow.postMessage(
      { type: "datum:request", id, method, params }, ${JSON.stringify(datumOrigin)});
  });
</script>`;
const parentServer = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(parentHtml);
}).listen(PARENT_PORT);

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on("pageerror", e => errors.push(e.message));

try {
    console.log("\n  window.datum\n");
    await page.goto(datumUrl);
    await page.waitForFunction(() => window.datum);

    const basics = await page.evaluate(() => ({
        version: window.datum.API_VERSION,
        documentVersion: window.datum.documentVersion,
        sheets: window.datum.listSheets(),
        frozen: Object.isFrozen(window.datum)
    }));
    check("API_VERSION is 1", basics.version === 1, JSON.stringify(basics));
    check("documentVersion is the file version this build writes", basics.documentVersion === 2);
    check("listSheets returns the first sheet", basics.sheets.length === 1 && /^sheet_/.test(basics.sheets[0].id));
    check("the API object cannot be modified", basics.frozen);

    // Draw a beam through the UI and watch for documentchange.
    await page.evaluate(() => { window.__changes = 0; window.datum.on("documentchange", () => window.__changes++); });
    await page.click("text=Engineering Drawing");
    await page.click('.drawing-category[data-category="STATICS"]');
    await page.click('.drawing-tool[data-tool-id="body"]');
    // Bodies opens an INLINE section now, not a popup submenu: the child is
    // the ordinary tool button inside #statics-body-tools, not a
    // [data-submenu-id] item. The old selector matched nothing and timed out.
    await page.click('#statics-body-tools .drawing-tool[data-tool-id="beam"]');
    const box = await page.evaluate(() => document.querySelector(".drawing-canvas").getBoundingClientRect().toJSON());
    for (const fx of [0.3, 0.7]) {
        const x = box.left + box.width * fx, y = box.top + box.height * 0.6;
        await page.mouse.move(x, y); await page.mouse.click(x, y); await page.waitForTimeout(200);
    }
    if (await page.evaluate(() => !!document.querySelector(".drawing-creation-dimension"))) {
        await page.keyboard.type("100"); await page.keyboard.press("Enter"); await page.waitForTimeout(200);
    }
    await page.keyboard.press("Escape");

    const drawn = await page.evaluate(() => {
        const file = window.datum.getDocument();
        const sheet = file.document.sheets.find(s => s.id === file.document.activeSheetId);
        return { changes: window.__changes, format: file.format, version: file.version, types: sheet.objects.map(o => o.type) };
    });
    check("documentchange fired while drawing", drawn.changes > 0, `fired ${drawn.changes} times`);
    check("getDocument returns a .enggdraw file", drawn.format === "enggdraw" && drawn.version === 2);
    check("and it contains the beam", drawn.types.includes("beam"), drawn.types.join(","));

    const figure = await page.evaluate(() => window.datum.renderSheetSvg(window.datum.listSheets()[0].id));
    check("renderSheetSvg draws the sheet", figure.ok && /^<svg[\s>]/.test(figure.svg), JSON.stringify(figure).slice(0, 200));
    check("as a standalone SVG document", figure.svg?.includes('xmlns="http://www.w3.org/2000/svg"'));
    check("with its size", figure.width > 0 && figure.height > 0, `${figure.width} x ${figure.height}`);
    const missing = await page.evaluate(() => window.datum.renderSheetSvg("sheet_doesnotexist"));
    check("an unknown sheet is reported, not thrown", missing.ok === false && missing.reason === "missing-sheet", JSON.stringify(missing));

    const solution = await page.evaluate(() => {
        const id = window.datum.listSheets()[0].id;
        const set = window.datum.setSolution(`Equilibrium:\n\n[DRAWING_REFERENCE:${id}]\n\n$\\sum F_y = 0$`);
        return { set, got: window.datum.getSolution(), id };
    });
    check("setSolution accepts LaTeX", solution.set.ok);
    check("getSolution returns it", solution.got.latex.includes("\\sum F_y = 0"));
    check("with the drawing it references", solution.got.references.length === 1 && solution.got.references[0].sheetId === solution.id);

    const loads = await page.evaluate(() => {
        const file = window.datum.getDocument();
        return {
            roundTrip: window.datum.loadDocument(JSON.stringify(file)),
            notJson: window.datum.loadDocument("not json"),
            wrongFormat: window.datum.loadDocument({ format: "something-else", version: 1 }),
            future: window.datum.loadDocument({ ...file, version: 99 }),
            afterTypes: window.datum.getDocument().document.sheets[0].objects.map(o => o.type)
        };
    });
    check("loadDocument round-trips a saved document", loads.roundTrip.ok && loads.afterTypes.includes("beam"), JSON.stringify(loads.roundTrip));
    check("text that is not JSON is refused", loads.notJson.ok === false && loads.notJson.failure === "not-json");
    check("a different format is refused", loads.wrongFormat.ok === false && loads.wrongFormat.failure === "wrong-format");
    check("a file from a newer version is refused", loads.future.ok === false && loads.future.failure === "from-the-future", JSON.stringify(loads.future));

    console.log("\n  the postMessage bridge, from another origin\n");
    await page.goto(parentOrigin + "/");
    await page.waitForFunction(() => window.ready, null, { timeout: 15000 });
    const ready = await page.evaluate(() => window.ready);
    check("Datum announces it is ready", ready.apiVersion === 1 && ready.documentVersion === 2, JSON.stringify(ready));

    const sheets = await page.evaluate(() => window.call("listSheets"));
    check("a request is answered", sheets.ok && Array.isArray(sheets.result) && sheets.result.length === 1, JSON.stringify(sheets));

    const set = await page.evaluate(() => window.call("setSolution", "From the OCR tool: $F = ma$"));
    const got = await page.evaluate(() => window.call("getSolution"));
    check("the parent can hand over LaTeX and read it back", set.ok && got.result.latex === "From the OCR tool: $F = ma$");

    const unknown = await page.evaluate(() => window.call("deleteEverything"));
    check("an unknown method is refused", unknown.ok === false && /Unknown method/.test(unknown.error));

    const file = await page.evaluate(() => window.call("getDocument"));
    check("the whole document crosses the frame", file.ok && file.result.format === "enggdraw");

    // Without embedOrigin the bridge stays off: a request goes unanswered.
    const silent = await page.evaluate(async datumUrl => {
        const frame = document.createElement("iframe");
        frame.src = datumUrl;
        document.body.appendChild(frame);
        await new Promise(r => frame.onload = r);
        await new Promise(r => setTimeout(r, 1500));
        return new Promise(resolve => {
            const timer = setTimeout(() => resolve("no answer"), 1500);
            window.addEventListener("message", e => { if (e.source === frame.contentWindow) { clearTimeout(timer); resolve("answered"); } });
            frame.contentWindow.postMessage({ type: "datum:request", id: 99, method: "getDocument", params: [] }, "*");
        });
    }, datumUrl);
    check("without embedOrigin, Datum does not answer", silent === "no answer", silent);

    check("no page errors", errors.length === 0, errors.join(" | "));
} finally {
    await browser.close();
    parentServer.close();
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
