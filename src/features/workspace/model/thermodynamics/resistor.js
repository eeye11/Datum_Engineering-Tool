export function resistorPoints(geometry) {
    const { start, end } = geometry || {};
    if (!start || !end) return [];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    // Start and end are the two exposed terminals. The leads extend to
    // the same side, with a short resistor between them, like an immersion
    // heater entering a container through its wall.
    const reach = 0.65;
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
