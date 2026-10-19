/*
 * GOLDEN-MASTER SCENARIO
 *
 * Drives the real application through every tool on the toolbar and records
 * what it produced: the document model, the rendered SVG, the Features panel
 * for every object created, and any page errors. Randomness and the clock are
 * pinned before the page loads, so two runs of the same build produce
 * byte-identical output.
 *
 * Used as a refactoring oracle: record against the old build, record against
 * the new build, and the two must match. A difference is a behaviour change,
 * intended or not.
 *
 *   node tests/e2e/golden-scenario.mjs <baseUrl> <out.json>
 */
import fs from "fs";
import { chromium } from "@playwright/test";

const baseUrl = process.argv[2] || "http://localhost:8123/";
const outFile = process.argv[3] || "golden.json";
const only = process.argv[4] ? new RegExp(process.argv[4]) : null;

/* Every tool, by category, with the submenu item to pick (if any). */
const TOOLS = [
    ["GEOMETRY", "point"], ["GEOMETRY", "line", null, null, ["d:0.3,0.55,0.6,0.55"]], ["GEOMETRY", "triangle"],
    ["GEOMETRY", "rectangle", null, null, ["d:0.3,0.55,0.6,0.35"]], ["GEOMETRY", "circle", null, null, ["d:0.3,0.55,0.6,0.55"]],
    ["GEOMETRY", "arc", "3-Point Arc"], ["GEOMETRY", "arc", "Centrepoint Arc"],
    ["GEOMETRY", "polygon", "By Sides"], ["GEOMETRY", "polygon", "By Centre"],
    ["GEOMETRY", "coordinate-system", "2D Coordinate System"],
    /*
     * ONE DIMENSION TOOL. Smart Dimension and Variable Dimension were retired
     * and folded into this one, which infers the measurement from what is
     * picked. The scenario listed the retired ids, so it timed out waiting for
     * a button the catalogue no longer has rather than driving anything.
     */
    ["ANNOTATE", "dimension", null, "line", ["c:0.475,0.6", "Enter", "c:0.475,0.5", "Enter"]],
    ["ANNOTATE", "note"], ["ANNOTATE", "label", null, "line"],
    ["ANNOTATE", "leader"], ["ANNOTATE", "callout"],
    ["ANNOTATE", "symbol"], ["ANNOTATE", "table"],
    ["STATICS", "body", "particle"], ["STATICS", "body", "rigid-body", null, ["d:0.3,0.55,0.6,0.35"]],
    ["STATICS", "body", "beam", null, ["d:0.25,0.6,0.7,0.6"]], ["STATICS", "body", "truss"],
    ["STATICS", "body", "cable", null, ["d:0.25,0.6,0.7,0.6"]], ["STATICS", "body", "shaft", null, ["d:0.25,0.6,0.7,0.6"]],
    ["STATICS", "point-force", null, "beam"],
    /* body -> start -> end -> magnitude (typed into the panel) -> direction */
    ["STATICS", "load", "distributed-load", "beam", ["c:0.45,0.6", "c:0.3,0.6", "c:0.6,0.6", "type:25", "Enter", "c:0.45,0.4"]],
    /* body -> one magnitude-defining point per click, off the beam -> Enter */
    ["STATICS", "load", "varying-distributed-load", "beam", ["c:0.3,0.6", "c:0.3,0.45", "c:0.5,0.4", "c:0.65,0.5", "Enter"]],
    ["STATICS", "moment", null, "beam"],
    ["STATICS", "support", "pin-support", "beam", ["c:0.4,0.6", "c:0.25,0.6"]],
    ["STATICS", "support", "roller-support", "beam", ["c:0.4,0.6", "c:0.25,0.6"]],
    ["STATICS", "support", "fixed-support", "beam", ["c:0.4,0.6", "c:0.25,0.6"]],
    ["STATICS", "support", "smooth-support", "beam", ["c:0.4,0.6", "c:0.25,0.6"]],
    ["STATICS", "connection", "pin-connection", "beam", ["c:0.4,0.6", "c:0.25,0.6"]],
    ["STATICS", "connection", "fixed-connection", "beam", ["c:0.4,0.6", "c:0.25,0.6"]],
    ["STATICS", "connection", "slider-connection", "beam", ["c:0.4,0.6", "c:0.25,0.6"]],
    ["STATICS", "resultant", null, "forces"],
    ["STATICS", "force-components", null, "forces"],
    ["STATICS", "shear-force-diagram", "sketch", "beam", ["c:0.4,0.6", "c:0.5,0.3", "Enter"]],
    ["STATICS", "shear-force-diagram", "Sketch", "beam", ["c:0.6,0.35"]],
    ["STATICS", "shear-force-diagram", "plot", "beam", ["c:0.4,0.6", "c:0.5,0.3", "Enter"]],
    ["STATICS", "bending-moment-diagram", "sketch", "beam", ["c:0.4,0.6", "c:0.5,0.3", "Enter"]],
    ["STATICS", "axial-force-diagram", "plot", "beam", ["c:0.4,0.6", "c:0.5,0.3", "Enter"]],
    ["STATICS", "coordinate-system", "2D Coordinate System"], ["STATICS", "reference-point"],
    ["STATICS", "reference-line", null, null, ["d:0.3,0.55,0.6,0.55"]], ["STATICS", "reference-arc"],
    ["DYNAMICS", "velocity"], ["FLUIDS", "pipe"], ["THERMODYNAMICS", "control-volume"],
    ["HEAT TRANSFER", "wall"], ["SOLID MECHANICS", "stress"],
    ["MECHANICAL DESIGN", "gear"], ["CONTROLS", "block"], ["MATH / ANALYSIS", "function"]
];

/* Deterministic randomness and time, installed before any app script runs. */
const DETERMINISM = () => {
    let seed = 1;
    Math.random = () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
    };
    let uuid = 0;
    const hex = n => n.toString(16).padStart(12, "0");
    if (globalThis.crypto) {
        Object.defineProperty(globalThis.crypto, "randomUUID", {
            value: () => { const n = hex(++uuid); return `${n.slice(4)}-${n.slice(0, 4)}-4000-8000-${n}`; },
            configurable: true
        });
    }
    const fixed = 1767225600000;
    let tick = 0;
    Date.now = () => fixed + tick++;
    try { localStorage.clear(); } catch {}
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
    const browser = await chromium.launch({ channel: "chrome" });
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
    await context.addInitScript(DETERMINISM);
    const page = await context.newPage();
    page.setDefaultTimeout(2500);
    const debug = process.env.GOLDEN_DEBUG
        ? (...a) => fs.appendFileSync(process.env.GOLDEN_DEBUG, a.join(" ") + "\n")
        : () => {};
    debug("browser up");
    let errors = [];
    page.on("pageerror", e => errors.push(String(e.message).replace(/\s+/g, " ").slice(0, 200)));
    page.on("dialog", d => d.accept());

    debug("goto"); await page.goto(baseUrl, { waitUntil: "domcontentloaded" }); debug("loaded");
    await page.waitForSelector(".drawing-canvas", { state: "attached" });
    await page.click("text=Engineering Drawing");
    await sleep(300);

    debug("tab clicked");
    const box = await page.evaluate(() => {
        const r = document.querySelector(".drawing-canvas").getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
    });
    const P = (fx, fy) => ({ x: Math.round(box.x + box.w * fx), y: Math.round(box.y + box.h * fy) });
    const SPOTS = [P(0.3, 0.55), P(0.6, 0.55), P(0.6, 0.35), P(0.35, 0.33)];
    const BEAM = [P(0.25, 0.6), P(0.7, 0.6)];

    const click = async (pt, settle = 120) => {
        await page.mouse.move(pt.x - 3, pt.y - 2);
        await sleep(40);
        await page.mouse.move(pt.x, pt.y);
        await sleep(40);
        await page.mouse.click(pt.x, pt.y);
        await sleep(settle);
    };
    /* Press-drag-release: how Line, Beam and the other path tools create. */
    const drag = async (a, b) => {
        await page.mouse.move(a.x, a.y);
        await page.mouse.down();
        await page.mouse.move(b.x, b.y, { steps: 10 });
        await sleep(80);
        await page.mouse.up();
        await sleep(200);
    };
    /* Accept a creation popup (length/radius) or any modal by pressing Enter. */
    const VALUES = { width: "60", height: "40", length: "80", radius: "30", angle: "30", magnitude: "100", sides: "5" };
    const acceptPopups = async () => {
        for (let round = 0; round < 6; round++) {
            const popup = await page.evaluate(() => {
                const shown = el => el && getComputedStyle(el).display !== "none" && el.getClientRects().length > 0;
                /* The Annotate pickers: answer them deterministically. */
                const symbol = [...document.querySelectorAll(".datum-symbol-picker")].find(shown);
                if (symbol) { symbol.querySelector("[data-symbol-id]")?.click(); return { kind: "picked" }; }
                const table = [...document.querySelectorAll(".datum-table-picker")].find(shown);
                if (table) {
                    const cell = table.querySelector('[data-row="1"][data-col="1"]') || table.querySelector("[data-row]");
                    cell?.click();
                    return { kind: "picked" };
                }
                const sizing = [...document.querySelectorAll(".drawing-creation-dimension")].find(shown);
                if (sizing) {
                    const input = sizing.querySelector("[data-creation-input]");
                    return { kind: "sizing", label: (input?.getAttribute("aria-label") || "").toLowerCase(), empty: !input?.value };
                }
                const dialog = [...document.querySelectorAll("dialog[open], .engg-dialog-backdrop, [role=dialog]")].find(shown);
                return dialog ? { kind: "dialog" } : null;
            });
            if (!popup) return;
            debug("popup", JSON.stringify(popup));
            if (popup.kind === "picked") { await sleep(150); continue; }
            if (popup.kind === "sizing" && popup.empty) {
                const key = Object.keys(VALUES).find(k => popup.label.includes(k));
                await page.keyboard.type(VALUES[key] || "50");
            }
            await page.keyboard.press("Enter");
            await sleep(150);
        }
    };
    const chooseTool = async (category, toolId, sub) => {
        debug("tool", category, toolId, sub || "");
        await page.click(`.drawing-category[data-category="${category}"]`);
        await sleep(80);
        /*
         * Statics groups (Bodies, Loads, Supports…) toggle an inline section of
         * ordinary tool buttons; open it only if it is closed, then pick the child.
         */
        const section = page.locator(`#statics-${toolId}-tools`);
        if (sub && await section.count() && await section.locator(`[data-tool-id="${sub}"]`).count()) {
            if (await section.evaluate(el => el.hidden)) {
                await page.click(`.drawing-tool[data-tool-id="${toolId}"]`);
                await sleep(120);
            }
            await section.locator(`.drawing-tool[data-tool-id="${sub}"]`).first().click();
            await sleep(150);
            return;
        }
        await page.click(`.drawing-tool[data-tool-id="${toolId}"]`);
        await sleep(120);
        if (sub) {
            /*
             * WAIT for the submenu rather than look once: it can open after a
             * fixed pause, and a missed item silently left the tool in its
             * default mode, so the step's result depended on timing.
             */
            const byId = `.drawing-coordinate-submenu-item[data-submenu-id="${sub}"]`;
            const byText = page.locator(".drawing-coordinate-submenu-item", { hasText: sub });
            const appeared = () => page.locator(byId).first().or(byText.first()).first()
                .waitFor({ state: "visible", timeout: 1500 }).then(() => true, () => false);
            if (!(await appeared())) {
                /* Retry once: a submenu left toggled by an earlier step can swallow the first click. */
                debug("submenu retry", sub);
                await page.keyboard.press("Escape"); await sleep(80);
                await page.click(`.drawing-tool[data-tool-id="${toolId}"]`); await sleep(120);
                await appeared();
            }
            let item = page.locator(byId).first();
            if (!(await item.count())) {
                item = page.locator(".drawing-coordinate-submenu-item", { hasText: sub }).first();
            }
            if (await item.count()) { await item.click(); await sleep(150); }
            else debug("submenu item missing", sub);
        }
    };
    const newSheet = async () => {
        await page.evaluate(() => {
            const sheets = window.enggDrawingSheets;
            const created = sheets.createSheet();
            const id = created?.id || sheets.all()[sheets.all().length - 1].id;
            sheets.activateSheet(id);
        });
        await sleep(120);
    };
    const escape = async () => {
        for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape"); await sleep(50); }
    };
    const seedBeam = async () => {
        await chooseTool("STATICS", "body", "beam");
        await drag(BEAM[0], BEAM[1]); await acceptPopups();
        await escape();
    };
    const seedForces = async () => {
        await seedBeam();
        await chooseTool("STATICS", "point-force");
        await click(P(0.4, 0.6)); await click(P(0.42, 0.45)); await acceptPopups(); await escape();
        await chooseTool("STATICS", "point-force");
        await click(P(0.55, 0.6)); await click(P(0.6, 0.48)); await acceptPopups(); await escape();
    };
    const seedLine = async () => {
        await chooseTool("GEOMETRY", "line");
        await drag(BEAM[0], BEAM[1]); await acceptPopups();
        await escape();
    };

    const snapshot = () => page.evaluate(() => {
        const svg = document.querySelector(".drawing-canvas");
        const state = window.enggDrawing.state;
        return {
            objects: (() => {
                try { return JSON.parse(JSON.stringify(state.objects)); }
                catch (e) {
                    /* Record a circular model rather than abort the whole run. */
                    const seen = new WeakSet();
                    return JSON.parse(JSON.stringify(state.objects, (k, v) => {
                        if (v && typeof v === "object") { if (seen.has(v)) return "[circular]"; seen.add(v); }
                        return v;
                    }));
                }
            })(),
            selection: [...state.selection.selectedObjectIds],
            svg: svg ? svg.innerHTML : "",
            message: document.getElementById("drawingToolMessage")?.textContent.trim() || "",
            tree: document.getElementById("drawingProperties")?.textContent.replace(/\s+/g, " ").trim() || ""
        };
    });
    const panelFor = async id => {
        await page.evaluate(objectId => {
            const s = window.enggDrawing.state;
            window.enggDrawing.model.selectObjects(s, [objectId]);
        }, id);
        await page.keyboard.press("Shift"); // no-op key to flush any pending UI
        const row = page.locator(`[data-object-id="${id}"]`).first();
        if (await row.count()) { await row.click({ timeout: 1000 }).catch(() => {}); await sleep(100); }
        return page.evaluate(() =>
            (document.getElementById("drawingProperties")?.innerHTML || "").replace(/\s+/g, " "));
    };

    const results = {};
    for (const [category, toolId, sub, seed, actions] of TOOLS) {
        const key = [category, toolId, sub].filter(Boolean).join("/");
        if (only && !only.test(key)) continue;
        errors = [];
        debug("newSheet", key); await newSheet(); debug("sheet ok");
        if (seed === "beam") await seedBeam();
        if (seed === "line") await seedLine();
        if (seed === "forces") await seedForces();
        const before = await page.evaluate(() => window.enggDrawing.state.objects.map(o => o.id));
        await chooseTool(category, toolId, sub);
        const steps = [];
        for (const action of actions || SPOTS) {
            if (typeof action === "string" && action.startsWith("type:")) {
                await page.keyboard.type(action.slice(5)); await sleep(100);
            } else if (typeof action === "string" && action.startsWith("d:")) {
                const [x1, y1, x2, y2] = action.slice(2).split(",").map(Number);
                await drag(P(x1, y1), P(x2, y2));
            } else if (typeof action === "string" && !action.startsWith("c:")) {
                await page.keyboard.press(action); await sleep(150);
            } else {
                const spot = typeof action === "string"
                    ? P(...action.slice(2).split(",").map(Number))
                    : action;
                debug("click", spot.x, spot.y); await click(spot);
            }
            await acceptPopups();
            steps.push(await page.evaluate(() => window.enggDrawing.state.objects.length));
        }
        await page.keyboard.press("Enter"); await sleep(120); await acceptPopups();
        await escape();
        const snap = await snapshot();
        const created = snap.objects.map(o => o.id).filter(id => !before.includes(id));
        const panels = {};
        debug("panels", created.length);
        for (const id of created) panels[id] = await panelFor(id);
        await escape();
        results[key] = { steps, ...snap, panels, errors: [...errors] };
        process.stdout.write(`${key}: ${created.length} new, ${errors.length} errors\n`);
    }

    /*
     * WHOLE-WORKFLOW FLOWS on a beam with a support attached: the modify
     * tools, delete-with-dependents, clipboard, fit and zoom. Each flow
     * records the document after it ran.
     */
    /* The Modify tools and Fit live in the menu bar (Tools / View). */
    const MENU_OF = { move: "tools", rotate: "tools", mirror: "tools", fit: "view" };
    const globalTool = async id => {
        await page.click(`.datum-menu-label[data-menu-id="${MENU_OF[id]}"]`);
        await sleep(120);
        await page.click(`.datum-menu-item[data-menu-item="${id}"]`);
        await sleep(150);
    };
    const selectFirst = type => page.evaluate(t => {
        const s = window.enggDrawing.state;
        const target = s.objects.find(o => o.type === t);
        if (target) window.enggDrawing.model.selectObjects(s, [target.id]);
        return Boolean(target);
    }, type);
    const FLOWS = {
        move: async () => { await selectFirst("beam"); await globalTool("move"); await click(P(0.3, 0.6)); await click(P(0.35, 0.5)); },
        rotate: async () => { await selectFirst("beam"); await globalTool("rotate"); await click(P(0.3, 0.6)); await click(P(0.5, 0.6)); await click(P(0.5, 0.45)); },
        mirror: async () => { await selectFirst("beam"); await globalTool("mirror"); await click(P(0.2, 0.4)); await click(P(0.8, 0.4)); },
        delete: async () => { await selectFirst("beam"); await sleep(100); await page.keyboard.press("Delete"); },
        clipboard: async () => { await selectFirst("beam"); await page.keyboard.press("Control+c"); await page.keyboard.press("Control+v"); },
        fit: async () => { await globalTool("fit"); },
        zoom: async () => { await page.mouse.move(P(0.5, 0.5).x, P(0.5, 0.5).y); await page.mouse.wheel(0, -240); await sleep(150); }
    };
    for (const [name, run] of Object.entries(FLOWS)) {
        const key = `flow/${name}`;
        if (only && !only.test(key)) continue;
        errors = [];
        await newSheet();
        await seedBeam();
        await chooseTool("STATICS", "support", "pin-support");
        await click(P(0.4, 0.6)); await click(BEAM[0]); await acceptPopups(); await escape();
        await run();
        await acceptPopups();
        await escape();
        const snap = await snapshot();
        results[key] = { ...snap, camera: await page.evaluate(() => ({ ...window.enggDrawing.state.camera })), errors: [...errors] };
        process.stdout.write(`${key}: ${snap.objects.length} objects, ${errors.length} errors\n`);
    }

    /* Export: the clean SVG render of the active sheet, and a file round-trip. */
    errors = [];
    results["export/svg-and-file"] = {
        ...(await page.evaluate(() => {
            const sheets = window.enggDrawingSheets;
            let svg = null;
            try {
                const out = sheets.renderReference(sheets.activeSheetId());
                svg = out && (out.outerHTML || JSON.stringify(out).slice(0, 4000));
            } catch (e) { svg = "THREW " + e.message; }
            const body = window.enggDrawingSheets.serializeDocumentBody();
            const doc = window.enggDocumentFile.createDocument(body);
            const text = JSON.stringify(doc);
            let reread;
            try { reread = window.enggDocumentFile.readDocument(text); } catch (e) { reread = "THREW " + e.message; }
            return { svg, fileKeys: Object.keys(doc), rereadKeys: reread && typeof reread === "object" ? Object.keys(reread) : reread };
        })),
        errors: [...errors]
    };

    /* Undo everything on the last sheet, then redo it: history must round-trip. */
    errors = [];
    const undoRedo = await page.evaluate(() => {
        const st = window.enggDrawing.state, m = window.enggDrawing.model;
        const n = st.objects.length; let undos = 0;
        while (m.canUndo(st) && undos < 50) { document.getElementById("drawingUndo").click(); undos++; }
        const afterUndo = st.objects.length; let redos = 0;
        while (m.canRedo(st) && redos < 50) { document.getElementById("drawingRedo").click(); redos++; }
        return { n, undos, afterUndo, redos, afterRedo: st.objects.length };
    });
    results["history/undo-redo"] = { ...undoRedo, errors: [...errors] };

    /* Sheet operations through the UI-facing API. */
    errors = [];
    results["sheets/ops"] = {
        ...(await page.evaluate(() => {
            const s = window.enggDrawingSheets;
            const first = s.all()[0].id;
            s.renameSheet(first, "Renamed");
            const dup = s.duplicateSheet(first);
            return { count: s.all().length, names: s.all().map(x => x.name), dup: Boolean(dup) };
        })),
        errors: [...errors]
    };

    /* The whole document as it would be saved, then re-loaded. */
    errors = [];
    const body = await page.evaluate(() => JSON.parse(JSON.stringify(window.enggDrawingSheets.serializeDocumentBody())));
    results["document/serialized"] = { body, errors: [...errors] };

    /* Written solution: a drawing reference renders from a sheet. */
    errors = [];
    await acceptPopups(); await escape();
    await page.click("text=Written Solution");
    await sleep(200);
    results["solution/render"] = await page.evaluate(async () => {
        const sheets = window.enggDrawingSheets.all();
        try {
            window.datum.setSolution(`Equilibrium of the beam

[DRAWING_REFERENCE:${sheets[1].id}]

Then $F = ma$.`);
        } catch (e) { return { thrown: String(e.message) }; }
        await new Promise(r => setTimeout(r, 400));
        const out = document.getElementById("solutionPreview");
        return { html: out ? out.innerHTML.replace(/\s+/g, " ").slice(0, 20000) : null };
    });
    results["solution/render"].errors = [...errors];

    fs.writeFileSync(outFile, JSON.stringify(results, null, 1));
    console.log("wrote", outFile);
    await browser.close();
}

main().catch(async e => { console.error(e); process.exit(1); });
