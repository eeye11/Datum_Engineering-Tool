/*
 * ============================================================
 * THE WRITTEN SOLUTION: ITS SOURCE, ITS STRUCTURE, AND ITS SAVE
 * ============================================================
 *
 * The written solution is the other half of a submission. It has ONE source of
 * truth - the LaTeX-ish text the student writes - and everything else the
 * workspace shows is DERIVED from it:
 *
 *   the navigation tree   parsed from the source's own \section commands
 *   the preview           the source, typeset by MathJax
 *   the save status       the source compared with what was last written
 *
 * WHY THE SOURCE IS THE ONLY STATE. A second copy of the structure - a tree the
 * student edits, kept in step with the text by hand - would be the thing that
 * goes stale: a section renamed in the text would keep its old name in the tree
 * until some other code remembered to update it. Parsing the source every time
 * it changes means the two cannot disagree, because there is only one of them.
 *
 * WHAT IS PERSISTED, AND WHERE.
 *
 * The source travels WITH THE DOCUMENT - it is saved into the drawing's `.tex` file
 * beside the drawings, so a written solution and its diagrams are one file and
 * opening one brings back the other. A draft is ALSO kept in `localStorage`
 * while the student types, so a closed tab does not lose an unsaved answer;
 * that draft is a safety copy, not a second document.
 */

import enggErrorLog from "../../app/error-log.js";
import { parseDrawingBlocks } from "./drawing-blocks.js";

/* ---------------------------------------------------------- */
/* STRUCTURE                                                   */
/* ---------------------------------------------------------- */

/*
 * THE STRUCTURE COMMANDS, in the order they nest.
 *
 * A `\section` is a level, a `\subsection` sits inside it, and so on. The level
 * is the array index, which is what lets the tree be built by comparing two
 * numbers rather than by matching command names in every consumer.
 *
 * `\begin{problem}` is treated as a TOP-LEVEL heading too: an engineering answer
 * is usually organised by problem, and a student who writes one expects to find
 * it in the outline.
 */
const SECTION_LEVELS = [
    { command: "section", label: "Section" },
    { command: "subsection", label: "Subsection" },
    { command: "subsubsection", label: "Subsubsection" }
];

/*
 * Strip the braces and any inner LaTeX from a heading's title.
 *
 * A title may contain maths (`\section{Beam $F = ma$}`), emphasis and commands.
 * The TREE shows text, so the maths delimiters are removed and the remaining
 * text kept - a heading that read `Beam $F = ma$` in the outline would be noise,
 * and one that read nothing because it contained maths would be worse.
 */
function plainTitle(raw) {
    return String(raw || "")
        .replace(/\$[^$]*\$/g, " ")
        .replace(/\\[a-zA-Z]+\s*/g, " ")
        .replace(/[{}]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

/*
 * Every heading in the source, with the LINE it is on.
 *
 * The line number is what makes the outline navigable: selecting a heading moves
 * the editor's caret to that line, so the outline is a table of contents that
 * actually goes somewhere.
 *
 * It is a single left-to-right scan that keeps the running part counters, rather
 * than a regex replace or a full parser. The counts are what number the headings
 * ("3.2 Beam", the same way the document itself will), and keeping them in one
 * pass is what makes the number agree with the order the headings appear in.
 */
export function parseStructure(source) {
    const text = String(source || "");
    const lines = text.split(/\r?\n/);

    const headings = [];

    /* Section numbering: one counter per depth, reset when a shallower one moves. */
    const counters = [0, 0, 0];

    /*
     * PROBLEMS ARE COUNTED SEPARATELY.
     *
     * A problem and a section are both top-level headings, but they are not the
     * same series: numbering them together would make the first section after a
     * problem read "2", and the student's own \section numbers would disagree
     * with the outline's.
     */
    let problemCount = 0;

    /*
     * The offset at which each line starts, so a command's character index can
     * be turned back into a line-and-column. Computed once, because a naive
     * search per match is quadratic on a long document.
     */
    const lineStart = [];
    let offset = 0;

    lines.forEach((line, index) => {
        lineStart[index] = offset;
        offset += line.length + 1;
    });

    const lineFor = (charIndex) => {
        let low = 0;
        let high = lineStart.length - 1;

        while (low < high) {
            const mid = Math.ceil((low + high) / 2);

            if (lineStart[mid] <= charIndex) {
                low = mid;
            } else {
                high = mid - 1;
            }
        }

        return low;
    };

    const pattern =
        /\\(section|subsection|subsubsection|begin\{(problem)\})\s*(\{[^}]*\})?/g;

    let match;

    while ((match = pattern.exec(text)) !== null) {
        const isProblem = Boolean(match[2]);

        const level = isProblem
            ? 0
            : SECTION_LEVELS.findIndex((entry) => entry.command === match[1]);

        const title = plainTitle(match[3]);

        /*
         * A PROBLEM IS ITS OWN COUNTER, and it does not disturb the section
         * numbering. An answer that is organised by problem would otherwise
         * number the first section "2" because a problem came before it.
         */
        if (isProblem) {
            problemCount += 1;
        } else {
            counters[level] += 1;

            for (let deeper = level + 1; deeper < counters.length; deeper += 1) {
                counters[deeper] = 0;
            }
        }

        const number = isProblem
            ? `P${problemCount}`
            : counters.slice(0, level + 1).join(".");

        headings.push({
            id: `h${headings.length}`,
            level,
            number,
            isProblem,
            label: isProblem ? "Problem" : SECTION_LEVELS[level]?.label || "Section",
            title: title || (isProblem ? "Problem" : "Untitled"),
            line: lineFor(match.index)
        });
    }

    return headings;
}

/*
 * The three kinds of thing a figure is, so the outline can list them.
 *
 * An EMBEDDED drawing block is the drawing's complete TikZ source, written
 * into the document between DAETUM's comment markers - the document itself
 * holds the drawing, and the outline row jumps to the top of the block.
 * A `\datumfigure{...}` is the older LINK to a drawing sheet, kept so
 * documents written before embedding still show their figures. A
 * `\begin{figure}` is a plain LaTeX float with no drawing behind it.
 */
export function parseFigures(source) {
    const text = String(source || "");

    /*
     * Embedded blocks, in order. The line is the line the block BEGINS on
     * (the BEGIN marker's), so the row goes to the top of the code.
     */
    const lineStarts = [];
    let offset = 0;

    text.split(/\r?\n/).forEach((line) => {
        lineStarts.push(offset);
        offset += line.length + 1;
    });

    const lineFor = (charIndex) => {
        let low = 0;
        let high = lineStarts.length - 1;

        while (low < high) {
            const mid = Math.ceil((low + high) / 2);

            if (lineStarts[mid] <= charIndex) {
                low = mid;
            } else {
                high = mid - 1;
            }
        }

        return low;
    };

    const blocks = parseDrawingBlocks(text).map((block, index) => ({
        id: block.blockId || `drawing${index}`,
        kind: "drawing",
        label: `Drawing ${index + 1}`,
        line: lineFor(block.index)
    }));

    const reproducible = [...text.matchAll(/\\datumfigure\s*\{[^}]*\}/g)].map(
        (match, index) => ({
            id: `fig${index}`,
            kind: "drawing",
            label: `Figure ${index + 1}`,
            line: text.slice(0, match.index).split(/\r?\n/).length - 1
        })
    );

    const floats = [...text.matchAll(/\\begin\{figure\}/g)].map((match, index) => ({
        id: `float${index}`,
        kind: "float",
        label: `Float ${index + 1}`,
        line: text.slice(0, match.index).split(/\r?\n/).length - 1
    }));

    return [...blocks, ...reproducible, ...floats].sort((a, b) => a.line - b.line);
}

/*
 * Equations, for the outline's Equation list.
 *
 * Display maths only (`\[ ... \]`, `$$ ... $$`, and `\begin{equation}`), because
 * those are the ones that get numbered and that a reader looks up - an inline
 * `$F = ma$` is part of a sentence and does not belong in a contents list.
 */
export function parseEquations(source) {
    const text = String(source || "");

    const found = [];

    const add = (match) => {
        found.push({
            id: `eq${found.length}`,
            label: `Equation ${found.length + 1}`,
            line: text.slice(0, match.index).split(/\r?\n/).length - 1
        });
    };

    [...text.matchAll(/\\\[[\s\S]*?\\\]/g)].forEach(add);
    [...text.matchAll(/\$\$[\s\S]*?\$\$/g)].forEach(add);
    [...text.matchAll(/\\begin\{equation\}[\s\S]*?\\end\{equation\}/g)].forEach(add);

    return found.sort((a, b) => a.line - b.line);
}

/* ---------------------------------------------------------- */
/* THE PERSISTED SOURCE                                        */
/* ---------------------------------------------------------- */

const DOCUMENT_KEY = "solution";
const DRAFT_KEY = "datum.solution.draft";

/*
 * The source as it is held in memory.
 *
 * Kept here rather than read from the textarea on demand, because the toolbar,
 * the outline and the preview all need it and reaching into the DOM from three
 * places is how they end up disagreeing about which element is the source.
 */
let source = "";

function readDraft() {
    try {
        const raw = globalThis.localStorage?.getItem(DRAFT_KEY);

        return raw ? String(raw) : null;
    } catch (error) {
        /* Storage may be unavailable; the session still works. */
        return null;
    }
}

function writeDraft(text) {
    try {
        globalThis.localStorage?.setItem(DRAFT_KEY, text);
    } catch (error) {
        enggErrorLog.reportError("save solution draft", error, {});
    }
}

export function getSource() {
    return source;
}

/*
 * Replace the source.
 *
 * Returns true when it actually changed, so a caller can avoid re-rendering for
 * a keystroke that produced the same text.
 */
export function setSource(text) {
    const next = String(text ?? "");

    if (next === source) {
        return false;
    }

    source = next;

    writeDraft(source);

    return true;
}

/* The source to start a session with: the document's own, or the last draft. */
export function initialSource(documentSource) {
    if (typeof documentSource === "string") {
        return documentSource;
    }

    return readDraft() || "";
}

export function clearDraft() {
    try {
        globalThis.localStorage?.removeItem(DRAFT_KEY);
    } catch (error) {
        /* Nothing to do: the draft simply stays for this session. */
    }
}

/* The key the solution's source travels under, inside the document body. */
export const SOLUTION_DOCUMENT_KEY = DOCUMENT_KEY;

const enggSolutionState = {
    SOLUTION_DOCUMENT_KEY,
    clearDraft,
    getSource,
    initialSource,
    parseEquations,
    parseFigures,
    parseStructure,
    setSource
};

export default enggSolutionState;
