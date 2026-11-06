// A diagonal gesture sizes the heater's envelope. Keep the terminals aligned
// on the entry wall and store depth as a ratio so scaling also scales the leads.
export function resistorGeometryFromDrag(start, cursor) {
    const dx = cursor.x - start.x;
    const dy = cursor.y - start.y;
    const height = Math.max(Math.abs(dy), Math.abs(dx) * 0.25);
    if (!height) return { start: { ...start }, end: { ...start } };
    const span = dy > 0 ? height : -height;
    const depth = Math.max(Math.abs(dx), height * 0.25) * (dx < 0 ? -1 : 1);
    return {
        start: { ...start },
        end: { x: start.x, y: start.y + span },
        resistorReach: -depth / span
    };
}

export function resistorPoints(geometry) {
    const { start, end } = geometry || {};
    if (!start || !end) return [];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    // Start and end are the two exposed terminals. The leads extend to
    // the same side, with a short resistor between them, like an immersion
    // heater entering a container through its wall.
    const reach = Number.isFinite(geometry.resistorReach) ? geometry.resistorReach : 0.65;
    const points = [[0, 0], [0, reach], [0.3, reach]];
    for (let index = 0; index < 6; index++) {
        points.push([0.35 + index * 0.06, reach + (index % 2 ? -0.055 : 0.055)]);
    }
    points.push([0.7, reach], [1, reach], [1, 0]);
    return points.map(([along, across]) => ({
        x: start.x + dx * along - dy * across,
        y: start.y + dy * along + dx * across
    }));
}
