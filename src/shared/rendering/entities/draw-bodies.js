/*
 * Drawing one feature: Bodies drawn as a whole: the particle and the rigid body.
 *
 * Each function draws one kind of feature into its group, from the context
 * appendEntity (entity-render.js) builds. It returns true when the feature
 * is finished, so no later renderer in the table runs for it.
 */
import { appendRigidBody } from "../symbol-render.js";
import { createSvgElement, paintColour, worldLength } from "../svg-primitives.js";
import enggTheme from "../../../components/layout/workspace/theme.js";


        /*
         * PARTICLE
         *
         * An engineering point node: a small filled circle
         * centred on the actual world position.
         */
    export function drawParticle({ svg, parentSvg, geometry, style, toScreen }) {
            const position = geometry.position;

            if (
                !position ||
                !Number.isFinite(position.x) ||
                !Number.isFinite(position.y)
            ) {
                return true;
            }

            const node = toScreen(position);
            const stroke = paintColour(style.stroke || enggTheme.defaultLineColour());

            /*
             * THE NODE'S SIZE IS THE DRAWING'S.
             *
             * A particle is a body drawn at a world radius, so its marker has to
             * grow with the member it sits on - a bare four was four overlay
             * pixels at every magnification, a speck on a body zoomed to 400%
             * and a blot on one zoomed out, while the compiled picture beside it
             * kept the authored radius.
             */
            svg.appendChild(
                createSvgElement("circle", {
                    cx: node.x,
                    cy: node.y,
                    r: worldLength(Number.isFinite(Number(geometry.markerRadius)) && Number(geometry.markerRadius) > 0
                        ? Number(geometry.markerRadius)
                        : 1.7),
                    fill: stroke,
                    stroke: "none"
                })
            );

            parentSvg.appendChild(svg);
            return true;
        }


        /*
         * RIGID BODY
         *
         * A rigid body is one body whose outline can be any of
         * the supported shapes, so it is drawn as whichever
         * shape it currently has. Each is drawn as a real
         * outline of that shape rather than as a stand-in: a
         * circle is a circle, a triangle is closed, and a
         * polygon keeps all of its sides. The shape is read
         * from the shared geometry module so the drawing, the
         * handles and the transforms always agree.
         */
    export function drawRigidBody({ svg, parentSvg, entity, scale, geometry, style, toScreen }) {
            appendRigidBody(
                svg,
                entity,
                geometry,
                style,
                toScreen,
                scale
            );

            parentSvg.appendChild(svg);
            return true;
        }
