// Ideal vapor-compression cycle, arranged like the equipment schematic:
// compressor on the right, expansion valve on the left.
export function appendVaporCompressionCycle({ pipe, path, box, stateCircle, label, arrow }, problemData = {}) {
    const compressor = [[0.66, 0.43], [0.78, 0.43], [0.745, 0.57], [0.695, 0.57], [0.66, 0.43]]
        .map(([x, y]) => [0.72 + (y - 0.50), 0.50 - (x - 0.72)]);
    const valve = [[0.215, 0.54], [0.265, 0.54], [0.215, 0.46], [0.265, 0.46], [0.215, 0.54]];
    pipe([[0.64, 0.24], [0.72, 0.24], [0.72, 0.43]], "blue", null, compressor);
    pipe([[0.72, 0.57], [0.72, 0.76], [0.64, 0.76]], "red", compressor);
    pipe([[0.36, 0.76], [0.24, 0.76], [0.24, 0.54]], "red", null, valve);
    pipe([[0.24, 0.46], [0.24, 0.24], [0.36, 0.24]], "blue", valve);
    box(0.36, 0.70, 0.28, 0.12);
    box(0.36, 0.18, 0.28, 0.12);
    path(compressor);
    path(valve);
    path([[0.24, 0.50], [0.195, 0.50]]);
    path([[0.195, 0.48], [0.195, 0.52]]);
    label(0.50, 0.76, "Condenser");
    label(0.50, 0.24, "Evaporator");
    label(0.85, 0.46, "Compressor");
    label(0.115, 0.52, "Expansion");
    label(0.115, 0.48, "valve");
    const cloud = (x, y, colour) => {
        // Broad, overlapping round lobes rather than a rippled ellipse.
        const lobes = [
            [[-0.55, -0.55], [-1, -0.55], [-1.1, 0.15], [-0.75, 0.30]],
            [[-0.75, 0.30], [-0.85, 0.9], [-0.3, 1.05], [-0.05, 0.70]],
            [[-0.05, 0.70], [0.2, 1.2], [0.7, 0.95], [0.72, 0.50]],
            [[0.72, 0.50], [1.2, 0.55], [1.2, -0.4], [0.8, -0.45]],
            [[0.8, -0.45], [0.65, -0.95], [0.18, -0.9], [0.02, -0.65]],
            [[0.02, -0.65], [-0.15, -0.95], [-0.6, -0.9], [-0.55, -0.55]]
        ];
        const points = lobes.flatMap(([a, b, c, d]) => Array.from({ length: 25 }, (_, index) => {
            const t = index / 24, s = 1 - t;
            const p = a.map((value, axis) => s ** 3 * value + 3 * s * s * t * b[axis] + 3 * s * t * t * c[axis] + t ** 3 * d[axis]);
            return [x + 0.18 * p[0], y + 0.06 * p[1]];
        }));
        points[points.length - 1] = points[0];
        path(points, colour);
    };
    cloud(0.50, 0.94, "red");
    cloud(0.50, 0.06, "blue");
    label(0.50, 0.953, "Warm");
    label(0.50, 0.927, "environment");
    label(0.50, 0.073, "Cold refrigerated");
    label(0.50, 0.047, "space");
    const states = [[0.80, 0.32], [0.80, 0.68], [0.16, 0.68], [0.16, 0.32]];
    states.forEach(([x, y], index) => {
        stateCircle(x, y);
        label(x, y, String(index + 1));
    });
    // Refrigerant: 1 -> 2 compression, 2 -> 3 heat rejection,
    // 3 -> 4 throttling, 4 -> 1 heat absorption.
    arrow(0.67, 0.29, 0, 0.07, "gray", 0.65);
    arrow(0.67, 0.64, 0, 0.07, "gray", 0.65);
    arrow(0.29, 0.71, 0, -0.07, "gray", 0.65);
    arrow(0.29, 0.36, 0, -0.07, "gray", 0.65);
    arrow(0.50, 0.835, 0, 0.05, "red");
    arrow(0.50, 0.125, 0, 0.04, "red");
    arrow(0.95, 0.52, -0.12, 0, "red");
    label(0.56, 0.86, "Q H", "$Q_H$");
    label(0.56, 0.145, "Q L", "$Q_L$");
    label(0.90, 0.57, "W in", "$W_{in}$");
    const annotate = (x, y, value, prefix = "") => {
        const lines = String(value || "").split(/[;\n]/).map(line => line.trim()).filter(Boolean);
        lines.forEach((line, index) => label(x, y - index * 0.032, prefix ? `${prefix}: ${line}` : line, line, true));
        return lines.length;
    };
    [[0.58, 0.34], [0.58, 0.68], [0.40, 0.68], [0.40, 0.34]].forEach(([x, y], index) => annotate(x, y, problemData[`state${index + 1}`]));
    let notesY = 0.60;
    for (const [key, title] of [["massFlow", "Mass flow"], ["compressor", "Compressor"], ["condenser", "Condenser"], ["expansionValve", "Expansion valve"], ["evaporator", "Evaporator"]]) {
        notesY -= annotate(0.49, notesY, problemData[key], title) * 0.032;
    }
}
