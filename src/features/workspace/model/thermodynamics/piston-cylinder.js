import enggFeatureGeometry from "../../../../shared/geometry/feature-geometry.js";

export function isPistonCylinder(object) {
    return object?.metadata?.thermodynamicsKind === "piston-cylinder";
}

export function pistonFraction(geometry) {
    const value = Number(geometry.pistonFraction ?? 0.55);
    const limit = geometry.hasStoppers ? stopperFraction(geometry) : 0.95;
    return Math.max(0.05, Math.min(limit, Number.isFinite(value) ? value : 0.55));
}

export function stopperFraction(geometry) {
    const value = Number(geometry.stopperFraction ?? 0.8);
    return Math.max(0.05, Math.min(0.95, Number.isFinite(value) ? value : 0.8));
}

export function setStopperFraction(geometry, value) {
    geometry.stopperFraction = stopperFraction({ stopperFraction: value });
    geometry.pistonFraction = pistonFraction(geometry);
}

export function stopperPaths(geometry) {
    if (!geometry.hasStoppers) return [];
    const height = stopperFraction(geometry);
    const top = Math.min(1, height + 0.04);
    return [
        [[0, height], [0.18, height], [0.18, top], [0, top], [0, height]],
        [[1, height], [0.82, height], [0.82, top], [1, top], [1, height]]
    ];
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
    geometry.pistonFraction = pistonFraction({ ...geometry, pistonFraction: fractionFromPoint(geometry, point) });
}

export function setStoppersFromPoint(geometry, point) {
    setStopperFraction(geometry, fractionFromPoint(geometry, point));
}

function fractionFromPoint(geometry, point) {
    const bottom = cylinderPoint(geometry, 0.5, 0);
    const top = cylinderPoint(geometry, 0.5, 1);
    const dx = top.x - bottom.x;
    const dy = top.y - bottom.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared <= 1e-18) return pistonFraction(geometry);
    return ((point.x - bottom.x) * dx + (point.y - bottom.y) * dy) / lengthSquared;
}
