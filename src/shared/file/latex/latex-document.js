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
import { readLatexDrawing } from "./latex-reader.js";

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

/*
 * ============================================================
 * HOW THE PICTURE READS BACK INTO DRAWING UNITS
 * ============================================================
 *
 * The pictures in a `.tex` are written for PAPER: a sheet can be several
 * hundred millimetres across and the page is 170, so each picture carries a
 * `scale=` that makes it fit. Its coordinates are still drawing units - the
 * scale is stated once, on the picture - which is why a reader must be told
 * what it was: without that, every reopened drawing comes back smaller than it
 * was by exactly the factor chosen to print it.
 *
 * So the writer records, per sheet, the transform it printed with, in one
 * comment line beside the sheet's heading. A comment is invisible to LaTeX and
 * survives any editor that keeps the line, and a picture that has lost it reads
 * back exactly as it does today - at its coordinates, unscaled.
 *
 * The line names the factors; it does not restate the drawing.
 */
const VIEW_BEGIN = "%% DAETUM-PICTURE-VIEW";

/*
 * The line itself.
 *
 * `origin-x` / `origin-y` are the drawing's own corner - the point the picture
 * calls `(0, 0)` - which is what its `shift={(-minX, -minY)}` states on the
 * environment. The reader puts every coordinate back onto that corner, so a
 * sheet drawn around `(60, -2)` reopens around `(60, -2)`.
 */
function viewRecord(camera) {
    return (
        `${VIEW_BEGIN} ` +
        `origin-x=${num(camera.originX, 4)} origin-y=${num(camera.originY, 4)} ` +
        `pan-x=${num(camera.panX, 4)} pan-y=${num(camera.panY, 4)} ` +
        `scale=${num(camera.scaleFactor, 4)}`
    );
}

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
 * WHETHER A CHARACTER IS VISIBLE DRAWING CODE.
 *
 * A comment is not, a blank line is not, and the picture's own delimiters are
 * not: a `tikzpicture` that holds only those draws nothing at all.
 */
function isDrawingStatement(line) {
    const text = String(line || "").trim();

    return (
        text !== "" &&
        !/^%/.test(text) &&
        !/^\\begin\s*\{tikzpicture\}/.test(text) &&
        !/^\\end\s*\{tikzpicture\}/.test(text)
    );
}

/*
 * THE PICTURE THE FILE ITSELF HOLDS, when its embedded document has none.
 *
 * THIS IS THE FALLBACK THAT MAKES A DAETUM FILE OPEN EVEN WITH A BROKEN
 * ENVELOPE. The embedded document is the best copy of a drawing - it is the
 * model, with every feature editable - but it is not the only copy. The
 * `tikzpicture`s above it are the same sheet written as ordinary LaTeX, and a
 * file whose envelope is damaged is still a picture someone made.
 *
 * ONLY A PICTURE WITH SOMETHING IN IT IS TAKEN. Finding a `tikzpicture`
 * environment proves nothing: a LaTeX document that merely loads TikZ, or a
 * sheet whose only content is its preamble, would otherwise be "opened" as an
 * empty drawing - which is the silent replacement Section 5 of the brief
 * forbids. So the text between the first picture's delimiters has to hold at
 * least one statement that draws.
 *
 * Returns the picture as source text, or null.
 */
/*
 * WHERE A PICTURE'S OPENS, AND THE OPTION LIST THAT MAY BE THE SAME LINE.
 *
 * `[^\n]*` would end the search at the first NEGATIVE NUMBER: the picture opens
 * with `shift={(-150,-30)}`, and a class that sees `\n` where there is none is
 * free to match the `-` instead. The rest of the option list is then read as
 * the picture's body, and its `)` and `-` are reported as drawing.
 */
const PICTURE_OPEN = /^\s*\\begin\s*\{tikzpicture\}/m;
const PICTURE_CLOSE = /^\s*\\end\s*\{tikzpicture\}/m;

/* The end of the line the picture's opening tag is on. */
function lineEndAfter(text, at) {
    const newline = text.indexOf("\n", at);

    return newline < 0 ? text.length : newline;
}

/* The start of the line `at` sits on - what a whole-line slice begins from. */
function lineStartOf(text, at) {
    const newline = text.lastIndexOf("\n", Math.max(0, at - 1));

    return newline < 0 ? 0 : newline + 1;
}

/*
 * Where a picture begins: the nearest `VIEW_BEGIN` line above it, or the line
 * its opening tag is on when there is none - bounded by the picture before it,
 * so another sheet's record can never be taken as this one's.
 */
function pictureStart(source, openAt) {
    const previousClose = source.lastIndexOf("\\end{tikzpicture}", openAt);
    const floor = previousClose < 0 ? 0 : previousClose;
    const above = source.slice(floor, openAt);
    const record = above.lastIndexOf(VIEW_BEGIN);

    return record < 0
        ? lineStartOf(source, openAt)
        : lineStartOf(source, floor + record);
}

export function embeddedPictureSource(text) {
    const source = String(text || "");
    const open = PICTURE_OPEN.exec(source);

    if (!open) {
        return null;
    }

    /*
     * THE PICTURE INCLUDES ITS OWN ENVIRONMENT, not just the lines between its
     * delimiters. The opening line carries the units, the print scale and the
     * origin - everything a reader needs to put the coordinates back - and a
     * body handed on without it is a list of numbers with no frame.
     */
    const closing = PICTURE_CLOSE.exec(source.slice(open.index + open[0].length));

    if (!closing) {
        return null;
    }

    /*
     * THE PICTURE INCLUDES THE PRINT RECORD THAT SITS ABOVE IT.
     *
     * A slice taken from `open.index` began at the `\begin` line and never
     * contained the `%% DAETUM-PICTURE-VIEW` line the writer puts beside every
     * sheet - and a writer may leave a blank line between the two, so "the line
     * above the tag" is not the answer either. `pictureViewFor` looks for that
     * record ABOVE the opening, so a picture without it was read at the wrong
     * scale and place: a saved drawing reopened at the wrong coordinates, and
     * an empty sheet lost the record saying its placeholder is not geometry.
     *
     * The slice therefore starts at the nearest record line above this picture,
     * and never reaches further back than the previous picture - an earlier
     * sheet's record is not this one's.
     */
    const start = pictureStart(source, open.index);

    const picture = source.slice(
        start,
        open.index + open[0].length + closing.index + closing[0].length
    );

    /* The lines between the delimiters, which is where drawing statements live. */
    const body = source.slice(
        open.index + open[0].length,
        open.index + open[0].length + closing.index
    );

    return body.split(/\r?\n/).some(isDrawingStatement) ? picture : null;
}

/*
 * WHETHER A PICTURE IS ONE OF DAETUM'S OWN, NOT SOMETHING A HUMAN TYPED.
 *
 * Two independent marks, and either is enough:
 *
 *   - the recorder line the writer puts beside every sheet it can measure,
 *     and
 *   - a picture that accepts the recorder's output: a sheet that draws
 *     nothing is written as a bare `\path (0,0) rectangle (10,10);` purely so
 *     the file has a picture, and it has to say so, or a reopened empty sheet
 *     would count that placeholder as a rectangle the user drew.
 *
 * A sheet written this way is READ at the coordinates in the picture. A
 * picture that is not DAETUM's is LaTeX, and LaTeX's unit rules apply to it
 * (see `readLatexDrawing`).
 */
const EMPTY_SHEET_PICTURE = /\\path\s*\(\s*0\s*,\s*0\s*\)\s*rectangle\s*\(\s*10\s*,\s*10\s*\)\s*;/;

function isDaetumPicture(picture) {
    const text = String(picture || "");

    if (text.includes(VIEW_BEGIN)) {
        return true;
    }

    /* An empty sheet's placeholder, in a picture that holds nothing else. */
    return EMPTY_SHEET_PICTURE.test(text) && !isDrawingBlock(text.replace(EMPTY_SHEET_PICTURE, ""));
}

/*
 * THE SAME QUESTION, ANSWERED WHERE THE ANSWER IS KNOWN FOR CERTAIN: THE MODEL.
 *
 * A picture DAETUM wrote and is SAVING now is DAETUM's, whatever it looks like -
 * including a sheet that draws nothing, whose placeholder would otherwise read
 * back as a rectangle. `source` is the document body being written, and a sheet
 * it lists is one this application owns.
 *
 * `picture` wins when it is given, because it is what the file actually holds.
 */
function daetumOwnedPicture(picture, source) {
    if (picture === undefined) {
        return true;
    }

    if (picture === null) {
        return false;
    }

    if (isDaetumPicture(picture)) {
        return true;
    }

    return Boolean(source && sheetOfSource(source, picture));
}

/* Whether a text holds any drawing command at all. */
function isDrawingBlock(text) {
    return String(text || "")
        .split(/\r?\n/)
        .some(isDrawingStatement);
}

/*
 * The sheet of `source` that is the same picture as `picture`.
 *
 * A sheet is the same picture when its stored source is exactly the fragment
 * being tested (one sheet written on its own - the exporter's own question) or
 * when it draws nothing at all (the placeholder case).
 */
function sheetOfSource(source, picture) {
    const sheets = Array.isArray(source?.sheets) ? source.sheets : [];
    const wanted = String(picture || "").trim();

    return sheets.find((sheet) => {
        const stored = sheet?.source && typeof sheet.source.source === "string" ? sheet.source.source.trim() : "";

        return stored !== "" && (stored === wanted || stored.includes(wanted));
    }) || sheets.find((sheet) => !(sheet?.objects || []).length);
}

/*
 * ONE SHEET, AS AN EDITED .tex SHOWS IT - WITH ITS PRINT RECORD.
 *
 * The picture alone says where its coordinates are, not what they were on the
 * page: `scale=` and `shift=` say that, and a reader that has only the picture
 * reads them (see `picturePrintTransform` in the reader). That works, but the
 * picture's numbers are rounded for printing, so the record the sheet already
 * has - at four decimal places - is the better statement of the same thing.
 *
 * The record goes ABOVE the picture, where `pictureViewFromText` looks for it,
 * as it is in a whole file.
 */
function pictureWithView(picture, view) {
    return view ? `${viewRecord(view)}\n${picture}` : String(picture);
}

/* The record a sheet states, in the shape `viewRecord` takes. */
function viewOfSheet(sheet) {
    const view = sheet?.view || sheet?.source?.view;

    if (!view || !(Number(view.scaleFactor) > 0)) {
        return null;
    }

    return {
        originX: Number(view.originX) || 0,
        originY: Number(view.originY) || 0,
        panX: Number(view.panX) || 0,
        panY: Number(view.panY) || 0,
        scaleFactor: Number(view.scaleFactor)
    };
}

/*
 * THE PRINT TRANSFORM OF ONE SHEET, FOR THE READER.
 *
 * The record that belongs to the sheet holding `picture` is the nearest
 * `VIEW_BEGIN` line ABOVE the picture's opening - never one below it, because a
 * document's other sheets' records sit after this sheet's picture. Reading the
 * last line in the file instead (what this used to do) put every sheet but the
 * last at the wrong scale and the wrong place.
 *
 * `null` when there is no such line, and then the picture's OWN opening - the
 * `scale=` and `shift={(...)}` the writer prints there - is the record, which
 * `picturePrintTransform` in the reader knows how to take apart.
 */
export function pictureViewFromText(text) {
    return pictureViewFor(embeddedPictureSource(text));
}

function pictureViewFor(picture) {
    const source = String(picture || "");
    const open = PICTURE_OPEN.exec(source);

    if (!open) {
        return null;
    }

    const line = source
        .slice(0, open.index)
        .split(/\r?\n/)
        .reverse()
        .find((candidate) => candidate.trim().startsWith(VIEW_BEGIN));

    const found = line ? declaredViewFields(line) : null;

    if (!found || !found.scale || found.scale <= 0) {
        return null;
    }

    return {
        originX: found.originX || 0,
        originY: found.originY || 0,
        panX: found.panX || 0,
        panY: found.panY || 0,
        scaleFactor: found.scale,
        plottable: found.scale * PT_PER_MM / 4
    };
}

/* The named factors on ONE recorded view line, or null when it has none. */
function declaredViewFields(line) {
    if (!line) {
        return null;
    }

    const field = (name) => {
        const found = String(line).match(new RegExp(`\\b${name}=([-\\d.eE+]+)`));
        const value = found ? Number(found[1]) : NaN;

        return Number.isFinite(value) ? value : null;
    };

    return {
        originX: field("origin-x"),
        originY: field("origin-y"),
        panX: field("pan-x"),
        panY: field("pan-y"),
        scale: field("scale")
    };
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
 * One sheet's picture, and the camera that drew it.
 *
 * The camera is returned with the text because the two are one measurement: the
 * scale, the pen widths and the labels are all derived from where THAT render
 * put the drawing, so a caller that needs the numbers needs this camera and not
 * a second fit that could disagree with it.
 *
 * `null` when the sheet draws nothing - an empty sheet, or one whose every
 * feature is hidden - because there is no picture to measure.
 */
function sheetPictureWithCamera(documentBody, sheet, index, count, palette) {
    const objects = sheet.objects || [];
    const heading = [
        "---------------------------------------------------------------------",
        `Sheet ${index + 1} of ${count}: "${sheet.name || `Sheet ${index + 1}`}"`
    ];

    const rendered = objects.length
        ? enggDrawingExport.renderFittedDocument(sheetBody(documentBody, sheet), { width: RENDER_WIDTH_PX, svgOnly: true })
        : null;

    /* Nothing drawn, so there is no picture and no camera to report. */
    if (!rendered?.svg) {
        return null;
    }

    const { svg, bounds } = rendered;
    const camera = enggDrawingExport.cameraFor(bounds);
    const k = enggDrawingState.BASE_PIXELS_PER_UNIT * camera.zoom;

    /*
     * THE WHITE SPACE THE PICTURE'S FRAME HAS, IN PX, SO IT CAN BE TAKEN OUT.
     *
     * The fitted render measures the drawing WITH its export margin (a tenth of
     * its size, so a printer's unprintable edge cannot take an arrowhead). That
     * margin is part of the IMAGE, and it must not be part of the PICTURE: a
     * `tikzpicture` containing the margin would put a tenth of a page of empty
     * space around every sheet, and the picture's own `(0,0)` would be a corner
     * of nothing in particular rather than the drawing's.
     *
     * `displayMarginPx` is how many pixels on each side the margin takes. The
     * compiler sees the un-margined picture, and the margin is applied on screen
     * - which is where the export renderer meets the live one.
     */
    const marginPx = (bounds.maxX - bounds.minX) * enggDrawingExport.MARGIN_RATIO;

    /*
     * THE SHEET'S COORDINATE ORIGIN, AS DRAWN.
     *
     * The printed picture is FITTED: its own `(0,0)` is the drawing's left-most
     * drawn coordinate, and `shift={(-minX, -minY)}` is what states it. TikZ
     * applies the shift OUTSIDE the picture's own `scale=` (a shift is a
     * translation in the picture's coordinate space), so measuring the drawing
     * after the scale has been applied recovers `-min` without knowing what it
     * was - which is why the reader can put a reopened sheet back where it was
     * drawn.
     *
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

    const view = {
        /*
         * THE DRAWING'S OWN TOP-LEFT CORNER, in drawing units.
         *
         * It is what the picture's `shift` states, and it is what the code
         * editor needs to place the features back where they were drawn.
         */
        originX: (bounds.maxX + bounds.minX) / 2,
        originY: (bounds.maxY + bounds.minY) / 2,
        panX: camera.panX,
        panY: camera.panY,
        scaleFactor
    };

    return {
        marginPx,
        view,
        text: [
            comment([...heading, ...summary, "---------------------------------------------------------------------"].join("\n")),
            viewRecord(view),
            /*
             * THE PICTURE IS PRINTED AT ITS OWN SIZE; THE RECORD CARRIES THE
             * PRINT TRANSFORM.
             *
             * `body` holds the commands the Drawing Space COMPILES, already
             * fitted to the page, so on paper one unit IS one millimetre. The
             * transform those numbers were produced by is stated ONCE, in the
             * record above, which LaTeX ignores - and repeating it as
             * `scale=`/`shift=` on this environment applied it a second time: the
             * printed figure shrank again and the reader undid a transform the
             * numbers had already had.
             */
            "\\begin{tikzpicture}[x=1mm, y=1mm]",
            body.join("\n\n"),
            "\\end{tikzpicture}"
        ].join("\n")
    };
}

/*
 * One sheet as a commented picture, WITH THE VIEW ITS PICTURE WAS DRAWN AT.
 *
 * `palette` is shared across sheets so a colour has one name in the whole file.
 *
 * The VIEW LINE IS PART OF EVERY PICTURE, including one that draws nothing: a
 * sheet with no picture has no `scale=` and `shift=` for a reader to recover
 * the origin from, so without the record an empty sheet read back from its own
 * code would put the next command the student typed at the wrong corner.
 */
function sheetPicture(documentBody, sheet, index, count, palette) {
    const picture = sheetPictureWithCamera(documentBody, sheet, index, count, palette);

    if (!picture) {
        const objects = sheet.objects || [];
        const heading = [
            "---------------------------------------------------------------------",
            `Sheet ${index + 1} of ${count}: "${sheet.name || `Sheet ${index + 1}`}"`
        ];

        return [
            comment([...heading, objects.length ? "Every feature on this sheet is hidden." : "This sheet is empty.", "---------------------------------------------------------------------"].join("\n")),
            `\\begin{tikzpicture}[x=1mm, y=1mm, scale=1, shift={(0,0)}]`,
            "\\path (0,0) rectangle (10,10);",
            "\\end{tikzpicture}"
        ].join("\n");
    }

    return picture.text;
}

/*
 * A sheet as a picture WITH ITS VIEW RECORD BESIDE IT - the form a SAVED file
 * writes, where the record is read back rather than re-derived from rounded
 * `scale=`/`shift=` numbers.
 */
function sheetPictureWithView(documentBody, sheet, index, count, palette) {
    const picture = sheetPictureWithCamera(documentBody, sheet, index, count, palette);

    if (!picture) {
        return sheetPicture(documentBody, sheet, index, count, palette);
    }

    /*
     * `picture.text` ALREADY STARTS WITH THE RECORD - `sheetPictureWithCamera`
     * writes it above the picture - so it is returned as it is. It used to be
     * passed through `pictureWithView` a second time, which prefixed a bare
     * STRING with the record, and that is the whole of `writeStandaloneFromSource`
     * being called with `[object Object]\n\\begin{tikzpicture}...`: a saved .tex
     * whose every picture could not be read back.
     */
    return picture.text;
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
export function writeLatexDocument(documentBody, { title = "Drawing", exportedAt = new Date(), pictures: written } = {}) {
    const sheets = documentBody?.sheets?.length
        ? documentBody.sheets
        : [{ id: "sheet", name: "Sheet 1", objects: documentBody?.objects || [] }];
    const palette = createPalette();

    /*
     * THE PICTURES OF THE LIVE DRAWING, WHEN THE CALLER HAS THEM.
     *
     * A save writes the sheet's OWN source - the TikZ the Drawing Space
     * compiles, which is what a student reads and edits - and the Source tab's
     * exporter (`writeStandaloneFromSource`, below) is what produces it. A
     * caller without pictures (the template preview) gets the measured ones, as
     * before.
     */
    const visibleSource = writeStandaloneFromSource;

    const pictures = sheets.map((sheet, index) => {
        if (Array.isArray(written)) {
            return typeof written[index] === "string" ? written[index] : "";
        }

        if (visibleSource) {
            const source = sheet?.source && typeof sheet.source.source === "string" ? sheet.source.source : "";

            if (sourceHasCommands(source)) {
                return visibleSource(source, { title: sheet?.name || `Sheet ${index + 1}` });
            }
        }

        return sheetPictureWithView(documentBody, sheet, index, sheets.length, palette);
    });

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

    return [...palette.definitions(), pictureWithView(picture, viewOfSheet(sheet))].join("\n");
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

    /*
     * THE SAME FIT THE EXPORT USES, AND THE SAME ORIGIN.
     *
     * The picture's `(0,0)` is the drawing's CENTRE, exactly as in the exported
     * sheet (`cameraFor` pans the camera to the middle of the drawing, so the
     * fitted image is centred). Stated on the environment, the two agree - and
     * the LaTeX editor, which reads a picture from its own coordinates, can put
     * the drawing back where it was drawn.
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

    const groups = svgToTikz(svg, context);

    if (!groups.length) {
        return "";
    }

    return [
        `\\begin{tikzpicture}[x=1mm, y=1mm, scale=${num(scaleFactor, 4)}, shift={(${num(-camera.panX, 4)},${num(-camera.panY, 4)})}]`,
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

/*
 * ================================================================
 * A PICTURE OPENED FOR THE DRAWING, READ BACK INTO OBJECTS
 * ================================================================
 *
 * THE THIRD WAY INTO THE DOCUMENT. Opening a `.tex` DAETUM wrote uses the
 * embedded document - the model, exactly as it was saved. Opening one it did
 * NOT write shows the code in the editor and asks the student to insert it.
 * Neither answers "open an ordinary LaTeX drawing as this document", and that
 * is what this is for.
 *
 * IT APPLIES THE EXISTING PATH, not a second parser. `applyParsedSourceToDrawing`
 * is the very function the Source tab uses when the student's typing must reach
 * the canvas, so a file opened here becomes the same objects - the same types,
 * ids, geometry, style, connections and schematic model - that reopening the
 * embedded document gives.  Reading is `readLatexDrawing`, whose `view` undoes
 * the picture's print transform (see `pictureViewFromText`).
 *
 * THE IDS ARE THE FILE'S OWN. A DAETUM picture labels each block with
 * `% DAETUM ID: ...`, so a picture written by this application opens as the
 * SAME objects it holds - not as a fresh set that merely looks the same.
 *
 * Returns { ok, features, diagnostics, source, objects, picture }. `ok` is
 * false when the text draws nothing this renderer can read, and then NOTHING
 * has been applied - the caller keeps the drawing it had.
 */
export function drawingFromPicture(text) {
    const source = String(text ?? "");
    const picture = embeddedPictureSource(source) ?? source;
    const view = pictureViewFromText(source);
    const read = readLatexDrawing(picture, { view, latex: false });
    const diagnostics = Array.isArray(read?.diagnostics) ? read.diagnostics : [];
    const features = Array.isArray(read?.features) ? read.features : [];

    if (!features.length) {
        return { ok: false, features, diagnostics, source: picture, objects: [], picture };
    }

    return {
        ok: true,
        features,
        diagnostics,
        source: picture,
        objects: features,
        picture
    };
}

export default {
    LATEX_EXTENSION,
    LATEX_MEDIA_TYPE,
    STANDALONE_LIBRARIES,
    VIEW_BEGIN,
    drawingFromPicture,
    embeddedPictureSource,
    pictureViewFromText,
    readEmbeddedDocument,
    readSheetLatex,
    writeLatexDocument,
    writeLatexPicture,
    writeLatexPictureParts,
    writeStandaloneFromSource
};
