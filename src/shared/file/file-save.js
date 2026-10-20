/*
 * ========================================================
 * SAVING A DOCUMENT, AND SAVING A DRAWING AS AN IMAGE
 * ========================================================
 *
 * Save and Save As use the OPERATING SYSTEM's own save panel, the same
 * one a desktop application gets. Not a dialog built in the page, and
 * not window.prompt: the whole point of a file is where it ends up, and
 * choosing that is the operating system's job, not something the
 * application should be inventing a worse version of.
 *
 * ========================================================
 * ONE SAVE AS, THREE OUTPUTS
 * ========================================================
 *
 * Save As is the ONE place a student chooses the representation they
 * want, and the choice is made in the system panel rather than in a
 * second, application-owned dialog:
 *
 *     DAETUM project  the editable document
 *     PNG            a clean drawing snip
 *     JPG / JPEG     the same snip, encoded differently
 *
 * There is deliberately no separate Export workflow. "Export -> Image ->
 * PNG" asks the student to learn a second idea for the same act, and it
 * leaves two paths that produce a file - two places for the filename,
 * the extension and the cancellation handling to disagree. Save As
 * decides the format; this module writes it.
 *
 * ========================================================
 * TWO BROWSERS, TWO ROUTES
 * ========================================================
 *
 * Where the File System Access API exists, the panel returns a handle to
 * the file itself. That handle is kept, and a later Save writes straight
 * back to it - no panel, no filename, and no chance of quietly saving a
 * second copy somewhere else. This is the behaviour that makes Save
 * genuinely different from Save As.
 *
 * Where it does not - Safari and Firefox today - a download is the only
 * thing a web page can do with a file, so that is what happens, and the
 * browser's own download flow chooses the destination. The difference is
 * stated plainly rather than hidden: without a handle there is nothing
 * to remember a handle to, so Save re-offers the name every time.
 *
 * ========================================================
 * WHAT THIS MODULE DOES NOT DO
 * ========================================================
 *
 * It does not RENDER. An image is produced by the drawing renderer,
 * which is handed to this module as a callback. Keeping the render out
 * of here is what stops this file from growing a second, private
 * understanding of how a drawing looks - the exported PNG is the same
 * drawing the canvas shows, produced by the same code.
 *
 * It also never edits the document. Saving is not a document change, so
 * nothing here touches the model, and the caller adds no history entry.
 */
import { writeLatexDocument } from "./latex/latex-document.js";
import enggDocumentFile from "./document-file.js";

/*
 * Whether this browser can hand back a handle to a real file.
 *
 * Checked by capability rather than by user agent: what matters is
 * whether showSaveFilePicker exists, and sniffing the user agent to
 * guess at that gets it wrong in both directions.
 */
function supportsNativePicker() {
  return typeof window.showSaveFilePicker === "function";
}

/*
 * Whether this browser can hand back a handle to a file the user CHOSE TO OPEN.
 *
 * A separate capability from the save picker, and deliberately so: a browser
 * could have one without the other, and the two are used for different things.
 * What matters is whether `showOpenFilePicker` exists, because that is the only
 * way a web page is ever given a handle it can later WRITE BACK to.
 */
function supportsOpenPicker() {
  return typeof window.showOpenFilePicker === "function";
}

/*
 * Ask the user for an existing drawing, and keep a handle to it.
 *
 * THIS IS WHAT MAKES SAVE WRITE BACK TO THE FILE YOU OPENED.
 *
 * An `<input type="file">` hands over the file's CONTENTS and nothing else - a
 * `File` is a read-only snapshot with no way to write to where it came from. So
 * a document opened that way had no target for Save, and Save fell through to
 * Save As every time: the user was asked to choose a filename again for a file
 * they had just chosen.
 *
 * `showOpenFilePicker` gives a HANDLE, which can be written back to. Where the
 * browser has it, opening therefore goes through here and the document gains a
 * real save target.
 *
 * Returns null when the user cancelled - an ordinary thing to do, not an error.
 * Throws nothing else: a refused or unsupported call is reported by the caller
 * as the failure it is.
 */
async function openWithPicker() {
  const handle = await window.showOpenFilePicker({
    types: [
      {
        description: "DAETUM drawing (*.tex)",
        accept: {
          [enggDocumentFile.MEDIA_TYPE]: [`.${enggDocumentFile.EXTENSION}`]
        }
      },
      {
        /*
         * THE RETIRED FORMAT, OPENED AS AN IMPORT. An old .enggdraw still
         * opens; it is never written, and its first save is a .tex.
         */
        description: "Older DAETUM drawing (*.enggdraw)",
        accept: {
          [enggDocumentFile.LEGACY_MEDIA_TYPE]: [`.${enggDocumentFile.LEGACY_EXTENSION}`]
        }
      }
    ],

    /* One drawing at a time - this opens a document, not a batch. */
    multiple: false
  });

  const chosen = Array.isArray(handle) ? handle[0] : handle;

  if (!chosen) {
    return null;
  }

  const file = await chosen.getFile();

  return {
    handle: chosen,
    file,
    name: chosen.name || file.name
  };
}

/* ---------------------------------------------------------- */
/* THE FORMATS                                                 */
/* ---------------------------------------------------------- */

/*
 * The representations, in the order the panel should offer them: the editable
 * document first, because it is the one that keeps the work, then the images,
 * then PDF.
 *
 * `extensions` is what the native picker filters on. `mime` is what a system
 * that knows the type will show. Both are given for each, because a picker
 * showing an unfamiliar type with no extension is confusing and one showing
 * only an extension cannot be filtered properly.
 *
 * PDF IS A DIFFERENT KIND OF ENTRY, and the `pdf: true` flag says so.
 *
 * Every other format is BYTES THE APPLICATION PRODUCES: text for a document, a
 * canvas blob for an image. A PDF is not - there is no PDF writer in this
 * application, and the browser's own is reached through its print dialog rather
 * than through a file handle. So a `pdf` entry is an EXPORT ROUTE rather than a
 * writable blob, and `saveAs` sends it to the print-to-PDF path instead of
 * asking `contentFor` for bytes it cannot produce. That is what stops a Save As
 * to "Beam.pdf" from writing the drawing's .tex into a file with a .pdf name.
 */
function formatTable() {
  const file = enggDocumentFile;

  return [
    {
      id: "tex",

      /*
       * THE DRAWING ITSELF: a .tex file. It compiles in any LaTeX installation
       * and carries the whole editable document in a comment block, so DAETUM
       * reopens it with every feature editable.
       */
      label: "DAETUM drawing (*.tex)",
      extensions: [`.${file.EXTENSION}`],
      mime: file.MEDIA_TYPE,
      image: false
    },
    {
      id: "png",
      label: "PNG image (*.png)",
      extensions: [".png"],
      mime: "image/png",
      image: true
    },
    {
      id: "jpg",
      label: "JPG image (*.jpg)",
      extensions: [".jpg", ".jpeg"],
      mime: "image/jpeg",
      image: true
    },
    {
      id: "pdf",
      label: "PDF document (*.pdf)",
      extensions: [".pdf"],
      mime: "application/pdf",
      image: false,

      /*
       * NOT WRITABLE BYTES. A PDF is produced by the browser's print-to-PDF,
       * so this entry is an export route the caller runs rather than a blob
       * `contentFor` can build. See the note on the table above.
       */
      pdf: true
    }
  ];
}

/*
 * The file-type list the native panel is given.
 *
 * Each entry becomes one choice in the system panel's type control.
 * On a platform that ignores them the panel still opens and the
 * filename decides, which is the closest native-compatible behaviour
 * available - and it is deliberately NOT replaced with an
 * application-owned type dialog.
 */
function fileTypes() {
  return formatTable().map((format) => ({
    description: format.label,
    accept: {
      [format.mime]: format.extensions
    }
  }));
}

/*
 * The format a chosen filename asks for, or the document format.
 *
 * The extension is the only signal the system panel gives us across
 * every browser, so it is what decides. An unrecognised extension is
 * treated as the document: a name the user typed freely should save
 * their WORK, not silently become an image they did not ask for.
 */
function formatForName(name) {
  const lower = String(name || "").toLowerCase();

  const match = formatTable().find((format) =>
    format.extensions.some((extension) =>
      lower.endsWith(extension),
    ),
  );

  return match || formatTable()[0];
}

/*
 * A filename whose extension matches the chosen format, exactly once.
 *
 * A student who picks "Beam Diagram" and then the PNG type should get
 * "Beam Diagram.png" - not "Beam Diagram" with no extension, and not
 * "Beam Diagram.png.png". The rule is: strip any extension this
 * application understands, then add the one the format wants.
 */
function normaliseName(name, format) {
  const chosen = format || formatForName(name);

  const wanted = chosen.extensions[0];

  let base = String(name || "").trim();

  if (!base) {
    base = "drawing";
  }

  /* Strip a known extension, so the format's own is not doubled. */
  const known = [
    ...formatTable().flatMap((entry) => entry.extensions),
    `.${enggDocumentFile.LEGACY_EXTENSION}`
  ];

  const lower = base.toLowerCase();

  const stripped = known.find((extension) =>
    lower.endsWith(extension),
  );

  if (stripped) {
    base = base.slice(0, base.length - stripped.length);
  }

  if (!base) {
    base = "drawing";
  }

  return `${base}${wanted}`;
}

/* ---------------------------------------------------------- */
/* THE FILE HANDLE                                             */
/* ---------------------------------------------------------- */

/*
 * The file handle for the document, if the browser gave us one.
 *
 * Held across saves and deliberately not shared with anything else: it
 * is the only record of where the document lives, and losing it is
 * exactly what turns Save into Save As.
 *
 * It is only ever set for a DOCUMENT save. Saving a PNG does not make
 * the document "be" a PNG, so an image save leaves this untouched -
 * which is what stops a later Save from writing the .tex into a .png.
 */
let currentHandle = null;

function currentFileHandle() {
  return currentHandle;
}

/*
 * Remember a file the user already has open.
 *
 * When a document is opened rather than saved, the browser can hand
 * back a handle for the file it read. Keeping it means the first Save
 * after an Open writes back to that file rather than producing a copy
 * - the behaviour a user who opened a document and corrected it
 * expects.
 */
function setFileHandle(handle) {
  currentHandle = handle || null;

  return currentHandle;
}

function forgetFileHandle() {
  currentHandle = null;
}

/* ---------------------------------------------------------- */
/* CONTENT                                                     */
/* ---------------------------------------------------------- */

/*
 * The document body, as the text of a saved drawing: the .tex file with the
 * document embedded (file/latex/latex-document.js). Built here, once, so every
 * save writes the same thing.
 */
function documentText(documentBody, name) {
  const title =
    String(name || "")
      .replace(/\.(tex|enggdraw)$/i, "")
      .trim() || "Drawing";

  return writeLatexDocument(documentBody, { title });
}

/*
 * The bytes to write, and the type they are, for a chosen format.
 *
 * A document is text; an image is produced by the renderer the caller
 * supplied. This is the ONLY place the two are told apart, so there is
 * one pipeline and one place the routing can be wrong.
 *
 * Returns null when an image was asked for and the renderer could not
 * produce one - a drawing with nothing in it, or a canvas that
 * refused - which the caller reports rather than claiming a success.
 */
async function contentFor(format, documentBody, renderImage, name) {
  if (!format.image) {
    return {
      blob: new Blob([documentText(documentBody, name)], {
        type: format.mime
      }),
      mime: format.mime
    };
  }

  if (typeof renderImage !== "function") {
    return null;
  }

  const blob = await renderImage(format.id);

  if (!blob) {
    return null;
  }

  return {
    blob,
    mime: format.mime
  };
}

/* ---------------------------------------------------------- */
/* SAVE                                                        */
/* ---------------------------------------------------------- */

/*
 * Save to the file this document already belongs to.
 *
 * No panel, no new name, and no chance of the document ending up in
 * two places. Returns null when there is nowhere to save to yet, which
 * the caller answers by doing a Save As instead.
 *
 * A Save is ALWAYS a document save. It never becomes a PNG because the
 * last Save As happened to be one: the document is the thing that has
 * a location, so it is the thing Save writes.
 */
async function save(documentBody) {
  /*
   * AN IMPORTED .enggdraw IS NEVER WRITTEN OVER. Its handle is not a save
   * target, so Save falls through to Save As and the drawing becomes a .tex
   * beside the file it came from.
   */
  if (!currentHandle || enggDocumentFile.isLegacyName(currentHandle.name)) {
    return null;
  }

  const text = documentText(documentBody, currentHandle.name);

  /*
   * THE WRITE IS COMMITTED, OR IT IS NOT.
   *
   * `createWritable()` gives a stream to a TEMPORARY file, and the real file is
   * only replaced when `close()` succeeds. That is the browser's own
   * atomic-commit behaviour, and it is exactly what protects the user's last
   * good file: an interrupted write, a full disk or a failure between the two
   * calls leaves the previous version on disk untouched, because the swap never
   * happened.
   *
   * A failure is REPORTED rather than thrown past the caller. An exception here
   * used to travel out of the Save button's handler, where nothing caught it:
   * the document stayed dirty and the user was told nothing, which is the one
   * outcome this must never produce.
   */
  try {
    const writable = await currentHandle.createWritable();

    try {
      await writable.write(
        new Blob([text], {
          type: enggDocumentFile.MEDIA_TYPE
        }),
      );

      await writable.close();
    } catch (error) {
      /*
       * `abort()` discards the TEMPORARY file so a half-written one cannot be
       * left behind. It is best-effort: the original file was never replaced,
       * so a failure to abort must not replace the real error.
       */
      try {
        if (typeof writable.abort === "function") {
          await writable.abort();
        }
      } catch (ignored) {
        /* Nothing to recover: the original file is already safe. */
      }

      throw error;
    }
  } catch (error) {
    return {
      error:
        "Could not save the drawing. Your current work is still open and " +
        "has not been discarded.",
      detail: error
    };
  }

  return currentHandle.name;
}

/*
 * Save, choosing a location and a representation.
 *
 * Always shows the panel. That is what Save As means: the user is
 * asking to put this document somewhere specific, and the somewhere -
 * and the format - is their decision to make.
 *
 * The document keeps its identity until the write has actually
 * succeeded, and only a DOCUMENT write changes it. Cancelling the
 * panel, or a disk that refuses, leaves the document as it was - still
 * unsaved, still pointing at whatever file it had.
 *
 * `renderImage(formatId)` is the caller's image producer. It is only
 * consulted when the chosen format is an image, so a document save
 * never pays for a render it does not use.
 */
async function saveAs(documentBody, suggestedName, options = {}) {
  const renderImage = options.renderImage;

  /*
   * THE PDF EXPORT ROUTE, SUPPLIED BY THE CALLER.
   *
   * A PDF is not bytes this module can build - it is the browser's print-to-PDF,
   * and only the editor knows how to compose the page for it. So the editor
   * passes the function in, and `saveAs` calls it when the chosen format is a
   * PDF rather than pretending to write one.
   *
   * `exportPdf` returns the suggested filename, or null when there was nothing
   * to export - which the caller reports rather than claiming a save.
   */
  const exportPdf = options.exportPdf;

  const fallbackFormat = formatTable()[0];

  /*
   * A SAVE AS TO PDF IS THE EXPORT, NOT A DOCUMENT SAVE.
   *
   * It is handled BEFORE the picker, for two reasons. The native panel cannot
   * write a PDF, so offering it there would produce a file the application did
   * not really create; and a PDF must never adopt the document's file handle,
   * or a later Save would write the .tex into a .pdf. The editable document's
   * identity is therefore left exactly as it was.
   */
  const wantsPdf = options.format
    ? options.format === "pdf"
    : formatForName(suggestedName || "").id === "pdf";

  if (wantsPdf) {
    if (typeof exportPdf !== "function") {
      return { error: "PDF export is not available here" };
    }

    const name = exportPdf();

    if (!name) {
      return { error: "could not render the drawing" };
    }

    return { name, format: "pdf", image: false, pdf: true };
  }

  if (supportsNativePicker()) {
    let handle;

    try {
      handle = await window.showSaveFilePicker({
        suggestedName:
          suggestedName ||
          `drawing.${enggDocumentFile.EXTENSION}`,

        /*
         * The panel opens beside the file the document already
         * belongs to, when it belongs to one. Opening in the
         * browser's last-used folder instead would send a correction
         * of an existing drawing somewhere unrelated to it.
         */
        startIn: currentHandle || undefined,

        types: fileTypes()
      });
    } catch (error) {
      /*
       * The user closed the panel. Cancelling a Save As is a
       * perfectly ordinary thing to do and is not an error to report
       * - the document is untouched, which is exactly what they
       * asked for.
       */
      if (
        error &&
        (error.name === "AbortError" ||
          error.name === "NotAllowedError")
      ) {
        return null;
      }

      /*
       * ANY OTHER FAILURE IS REPORTED, NOT THROWN.
       *
       * A picker that fails for a reason the user did not choose - a browser
       * that refuses the call, a platform without the API despite claiming it -
       * used to throw straight out of the Save button's handler. The document
       * stayed dirty and nothing was said, so the honest answer is returned
       * instead and the caller reports it.
       */
      return {
        error:
          "Could not open the save panel. Your current work is still open " +
          "and has not been discarded.",
        detail: error
      };
    }

    /*
     * WHICH FORMAT - decided by the name the system panel returned.
     *
     * The extension is the one signal every browser gives back, and it
     * is the one the user actually saw and chose. Reading it here, at
     * the moment of the write, is what makes the filename and the
     * content agree: "Beam.png" is a PNG because the name says so, not
     * because of a setting somewhere else that could disagree.
     */
    const format = formatForName(handle.name);

    const content = await contentFor(
      format,
      documentBody,
      renderImage,
      handle.name,
    );

    if (!content) {
      return { error: "could not render the drawing" };
    }

    const writable = await handle.createWritable();

    try {
      await writable.write(content.blob);
      await writable.close();
    } catch (error) {
      /*
       * The write is committed only by `close()`, so a failure here leaves the
       * previous version of the file - if there was one - exactly as it was.
       * Reported rather than thrown, so the caller can keep the document dirty
       * and tell the user their work is still open.
       */
      try {
        if (typeof writable.abort === "function") {
          await writable.abort();
        }
      } catch (ignored) {
        /* Nothing to recover: the target file was never replaced. */
      }

      return {
        error:
          "Could not save the drawing. Your current work is still open and " +
          "has not been discarded.",
        detail: error
      };
    }

    /*
     * Only a DOCUMENT save adopts the handle. An image save must not,
     * or the next Save would write the .tex into a .png.
     */
    if (!format.image) {
      currentHandle = handle;
    }

    return {
      name: handle.name,
      format: format.id,
      image: format.image
    };
  }

  /*
   * No handle to hold, so the download route. The browser's own
   * download flow chooses the destination and the name is the one the
   * application suggested - the closest native behaviour available
   * where there is no file panel to drive.
   */
  const format = options.format
    ? formatTable().find((entry) => entry.id === options.format) ||
      fallbackFormat
    : formatForName(suggestedName || "");

  const fileName = normaliseName(suggestedName || "drawing", format);

  const content = await contentFor(
    format,
    documentBody,
    renderImage,
    fileName,
  );

  if (!content) {
    return { error: "could not render the drawing" };
  }

  downloadBlob(content.blob, fileName);

  return {
    name: fileName,
    format: format.id,
    image: format.image
  };
}

/*
 * Hand a file to the browser as a download.
 *
 * The last resort, used only when there is no picker of any kind.
 */
function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;

  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);

  return fileName;
}

const enggFileSave = {
  currentFileHandle,
  fileTypes,
  forgetFileHandle,
  formatForName,
  normaliseName,
  openWithPicker,
  save,
  saveAs,
  setFileHandle,
  supportsNativePicker,
  supportsOpenPicker
};

export default enggFileSave;
