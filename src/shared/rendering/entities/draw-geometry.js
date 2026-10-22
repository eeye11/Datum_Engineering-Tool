/*
 * Drawing one feature: Plain geometry: points, lines, circles, rectangles, polylines, polygons,
 * triangles, arcs, and the 2D coordinate system.
 *
 * Each function draws one kind of feature into its group, from the context
 * appendEntity (entity-render.js) builds. It returns true when the feature
 * is finished, so no later renderer in the table runs for it.
 */
import { appendCoordinateSystem } from "../symbol-render.js";
import { applyStyle, arcPathData, createSvgElement, paintColour } from "../svg-primitives.js";
import enggDrawingState from "../../model/drawing-state.js";
import { processPathPoints } from "../../../features/workspace/model/thermodynamics/process-curves.js";
import enggTheme from "../../../components/layout/workspace/theme.js";
import { stressArrows, stressAngleMark } from "../../geometry/stress-element.js";
import { boundaryStressDrawing } from "../../geometry/boundary-stress.js";


    export function drawPoint({ svg, parentSvg, geometry, style, toScreen }) {
            const position = geometry.position || geometry.point || geometry;
            if (Number.isFinite(position.x) && Number.isFinite(position.y)) {
                const screen = toScreen(position);
                /*
                 * Point Size is a screen-space marker size, so
                 * it stays legible at any zoom.
                 */
                const pointRadius =
                    Number.isFinite(style.pointSize) && style.pointSize > 0
                        ? style.pointSize
                        : 4;
                const marker = createSvgElement("circle", {
                    cx: screen.x,
                    cy: screen.y,
                    r: pointRadius,
                    fill: paintColour(style.stroke || enggTheme.defaultLineColour()),
                    stroke: paintColour(style.stroke || enggTheme.defaultLineColour()),
                    "stroke-width": 1
                });
                applyStyle(marker, style);
                svg.appendChild(marker);
            }
            parentSvg.appendChild(svg);
            return true;
        }


        /*
         * LINE
         */
    export function drawLine({ svg, geometry, style, toScreen }) {
            if (
                !geometry.start ||
                !geometry.end
            ) {
                return true;
            }

            const start =
                toScreen(
                    geometry.start
                );

            const end =
                toScreen(
                    geometry.end
                );

            const line =
                createSvgElement(
                    "line",
                    {
                        x1: start.x,
                        y1: start.y,
                        x2: end.x,
                        y2: end.y
                    }
                );

            applyStyle(
                line,
                style
            );

            svg.appendChild(
                line
            );
        }


        /*
         * CIRCLE
         */
    export function drawCircle({ svg, scale, geometry, style, toScreen }) {
            if (
                !geometry.center
            ) {
                return true;
            }

            const center =
                toScreen(
                    geometry.center
                );

            const circle =
                createSvgElement(
                    "circle",
                    {
                        cx: center.x,
                        cy: center.y,
                        r:
                            geometry.radius *
                            scale
                    }
                );

            applyStyle(
                circle,
                style
            );

            svg.appendChild(
                circle
            );
        }


        /*
         * RECTANGLE
         *
         * A rigid body stores the same shape, so it renders
         * through the same branch and stays one coherent
         * feature rather than four separate lines.
         */
    export function drawRectangleOutline({ svg, scale, geometry, style, toScreen, entity }) {
            if (entity.metadata?.boundaryStress) {
                const drawing = boundaryStressDrawing(geometry);
                for (const { points, colour } of drawing.paths) {
                    const path = createSvgElement("polyline", { points: points.map(toScreen).map(p => `${p.x},${p.y}`).join(" ") });
                    applyStyle(path, { ...style, stroke: colour, fill: "none" });
                    svg.appendChild(path);
                }
                for (const item of drawing.labels) {
                    const p = toScreen(item.point);
                    const label = createSvgElement("text", { x: p.x, y: p.y, fill: item.colour, "font-size": 12, "text-anchor": "middle", "dominant-baseline": "middle" });
                    label.textContent = item.text;
                    svg.appendChild(label);
                }
            }
            if (entity.metadata?.stressElement) {
                const mark = stressAngleMark(geometry);
                if (mark) {
                    for (const [points, dashed] of [[mark.reference, false], [mark.face, true], [mark.perpendicular, true], [mark.arc, false]]) {
                        const line = createSvgElement("polyline", {
                            points: points.map(toScreen).map(p => `${p.x},${p.y}`).join(" "),
                            fill: "none", stroke: "#909090",
                            "stroke-width": 1, ...(dashed ? { "stroke-dasharray": "4 3" } : {})
                        });
                        svg.appendChild(line);
                    }
                    for (const item of [...mark.axes, { point: mark.labelPoint, text: mark.text }]) {
                    const at = toScreen(item.point);
                    const label = createSvgElement("text", {
                        x: at.x, y: at.y, "text-anchor": "middle", "dominant-baseline": "middle",
                        "font-size": 12, fill: "#909090"
                    });
                    label.textContent = item.text;
                    svg.appendChild(label);
                    }
                }
                for (const { points, colour } of stressArrows(geometry)) {
                    const arrow = createSvgElement("polyline", {
                        points: points.map(toScreen).map(p => `${p.x},${p.y}`).join(" ")
                    });
                    applyStyle(arrow, { ...style, stroke: colour, fill: "none" });
                    svg.appendChild(arrow);
                }
            }
            const x =
                geometry.position?.x ??
                0;

            const y =
                geometry.position?.y ??
                0;

            const width =
                geometry.width ??
                0;

            const height =
                geometry.height ??
                0;

            const rotation =
                geometry.rotation ??
                0;

            const topLeft =
                toScreen({
                    x,
                    y
                });

            /*
             * position is the top-left corner in engineering
             * space, where Y grows upward. toScreen already
             * flips Y, so topLeft.y is the screen row of the
             * top edge. Subtracting the height here would
             * draw the rectangle one height too high.
             */
            const rect =
                createSvgElement(
                    "rect",
                    {
                        x: topLeft.x,
                        y: topLeft.y,
                        width:
                            width *
                            scale,
                        height:
                            height *
                            scale
                    }
                );

            if (rotation) {
                /*
                 * position is the top-left corner in
                 * engineering space, where Y grows upward, so
                 * the shape's centre is half a height BELOW
                 * it. Rotating about the wrong point threw the
                 * corners away from the shape.
                 */
                const center =
                    toScreen({
                        x:
                            x +
                            width / 2,
                        y:
                            y -
                            height / 2
                    });

                rect.setAttribute(
                    "transform",
                    `rotate(${-rotation} ${center.x} ${center.y})`
                );
            }

            applyStyle(
                rect,
                style
            );

            svg.appendChild(
                rect
            );
        }


        /*
         * POLYLINE
         */
    export function drawPolyline({ svg, entity, geometry, style, toScreen }) {
            const points =
                (
                    entity.metadata?.thermodynamicsKind === "process-path"
                        ? processPathPoints(geometry) : (geometry.points || [])
                )
                    .filter(Boolean)
                    .map(toScreen)
                    .map(
                        point =>
                            `${point.x},${point.y}`
                    )
                    .join(" ");

            if (points) {
                const closed = geometry.closed === true;
                const polyline =
                    createSvgElement(
                        closed ? "polygon" : "polyline",
                        {
                            points
                        }
                    );

                applyStyle(
                    polyline,
                    style
                );

                svg.appendChild(
                    polyline
                );
            }
        }


        /*
         * POLYGON
         *
         * One closed shape whose vertices are derived
         * from the stored centre, radius, rotation and
         * side count.
         */
    export function drawPolygon({ svg, geometry, style, toScreen }) {
            const points =
                enggDrawingState
                    .polygonVertices(
                        geometry
                    )
                    .map(toScreen)
                    .map(
                        point =>
                            `${point.x},${point.y}`
                    )
                    .join(" ");

            if (points) {
                const polygon =
                    createSvgElement(
                        "polygon",
                        {
                            points
                        }
                    );

                applyStyle(
                    polygon,
                    style
                );

                svg.appendChild(
                    polygon
                );
            }
        }


        /*
         * TRIANGLE
         *
         * One closed shape built from its three
         * stored points, so it renders and selects
         * as a single feature.
         */
    export function drawTriangle({ svg, geometry, style, toScreen }) {
            const points =
                (
                    geometry.points ||
                    []
                )
                    .filter(Boolean)
                    .map(toScreen)
                    .map(
                        point =>
                            `${point.x},${point.y}`
                    )
                    .join(" ");

            if (points) {
                const triangle =
                    createSvgElement(
                        "polygon",
                        {
                            points
                        }
                    );

                applyStyle(
                    triangle,
                    style
                );

                svg.appendChild(
                    triangle
                );
            }
        }


        /*
         * ARC
         */
    export function drawArc({ svg, scale, geometry, style, toScreen }) {
            if (
                !geometry.center
            ) {
                return true;
            }

            const center =
                toScreen(
                    geometry.center
                );

            const radius =
                geometry.radius *
                scale;

            const startAngle =
                geometry.startAngle ??
                0;

            const endAngle =
                geometry.endAngle ??
                0;

            const path =
                createSvgElement(
                    "path"
                );
            path.classList.add("drawing-open-arc");

            path.setAttribute(
                "d",
                arcPathData(
                    center,
                    radius,
                    startAngle,
                    endAngle
                )
            );

            applyStyle(
                path,
                style
            );

            svg.appendChild(
                path
            );
        }


        /*
         * 2D COORDINATE SYSTEM
         *
         * One feature: a shared origin, a positive and a
         * negative extension on each axis, with arrowheads
         * only on the positive directions.
         */
    export function drawCoordinateSystem2d({ svg, entity, state, bounds, geometry, style }) {
            /*
             * The whole axis group is rotated about its origin when the
             * entity carries a rotation. The committed axes carry a rotation
             * of 0, so this changes nothing for them; a drag preview carries
             * the angle its X arm points in, which is what lets the preview
             * follow the pointer instead of only reporting a length.
             */
            appendCoordinateSystem(
                svg,
                geometry,
                style,
                state,
                bounds,
                entity.isPreview,
                -(Number(geometry.rotation) || Number(entity.rotation) || 0)
            );
        }
