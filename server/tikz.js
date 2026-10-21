/*
 * TikZ -> SVG rendering, in-process, with TikZJax.
 *
 * TikZJax (a WebAssembly build of TeX) takes several seconds to load, so it
 * is loaded once, in the background, and the server does not wait for it:
 * the site is usable immediately and the render endpoint reports "not
 * ready" until TikZ is. A failed load leaves the endpoint unavailable rather
 * than taking the whole server down.
 *
 * TeX runs one job at a time, so renders are queued, and a render that
 * does not finish within RENDER_TIMEOUT_MS is reported as failed.
 */
const RENDER_TIMEOUT_MS = 30_000;

let engine = null;              // { tex, dvi2svg } once loaded
let loadError = null;
let queue = Promise.resolve();

export function tikzStatus() {
    return engine ? "ready" : loadError ? "unavailable" : "loading";
}

export async function loadTikz() {
    try {
        const tikzjax = await import("node-tikzjax");
        await tikzjax.load();
        engine = { tex: tikzjax.tex, dvi2svg: tikzjax.dvi2svg };
    } catch (error) {
        loadError = error;
        throw error;
    }
}

/*
 * The student's code may be a complete LaTeX document or just the picture.
 *
 * The TikZJax core dump is a bare LaTeX format with NO document class, so the
 * preamble is always supplied by this module and the input's preamble-shaped
 * lines (\documentclass, \usepackage, \usetikzlibrary, \begin{document},
 * \end{document}) are stripped from it, whatever its origin - DAETUM's own
 * generated source or a complete document pasted into the Source tab. Only
 * the drawing (the body) is compiled, wrapped in DAETUM's preamble, which
 * loads tikz, arrows.meta and amsmath (for \tfrac, \mathrm and friends) and
 * xcolor (for colour names). Comments inside the body are preserved; they are
 * part of the student's code.
 *
 * TikZ libraries that the pasted document loaded but DAETUM's preamble does
 * not are carried over, so a document using e.g. the `calc` library still
 * works.
 *
 * THE BASE LIST IS WHAT DAETUM'S OWN SOURCE USES, not a minimal guess.
 *
 * The source writers emit `-{Latex}` heads (arrows.meta) inside
 * `dash pattern=...` paths and truss/moment constructions that use `calc`, and
 * they emit arcs with an `arc[...]` operation. Every one of those needs its
 * library at COMPILE time; a missing library is not a warning, it is
 * `! Package pgfkeys Error`, which fails the whole document - so ONE such
 * object blanked the entire sheet even though its own code was correct. The
 * standalone export already declared this exact list
 * (`STATIC_STANDALONE_LIBRARIES` in statics.js); the renderer's wrapper did
 * not, so the exported document compiled in TeX Live while the Drawing Space
 * did not.
 *
 * `amsmath` is loaded for `\cdot`, `\mathrm` and `\tfrac`, all of which the
 * value labels use.
 */
const BASE_LIBRARIES = "arrows.meta,calc,decorations.pathmorphing";

/*
 * Strip preamble-shaped lines from the input, whatever its origin. Only the
 * drawing body remains; the preamble is always supplied by this module.
 */
export function cleanTikZ(input) {
    return String(input)
        .replace(/\\documentclass(?:\[[^\]]*\])?\{[^}]*\}/g, "")
        .replace(/\\usepackage(?:\[[^\]]*\])?\{[^}]*\}/g, "")
        .replace(/\\usetikzlibrary\{[^}]*\}/g, "")
        .replace(/\\begin\s*\{document\}/g, "")
        .replace(/\\end\s*\{document\}/g, "")
        .trim();
}

/*
 * The TikZ libraries a pasted document asked for, beyond the ones DAETUM's
 * own preamble always loads.
 */
export function extraTikzLibraries(input) {
    const known = new Set(BASE_LIBRARIES.split(",").map((name) => name.trim()));
    const asked = [];

    for (const match of String(input).matchAll(/\\usetikzlibrary(?:\[[^\]]*\])?\{([^}]*)\}/g)) {
        for (const name of match[1].split(",")) {
            const trimmed = name.trim();

            if (trimmed && !known.has(trimmed) && !asked.includes(trimmed)) {
                asked.push(trimmed);
            }
        }
    }

    return asked;
}

/*
 * THE WRAPPER DOCUMENT.
 *
 * Exported so the boundary between "the drawing" (the text in the Source tab)
 * and "the infrastructure that compiles it" is testable in one place: a test
 * can assert that the picture is sent unchanged and that every library the
 * writers use is declared here rather than inside the editable source.
 */
/*
 * ANCHORING THE PICTURE TO ITS ORIGIN.
 *
 * TeX places a tikzpicture by its BOUNDING BOX, so the SVG it produces has lost
 * where the drawing was: `(0,0) -- (10,0)` and `(20,10) -- (30,10)` compile to
 * the identical SVG. That is right for a figure embedded in a document and
 * wrong for the Drawing Space, which must put every compiled object exactly
 * where the object model - and so hit testing, snapping and the selection
 * outline - says it is.
 *
 * So the canvas asks for the picture's bounding box to be reset to the single
 * point (0,0) at the very end of the picture. The drawing itself is untouched;
 * only where TeX places it changes, and the SVG's own origin (its viewBox
 * corner) is then the drawing's (0,0). The Source text is not edited - this is
 * the compile wrapper's business, like the preamble.
 */
const ORIGIN_ANCHOR = String.raw`\pgfresetboundingbox\useasboundingbox (0,0);`;

/*
 * WHERE THE CONVERTER PUTS THE ORIGIN.
 *
 * TeX's DVI puts the (1in, 1in) page origin - the point every picture is
 * measured from - at 72.27pt from the page corner, and the converter keeps
 * that convention, so a picture whose bounding box was reset to (0,0) draws
 * its own (0,0) at (-72.27, -72.27) in SVG units. The measurement is the
 * same for every picture (verified against several world positions,
 * including negative ones), so one translation seats any picture exactly.
 * The SVG keeps the reset bounding box (width and height 0), which the
 * Drawing Space replaces with its own camera anyway.
 */
const TEAX_ONE_INCH_PT = 72.27;

export function seatPictureAtOrigin(svg) {
    const text = String(svg);

    /*
     * A reset bounding box announces itself by a zero width and height; a
     * picture that was not anchored (an ordinary render) is left untouched.
     */
    if (!/<svg\b[^>]*\bwidth="0"/.test(text)) {
        return text;
    }

    /* The translation must wrap EVERYTHING the picture draws. */
    return text.replace(
        /(<svg\b[^>]*>)([\s\S]*)(<\/svg>)/,
        (_all, open, inner, close) =>
            `${open}<g transform="translate(${TEAX_ONE_INCH_PT} ${TEAX_ONE_INCH_PT})">${inner}</g>${close}`
    );
}

export function anchorPictureAtOrigin(body) {
    const text = String(body);
    const end = text.lastIndexOf("\\end{tikzpicture}");

    if (end < 0) {
        return text;
    }

    return `${text.slice(0, end)}${ORIGIN_ANCHOR}\n${text.slice(end)}`;
}

export function documentFor(tikz, { anchorOrigin = false } = {}) {
    const libraries = [...new Set([...BASE_LIBRARIES.split(","), ...extraTikzLibraries(tikz)])].join(",");
    const body = anchorOrigin ? anchorPictureAtOrigin(cleanTikZ(tikz)) : cleanTikZ(tikz);

    return String.raw`\usepackage{tikz}
\usepackage{amsmath}
\usepackage{amssymb}
\usepackage{xcolor}
\usetikzlibrary{${libraries}}

\begin{document}

${body}

\end{document}
`;
}

function withTimeout(promise, ms) {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`TikZ rendering took longer than ${ms / 1000} s.`)), ms);
        })
    ]).finally(() => clearTimeout(timer));
}

/* Render TikZ source to SVG markup. Rejects if TikZ is not ready or the source does not compile. */
export function renderTikz(tikz, { debug = false, anchorOrigin = false } = {}) {
    if (!engine) {
        return Promise.reject(new Error(
            loadError ? "TikZ rendering is unavailable on this server." : "TikZ is still loading; try again shortly."
        ));
    }

    const job = queue.then(async () => {
        const dvi = await engine.tex(documentFor(tikz, { anchorOrigin }), { showConsole: debug });
        const svg = await engine.dvi2svg(dvi);
        return anchorOrigin ? seatPictureAtOrigin(svg) : svg;
    });

    // The next job waits for this one whether it succeeds or not.
    queue = job.catch(() => {});

    return withTimeout(job, RENDER_TIMEOUT_MS);
}
