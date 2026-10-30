import { cylinderPoint } from "./piston-cylinder.js";

export function isSaturationCurve(object) {
    return object?.metadata?.thermodynamicsKind === "saturation-curve";
}

export function isProcessDiagram(object) {
    return isSaturationCurve(object) || object?.metadata?.thermodynamicsKind === "process-plot";
}

export function processDiagramPaths(geometry, object) {
    if (isSaturationCurve(object)) return saturationPaths(geometry);
    // The visible axes follow the drawn bounds, so snapped corners put the
    // axis lines themselves on the grid rather than an invisible inset box.
    const point = (x, y) => cylinderPoint(geometry, x, y);
    return [
        [point(0, 1), point(0, 0), point(1, 0)],
        [point(-0.012, 0.975), point(0, 1), point(0.012, 0.975), point(-0.012, 0.975)],
        [point(0.975, -0.012), point(1, 0), point(0.975, 0.012), point(0.975, -0.012)]
    ];
}

// Schematic coordinates, not substance property data.
export function saturationPaths(geometry) {
    const point = (x, y) => cylinderPoint(geometry, x, y);
    const cubic = (a, b, c, d) => Array.from({ length: 33 }, (_, index) => {
        const t = index / 32;
        const u = 1 - t;
        return point(
            u ** 3 * a[0] + 3 * u ** 2 * t * b[0] + 3 * u * t ** 2 * c[0] + t ** 3 * d[0],
            u ** 3 * a[1] + 3 * u ** 2 * t * b[1] + 3 * u * t ** 2 * c[1] + t ** 3 * d[1]
        );
    });
    return [
        [point(0.08, 0.95), point(0.08, 0.08), point(0.95, 0.08)],
        [point(0.068, 0.925), point(0.08, 0.95), point(0.092, 0.925), point(0.068, 0.925)],
        [point(0.925, 0.068), point(0.95, 0.08), point(0.925, 0.092), point(0.925, 0.068)],
        [...cubic([0.2, 0.25], [0.28, 0.6], [0.32, 0.82], [0.45, 0.82]),
            ...cubic([0.45, 0.82], [0.59, 0.82], [0.72, 0.4], [0.9, 0.24]).slice(1)]
    ];
}
