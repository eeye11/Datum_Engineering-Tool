// Shared layout for the canvas and source writer. Keep equipment names in
// their casings; place free labels in clear space around their original anchor.
export function layoutCycleLabels(paths, labels, geometry) {
    const size = Math.max(1, Math.abs(geometry.height || 1)) * 0.036;
    const gap = size * 0.25;
    const occupied = [];
    const bounds = points => ({ minX: Math.min(...points.map(p => p.x)), maxX: Math.max(...points.map(p => p.x)), minY: Math.min(...points.map(p => p.y)), maxY: Math.max(...points.map(p => p.y)) });
    const contains = (point, polygon) => {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const a = polygon[i], b = polygon[j];
            if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
        }
        return inside;
    };
    const outlines = paths.filter(path => {
        const points = path.points;
        return points.length > 3 && Math.hypot(points[0].x - points.at(-1).x, points[0].y - points.at(-1).y) < 1e-8;
    });
    const widthOf = text => [...text].reduce((sum, char) => sum + (/[il.,:;! ]/.test(char) ? 0.30 : /[MW]/.test(char) ? 0.85 : 0.58), 0) * size;
    const wrap = (text, width) => text.split("\n").flatMap(part => {
        const lines = [""];
        for (const word of part.split(/\s+/)) {
            const last = lines.length - 1;
            const joined = lines[last] ? `${lines[last]} ${word}` : word;
            if (lines[last] && widthOf(joined) > width) lines.push(word);
            else lines[last] = joined;
        }
        return lines;
    });
    const overlaps = (a, b) => a.minX < b.maxX + gap && a.maxX > b.minX - gap && a.minY < b.maxY + gap && a.maxY > b.minY - gap;
    const touchesPath = box => paths.some(path => path.points.some((b, i) => {
        if (!i) return false;
        const a = path.points[i - 1];
        // Clip the segment against the label's padded rectangle.
        let lo = 0, hi = 1;
        for (const [axis, min, max] of [["x", box.minX - gap, box.maxX + gap], ["y", box.minY - gap, box.maxY + gap]]) {
            const delta = b[axis] - a[axis];
            if (Math.abs(delta) < 1e-12) { if (a[axis] < min || a[axis] > max) return false; }
            else {
                const first = (min - a[axis]) / delta, second = (max - a[axis]) / delta;
                lo = Math.max(lo, Math.min(first, second));
                hi = Math.min(hi, Math.max(first, second));
                if (lo > hi) return false;
            }
        }
        return true;
    }));
    // Number markers stay centred in their circles and reserve their space first.
    const ordered = [...labels].sort((a, b) => Number(/^\d+$/.test(b.text)) - Number(/^\d+$/.test(a.text)));
    for (const label of ordered) {
        const number = /^\d+$/.test(label.text);
        const container = !label.plainText && outlines.filter(path => contains(label.point, path.points))
            .map(path => bounds(path.points)).sort((a, b) => (a.maxX - a.minX) * (a.maxY - a.minY) - (b.maxX - b.minX) * (b.maxY - b.minY))[0];
        label.lines = wrap(label.text, container ? (container.maxX - container.minX) * 0.82 : size * 14);
        let width = Math.max(...label.lines.map(widthOf));
        let height = size * (1 + (label.lines.length - 1) * 1.2);
        label.fontScale = container ? Math.min(1, (container.maxX - container.minX) * 0.82 / width, (container.maxY - container.minY) * 0.75 / height) : 1;
        width *= label.fontScale;
        height *= label.fontScale;
        const boxAt = point => ({ minX: point.x - width / 2, maxX: point.x + width / 2, minY: point.y - height / 2, maxY: point.y + height / 2 });
        // A tapered casing or scalloped cloud has less room than its bounding
        // rectangle. Fit to the actual outline, rather than letting text cross it.
        if (container && !number) {
            while (touchesPath(boxAt(label.point)) && label.fontScale > 0.45) {
                label.fontScale *= 0.92;
                width *= 0.92;
                height *= 0.92;
            }
        }
        if (!number) {
            const origin = { ...label.point };
            let found = false;
            for (let ring = 0; ring <= 20 && !found; ring++) {
                const candidates = ring === 0 ? [[0, 0]] : [[0, ring], [0, -ring], [ring, 0], [-ring, 0], [ring, ring], [-ring, ring], [ring, -ring], [-ring, -ring]];
                for (const [dx, dy] of candidates) {
                    const point = { x: origin.x + dx * size * 0.65, y: origin.y + dy * size * 0.65 };
                    const box = boxAt(point);
                    if (container && (box.minX < container.minX || box.maxX > container.maxX || box.minY < container.minY || box.maxY > container.maxY)) continue;
                    if (occupied.some(other => overlaps(box, other)) || touchesPath(box)) continue;
                    label.point = point;
                    found = true;
                    break;
                }
            }
        }
        occupied.push(boxAt(label.point));
    }
    return { paths, labels };
}
