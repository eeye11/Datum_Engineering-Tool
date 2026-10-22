import geometry from "../geometry/feature-geometry.js";
import { resistorPoints } from "../../features/workspace/model/thermodynamics/resistor.js";
import { processPathPoints } from "../../features/workspace/model/thermodynamics/process-curves.js";
import { DYNAMICS_OWN_TYPES } from "../../features/workspace/dynamics/dynamics-hierarchy.js";
import enggPipeDuct from "../../features/workspace/model/fluids/pipe-duct.js";

/*
 * ========================================================
 * THE HIGHLIGHT BOX MEASURES WHAT IS DRAWN
 * ========================================================
 *
 * A box around the selected features has to fit THEIR INK, and no other
 * feature's. For most shapes the defining points are the ink - the ends of a
 * line, the corners of a rectangle.
 *
 * A PIPE / DUCT IS NOT. Its authoritative geometry is a CENTRELINE, and the two
 * walls that are drawn sit half a spacing either side of it. Measured from the
 * centreline, a horizontal pipe's box would be a flat line with no height at
 * all - drawn ON the pipe rather than around it - so the walls are written out
 * here as the points the box must contain. The elbow is the same problem round
 * a different curve: its arcs are outside the corner, so the corner and the
 * two adjoining ends are not enough.
 *
 * Only the SELECTED objects' geometry is read, so unselected features can never
 * stretch or shift the box.
 */
function flowPathPoints(object) {
    const g = object.geometry || {};

    if (object.type === "pipe-duct") {
        const centreline = enggPipeDuct.trimmedCentreline(object) || g;

        if (!centreline?.start || !centreline?.end) {
            return [];
        }

        return enggPipeDuct
            .boundaryLines(centreline.start, centreline.end, object.engineering || {})
            .flatMap((wall) => [wall.start, wall.end]);
    }

    if (object.type === "elbow") {
        const engineering = object.engineering || {};
        const curves = enggPipeDuct.elbowGeometry(
            g.previous,
            g.position,
            g.next,
            engineering.bendRadius
        );

        if (!curves) {
            return [g.previous, g.position, g.next].filter(Boolean);
        }

        /*
         * Both wall arcs, sampled at the corners of their sweep - centre and
         * radius are enough to state the extent, and the two ends pin it to
         * the runs the fitting joins.
         */
        const half =
            Math.max(
                enggPipeDuct.boundarySeparation(engineering),
                Number(engineering.startSeparation) || 0,
                Number(engineering.endSeparation) || 0
            ) / 2;

        const outer = curves.radius + half;

        return [
            curves.start,
            curves.end,
            { x: curves.centre.x - outer, y: curves.centre.y - outer },
            { x: curves.centre.x + outer, y: curves.centre.y + outer }
        ].filter((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y));
    }

    return null;
}

export function selectionBounds(objects, selectedIds) {
    const ids = new Set(selectedIds);
    const points = objects.filter(object => ids.has(object.id)).flatMap(object => {
        const g = object.geometry || {};
        const ink = flowPathPoints(object);
        if (ink) return ink;
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
