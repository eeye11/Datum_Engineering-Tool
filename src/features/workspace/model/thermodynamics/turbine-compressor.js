import { cylinderPoint } from "./piston-cylinder.js";

// Side-view casing: full-height inlet, centred narrow outlet.
export function turbineCompressorPoints(geometry) {
    return [[0, 1], [1, 2 / 3], [1, 1 / 3], [0, 0], [0, 1]]
        .map(([x, y]) => cylinderPoint(geometry, x, y));
}
