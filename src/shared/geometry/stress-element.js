import geometry from "./feature-geometry.js";

export const STRESS_COLOURS = { normalStressX: "#dc2626", normalStressY: "#2563eb", shearStress: "#16a34a" };

export function stressAngleMark(g) {
    const degrees = ((Number(g.rotation) || 0) % 360 + 540) % 360 - 180;
    if (g.showAngle === false || Math.abs(degrees) < 1e-8) return null;
    const corners = geometry.rectangleCorners(g);
    const pivot = corners[3];
    const side = Math.min(g.width, g.height);
    const angle = degrees * Math.PI / 180;
    const at = (radius, radians) => ({ x: pivot.x + radius * Math.cos(radians), y: pivot.y + radius * Math.sin(radians) });
    const arc = Array.from({ length: 49 }, (_, i) => at(side * 1.1, angle * i / 48));
    return {
        reference: [pivot, at(side * 1.4, 0)],
        face: [corners[2], at(side * 1.4, angle)],
        perpendicular: [corners[0], at(side * 1.4, angle + Math.PI / 2)],
        axes: [
            { point: at(side * 1.5, 0), text: "x" },
            { point: at(side * 1.5, angle), text: "x′" },
            { point: at(side * 1.5, angle + Math.PI / 2), text: "y′" }
        ],
        arc,
        labelPoint: at(side * 1.27, angle / 2),
        text: `${Number(degrees.toFixed(1))}°`
    };
}

export function stressArrowPaths(g) {
    return stressArrows(g).map(arrow => arrow.points);
}

export function stressArrows(g) {
    const arrows = [];
    const add = (from, to, key) => {
        const direction = Number(g[key]) || 0;
        if (!direction) return;
        if (direction < 0) [from, to] = [to, from];
        const dx = to[0] - from[0], dy = to[1] - from[1];
        const length = Math.hypot(dx, dy);
        const ux = dx / length, uy = dy / length;
        let points;
        if (key === "shearStress") {
            // A half arrowhead points away from the face, keeping its shaft
            // close to the square and clear of the normal arrow's tail.
            const outward = (-uy * from[0] + ux * from[1]) >= 0 ? 1 : -1;
            points = [from, to, [to[0] - 0.065 * ux - 0.025 * uy * outward,
                to[1] - 0.065 * uy + 0.025 * ux * outward]];
        } else {
            points = [from, to, [to[0] - 0.065 * ux - 0.035 * uy, to[1] - 0.065 * uy + 0.035 * ux],
                to, [to[0] - 0.065 * ux + 0.035 * uy, to[1] - 0.065 * uy - 0.035 * ux]];
        }
        arrows.push({ key, colour: g[`${key}Colour`] || STRESS_COLOURS[key], points });
    };
    for (const sign of [-1, 1]) {
        add([sign * 0.55, 0], [sign * 0.87, 0], "normalStressX");
        add([0, sign * 0.55], [0, sign * 0.87], "normalStressY");
        add([sign * 0.525, -sign * 0.23], [sign * 0.525, sign * 0.23], "shearStress");
        add([-sign * 0.23, sign * 0.525], [sign * 0.23, sign * 0.525], "shearStress");
    }
    const angle = (Number(g.rotation) || 0) * Math.PI / 180;
    const c = Math.cos(angle), s = Math.sin(angle);
    const cx = g.position.x + g.width / 2, cy = g.position.y - g.height / 2;
    return arrows.map(arrow => ({ ...arrow, points: arrow.points.map(([x, y]) => ({
        x: cx + x * g.width * c - y * g.height * s,
        y: cy + x * g.width * s + y * g.height * c
    })) }));
}

export function resizeStressElement(original, cornerIndex, point) {
    const opposite = geometry.rectangleCorners(original)[(cornerIndex + 2) % 4];
    const radians = (Number(original.rotation) || 0) * Math.PI / 180;
    const c = Math.cos(radians);
    const s = Math.sin(radians);
    const dx = point.x - opposite.x;
    const dy = point.y - opposite.y;
    const localX = dx * c + dy * s;
    const localY = -dx * s + dy * c;
    const side = Math.max(Math.abs(localX), Math.abs(localY), 1e-6);
    const x = Math.sign(localX || 1) * side;
    const y = Math.sign(localY || 1) * side;
    const center = { x: opposite.x + (x * c - y * s) / 2, y: opposite.y + (x * s + y * c) / 2 };
    return {
        ...original,
        position: { x: center.x - side / 2, y: center.y + side / 2 },
        width: side,
        height: side
    };
}
