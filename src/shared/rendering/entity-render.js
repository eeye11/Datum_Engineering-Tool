/*
 * Drawing one feature: the per-type dispatch that turns a stored feature
 * into SVG.
 *
 * Part of the renderer (see renderer.js), split out by concern.
 */
import enggDrawingState from "../model/drawing-state.js";
import { isConnectionType, isSupportType } from "../model/feature-types.js";
import { createSvgElement } from "./svg-primitives.js";
import { drawVectorOrSymbol, drawGenericConnection } from "./entities/draw-forces-and-supports.js";
import { drawMoment, drawUniformLoad, drawVaryingLoad } from "./entities/draw-loads.js";
import { drawDimension, drawAnnotate, drawAnnotation } from "./entities/draw-annotations.js";
import { drawMemberOrDiagram } from "./entities/draw-members.js";
import { drawPoint, drawLine, drawCircle, drawRectangleOutline, drawPolyline, drawPolygon, drawTriangle, drawArc, drawCoordinateSystem2d } from "./entities/draw-geometry.js";
import { drawParticle, drawRigidBody } from "./entities/draw-bodies.js";
import drawDynamicsSymbol from "./entities/draw-dynamics.js";
import { drawPistonCylinder, drawProcessOverlay, drawSaturationCurve } from "./entities/draw-thermodynamics.js";
import { drawElbow, drawPipeDuct } from "./entities/draw-fluids.js";
import { isProcessDiagram } from "../../features/workspace/model/thermodynamics/saturation-curve.js";
import { isPistonCylinder } from "../../features/workspace/model/thermodynamics/piston-cylinder.js";


    /*
     * ========================================================
     * WHICH FUNCTION DRAWS WHICH FEATURE
     * ========================================================
     *
     * Tried IN ORDER for every feature. A renderer runs when its test matches,
     * and returning true ends the feature; otherwise the next one is tried -
     * which is how a rigid body is outlined as a rectangle and then drawn as a
     * body. A new feature type adds its renderer to this table.
     */
    const ENTITY_RENDERERS = [
        /*
         * THE DYNAMICS SYMBOLS DRAW THEMSELVES.
         *
         * A spring, a damper, a vector, a trajectory or a pulley stores its own
         * geometry and is not any of the generic feature kinds below - without
         * this entry they matched nothing, so the tools created objects that
         * were listed in Objects and drew no ink anywhere. A symbol whose
         * renderer declines (the reference line, point and arc, which are
         * ordinary construction features wearing a Dynamics label) falls
         * through to the shared renderers below, which draw it as ever.
         */
        { matches: entity => Boolean(entity?.engineering?.dynamicsType), draw: drawDynamicsSymbol },
        /*
         * A resultant and a component analysis are vectors too, so they share
         * this pass rather than getting a symbol of their own. What says which
         * is which is the annotation beside them.
         */
        { matches: entity => entity.type === "force" || entity.type === "resultant" || entity.type === "force-components" || isSupportType(entity.type) || isConnectionType(entity.type), draw: drawVectorOrSymbol },
        { matches: entity => entity.type === "moment", draw: drawMoment },
        { matches: entity => entity.type === "dimension", draw: drawDimension },
        { matches: entity => entity.type === "annotate", draw: drawAnnotate },
        { matches: entity => entity.type === "annotation", draw: drawAnnotation },
        { matches: entity => entity.type === "beam" || entity.type === "truss" || entity.type === "cable" || entity.type === "shaft" || entity.type === "analysis-diagram", draw: drawMemberOrDiagram },
        { matches: entity => entity.type === "load", draw: drawUniformLoad },
        { matches: entity => entity.type === "varying-load", draw: drawVaryingLoad },
        { matches: entity => entity.type === "connection", draw: drawGenericConnection },
        { matches: entity => entity.type === "point", draw: drawPoint },
        { matches: entity => entity.type === "line", draw: drawLine },
        { matches: entity => entity.type === "circle", draw: drawCircle },
        { matches: entity => entity.type === "particle", draw: drawParticle },
        /*
         * THERMODYNAMICS. A process path's states are an overlay, appended last;
         * a saturation curve and a piston-cylinder are rectangles in storage, so
         * they are drawn here and the plain rectangle outline below skips them.
         */
        { matches: entity => entity.metadata?.thermodynamicsKind === "process-path", draw: drawProcessOverlay },
        { matches: entity => isProcessDiagram(entity), draw: drawSaturationCurve },
        { matches: entity => isPistonCylinder(entity), draw: drawPistonCylinder },
        { matches: entity => entity.type === "rectangle" && !isPistonCylinder(entity) && !isProcessDiagram(entity), draw: drawRectangleOutline },
        { matches: entity => entity.type === "rigid-body", draw: drawRigidBody },
        { matches: entity => entity.type === "polyline", draw: drawPolyline },
        { matches: entity => entity.type === "polygon", draw: drawPolygon },
        { matches: entity => entity.type === "freeform-polygon", draw: drawTriangle },
        { matches: entity => entity.type === "triangle", draw: drawTriangle },
        { matches: entity => entity.type === "arc", draw: drawArc },
        { matches: entity => entity.type === "coordinate-system-2d", draw: drawCoordinateSystem2d },
        { matches: entity => entity.type === "pipe-duct", draw: drawPipeDuct },
        { matches: entity => entity.type === "elbow", draw: drawElbow }
    ];


    function appendEntity(
        svg,
        entity,
        state,
        bounds
    ) {
        const parentSvg = svg;
        svg = createSvgElement("g");
        svg.classList.add("drawing-feature");
        if (state.selection?.selectedObjectIds?.includes(entity.id)) {
            svg.classList.add("drawing-entity-selected");
        }
        if (state.selection?.hoveredObjectId === entity.id) {
            svg.classList.add("drawing-entity-hovered");
        }
        svg.dataset.featureId = entity.id;

        const scale =
            enggDrawingState
                .BASE_PIXELS_PER_UNIT *
            state.camera.zoom;

        const geometry =
            entity.geometry || {};

        const style =
            entity.style || {};

        const toScreen =
            point =>
                enggDrawingState
                    .engineeringToScreen(
                        point,
                        bounds,
                        state
                    );

        const context = {
            svg,
            parentSvg,
            entity,
            state,
            bounds,
            scale,
            geometry,
            style,
            toScreen
        };

        for (const renderer of ENTITY_RENDERERS) {
            if (renderer.matches(entity) && renderer.draw(context) === true) {
                return;
            }
        }


        /*
         * SHOW MAGNITUDES, DRAWN FROM THE FEATURE.
         *
         * Everything above draws what the document happens to contain. A
         * force's magnitude is not a separate thing on the sheet - it is a
         * property OF the force - so there was nothing for the setting to
         * switch on. It is drawn here instead, from the feature itself, so
         * it cannot disagree with the force it belongs to.
         *
         * NOT STORED, and NOT SELECTABLE: this is the feature's own value
         * rendered, not a second object. It has no id in the document, so
         * clicking it selects the force, which is what clicking a force
         * should do.
         */
        if (context.overlay) svg.appendChild(context.overlay);
        if (svg.childNodes.length) {
            parentSvg.appendChild(svg);
        }
    }

export {
    appendEntity
};
