/*
 * ============================================================
 * EMBEDDED DRAWINGS IN THE WRITTEN SOLUTION
 * ============================================================
 *
 * A drawing inserted into the written solution is EMBEDDED, not referenced:
 * its complete TikZ source is written into the document at the insertion
 * point, and the document is the only thing needed to reconstruct it. There
 * is no sheet id to resolve, no token to substitute at render time, no
 * separate drawing to fetch - the source the reader sees is the source that
 * compiles.
 *
 * The embedded form is PLAIN LaTeX. No application markers, no metadata
 * comments, no wrappers: what lands in the document is exactly the
 * `tikzpicture` the drawing's own source view and export produce. The
 * document stays a normal LaTeX file that any tool can read, and nothing
 * in it says "DAETUM" where a drawing sits.
 *
 * This module owns the TEXT handling around that:
 *
 *   the parse         where each embedded picture is in the source
 *   the formatting    the blank-line spacing around an inserted picture
 *   the preamble      the drawings' shared declarations, stated once at
 *                     the top of the document rather than repeated inside
 *                     each drawing
 *
 * THE COLLAPSE IS A DISPLAY. A picture is ordinary source text; the
 * editor's collapse layer finds it by matching the environment itself, so
 * the code is present in the document whether the block is expanded or
 * collapsed in the editor. Nothing here replaces, hides or removes source.
 */

/*
 * The source text of one embedded drawing, as it is written into the
 * document: the picture set off from the prose by blank lines, so a block
 * surrounded by paragraphs is still delimited text rather than a run-on.
 * The spacing IS the formatting - there are no markers to add.
 */
export function serializeDrawingBlock(tikz) {
    const body = String(tikz || "").replace(/\s+$/, "");

    return body.trim() ? `\n\n${body}\n\n` : "";
}

/*
 * Every embedded drawing in a source, in document order.
 *
 * Returns CHARACTER positions, because the editor both splits the document
 * around blocks and maps a block to the lines its code occupies - and both
 * need the same coordinates. A block is a complete `tikzpicture`
 * environment: from its `\begin{tikzpicture}` to the matching
 * `\end{tikzpicture}` on a later line. Nesting of the environment inside
 * itself does not occur (a picture does not contain another), so the first
 * `\end` after a `\begin` closes it.
 */
export function parseDrawingBlocks(source) {
    const text = String(source || "");
    const found = [];

    let search = 0;

    for (;;) {
        const begin = text.indexOf("\\begin{tikzpicture}", search);

        if (begin < 0) {
            break;
        }

        const end = text.indexOf("\\end{tikzpicture}", begin);

        if (end < 0) {
            /*
             * An unterminated environment - a student cut the closing line
             * out - is still a block, reported to where the source ends, so
             * the collapsed chip cannot swallow the rest of the document.
             */
            found.push(buildBlock(begin, text.slice(begin), text));

            break;
        }

        const close = "\\end{tikzpicture}".length;

        found.push(buildBlock(begin, text.slice(begin, end + close), text));

        search = end + close;
    }

    return found;
}

function buildBlock(begin, raw, text) {
    const body = raw.replace(/\s+$/, "");

    /* The line the block begins on (the \begin line's own line, zero-based). */
    const line = String(text || "").slice(0, begin).split(/\r?\n/).length - 1;

    return {
        index: begin,
        raw,
        code: body,
        line,
        lines: body.split(/\r?\n/).length
    };
}

/*
 * A line that is nothing but a colour declaration - matched whether
 * indented or not - so the hoisted definition can be removed from the
 * body once it has moved to the preamble.
 */
const COLOUR_LINE =
    /^\s*\\definecolor\s*\{[^}]*\}\s*\{[^}]*\}\s*\{[^}]*\}\s*$/;

/*
 * Every \definecolor in the body, once, in first-appearance order.
 *
 * A drawing's palette names its colours `daetum1`, `daetum2`, ...; two
 * drawings declaring the same name would redefine each other's colour. So
 * the declarations are HOISTED: collected here, stated once in the
 * preamble, and removed from the body where they were embedded.
 */
export function collectColourDefinitions(body) {
    const seen = new Set();
    const definitions = [];

    for (const line of String(body || "").split(/\r?\n/)) {
        if (!COLOUR_LINE.test(line)) {
            continue;
        }

        if (!seen.has(line.trim())) {
            seen.add(line.trim());
            definitions.push(line.trim());
        }
    }

    return definitions;
}

function stripColourDeclarations(text) {
    return String(text || "")
        .split(/\r?\n/)
        .filter((line) => !COLOUR_LINE.test(line))
        .join("\n");
}

/*
 * The full LaTeX document for the written solution.
 *
 * The student writes the BODY (sections, equations, drawings); this wraps
 * it with the class and the packages every embedded drawing needs. Shared
 * declarations belong HERE, once - the preamble of the document - and not
 * inside each drawing, which would redefine the same colour names against
 * one another. `extraPreamble` carries the definitions contributed at
 * insert time, so a colour a drawing named stays the colour it was named
 * as, and a definition that appears twice is stated once.
 */
export function writeStandaloneLatex(source, { title = "Written Solution", extraPreamble = [] } = {}) {
    const text = String(source || "");

    /*
     * COLLECT FIRST, THEN STRIP: the declarations are gathered from the
     * body as it stands, and only then removed from it, so the preamble
     * receives each one and the body keeps none.
     */
    const colours = [
        ...new Set([...(extraPreamble || []), ...collectColourDefinitions(text)])
    ];
    const stripped = stripColourDeclarations(text);

    return [
        `% ${title}`,
        "\\documentclass{article}",
        "\\usepackage{tikz}",
        "\\usepackage{amsmath}",
        "\\usepackage{amssymb}",
        "\\usepackage[T1]{fontenc}",
        "\\usetikzlibrary{arrows.meta}",
        "\\usetikzlibrary{patterns}",
        ...colours,
        "",
        "\\begin{document}",
        "",
        stripped.trim(),
        "",
        "\\end{document}",
        ""
    ].join("\n");
}

const enggEmbeddedDrawings = {
    collectColourDefinitions,
    parseDrawingBlocks,
    serializeDrawingBlock,
    writeStandaloneLatex
};

export default enggEmbeddedDrawings;
