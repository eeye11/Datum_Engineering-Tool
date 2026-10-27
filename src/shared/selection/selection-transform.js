import geometry from "../geometry/feature-geometry.js";
import { resistorPoints } from "../../features/workspace/model/thermodynamics/resistor.js";
import { processPathPoints } from "../../features/workspace/model/thermodynamics/process-curves.js";
import { DYNAMICS_OWN_TYPES } from "../../features/workspace/dynamics/dynamics-hierarchy.js";
import enggPipeDuct from "../../features/workspace/model/fluids/pipe-duct.js";
import enggFlowArrow from "../../features/workspace/model/fluids/flow-arrow.js";
import enggReducer from "../../features/workspace/model/fluids/reducer-expander.js";
import enggEquipment from "../../features/workspace/model/fluids/inline-equipment.js";
import enggVessel from "../../features/workspace/model/fluids/reservoir-tank.js";
import enggFluidLevel from "../../features/workspace/model/fluids/fluid-level.js";
import enggFlowArrows from "../../features/workspace/model/fluids/flow-arrows.js";
import enggPressureProfile from "../../features/workspace/model/fluids/pressure-profile.js";
import enggSectionPlane from "../../features/workspace/model/fluids/section-plane.js";

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
            engineering.bendRadius,
            enggPipeDuct.elbowLegs(object)
        );

        const ends = enggPipeDuct.elbowEnds(object).map((end) => end.point);

        if (!curves) {
            return [
                ...(g.previous && g.next ? [g.previous, g.position, g.next] : [g.position]),
                ...ends
            ].filter(Boolean);
        }

        /*
         * THE BOX HOLDS BOTH WALL ARCS - the sampled points of each, plus the
         * fitting's own ends. Sampling the ARCS rather than expanding a bounding
         * circle keeps the box around the ink: a circle's corners can sit a long
         * way from the quarter of it actually drawn, which made a fitting look
         * selected along its whole square.
         */
        const half =
            Math.max(
                enggPipeDuct.boundarySeparation(engineering),
                Number(engineering.startSeparation) || 0,
                Number(engineering.endSeparation) || 0
            ) / 2;

        const sweep =
            ((curves.endAngle - curves.startAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;

        const steps = 12;

        const sampled = Array.from({ length: steps + 1 }, (_, index) => {
            const angle = curves.startAngle + (sweep * index) / steps;

            return [1, -1].map((side) => {
                const radius = curves.radius + side * half;

                return {
                    x: curves.centre.x + radius * Math.cos(angle),
                    y: curves.centre.y + radius * Math.sin(angle)
                };
            });
        }).flat();

        return [...sampled, ...ends].filter(
            (point) => point && Number.isFinite(point.x) && Number.isFinite(point.y)
        );
    }

    /*
     * A FLOW ARROW'S INK IS ITS SHAFT AND ITS HEAD.
     *
     * An arrow stores an anchor and a direction; its geometry's defining points
     * are a single anchor, which would draw a box with no extent. The shape the
     * canvas paints - the shaft's two ends and the head's three corners, from
     * the same `flowArrowShape` - is what the box fits. Selecting one arrow
     * therefore highlights that arrow along its whole length, not the pipe
     * under it and not a fragment of it.
     */
    if (object.type === "flow-arrow") {
        /*
         * A FREE ARROW IS ITS TWO ENDS; an attached one is its drawn shape.
         * The distinction is the ATTACHMENT, not the type - both are arrows.
         */
        if (!object.attachment && g.start && g.end) {
            return [g.start, g.end];
        }

        const shape = enggFlowArrow.flowArrowShape(object);

        return shape
            ? [shape.shaft.start, shape.shaft.end, shape.tip, shape.barbFirst, shape.barbSecond]
            : [];
    }

    /*
     * THE SCHEMATIC OBJECTS' INK.
     *
     * Each is measured from the SAME geometry its renderer draws - the taper's
     * four corners, a vessel's four corners, a symbol's own box - so the
     * selection box fits what is on the sheet rather than a stored anchor.
     */
    if (enggReducer.isReducerType(object.type)) {
        return enggReducer.outlineOf(object);
    }

    if (enggEquipment.isEquipmentType(object.type)) {
        const box = enggEquipment.equipmentBounds(object);

        return box
            ? [
                  { x: box.minX, y: box.minY },
                  { x: box.maxX, y: box.maxY }
              ]
            : [];
    }

    if (enggVessel.isVesselType(object.type)) {
        return enggVessel.vesselRect(object)?.corners || [];
    }

    if (enggFluidLevel.isFluidLevelType(object.type)) {
        const segment = enggFluidLevel.levelSegment(object);

        return segment ? [segment.start, segment.end] : [];
    }

    if (enggFlowArrows.isFlowDirectionType(object.type)) {
        return enggFlowArrows.directionArrowShapes(object).flatMap((shape) => [shape.start, shape.end]);
    }

    if (enggPressureProfile.isPressureProfileType(object.type)) {
        const frame = enggPressureProfile.profileFrame(object);

        return frame
            ? [
                  { x: frame.position.x, y: frame.position.y },
                  { x: frame.position.x + frame.width, y: frame.position.y + frame.height }
              ]
            : [];
    }

    if (enggSectionPlane.isSectionPlaneType(object.type)) {
        const span = enggSectionPlane.sectionSpan(object);

        if (!span) {
            return [];
        }

        return [span.start, span.end, ...enggSectionPlane.sectionArrows(object).flatMap((arrow) => [arrow.start, arrow.end])];
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
