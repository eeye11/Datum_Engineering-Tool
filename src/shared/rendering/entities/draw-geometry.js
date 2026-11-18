/*
 * Drawing one feature: Plain geometry: points, lines, circles, rectangles, polylines, polygons,
 * triangles, arcs, and the 2D coordinate system.
 *
 * Each function draws one kind of feature into its group, from the context
 * appendEntity (entity-render.js) builds. It returns true when the feature
 * is finished, so no later renderer in the table runs for it.
 */
import { appendCoordinateSystem } from "../symbol-render.js";
import { activeZoom, applyStyle, arcPathData, createSvgElement, paintColour, textNode } from "../svg-primitives.js";
import {
    AUXILIARY_FONT_PX,
    CANVAS_BASELINE,
    CANVAS_FONT_STACK,
    FONT_WEIGHTS,
    PRIMARY_FONT_PX,
    SECONDARY_FONT_PX
} from "../../typography/canvas-typography.js";
import enggDrawingState from "../../model/drawing-state.js";
import { processPathPoints } from "../../../features/workspace/model/thermodynamics/process-curves.js";
import enggTheme from "../../../components/layout/workspace/theme.js";
import { gainTrianglePoints, isPlant, plantNodeLabel, plantNodePosition, plantStyle, plantValue, sumInputSign, sumInputSignPosition, sumNodePortPosition } from "../../model/plant.js";
import { appendBlockLabelSvg } from "../../model/block-label.js";
import { isSignalLine, signalLineSegments } from "../../model/signal-line.js";
import { stressArrows, stressAngleMark } from "../../geometry/stress-element.js";
import { boundaryStressDrawing } from "../../geometry/boundary-stress.js";


    export function drawPoint({ svg, parentSvg, geometry, style, toScreen }) {
            const position = geometry.position || geometry.point || geometry;
            if (Number.isFinite(position.x) && Number.isFinite(position.y)) {
                const screen = toScreen(position);
                /*
                 * Point Size is a WORLD size, so the marker keeps its
                 * proportion to the drawing at every zoom.
                 *
                 * It used to be read as screen pixels, so a point stayed four
                 * pixels across on a drawing magnified four times - while the
                 * compiled picture drew it at its world radius, and the two
                 * disagreed by exactly the zoom.
                 */
                const zoom = Number(activeZoom) > 0 ? Number(activeZoom) : 1;

                const pointRadius =
                    (Number.isFinite(style.pointSize) && style.pointSize > 0
                        ? style.pointSize
                        : 4) * zoom;
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


    export function drawSum(context) {
            const { svg, parentSvg, geometry, toScreen } = context;
            const style = plantStyle(context.style);
            const centre = toScreen(geometry.center);
            const colour = paintColour(style.stroke || enggTheme.defaultLineColour());
            const circle = createSvgElement("circle", {
                cx: centre.x,
                cy: centre.y,
                r: Number(geometry.radius) * context.scale
            });
            applyStyle(circle, style);
            if (style.fill && String(style.fill).toLowerCase() !== "none") {
                circle.setAttribute("fill", style.fill);
            }
            svg.appendChild(circle);

            for (let index = 0; index < plantValue(context.entity, "inputs"); index += 1) {
                const terminalPosition = plantNodePosition(context.entity, "inputs", index);
                const portPosition = sumNodePortPosition(context.entity, "inputs", index);
                const terminal = toScreen(terminalPosition);
                const port = toScreen(portPosition);
                const connector = createSvgElement("line", {
                    x1: port.x,
                    y1: port.y,
                    x2: terminal.x,
                    y2: terminal.y
                });
                applyStyle(connector, style);
                svg.appendChild(connector);

                const node = createSvgElement("circle", {
                    cx: terminal.x,
                    cy: terminal.y,
                    r: 3,
                    fill: colour
                });
                applyStyle(node, style);
                node.setAttribute("fill", colour);
                svg.appendChild(node);

                const signPosition = toScreen(sumInputSignPosition(context.entity, index));

                /* A SIGN MARK IS AUXILIARY TYPE, at a canvas font size. */
                textNode(svg, signPosition, sumInputSign(context.entity, index), {
                    size: AUXILIARY_FONT_PX,
                    fill: colour,
                    fontFamily: CANVAS_FONT_STACK,
                    fontWeight: FONT_WEIGHTS.bold,
                    anchor: "middle",
                    baseline: CANVAS_BASELINE
                });

                const selectedSignalNode = context.state?.interaction?.signalLineStart;
                if (
                    selectedSignalNode?.objectId === context.entity.id &&
                    selectedSignalNode.side === "inputs" &&
                    selectedSignalNode.index === index
                ) {
                    svg.appendChild(createSvgElement("circle", {
                        cx: terminal.x,
                        cy: terminal.y,
                        r: 7,
                        fill: "none",
                        stroke: "#2563EB",
                        "stroke-width": 2,
                        "data-signal-line-node-selected": "true",
                        "pointer-events": "none"
                    }));
                }
            }

            const outputTerminalPosition = plantNodePosition(context.entity, "outputs", 0);
            const outputPortPosition = sumNodePortPosition(context.entity, "outputs", 0);
            const outputTerminal = toScreen(outputTerminalPosition);
            const outputPort = toScreen(outputPortPosition);
            const outputConnector = createSvgElement("line", {
                x1: outputPort.x,
                y1: outputPort.y,
                x2: outputTerminal.x,
                y2: outputTerminal.y
            });
            applyStyle(outputConnector, style);
            svg.appendChild(outputConnector);

            const outputNode = createSvgElement("circle", {
                cx: outputTerminal.x,
                cy: outputTerminal.y,
                r: 3,
                fill: colour
            });
            applyStyle(outputNode, style);
            outputNode.setAttribute("fill", colour);
            svg.appendChild(outputNode);

            const selectedSignalNode = context.state?.interaction?.signalLineStart;
            if (
                selectedSignalNode?.objectId === context.entity.id &&
                selectedSignalNode.side === "outputs" &&
                selectedSignalNode.index === 0
            ) {
                svg.appendChild(createSvgElement("circle", {
                    cx: outputTerminal.x,
                    cy: outputTerminal.y,
                    r: 7,
                    fill: "none",
                    stroke: "#2563EB",
                    "stroke-width": 2,
                    "data-signal-line-node-selected": "true",
                    "pointer-events": "none"
                }));
            }

            parentSvg.appendChild(svg);
            return true;
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

                    textNode(svg, p, item.text, {
                        size: AUXILIARY_FONT_PX,
                        fill: item.colour,
                        fontFamily: CANVAS_FONT_STACK,
                        anchor: "middle",
                        baseline: CANVAS_BASELINE
                    });
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

                    textNode(svg, at, item.text, {
                        size: AUXILIARY_FONT_PX,
                        fill: "#909090",
                        fontFamily: CANVAS_FONT_STACK,
                        anchor: "middle",
                        baseline: CANVAS_BASELINE
                    });
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

            return rect;
        }

    export function drawPlant(context) {
            const { svg, parentSvg, geometry, toScreen } = context;
            const style = plantStyle(context.style);
            const position = geometry.position || { x: 0, y: 0 };
            const width = Number(geometry.width) || 0;
            const height = Number(geometry.height) || 0;
            const rotation = Number(geometry.rotation) || 0;
            const centre = {
                x: position.x + width / 2,
                y: position.y - height / 2
            };
            const radians = rotation * Math.PI / 180;
            const rotate = (x, y) => ({
                x: centre.x + x * Math.cos(radians) - y * Math.sin(radians),
                y: centre.y + x * Math.sin(radians) + y * Math.cos(radians)
            });
            const colour = paintColour(style.stroke || enggTheme.defaultLineColour());

            const rectangle = drawRectangleOutline({ ...context, style });

            if (rectangle && style.fill && String(style.fill).toLowerCase() !== "none") {
                rectangle.setAttribute("fill", style.fill);
            }

            const screenCentre = toScreen(centre);
            if (isPlant(context.entity)) {
                /* The block's own name: primary type, centred on the block. */
                textNode(svg, screenCentre, "Plant", {
                    size: PRIMARY_FONT_PX,
                    fill: colour,
                    fontFamily: CANVAS_FONT_STACK,
                    anchor: "middle",
                    baseline: CANVAS_BASELINE
                });
            }

            const userLabel = plantValue(context.entity, "plantLabel");

            if (isPlant(context.entity) && userLabel.trim()) {
                const labelPosition = toScreen({
                    x: centre.x,
                    y: centre.y - 6
                });

                /* The block's transfer function: secondary type under its name. */
                textNode(svg, labelPosition, `[${userLabel}]`, {
                    size: SECONDARY_FONT_PX,
                    fill: colour,
                    fontFamily: CANVAS_FONT_STACK,
                    anchor: "middle",
                    baseline: CANVAS_BASELINE
                });
            }

            const blockLabel = plantValue(context.entity, "blockLabel");

            if (blockLabel.trim()) {
                const label = createSvgElement("g", {
                    "aria-label": blockLabel
                });
                appendBlockLabelSvg(label, blockLabel, svg.ownerDocument, {
                    x: screenCentre.x,
                    y: screenCentre.y,
                    fill: colour,
                    fontSize: SECONDARY_FONT_PX,
                    zoom: Math.max(Number(activeZoom) || 1, 0.0001)
                });
                svg.appendChild(label);
            }

            const blockLowerLabel = plantValue(context.entity, "blockLowerLabel");

            if (blockLowerLabel.trim()) {
                const labelPosition = toScreen({
                    x: centre.x,
                    y: centre.y - height / 2 - 5
                });

                textNode(svg, labelPosition, blockLowerLabel, {
                    size: SECONDARY_FONT_PX,
                    fill: colour,
                    fontFamily: CANVAS_FONT_STACK,
                    anchor: "middle",
                    baseline: CANVAS_BASELINE
                });
            }

            for (const side of ["inputs", "outputs"]) {
                const count = plantValue(context.entity, side);
                const isInput = side === "inputs";
                const x = isInput ? -width / 2 : width / 2;
                const outward = isInput ? -1 : 1;

                for (let index = 0; index < count; index += 1) {
                    const terminalPosition = plantNodePosition(context.entity, side, index);
                    const terminalLocalY =
                        -(terminalPosition.x - centre.x) * Math.sin(radians) +
                        (terminalPosition.y - centre.y) * Math.cos(radians);
                    const port = toScreen(rotate(x, terminalLocalY));
                    const terminal = toScreen(terminalPosition);
                    const connector = createSvgElement("line", {
                        x1: port.x,
                        y1: port.y,
                        x2: terminal.x,
                        y2: terminal.y
                    });
                    applyStyle(connector, style);
                    svg.appendChild(connector);

                    const node = createSvgElement("circle", {
                        cx: terminal.x,
                        cy: terminal.y,
                        r: 3,
                        fill: colour
                    });
                    applyStyle(node, style);
                    node.setAttribute("fill", colour);
                    svg.appendChild(node);

                    const selectedSignalNode = context.state?.interaction?.signalLineStart;

                    if (
                        selectedSignalNode?.objectId === context.entity.id &&
                        selectedSignalNode.side === side &&
                        selectedSignalNode.index === index
                    ) {
                        const indicator = createSvgElement("circle", {
                            cx: terminal.x,
                            cy: terminal.y,
                            r: 7,
                            fill: "none",
                            stroke: "#2563EB",
                            "stroke-width": 2,
                            "data-signal-line-node-selected": "true",
                            "pointer-events": "none"
                        });
                        svg.appendChild(indicator);
                    }

                    if (plantValue(context.entity, "showNodeLabels")) {
                        const labelPosition = toScreen(rotate(x + outward * 7, terminalLocalY));
                        const screenOutward = outward * Math.cos(radians);

                        /* A terminal's name: auxiliary type, hung off its port. */
                        textNode(svg, { x: labelPosition.x, y: labelPosition.y + 8 }, plantNodeLabel(context.entity, side, index), {
                            size: AUXILIARY_FONT_PX,
                            fill: colour,
                            fontFamily: CANVAS_FONT_STACK,
                            anchor: screenOutward < 0 ? "end" : "start",
                            baseline: CANVAS_BASELINE
                        });
                    }
                }
            }

            parentSvg.appendChild(svg);

            return true;
        }

    export function drawGain(context) {
            const { svg, parentSvg, geometry, toScreen } = context;
            const style = plantStyle(context.style);
            const modelPoints = gainTrianglePoints(context.entity);
            const points = modelPoints.map(toScreen);
            const colour = paintColour(style.stroke || enggTheme.defaultLineColour());

            const triangle = createSvgElement("polygon", {
                points: points.map(point => `${point.x},${point.y}`).join(" ")
            });
            applyStyle(triangle, style);
            if (style.fill && String(style.fill).toLowerCase() !== "none") {
                triangle.setAttribute("fill", style.fill);
            }
            svg.appendChild(triangle);

            const centre = {
                x: modelPoints.reduce((sum, point) => sum + point.x, 0) / modelPoints.length,
                y: modelPoints.reduce((sum, point) => sum + point.y, 0) / modelPoints.length
            };
            const screenCentre = toScreen(centre);

            /* A gain's value: secondary type, centred in its triangle. */
            textNode(svg, screenCentre, plantValue(context.entity, "gainValue"), {
                size: SECONDARY_FONT_PX,
                fill: colour,
                fontFamily: CANVAS_FONT_STACK,
                anchor: "middle",
                baseline: CANVAS_BASELINE
            });

            for (const side of ["inputs", "outputs"]) {
                const terminalPosition = plantNodePosition(context.entity, side, 0);
                const terminal = toScreen(terminalPosition);
                const radians = (Number(geometry.rotation) || 0) * Math.PI / 180;
                const outward = side === "inputs" ? -1 : 1;
                const port = toScreen({
                    x: terminalPosition.x - outward * 4 * Math.cos(radians),
                    y: terminalPosition.y - outward * 4 * Math.sin(radians)
                });
                const connector = createSvgElement("line", {
                    x1: port.x,
                    y1: port.y,
                    x2: terminal.x,
                    y2: terminal.y
                });
                applyStyle(connector, style);
                svg.appendChild(connector);

                const node = createSvgElement("circle", {
                    cx: terminal.x,
                    cy: terminal.y,
                    r: 3 * (Number(activeZoom) > 0 ? Number(activeZoom) : 1),
                    fill: colour
                });
                applyStyle(node, style);
                node.setAttribute("fill", colour);
                svg.appendChild(node);

                const selectedSignalNode = context.state?.interaction?.signalLineStart;
                if (
                    selectedSignalNode?.objectId === context.entity.id &&
                    selectedSignalNode.side === side &&
                    selectedSignalNode.index === 0
                ) {
                    svg.appendChild(createSvgElement("circle", {
                        cx: terminal.x,
                        cy: terminal.y,
                        r: 7,
                        fill: "none",
                        stroke: "#2563EB",
                        "stroke-width": 2,
                        "data-signal-line-node-selected": "true",
                        "pointer-events": "none"
                    }));
                }
            }

            parentSvg.appendChild(svg);
            return true;
        }


        /*
         * POLYLINE
         */
    export function drawPolyline({ svg, entity, state, geometry, style, toScreen }) {
            if (isSignalLine(entity)) {
                const signalStyle = {
                    stroke: "#000000",
                    lineWidth: 0.5,
                    lineType: "solid",
                    opacity: 1
                };
                const segments = signalLineSegments(entity, state?.objects || []);

                for (const segment of segments) {
                    const start = toScreen(segment.start);
                    const end = toScreen(segment.end);
                    const line = createSvgElement("line", {
                        x1: start.x,
                        y1: start.y,
                        x2: end.x,
                        y2: end.y
                    });
                    applyStyle(line, signalStyle);
                    svg.appendChild(line);

                    if (segment.hasArrow) {
                        const dx = end.x - start.x;
                        const dy = end.y - start.y;
                        const length = Math.hypot(dx, dy) || 1;
                        const ux = dx / length;
                        const uy = dy / length;
                        const baseX = end.x - ux * 9;
                        const baseY = end.y - uy * 9;
                        const perpendicularX = -uy * 4;
                        const perpendicularY = ux * 4;
                        const arrow = createSvgElement("path", {
                            d: `M ${end.x} ${end.y} L ${baseX + perpendicularX} ${baseY + perpendicularY} L ${baseX - perpendicularX} ${baseY - perpendicularY} Z`,
                            fill: "#000000",
                            stroke: "none"
                        });
                        svg.appendChild(arrow);
                    }
                }

                return;
            }

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
