/*
 * The document body, and how a document name becomes a file name.
 *
 * A DAETUM document is a plain document model: sheets, each holding features
 * with their real type, geometry, parent and parameters. That model is
 * DAETUM's own internal state, and it is what a reopened file must give
 * back so every feature stays selectable, draggable and editable.
 *
 * THE FORMAT IS NO LONGER PROPRIETARY. DAETUM used to wrap this body in a
 * `.enggdraw` envelope - a `"format": "enggdraw"` marker, a version number
 * and a migration chain - and save that as JSON. That format is gone. A
 * document is saved as a standard `.tex` file carrying the drawing's
 * LaTeX/TikZ source (see file/latex/latex-document.js), and what travels
 * alongside it, as an ordinary part of the document model, is this body.
 *
 * So this module keeps only what is genuinely about the document body and
 * its name:
 *
 *   normalizeDocument   make a loaded body safe to hand to the state model
 *   withExtension       give a document name the `.tex` extension
 *
 * There is no envelope, no format marker and no version number here. A
 * document written by this build is a `.tex`; a document read by this build
 * is a `.tex`, or the body a `.tex` carried. Nothing else is claimed.
 */

/*
 * The extension a saved document file carries. Standard LaTeX source, so a
 * DAETUM drawing opens in any LaTeX installation and in Overleaf.
 */
const EXTENSION = "tex";

const MEDIA_TYPE = "application/x-tex";

/*
 * Make sure the sheets in a document are usable.
 *
 * A body that arrives from a file is not trusted to be well formed: it may
 * have no sheets at all, or a sheet list missing its active id. Repairing it
 * here means every sheet list in the application - the one being edited, the
 * one being recovered, the one a reference points into - has already been
 * through the same repair, so no other module has to ask whether the list is
 * there.
 *
 * The repair is delegated to the sheets module so there is one definition of
 * what a usable sheet collection is.
 */
function normalizeDocument(document, sheets) {
  if (!document || typeof document !== "object") {
    return document;
  }

  const collection = sheets.createCollection({
    sheets: document.sheets,
    activeSheetId: document.activeSheetId,
  });

  return {
    ...document,
    sheets: collection.sheets,
    activeSheetId: collection.activeSheetId,
  };
}

/*
 * A document file name.
 *
 * The extension is added only when it is missing, so naming a file "Report"
 * does not become "Report.tex.tex" when the user has already typed it.
 */
function withExtension(name) {
  const trimmed = String(name || "").trim();

  if (!trimmed) {
    return "drawing." + EXTENSION;
  }

  return trimmed.toLowerCase().endsWith("." + EXTENSION)
    ? trimmed
    : trimmed + "." + EXTENSION;
}

const enggDocumentFile = {
  EXTENSION,
  MEDIA_TYPE,
  normalizeDocument,
  withExtension,
};

export default enggDocumentFile;
