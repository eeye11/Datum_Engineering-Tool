// Bend is relative to segment length, so moving, rotating and scaling states
// preserves the shape without storing extra points that need transforming.
export function processBendPoint(geometry, index) {
    const a = geometry.points?.[index];
    const b = geometry.points?.[index + 1];
    if (!a || !b) return null;
    const bend = Number(geometry.segmentBends?.[index]) || 0;
    return {
        x: (a.x + b.x) / 2 - (b.y - a.y) * bend,
        y: (a.y + b.y) / 2 + (b.x - a.x) * bend
    };
}

export function setProcessBendFromPoint(geometry, index, point, straightTolerance = 0) {
    const a = geometry.points?.[index];
    const b = geometry.points?.[index + 1];
    if (!a || !b) return;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared < 1e-18) return;
    const bend = (-(point.x - (a.x + b.x) / 2) * dy + (point.y - (a.y + b.y) / 2) * dx) / lengthSquared;
    geometry.segmentBends ??= [];
    // Measure perpendicular distance so snapping works for every orientation.
    geometry.segmentBends[index] = Math.abs(bend) * Math.sqrt(lengthSquared) <= straightTolerance
        ? 0 : Math.max(-1, Math.min(1, bend));
}

export function processSegmentPoints(geometry, index) {
    const a = geometry.points?.[index];
    const b = geometry.points?.[index + 1];
    if (!a || !b) return [];
    const bend = Number(geometry.segmentBends?.[index]) || 0;
    if (!bend) return [a, b];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const control = {
        x: (a.x + b.x) / 2 - dy * bend * 2,
        y: (a.y + b.y) / 2 + dx * bend * 2
    };
    return Array.from({ length: 65 }, (_, step) => {
        const t = step / 64;
        const u = 1 - t;
        return {
            x: u * u * a.x + 2 * u * t * control.x + t * t * b.x,
            y: u * u * a.y + 2 * u * t * control.y + t * t * b.y
        };
    });
}

export function processPathPoints(geometry) {
    return (geometry.points || []).slice(1).flatMap((_, index) => {
        const points = processSegmentPoints(geometry, index);
        return index ? points.slice(1) : points;
    });
}
