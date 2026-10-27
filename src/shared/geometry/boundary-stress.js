import equations from "../../features/workspace/model/analysis/diagram-equations.js";

export const BOUNDARY_EDGES = ["top", "right", "bottom", "left"];

// Coordinates are local to the plate: bottom-left (0,0), top-right (1,1).
export function boundaryEquation(text, edge, g = {}) {
    const horizontal = edge === "top" || edge === "bottom";
    const extent = key => Number(g[key]) > 0 ? Number(g[key]) : 1;
    const width = extent("dimensionWidth"), height = extent("dimensionHeight");
    let source = String(text);
    for (const key of ["dimensionWidth", "dimensionHeight"]) {
        const symbol = String(g[key] || "");
        if (/^[a-wzA-Z][a-zA-Z_]*$/.test(symbol)) source = source.replace(new RegExp(`\\b${symbol}\\b`, "g"), "1");
    }
    source = source.replace(/\bx\b/g, horizontal ? `(x*${width})` : edge === "right" ? String(width) : "0")
        .replace(/\by\b/g, horizontal ? edge === "top" ? String(height) : "0" : `(x*${height})`);
    return equations.equationFor(source);
}

export function boundaryStressDrawing(g) {
    const paths = [], labels = [];
    const size = Math.min(g.width, g.height);
    const angle = (Number(g.rotation) || 0) * Math.PI / 180;
    const c = Math.cos(angle), s = Math.sin(angle);
    const cx = g.position.x + g.width / 2, cy = g.position.y - g.height / 2;
    const world = ([x, y]) => ({ x: cx + x * c - y * s, y: cy + x * s + y * c });
    const profiles = {};
    for (const edge of BOUNDARY_EDGES) for (const kind of ["normal", "shear"]) {
        const text = String(g[`${edge}_${kind}Equation`] || "").trim();
        const equation = text ? boundaryEquation(text, edge, g) : null;
        profiles[`${edge}_${kind}`] = Array.from({ length: 43 }, (_, i) => {
            const t = i / 42;
            if (text) {
                const value = equation?.(t);
                return typeof value === "number" && Number.isFinite(value) ? value : 0;
            }
            const start = Number(g[`${edge}_${kind}Start`]) || 0;
            const end = Number(g[`${edge}_${kind}End`]) || 0;
            return start + (end - start) * (g[`${edge}_profile`] === "quadratic" ? t * t : t);
        });
    }
    const values = Object.values(profiles).flat();
    const maximum = Math.max(1e-9, ...values.map(Math.abs));
    for (const edge of BOUNDARY_EDGES) {
        const horizontal = edge === "top" || edge === "bottom";
        const sign = edge === "top" || edge === "right" ? 1 : -1;
        const tangent = horizontal ? [1, 0] : [0, 1];
        const normal = horizontal ? [0, sign] : [sign, 0];
        const span = horizontal ? g.width : g.height;
        const face = horizontal ? g.height / 2 : g.width / 2;
        for (const kind of ["normal", "shear"]) {
            const samples = profiles[`${edge}_${kind}`];
            const colour = g[`${kind}Colour`] || (kind === "normal" ? "#db2777" : "#2563eb");
            const tips = [];
            for (let i = 0; i < samples.length; i++) {
                const t = i / (samples.length - 1);
                const value = samples[i];
                const gap = kind === "normal" ? 0.09 : 0.025;
                const base = [tangent[0] * (t - 0.5) * span + normal[0] * (face + size * gap),
                    tangent[1] * (t - 0.5) * span + normal[1] * (face + size * gap)];
                if (Math.abs(value) < maximum * 1e-8) { tips.push(world(base)); continue; }
                const direction = kind === "normal" ? normal : tangent;
                const length = (kind === "normal" ? 0.32 : 0.12) * size * Math.abs(value) / maximum;
                if (kind === "normal") tips.push(world([base[0] + normal[0] * length, base[1] + normal[1] * length]));
                if (i % 7 !== 0) continue;
                let from = [...base], to;
                if (kind === "normal") {
                    to = [base[0] + direction[0] * length, base[1] + direction[1] * length];
                    if (value < 0) [from, to] = [to, from];
                } else {
                    const signed = Math.sign(value) * length;
                    from = [base[0] - direction[0] * signed / 2, base[1] - direction[1] * signed / 2];
                    to = [base[0] + direction[0] * signed / 2, base[1] + direction[1] * signed / 2];
                }
                const dx = to[0] - from[0], dy = to[1] - from[1];
                const ux = dx / length, uy = dy / length;
                const head = Math.min(size * 0.045, length * 0.4);
                const points = [from, to, [to[0] - head * ux - head * 0.5 * uy, to[1] - head * uy + head * 0.5 * ux]];
                if (kind === "normal") points.push(to, [to[0] - head * ux + head * 0.5 * uy, to[1] - head * uy - head * 0.5 * ux]);
                paths.push({ points: points.map(world), colour });
            }
            if (kind === "normal" && samples.some(value => value !== 0)) paths.push({ points: tips, colour });
            const text = String(g[`${edge}_${kind}Label`] || "").trim();
            if (text) {
                const offset = face + size * (kind === "normal" ? 0.48 : 0.17);
                labels.push({ text, colour, point: world([normal[0] * offset, normal[1] * offset]) });
            }
        }
    }
    const origin = [-g.width / 2, -g.height / 2];
    for (const [dx, dy, text] of [[g.width + size * 0.65, 0, `x (0–${g.dimensionWidth || 1})`], [0, g.height + size * 0.65, `y (0–${g.dimensionHeight || 1})`]]) {
        const end = [origin[0] + dx, origin[1] + dy];
        const head = size * 0.055;
        const ux = dx ? 1 : 0, uy = dy ? 1 : 0;
        paths.push({ colour: "#6b7280", points: [origin, end,
            [end[0] - head * ux - head * uy / 2, end[1] - head * uy + head * ux / 2], end,
            [end[0] - head * ux + head * uy / 2, end[1] - head * uy - head * ux / 2]].map(world) });
        labels.push({ text, colour: "#6b7280", point: world([end[0] + size * 0.13 * ux, end[1] + size * 0.13 * uy]) });
    }
    labels.push({ text: "0", colour: "#6b7280", point: world([origin[0] - size * 0.08, origin[1] - size * 0.08]) });
    for (const [key, horizontal] of [["dimensionWidth", true], ["dimensionHeight", false]]) {
        if (!g[key]) continue;
        const offset = size * 0.16;
        const a = horizontal ? [-g.width / 2, -g.height / 2 - offset] : [-g.width / 2 - offset, -g.height / 2];
        const b = horizontal ? [g.width / 2, a[1]] : [a[0], g.height / 2];
        const tick = size * 0.025;
        paths.push({ colour: "#6b7280", points: [a, b].map(world) });
        for (const p of [a, b]) paths.push({ colour: "#6b7280", points: (horizontal
            ? [[p[0], p[1] - tick], [p[0], p[1] + tick]]
            : [[p[0] - tick, p[1]], [p[0] + tick, p[1]]]).map(world) });
        labels.push({ text: String(g[key]), colour: "#374151", point: world([(a[0] + b[0]) / 2 - (horizontal ? 0 : size * 0.10), (a[1] + b[1]) / 2 - (horizontal ? size * 0.10 : 0)]) });
    }
    return { paths, labels };
}
