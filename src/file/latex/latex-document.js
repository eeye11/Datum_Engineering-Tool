/*
 * ============================================================
 * THE .tex FILE: WRITING IT, AND READING IT BACK
 * ============================================================
 *
 * One .tex holds the whole document: every sheet is one picture (one page
 * of a `standalone` document), drawn in standard TikZ-style commands, so it
 * compiles in any LaTeX installation or Overleaf, and any AI model given the
 * file can read it.
 *
 * Each sheet's picture is the renderer's own output converted to commands
 * (`svg-to-tikz.js`), so it looks exactly like the canvas, and each feature's
 * commands are preceded by a sentence saying what it is
 * (`feature-description.js`).
 *
 * THE FILE REOPENS EXACTLY. The complete document, in the .enggdraw format,
 * rides along at the end as a comment block. LaTeX ignores comments; DAETUM
 * reads the block and restores every feature as it was - editable, with its
 * parents, parameters and sheet settings - rather than trying to infer a
 * beam from the lines that draw it.
 *
 * DAETUM's own engine: nothing here runs TeX.
 */
import enggDrawingState from "../../core/model/drawing-state.js";
import enggDocumentFile from "../document-file.js";
import enggDrawingExport from "../document-export.js";
import { describeFeature, describeScale } from "./feature-description.js";
import { createPalette, num, svgToTikz, unmappedCharacters } from "./svg-to-tikz.js";

export const LATEX_EXTENSION = "tex";
export const LATEX_MEDIA_TYPE = "application/x-tex";

/* The rendered width a sheet is converted from, and the paper it is fitted to. */
const RENDER_WIDTH_PX = 1000;
const PAPER_WIDTH_MM = 170;
const PAPER_HEIGHT_MM = 240;
const PT_PER_MM = 72.27 / 25.4;
const MIN_SCALE = 0.01;
const MAX_SCALE = 10;

const DATA_BEGIN = "%% DAETUM-DOCUMENT-BEGIN";
const DATA_END = "%% DAETUM-DOCUMENT-END";
const DATA_LINE = 76;

/* ---------- the embedded document ---------- */

function toBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = "";

    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }

    return btoa(binary);
}

function fromBase64(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }

    return new TextDecoder().decode(bytes);
}

function embeddedBlock(documentBody) {
    const json = JSON.stringify(enggDocumentFile.createDocument(documentBody));
    const encoded = toBase64(json);
    const lines = [];

    for (let i = 0; i < encoded.length; i += DATA_LINE) {
        lines.push(`%% ${encoded.slice(i, i + DATA_LINE)}`);
    }

    return [
        "% ---------------------------------------------------------------------",
        "% DAETUM DOCUMENT DATA. Everything below is a comment: LaTeX ignores it.",
        "% It is the full drawing (base64-encoded .enggdraw JSON), so DAETUM can",
        "% reopen this file with every feature editable. Do not edit it by hand.",
        `${DATA_BEGIN} enggdraw base64`,
        ...lines,
        DATA_END
    ].join("\n");
}

/* Whether a text carries DAETUM's embedded document. */
export function hasEmbeddedDocument(text) {
    return String(text || "").includes(DATA_BEGIN);
}

/*
 * The .enggdraw envelope a .tex written by DAETUM carries, exactly as an
 * .enggdraw file would hold it - for the open path, which reads envelopes.
 *
 * { found: false }                          no block (written by hand or elsewhere)
 * { found: true, ok: true, envelope }       the block, decoded
 * { found: true, ok: false, failure, detail } the block is damaged
 */
export function readEmbeddedEnvelope(text) {
    const source = String(text || "");
    const begin = source.indexOf(DATA_BEGIN);

    if (begin < 0) {
        return { found: false };
    }

    const end = source.indexOf(DATA_END, begin);
    const body = source
        .slice(source.indexOf("\n", begin) + 1, end < 0 ? undefined : end)
        .split(/\r?\n/)
        .map(line => line.replace(/^%+\s?/, "").trim())
        .join("");

    try {
        return { found: true, ok: true, envelope: JSON.parse(fromBase64(body)) };
    } catch {
        return {
            found: true,
            ok: false,
            failure: enggDocumentFile.Failure.NOT_JSON,
            detail: "The drawing data in this .tex file is damaged, so it cannot be reopened as a DAETUM drawing."
        };
    }
}

/*
 * The document a .tex written by DAETUM carries, read and migrated as an
 * .enggdraw would be: { found: false }, or { found: true, ok, document } /
 * { found: true, ok: false, failure, detail }.
 */
export function readEmbeddedDocument(text) {
    const embedded = readEmbeddedEnvelope(text);

    if (!embedded.found || !embedded.ok) {
        return embedded;
    }

    return { found: true, ...enggDocumentFile.readDocument(embedded.envelope) };
}

/* ---------- one sheet ---------- */

function sheetBody(documentBody, sheet) {
    return { ...documentBody, sheets: [sheet], activeSheetId: sheet.id };
}

/* The text each feature shows on the drawing, by feature id. */
function featureLabels(svg) {
    const labels = new Map();

    for (const group of svg.querySelectorAll("[data-feature-id]")) {
        const texts = [...group.querySelectorAll("text")].map(t => t.textContent.trim()).filter(Boolean);
        labels.set(group.getAttribute("data-feature-id"), texts);
    }

    return labels;
}

function comment(text, indent = "") {
    return String(text)
        .split("\n")
        .map(line => `${indent}% ${line}`.trimEnd())
        .join("\n");
}

/*
 * One sheet as a commented picture. `palette` is shared across sheets so a
 * colour has one name in the whole file.
 */
function sheetPicture(documentBody, sheet, index, count, palette) {
    const objects = sheet.objects || [];
    const scale = sheet.scale || null;
    const heading = [
        "---------------------------------------------------------------------",
        `Sheet ${index + 1} of ${count}: "${sheet.name || `Sheet ${index + 1}`}"`,
        describeScale(scale)
    ];

    const rendered = objects.length
        ? enggDrawingExport.renderFittedDocument(sheetBody(documentBody, sheet), { width: RENDER_WIDTH_PX, svgOnly: true })
        : null;

    if (!rendered?.svg) {
        return [
            comment([...heading, objects.length ? "Every feature on this sheet is hidden." : "This sheet is empty.", "---------------------------------------------------------------------"].join("\n")),
            "\\begin{tikzpicture}",
            "\\path (0,0) rectangle (10,10);",
            "\\end{tikzpicture}"
        ].join("\n");
    }

    const { svg, bounds } = rendered;
    const camera = enggDrawingExport.cameraFor(bounds);
    const k = enggDrawingState.BASE_PIXELS_PER_UNIT * camera.zoom;

    /*
     * Drawing units are millimetres on paper (x=1mm), scaled to fit a page -
     * within limits, because a sheet holding one point-sized feature (a lone
     * note) has no extent to fit and would otherwise ask for an enormous scale.
     *
     * Line widths and text are sized from the PAGE: the rendered width maps to
     * the paper, so a stroke or a label keeps its size relative to the page as
     * it does relative to the screen, whatever the drawing's extent.
     */
    const paperMmPerPx = Math.min(PAPER_WIDTH_MM / bounds.width, PAPER_HEIGHT_MM / bounds.height);
    const scaleFactor = Number(Math.min(Math.max(paperMmPerPx * k, MIN_SCALE), MAX_SCALE).toPrecision(3));
    const context = {
        toWorld: (px, py) => ({
            x: (px - bounds.width / 2) / k + camera.panX,
            y: (bounds.height / 2 - py) / k + camera.panY
        }),
        unitsPerPx: 1 / k,
        ptPerPx: paperMmPerPx * PT_PER_MM,
        palette
    };

    const byId = new Map(objects.map(object => [object.id, object]));
    const labels = featureLabels(svg);
    const groups = svgToTikz(svg, context);
    const described = groups
        .map(group => group.featureId && byId.get(group.featureId))
        .filter(Boolean);
    const unique = [...new Set(described)];
    const sentence = object => describeFeature(object, { objects, scale, labels: labels.get(object.id) || [] });

    const summary = unique.length
        ? [`Features (${unique.length}):`, ...unique.map((object, i) => `  ${i + 1}. ${sentence(object)}`)]
        : ["No visible features."];

    const body = groups.map(group => {
        const object = group.featureId && byId.get(group.featureId);
        const title = object ? `${unique.indexOf(object) + 1}. ${sentence(object)}` : "Drawn by the sheet itself.";
        return `${comment(title, "  ")}\n${group.commands.map(line => `  ${line}`).join("\n")}`;
    });

    return [
        comment([...heading, ...summary, "---------------------------------------------------------------------"].join("\n")),
        `\\begin{tikzpicture}[x=1mm, y=1mm, scale=${num(scaleFactor, 4)}]`,
        body.join("\n\n"),
        "\\end{tikzpicture}"
    ].join("\n");
}

/*
 * A character no LaTeX font here has, declared so pdflatex prints its code
 * point rather than stopping. xelatex and lualatex print the character itself
 * and do not define the command, hence the guard.
 */
function unicodeDeclarations(characters) {
    if (!characters.length) {
        return [];
    }

    const code = c => c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0");

    return [
        "\\makeatletter",
        "\\@ifundefined{DeclareUnicodeCharacter}{}{%",
        ...characters.map(c => `  \\DeclareUnicodeCharacter{${code(c)}}{[U+${code(c)}]}%`),
        "}",
        "\\makeatother"
    ];
}

/* ---------- the whole document ---------- */

/*
 * The complete .tex for a document body (as `serializeDocumentBody` returns
 * it): every sheet, in order, then the embedded document.
 */
export function writeLatexDocument(documentBody, { title = "Drawing", exportedAt = new Date() } = {}) {
    const sheets = documentBody?.sheets?.length
        ? documentBody.sheets
        : [{ id: "sheet", name: "Sheet 1", objects: documentBody?.objects || [], scale: documentBody?.scale || null }];
    const palette = createPalette();
    const pictures = sheets.map((sheet, index) => sheetPicture(documentBody, sheet, index, sheets.length, palette));
    const colours = palette.definitions();
    const drawn = pictures.join("\n").split("\n").filter(line => !/^\s*%/.test(line)).join("\n");
    const unicode = unmappedCharacters(drawn);

    const header = comment([
        "=====================================================================",
        `${title} - engineering drawing exported from DAETUM`,
        `Exported ${exportedAt.toISOString()}; ${sheets.length} sheet${sheets.length === 1 ? "" : "s"}.`,
        "",
        "HOW TO READ THIS FILE",
        "  Each sheet is one tikzpicture (one page). Coordinates are DAETUM",
        "  drawing units, x to the right and y UP; on paper one unit is 1 mm",
        "  times the picture's `scale`. Real-world lengths come from each sheet's",
        "  World Scale and are stated in the comments.",
        "  Every feature's commands are preceded by a comment saying what it is",
        "  and where; each sheet starts with a list of its features.",
        "  Compile with pdflatex (or lualatex/xelatex): standalone class + TikZ.",
        "  The block at the end lets DAETUM reopen this file exactly.",
        "====================================================================="
    ].join("\n"));

    return [
        header,
        "\\documentclass[tikz, border=5mm]{standalone}",
        "\\usepackage[T1]{fontenc}",
        "\\usepackage{amssymb}",
        "\\renewcommand{\\familydefault}{\\sfdefault}",
        ...colours,
        ...unicodeDeclarations(unicode),
        "",
        "\\begin{document}",
        "",
        pictures.join("\n\n"),
        "",
        "\\end{document}",
        "",
        embeddedBlock(documentBody),
        ""
    ].join("\n");
}

/*
 * One sheet as editable code: its picture, preceded by the colours it uses -
 * what the LaTeX editor shows for "From drawing". No document wrapper and no
 * embedded data: this is code to read and change, not a file to reopen.
 */
export function writeLatexPicture(documentBody, sheetId) {
    const sheets = documentBody?.sheets || [];
    const index = Math.max(0, sheets.findIndex(sheet => sheet.id === sheetId));
    const sheet = sheets[index];

    if (!sheet) {
        return "";
    }

    const palette = createPalette();
    const picture = sheetPicture(documentBody, sheet, index, sheets.length, palette);

    return [...palette.definitions(), picture].join("\n");
}

/*
 * The canonical source shown by the drawing editor: the rendered sheet's
 * TikZ commands, without export commentary, paper-fit scaling or placeholders.
 */
export function writeCanonicalTikzPicture(documentBody, sheetId) {
    const sheets = documentBody?.sheets || [];
    const sheet = sheets.find(candidate => candidate.id === sheetId);

    if (!sheet) {
        return "";
    }

    const objects = sheet.objects || [];

    if (!objects.length) {
        return "\\begin{tikzpicture}\n\\end{tikzpicture}";
    }

    const rendered = enggDrawingExport.renderFittedDocument(
        sheetBody(documentBody, sheet),
        { width: RENDER_WIDTH_PX, svgOnly: true }
    );

    if (!rendered?.svg) {
        return "\\begin{tikzpicture}\n\\end{tikzpicture}";
    }

    const { svg, bounds } = rendered;
    const camera = enggDrawingExport.cameraFor(bounds);
    const k = enggDrawingState.BASE_PIXELS_PER_UNIT * camera.zoom;
    const palette = createPalette();
    const commands = svgToTikz(svg, {
        toWorld: (px, py) => ({
            x: (px - bounds.width / 2) / k + camera.panX,
            y: (bounds.height / 2 - py) / k + camera.panY
        }),
        unitsPerPx: 1 / k,
        ptPerPx: PT_PER_MM / k,
        palette
    }).flatMap(group => group.commands);

    return [
        "\\begin{tikzpicture}",
        ...palette.definitions(),
        ...commands,
        "\\end{tikzpicture}"
    ].join("\n");
}

export default {
    LATEX_EXTENSION,
    LATEX_MEDIA_TYPE,
    readEmbeddedDocument,
    writeLatexDocument,
    writeLatexPicture,
    writeCanonicalTikzPicture
};
