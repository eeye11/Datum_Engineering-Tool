/*
 * ========================================================
 * TYPING A DIMENSION'S VALUE ON THE DRAWING
 * ========================================================
 *
 * After a dimension is placed, the student states what it should say. That used
 * to be a POPUP: a card over the drawing with a title, a label and a field. The
 * entry belongs on the drawing instead - the measurement is already there, at a
 * place the student chose, and the thing being written is its text.
 *
 * So a prompt opens AT THE DIMENSION, beside the number it will become, and
 * stays there. It is an entry prompt, not a dialog: no title, no buttons, no
 * backdrop - a small field with a caret in it, and whatever is typed becomes the
 * dimension's label.
 *
 * ---------------------------------------------------------------------------
 * IT STAYS PUT. IT DOES NOT FOLLOW THE POINTER.
 * ---------------------------------------------------------------------------
 *
 * An earlier version carried the field with the mouse. That is what made the
 * dimensions look random: the label's position had nothing to do with the
 * dimension it belonged to, because it was wherever the cursor happened to be
 * when the value was typed. The text of a dimension is the text OF THAT
 * DIMENSION, so the field is anchored to the dimension's own text frame and
 * never moves on its own.
 *
 * It is POSITIONED just above the number, so it does not cover the value being
 * replaced, and it is CLAMPED into the window for a dimension near an edge.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS TYPED IS WHAT THE DIMENSION SAYS
 * ---------------------------------------------------------------------------
 *
 * The text is stored verbatim as the dimension's `label` - "125.4 mm", "L",
 * "2a", "= 40" - with no parsing, no unit conversion and no rounding, because a
 * dimension's text is annotation. The measurement is still read from the
 * geometry the dimension refers to: typing cannot resize it, and the dimension
 * keeps its references whatever is typed.
 *
 * AN EMPTY FIELD KEEPS THE MEASURED VALUE. Pressing Enter on an untouched field
 * keeps what is already shown; clearing it and pressing Enter removes the
 * override, so the dimension prints its measurement again. Escape does the same
 * as an untouched Enter - it leaves the dimension exactly as it was.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT AN <input>
 * ---------------------------------------------------------------------------
 *
 * A SELECTED <input> IS PAINTED BY THE BROWSER. Opening it with its text
 * selected - which is what lets a student type straight over the measurement -
 * makes Chromium paint the platform's own selection over the text: a dark plate
 * with the digits lost inside it. `::selection` cannot repaint it, a
 * transparent background does not hide it, and a transparent
 * `-webkit-text-fill-color` does not take it away.
 *
 * A `contenteditable` box has NO platform text selection styling of its own -
 * its selection is ordinary DOM selection, which `::selection` DOES control.
 */
import enggDrawingState from "../../../shared/model/drawing-state.js";
import { drawingState } from "../editor-state.js";
import { renderCurrentDrawing } from "../../../components/layout/workspace/canvas-render.js";
import { renderProperties } from "../../../components/layout/panels/feature-panel.js";
import { setToolMessage } from "../../../components/layout/toolbar/toolbar-render.js";
import enggDimensionModel from "../model/dimensions/dimension-model.js";

/* The open prompt, or null. One binding so it cannot outlive its own element. */
let editor = null;

/* The prompt's size limits, and the advance used to size it to its text. */
const BOX_MIN_WIDTH = 72;
const BOX_MAX_WIDTH = 320;
const CHAR_WIDTH_PX = 6.6;

/* Kept this far inside the window, so the prompt is never half off the edge. */
const SCREEN_MARGIN = 8;

/*
 * Close the prompt on screen, if any, WITHOUT committing it.
 *
 * Used by callers that must take it away before something else claims focus.
 * The student's own exits - Enter, Escape, a click away - go through the
 * prompt's own `finish`, which also reports the outcome.
 */
export function closeDimensionTextEntry() {
    if (!editor) {
        return false;
    }

    const closing = editor;

    editor = null;

    closing.box.remove();

    return true;
}

/* Is a value being typed right now? */
export function isDimensionTextEntryOpen() {
    return Boolean(editor);
}

/*
 * Open the entry prompt for one dimension and focus it.
 *
 * `onDone` is called once, after the prompt is gone, with `true` when a value
 * was committed and `false` when the edit was abandoned.
 *
 * Returns the editable box.
 */
export function openDimensionTextEntry(object, { onDone } = {}) {
    if (!object || typeof document === "undefined" || !document.body) {
        return null;
    }

    closeDimensionTextEntry();

    const anchor = anchorFor(object);

    if (!anchor) {
        /*
         * A dimension with no readable text frame - one whose source has been
         * deleted, or a preview that has not been placed - has nowhere to
         * attach. Reported rather than thrown: the caller is a gesture handler,
         * and a click must never produce an exception.
         */
        if (typeof onDone === "function") {
            onDone(false);
        }

        return null;
    }

    const box = document.createElement("div");

    box.className = "drawing-dimension-text-entry";
    box.setAttribute("role", "textbox");
    box.setAttribute("aria-label", "Dimension text");
    box.setAttribute("aria-multiline", "false");
    box.setAttribute("spellcheck", "false");
    box.setAttribute("autocorrect", "off");
    box.setAttribute("autocapitalize", "off");
    box.setAttribute("contenteditable", "plaintext-only");

    /*
     * ========================================================
     * THE PROMPT ALWAYS OPENS EMPTY
     * ========================================================
     *
     * A blank dimension prints a letter, and a letter is a NAME for the
     * dimension - not something the student wrote. Filling the prompt with it
     * would present the sheet's own naming scheme as an answer to be edited,
     * and typing over it would feel like correcting a mistake nobody made.
     *
     * So the prompt shows only what the student types. Leaving it empty stores
     * no label and the dimension goes back to its letter.
     */
    sizeBox(box, box.textContent);

    let finished = false;

    const finish = (apply) => {
        if (finished) {
            return;
        }

        finished = true;

        editor = null;

        /*
         * ENTER ON AN EMPTY PROMPT WRITES THE LETTER.
         *
         * The sheet is blank until the student fills it in. Pressing Enter
         * without typing is how they say "leave this one for now" - and that
         * blankness is what earns it a name: `a`, `b`, `c`, in placement order.
         *
         * So the letter is stored as an ordinary label. It is what the student
         * now sees, and it stops being derived: deleting a dimension before
         * this one renames the ones after it, not this one, because this one
         * was ANSWERED rather than left pending.
         *
         * ESCAPE stores nothing. It is the other answer - "I did not mean to
         * open this" - and leaves the dimension exactly as it was.
         */
        const text = apply
            ? String(box.textContent ?? "").replace(/\s+/g, " ").trim() ||
              nextLetterFor(object)
            : "";

        box.remove();

        if (apply) {
            /*
             * THE DOCUMENT'S OWN OBJECT, NOT THE ONE THIS WAS HANDED.
             *
             * `addObject` returns the object it stored, and a caller that keeps
             * the object it PASSED IN holds a well-looking feature whose label
             * nothing ever reads, because the document holds a different
             * (named) copy. Looking the id up here means the value lands on what
             * is actually on the sheet. This is what once made typing appear to
             * do nothing while the field closed as if it worked.
             */
            const live =
                drawingState.objects.find(
                    (candidate) => candidate.id === object.id
                ) || object;

            commit(live, text);
        }

        if (typeof onDone === "function") {
            onDone(Boolean(apply));
        }
    };

    /*
     * ENTER COMMITS AND ESCAPE ABANDONS, AND NEITHER REACHES THE CANVAS.
     *
     * CAPTURED ON THE WAY DOWN, NOT BUBBLING. A `contenteditable` box handles
     * Enter and Escape ITSELF, during the same dispatch and ahead of an ordinary
     * listener on the box - so a bubbling listener fired too late and the value
     * committed as empty. The capture phase runs BEFORE the browser's editing
     * behaviour.
     *
     * ENTER NEVER INSERTS A LINE. A dimension's text is a measurement and its
     * label; a line break in it is a mistake rather than an intention.
     */
    box.addEventListener(
        "keydown",
        (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                finish(true);
                return;
            }

            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                finish(false);
                return;
            }

            /* Every other key is the student's to type, and none of the
             * application's shortcuts may fire behind a focused prompt. */
            event.stopPropagation();
        },
        true
    );

    /*
     * A RICH PASTE WOULD CARRY FORMATTING into a box that holds plain text, and
     * a line break would put the value on two lines.
     */
    box.addEventListener("paste", (event) => {
        event.preventDefault();

        const text = String(event.clipboardData?.getData("text/plain") || "")
            .replace(/\s+/g, " ")
            .trim();

        if (text) {
            document.execCommand("insertText", false, text);
        }
    });

    box.addEventListener("input", () => {
        sizeBox(box, box.textContent);
        place(box, anchor);
    });

    /*
     * A CLICK ELSEWHERE COMMITS, as every other in-place editor on the sheet
     * does: the student has moved on. Escape is the deliberate way to abandon
     * it - and abandoning it leaves the dimension exactly as it was.
     */
    box.addEventListener("blur", () => finish(true));

    document.body.appendChild(box);

    editor = box;

    place(box, anchor);

    box.focus();

    /*
     * A PROMPT THAT OPENS WITH TEXT SELECTS IT, so typing replaces it. A prompt
     * that opens EMPTY only puts the caret in - there is nothing to select, and
     * `selectAll` on an empty element would leave a range over nothing.
     */
    if (box.textContent.trim()) {
        selectAll(box);
    }

    return box;
}

/* Select everything in the editable box. */
function selectAll(box) {
    const range = document.createRange();

    range.selectNodeContents(box);

    const selection = globalThis.getSelection();

    selection.removeAllRanges();
    selection.addRange(range);
}

/*
 * Where the dimension's number sits on screen, in CSS pixels.
 *
 * Read from the MODEL, not the DOM: the renderer rebuilds its SVG every frame,
 * so a prompt anchored to a node would lose its place. `textFrame` is the frame
 * the renderer rotates its text group about, and `engineeringToScreen` is the
 * same mapping the renderer uses - so the prompt lands on the number, rotated
 * or not.
 */
function anchorFor(object) {
    let graphics;

    try {
        graphics = enggDimensionModel.graphicsFor(object, drawingState);
    } catch (error) {
        return null;
    }

    const frame = graphics?.textFrame;

    if (!frame || !Number.isFinite(frame.x) || !Number.isFinite(frame.y)) {
        return null;
    }

    const canvas = document.querySelector(".drawing-canvas");

    if (!canvas) {
        return null;
    }

    const bounds = canvas.getBoundingClientRect();

    const screen = enggDrawingState.engineeringToScreen(
        frame,
        bounds,
        drawingState
    );

    if (!screen || !Number.isFinite(screen.x) || !Number.isFinite(screen.y)) {
        return null;
    }

    return {
        x: bounds.left + screen.x,
        y: bounds.top + screen.y
    };
}

/*
 * How wide the prompt should be for the text it holds.
 *
 * AN EMPTY PROMPT IS STILL A TARGET. It shows no text at all, but it is a place
 * the student clicks into and types, so it keeps a minimum width of a few
 * characters' worth - narrow enough to look like a caret on the sheet, wide
 * enough to hit and to start typing into.
 */
function sizeBox(box, text) {
    const shown = String(text ?? "").trim();

    const longest = Math.max(
        3,
        ...shown.split("\n").map((line) => line.length)
    );

    const estimate = longest * CHAR_WIDTH_PX + 24;

    box.style.width = `${Math.round(
        Math.min(BOX_MAX_WIDTH, Math.max(BOX_MIN_WIDTH, estimate))
    )}px`;
}

/*
 * Centre the prompt ON the dimension, kept inside the window.
 *
 * ========================================================
 * THE PROMPT IS WHERE THE DIMENSION IS
 * ========================================================
 *
 * Not above it, not beside it - OVER the place the label will occupy. The
 * dimension has no text of its own until something is typed, so there is
 * nothing underneath to obscure; the prompt IS the label's position, and the
 * words appear exactly where the student typed them.
 *
 * That is also what removes the double image. An earlier version floated the
 * prompt above the value, so the sheet showed a number and a field in two
 * places and the student had to guess which one they were editing.
 */
function place(box, anchor) {
    const width = box.offsetWidth || BOX_MIN_WIDTH;
    const height = box.offsetHeight || 22;

    const left = Math.min(
        Math.max(SCREEN_MARGIN, anchor.x - width / 2),
        Math.max(SCREEN_MARGIN, window.innerWidth - width - SCREEN_MARGIN)
    );

    const top = Math.min(
        Math.max(SCREEN_MARGIN, anchor.y - height / 2),
        Math.max(SCREEN_MARGIN, window.innerHeight - height - SCREEN_MARGIN)
    );

    box.style.left = `${Math.round(left)}px`;
    box.style.top = `${Math.round(top)}px`;
}

/*
 * The letter the next unnamed dimension should carry.
 *
 * `a`, `b`, `c` ... continuing past `z` as `aa`, `ab`, like a spreadsheet -
 * so a drawing with more than 26 dimensions does not repeat itself. It is read
 * from the labels already ON the sheet, so pressing Enter on a second blank
 * dimension gives it `b` and never a second `a`.
 */
function nextLetterFor() {
    const used = new Set(
        (drawingState.objects || [])
            .filter((candidate) => candidate?.type === "dimension")
            .map((candidate) => String(candidate.label ?? "").trim().toLowerCase())
            .filter(Boolean)
    );

    let index = 0;

    while (used.has(lettersFor(index))) {
        index += 1;
    }

    return lettersFor(index);
}

/*
 * A zero-based index as a spreadsheet-style letter: 0 -> "a", 25 -> "z",
 * 26 -> "aa".
 */
function lettersFor(index) {
    let remaining = Math.max(0, Math.floor(index));
    let label = "";

    do {
        label = String.fromCharCode(97 + (remaining % 26)) + label;
        remaining = Math.floor(remaining / 26) - 1;
    } while (remaining >= 0);

    return label;
}

/*
 * Store the typed text as the dimension's label, as ONE undoable change.
 *
 * WHAT IS TYPED IS WHAT IT SAYS. No parsing, no conversion, no rounding: a
 * dimension's text is annotation, and the student's own words are the value.
 *
 * AN EMPTY PROMPT LEAVES THE DIMENSION BLANK - and a blank dimension prints the
 * sheet's own letter for it (`a`, `b`, `c`...). It does NOT print a measurement:
 * the whole point of the field is that the number is the student's to find.
 */
function commit(object, typed) {
    const next =
        typeof typed === "string" && typed.trim() ? typed.trim() : null;

    if (next === (object.label ?? null)) {
        /*
         * Nothing changed. Committing anyway would spend an undo entry on an
         * edit nobody made, so Undo would appear to do nothing once.
         */
        return;
    }

    const previous = enggDrawingState.snapshotDrawing(drawingState);

    object.label = next;

    enggDrawingState.commitDrawingChange(drawingState, previous);

    setToolMessage(
        next ? `Dimension text - ${next}` : "Dimension left blank"
    );

    renderProperties();
    renderCurrentDrawing();
}
