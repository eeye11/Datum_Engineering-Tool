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
 * Each sheet's picture is THE SHEET'S OWN SOURCE - the TikZ the Drawing Space
 * compiles - with its object markers dropped. Exporting a conversion of a
 * canvas rendering would put a picture in the file that is not the one on the
 * screen; exporting the source puts the drawing's actual code there. The
 * SVG-conversion path (`svg-to-tikz.js`) remains only for a sheet saved before
 * sources were stored, which has no code to export.
 *
 * STANDARD LaTeX AND NOTHING ELSE that matters to LaTeX. The .tex is ordinary
 * source: a preamble, a `standalone` document class and one `tikzpicture` per
 * sheet. A user can paste it, edit it by hand, or open it in any LaTeX
 * installation. After the document, DAETUM appends its own document data as a
 * commented base64 block (`embeddedBlock`), which LaTeX ignores and DAETUM
 * reads back to reopen the file with every feature editable.
 *
 * WHAT REOPENS EXACTLY is the document model, not the file. The geometry
 * state is DAETUM's own; a drawing saved as .tex and reopened is read back
 * as the picture's features. The source and the internal geometry state are
 * kept apart on purpose: rendering never rewrites the source.
 *
 * DAETUM's own engine: nothing here runs TeX.
 */
import enggDrawingState from "../../model/drawing-state.js";
import enggDocumentFile from "../document-file.js";
import enggDrawingExport from "../document-export.js";
import { describeFeature } from "./feature-description.js";
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
        "% It is the full drawing (base64-encoded DAETUM document JSON), so DAETUM can",
        "% reopen this file with every feature editable. Do not edit it by hand.",
        `${DATA_BEGIN} daetum-document base64`,
        ...lines,
        DATA_END
    ].join("\n");
}

/* Whether a text carries DAETUM's embedded document. */
export function hasEmbeddedDocument(text) {
    return String(text || "").includes(DATA_BEGIN);
}

/*
 * The document envelope a .tex written by DAETUM carries - for the open path,
 * which reads envelopes. (The word after the BEGIN marker is a label only, so
 * files written when it said "enggdraw" read exactly the same.)
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
 * The document a .tex written by DAETUM carries, read and migrated through the
 * envelope's own reader: { found: false }, or { found: true, ok, document } /
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
    const heading = [
        "---------------------------------------------------------------------",
        `Sheet ${index + 1} of ${count}: "${sheet.name || `Sheet ${index + 1}`}"`
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
    const sentence = object => describeFeature(object, { objects, labels: labels.get(object.id) || [] });

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
        : [{ id: "sheet", name: "Sheet 1", objects: documentBody?.objects || [] }];
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
        "  times the picture's `scale`. Lengths in the comments are drawing units.",
        "  Every feature's commands are preceded by a comment saying what it is",
        "  and where; each sheet starts with a list of its features.",
        "  Compile with pdflatex (or lualatex/xelatex): standalone class + TikZ.",
        "  This is ordinary LaTeX: paste it back into DAETUM's Source tab to",
        "  render it again, or open it in any LaTeX installation.",
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
 * The PICTURE and the PREAMBLE, apart, and WITHOUT DAETUM'S OWN COMMENTARY.
 *
 * The .tex export surrounds each picture with headings, a feature list and
 * per-feature comments - useful in a file a human reads top to bottom, but
 * not what belongs in a written solution. What goes into the written
 * document is the DRAWING and nothing else: a plain `tikzpicture`, the same
 * commands the Source view and the export produce, with no sheet labels,
 * no world-scale notes and no placeholder geometry for an empty sheet.
 *
 * `colours` is a callback so the CALLER owns the palette across drawings:
 * on the first insert it starts a fresh palette, and on later inserts the
 * same palette is passed back so `daetum1` keeps its meaning document-wide.
 * The definitions it returns are declared once in the written document's
 * preamble (see `embedded-drawings.js`), not inside each picture.
 */
function cleanSheetPicture(documentBody, sheet, index, count, palette) {
    const objects = sheet.objects || [];

    if (!objects.length) {
        // Empty sheet: nothing to write; the caller explains it.
        return "";
    }

    /*
     * THE SHEET'S SOURCE IS THE SHEET'S DRAWING.
     *
     * What goes into the written solution is the picture the Drawing Space
     * shows, which is the sheet's TikZ source - markers removed, because they
     * are bookkeeping and not drawing. The SVG this used to convert is the old
     * object renderer's output, which is no longer what the student sees; using
     * it put a different picture in the write-up from the one they approved.
     */
    const storedSource = sheet.source && typeof sheet.source.source === "string" ? sheet.source.source : "";

    if (sourceHasCommands(storedSource)) {
        return sheetSourcePicture(storedSource, palette);
    }

    const rendered = enggDrawingExport.renderFittedDocument(
        sheetBody(documentBody, sheet),
        { width: RENDER_WIDTH_PX, svgOnly: true }
    );

    if (!rendered?.svg) {
        return "";
    }

    const { svg, bounds } = rendered;
    const camera = enggDrawingExport.cameraFor(bounds);
    const k = enggDrawingState.BASE_PIXELS_PER_UNIT * camera.zoom;

    /* The same fit the export uses: drawing units are millimetres on paper. */
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

    const groups = svgToTikz(svg, context);

    if (!groups.length) {
        return "";
    }

    return [
        `\\begin{tikzpicture}[x=1mm, y=1mm, scale=${num(scaleFactor, 4)}]`,
        groups.map(group => group.commands.map(line => `  ${line}`).join("\n")).join("\n\n"),
        "\\end{tikzpicture}"
    ].join("\n");
}

/*
 * Whether a stored source draws anything - commands between the picture and the
 * marker comments. A sheet with an empty picture is empty, not "has a source".
 */
function sourceHasCommands(source) {
    return String(source || "")
        .split("\n")
        .some((line) => {
            const text = line.trim();

            return (
                text !== "" &&
                !text.startsWith("%") &&
                !/^\\begin\s*\{tikzpicture\}/.test(text) &&
                !/^\\end\s*\{tikzpicture\}/.test(text)
            );
        });
}

/*
 * THE SHEET'S OWN SOURCE, as the picture a written solution embeds.
 *
 * The text is used AS STORED - it is the code that drew the sheet - with the
 * object markers dropped and any inline colour definitions lifted into the
 * shared palette, so two sheets sharing a colour define it once. Nothing is
 * re-scaled: the picture's coordinates are the drawing's coordinates, the same
 * ones the Drawing Space compiles.
 */
function sheetSourcePicture(source, palette) {
    const lines = String(source || "").split("\n");

    const kept = [];
    const definitions = [];

    lines.forEach((line) => {
        if (/^\s*%\s*DAETUM_OBJECT_(BEGIN|END)/.test(line)) {
            return;
        }

        if (/^\s*\\definecolor\{/.test(line)) {
            definitions.push(line.trim());
            return;
        }

        /*
         * A PICTURE THAT OPENS WITHOUT ITS UNITS GETS THEM.
         *
         * A drawing unit is a paper millimetre in DAETUM, and the drawing
         * source states that once, on its opening environment. A source
         * written by hand may leave it out; without it TikZ draws the picture
         * at its default centimetre and every sheet comes out ten times too
         * large. Adding the option is not rescaling - it states the unit the
         * coordinates were always in.
         */
        if (/^\s*\\begin\s*\{tikzpicture\}\s*$/.test(line)) {
            kept.push("\\begin{tikzpicture}[x=1mm, y=1mm]");
            return;
        }

        kept.push(line);
    });

    const body = kept.join("\n").trim();

    if (!body) {
        return "";
    }

    /*
     * THE PALETTE HOLDS THE COLOUR NAMES ACROSS DRAWINGS.
     *
     * Each object's code defines its own colour inline, which keeps the Source
     * tab self-contained. In a WRITTEN DOCUMENT that would define the same
     * colour once per object that uses it, so each distinct name is handed to
     * the shared palette here and printed once in the preamble.
     *
     * The picture keeps its own inline definitions when the palette cannot
     * take them - a `daetumC...` name declared inside the picture still
     * resolves, because the name and the value are stated together.
     */
    definitions.forEach((definition) => {
        const match = definition.match(/^\\definecolor\{([^}]+)\}\{([^}]+)\}\{([^}]+)\}/);

        if (match && palette && typeof palette.define === "function") {
            palette.define(match[1], match[2], match[3]);
        }
    });

    return body;
}

export function writeLatexPictureParts(documentBody, sheetId, getPalette = () => createPalette()) {
    const sheets = documentBody?.sheets || [];
    const index = Math.max(0, sheets.findIndex(sheet => sheet.id === sheetId));
    const sheet = sheets[index];

    if (!sheet) {
        return { preamble: [], picture: "", empty: true };
    }

    const palette = getPalette();
    const picture = cleanSheetPicture(documentBody, sheet, index, sheets.length, palette);

    return {
        preamble: palette.definitions(),
        picture,
        empty: !picture
    };
}

/*
 * ========================================================
 * EXPORT THE LIVE SOURCE AS A COMPLETE .tex
 * ========================================================
 *
 * The Source tab holds a drawing snippet - a `tikzpicture` and nothing else.
 * This wraps THAT TEXT, unchanged, in a preamble that compiles it: the same
 * picture the Drawing Space renders, in a document that opens in any LaTeX
 * installation or on Overleaf.
 *
 * The preamble is not guessed. It loads what DAETUM's own generated code
 * uses: tikz with arrows.meta (every head in a force, load or axis), calc,
 * amsmath and amssymb (the `$...$` values in engineering labels), xcolor (the
 * colour names), and the decoration library. Each colour the picture defines
 * inline is lifted into the preamble once, so the document does not declare
 * the same name twice.
 *
 * The coordinates are NOT touched. A drawing unit is a paper millimetre - the
 * unit the picture already opens with - so exporting never rescales the
 * drawing to fit a page.
 */
export const STANDALONE_LIBRARIES = Object.freeze([
    "arrows.meta",
    "calc",
    "decorations.pathmorphing"
]);

export function writeStandaloneFromSource(source, { title = "DAETUM drawing" } = {}) {
    const lines = String(source ?? "").replace(/\r\n/g, "\n").split("\n");

    const colours = [];
    const seenColours = new Set();

    const picture = lines
        .filter((line) => {
            if (/^\s*%\s*DAETUM_OBJECT_(BEGIN|END)/.test(line)) {
                return false;
            }

            const definition = line.match(/^\s*\\definecolor\{([^}]+)\}\{([^}]+)\}\{([^}]+)\}\s*$/);

            if (definition) {
                if (!seenColours.has(definition[1])) {
                    seenColours.add(definition[1]);
                    colours.push(`\\definecolor{${definition[1]}}{${definition[2]}}{${definition[3]}}`);
                }

                return false;
            }

            return true;
        })
        .join("\n")
        .trim();

    /*
     * A BARE SET OF COMMANDS IS STILL EXPORTED AS A PICTURE. The Source tab
     * accepts commands without the environment while a student is halfway
     * through typing; the export wraps them the same way the renderer does, so
     * what compiles here is what rendered there.
     */
    const body = /\\begin\s*\{tikzpicture\}/.test(picture)
        ? picture
        : `\\begin{tikzpicture}[x=1mm, y=1mm]\n${picture}\n\\end{tikzpicture}`;

    return [
        `% ${title} - exported from DAETUM`,
        `% ${new Date().toISOString()}`,
        "% Drawing units are millimetres on paper (x=1mm, y=1mm).",
        "% Compile with pdflatex, lualatex or xelatex.",
        "",
        "\\documentclass[tikz, border=5mm]{standalone}",
        "\\usepackage[T1]{fontenc}",
        "\\usepackage{amsmath}",
        "\\usepackage{amssymb}",
        "\\usepackage{xcolor}",
        `\\usetikzlibrary{${STANDALONE_LIBRARIES.join(",")}}`,
        ...colours,
        "",
        "\\begin{document}",
        "",
        body,
        "",
        "\\end{document}",
        ""
    ].join("\n");
}

export default {
    LATEX_EXTENSION,
    LATEX_MEDIA_TYPE,
    STANDALONE_LIBRARIES,
    readEmbeddedDocument,
    writeLatexDocument,
    writeLatexPicture,
    writeLatexPictureParts,
    writeStandaloneFromSource
};
