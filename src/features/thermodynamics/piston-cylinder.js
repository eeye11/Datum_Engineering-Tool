import enggFeatureGeometry from "../../core/geometry/feature-geometry.js";

export function isPistonCylinder(object) {
    return object?.metadata?.thermodynamicsKind === "piston-cylinder";
}

export function pistonFraction(geometry) {
    const value = Number(geometry.pistonFraction ?? 0.55);
    return Math.max(0.05, Math.min(0.95, Number.isFinite(value) ? value : 0.55));
}

// Local coordinates run from the cylinder's bottom left to its top right.
export function cylinderPoint(geometry, x, y) {
    const corners = enggFeatureGeometry.rectangleCorners(geometry);
    const bottom = corners[3];
    return {
        x: bottom.x + x * (corners[2].x - bottom.x) + y * (corners[0].x - bottom.x),
        y: bottom.y + x * (corners[2].y - bottom.y) + y * (corners[0].y - bottom.y)
    };
}

export function setPistonFromPoint(geometry, point) {
    const bottom = cylinderPoint(geometry, 0.5, 0);
    const top = cylinderPoint(geometry, 0.5, 1);
    const dx = top.x - bottom.x;
    const dy = top.y - bottom.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared <= 1e-18) return;
    geometry.pistonFraction = pistonFraction({
        pistonFraction: ((point.x - bottom.x) * dx + (point.y - bottom.y) * dy) / lengthSquared
    });
}
