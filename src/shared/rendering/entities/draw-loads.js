/*
 * Drawing one feature: Moments and distributed loads (uniform and varying).
 *
 * Each function draws one kind of feature into its group, from the context
 * appendEntity (entity-render.js) builds. It returns true when the feature
 * is finished, so no later renderer in the table runs for it.
 */
import { appendDerivedMagnitude } from "../annotation-render.js";
import { appendRotationalArrow, arrowheadDirection, arrowheadTip, distributedLoadArrowHead, distributedLoadArrowLength, forceEndpoints, forceStrokeWidth, momentIsClockwise, vectorScaleOf } from "../vector-render.js";
import { createSvgElement, paintColour, styledLine } from "../svg-primitives.js";
import enggDrawingState from "../../model/drawing-state.js";
import enggLoadProfile from "../../../features/workspace/model/analysis/load-profile.js";
import enggTheme from "../../../components/layout/workspace/theme.js";

        /*
         * A MOMENT.
         *
         * A curved rotational arrow, drawn by the shared renderer, so
         * there is one place that knows how a moment looks.
         *
         * The direction arrives as the word "CCW" or "CW" and is
         * converted in exactly one function, so the renderer, the hit
         * test and the Features panel cannot each arrive at a
         * different sense for the same feature.
         */
    export function drawMoment({ svg, parentSvg, entity, state, geometry, style, toScreen }) {
            const position = geometry.position;

            if (
                !position ||
                !Number.isFinite(position.x) ||
                !Number.isFinite(position.y)
            ) {
                return true;
            }

            appendRotationalArrow(
                svg,
                toScreen(position),
                momentIsClockwise(geometry),
                style,
                geometry.arcRadius
            );

            appendDerivedMagnitude(svg, entity, state, toScreen, style);
            parentSvg.appendChild(svg);
            return true;
        }


        /*
         * DISTRIBUTED LOAD
         *
         * One coherent feature: a body with a continuous field of
         * force vectors along it, which is how a distributed load
         * is read.
         *
         * The arrows are the renderer SAMPLING that one load, not a
         * row of separate Point Forces. They are sampled at the
         * load's interval and their lengths follow the profile the
         * student defined between their magnitude points, and every
         * one of them points the same way: along the load's own
         * direction, which was fixed by the first force. A body at
         * an angle does not rotate them, because the load
         * direction and the body direction are independent
         * quantities.
         */
    export function drawUniformLoad({ svg, parentSvg, entity, state, geometry, style, toScreen }) {
            const start = geometry.start;
            const end = geometry.end;

            if (
                !start || !end ||
                !Number.isFinite(start.x) ||
                !Number.isFinite(end.x)
            ) {
                return true;
            }

            const from = toScreen(start);
            const to = toScreen(end);
            const stroke = paintColour(style.stroke || enggTheme.defaultLineColour());

            svg.appendChild(
                createSvgElement("line", {
                    x1: from.x,
                    y1: from.y,
                    x2: to.x,
                    y2: to.y,
                    stroke,
                    "stroke-width": 1.4
                })
            );

            if (
                typeof enggLoadProfile ===
                "undefined"
            ) {
                return true;
            }

            /*
             * NO DIRECTION, NO LOAD DRAWN.
             *
             * `loadDirection` reports null when the student has marked the
             * direction unknown. There is no authoritative angle then, so
             * drawing arrows would assert one - a load pointing straight
             * down while its panel shows a blank field. The span and the
             * body are still drawn above, so the feature is still visible
             * and selectable; only the arrows wait for a direction.
             */
            const storedDirection =
                enggLoadProfile.loadDirection(
                    geometry
                );

            if (
                !Number.isFinite(
                    Number(storedDirection)
                )
            ) {
                appendDerivedMagnitude(
                    svg,
                    entity,
                    state,
                    toScreen,
                    style
                );
                parentSvg.appendChild(svg);
                return true;
            }

            const direction =
                enggLoadProfile.unitVector(
                    storedDirection
                );

            /*
             * Where the force LINES are drawn, and which end of
             * each carries the arrowhead. Neither is the other, and
             * neither is derived from the other's change.
             */
            const normal =
                enggLoadProfile.loadBodyNormal(
                    geometry
                );

            const reversed =
                enggLoadProfile.isLoadReversed(
                    geometry
                );

            const samples =
                enggLoadProfile.arrowSamples(
                    geometry
                );

            /*
             * Arrows are drawn at their true magnitude, so the
             * load's own scale is what decides the length. A
             * load drawn far from the origin must not produce
             * enormous arrows, and a large one must not be
             * flattened to the same size as a small one, so the
             * magnitude is measured in world units and only the
             * on-screen size follows the zoom.
             */
            const scale =
                enggDrawingState
                    .BASE_PIXELS_PER_UNIT *
                state.camera.zoom;

            const shaft =
                forceStrokeWidth(
                    style,
                    scale
                );

            samples.forEach(sample => {
                /*
                 * A zero magnitude draws nothing rather than a
                 * stub, so the ends of a triangular load genuinely
                 * taper to nothing.
                 */
                if (sample.magnitude <= 0) {
                    return;
                }

                const length =
                    distributedLoadArrowLength(
                        sample.magnitude,
                        scale,
                        vectorScaleOf(state)
                    );

                /*
                 * The two ends of the drawn line, from the body's
                 * outward normal rather than from the force
                 * direction. Reversing the load cannot move either
                 * of them.
                 */
                const endpoints =
                    forceEndpoints(
                        toScreen(sample.base),
                        direction,
                        length,
                        normal
                    );

                const tip =
                    arrowheadTip(
                        endpoints,
                        direction,
                        reversed
                    );

                const headDirection =
                    arrowheadDirection(
                        endpoints,
                        reversed
                    );

                svg.appendChild(
                    styledLine(
                        endpoints.application,
                        endpoints.far,
                        style,
                        shaft
                    )
                );

                svg.appendChild(
                    createSvgElement("polygon", {
                        points: distributedLoadArrowHead(
                            tip,
                            headDirection,
                            length,
                            shaft
                        ),
                        fill: stroke,
                        stroke: "none"
                    })
                );
            });

            /*
             * The force-profile outline.
             *
             * The arrows alone show the magnitudes one at a time,
             * but a load's defining feature is how the magnitude
             * CHANGES along the body, and that is a shape. This
             * draws that shape: a single line from the tip of the
             * first arrow to the tip of the last, closed along the
             * body, so the envelope of the field is one readable
             * curve.
             *
             * It is drawn for both loads. A Varying Distributed Load
             * gives a real profile curve; a constant one gives a
             * rectangle joining the tip of the first arrow to the
             * tip of the last, which is exactly how a uniform load is
             * conventionally drawn.
             *
             * The outline is part of the load's visual definition
             * and is not a construction aid, so it stays once the
             * load is finished and is drawn in the load's own
             * stroke rather than as a preview.
             */
            const profilePointsList =
                Array.isArray(geometry.points)
                    ? geometry.points
                    : [];

            const isVaryingProfile =
                profilePointsList.length > 2 ||
                (
                    profilePointsList.length === 2 &&
                    profilePointsList[0].magnitude !==
                        profilePointsList[1].magnitude
                );

            if (samples.length > 1) {
                const outline = [
                    /*
                     * The envelope follows the very tips that were
                     * just drawn, using the same body-normal endpoints
                     * the arrows used. Deriving it from the force
                     * direction instead would swing the whole profile
                     * to the opposite side of the body on reversal, and
                     * the outline would no longer enclose its arrows.
                     */
                    /*
                 * The envelope follows the very tips that were just
                 * drawn, using the same body-normal endpoints the arrows
                 * used. Deriving it from the force direction instead would
                 * swing the whole profile to the opposite side of the body
                 * on reversal, and the outline would no longer enclose its
                 * arrows.
                 *
                 * ========================================================
                 * ALWAYS THE FAR END, NEVER THE HEAD'S END
                 * ========================================================
                 *
                 * This used to read
                 *
                 *     const tip = reversed
                 *         ? drawn.application
                 *         : drawn.far;
                 *
                 * which is the arrowhead's rule applied to the outline.
                 * It is the wrong rule, and it made a reversed load lose
                 * its outline entirely: every sample's envelope point
                 * became its own application point, all of which lie ON
                 * the body, so the envelope collapsed onto the centreline
                 * and the polygon degenerated to the loaded region with no
                 * height at all.
                 *
                 * THE TWO QUESTIONS ARE DIFFERENT, AND MUST NOT SHARE AN
                 * ANSWER.
                 *
                 *   Which end carries the HEAD?   `reversed` decides it.
                 *   Which end is the ARROW'S FAR END?   Nothing decides it -
                 *                                            it is a
                 *                                            geometric fact.
                 *
                 * Reversing changes the first and cannot change the second.
                 * A load pointing up and the same load pointing down draw
                 * the same envelope over the same region; only the heads
                 * sit on the other end. Reading `reversed` here is what
                 * made the outline depend on the arrowhead's placement,
                 * which is a property of the arrow rather than of the
                 * region it belongs to.
                 */
                ...samples.map(sample => {
                    const drawn = forceEndpoints(
                        toScreen(sample.base),
                        direction,
                        distributedLoadArrowLength(
                            sample.magnitude,
                            scale,
                            vectorScaleOf(state)
                        ),
                        normal
                    );

                    return `${drawn.far.x},${drawn.far.y}`;
                }),

                    /*
                     * Closed back along the body, so the outline
                     * is a region rather than a floating line.
                     */
                    ...samples
                        .slice()
                        .reverse()
                        .map(sample =>
                            toScreen(
                                sample.base
                            )
                        )
                        .map(point =>
                            `${point.x},${point.y}`
                        )
                ];

                svg.appendChild(
                    createSvgElement("polygon", {
                        points: outline.join(" "),
                        fill: stroke,

                        /*
                         * A varying profile is a real shape worth
                         * shading. A constant load's outline is a plain
                         * rectangle, so it is left unfilled and the
                         * rectangle alone carries the meaning.
                         */
                        "fill-opacity": isVaryingProfile ? 0.12 : 0.04,
                        stroke,
                        "stroke-width": 1,
                        "stroke-opacity": isVaryingProfile ? 0.55 : 0.4,

                        /*
                         * The load's profile is an ENVELOPE, not a
                         * filled region. Marking it as such lets the
                         * selection state recolour its stroke without
                         * ever filling the area under the load, which
                         * would hide the very arrows being selected.
                         */
                        class: "drawing-load-profile"
                    })
                );
            }

            appendDerivedMagnitude(svg, entity, state, toScreen, style);
            parentSvg.appendChild(svg);
            return true;
        }


        /*
         * VARYING DISTRIBUTED LOAD
         *
         * The same body and the same parallel field of arrows as a
         * Distributed Load, differing only in how the magnitude
         * varies: this one is defined by an intensity at each end
         * rather than by a profile of points. It reads through the
         * shared profile module so both loads are one continuous
         * field pointing the same way.
         */
    export function drawVaryingLoad({ svg, parentSvg, entity, state, geometry, style, toScreen }) {
            const start = geometry.start;
            const end = geometry.end;

            if (
                !start || !end ||
                !Number.isFinite(start.x) ||
                !Number.isFinite(end.x)
            ) {
                return true;
            }

            const from = toScreen(start);
            const to = toScreen(end);
            const stroke = paintColour(style.stroke || enggTheme.defaultLineColour());

            svg.appendChild(
                createSvgElement("line", {
                    x1: from.x,
                    y1: from.y,
                    x2: to.x,
                    y2: to.y,
                    stroke,
                    "stroke-width": 1.4
                })
            );

            if (
                typeof enggLoadProfile ===
                "undefined"
            ) {
                return true;
            }

            /*
             * The two end intensities are expressed as the
             * profile the shared module samples, so the taper and
             * the arrow lengths are identical in kind to those of
             * a Distributed Load.
             */
            const profile = {
                start,
                end,

                points: [
                    {
                        t: 0,
                        magnitude: Math.max(
                            0,
                            Math.abs(
                                Number(
                                    geometry.startIntensity
                                ) || 0
                            )
                        )
                    },
                    {
                        t: 1,
                        magnitude: Math.max(
                            0,
                            Math.abs(
                                Number(
                                    geometry.endIntensity
                                ) || 0
                            )
                        )
                    }
                ]
            };

            const direction =
                enggLoadProfile.unitVector(
                    enggLoadProfile.loadDirection(
                        geometry
                    )
                );

            /*
             * Where the force LINES are drawn, and which end of
             * each carries the arrowhead. The profile below is
             * derived from the far ends, so it traces the same
             * envelope whichever way the arrows point.
             */
            const normal =
                enggLoadProfile.loadBodyNormal(
                    geometry
                );

            const reversed =
                enggLoadProfile.isLoadReversed(
                    geometry
                );

            /*
             * Drawn at the true magnitude in world units, as the
             * Distributed Load is, so both load tools scale the
             * same way and neither stops growing at a ceiling.
             */
            const scale =
                enggDrawingState
                    .BASE_PIXELS_PER_UNIT *
                state.camera.zoom;

            const samples =
                enggLoadProfile.arrowSamples(
                    profile
                );

            const outline = [];
            const back = [];

            const shaft =
                forceStrokeWidth(
                    style,
                    scale
                );

            samples.forEach(sample => {
                if (sample.magnitude <= 0) {
                    return;
                }

                const length =
                    distributedLoadArrowLength(
                        sample.magnitude,
                        scale,
                        vectorScaleOf(state)
                    );

                /*
                 * The two ends of the drawn line, from the body's
                 * outward normal rather than from the force
                 * direction, so a reversal cannot move either.
                 */
                const endpoints =
                    forceEndpoints(
                        toScreen(sample.base),
                        direction,
                        length,
                        normal
                    );

                const tip =
                    arrowheadTip(
                        endpoints,
                        direction,
                        reversed
                    );

                svg.appendChild(
                    styledLine(
                        endpoints.application,
                        endpoints.far,
                        style,
                        shaft
                    )
                );

                svg.appendChild(
                    createSvgElement("polygon", {
                            points: distributedLoadArrowHead(
                                tip,
                                arrowheadDirection(
                                    endpoints,
                                    reversed
                                ),
                                length,
                                shaft
                            ),
                            fill: stroke,
                            stroke: "none"
                        })
                    );

                /*
                 * The envelope is traced through the FAR ends, not
                 * through the arrowheads, so reversing the load
                 * leaves the profile's shape exactly where it was.
                 */
                outline.push(
                    `${endpoints.far.x},${endpoints.far.y}`
                );
                back.unshift(
                    `${endpoints.application.x},${endpoints.application.y}`
                );
            });

            /*
             * The profile outline, joined across the arrow tips and
             * closed along the body, so the load reads as one
             * continuous field with a visible shape rather than as
             * a row of unrelated arrows. Constant end intensities
             * give a rectangle; different ones give the taper.
             */
            if (outline.length > 1) {
                svg.appendChild(
                    createSvgElement("polygon", {
                        points: outline
                            .concat(back)
                            .join(" "),
                        fill: stroke,
                        "fill-opacity": 0.12,
                        stroke,
                        "stroke-width": 1,
                        "stroke-opacity": 0.55,

                        /*
                         * The profile is an envelope, not a filled
                         * region. See the equivalent mark on the
                         * Distributed Load: the selection state
                         * recolours this stroke and must never fill
                         * the area it encloses.
                         */
                        class: "drawing-load-profile"
                    })
                );
            }

            appendDerivedMagnitude(svg, entity, state, toScreen, style);
            parentSvg.appendChild(svg);
            return true;
        }
