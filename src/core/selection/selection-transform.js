import geometry from "../geometry/feature-geometry.js";
import { resistorPoints } from "../../features/thermodynamics/resistor.js";
import { processPathPoints } from "../../features/thermodynamics/process-curves.js";

export function selectionBounds(objects, selectedIds) {
    const ids = new Set(selectedIds);
    const points = objects.filter(object => ids.has(object.id)).flatMap(object => {
        const g = object.geometry || {};
        if (object.metadata?.thermodynamicsKind === "electric-work") return resistorPoints(g);
        if (["circle", "arc"].includes(object.type) && g.center) {
            return [{ x: g.center.x - g.radius, y: g.center.y - g.radius },
                { x: g.center.x + g.radius, y: g.center.y + g.radius }];
        }
        if (object.metadata?.thermodynamicsKind === "process-path") return processPathPoints(g);
        return [...geometry.definingPoints(g, object.type), ...(object.placement ? [object.placement] : [])];
    }).filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (!points.length) return null;
    return {
        minX: Math.min(...points.map(point => point.x)), maxX: Math.max(...points.map(point => point.x)),
        minY: Math.min(...points.map(point => point.y)), maxY: Math.max(...points.map(point => point.y))
    };
}

export function selectionCorners(box) {
    return [{ x: box.minX, y: box.maxY }, { x: box.maxX, y: box.maxY },
        { x: box.maxX, y: box.minY }, { x: box.minX, y: box.minY }];
}

export function selectionMembers(objects, selectedIds) {
    const ids = new Set(selectedIds);
    let count;
    do {
        count = ids.size;
        for (const object of objects) if (ids.has(object.parentId)) ids.add(object.id);
    } while (ids.size !== count);
    return objects.filter(object => ids.has(object.id));
}

const lengthKeys = new Set(["width", "height", "radius", "length", "depth", "xPositiveLength", "xNegativeLength", "yPositiveLength", "yNegativeLength"]);

// Apply one uniform transform to the original snapshot on every frame.
// Fractions (piston and stopper positions), angles and engineering values stay intact.
export function transformSelectionObject(original, anchor, scale = 1, dx = 0, dy = 0) {
    const object = structuredClone(original);
    const transform = value => {
        if (!value || typeof value !== "object") return;
        if (Number.isFinite(value.x) && Number.isFinite(value.y)) {
            value.x = anchor.x + (value.x - anchor.x) * scale + dx;
            value.y = anchor.y + (value.y - anchor.y) * scale + dy;
        }
        for (const [key, child] of Object.entries(value)) {
            if (lengthKeys.has(key) && Number.isFinite(child)) value[key] = child * scale;
            else if (child && typeof child === "object") transform(child);
        }
    };
    transform(object.geometry);
    transform(object.placement);
    return object;
}
