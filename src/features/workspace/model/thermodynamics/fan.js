// Side view of a shaft-driven impeller. Drag along the shaft from its
// exposed end to the blade assembly; all dimensions scale with the shaft.
export function fanPaths(geometry) {
    const { start, end } = geometry || {};
    if (!start || !end) return [];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    // Sample smooth curves once so preview, export and picking share the
    // same rounded blade outline at every orientation and scale.
    const blade = [[0.88, 0.07]];
    const curveTo = (control1, control2, endPoint) => {
        const from = blade[blade.length - 1];
        for (let step = 1; step <= 12; step++) {
            const t = step / 12;
            const u = 1 - t;
            blade.push([0, 1].map(axis =>
                u ** 3 * from[axis] + 3 * u ** 2 * t * control1[axis] +
                3 * u * t ** 2 * control2[axis] + t ** 3 * endPoint[axis]));
        }
    };
    curveTo([0.85, 0.18], [0.75, 0.42], [0.8, 0.48]);
    curveTo([0.85, 0.55], [0.95, 0.51], [0.97, 0.42]);
    curveTo([1, 0.29], [1.02, 0.13], [0.99, 0.07]);
    curveTo([0.97, 0.04], [0.9, 0.04], [0.88, 0.07]);
    const paths = [
        [[0, 0], [0.87, 0]],
        [[0.87, -0.07], [1, -0.07], [1, 0.07], [0.87, 0.07], [0.87, -0.07]],
        blade,
        blade.map(([along, across]) => [1.87 - along, -across])
    ];
    return paths.map(path => path.map(([along, across]) => ({
        x: start.x + dx * along - dy * across,
        y: start.y + dy * along + dx * across
    })));
}
