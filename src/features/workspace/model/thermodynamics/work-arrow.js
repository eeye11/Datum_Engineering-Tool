export function workArrowPoints(geometry = {}) {
    const { start, end } = geometry;
    if (!start || !end) return [];
    const dx = end.x - start.x, dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-9) return [];
    const ux = dx / length, uy = dy / length;
    const halfWidth = Math.min(1.5, length * 0.045);
    const headLength = Math.min(length * 0.35, halfWidth * 3);
    const at = (along, across) => ({ x: start.x + ux * along - uy * across, y: start.y + uy * along + ux * across });
    return [at(0, halfWidth), at(length - headLength, halfWidth), at(length - headLength, halfWidth * 2),
        { ...end }, at(length - headLength, -halfWidth * 2), at(length - headLength, -halfWidth), at(0, -halfWidth)];
}
