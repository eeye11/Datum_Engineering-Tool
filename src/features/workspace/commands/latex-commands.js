/*
 * The LaTeX code editor, connected to the drawing.
 *
 * The editor window (ui/editors/latex-editor.js) knows nothing about the
 * document; this module gives it its behaviour:
 *
 *   read        DAETUM's own reader (file/latex/latex-reader.js)
 *   preview     the features drawn by the export renderer - the same drawing
 *               the canvas makes, fitted to the preview
 *   insert      the features added to the current sheet as ONE undo step,
 *               then selected so they can be moved or edited straight away
 *   fromDrawing the current sheet written as LaTeX code
 */
import enggDrawingState from "../../../shared/model/drawing-state.js";
import enggDrawingExport from "../../../shared/file/document-export.js";
import { writeLatexPicture } from "../../../shared/file/latex/latex-document.js";
import { readLatexDrawing } from "../../../shared/file/latex/latex-reader.js";
import { openLatexEditor } from "../../../shared/ui/editors/latex-editor.js";
import { drawingState } from "../editor-state.js";
import { renderProperties } from "../../../components/layout/panels/feature-panel.js";
import { setToolMessage } from "../../../components/layout/toolbar/toolbar-render.js";
import { renderCurrentDrawing } from "../../../components/layout/workspace/canvas-render.js";
import { activeSheet } from "../../../components/layout/workspace/sheet-controller.js";
import { fitDrawingToView } from "../../../components/layout/workspace/viewport.js";
import { serializeDocumentBody } from "./document-commands.js";

const PREVIEW_WIDTH_PX = 640;

function previewFeatures(features) {
    const sheet = {
        id: "latex-preview",
        name: "Preview",
        objects: features,
        units: drawingState.units || "mm"
    };
    const rendered = enggDrawingExport.renderFittedDocument(
        { version: 2, units: sheet.units, objects: [], sheets: [sheet], activeSheetId: sheet.id },
        { width: PREVIEW_WIDTH_PX, svgOnly: true }
    );

    if (!rendered?.svg) {
        return null;
    }

    /*
     * Shown as an IMAGE of the drawing: an image keeps its aspect ratio and
     * fits its pane, and the page's own rules for live drawing SVG (sizes,
     * cursors, hover styles) cannot reach inside it.
     */
    const svg = rendered.svg;
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    svg.style.background = "transparent";
    const image = document.createElement("img");
    image.className = "datum-latex-editor-image";
    image.alt = "Preview of the drawing";
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
    return image;
}

function insertFeatures(features) {
    if (!features.length) {
        return "Nothing to insert";
    }

    const previous = enggDrawingState.snapshotDrawing(drawingState);
    const wasEmpty = drawingState.objects.length === 0;
    const ids = features.map(feature => enggDrawingState.addObject(drawingState, feature).id);

    enggDrawingState.commitDrawingChange(drawingState, previous);
    enggDrawingState.selectObjects(drawingState, ids);

    if (wasEmpty) {
        fitDrawingToView();
    }

    renderProperties();
    renderCurrentDrawing();

    const message = `Inserted ${ids.length} feature${ids.length === 1 ? "" : "s"} from LaTeX`;
    setToolMessage(message);
    return message;
}

/*
 * THE SHEET AS THE EDITOR SHOWS IT: its own source text, or the picture the
 * exporter writes when the sheet has no source of its own. Either way the text
 * is a DAETUM picture (its opening line states `x=1mm, y=1mm`), so it is read
 * and previewed as one.
 */
function currentSheetAsLatex() {
    return writeLatexPicture(serializeDocumentBody(), activeSheet()?.id);
}

export function openCurrentDrawingAsLatex() {
    return openLatexCodeEditor({
        text: currentSheetAsLatex(),
        daetumPicture: true
    });
}

/*
 * Insert > LaTeX code…, and a .tex opened without DAETUM's data.
 *
 * `view` is the print transform the picture was written with, when the file
 * says what it was (see `latex-document.js`). Without it the code is read at
 * its own coordinates, which is what a picture written by hand means.
 *
 * `daetumPicture` says the text being read is one of DAETUM's own pictures -
 * a saved file whose embedded document could not be used. Its numbers are
 * drawing units and it draws itself at that size, so it is previewed with
 * `latex: false` (no centimetre default); a picture written by hand is read the
 * way LaTeX reads it.
 */
export function openLatexCodeEditor({ text, notice, view = null, daetumPicture = false } = {}) {
    return openLatexEditor({
        text,
        notice,
        read: (source) => readLatexDrawing(source, { view, latex: !daetumPicture }),
        preview: previewFeatures,
        insert: insertFeatures,
        fromDrawing: currentSheetAsLatex
    });
}
