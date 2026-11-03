import dimensions from "./dimension-model.js";
import measurement from "../../../../shared/geometry/measurement-core.js";

const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-7;
const closeValue = (a, b) => Number.isFinite(a) && Math.abs(a - b) < 1e-5 * Math.max(1, b);

function movablePoint(object, point) {
    const g = object.geometry;
    return [g.start, g.end, g.position, ...(g.points || [])]
        .find(candidate => candidate && near(candidate, point));
}

function changeGeometry(dimension, state, value) {
    const refs = dimension.sourceRefs || [];
    const objects = refs.map(ref => state.objects.find(object => object.id === ref.featureId));
    if (objects.some(object => !object) || !objects.length) return "A geometry reference is missing.";
    const target = objects.at(-1);
    if (target.locked || target.parentId) return "The target geometry is locked or attached to another feature.";
    const g = target.geometry;
    const type = dimension.dimensionType;
    const measured = dimensions.measurementFor(dimension, state)?.value;
    if (!Number.isFinite(measured)) return "The geometry references cannot be resolved.";

    if (["radius", "diameter"].includes(type) && Number.isFinite(g.radius)) {
        g.radius = type === "diameter" ? value / 2 : value;
        return null;
    }

    if (type === "angular" && refs.length === 2) {
        const spans = refs.map((ref, i) => ({
            a: measurement.resolveAnchor(objects[i], ref.anchor || "start"),
            b: measurement.resolveAnchor(objects[i], ref.endAnchor || "end")
        }));
        if (spans.some(span => !span.a || !span.b)) return "These angle references cannot drive geometry.";
        const pivot = [spans[0].a, spans[0].b].find(point => near(point, spans[1].a) || near(point, spans[1].b));
        if (!pivot) return "Driving angles currently require edges sharing a vertex.";
        const first = near(pivot, spans[0].a) ? spans[0].b : spans[0].a;
        const second = near(pivot, spans[1].a) ? spans[1].b : spans[1].a;
        const point = movablePoint(target, second);
        if (!point) return "This edge cannot be rotated independently.";
        const radius = Math.hypot(second.x - pivot.x, second.y - pivot.y);
        const base = Math.atan2(first.y - pivot.y, first.x - pivot.x);
        const original = { ...point };
        const angles = [value, -value, 180 - value, 180 + value].map(angle => base + angle * Math.PI / 180);
        const candidates = angles.map(angle => ({x: pivot.x + radius * Math.cos(angle), y: pivot.y + radius * Math.sin(angle)}))
            .sort((a, b) => Math.hypot(a.x-original.x,a.y-original.y)-Math.hypot(b.x-original.x,b.y-original.y));
        for (const candidate of candidates) {
            Object.assign(point, candidate);
            if (closeValue(dimensions.measurementFor(dimension, state)?.value, value)) return null;
        }
        return "That angle cannot be applied to these references.";
    }

    if (!["linear", "aligned", "coordinate", "horizontal", "vertical"].includes(type)) {
        return "This measurement supports Driven mode only.";
    }
    const points = dimensions.measurePoints(dimension, state);
    if (!points || points.length < 2 || measured <= 1e-9) return "A non-zero measurable span is required.";
    const [a, b] = points;
    const ratio = value / measured;
    if (target.type === "rectangle" && objects.every(object => object.id === target.id)) {
        const angle = (Number(g.rotation) || 0) * Math.PI / 180;
        const dx = (b.x-a.x)*Math.cos(angle)+(b.y-a.y)*Math.sin(angle);
        const dy = -(b.x-a.x)*Math.sin(angle)+(b.y-a.y)*Math.cos(angle);
        const key = Math.abs(dx) >= Math.abs(dy) ? "width" : "height";
        const before = measurement.resolveAnchor(target, refs[0].anchor);
        g[key] *= ratio;
        const after = measurement.resolveAnchor(target, refs[0].anchor);
        if (before && after) { g.position.x += before.x-after.x; g.position.y += before.y-after.y; }
        return null;
    }
    const point = movablePoint(target, b);
    if (!point) return "This anchor cannot drive geometry. Use a vertex or endpoint reference.";
    if (type === "horizontal") point.x = a.x + (b.x-a.x)*ratio;
    else if (type === "vertical") point.y = a.y + (b.y-a.y)*ratio;
    else { point.x = a.x+(b.x-a.x)*ratio; point.y = a.y+(b.y-a.y)*ratio; }
    return null;
}

// Work on a detached proposal. Failed/unsupported/conflicting edits never
// partially resize the real drawing or damage another driving dimension.
export function applyDrivingValue(dimension, state, input) {
    const value = Number(input);
    if (!Number.isFinite(value) || value <= 0 || (dimension.dimensionType === "angular" && value >= 180)) {
        return { ok: false, error: "Enter a positive length, or an angle between 0 and 180 degrees." };
    }
    const proposed = { ...state, objects: structuredClone(state.objects) };
    const copy = structuredClone(dimension);
    const error = changeGeometry(copy, proposed, value);
    if (error) return { ok: false, error };
    if (!closeValue(dimensions.measurementFor(copy, proposed)?.value, value)) {
        return { ok: false, error: "These references cannot drive the requested value." };
    }
    for (const other of proposed.objects) {
        if (other.type !== "dimension" || other.id === dimension.id || other.mode !== "driving") continue;
        if (!closeValue(dimensions.measurementFor(other, proposed)?.value, other.drivingValue)) {
            return { ok: false, error: "This change conflicts with another driving dimension." };
        }
    }
    for (const ref of dimension.sourceRefs) {
        const live = state.objects.find(object => object.id === ref.featureId);
        const changed = proposed.objects.find(object => object.id === ref.featureId);
        if (live && changed) live.geometry = changed.geometry;
    }
    dimension.mode = "driving";
    dimension.drivingValue = value;
    dimension.label = null;
    delete dimension.dimensionError;
    return { ok: true };
}

export function referenceSummary(dimension, state) {
    return (dimension.sourceRefs || []).map(ref => {
        if (ref.kind === "canvas-point") return `Canvas point (${ref.point.x.toFixed(2)}, ${ref.point.y.toFixed(2)})`;
        const object = state.objects.find(item => item.id === ref.featureId);
        return `${object?.name || ref.featureId}${object ? "" : " (missing)"}: ${ref.property || ref.anchor}${ref.endAnchor ? ` → ${ref.endAnchor}` : ""}`;
    }).join("; ");
}

// A driving dimension remains a constraint after a later geometry edit. Whole
// object translations preserve its measurement and need no intervention.
export function maintainDrivingDimensions(state, previousObjects = []) {
    for (const dimension of state.objects) {
        if (dimension.type !== "dimension" || dimension.mode !== "driving" || dimension.dimensionKind === "variable") continue;
        const current = dimensions.measurementFor(dimension, state)?.value;
        if (!Number.isFinite(current)) continue; // Deleted references stay explicitly unresolved.
        if (closeValue(current, dimension.drivingValue)) continue;
        const result = applyDrivingValue(dimension, state, dimension.drivingValue);
        if (!result.ok) {
            for (const ref of dimension.sourceRefs || []) {
                const object = state.objects.find(item => item.id === ref.featureId);
                const previous = previousObjects.find(item => item.id === ref.featureId);
                if (object && previous) object.geometry = structuredClone(previous.geometry);
            }
            dimension.dimensionError = result.error;
        }
    }
}
