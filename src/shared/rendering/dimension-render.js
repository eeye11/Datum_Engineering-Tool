/*
 * Dimensions and variable dimensions: their lines, arrowheads and text.
 *
 * Part of the renderer (see renderer.js), split out by concern.
 */
import enggDimensionModel from "../../features/workspace/model/dimensions/dimension-model.js";
import enggTheme from "../../components/layout/workspace/theme.js";
import enggCanvasPalette from "./canvas-palette.js";
import { createSvgElement, paintColour, zoomedFontHere } from "./svg-primitives.js";


    /*
     * ARROWHEADS THAT SCALE WITH THE LINE THEY SIT ON
     *
     * An arrowhead drawn at a fixed size looks wrong the moment the
     * student changes the line thickness: a heavy dimension line with
     * tiny arrows reads as a mistake. The head is therefore sized as a
     * multiple of the line width, with a floor so it stays visible on
     * the thinnest line the toolbar offers.
     *
     * It is drawn pointing INTO the line it terminates, from the tip
     * back along the line's own direction, which is why the caller
     * passes the direction the head points rather than the point it
     * touches.
     */
    function arrowHeadSize(lineWidth) {
        return Math.max(4, Math.min(11, (Number(lineWidth) || 0.5) * 10));
    }

    /*
     * A DIMENSION ARROWHEAD.
     *
     * Deliberately NOT called appendArrowHead: this file already has
     * a function of that name, declared later and for force arrows,
     * and because both are function declarations inside the same
     * scope the later one wins. Calling the name from here silently
     * invoked the force version, which takes an ANGLE IN RADIANS and a
     * size in a different argument position - so passing a direction
     * vector produced NaN and every dimension arrowhead collapsed.
     *
     * The dimension head is built here rather than reused because a
     * dimension's arrow points along its own dimension line, which is
     * a different question from which end of a force carries its
     * head.
     */
    function appendDimensionArrowHead(svg, tip, pointing, size, fill) {
        /*
         * A direction that is not a direction cannot be pointed
         * along. Skipping leaves the dimension line, which still
         * reads correctly, instead of an invalid polygon that takes
         * the whole drawing's SVG with it.
         */
        if (
            !pointing ||
            !Number.isFinite(pointing.x) ||
            !Number.isFinite(pointing.y)
        ) {
            return;
        }

        const angle = Math.atan2(pointing.y, pointing.x);

        svg.appendChild(
            createSvgElement("polygon", {
                points: [
                    `${tip.x},${tip.y}`,
                    `${tip.x - size * Math.cos(angle - 0.42)},${tip.y - size * Math.sin(angle - 0.42)}`,
                    `${tip.x - size * Math.cos(angle + 0.42)},${tip.y - size * Math.sin(angle + 0.42)}`
                ].join(" "),
                fill,
                stroke: "none"
            })
        );
    }

    /*
     * DIMENSION TEXT
     *
     * Placed with the frame the model computed, so a vertical
     * dimension reads bottom-to-top and an angled one follows the
     * line without ever turning upside down. A canvas-coloured glyph halo
     * keeps crossing lines from obscuring the value without an opaque plate.
     */
    function appendDimensionText(svg, text, frame, stroke, toScreen) {
        if (!text || !frame || !toScreen) {
            return;
        }

        /*
         * The frame arrives in WORLD coordinates, because the model
         * works in world units and knows nothing about zoom. It is
         * converted here at the last moment, which is what keeps a
         * dimension saying the same thing at 50% and 200%.
         */
        const origin = toScreen(frame);

        const lines = String(text).split("\n");
        const fontSize = zoomedFontHere(11);
        const lineHeight = fontSize * 1.15;

        const group = createSvgElement("g", {
            transform: `translate(${origin.x} ${origin.y}) rotate(${frame.angle || 0})`
        });

        // A narrow canvas-coloured halo separates glyphs from crossing lines.
        // Background is paper, so do not send it through ink contrast mapping
        // (that turns a white plate into white ink on the dark canvas).
        const background = enggCanvasPalette.CANVAS_BACKGROUND[enggCanvasPalette.activeCanvasTheme()];

        lines.forEach((line, index) => {
            const span = createSvgElement("text", {
                x: 0,
                y: (index - (lines.length - 1) / 2) * lineHeight,
                fill: stroke,
                stroke: background,
                "stroke-width": 3,
                "stroke-linejoin": "round",
                "paint-order": "stroke fill",
                class: "drawing-dimension-label",
                "font-size": fontSize,
                "font-family": "Arial, sans-serif",
                "text-anchor": "middle",
                "dominant-baseline": "middle"
            });

            span.textContent = line;
            group.appendChild(span);
        });

        svg.appendChild(group);
    }

    /*
     * A DIMENSION, drawn as a dimension.
     *
     * The geometry comes from the model's graphicsFor, which is where
     * the measurement, the offset chosen by the student and the
     * arrowhead convention all live. This function only converts those
     * world points to screen and draws them.
     *
     * Nothing here is an ordinary Line feature: the witness lines
     * belong to this dimension for as long as the dimension exists,
     * are regenerated whenever it is drawn, and cannot be picked on
     * their own.
     */
    function appendDimensionEntity(svg, entity, state, toScreen, style) {
        const model = enggDimensionModel;

        if (!model) {
            return;
        }

        const graphics = model.graphicsFor(entity, state);

        if (!graphics) {
            return;
        }

        /*
         * A DIMENSION IS AN ANNOTATION WITH ONE APPEARANCE.
         *
         * Driving and Driven dimensions share the same visual treatment:
         * each uses its own stroke colour, like every other
         * annotation on the sheet.
         */
        const stroke = paintColour(
            style.stroke || enggTheme.defaultLineColour()
        );
        const lineWidth = Number(style.lineWidth) || 0.5;
        const head = arrowHeadSize(lineWidth);

        const drawLine = (from, to, dashed) => {
            const a = toScreen(from);
            const b = toScreen(to);

            svg.appendChild(
                createSvgElement("line", {
                    x1: a.x,
                    y1: a.y,
                    x2: b.x,
                    y2: b.y,
                    stroke,
                    "stroke-width": Math.max(0.6, lineWidth * 1.4),
                    ...(dashed ? { "stroke-dasharray": "4 3" } : {})
                })
            );
        };

        /*
         * AN ANGULAR DIMENSION
         *
         * Drawn as an ARC through the two legs it measures between.
         *
         * The model has already worked out where the arc runs and
         * supplies it as a list of points, and it supplies the two
         * witness lines running out along the legs. Both are drawn
         * directly from that. An earlier version of this branch
         * invented a `radius`, a `sweep` and a `witnesses` list that
         * the model does not produce, so every arc came out as an SVG
         * path full of NaN and the browser rejected the whole drawing.
         *
         * Taking the points the model computed also keeps the angle
         * and the arc in agreement: both come from the same vertex and
         * the same two directions, so the arc cannot disagree with the
         * number printed beside it.
         */
        /*
         * AN ARC LENGTH, DRAWN ALONG ITS ARC.
         *
         * The model supplies the concentric arc (following the feature's own
         * sweep), the two radii out to its ends, and an arrowhead at each end
         * lying along the tangent. The arrows are drawn from those directions
         * instead of from a single dimension line, because this dimension has no
         * straight line to hang them on - that is exactly what distinguishes it
         * from the chord a linear dimension would draw between the two ends.
         */
        if (graphics.kind === "arc-length") {
            const arc = (graphics.arc || []).filter(
                (point) =>
                    point &&
                    Number.isFinite(point.x) &&
                    Number.isFinite(point.y)
            );

            (graphics.extensions || []).forEach(([from, to]) => {
                drawLine(from, to, true);
            });

            if (arc.length >= 2) {
                svg.appendChild(
                    createSvgElement("polyline", {
                        points: arc
                            .map((point) => {
                                const p = toScreen(point);
                                return `${p.x},${p.y}`;
                            })
                            .join(" "),
                        fill: "none",
                        stroke,
                        "stroke-width":
                            Math.max(0.6, lineWidth * 1.4)
                    })
                );
            }

            (graphics.arrowheads || []).forEach((arrow) => {
                if (
                    !arrow?.at ||
                    !arrow.direction ||
                    !Number.isFinite(arrow.at.x) ||
                    !Number.isFinite(arrow.at.y)
                ) {
                    return;
                }

                appendDimensionArrowHead(
                    svg,
                    arrow.at,
                    arrow.direction,
                    head,
                    stroke
                );
            });

            appendDimensionText(
                svg,
                graphics.text,
                graphics.textFrame,
                stroke,
                toScreen
            );

            return;
        }

        if (graphics.kind === "angular") {
            const arc = (graphics.arc || []).filter(
                (point) =>
                    point &&
                    Number.isFinite(point.x) &&
                    Number.isFinite(point.y)
            );

            if (arc.length >= 2) {
                svg.appendChild(
                    createSvgElement("polyline", {
                        points: arc
                            .map((point) => {
                                const p = toScreen(point);
                                return `${p.x},${p.y}`;
                            })
                            .join(" "),
                        fill: "none",
                        stroke,
                        "stroke-width":
                            Math.max(0.6, lineWidth * 1.4)
                    })
                );
            }

            /*
             * The legs the angle is measured from, drawn thin and
             * dashed so they read as a reference rather than as
             * another dimension.
             */
            (graphics.extensions || []).forEach(
                ([from, to]) => {
                    drawLine(from, to, true);
                }
            );

            appendDimensionText(
                svg,
                graphics.text,
                graphics.textFrame,
                stroke,
                toScreen
            );

            return;
        }

        /*
         * WITNESS (EXTENSION) LINES
         *
         * Drawn thin and dashed, and stopping a short of the
         * dimension line so they read as reaching towards it rather
         * than crossing it - which is what makes a dimension legible
         * without reading the number.
         */
        (graphics.extensions || []).forEach(([from, to]) => {
            const a = toScreen(from);
            const b = toScreen(to);

            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const length = Math.hypot(dx, dy);

            if (length < 0.001) {
                return;
            }

            /*
             * Stop short by the arrowhead's reach, so the arrows
             * never sit on top of a witness line.
             */
            const gap = Math.min(head * 0.6, length * 0.3);

            svg.appendChild(
                createSvgElement("line", {
                    x1: a.x + (dx / length) * gap,
                    y1: a.y + (dy / length) * gap,
                    x2: b.x,
                    y2: b.y,
                    stroke,
                    "stroke-width": Math.max(0.4, lineWidth * 0.8),
                    "stroke-dasharray": "4 3"
                })
            );
        });

        if (graphics.line) {
            const [from, to] = graphics.line;

            drawLine(from, to, false);

            const a = toScreen(from);
            const b = toScreen(to);

            const along = {
                x: b.x - a.x,
                y: b.y - a.y
            };

            const length = Math.hypot(along.x, along.y);

            /*
             * Guarded rather than assumed: a dimension whose two
             * points coincide has no direction to point an arrowhead
             * in, and dividing by that length would put NaN straight
             * into the SVG and drop the whole polygon. Skipping the
             * arrows leaves a dimension line, which is still a
             * readable dimension, instead of an invalid one.
             */
            if (length > 0.5) {
                const unit = {
                    x: along.x / length,
                    y: along.y / length
                };

                /*
                 * Arrows INSIDE point inwards along the line; arrows
                 * OUTSIDE point back away from it. The model chooses,
                 * because a narrow dimension has no room inside.
                 */
                const inside = graphics.arrowStyle !== "outside";

                appendDimensionArrowHead(
                    svg,
                    inside ? b : a,
                    inside ? unit : { x: -unit.x, y: -unit.y },
                    head,
                    stroke
                );

                appendDimensionArrowHead(
                    svg,
                    inside ? a : b,
                    inside ? { x: -unit.x, y: -unit.y } : unit,
                    head,
                    stroke
                );
            }
        }

        /*
         * A radius or diameter is drawn from the centre out through
         * the edge, with the figure written along that line.
         */
        if (graphics.leader) {
            drawLine(graphics.leader.from, graphics.leader.to, true);
        }

        appendDimensionText(svg, graphics.text, graphics.textFrame, stroke, toScreen);
    }

export {
    arrowHeadSize,
    appendDimensionArrowHead,
    appendDimensionText,
    appendDimensionEntity
};
