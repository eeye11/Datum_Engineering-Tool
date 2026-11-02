/* Persist the arrow's attachment separately from the movable balloon. */
import measurement from "../../../../shared/geometry/measurement-core.js";
import { dimensionEndpointAt, endpointPosition } from "../../annotate/dimension-endpoints.js";

export function calloutReferenceAt(point, state, targetId = null) {
    if (!point) return null;
    const snapped = dimensionEndpointAt(point, state);
    if (snapped.featureId) return snapped;
    if (!targetId) {
        for (const object of [...state.objects].reverse()) {
            const circle=object.geometry;
            if (object.type === "circle" && object.visible !== false && circle.center && circle.radius > 0) {
                const radius=Math.hypot(point.x-circle.center.x,point.y-circle.center.y);
                if (Math.abs(radius-circle.radius) <= 8/(2.4*(state.camera?.zoom||1)))
                    return {kind:"circle-point",featureId:object.id,angle:Math.atan2(point.y-circle.center.y,point.x-circle.center.x)};
            }
            if (object.visible === false || !["rectangle", "rigid-body"].includes(object.type)) continue;
            const a=measurement.resolveAnchor(object,"topLeft"),b=measurement.resolveAnchor(object,"topRight"),c=measurement.resolveAnchor(object,"bottomLeft");
            if (!a || !b || !c) continue;
            const dx=b.x-a.x,dy=b.y-a.y,ex=c.x-a.x,ey=c.y-a.y;
            const det=dx*ey-dy*ex;
            if (Math.abs(det)<1e-9) continue;
            const u=((point.x-a.x)*ey-(point.y-a.y)*ex)/det;
            const v=(dx*(point.y-a.y)-dy*(point.x-a.x))/det;
            if (u>=0 && u<=1 && v>=0 && v<=1) return {kind:"rectangle-point",featureId:object.id,u,v};
        }
    }
    const target = state.objects.find(object => object.id === targetId);
    if (!target) return null;
    if (target.type === "circle" && target.geometry.center) return {kind:"circle-point",featureId:target.id,
        angle:Math.atan2(point.y-target.geometry.center.y,point.x-target.geometry.center.x)};
    const a = measurement.resolveAnchor(target,"topLeft");
    const b = measurement.resolveAnchor(target,"topRight");
    const c = measurement.resolveAnchor(target,"bottomLeft");
    if (a && b && c) {
        const dx=b.x-a.x,dy=b.y-a.y,ex=c.x-a.x,ey=c.y-a.y;
        const determinant=dx*ey-dy*ex;
        if (Math.abs(determinant)>1e-9) return {kind:"rectangle-point",featureId:target.id,
            u:((point.x-a.x)*ey-(point.y-a.y)*ex)/determinant,
            v:(dx*(point.y-a.y)-dy*(point.x-a.x))/determinant};
    }
    const anchors=(measurement.anchorOptions(target)||[]).map(anchor=>({anchor,point:measurement.resolveAnchor(target,anchor)})).filter(item=>item.point);
    anchors.sort((a,b)=>Math.hypot(a.point.x-point.x,a.point.y-point.y)-Math.hypot(b.point.x-point.x,b.point.y-point.y));
    const nearest=anchors[0];
    return nearest ? {kind:"feature-offset",featureId:target.id,anchor:nearest.anchor,
        offset:{x:point.x-nearest.point.x,y:point.y-nearest.point.y}} : null;
}
export function resolveCalloutReference(ref,state) {
    if (!ref) return null;
    const object=state.objects.find(item=>item.id===ref.featureId);
    if (!object) return null;
    if (ref.kind === "circle-point") {
        const g=object.geometry;
        return g.center && Number.isFinite(g.radius)
            ? {x:g.center.x+g.radius*Math.cos(ref.angle),y:g.center.y+g.radius*Math.sin(ref.angle)} : null;
    }
    if (ref.kind==="rectangle-point") {
        const a=measurement.resolveAnchor(object,"topLeft"),b=measurement.resolveAnchor(object,"topRight"),c=measurement.resolveAnchor(object,"bottomLeft");
        return a&&b&&c ? {x:a.x+ref.u*(b.x-a.x)+ref.v*(c.x-a.x),y:a.y+ref.u*(b.y-a.y)+ref.v*(c.y-a.y)} : null;
    }
    const at=endpointPosition(ref,state);
    return at ? {x:at.x+(ref.offset?.x||0),y:at.y+(ref.offset?.y||0)} : null;
}
export function refreshCalloutReferences(state) {
    for (const object of state.objects) {
        if (object.type!=="annotate" || object.annotateKind!=="callout") continue;
        if (object.geometry.end) object.geometry.position = {...object.geometry.end};
        if (!object.anchorRef && object.targetFeatureId && state.objects.some(item=>item.id===object.targetFeatureId)) object.anchorRef = calloutReferenceAt(object.geometry.start,state,object.targetFeatureId);
        if (!object.anchorRef) { object.referenceMissing=Boolean(object.targetFeatureId); continue; }
        const point=resolveCalloutReference(object.anchorRef,state);
        object.referenceMissing=!point;
        if (point) object.geometry.start={...point};
    }
}
