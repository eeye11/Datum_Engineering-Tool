/* Endpoint picking for the authored Dimension tool. Snaps are screen-sized;
 * edge fractions follow later geometry edits, while empty canvas stays free. */
import measurement from "../../../shared/geometry/measurement-core.js";

export function dimensionEndpointAt(point, state) {
    const radius = 8 / (2.4 * (state.camera?.zoom || 1));
    let best = null;
    let bestDistance = radius;
    const objects = state.objects.filter(object => object.visible !== false &&
        !["dimension", "annotation", "annotate"].includes(object.type));
    for (const object of objects) {
        for (const anchor of measurement.anchorOptions(object) || []) {
            const at = measurement.resolveAnchor(object, anchor);
            if (!at) continue;
            const distance = Math.hypot(point.x - at.x, point.y - at.y);
            if (distance <= bestDistance) {
                bestDistance = distance;
                best = {featureId:object.id, anchor, kind:"between"};
            }
        }
    }
    if (best) return best;
    for (const object of objects) {
        const names = measurement.anchorOptions(object) || [];
        const spans = [];
        if (names.includes("start") && names.includes("end")) spans.push(["start", "end", null]);
        for (const name of names) {
            const match = /^segment(\d+)Start$/.exec(name);
            if (match) spans.push([name, `segment${match[1]}End`, match[1]]);
        }
        for (const [startName, endName, index] of spans) {
            const a = measurement.resolveAnchor(object, startName);
            const b = measurement.resolveAnchor(object, endName);
            if (!a || !b) continue;
            const dx = b.x - a.x, dy = b.y - a.y;
            const lengthSquared = dx * dx + dy * dy;
            if (!lengthSquared) continue;
            const t = Math.max(0, Math.min(1, ((point.x-a.x)*dx+(point.y-a.y)*dy)/lengthSquared));
            const distance = Math.hypot(point.x-a.x-t*dx, point.y-a.y-t*dy);
            if (distance <= bestDistance) {
                bestDistance = distance;
                best = {kind:"between", featureId:object.id,
                    anchor:index === null ? `pointOnEntity@${t}` : `edgePoint@${index}@${t}`};
            }
        }
    }
    return best || {kind:"canvas-point", point:{x:point.x,y:point.y}};
}

export function endpointPosition(ref, state) {
    return ref.kind === "canvas-point" ? ref.point : measurement.resolveAnchor(
        state.objects.find(object => object.id === ref.featureId), ref.anchor);
}

export function endpointDimensionType(first, second, state) {
    const a = endpointPosition(first, state), b = endpointPosition(second, state);
    const tolerance = 6 / (2.4 * (state.camera?.zoom || 1));
    if (Math.abs(a.y - b.y) <= tolerance) return "horizontal";
    if (Math.abs(a.x - b.x) <= tolerance) return "vertical";
    return "aligned";
}
