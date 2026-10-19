/*
 * ============================================================
 * READING THE DRAWING SPACE FROM A TEST
 * ============================================================
 *
 * The Drawing Space is two stacked SVGs inside `.drawing-canvas`:
 *
 *   svg.drawing-source-layer   the compiled TikZ picture - the drawing
 *   svg.drawing-overlay        the editor's interaction aids - the grid,
 *                              selection outlines, handles, snap markers
 *
 * A test that only checks "an SVG exists" proves nothing: both layers always
 * exist, and both can exist while everything they contain sits outside the
 * visible canvas. So these helpers read the GEOMETRY that decides visibility:
 *
 *   - the picture layer's viewBox, which is the canvas's window onto drawing
 *     units (the camera),
 *   - the union bounding box of the drawing elements inside it, in those same
 *     drawing units,
 *   - whether those two rectangles overlap, and by how much,
 *   - how many drawing elements there are at all.
 *
 * A drawing is VISIBLE when at least one of its elements lies inside the
 * viewBox, with non-zero length, and the layer's on-screen rectangle is
 * non-zero. That is the assertion that fails when compilation succeeds and the
 * Drawing Space still shows nothing.
 *
 * Everything here runs inside the page (through `runInFreshPage`), so it is
 * passed as source text and must be plain, self-contained JavaScript.
 */

/* The in-page extractor. Kept as a string because it is evaluated in a page. */
const PICTURE_READER = String.raw`
const DRAWABLE = "path,line,polyline,polygon,circle,ellipse,rect";
function layerOf(doc) {
    const canvas = doc.querySelector(".drawing-canvas");
    if (!canvas) return null;
    return canvas.querySelector(":scope > svg.drawing-source-layer");
}
function numbers(text) {
    return String(text || "").trim().split(/[\s,]+/).filter(Boolean).map(Number);
}
function viewBoxOf(svg) {
    const values = numbers(svg && svg.getAttribute("viewBox"));
    if (values.length !== 4 || values.some((n) => !Number.isFinite(n))) return null;
    return { x: values[0], y: values[1], width: values[2], height: values[3] };
}
/*
 * A path's extent. The browser's getBBox is used when it exists; jsdom does
 * not implement SVG geometry, so the path data is read instead - which is what
 * a browser would have measured anyway.
 */
function elementBox(el) {
    if (typeof el.getBBox === "function") {
        try {
            const box = el.getBBox();
            if (Number.isFinite(box.width) || Number.isFinite(box.height)) {
                return { x: box.x, y: box.y, width: box.width, height: box.height };
            }
        } catch { /* fall through to the data */ }
    }
    const tag = el.tagName.toLowerCase();
    let xs = [], ys = [];
    if (tag === "path") {
        const d = el.getAttribute("d") || "";
        const tokens = d.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) || [];
        let i = 0, cmd = null, cx = 0, cy = 0;
        while (i < tokens.length) {
            const token = tokens[i];
            if (/^[A-Za-z]$/.test(token)) { cmd = token; i += 1; continue; }
            const upper = String(cmd || "L").toUpperCase();
            if (upper === "Z") { i += 1; continue; }
            if (upper === "H") { cx = Number(tokens[i]); xs.push(cx); ys.push(cy); i += 1; }
            else if (upper === "V") { cy = Number(tokens[i]); xs.push(cx); ys.push(cy); i += 1; }
            else if (upper === "C") {
                const x1 = Number(tokens[i]), y1 = Number(tokens[i + 1]);
                const x2 = Number(tokens[i + 2]), y2 = Number(tokens[i + 3]);
                cx = Number(tokens[i + 4]); cy = Number(tokens[i + 5]);
                xs.push(x1, x2, cx); ys.push(y1, y2, cy); i += 6;
            } else if (upper === "S" || upper === "Q") {
                const x1 = Number(tokens[i]), y1 = Number(tokens[i + 1]);
                cx = Number(tokens[i + 2]); cy = Number(tokens[i + 3]);
                xs.push(x1, cx); ys.push(y1, cy); i += 4;
            } else if (upper === "A") {
                cx = Number(tokens[i + 5]); cy = Number(tokens[i + 6]);
                xs.push(cx); ys.push(cy); i += 7;
            } else if (upper === "M" || upper === "L" || upper === "T") {
                cx = Number(tokens[i]); cy = Number(tokens[i + 1]);
                xs.push(cx); ys.push(cy); i += 2;
            } else { i += 1; }
        }
    } else if (tag === "line") {
        xs = [Number(el.getAttribute("x1")), Number(el.getAttribute("x2"))];
        ys = [Number(el.getAttribute("y1")), Number(el.getAttribute("y2"))];
    } else if (tag === "polyline" || tag === "polygon") {
        const values = numbers(el.getAttribute("points"));
        for (let i = 0; i + 1 < values.length; i += 2) { xs.push(values[i]); ys.push(values[i + 1]); }
    } else if (tag === "circle") {
        const cx = Number(el.getAttribute("cx")), cy = Number(el.getAttribute("cy")), r = Number(el.getAttribute("r"));
        xs = [cx - r, cx + r]; ys = [cy - r, cy + r];
    } else if (tag === "ellipse") {
        const cx = Number(el.getAttribute("cx")), cy = Number(el.getAttribute("cy"));
        const rx = Number(el.getAttribute("rx")), ry = Number(el.getAttribute("ry"));
        xs = [cx - rx, cx + rx]; ys = [cy - ry, cy + ry];
    } else if (tag === "rect") {
        const x = Number(el.getAttribute("x")), y = Number(el.getAttribute("y"));
        xs = [x, x + Number(el.getAttribute("width"))];
        ys = [y, y + Number(el.getAttribute("height"))];
    }
    xs = xs.filter(Number.isFinite); ys = ys.filter(Number.isFinite);
    if (!xs.length || !ys.length) return null;
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
function overlap(a, b) {
    if (!a || !b) return 0;
    const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    if (w < 0 || h < 0) return 0;
    return w * h;
}
function readPicture(doc) {
    const layer = layerOf(doc);
    if (!layer) return { exists: false };
    const viewBox = viewBoxOf(layer);
    const elements = [...layer.querySelectorAll(DRAWABLE)];
    const boxes = elements.map(elementBox).filter(Boolean);
    const withArea = boxes.filter((box) => box.width > 0 || box.height > 0);
    const probe = { x: viewBox ? viewBox.x : 0, y: viewBox ? viewBox.y : 0,
        width: viewBox ? viewBox.width : 1, height: viewBox ? viewBox.height : 1 };
    const visible = withArea.filter((box) => overlap(box, probe) > 0);
    const union = boxes.reduce((acc, box) => {
        if (!acc) return { ...box };
        const x = Math.min(acc.x, box.x), y = Math.min(acc.y, box.y);
        return { x, y, width: Math.max(acc.x + acc.width, box.x + box.width) - x,
            height: Math.max(acc.y + acc.height, box.y + box.height) - y };
    }, null);
    return {
        exists: true,
        viewBox,
        elementCount: elements.length,
        boxes,
        drawnArea: withArea.length,
        visibleCount: visible.length,
        visibleArea: visible.reduce((sum, box) => sum + overlap(box, probe), 0),
        visibleFraction: union ? visible.reduce((sum, box) => sum + overlap(box, probe), 0)
            / Math.max(1e-9, union.width * union.height) : 0,
        bounds: union,
        withinView: visible.length === withArea.length && withArea.length > 0,
        layerWidth: layer.getAttribute("width"),
        layerHeight: layer.getAttribute("height"),
        layerDisplay: getComputedStyle(layer).display,
        rendered: layer.dataset.rendered || null,
        signature: layer.innerHTML.replace(/\s+/g, " ").slice(0, 4000)
    };
}
function readOverlay(doc) {
    const canvas = doc.querySelector(".drawing-canvas");
    const overlay = canvas && canvas.querySelector(":scope > svg.drawing-overlay");
    if (!overlay) return { exists: false };
    const viewBox = viewBoxOf(overlay);
    const grid = overlay.querySelector("path");
    return {
        exists: true,
        viewBox,
        elementCount: overlay.querySelectorAll("*").length,
        gridPath: grid ? grid.getAttribute("d") : null,
        width: overlay.getAttribute("width"),
        height: overlay.getAttribute("height")
    };
}
function drawingLayers(doc) {
    const canvas = document.querySelector("canvas") || doc.querySelector(".drawing-canvas");
    return canvas ? [...canvas.querySelectorAll(":scope > svg")].map((svg) => svg.getAttribute("class")) : [];
}
`;

module.exports = { PICTURE_READER };
