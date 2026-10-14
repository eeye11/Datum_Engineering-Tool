export function processLabelPoint(geometry, index, scale) {
    const point = geometry.points[index];
    const offset = geometry.stateLabelOffsets?.[index];
    return { x: point.x + (offset?.dx ?? 13 / scale), y: point.y + (offset?.dy ?? 13 / scale) };
}
