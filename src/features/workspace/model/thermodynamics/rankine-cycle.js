import { cylinderPoint } from "./piston-cylinder.js";

// One resizable schematic; all paths and labels share its local frame.
export function rankineCycleDiagram(geometry) {
    const paths = [];
    const labels = [];
    const at = (x, y) => cylinderPoint(geometry, x, y);
    const path = (points, colour = "black") => paths.push({ points: points.map(([x, y]) => at(x, y)), colour });
    const label = (x, y, text, latex = text) => labels.push({ point: at(x, y), text, latex });
    const box = (x, y, w, h) => path([[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]);
    const circle = (x, y, radius) => path(Array.from({ length: 49 }, (_, i) => [x + radius * Math.cos(i * Math.PI / 24), y + radius * Math.sin(i * Math.PI / 24)]));
    const pipe = (vertices, colour, startBoundary = null, endBoundary = null) => {
        const centreline = [vertices[0]];
        for (let i = 1; i < vertices.length - 1; i++) {
            const previous = vertices[i - 1], corner = vertices[i], next = vertices[i + 1];
            const incoming = Math.hypot(corner[0] - previous[0], corner[1] - previous[1]);
            const outgoing = Math.hypot(next[0] - corner[0], next[1] - corner[1]);
            const radius = Math.min(0.045, incoming * 0.45, outgoing * 0.45);
            const entry = corner.map((value, axis) => value + (previous[axis] - value) * radius / incoming);
            const exit = corner.map((value, axis) => value + (next[axis] - value) * radius / outgoing);
            centreline.push(entry);
            for (let step = 1; step <= 20; step++) {
                const t = step / 20, s = 1 - t;
                centreline.push(entry.map((value, axis) => s * s * value + 2 * s * t * corner[axis] + t * t * exit[axis]));
            }
        }
        centreline.push(vertices[vertices.length - 1]);
        const wall = side => centreline.map((p, index) => {
            const before = centreline[Math.max(0, index - 1)];
            const after = centreline[Math.min(centreline.length - 1, index + 1)];
            const dx = after[0] - before[0], dy = after[1] - before[1];
            const length = Math.hypot(dx, dy);
            return [p[0] - side * dy / length * 0.009, p[1] + side * dx / length * 0.009];
        });
        // Meet each casing independently at each wall, including sloped faces.
        const attach = (points, first, boundary) => {
            if (!boundary) return;
            const index = first ? 0 : points.length - 1;
            const origin = points[first ? 1 : index - 1];
            const direction = points[index].map((value, axis) => value - origin[axis]);
            let nearest = Infinity;
            for (let i = 1; i < boundary.length; i++) {
                const a = boundary[i - 1], b = boundary[i];
                const edge = [b[0] - a[0], b[1] - a[1]];
                const cross = direction[0] * edge[1] - direction[1] * edge[0];
                if (Math.abs(cross) < 1e-12) continue;
                const delta = [a[0] - origin[0], a[1] - origin[1]];
                const t = (delta[0] * edge[1] - delta[1] * edge[0]) / cross;
                const u = (delta[0] * direction[1] - delta[1] * direction[0]) / cross;
                if (t >= 0 && u >= 0 && u <= 1) nearest = Math.min(nearest, t);
            }
            if (Number.isFinite(nearest)) points[index] = origin.map((value, axis) => value + direction[axis] * nearest);
        };
        for (const side of [1, -1]) {
            const points = wall(side);
            attach(points, true, startBoundary);
            attach(points, false, endBoundary);
            path(points, colour);
        }
    };
    const arrow = (x, y, dx, dy, colour = "blue") => {
        path([[x, y], [x + dx, y + dy]], colour);
        const length = Math.hypot(dx, dy);
        const ux = dx / length, uy = dy / length;
        path([[x + dx - ux * 0.018 - uy * 0.009, y + dy - uy * 0.018 + ux * 0.009], [x + dx, y + dy], [x + dx - ux * 0.018 + uy * 0.009, y + dy - uy * 0.018 - ux * 0.009]], colour);
    };

    // Smooth casing, a single hub and a side inlet, like the reference.
    const curve = (a, b, c, d) => Array.from({ length: 25 }, (_, i) => {
        const t = i / 24, s = 1 - t;
        return a.map((value, axis) => s ** 3 * value + 3 * s ** 2 * t * b[axis] + 3 * s * t ** 2 * c[axis] + t ** 3 * d[axis]);
    });
    const pumpCasing = [
        [0.165, 0.57], [0.195, 0.57], [0.195, 0.545],
        ...curve([0.195, 0.545], [0.27, 0.545], [0.27, 0.435], [0.195, 0.435]),
        ...curve([0.195, 0.435], [0.12, 0.435], [0.12, 0.545], [0.165, 0.545]),
        [0.165, 0.57]
    ];
    const turbineCasing = [[0.68, 0.56], [0.87, 0.64], [0.87, 0.36], [0.68, 0.44], [0.68, 0.56]];
    // Clockwise flow: pump -> boiler -> turbine -> condenser -> pump.
    pipe([[0.18, 0.57], [0.18, 0.84], [0.34, 0.84]], "blue", pumpCasing);
    pipe([[0.64, 0.84], [0.78, 0.84], [0.78, 0.60]], "red", null, turbineCasing);
    pipe([[0.78, 0.40], [0.78, 0.16], [0.64, 0.16]], "red", turbineCasing);
    pipe([[0.34, 0.16], [0.12, 0.16], [0.12, 0.49], [0.145, 0.49]], "blue", null, pumpCasing);
    box(0.34, 0.78, 0.30, 0.12);
    box(0.34, 0.10, 0.30, 0.12);
    path(pumpCasing);
    circle(0.195, 0.49, 0.018);
    path(turbineCasing);
    label(0.49, 0.84, "Boiler");
    label(0.49, 0.16, "Condenser");
    label(0.30, 0.49, "Pump");
    label(0.775, 0.50, "Turbine");
    for (const [x, y, number] of [[0.06, 0.29, "1"], [0.12, 0.69, "2"], [0.84, 0.69, "3"], [0.84, 0.25, "4"]]) {
        circle(x, y, 0.028);
        label(x, y, number);
    }
    arrow(0.17, 0.28, 0, 0.07);
    arrow(0.23, 0.65, 0, 0.07);
    arrow(0.73, 0.73, 0, -0.07);
    arrow(0.73, 0.27, 0, -0.07);
    arrow(0.49, 0.98, 0, -0.065, "red");
    arrow(0.49, 0.085, 0, -0.065, "red");
    arrow(0.025, 0.50, 0.065, 0, "red");
    arrow(0.89, 0.50, 0.065, 0, "red");
    label(0.45, 0.95, "qᵢₙ", "$q_{in}$");
    label(0.535, 0.05, "qₒᵤₜ", "$q_{out}$");
    label(0.065, 0.56, "w pump,in", "$w_{pump,in}$");
    label(0.92, 0.57, "w turb,out", "$w_{turb,out}$");
    return { paths, labels };
}
