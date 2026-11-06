import { cylinderPoint } from "./piston-cylinder.js";

// Closed vessel with rounded heads, contained in the rectangle used for
// sizing, rotation and selection. Share its outline with the source writer.
export function tankPoints(geometry) {
    const points = [];
    for (const [cx, cy, angle] of [[0.8, 0.8, 0], [0.2, 0.8, 90], [0.2, 0.2, 180], [0.8, 0.2, 270]]) {
        for (let step = 0; step <= 12; step++) {
            const radians = (angle + step * 90 / 12) * Math.PI / 180;
            points.push(cylinderPoint(geometry, (geometry.hasValve ? 0.72 : 1) * (cx + 0.2 * Math.cos(radians)), cy + 0.2 * Math.sin(radians)));
        }
    }
    points.push(points[0]);
    return points;
}

export function tankPaths(geometry) {
    const paths = [tankPoints(geometry)];
    if (geometry.hasValve) {
        const local = [
            [[0.72, 0.5], [0.82, 0.5]],
            [[0.82, 0.43], [0.94, 0.57], [0.94, 0.43], [0.82, 0.57], [0.82, 0.43]],
            [[0.94, 0.5], [1, 0.5]],
            [[0.88, 0.5], [0.88, 0.68]],
            // Lever parallel to the outlet means open; perpendicular means closed.
            geometry.valveOpen
                ? [[0.8, 0.68], [0.98, 0.68]]
                : [[0.88, 0.59], [0.88, 0.77]]
        ];
        paths.push(...local.map(path => path.map(([x, y]) => cylinderPoint(geometry, x, y))));
    }
    return paths;
}
