/*
 * Engineering symbols: supports, connections, coordinate systems and the
 * rigid body.
 *
 * Part of the renderer (see renderer.js), split out by concern.
 */
import enggFeatureGeometry from "../geometry/feature-geometry.js";
import enggDrawingState from "../model/drawing-state.js";
import { applyStyle, createSvgElement, zoomedFontHere } from "./svg-primitives.js";


    /*
     * Standard engineering support symbols.
     *
     * Pin is a triangle on a hatched ground line, roller adds the
     * rollers, fixed is a hatched wall, and smooth shows a rounded
     * contact with its normal reaction.
     *
     * DRAWN IN THE BODY'S OWN FRAME, WHICH IS WHY THE ORIENTATION
     * MATTERS.
     *
     * Every offset below is measured along one axis - `out` away from
     * the body, `across` along it - and the two are turned into screen
     * coordinates by `at`. Nothing is written as a fixed screen x or y.
     *
     * That is the difference between a support that belongs to its
     * beam and one that merely sits near it. Written as screen
     * coordinates, every one of these symbols hangs straight down
     * regardless of the member it supports, so a beam drawn at an
     * angle carries four supports pointing off at four different wrong
     * angles - and a support placed on the far side of the body
     * renders in the same place as one on the near side, because the
     * drawing has no way to know which side it is on.
     *
     * The convention is kept exactly as it was: a symbol is drawn with
     * its apex against the body and its ground further out, so "out"
     * is the direction the ground faces.
     */
    function appendSupportSymbol(
        svg,
        anchor,
        type,
        orientation,
        stroke
    ) {
        const size = 9;
        const ground = 26;

        /*
         * The symbol's own axes, from the angle the caller derived
         * from the body.
         *
         * Screen y grows downward, which is why the perpendicular is
         * negated: an angle of -90 degrees means "straight up the
         * screen", and without the negation every symbol would be
         * drawn upside down and the two would be the same way up.
         */
        const out = {
            x: Math.cos(orientation),
            y: Math.sin(orientation)
        };

        const across = {
            x: -out.y,
            y: out.x
        };

        /*
         * A point `outward` units away from the anchor, `sideways`
         * units along the body.
         *
         * A signed pair rather than a distance and a side, so a
         * negative simply goes the other way - which is exactly what
         * Flip needs and is why a flipped support is the same drawing
         * turned round rather than a second drawing.
         */
        const at = (outward, sideways = 0) => ({
            x: anchor.x + out.x * outward + across.x * sideways,
            y: anchor.y + out.y * outward + across.y * sideways
        });

        const line = (from, to, width, opacity) => {
            const element =
                createSvgElement("line", {
                    x1: from.x,
                    y1: from.y,
                    x2: to.x,
                    y2: to.y,
                    stroke,
                    "stroke-width": width,
                    ...(opacity
                        ? { "stroke-opacity": opacity }
                        : {})
                });

            element.setAttribute(
                "pointer-events",
                "none"
            );

            svg.appendChild(element);

            return element;
        };

        if (type === "fixed-support") {
            /*
             * ========================================================
             * A WALL AT THE BODY'S END, WITH THE HATCHING BEHIND IT
             * ========================================================
             *
             * WHAT A FIXED SUPPORT IS: the member ends AT a wall. So the wall's
             * LINE belongs at the attachment point - the end of the body -
             * running perpendicular to the member, and the hatch strokes stand
             * BEHIND that line, on the side the body is NOT on.
             *
             * WHAT IT USED TO BE: the wall was drawn where the OTHER supports'
             * symbols are drawn - at the standoff, a short way off the body's
             * face - which put the line floating beside the member instead of
             * at its end. The member then appeared to pass THROUGH the wall
             * rather than to stop at it, and the hatch strokes started ON the
             * line rather than behind it, so the two overlapped.
             *
             * THE HATCHING IS ON `out`, WHICH IS AWAY FROM THE BODY. `at`
             * measures along the body's own normal, and `out` for this symbol
             * is the direction its ground faces - away from the member. So
             * offsets with a POSITIVE first component are on the far side of
             * the wall from the body, which is exactly where the strokes
             * belong.
             */
            const wall = 16;

            /* The wall line, ACROSS the member, at the attachment point. */
            line(
                at(0, -wall),
                at(0, wall),
                2.5
            );

            for (
                let offset = -wall;
                offset <= wall;
                offset += 5
            ) {
                /*
                 * FROM THE WALL BACKWARD, never across it: every stroke
                 * starts ON the wall (0) and runs away from the body, so the
                 * hatch reads as the solid the member is fixed into.
                 */
                line(
                    at(0, offset),
                    at(9, offset + 5),
                    1
                );
            }

            return;
        }

        if (type === "smooth-support") {
            /*
             * A rounded contact with its normal reaction, which
             * is what distinguishes a smooth support.
             */
            const centre = at(4);

            const contact =
                createSvgElement("circle", {
                    cx: centre.x,
                    cy: centre.y,
                    r: 4,
                    fill: "none",
                    stroke,
                    "stroke-width": 1.4
                });

            contact.setAttribute(
                "pointer-events",
                "none"
            );

            svg.appendChild(contact);

            line(at(0), at(16), 1.4);
            line(at(-2, -ground / 2), at(-2, ground / 2), 1.4);

            return;
        }

        /*
         * Pin and roller share the triangle body; the roller
         * adds the rollers beneath it.
         */
        const rollers = type === "roller-support";

        const apex = at(-size);
        const base = at(size);

        const triangle =
            createSvgElement("polygon", {
                points: [
                    `${apex.x},${apex.y}`,
                    `${base.x + size},${base.y}`,
                    `${base.x - size},${base.y}`
                ].join(" "),
                fill: "none",
                stroke,
                "stroke-width": 1.6
            });

        triangle.setAttribute(
            "pointer-events",
            "none"
        );

        svg.appendChild(triangle);

        if (rollers) {
            [-5, 5].forEach(offset => {
                const centre = at(size + 3, offset);

                const roller =
                    createSvgElement("circle", {
                        cx: centre.x,
                        cy: centre.y,
                        r: 3,
                        fill: "none",
                        stroke,
                        "stroke-width": 1.2
                    });

                roller.setAttribute(
                    "pointer-events",
                    "none"
                );

                svg.appendChild(roller);
            });

            line(
                at(size + 7, -ground / 2),
                at(size + 7, ground / 2),
                1.4
            );
        } else {
            line(
                at(size, -ground / 2),
                at(size, ground / 2),
                1.4
            );
        }
    }

    /*
     * Connection symbols: pin shows a joint circle, fixed
     * shows a rigid block, slider shows a guided slider.
     */
    function appendConnectionSymbol(
        svg,
        anchor,
        type,
        stroke
    ) {
        if (type === "fixed-connection") {
            svg.appendChild(
                createSvgElement("rect", {
                    x: anchor.x - 8,
                    y: anchor.y - 8,
                    width: 16,
                    height: 16,
                    fill: "none",
                    stroke,
                    "stroke-width": 1.8
                })
            );

            return;
        }

        if (type === "slider-connection") {
            svg.appendChild(
                createSvgElement("line", {
                    x1: anchor.x - 14,
                    y1: anchor.y - 7,
                    x2: anchor.x + 14,
                    y2: anchor.y - 7,
                    stroke,
                    "stroke-width": 1.4
                })
            );

            svg.appendChild(
                createSvgElement("rect", {
                    x: anchor.x - 7,
                    y: anchor.y - 5,
                    width: 14,
                    height: 10,
                    fill: "none",
                    stroke,
                    "stroke-width": 1.6
                })
            );

            return;
        }

        svg.appendChild(
            createSvgElement("circle", {
                cx: anchor.x,
                cy: anchor.y,
                r: 4,
                fill: "none",
                stroke,
                "stroke-width": 1.6
            })
        );
    }

    function appendCoordinateSystem(
        svg,
        geometry,
        style,
        state,
        bounds,
        isPreview = false,
        rotation = 0
    ) {
        const scale =
            enggDrawingState
                .BASE_PIXELS_PER_UNIT *
            state.camera.zoom;

        const origin =
            enggDrawingState
                .engineeringToScreen(
                    geometry.origin ||
                        {
                            x: 0,
                            y: 0
                        },
                    bounds,
                    state
                );

        /*
         * A rotated axis is drawn as a rotated group rather than as four
         * separately-computed endpoints. The origin is the pivot, so the arms
         * turn about the point the student placed and the labels turn with
         * them. A committed axis carries a rotation of 0 and lands exactly
         * where it always did.
         */
        const group =
            rotation
                ? createSvgElement("g", {
                      transform:
                          `rotate(${(rotation * 180) / Math.PI} ${origin.x} ${origin.y})`
                  })
                : svg;

        /*
         * Four independent extensions one feature.
         *
         * xPositiveLength / xNegativeLength /
         * yPositiveLength / yNegativeLength are stored
         * separately, so extending one side never resizes
         * the others. Older files that only carry
         * axisLength still work through the fallback.
         */
        const legacyLength =
            Number(geometry.axisLength);

        const fallbackLength =
            Number.isFinite(legacyLength) && legacyLength > 0
                ? legacyLength
                : 25;

        const readLength = value =>
            Math.max(
                0,
                Number.isFinite(Number(value)) && Number(value) >= 0
                    ? Number(value)
                    : fallbackLength
            ) * scale;

        const xAxisLength =
            readLength(geometry.xPositiveLength);

        const xNegativeLength =
            readLength(geometry.xNegativeLength);

        const yAxisLength =
            readLength(geometry.yPositiveLength);

        const yNegativeLength =
            readLength(geometry.yNegativeLength);

        const axisColor =
            style.stroke ||
            "#000000";

        /*
         * Axis stroke width is a SCREEN-space value.
         *
         * The previous implementation multiplied the line
         * width by the engineering scale. At normal zoom
         * this made the axes dramatically thicker than the
         * rest of the drawing.
         */
        const axisWidth =
            Math.max(
                1,
                Math.min(
                    1.5,
                    (
                        Number(
                            style.lineWidth
                        ) || 0.5
                    ) * 1.4
                )
            );

        const opacity =
            isPreview
                ? "0.45"
                : null;

        /*
         * Positive X axis
         */
        const xAxis =
            createSvgElement(
                "line",
                {
                    x1: origin.x,
                    y1: origin.y,
                    x2:
                        origin.x +
                        xAxisLength,
                    y2: origin.y,
                    stroke:
                        axisColor,
                    "stroke-width":
                        axisWidth,
                    "stroke-linecap":
                        "butt"
                }
            );

        const xAxisNegative = createSvgElement("line", {
            x1: origin.x - xNegativeLength,
            y1: origin.y,
            x2: origin.x,
            y2: origin.y,
            stroke: axisColor,
            "stroke-width": axisWidth,
            "stroke-linecap": "butt"
        });

        /*
         * Positive Y axis
         */
        const yAxis =
            createSvgElement(
                "line",
                {
                    x1: origin.x,
                    y1: origin.y,
                    x2: origin.x,
                    y2:
                        origin.y -
                        yAxisLength,
                    stroke:
                        axisColor,
                    "stroke-width":
                        axisWidth,
                    "stroke-linecap":
                        "butt"
                }
            );

        const yAxisNegative = createSvgElement("line", {
            x1: origin.x,
            y1: origin.y,
            x2: origin.x,
            y2: origin.y + yNegativeLength,
            stroke: axisColor,
            "stroke-width": axisWidth,
            "stroke-linecap": "butt"
        });

        /*
         * X arrowhead
         */
        const xArrow =
            createSvgElement(
                "path",
                {
                    d:
                        `M ${origin.x + xAxisLength} ${origin.y}
                         L ${origin.x + xAxisLength - 7} ${origin.y - 3}
                         L ${origin.x + xAxisLength - 7} ${origin.y + 3}
                         Z`,
                    fill:
                        axisColor
                }
            );

        /*
         * Y arrowhead
         */
        const yArrow =
            createSvgElement(
                "path",
                {
                    d:
                        `M ${origin.x} ${origin.y - yAxisLength}
                         L ${origin.x - 3} ${origin.y - yAxisLength + 7}
                         L ${origin.x + 3} ${origin.y - yAxisLength + 7}
                         Z`,
                    fill:
                        axisColor
                }
            );

        const originMarker =
            createSvgElement(
                "circle",
                {
                    cx: origin.x,
                    cy: origin.y,
                    r: 3,
                    fill:
                        "#ffffff",
                    stroke:
                        axisColor,
                    "stroke-width":
                        1
                }
            );

        /*
         * X label
         *
         * There is intentionally only one coordinate-system
         * renderer now. drawing.js no longer overlays another
         * copy of these labels.
         */
        const xLabel =
            createSvgElement(
                "text",
                {
                    x:
                        origin.x +
                        xAxisLength +
                        7,
                    y:
                        origin.y + 4,
                    fill:
                        axisColor,
                    "font-size":
                        zoomedFontHere(11),
                    "font-family":
                        "Arial, sans-serif",
                    "font-weight":
                        600
                }
            );

        xLabel.textContent =
            "X";

        /*
         * Y label
         */
        const yLabel =
            createSvgElement(
                "text",
                {
                    x:
                        origin.x + 5,
                    y:
                        origin.y -
                        yAxisLength -
                        7,
                    fill:
                        axisColor,
                    "font-size":
                        zoomedFontHere(11),
                    "font-family":
                        "Arial, sans-serif",
                    "font-weight":
                        600
                }
            );

        yLabel.textContent =
            "Y";

        const elements = [
            xAxis,
            xAxisNegative,
            yAxis,
            yAxisNegative,
            xArrow,
            yArrow,
            originMarker,
            xLabel,
            yLabel
        ];

        if (opacity) {
            elements.forEach(
                element =>
                    element.setAttribute(
                        "opacity",
                        opacity
                    )
            );
        }

        /*
         * THE ELEMENTS GO INTO THE GROUP, NOT STRAIGHT INTO THE SVG. When the
         * axis is rotated the group carries the rotation, so appending to the
         * svg would draw a rotated axis in the unrotated place.
         */
        group.append(
            ...elements
        );

        if (group !== svg) {
            svg.appendChild(group);
        }
    }

    /*
     * Draw a rigid body in whichever shape it currently has.
     *
     * Each shape is a real closed outline, so a body reads as
     * the body the student chose rather than as a stand-in
     * drawn with whatever primitive was to hand. The shape is
     * taken from the shared geometry module, which is also
     * what the handles and the transforms read, so a change of
     * shape moves through all three together.
     */
    function appendRigidBody(svg, entity, geometry, style, toScreen, scale) {
        const shape =
            enggFeatureGeometry.rigidBodyShape(geometry);

        if (shape === "circle") {
            const center = toScreen(geometry.center || { x: 0, y: 0 });
            const radius =
                (Number(geometry.radius) || 0) * scale;

            const circle = createSvgElement("circle", {
                cx: center.x,
                cy: center.y,
                r: radius
            });

            applyStyle(circle, style);
            svg.appendChild(circle);
            return;
        }

        if (shape === "polygon") {
            const vertices = enggDrawingState
                .polygonVertices(geometry)
                .map(toScreen);

            if (vertices.length < 3) return;

            const polygon = createSvgElement("polygon", {
                points: vertices
                    .map(v => `${v.x},${v.y}`)
                    .join(" ")
            });

            applyStyle(polygon, style);
            svg.appendChild(polygon);
            return;
        }

        if (shape === "triangle") {
            const points = (geometry.points || []).filter(Boolean).map(toScreen);

            if (points.length < 3) return;

            const polygon = createSvgElement("polygon", {
                points: points
                    .map(v => `${v.x},${v.y}`)
                    .join(" ")
            });

            applyStyle(polygon, style);
            svg.appendChild(polygon);
            return;
        }

        /*
         * A rectangle. Its corners come from the shared module
         * so the drawn outline is the same outline the
         * transforms act on.
         */
        const corners = enggFeatureGeometry
            .rectangleCorners(geometry)
            .map(toScreen);

        if (corners.length < 3) return;

        const polygon = createSvgElement("polygon", {
            points: corners
                .map(v => `${v.x},${v.y}`)
                .join(" ")
        });

        applyStyle(polygon, style);
        svg.appendChild(polygon);
    }

export {
    appendSupportSymbol,
    appendConnectionSymbol,
    appendCoordinateSystem,
    appendRigidBody
};
