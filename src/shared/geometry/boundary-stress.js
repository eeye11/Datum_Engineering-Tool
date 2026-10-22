export const BOUNDARY_EDGES = ["top", "right", "bottom", "left"];

export function boundaryStressDrawing(g) {
    const paths = [], labels = [];
    const size = Math.min(g.width, g.height);
    const angle = (Number(g.rotation) || 0) * Math.PI / 180;
    const c = Math.cos(angle), s = Math.sin(angle);
    const cx = g.position.x + g.width / 2, cy = g.position.y - g.height / 2;
    const world = ([x, y]) => ({ x: cx + x * c - y * s, y: cy + x * s + y * c });
    const values = BOUNDARY_EDGES.flatMap(edge => ["normal", "shear"].flatMap(kind =>
        [Number(g[`${edge}_${kind}Start`]) || 0, Number(g[`${edge}_${kind}End`]) || 0]));
    const maximum = Math.max(1e-9, ...values.map(Math.abs));
    for (const edge of BOUNDARY_EDGES) {
        const horizontal = edge === "top" || edge === "bottom";
        const sign = edge === "top" || edge === "right" ? 1 : -1;
        const tangent = horizontal ? [1, 0] : [0, 1];
        const normal = horizontal ? [0, sign] : [sign, 0];
        const span = horizontal ? g.width : g.height;
        const face = horizontal ? g.height / 2 : g.width / 2;
        for (const kind of ["normal", "shear"]) {
            const start = Number(g[`${edge}_${kind}Start`]) || 0;
            const end = Number(g[`${edge}_${kind}End`]) || 0;
            const colour = g[`${kind}Colour`] || (kind === "normal" ? "#db2777" : "#2563eb");
            const tips = [];
            for (let i = 0; i < 7; i++) {
                const t = i / 6;
                const factor = g[`${edge}_profile`] === "quadratic" ? t * t : t;
                const value = start + (end - start) * factor;
                const gap = kind === "normal" ? 0.09 : 0.025;
                const base = [tangent[0] * (t - 0.5) * span * 0.86 + normal[0] * (face + size * gap),
                    tangent[1] * (t - 0.5) * span * 0.86 + normal[1] * (face + size * gap)];
                if (Math.abs(value) < maximum * 1e-8) { tips.push(world(base)); continue; }
                const direction = kind === "normal" ? normal : tangent;
                const length = (kind === "normal" ? 0.32 : 0.12) * size * Math.abs(value) / maximum;
                let from = [...base], to;
                if (kind === "normal") {
                    to = [base[0] + direction[0] * length, base[1] + direction[1] * length];
                    tips.push(world(to));
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
            if (kind === "normal" && (start || end)) paths.push({ points: tips, colour });
            const text = String(g[`${edge}_${kind}Label`] || "").trim();
            if (text) {
                const offset = face + size * (kind === "normal" ? 0.48 : 0.17);
                labels.push({ text, colour, point: world([normal[0] * offset, normal[1] * offset]) });
            }
        }
    }
    return { paths, labels };
}
