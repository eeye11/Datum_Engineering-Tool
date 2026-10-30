/* Angle annotations reference actual straight edges, never the pointer's slope. */
import model from "../../../shared/model/drawing-state.js";
import measurement from "../../../shared/geometry/measurement-core.js";
import dimensions from "../model/dimensions/dimension-model.js";
import { dimensionReferenceForFeature, referenceSpan } from "./dimension-inference.js";
import { distanceToSegment } from "../interaction/hit-testing.js";
import { drawingState as state } from "../editor-state.js";
import { commitDimension } from "./dimension-tool.js";
import { renderCurrentDrawing } from "../../../components/layout/workspace/canvas-render.js";
import { setToolMessage } from "../../../components/layout/toolbar/toolbar-render.js";

export function angleLineAt(point, drawing = state) {
    let best = null, distance = 8 / (model.BASE_PIXELS_PER_UNIT * (drawing.camera?.zoom || 1));
    for (const object of drawing.objects) {
        if (object.visible === false || ["dimension", "annotation", "annotate"].includes(object.type)) continue;
        const primary = dimensionReferenceForFeature(object, point);
        const names = measurement.anchorOptions(object) || [];
        const candidates = primary?.kind === "line" ? [primary] : names
            .filter(anchor => /^segment\d+Start$/.test(anchor))
            .map(anchor => ({kind:"line",object,featureId:object.id,anchor,endAnchor:anchor.replace(/Start$/,"End")}));
        if (object.type === "polygon") {
            const vertices=names.filter(anchor=>/^vertex\d+$/.test(anchor));
            vertices.forEach((anchor,i)=>candidates.push({kind:"line",object,featureId:object.id,anchor,endAnchor:vertices[(i+1)%vertices.length]}));
        }
        for (const ref of candidates) {
            const span = referenceSpan(ref);
            if (!span || Math.hypot(span.end.x-span.start.x,span.end.y-span.start.y)<1e-9) continue;
            const gap = distanceToSegment(point, span.start, span.end);
            if (gap <= distance) { distance=gap; best=ref; }
        }
    }
    return best;
}
const persistent = ref => ({kind:"between",featureId:ref.featureId,anchor:ref.anchor||"start",
    ...(ref.endAnchor ? {endAnchor:ref.endAnchor} : {})});

export function handleAngleClick(point) {
    if (!point) return;
    const interaction = state.interaction;
    if (interaction.dimensionStage === "placement") {
        const probe={type:"dimension",dimensionType:"angular",sourceRefs:interaction.dimensionRefs,placement:point};
        const label=dimensions.formatMeasurement(probe,state);
        commitDimension("angular",interaction.dimensionRefs,point,label||"");
        return;
    }
    const ref=angleLineAt(point);
    if (!ref) { setToolMessage("Pick a straight line or shape edge for the angle"); return; }
    const first=interaction.dimensionFirstRef;
    if (!first) {
        model.setInteraction(state,{dimensionStage:"first",dimensionFirstRef:persistent(ref)});
        setToolMessage("Pick the second line or edge");
    } else {
        const prior=state.objects.find(object=>object.id===first.featureId);
        const a=referenceSpan({...first,object:prior}),b=referenceSpan(ref);
        const dx=a?.end.x-a?.start.x,dy=a?.end.y-a?.start.y;
        const ex=b.end.x-b.start.x,ey=b.end.y-b.start.y;
        if (!a || Math.abs(dx*ey-dy*ex)/Math.hypot(dx,dy)/Math.hypot(ex,ey)<1e-10) {
            setToolMessage("Choose a different, non-parallel edge"); return;
        }
        model.setInteraction(state,{dimensionStage:"placement",dimensionChoice:"angular",
            dimensionRefs:[first,persistent(ref)],dimensionPlacement:{...point}});
        setToolMessage("Move into the angle you want to mark; click to place and label it");
    }
    renderCurrentDrawing();
}
