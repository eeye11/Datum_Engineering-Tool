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
export function writeStandaloneLatex(
    source,
    { title = "Written Solution", extraPreamble = [], drawings = {} } = {}
) {
    /*
     * DRAWING BLOCKS ARE COMPOSED, NOT LEFT AS COMMANDS.
     *
     * The written solution stores `\datumdrawing{sheet_...}` - a reference, so
     * the document never holds a second copy of a drawing's geometry. In the
     * COMPILED document that command has to become the drawing: each block is
     * replaced, in place, by a reference to a labelled picture rendered after
     * the body from the drawing's own current LaTeX.
     *
     * The figures are numbered `Drawing 1`, `Drawing 2` ... in document order,
     * and the pictures themselves are appended below the written text, before
     * `\end{document}` - one document, one preamble, no nested document
     * environments.
     */
    const composition = composeDrawingBlocks(String(source || ""), drawings || {});

    const text = composition.body;

    /*
     * COLLECT FIRST, THEN STRIP: the declarations are gathered from the body as
     * it stands, and only then removed from it, so the preamble receives each
     * one and the body keeps none. A linked drawing's own definitions are in its
     * picture, so they are collected too.
     */
    const colours = [
        ...new Set([
            ...(extraPreamble || []),
            ...collectColourDefinitions(text),
            ...composition.pictures.flatMap((picture) => collectColourDefinitions(picture))
        ])
    ];
    const stripped = stripColourDeclarations(text);

    return [
        `% ${title}`,
        "\\documentclass{article}",
        "\\usepackage{tikz}",
        "\\usepackage{amsmath}",
        "\\usepackage{amssymb}",
        "\\usepackage[T1]{fontenc}",
        "\\usepackage{caption}",
        "\\usetikzlibrary{arrows.meta}",
        "\\usetikzlibrary{patterns}",
        "\\usetikzlibrary{calc}",
        "\\usetikzlibrary{decorations.pathmorphing}",
        ...colours,
        "",
        "\\begin{document}",
        "",
        stripped.trim(),
        ...(composition.pictures.length ? ["", ...composition.pictures] : []),
        "",
        "\\end{document}",
        ""
    ].join("\n");
}

/*
 * THE COMPILED FORM OF THE DOCUMENT'S DRAWING BLOCKS.
 *
 * `drawings` is the written solution's resolution of its blocks:
 *
 *     { "sheet_4f1c2a9b": { number: 1, name: "Free body diagram", latex: "..." } }
 *
 * A block whose drawing could not be resolved is LEFT AS IT IS and reported: an
 * export that silently dropped a student's diagram would be worse than one that
 * did not compile, because the missing figure is easy to miss and impossible to
 * notice afterwards.
 *
 * Each picture is placed in a `minipage` of the text width, centred: standard
 * LaTeX, no package of its own. The picture is already fitted to the page when
 * DAETUM writes it, so nothing is asked to shrink here.
 */
function composeDrawingBlocks(body, drawings) {
    const pictures = [];
    const seen = new Set();
    const unresolved = [];

    const composed = body.replace(/\\datumdrawing\s*\{([A-Za-z0-9_-]+)\}/g, (match, drawingId) => {
        const drawing = drawings[drawingId];

        if (!drawing || typeof drawing.latex !== "string" || !drawing.latex.trim()) {
            unresolved.push(drawingId);

            return match;
        }

        const label = `datum-${drawingId}`;

        if (seen.has(drawingId)) {
            /* One drawing, one picture: a second inclusion points back at it. */
            return `\n\\noindent\\ref{fig:${label}}\n`;
        }

        seen.add(drawingId);

        const number = Number(drawing.number) || seen.size;
        const title = drawing.name ? escapeLatexText(drawing.name) : "";
        const name = title ? `: ${title}` : "";

        pictures.push(
            [
                "% ---------------------------------------------------------------------",
                `% Drawing ${number}${name ? ` - ${drawing.name}` : ""}`,
                "% ---------------------------------------------------------------------",
                "\\begin{center}",
                "\\begin{minipage}{\\linewidth}",
                "\\centering",
                drawing.latex.trim(),
                "\\par\\smallskip",
                `\\captionof{figure}{Drawing ${number}${name}}%`,
                `\\label{fig:${label}}`,
                "\\end{minipage}",
                "\\end{center}",
                ""
            ].join("\n")
        );

        return [
            "",
            "\\begin{center}",
            `  \\refstepcounter{figure}\\label{fig:${label}}%`,
            `  \\textbf{Drawing ${number}}${title ? ` \\textemdash{} ${title}` : ""}`,
            "\\end{center}",
            ""
        ].join("\n");
    });

    if (unresolved.length) {
        pictures.push(
            `% A drawing block could not be resolved and was left in the text: ${unresolved.join(", ")}`
        );
    }

    return { body: composed, pictures, unresolved };
}

function escapeLatexText(value) {
    return String(value ?? "")
        .replace(/[\\{}%$#&_]/g, (character) => `\\${character}`)
        .replace(/~/g, "\\textasciitilde{}")
        .replace(/\^/g, "\\textasciicircum{}");
}

const enggEmbeddedDrawings = {
    collectColourDefinitions,
    composeDrawingBlocks,
    parseDrawingBlocks,
    serializeDrawingBlock,
    writeStandaloneLatex
};

export default enggEmbeddedDrawings;
