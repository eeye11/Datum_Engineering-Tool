/*
 * Drawing one feature: members (beams, trusses, cables and shafts) and
 * analysis diagrams, which share the member path.
 *
 * Each function draws one kind of feature into its group, from the context
 * appendEntity (entity-render.js) builds. It returns true when the feature
 * is finished, so no later renderer in the table runs for it.
 */
import { ANALYSIS_DIAGRAM_AXES, ANALYSIS_DIAGRAM_TINTS, MAX_TICKS_PER_AXIS, analysisFrameExtents, analysisValueScale, appendAnalysisPlot, appendAnalysisSketch, numberText, tickValues } from "../analysis-render.js";
import { applyStyle, createSvgElement, dashPatternFor, paintColour, scaledStrokeWidth, zoomedFontHere } from "../svg-primitives.js";
import enggDiagramEquations from "../../../features/workspace/model/analysis/diagram-equations.js";
import enggTheme from "../../../components/layout/workspace/theme.js";
import { BEAM_HALF_DEPTH } from "../latex/symbol-sizes.js";


    /*
     * A force arrow: a straight vector from its application
     * point with a filled arrow head. Length follows the
     * magnitude at a fixed screen scale, so a larger force
     * reads as visibly longer without depending on zoom.
     */
    /*
     * The distinct joints of a set of truss members.
     *
     * A joint is where members meet, so the same point reached
     * by two members is one joint and is drawn once.
     */
    function memberJoints(members) {
        const seen = [];

        members.forEach(member => {
            [member.start, member.end].forEach(point => {
                const known = seen.find(
                    existing =>
                        Math.hypot(
                            existing.x - point.x,
                            existing.y - point.y
                        ) < 1e-6
                );

                if (!known) {
                    seen.push({ x: point.x, y: point.y });
                }
            });
        });

        return seen;
    }


        /*
         * SLENDER STRUCTURAL MEMBERS
         *
         * Beam, truss, cable and shaft are all defined by
         * their two ends, but each is drawn to read as the
         * member it represents rather than as a plain line.
         */
    export function drawMemberOrDiagram({ svg, parentSvg, entity, geometry, style, toScreen }) {
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

            const dx = to.x - from.x;
            const dy = to.y - from.y;
            const length = Math.hypot(dx, dy) || 1;

            /*
             * Unit normal, used to give a member its depth.
             */
            const nx = -dy / length;
            const ny = dx / length;

            if (entity.type === "beam") {
                /*
                 * A beam is a slim outlined bar, so it reads
                 * as a solid member rather than a line.
                 *
                 * THE HALF-DEPTH IS THE SHARED ONE. This used to be a local
                 * `6` applied to BOTH sides (a 12-unit bar), while the source
                 * writer and the Fit-All bounds each used a half-depth of 3 - so
                 * the same beam was twice as deep on the sheet as in the
                 * generated code, and the fit reserved only half of it. One
                 * constant, read by the canvas, the writer and the bounds.
                 */
                /*
                 * THE BEAM'S OWN DEPTH, IN MODEL UNITS, AS THE SOURCE DRAWS IT.
                 * A fixed screen half-depth ignored the Depth the student set
                 * and drew a thinner bar than the supports attached to its
                 * real face, so they floated off it. The bar is scaled from
                 * the model by the same projection as its ends.
                 */
                const modelLength = Math.hypot(end.x - start.x, end.y - start.y);
                const pixelsPerUnit = modelLength > 1e-9 ? length / modelLength : 1;
                const storedDepth = Number(geometry.depth);
                const depth = (storedDepth > 0 ? storedDepth / 2 : BEAM_HALF_DEPTH) * pixelsPerUnit;

                /* And its Features appearance: line style, thickness and fill. */
                const dash = dashPatternFor(style.lineType);
                const solid = String(style.fillMode || "").toLowerCase() === "solid";
                const fillColour = /^#[0-9a-fA-F]{6}$/.test(String(style.fill || "")) ? style.fill : style.stroke;

                svg.appendChild(
                    createSvgElement("polygon", {
                        points: [
                            `${from.x + nx * depth},${from.y + ny * depth}`,
                            `${to.x + nx * depth},${to.y + ny * depth}`,
                            `${to.x - nx * depth},${to.y - ny * depth}`,
                            `${from.x - nx * depth},${from.y - ny * depth}`
                        ].join(" "),
                        fill: solid ? paintColour(fillColour || enggTheme.defaultLineColour()) : "none",
                        stroke,
                        "stroke-width": Number.isFinite(Number(style.lineWidth))
                            ? scaledStrokeWidth(Number(style.lineWidth))
                            : 1.4,
                        ...(dash ? { "stroke-dasharray": dash } : {})
                    })
                );
            } else if (
                entity.type === "analysis-diagram"
            ) {
                /*
                 * A DIAGRAM WHOSE SOURCE IS GONE IS NOT DRAWN.
                 *
                 * This block draws from the diagram's OWN stored start/end,
                 * which is what lets a diagram stand alone with no beam
                 * under it - a blank axis to work against is a legitimate
                 * thing to want, and the fallback path below is for it.
                 *
                 * But the same freedom meant that deleting the beam left
                 * the diagram perfectly intact on the sheet: frame, zero
                 * axis, and the green SFD curve, all still drawn, all
                 * referring to a member that was no longer there. That is
                 * the "a green outline is left behind" report - it was
                 * never a renderer leaking nodes, it was a live feature
                 * still being asked to draw.
                 *
                 * `unresolved` is set by the dependency pass when the
                 * parent has gone, and the same flag is what the
                 * components and resultant branches already honour. So
                 * this is that convention applied to the one feature type
                 * that was missing it - not a new rule.
                 *
                 * A diagram with NO source at all is untouched: it never
                 * claimed a parent, so there is nothing to have lost.
                 */
                const orphaned =
                    entity.engineering?.unresolved === true;

                if (orphaned) {
                    return true;
                }
                /*
                 * AN ANALYSIS TEMPLATE.
                 *
                 * This draws a FRAME and nothing else: a tinted
                 * background, a zero axis to measure against, a
                 * label, and ticks at whatever reference
                 * positions the source feature already had.
                 *
                 * What it deliberately does not draw is the
                 * diagram. No shear jump, no moment curve, no
                 * axial plateau, no value, no sign and no slope -
                 * those are the student's work, and a tool that
                 * drew any of them would be solving the exercise
                 * rather than supporting it. Everything here is
                 * reference, so the student can draw the solution
                 * on top with the ordinary Line and Arc tools.
                 *
                 * Drawn behind everything else and faintly, so it
                 * never competes with the geometry that belongs
                 * on it.
                 */
                const start = geometry.start;
                const end = geometry.end;

                if (
                    !start || !end ||
                    !Number.isFinite(start.x) ||
                    !Number.isFinite(start.y) ||
                    !Number.isFinite(end.x) ||
                    !Number.isFinite(end.y)
                ) {
                    return true;
                }

                const tint =
                    ANALYSIS_DIAGRAM_TINTS[
                        geometry.diagramType
                    ] ||
                    ANALYSIS_DIAGRAM_TINTS.sfd;

                const from = toScreen(start);
                const to = toScreen(end);

                const axisTop = Math.min(from.y, to.y);

                /*
                 * The background is a fixed SCREEN tint rather
                 * than a world-space region, because it is
                 * furniture. If it grew with the drawing's own
                 * height it would cover more of the drawing the
                 * further the student zoomed out, which is the
                 * opposite of subordinate.
                 */
                const frame = analysisFrameExtents();

                /*
                 * THE PLOT-AREA HIGHLIGHT, ONLY ONCE THERE IS SOMETHING
                 * TO HIGHLIGHT.
                 *
                 * It used to be drawn unconditionally, which made an empty
                 * frame look like a finished diagram with nothing in it.
                 * A blank sheet waiting to be worked on and a completed
                 * diagram with a zero curve are different things, and the
                 * student should not have to open the model to tell them
                 * apart.
                 */
                /*
                 * THE PLOT-AREA HIGHLIGHT IS GONE.
                 *
                 * A tinted rectangle used to be laid over the plot area once
                 * the diagram had content. It read as a filled SHAPE rather
                 * than as a frame - and on a BMD/SFD/AFD a filled region is a
                 * statement about the diagram, not about the paper it sits on.
                 * A student looking at a tinted box under a curve cannot tell
                 * the tint from the sick work.
                 *
                 * The axes, the value labels and the curve itself are what say
                 * where the plot area is, so the rectangle added nothing they
                 * did not already say. It is therefore not drawn at all, for
                 * ANY diagram - plot or sketch - so the two modes stay the same
                 * sheet.
                 *
                 * `analysisHasContent` and `backgroundVisible` are left in
                 * place: the flag is still read elsewhere, and removing the
                 * test with the rectangle would change more than the tint.
                 */
                const highlighted = false;

                let background = null;

                if (highlighted) {
                    background = createSvgElement("rect", {
                        x:
                            Math.min(from.x, to.x) -
                            frame.padding,
                        y: axisTop + frame.top,
                        width:
                            Math.abs(to.x - from.x) +
                            frame.right +
                            frame.padding * 2,
                        height:
                            frame.top +
                            frame.bottom +
                            frame.padding * 2,
                        rx: frame.radius,
                        fill: tint,
                        "fill-opacity": 0.1,
                        stroke: "none"
                    });

                    background.setAttribute(
                        "pointer-events",
                        "none"
                    );

                    svg.appendChild(background);
                }

                /* `highlighted` is always false now; kept so the dead branch
                 * reads as deliberate rather than as a leftover. */
                void background;

                /*
                 * The zero axis, at the FEATURE'S OWN line weight.
                 *
                 * It was a literal 1 before, which meant a diagram on a
                 * 0.5 mm sheet was drawn heavier than the beam whose
                 * span it was reporting - the reference framework
                 * shouting over the drawing it exists to support.
                 */
                if (
                    geometry.showZeroAxis !== false
                ) {
                    /*
                     * THE ZERO AXIS RUNS PAST THE BODY.
                     *
                     * It is drawn from the body's near end to a little
                     * beyond its far end, and finished with an arrowhead.
                     * Without the extension the axis stops exactly where
                     * the member does, which reads as "the diagram ends
                     * here" rather than "the beam ends here" - and leaves
                     * nowhere to put the axis label without it sitting on
                     * top of the beam's end.
                     *
                     * THE EXTENSION IS NOT ENGINEERING DOMAIN. `to` stays
                     * the body's far end, so every value is still plotted
                     * against the member and nothing is drawn into the
                     * margin beyond it.
                     */
                    const axisEndX =
                        (from.x <= to.x ? to.x : to.x) +
                        frame.right;

                    const zeroAxis =
                        createSvgElement("line", {
                            x1: from.x,
                            y1: from.y,
                            x2: axisEndX,
                            y2: to.y,
                            stroke,
                            "stroke-width":
                                scaledStrokeWidth(
                                    Number(style.lineWidth) || 0.5
                                ),
                            "stroke-opacity": 0.55
                        });

                    zeroAxis.setAttribute(
                        "pointer-events",
                        "none"
                    );

                    svg.appendChild(zeroAxis);

                    /*
                     * THE AXIS ARROWHEAD, POINTING POSITIVE x.
                     *
                     * Built from the axis's OWN direction - it always runs
                     * left to right, because it is drawn from the near
                     * end to the extension - rather than from a guessed
                     * angle, so it cannot come out backwards for a member
                     * drawn right to left.
                     */
                    const arrowTipX = axisEndX;

                    const head = createSvgElement("path", {
                        d:
                            `M ${arrowTipX} ${to.y}` +
                            ` L ${arrowTipX - frame.arrowHead} ${to.y - frame.arrowHead / 2}` +
                            ` L ${arrowTipX - frame.arrowHead} ${to.y + frame.arrowHead / 2}`,
                        fill: stroke,
                        "fill-opacity": 0.55,
                        stroke: "none"
                    });

                    head.setAttribute(
                        "pointer-events",
                        "none"
                    );

                    svg.appendChild(head);
                }

                /*
                 * Reference stations: short ticks at the
                 * positions carried from the source. Deliberately
                 * just marks, with no values beside them - a
                 * number here would be a result, and a result
                 * does not belong in a template.
                 *
                 * Read from the marker's OWN position, which the
                 * analysis registry places on this axis from the
                 * fraction along the source it represents. It used
                 * to read a bare x and the axis's own y, which only
                 * worked for a diagram that happened to be level
                 * and directly under its source.
                 */
                (
                    geometry.showReferencePositions !==
                        false &&
                    Array.isArray(
                        geometry.referencePositions
                    )
                        ? geometry.referencePositions
                        : []
                ).forEach(reference => {
                    if (
                        !reference ||
                        !reference.position ||
                        !Number.isFinite(
                            reference.position.x
                        )
                    ) {
                        return;
                    }

                    const at = toScreen(
                        reference.position
                    );

                    /*
                     * A tick length that reads at a glance and does
                     * not grow when the student zooms out, so the
                     * framework keeps its subordinate appearance at
                     * any zoom.
                     */
                    const tick =
                        createSvgElement("line", {
                            x1: at.x,
                            y1: at.y - 5,
                            x2: at.x,
                            y2: at.y + 5,
                            stroke,
                            "stroke-width": 0.9,
                            "stroke-opacity": 0.4
                        });

                    tick.setAttribute(
                        "pointer-events",
                        "none"
                    );

                    svg.appendChild(tick);
                });

                /*
                 * ========================================================
                 * WHAT THE TWO AXES MEASURE
                 * ========================================================
                 *
                 * A diagram whose axes are unlabelled asks the student to
                 * plot a value on it without saying which value, and the
                 * axis is the only thing on the sheet distinguishing an SFD
                 * from a BMD. So each axis is named, with its unit, in the
                 * place a reader looks for it: the vertical one turned up
                 * the left-hand end of the axis, the horizontal one along
                 * the bottom.
                 *
                 * ========================================================
                 * TICKS, AND WHY THEY WERE NOT HERE BEFORE
                 * ========================================================
                 *
                 * This used to read:
                 *
                 *   THEY ARE NAMES, NOT VALUES. No magnitude, no sign and no
                 *   scale are printed, because those are the solution and
                 *   the student is the one who works them out. A tick or a
                 *   number here would be the tool answering the exercise.
                 *
                 * That was a considered position, not an oversight -
                 * `tools/check-features-panel.js` actively failed the build
                 * if the axes carried a scale. It has been DELIBERATELY
                 * REVERSED, because a student reading magnitudes off a
                 * gridded axis is doing the exercise, not having it done
                 * for them.
                 *
                 * The distinction that makes this a support rather than an
                 * answer: a tick scale tells a student WHERE a value falls.
                 * It does not say what their value IS. The curve is still
                 * theirs to draw, and nothing here computes a shear, a
                 * moment or a reaction - the axis is a ruler, not a result.
                 *
                 * The scale is opt-in (`showTicks`) and the spacing is the
                 * student's, because a ruler set to the wrong interval is
                 * worse than no ruler: it invites reading a magnitude off a
                 * grid that does not match the answer they are checking.
                 */
                const axes =
                    ANALYSIS_DIAGRAM_AXES[
                        geometry.diagramType
                    ];

                if (axes) {
                    const axisTop =
                        Math.min(from.y, to.y);

                    const axisLeft =
                        Math.min(from.x, to.x);

                    /*
                     * ========================================================
                     * THE Y-AXIS SPANS THE WHOLE GRAPH
                     * ========================================================
                     *
                     * From the TOP of the plot region to the BOTTOM of it -
                     * `frame.top` to `frame.bottom` - and from nothing else.
                     *
                     * It is a property of the GRAPH FRAME, not of what has
                     * been drawn in it. Every version of this that measured
                     * the axis from the content - from the body's height,
                     * from the plotted curve's extent - made the axis
                     * describe the answer rather than the coordinate system
                     * the answer is read against. A student checking
                     * whether a jump is the right size was reading it off an
                     * axis that had been resized by the jump.
                     *
                     * So it is drawn from the same two numbers the plot-area
                     * highlight and the plot mapping are drawn from, and it
                     * is the same length whether the graph is empty, has a
                     * sketch on it, or is full of a Plot's expressions.
                     *
                     * THE ARROW IS ON THE POSITIVE END ONLY. A two-headed
                     * vertical axis would say the ordinate has two positive
                     * directions, which is not what it means.
                     */
                    const arrowTop =
                        axisTop + frame.top;

                    const arrowBottom =
                        axisTop + frame.bottom;

                    const axisArrow =
                        createSvgElement("path", {
                            d:
                                `M ${axisLeft} ${arrowBottom}` +
                                ` L ${axisLeft} ${arrowTop}`,
                            fill: "none",
                            stroke,
                            "stroke-width": 0.9,
                            "stroke-opacity": 0.55
                        });

                    axisArrow.setAttribute(
                        "pointer-events",
                        "none"
                    );

                    svg.appendChild(axisArrow);

                    const axisHead =
                        createSvgElement("path", {
                            d:
                                `M ${axisLeft - 2.5} ${arrowTop + 4}` +
                                ` L ${axisLeft} ${arrowTop}` +
                                ` L ${axisLeft + 2.5} ${arrowTop + 4}`,
                            fill: stroke,
                            "fill-opacity": 0.55,
                            stroke: "none"
                        });

                    axisHead.setAttribute(
                        "pointer-events",
                        "none"
                    );

                    svg.appendChild(axisHead);

                    /*
                     * The ordinate's name, set vertically so it reads
                     * along its own axis rather than across the
                     * diagram it labels.
                     */
                    const yName =
                        createSvgElement("text", {
                            x: axisLeft - 5,
                            y:
                                axisTop +
                                frame.top / 2,
                            "font-size": zoomedFontHere(8),
                            fill: stroke,
                            "fill-opacity": 0.75,

                            /*
                             * Rotated onto the axis rather than
                             * laid out horizontally, because a
                             * horizontal caption in the left margin
                             * would have to be short enough to fit
                             * there, and "Bending moment" is not.
                             */
                            transform:
                                `rotate(-90 ${
                                    axisLeft - 5
                                } ${axisTop + frame.top / 2})`,
                            "text-anchor": "middle"
                        });

                    yName.setAttribute(
                        "pointer-events",
                        "none"
                    );

                    yName.textContent =
                        axes.y + " (" + axes.unit + ")";

                    svg.appendChild(yName);

                    /*
                     * THE X-AXIS LABEL, AT THE END OF THE AXIS.
                     *
                     * It used to sit under the middle of the axis and
                     * read "Distance along beam". Both are wrong for a
                     * reader: the middle of the axis is where the
                     * diagram is, not where its name belongs, and the
                     * axis is an axis, so it takes the symbol and the
                     * unit the rest of the drawing uses - "x (m)".
                     *
                     * Placed just beyond the arrowhead, so it labels the
                     * direction the arrow points in.
                     */
                    const xName =
                        createSvgElement("text", {
                            x:
                                (from.x <= to.x ? to.x : from.x) +
                                frame.right +
                                frame.arrowHead +
                                frame.labelGap,
                            y: to.y + 3,
                            "font-size": zoomedFontHere(8),
                            fill: stroke,
                            "fill-opacity": 0.75,
                            "text-anchor": "start"
                        });

                    xName.setAttribute(
                        "pointer-events",
                        "none"
                    );

                    xName.textContent =
                        axes.x + " (" + axes.xUnit + ")";

                    svg.appendChild(xName);

                    /*
                     * ========================================================
                     * THE TICKS THEMSELVES
                     * ========================================================
                     *
                     * Drawn last, over the marks but under nothing - they are
                     * reference, so they go down before the student's curve
                     * goes on top.
                     *
                     * The ordinate numbers are produced by walking BACK
                     * from zero through the same unit height the curve is
                     * drawn with. Computing them any other way - scaling the
                     * frame, or reusing the plot editor's screen box - would
                     * put the marks at values the curve does not have, and a
                     * student reading 10 off a tick that is not at 10 is
                     * worse off than one with no ticks at all.
                     */
                    if (geometry.showTicks === true) {
                        const range = geometry.localRange;

                        const xSpacing = Number(
                            geometry.xTickSpacing
                        );

                        const ySpacing = Number(
                            geometry.yTickSpacing
                        );

                        if (range) {
                            const rangeWidth =
                                range.to - range.from;

                            /*
                             * The ordinate's scale, resolved the same way
                             * for the ticks as for the curve.
                             */
                            const equations =
                                enggDiagramEquations;

                            let peak = 0;

                            if (equations) {
                                peak = equations.peakMagnitude(
                                    equations.readPlot(geometry)
                                );
                            }

                            const { unitHeight } =
                                analysisValueScale(
                                    geometry,
                                    rangeWidth,
                                    peak
                                );

                            /*
                             * THE PLOT REGION'S TOP AND BOTTOM.
                             *
                             * `axisTop` above is the SCREEN y of the axis line
                             * itself; these are the edges of the frame it
                             * sits in. Ticks are placed against the FRAME,
                             * because a tick outside the frame is a mark on
                             * nothing.
                             */
                            const tickTop =
                                axisTop + frame.top;

                            const tickBottom =
                                axisTop + frame.bottom;

                            /*
                             * X TICKS, at stations along the member.
                             */
                            tickValues(
                                range.from,
                                range.to,
                                xSpacing,
                                MAX_TICKS_PER_AXIS
                            ).forEach(station => {
                                const t =
                                    (station - range.from) /
                                    rangeWidth;

                                const at = toScreen({
                                    x:
                                        from.x +
                                        (to.x - from.x) * t,
                                    y: from.y,
                                });

                                const mark =
                                    createSvgElement("line", {
                                        x1: at.x,
                                        y1: at.y - 3,
                                        x2: at.x,
                                        y2: at.y + 3,
                                        stroke,
                                        "stroke-width": 0.9,
                                        "stroke-opacity": 0.4
                                    });

                                mark.setAttribute(
                                    "pointer-events",
                                    "none"
                                );

                                svg.appendChild(mark);

                                const label =
                                    createSvgElement("text", {
                                        x: at.x,
                                        y: at.y + 11,
                                        "font-size": zoomedFontHere(7),
                                        fill: stroke,
                                        "fill-opacity": 0.7,
                                        "text-anchor": "middle"
                                    });

                                label.textContent =
                                    numberText(station);

                                label.setAttribute(
                                    "pointer-events",
                                    "none"
                                );

                                svg.appendChild(label);
                            });

                            /*
                             * Y TICKS, at real VALUES.
                             *
                             * From zero outwards, so the sequence is the
                             * one a student reads: 0, then the spacing, then
                             * twice it. Every tick carries its sign, because
                             * a diagram has a positive and a negative side
                             * and an unlabelled one is a diagram half of
                             * which cannot be read.
                             */
                            /*
                             * Y TICKS, at real VALUES.
                             *
                             * From zero outwards, so the sequence is the one
                             * a student reads: 0, the spacing, twice it. Each
                             * carries its sign, because a diagram has a
                             * positive and a negative side and an unlabelled
                             * one is a diagram half of which cannot be read.
                             */
                            if (unitHeight && ySpacing > 0) {
                                const reachable =
                                    (tickBottom -
                                        tickTop) /
                                    unitHeight;

                                [
                                    1, -1,
                                ].forEach(sign => {
                                    for (
                                        let step = 1;
                                        step * ySpacing <=
                                                reachable &&
                                            step <
                                                MAX_TICKS_PER_AXIS;
                                        step++
                                    ) {
                                        const value =
                                            sign *
                                            step *
                                            ySpacing;

                                        const at = toScreen(
                                                {
                                                    x: from.x,
                                                    y:
                                                        from.y +
                                                        value *
                                                            unitHeight,
                                                }
                                            );

                                        const mark =
                                            createSvgElement(
                                                "line",
                                                {
                                                    x1:
                                                        axisLeft -
                                                        3,
                                                    y1: at.y,
                                                    x2:
                                                        axisLeft +
                                                        3,
                                                    y2: at.y,
                                                    stroke,
                                                    "stroke-width":
                                                        0.9,
                                                    "stroke-opacity":
                                                        0.4
                                                }
                                            );

                                        mark.setAttribute(
                                            "pointer-events",
                                            "none"
                                        );

                                        svg.appendChild(mark);

                                        const label =
                                            createSvgElement(
                                                "text",
                                                {
                                                    x:
                                                        axisLeft -
                                                        5,
                                                    y: at.y + 2.5,
                                                    "font-size": zoomedFontHere(7),
                                                    fill: stroke,
                                                    "fill-opacity":
                                                        0.7,
                                                    "text-anchor":
                                                        "end"
                                                }
                                            );

                                        label.textContent =
                                            numberText(value);

                                        label.setAttribute(
                                            "pointer-events",
                                            "none"
                                        );

                                        svg.appendChild(label);
                                    }
                                });
                            }
                        }
                    }
                }

                /*
                 * ========================================================
                 * PLOT MODE: THE STUDENT'S OWN EXPRESSIONS, DRAWN
                 * ========================================================
                 *
                 * Only a Plot carries a curve. A Sketch deliberately
                 * does not: the student draws the answer by hand with
                 * the ordinary Line and Arc tools, and this tool supplying it
                 * would be solving the exercise rather than supporting
                 * it.
                 *
                 * THE CURVE IS DERIVED FROM THE EXPRESSION EVERY FRAME.
                 * The sample points are not stored on the feature - the
                 * expressions and their ranges are - so editing a range
                 * or correcting a sign re-derives the shape instead of
                 * dragging vertices around. That is what keeps the
                 * feature data authoritative rather than the drawing.
                 *
                 * MAPPED ONTO THE MEMBER'S OWN AXIS, so a station at 2 m
                 * sits directly under the station at 2 m on the beam
                 * above. The horizontal position comes from the
                 * fraction along the frame, never from a screen
                 * coordinate, and the vertical one from the value the
                 * equation returns. NEITHER IS READ FROM THE RENDERER,
                 * so the curve is the same curve at any zoom.
                 *
                 * WHATEVER KIND OF RELATION IT IS. A vertical line is
                 * drawn from its own stored position and range, and is
                 * never nudged into looking like a function - see
                 * appendAnalysisPlot.
                 */
                if (geometry.mode === "plot") {
                    appendAnalysisPlot(
                        svg,
                        geometry,
                        toScreen,
                        tint,
                        scaledStrokeWidth(
                            Number(style.lineWidth) || 0.5
                        )
                    );
                }

                /*
                 * ========================================================
                 * A SKETCH, DRAWN ON THE SHEET
                 * ========================================================
                 *
                 * The hand-drawn half of an analysis diagram. Its elements
                 * are ENGINEERING points - x being the body's longitudinal
                 * station and y the value on the vertical axis - and they are
                 * projected through the same `toScreen` as everything else,
                 * so a sketch lines up with the axis it was drawn against.
                 *
                 * DRAWN HERE, NOT AS FEATURES. An element is not a Line in
                 * the document: it belongs to the diagram, moves with it and
                 * is deleted with it. As a document feature a student could
                 * select it on its own, drag it off the diagram it belongs
                 * to, and delete it while the diagram remained - none of
                 * which is something a part of a diagram should be able to
                 * do.
                 *
                 * The same colour as the plotted alternative, because it IS
                 * the same thing: the student's answer for this diagram, in
                 * whichever of the two modes they chose to give it.
                 */
                if (geometry.mode === "sketch") {
                    appendAnalysisSketch(
                        svg,
                        geometry,
                        toScreen,
                        tint
                    );
                }
            } else if (entity.type === "truss") {
                /*
                 * A truss is drawn as the structure the student
                 * constructed: their own members, between their
                 * own joints. When a truss has no stored
                 * members it falls back to the two-chord form,
                 * so a truss from an older file still reads as
                 * one.
                 *
                 * The members are rendering of this one feature:
                 * they are never selectable on their own and
                 * never appear in the tree.
                 */
                const members = geometry.members;

                if (
                    Array.isArray(members) &&
                    members.length
                ) {
                        members.forEach(member => {
                            const a = toScreen(member.start);
                            const b = toScreen(member.end);

                            svg.appendChild(
                                createSvgElement("line", {
                                    x1: a.x,
                                    y1: a.y,
                                    x2: b.x,
                                    y2: b.y,
                                    stroke,
                                    "stroke-width": 1.4
                                })
                            );
                        });

                        memberJoints(members).forEach(joint => {
                            const point = toScreen(joint);

                            svg.appendChild(
                                createSvgElement("circle", {
                                    cx: point.x,
                                    cy: point.y,
                                    r: 3,
                                    fill: "#ffffff",
                                    stroke,
                                    "stroke-width": 1.4
                                })
                            );
                        });
                    } else {
                    /*
                     * A truss from an older file, or one drawn
                     * before the progressive construction, falls
                     * back to the two-chord form so it still reads
                     * as a single structure.
                     */
                    const depth = 12;
                    const panels = Math.max(2, Math.round(Number(geometry.panels) || 4));

                    const topFrom = { x: from.x + nx * depth, y: from.y + ny * depth };
                    const topTo = { x: to.x + nx * depth, y: to.y + ny * depth };
                    const botFrom = { x: from.x - nx * depth, y: from.y - ny * depth };
                    const botTo = { x: to.x - nx * depth, y: to.y - ny * depth };

                    [
                        [topFrom, topTo],
                        [botFrom, botTo]
                    ].forEach(([a, b]) => {
                        svg.appendChild(
                            createSvgElement("line", {
                                x1: a.x, y1: a.y, x2: b.x, y2: b.y,
                                stroke,
                                "stroke-width": 1.4
                            })
                        );
                    });

                    for (let i = 0; i <= panels; i += 1) {
                    const t = i / panels;
                    const chordA = {
                        x: topFrom.x + (topTo.x - topFrom.x) * t,
                        y: topFrom.y + (topTo.y - topFrom.y) * t
                    };
                    const chordB = {
                        x: botFrom.x + (botTo.x - botFrom.x) * t,
                        y: botFrom.y + (botTo.y - botFrom.y) * t
                    };
                    const nextB = {
                        x: botFrom.x + (botTo.x - botFrom.x) * ((i + 1) / panels),
                        y: botFrom.y + (botTo.y - botFrom.y) * ((i + 1) / panels)
                    };

                    svg.appendChild(
                        createSvgElement("line", {
                            x1: chordA.x, y1: chordA.y,
                            x2: chordB.x, y2: chordB.y,
                            stroke,
                            "stroke-width": 1
                        })
                    );

                    if (i < panels) {
                        svg.appendChild(
                            createSvgElement("line", {
                                x1: chordA.x, y1: chordA.y,
                                x2: nextB.x, y2: nextB.y,
                                stroke,
                                "stroke-width": 1
                            })
                        );
                    }
                }
                }
            } else if (entity.type === "cable") {
                /*
                 * A cable is drawn as a solid bar rather than a
                 * bare line, so it has visible body. It is
                 * thinner than a Beam because a cable is a
                 * lighter member, which keeps the two
                 * distinguishable at a glance.
                 */
                const depth = 3;

                svg.appendChild(
                    createSvgElement("polygon", {
                        points: [
                            `${from.x + nx * depth},${from.y + ny * depth}`,
                            `${to.x + nx * depth},${to.y + ny * depth}`,
                            `${to.x - nx * depth},${to.y - ny * depth}`,
                            `${from.x - nx * depth},${from.y - ny * depth}`
                        ].join(" "),
                        fill: stroke,
                        stroke: "none"
                    })
                );
            } else {
                /*
                 * A shaft is a member with a defined diameter,
                 * drawn as a bar with a centreline running
                 * along its axis. The centreline is part of how
                 * a shaft is drawn, not a feature of its own,
                 * and it is derived from the same two endpoints
                 * as the bar so it stays centred through a move,
                 * a resize or a rotation.
                 */
                const diameter = 8;

                svg.appendChild(
                    createSvgElement("polygon", {
                        points: [
                            `${from.x + nx * diameter},${from.y + ny * diameter}`,
                            `${to.x + nx * diameter},${to.y + ny * diameter}`,
                            `${to.x - nx * diameter},${to.y - ny * diameter}`,
                            `${from.x - nx * diameter},${from.y - ny * diameter}`
                        ].join(" "),
                        fill: "none",
                        stroke,
                        "stroke-width": 1.4
                    })
                );

                [from, to].forEach(point => {
                    svg.appendChild(
                        createSvgElement("line", {
                            x1: point.x + nx * diameter,
                            y1: point.y + ny * diameter,
                            x2: point.x - nx * diameter,
                            y2: point.y - ny * diameter,
                            stroke,
                            "stroke-width": 1.4
                        })
                    );
                });

                /*
                 * The axial centreline.
                 *
                 * This is a real engineering CENTRELINE, drawn
                 * with the application's own "center" line type,
                 * so it reads as a centre line by the same rule
                 * as every other centred line in the drawing
                 * rather than by a dash pattern invented here.
                 *
                 * It is still derived from the same two
                 * endpoints as the bar, so it stays on the axis
                 * through a move, a resize or a rotation, and
                 * it remains part of how a shaft is drawn rather
                 * than a construction line feature of its own.
                 */
                const centreline =
                    createSvgElement("line", {
                        x1: from.x,
                        y1: from.y,
                        x2: to.x,
                        y2: to.y,
                        stroke,
                        "stroke-width": 1
                    });

                applyStyle(centreline, {
                    ...style,
                    lineType: "center"
                });

                svg.appendChild(centreline);
            }

            parentSvg.appendChild(svg);
            return true;
        }
