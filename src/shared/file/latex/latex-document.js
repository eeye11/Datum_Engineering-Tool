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
import enggExportTransform from "../../../shared/rendering/latex/export-transform.js";
import { pictureSource } from "../../../shared/rendering/latex/drawing-source.js";

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
     * THE SHEET'S SOURCE IS THE SHEET'S DRAWING, FITTED TO THE PAGE.
     *
     * What goes into the written solution is the picture the Drawing Space shows,
     * which is the sheet's TikZ source - markers removed, because they are
     * bookkeeping and not drawing. The SVG this used to convert is the old object
     * renderer's output, which is no longer what the student sees.
     *
     * AND IT IS FITTED. The stored source is at the drawing's AUTHORED size, one
     * model unit per millimetre, which for an ordinary engineering sketch is
     * several times wider than the page. `fittedSheetSource` rewrites the
     * coordinates and every physical size to the page's width - the same
     * transform the source pipeline uses, so the figure matches the sheet's
     * proportions and its strokes keep their relative weight.
     */
    const storedSource = sheet.source && typeof sheet.source.source === "string" ? sheet.source.source : "";

    if (sourceHasCommands(storedSource)) {
        return sheetSourcePicture(fittedSheetSource(storedSource, sheet), palette);
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
 * THE SHEET'S SOURCE, FITTED TO THE WRITTEN PAGE.
 *
 * A drawing is authored at one model unit per millimetre, and a written solution
 * is 170 mm wide. An ordinary beam-and-graph sketch is several times that, so the
 * stored source cannot be embedded as it stands - it would run off the page and
 * the student would be left resizing it by hand.
 *
 * THE DRAWING IS NORMALISED AT ITS SOURCE, not wrapped in `scale=` or
 * `\resizebox`. Rewriting the numbers is what lets the STROKES, DASHES, ARROW
 * HEADS and LABELS come with it: a `scale=` shrinks the geometry and leaves a
 * full-size pen and a full-size head on it, and a `\resizebox` shrinks the
 * rendered result while leaving the code unreadable and un-editable.
 *
 * The transform is the drawing's own (`exportTransformFor`), so a figure in the
 * written solution is the same shape as the one on the sheet - and the per-sheet
 * transform is computed from the whole sheet, so the beam, the supports and the
 * graph keep their relative layout.
 *
 * THE STORED SOURCE IS ALREADY IN EXPORT SPACE.
 *
 * The source pipeline normalises every object as it writes it: coordinates are
 * shifted to a local origin and reduced, and pens, dashes and heads are reduced
 * with them. Applying a SECOND export transform to that text would reduce it
 * twice - the drawing would shrink twice and every stroke would thin twice - and
 * (because a second reduction of an already-shifted picture sees a smaller
 * bounding box) it would do so inconsistently.
 *
 * So the sheet's own source is embedded as it stands. It is already the drawn
 * figure at the page's limits; the picture is the one the Source tab shows.
 * Rewriting is kept for source that was NOT produced by the pipeline - a figure
 * stored before the normalisation existed - which is detected by its picture
 * declaring `x=1mm, y=1mm` and containing coordinates outside the page. There is
 * exactly one path, and it is the identity for current documents.
 */
function fittedSheetSource(storedSource, sheet) {
    const objects = Array.isArray(sheet?.objects) ? sheet.objects : [];

    if (!objects.length || !sourceNeedsNormalising(storedSource)) {
        return storedSource;
    }

    /*
     * THE LEGACY CASE: source stored before the pipeline normalised it.
     *
     * It is written in raw model millimetres, so it is reduced here with the
     * drawing's ONE transform (the same Fit-All measurement the current source
     * uses) - coordinates, pens, dashes, heads and fonts together.
     */
    const visible = objects.filter((object) => object && object.visible !== false && object.hidden !== true);

    const transform = syncExportTransform(visible, {
        maxWidth: PAPER_WIDTH_MM,
        maxHeight: PAPER_HEIGHT_MM,
    });

    if (!transform || transform.factor >= 1) {
        return storedSource;
    }

    return rewritePictureAtExportScale(storedSource, transform);
}

/*
 * WHETHER A STORED PICTURE IS STILL IN RAW MODEL MILLIMETRES.
 *
 * Current source has been shifted to a local origin and reduced, so every
 * coordinate is inside the page. Source written before that existed keeps its
 * authored coordinates, which for any ordinary sketch run past it - so a
 * coordinate outside the paper limits is the honest, text-only signal.
 */
function sourceNeedsNormalising(source) {
    const text = String(source || "");

    for (const match of text.matchAll(/\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g)) {
        const x = Number(match[1]);
        const y = Number(match[2]);

        if (Number.isFinite(x) && Number.isFinite(y) && (Math.abs(x) > PAPER_WIDTH_MM || Math.abs(y) > PAPER_HEIGHT_MM)) {
            return true;
        }
    }

    return false;
}

/*
 * REWRITE ONE PICTURE AT THE EXPORT SCALE.
 *
 * A STORED SOURCE IS ALREADY WRITTEN, so its coordinates cannot be transformed
 * by the model - they have to be read back out of the text and rewritten. This
 * does exactly that, and only for the things that are size-dependent:
 *
 *   every coordinate      (x - minX) * factor,  (y - minY) * factor
 *   every `line width`     nominal * factor
 *   every `dash pattern`   each on/off length * factor
 *   every `font=\fontsize{s}{p}`  s and p, with the readable floor
 *
 * NOTHING ELSE IS TOUCHED. A colour, an opacity, a label's text, an axis name, an
 * `arc`'s angles, a node's anchor - all of them are left character for character.
 * That is what keeps the rewrite honest: it scales SIZE, and only size.
 *
 * A coordinate that is not a plain number (a relative `++(2,0)`, a named node)
 * is left as it is: it is expressed in relation to something already scaled, and
 * rewriting it would move the drawing. The same is true of an `arc`'s radius,
 * which is a LENGTH - it is scaled by the length rule below, never shifted.
 */
function rewritePictureAtExportScale(source, transform) {
    const factor = transform.factor;
    const origin = transform.bounds || { minX: 0, minY: 0 };

    const number = (value) => {
        const parsed = Number(value);

        if (!Number.isFinite(parsed)) {
            return value;
        }

        return String(Number(parsed.toFixed(4)));
    };

    const scaleLength = (value) => number(Number(value) * factor);

    /* A POINT, in the computed coordinate space. A relative step is left alone. */
    const scalePoint = (match, prefix, x, y, suffix) => {
        const px = Number(x);
        const py = Number(y);

        if (!Number.isFinite(px) || !Number.isFinite(py) || /[+\-]$/.test(prefix)) {
            return match;
        }

        return `${prefix}${number((px - (origin.minX || 0)) * factor)},${number(
            (py - (origin.minY || 0)) * factor
        )}${suffix}`;
    };

    let text = String(source || "");

    text = text.replace(/(\+{0,2}\()\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*(\))/g, scalePoint);

    text = text.replace(/line width\s*=\s*([\d.]+)\s*pt/g, (match, value) =>
        `line width=${scaleLength(value)}pt`
    );

    text = text.replace(/dash pattern=((?:(?:on|off)\s+[\d.]+pt\s*)+)/g, (match, body) => {
        const rewritten = body.replace(/(on|off)\s+([\d.]+)pt/g, (mark, kind, value) =>
            `${kind} ${scaleLength(value)}pt`
        );

        return `dash pattern=${rewritten.trim()}`;
    });

    /* A bare `dashed` / `dotted` is TikZ's own physical pattern; state it. */
    text = text.replace(/(?<=[,\[])\s*dashed\s*(?=[,\]])/g, () =>
        ` dash pattern=on ${scaleLength(3)}pt off ${scaleLength(3)}pt`
    );

    text = text.replace(/(?<=[,\[])\s*dotted\s*(?=[,\]])/g, () =>
        ` dash pattern=on ${scaleLength(0.8)}pt off ${scaleLength(2.4)}pt`
    );

    text = text.replace(/font=\\fontsize\{([\d.]+)\}\{([\d.]+)\}/g, (match, size, leading) => {
        const scaled = Math.max(enggExportTransform.MIN_EXPORT_FONT_PT, Number(size) * factor);

        return `font=\\fontsize{${number(scaled)}}{${number(scaled * 1.2)}}`;
    });

    return text;
}

/*
 * THE PAINTING HELPERS THE SHEET SOURCE NEEDS, reached by name so this module
 * does not import the source pipeline (which imports the drawing state).
 */
function syncExportTransform(objects, limits) {
    if (typeof enggExportTransform?.drawingBounds !== "function") {
        return null;
    }

    const bounds = enggExportTransform.drawingBounds(objects);

    if (!bounds) {
        return null;
    }

    return enggExportTransform.createExportContext({ bounds, ...limits });
}

/*
 * THE SHEET'S OWN SOURCE, as the picture a written solution embeds.
 *
 * The text arrives ALREADY FITTED to the page (see `fittedSheetSource`), so it
 * is used as it stands - it is the code that drew the sheet, with the object
 * markers dropped and any inline colour definitions lifted into the shared
 * palette, so two sheets sharing a colour define it once.
 */
function sheetSourcePicture(source, palette) {
    /*
     * THE PICTURE, NOT THE STUDENT'S SOURCE TAB TEXT.
     *
     * `pictureSource` removes every comment DAETUM generated - the legacy
     * markers, the readable `% DAETUM OBJECT:` name line and the identity
     * fields - while leaving every command and every comment the STUDENT wrote
     * character for character. This is an export into their own `.tex`, so
     * nothing of DAETUM's bookkeeping belongs in it.
     */
    const lines = pictureSource(source).split("\n");

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

/*
 * THE LATEX A DRAWING SHEET STANDS FOR, as one fragment.
 *
 * This is what a LINKED drawing renders from. The sheet's stored source is the
 * canonical picture - the text the Source tab edits - so it is used as it
 * stands; its inline colour definitions travel with it, because a fragment
 * rendered on its own has no written-solution preamble to inherit them from.
 *
 * A sheet whose source has no commands (one saved before sources were stored,
 * or one whose objects predate it) is written through the same fitted picture
 * writer the export uses.
 *
 * Ordinary LaTeX comes back untouched: the drawing workspace's Source tab may
 * hold a `tikzpicture` DAETUM did not generate, and a picture is a picture.
 */
export function readSheetLatex(sheet) {
    if (!sheet) {
        return "";
    }

    const stored =
        sheet.source && typeof sheet.source.source === "string"
            ? sheet.source.source
            : "";

    if (sourceHasCommands(stored)) {
        return pictureSource(stored).trim();
    }

    return cleanSheetPicture(
        { sheets: [sheet], activeSheetId: sheet.id },
        sheet,
        0,
        1,
        createPalette()
    ).trim();
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
    readSheetLatex,
    writeLatexDocument,
    writeLatexPicture,
    writeLatexPictureParts,
    writeStandaloneFromSource
};
