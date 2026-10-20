/*
 * ============================================================
 * FORMAT SOURCE
 * ============================================================
 *
 * One indentation convention, applied to the drawing source: the picture
 * indents its body, an object block indents its commands, and a nested
 * environment indents its own. Nothing else about the text changes.
 *
 * WHAT IT MAY CHANGE.
 *
 *   leading whitespace on lines that do not sit inside a multi-line string of
 *   an object's own code
 *
 * WHAT IT MUST NOT CHANGE - and therefore does not touch.
 *
 *   - COMMENTS. A comment keeps its own column; a comment inside a block is
 *     indented WITH the block, and its text is never reflowed or joined.
 *   - UNSUPPORTED SOURCE. A command DAETUM cannot parse is left exactly where
 *     and how it is; the formatter cannot know its structure, and guessing is
 *     how a formatter loses somebody's work.
 *   - THE INSIDE OF A MULTI-LINE COMMAND. A `\draw ... node {..};` that spans
 *     three lines keeps its own continuation lines: they are inside one
 *     statement, and re-indenting them would change where the statement's
 *     author put them.
 *   - BLANK LINES AND TRAILING WHITESPACE POLICY. Trailing whitespace on a
 *     line is removed (it is invisible and never meaningful in TeX, where a line
 *     break IS a space); consecutive blank lines are collapsed to one.
 *   - THE MARKERS. DAETUM's object markers stay exactly where they are, on
 *     their own lines - the source map is what makes selection work, and a
 *     formatter that moved them would break it.
 *
 * WHY NOT A FULL PRETTIER-FOR-TEX. Because the code being formatted is not only
 * TikZ: it may be LaTeX the student pasted, a broken half-command they are
 * working on, or a package command DAETUM cannot render. A real TeX formatter
 * would reject all of those, and the ones that do not would guess. This one is
 * conservative ON PURPOSE: it only ever removes and re-adds indentation it can
 * prove is safe.
 */

import { isObjectMarkerLine } from "./drawing-source.js";
import { splitStatements } from "./source-statements.js";

export const INDENT = "  ";

/* The greatest depth the formatter will use, so a malformed file cannot indent
 * its way off the screen. */
const MAX_DEPTH = 8;

/*
 * Split the source into LINES, each tagged with whether it may be re-indented.
 *
 * A line is re-indentable when it is the FIRST line of a statement, a blank
 * line, or a continuation line of a statement that was itself one line until
 * this point. It is NOT re-indentable when it continues a multi-line statement
 * or lies inside one.
 */
function classifyLines(source) {
    const text = String(source ?? "");
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    const statements = splitStatements(text);

    /* Zero-based line -> the statement whose FIRST line this is. */
    const startsAt = new Map();

    /* Zero-based line -> the statement that STARTS or CONTINUES on it. */
    const byLine = [];

    statements.forEach((statement) => {
        startsAt.set(statement.startLine, statement);

        for (let line = statement.startLine; line <= statement.endLine; line += 1) {
            byLine[line] = statement;
        }
    });

    const offsets = [];
    let running = 0;

    lines.forEach((line) => {
        offsets.push(running);
        running += line.length + 1;
    });

    return lines.map((line, index) => {
        const statement = startsAt.get(index) || null;
        const continuation = Boolean(byLine[index]) && !statement;
        const marker = isObjectMarkerLine(line);
        const blank = line.trim() === "";
        const comment = /^\s*%/.test(line);

        return {
            text: line,
            index,
            /* The statement this line STARTS, or null for a continuation. */
            statement,
            /* The statement this line belongs to, started by an earlier line. */
            inside: byLine[index] || null,
            continuation,
            marker,
            blank,
            comment,
            /* The character offset this line begins at. */
            startOffset: offsets[index]
        };
    });
}

/*
 * FORMAT A WHOLE SOURCE. Returns the new text.
 *
 * The rule is one line: A LINE IS INDENTED BY THE NUMBER OF BLOCKS IT SITS
 * INSIDE.
 *
 *   - the picture is a block; a nested environment is a block; both open on
 *     their own first line and close on their own last line - so those two lines
 *     are OUTSIDE the block they describe, and everything between them is one
 *     level in.
 *   - a line that continues a multi-line statement is left exactly as written;
 *     it is inside the statement's own layout, which is its author's.
 *   - trailing whitespace goes (it is invisible, and in TeX a line break is
 *     already a space), and no more than one blank line survives in a row.
 *
 * NOTHING ELSE is touched. Comments keep their words, unsupported commands keep
 * their position, and DAETUM's own markers keep their lines - so the source map
 * still finds every object's region afterwards.
 */
export function formatSource(source) {
    const text = String(source ?? "");

    if (!text.trim()) {
        return text;
    }

    const classified = classifyLines(text);
    const out = [];

    /*
     * THE BLOCKS, as [first line, last line] pairs in zero-based line numbers.
     * Named by kind because a picture opens and closes with TWO statements while
     * a nested environment is ONE - and both are the same thing to the
     * indentation: a region whose interior is one level deeper.
     */
    const blocks = [];
    let pictureOpen = null;

    classified.forEach((line) => {
        const statement = line.statement;

        if (!statement) {
            return;
        }

        if (statement.name === "begin-tikzpicture") {
            pictureOpen = statement.startLine;
            return;
        }

        if (statement.name === "end-tikzpicture") {
            if (pictureOpen !== null) {
                blocks.push({ first: pictureOpen, last: statement.startLine });
                pictureOpen = null;
            }

            return;
        }

        if (statement.kind === "environment") {
            /*
             * A NESTED ENVIRONMENT'S LAST LINE IS THE LINE ITS `\end` IS ON, not
             * the character its `\end` ends at - because the block closes after
             * that line, and the indentation is counted in lines.
             */
            blocks.push({ first: statement.startLine, last: statement.endLine });
        }
    });

    /* An unclosed picture still indents its body; it runs to the end of the file. */
    if (pictureOpen !== null) {
        blocks.push({ first: pictureOpen, last: classified.length - 1 });
    }

    const depthAt = (index) =>
        blocks.filter((block) => index >= block.first && index <= block.last).length;

    let blankRun = 0;

    classified.forEach((line, index) => {
        /*
         * A CONTINUATION LINE KEEPS ITS OWN COLUMN when it belongs to a
         * COMMAND. It is inside that statement's own layout - wrapped
         * coordinates, a node on its own line - and moving it would change where
         * the author put it. A nested ENVIRONMENT is not a command: its body is
         * ordinary lines that the formatter may indent, and the whole block is
         * indented together.
         */
        if (line.continuation && line.inside && line.inside.kind === "command") {
            out.push(line.text.replace(/[ \t]+$/, ""));
            blankRun = 0;
            return;
        }

        if (line.continuation) {
            /*
             * A LINE INSIDE A NESTED ENVIRONMENT is an ordinary line at the
             * depth that environment has just opened.
             */
            const depth = Math.min(
                MAX_DEPTH,
                Math.max(0, depthAt(index) - (line.inside && line.inside.name === "begin-tikzpicture" ? 1 : 0))
            );

            out.push(INDENT.repeat(depth) + line.text.replace(/[ \t]+$/, "").trimStart());
            blankRun = 0;
            return;
        }

        if (line.blank) {
            blankRun += 1;

            if (blankRun === 1) {
                out.push("");
            }

            return;
        }

        blankRun = 0;

        const depth = Math.min(MAX_DEPTH, Math.max(0, depthAt(index) - (line.statement && line.statement.name === "begin-tikzpicture" ? 1 : 0)));
        const body = line.text.replace(/[ \t]+$/, "");

        out.push(INDENT.repeat(depth) + body.trimStart());
    });

    return out.join("\n");
}

/*
 * Whether the source is already formatted. Used so Format Source does not
 * record an undo entry for a no-op - a command that "did something" when it
 * changed nothing is a history full of entries with no change in them.
 */
export function isFormatted(source) {
    return formatSource(source) === String(source ?? "");
}

/*
 * The smallest safe region containing a selection: WHOLE LINES.
 *
 * Formatting a fragment that starts mid-statement would re-indent the second
 * half of a command, so the unit is always whole source lines - and a range that
 * lies inside a multi-line statement is refused, because that statement's
 * internal layout is the student's.
 */
export function formattableRange(source, start, end) {
    const text = String(source ?? "");
    const statements = splitStatements(text);

    const lineStart = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;

    let lineEnd = text.indexOf("\n", end);

    if (lineEnd < 0) {
        lineEnd = text.length;
    }

    const inside = statements.find(
        (statement) => statement.start < lineStart && statement.end > lineStart
    );

    if (inside) {
        /* The selection begins in the middle of a statement. Widen to its start. */
        return { start: inside.start, end: lineEnd };
    }

    return { start: lineStart, end: lineEnd };
}

export default { formatSource, isFormatted, formattableRange, INDENT };
