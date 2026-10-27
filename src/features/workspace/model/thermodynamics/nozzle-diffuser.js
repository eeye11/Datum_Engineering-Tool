import { cylinderPoint } from "./piston-cylinder.js";

// Open inlet and outlet: only the two tapered walls are drawn.
export function nozzleDiffuserPaths(geometry) {
    return [[[0, 1], [1, 2 / 3]], [[0, 0], [1, 1 / 3]]]
        .map(path => path.map(([x, y]) => cylinderPoint(geometry, x, y)));
}
