import geometry from "../geometry/feature-geometry.js";
import { resistorPoints } from "../../features/workspace/model/thermodynamics/resistor.js";
import { processPathPoints } from "../../features/workspace/model/thermodynamics/process-curves.js";
import { DYNAMICS_OWN_TYPES } from "../../features/workspace/dynamics/dynamics-hierarchy.js";
import annotations from "../../features/workspace/model/annotations/annotation-model.js";

export function selectionBounds(objects, selectedIds, state = null) {
    const ids = new Set(selectedIds);
    const points = objects.filter(object => ids.has(object.id)).flatMap(object => {
        const g = object.geometry || {};
        if (object.type === "truss" && g.members?.length) {
            return g.members.flatMap(member => [member.start, member.end]).filter(Boolean);
        }
        if (object.metadata?.thermodynamicsKind === "electric-work") return resistorPoints(g);
        if (["circle", "arc"].includes(object.type) && g.center) {
            return [{ x: g.center.x - g.radius, y: g.center.y - g.radius },
                { x: g.center.x + g.radius, y: g.center.y + g.radius }];
        }
        if (object.metadata?.thermodynamicsKind === "process-path") return processPathPoints(g);
        if (DYNAMICS_OWN_TYPES.has(object.type)) {
            return [g.start, g.end, g.center, g.position].filter(Boolean)
                .concat(
                    g.center && Number.isFinite(Number(g.radius))
                        ? [
                              { x: g.center.x - Number(g.radius), y: g.center.y - Number(g.radius) },
                              { x: g.center.x + Number(g.radius), y: g.center.y + Number(g.radius) }
                          ]
                        : []
                );
        }
        return [...geometry.definingPoints(g, object.type), ...(object.placement ? [object.placement] : [])];
    }).filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (state) {
        for (const object of objects.filter(object => ids.has(object.id))) {
            for (const annotation of annotations.derivedAnnotations(object, state)) {
                const box = annotations.annotationTextBounds(annotation, state);
                if (box) points.push({ x: box.minX, y: box.minY }, { x: box.maxX, y: box.maxY });
            }
        }
    }
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
            if (["magnitudeOffset", "pointOffsets", "supportValueOffsets"].includes(key) && child) {
                // Label offsets are vectors relative to their moving anchors.
                const scaleOffset = offset => {
                    if (!offset || typeof offset !== "object") return;
                    for (const [axis, component] of Object.entries(offset)) {
                        if ((axis === "x" || axis === "y") && Number.isFinite(component)) offset[axis] *= scale;
                        else if (component && typeof component === "object") scaleOffset(component);
                    }
                };
                scaleOffset(child);
            }
            else if (lengthKeys.has(key) && Number.isFinite(child)) value[key] = child * scale;
            else if (child && typeof child === "object") transform(child);
        }
    };
    transform(object.geometry);
    transform(object.placement);
    return object;
}
