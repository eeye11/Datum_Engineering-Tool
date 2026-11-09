/*
 * Analysis diagrams (SFD, BMD, AFD): the frame, axes and ticks, plotted
 * equations and sketches, and reading a value back off a diagram.
 *
 * Part of the renderer (see renderer.js), split out by concern.
 */
import enggDiagramEquations from "../../features/workspace/model/analysis/diagram-equations.js";
import enggAnalysisFrame from "../../features/workspace/model/analysis/analysis-frame.js";
import { createSvgElement, zoomedFontHere } from "./svg-primitives.js";


    /*
     * Build a line drawn in a feature's own stroke, width and line
     * type, so a force or a load shaft looks like the feature it
     * belongs to rather than like the default weight of the canvas.
     */
    /*
     * The three analysis templates, told apart by tint.
     *
     * Each diagram is a different document with a different
     * heading, a different icon and a different name, and the
     * background is the only thing you see when a page of
     * diagrams is zoomed out. So they are given distinct, very
     * faint tints rather than one neutral grey: a student
     * scanning a sheet full of them should be able to tell an
     * SFD from a BMD without reading either.
     */
    const ANALYSIS_DIAGRAM_TINTS = {
        sfd: "#1f5c38",
        bmd: "#8a4b1f",
        afd: "#1f4a7a"
    };

    /*
     * WHAT EACH DIAGRAM'S ORDINATE ACTUALLY MEASURES.
     *
     * The three look alike - a frame, an axis, some station marks -
     * and the axis label is what tells them apart.
     * A diagram whose vertical axis is unlabelled is not a drawing
     * anybody can read: the student is being asked to plot a value on
     * it, and the sheet does not say which value.
     *
     * So each carries its quantity and its unit, and the renderer
     * draws them against the axis as a reader expects to find them.
     * They are NAMES for the axes, not values: no magnitude, no sign
     * and no scale are implied, because those are the solution and the
     * student supplies them.
     */
    /*
     * ========================================================
     * THE ANALYSIS FRAME, IN ONE PLACE
     * ========================================================
     *
     * One set of numbers for all three diagrams and both modes, because
     * six independently sized frames would mean a student comparing an
     * SFD with a BMD is comparing two drawing conventions rather than
     * two results.
     *
     * THESE ARE SCREEN PIXELS, and they scale with the zoom so the frame
     * keeps its proportions at any magnification - a frame drawn at fixed
     * pixels becomes a stamp at high zoom and swallows the sheet at low.
     *
     * THE MARGINS ARE NOT PART OF THE ENGINEERING DOMAIN. The body runs
     * from `from` to `to`, and that span is what every value is plotted
     * against. The axis reaching further right is PRESENTATION - it makes
     * room for the arrowhead and the axis label - and nothing is ever
     * plotted into that margin, because the curve is mapped by fraction
     * along `from`-`to` and not along the drawn axis.
     *
     * That distinction is the whole reason the margin is safe. Stretching
     * the plot to fill the axis would silently rescale every value the
     * student drew against it.
     */
    /*
     * THE GRAPH FRAME.
     *
     * One box, in screen pixels from the zero line, that says how big the
     * coordinate system is. It is the same for all three diagrams and both
     * modes, because six independently sized frames would mean a student
     * comparing an SFD with a BMD is comparing two drawing conventions
     * rather than two results.
     *
     * THESE ARE SCREEN PIXELS, and they scale with the zoom so the frame
     * keeps its proportions at any magnification - a frame drawn at fixed
     * pixels becomes a stamp at high zoom and swallows the sheet at low.
     *
     * ========================================================
     * THE ORDINATE IS SYMMETRIC ABOUT THE ZERO LINE, AND TALL
     * ========================================================
     *
     * It used to be 92 above and 46 below, which is not a neutral choice
     * but a claim: that twice as much ordinate is available above as below.
     * For a shear force or a bending moment diagram that is simply wrong,
     * because those are the quantities that change sign, and the half that
     * is drawn smaller is the half that holds the interesting answers. A
     * student comparing the tension and compression regions of an SFD was
     * reading them off an asymmetric scale.
     *
     * So there is one height, used both ways. The frame is as tall below
     * the axis as above it, the y-axis spans all of it, and neither figure
     * depends on what has been drawn in it.
     *
     * WHY IT IS TALL. The frame is the graph's coordinate system, and a
     * coordinate system with a stubby y-axis reads as a picture of a
     * diagram rather than as something to plot against. 110 either way
     * gives room for a full shear jump or a moment hump without the curve
     * having to be shrunk to fit, and leaves margin at the top and bottom
     * of the plot region - which is what the y-axis is there to span.
     *
     * THE MARGINS ARE NOT PART OF THE ENGINEERING DOMAIN. The body runs
     * from `from` to `to`, and that span is what every value is plotted
     * against. The axis reaching further right is PRESENTATION - it makes
     * room for the arrowhead and the axis label - and nothing is ever
     * plotted into that margin, because the curve is mapped by fraction
     * along `from`-`to` and not along the drawn axis.
     *
     * That distinction is the whole reason the margin is safe. Stretching
     * the plot to fill the axis would silently rescale every value the
     * student drew against it.
     */
    /*
     * THE FRAME'S DIMENSIONS, FROM THE SHARED DEFINITION.
     *
     * These numbers are also what the FIT reserves space for, and the fit
     * cannot import this module - it is reached from the canvas renderer, which
     * this file uses, so the two would form a cycle. They live in a leaf module
     * both can import instead, so a fitted diagram and a drawn diagram cannot
     * disagree about how tall the frame is.
     */
    const ANALYSIS_FRAME = enggAnalysisFrame.ANALYSIS_FRAME;

    /* The frame's extents, all in screen pixels from the zero line. */
    function analysisFrameExtents() {
        return {
            /*
             * NEGATIVE `top`, positive `bottom`: these are screen
             * coordinates, so up is negative. Both carry the SAME
             * magnitude, and every caller adds them to the zero line.
             */
            top: -ANALYSIS_FRAME.ordinateHeightPx,
            bottom: ANALYSIS_FRAME.ordinateHeightPx,
            right: ANALYSIS_FRAME.axisExtensionPx,
            arrowHead: ANALYSIS_FRAME.arrowHeadPx,
            labelGap: ANALYSIS_FRAME.labelGapPx,
            padding: ANALYSIS_FRAME.paddingPx,
            radius: ANALYSIS_FRAME.radiusPx
        };
    }

    const ANALYSIS_DIAGRAM_AXES = {
        /*
         * THE AXES STATE THE QUANTITY'S BASE UNIT, the one the analysis
         * model stores and the one every Features panel reads back. The
         * literal kN captions here used to disagree with the panels, which
         * read in N - the same figure captioned a thousandfold apart on one
         * sheet. One table, one unit per quantity, everywhere.
         */
        sfd: {
            y: "Shear force",
            unit: "N",
            x: "x",
            xUnit: "m"
        },
        bmd: {
            y: "Bending moment",
            unit: "N\u00b7m",
            x: "x",
            xUnit: "m"
        },
        afd: {
            y: "Axial force",
            unit: "N",
            x: "x",
            xUnit: "m"
        }
    };

    /*
     * ========================================================
     * WHAT A PLOT'S EXPRESSIONS LOOK LIKE ON PAPER
     * ========================================================
     *
     * The mapping from the stored relations to geometry on the sheet, in
     * ONE place, so the canvas and the Plot Editor cannot disagree.
     *
     * The editor does not re-implement any of this. It asks for the marks
     * for the expressions currently in the dialog and draws them with the
     * same numbers the canvas will use, which is what makes the graph in
     * the popup a live view of the feature rather than a lookalike that
     * might be subtly different.
     *
     * EVERY MARK IS ENGINEERING, NOT SCREEN. Both endpoints are returned
     * in world coordinates, and the caller projects them. Interpolating
     * between two screen points and handing the result back to the
     * projector applies the transform twice, which throws the curve off
     * the sheet entirely - so exactly one projection happens, here,
     * never on the result of another.
     */
    function analysisPlotMarks(geometry, expressions) {
        const equations =
            enggDiagramEquations;

        /*
         * WITHOUT A RANGE THERE IS NO WAY TO PLACE A STATION, so nothing
         * is drawn rather than drawn against a guessed scale. A curve in
         * the wrong place is worse than no curve, because it looks like an
         * answer.
         */
        const localRange = geometry.localRange;

        if (!equations || !localRange) {
            return [];
        }

        const rangeWidth =
            localRange.to - localRange.from;

        if (!(rangeWidth > 0)) {
            return [];
        }

        const entries = Array.isArray(expressions)
            ? expressions
            : equations.readPlot(geometry);

        if (!entries.length) {
            return [];
        }

        /*
         * THE VALUE SCALE COMES FROM `analysisValueScale`, below.
         *
         * There used to be a `const unitHeight = rangeWidth * 0.16;` here that
         * was never read - the real scale has always been the one that function
         * returns. It has been removed rather than left in place, because a
         * number that looks like it sets the scale and does not is worse than no
         * number: the next person to change how large a curve is drawn would
         * have edited it and seen nothing happen.
         */
        const peak =
            equations.peakMagnitude(entries);

        /*
         * A diagram whose largest value is zero has no scale to work in, and
         * scaling by zero would flatten a real curve onto the axis. The
         * resolution is shared with the sketch path, so a set y-range means
         * the same thing on a hand-drawn diagram as on a plotted one.
         */
        const { unitHeight: scale } =
            analysisValueScale(
                geometry,
                rangeWidth,
                peak
            );

        /*
         * x is a FRACTION of the member's own length, so the curve stays
         * locked to the body however the frame is moved, the member is
         * rotated, or the view is zoomed.
         */
        const along = (x, value) => {
            const t = (x - localRange.from) / rangeWidth;

            return {
                x:
                    geometry.start.x +
                    (geometry.end.x - geometry.start.x) * t,

                /*
                 * A POSITIVE VALUE GOES UP, so the offset is ADDED to the
                 * world y.
                 *
                 * The world frame here is y-UP - the same sense the
                 * diagram's own zero axis uses - so subtracting would push
                 * a positive shear DOWN the sheet, under the axis, and read
                 * as a negative reaction. The projection is what turns
                 * this into screen coordinates; this is not a second
                 * inversion of the same thing.
                 */
                y: geometry.start.y + value * scale
            };
        };

        return equations
            .sampleExpressions(entries)
            .map(mark => {
                /*
                 * THE STUDENT'S OWN TEXT, carried with the mark.
                 *
                 * `sampleExpressions` returns geometry, not prose, so the
                 * equation is looked up from the expression it came from.
                 * Looked up rather than passed in, because a label assembled
                 * by the sampler would be a second description of the same
                 * relation and the two could drift.
                 */
                const source = entries.find(
                    entry => entry.id === mark.id
                );

                if (mark.kind === "verticalLine") {
                    /*
                     * A VERTICAL LINE, FROM ITS OWN NUMBERS.
                     *
                     * There is no function here and none is invented: the
                     * stored x and the stored y range ARE the line. It is
                     * returned the same way a curve is - as engineering
                     * coordinates with both ends known - because that is
                     * what every renderer needs, and NOT because it has
                     * been turned into one.
                     */
                    return {
                        kind: "verticalLine",
                        id: mark.id,
                        from: along(mark.x, mark.from),
                        to: along(mark.x, mark.to)
                    };
                }

                return {
                    kind: "curve",
                    id: mark.id,
                    equation: source?.expression,
                    points: mark.points.map(point =>
                        along(point.x, point.value)
                    )
                };
            });
    }

    /*
     * ========================================================
     * HOW TALL ONE UNIT OF VALUE IS
     * ========================================================
     *
     * The scale is normally DERIVED: whatever the diagram's largest value
     * happens to be is fitted to the frame. That is right as a default -
     * a student who has just entered one equation should see it fill the
     * box rather than sitting as a flat line along the axis.
     *
     * A SET range overrides it, and it overrides it by CLIPPING rather than
     * by replacing. That is the decision worth stating, because the
     * alternative - draw to the user's range and let anything taller run off
     * the top - is silent. A curve that leaves the frame is indistinguishable
     * from a curve that stops there, and a student would read the second one
     * as their own answer.
     *
     * So the frame is widened to hold the SET range, and a diagram that
     * exceeds it is cut off at the edge - visibly, because it is clipped at
     * the boundary of the frame rather than quietly trimmed. What is lost is
     * the student's ability to see it, which is why the range is theirs to
     * set and not ours to impose.
     *
     * NO RANGE, OR A BACKWARDS ONE, IS NOT A RANGE. A minimum above its
     * maximum is a half-typed value, and half-typed values are not allowed
     * to become a scale.
     */
    /*
     * ========================================================
     * TICKS AND THEIR NUMBERS
     * ========================================================
     *
     * Opt-in, with the student's own spacing on each axis, because a ruler
     * set to the wrong interval is worse than no ruler.
     *
     * THE NUMBERS ARE ENGINEERING, NOT FRAME POSITIONS. The x values come
     * from the member's own range and the y values from the SAME
     * `analysisValueScale` the curve is drawn with - so a value the student
     * draws at 10 kN sits on the 10 mark, at any zoom, on any diagram.
     * Read the scale anywhere else and the ticks would quietly disagree
     * with the curve they are supposed to be measuring.
     *
     * A SPACING THAT PRODUCES AN UNREADABLE NUMBER OF TICKS IS IGNORED,
     * not honoured. A student typing 0.001 on a 5 m beam asked for a
     * thousand marks; drawing them would bury the diagram, and silently
     * drawing some arbitrary subset would be worse. There is a cap, and
     * exceeding it draws none - which is visibly wrong and therefore
     * something the student will notice and fix.
     */
    const MAX_TICKS_PER_AXIS = 12;

    function tickValues(from, to, spacing, cap) {
        const span = to - from;

        if (!(span > 0) || !(spacing > 0)) {
            return [];
        }

        const count = Math.floor(span / spacing);

        if (count < 1 || count > cap) {
            return [];
        }

        const values = [];

        for (let i = 0; i <= count; i++) {
            values.push(from + i * spacing);
        }

        return values;
    }

    function numberText(value) {
        if (!Number.isFinite(value)) {
            return "";
        }

        return String(Math.round(value * 1000) / 1000);
    }

    function analysisValueScale(geometry, rangeWidth, peak) {
        /*
         * A SKETCH'S OWN SCALE COMES FIRST.
         *
         * A sketch's strokes are ordinary features drawn against a fixed
         * units-per-value, and that figure is stored on the diagram
         * (`unitHeight`). It is the authoritative one: re-deriving a scale from
         * whatever happens to be drawn would make a stroke move when another
         * stroke was added or erased, although the student's geometry had not
         * changed.
         *
         * A Plot has no such figure - its scale is fitted to its expressions -
         * so it falls through to the range and peak below.
         */
        const declared = Number(geometry.unitHeight);

        if (Number.isFinite(declared) && declared > 0) {
            return {
                unitHeight: declared,
                set: true,
            };
        }

        const set = geometry.yRange;

        const from = Number(set?.from);
        const to = Number(set?.to);

        const usable =
            set &&
            Number.isFinite(from) &&
            Number.isFinite(to) &&
            from < to;

        if (usable) {
            /*
             * The larger of the two spans wins: the student's range if it
             * is the larger, their own diagram if it is. Either way the
             * frame is big enough to show what it is supposed to show, and
             * the same unit height applies to both - so a value reads the
             * same across every diagram on the sheet.
             */
            const chosen = Math.max(
                Math.abs(from),
                Math.abs(to),
                peak > 0 ? peak : 0
            );

            return {
                unitHeight:
                    chosen > 0
                        ? (rangeWidth * 0.16) / chosen
                        : 0,

                from,
                to,
                set: true,
            };
        }

        return {
            unitHeight:
                peak > 0
                    ? (rangeWidth * 0.16) / peak
                    : 0,

            set: false,
        };
    }

    /*
     * DRAW THE STUDENT'S EXPRESSIONS.
     *
     * One stroke per mark, and they are NEVER joined. That is what
     * preserves a discontinuity: two functions meeting at different values
     * stay two strokes, because joining them would assert a value for the
     * distance where the jump happens, and there is no such value. A
     * single path has no way to say "do not connect these".
     *
     * A vertical line is a stroke of its own and is not connected to
     * anything either side of it - which is the point of it. Drawing it as
     * a steep but finite slope to meet its neighbours is the specific lie
     * this whole relation type exists to avoid.
     */
    function appendAnalysisPlot(
        svg,
        geometry,
        toScreen,
        tint,
        axisWidth
    ) {
        analysisPlotMarks(geometry).forEach(mark => {
            /*
             * THE TINT, NOT THE BODY STROKE.
             *
             * The curve is part of this diagram, so it is drawn in the
             * diagram's own colour. Inheriting the entity style would put a
             * shear curve in whatever colour the layer happened to be - and
             * an SFD and a BMD are told apart by their colour as much as by
             * their heading.
             */
            const strokeOptions = {
                fill: "none",
                stroke: tint,
                "stroke-width": 1.8,
                "stroke-linejoin": "round",
                "stroke-linecap": "round"
            };

            const element =
                mark.kind === "verticalLine"
                    ? (() => {
                        const a = toScreen(mark.from);
                        const b = toScreen(mark.to);

                        return createSvgElement("line", {
                            x1: a.x,
                            y1: a.y,
                            x2: b.x,
                            y2: b.y,
                            ...strokeOptions
                        });
                    })()
                    : (() => {
                        const d = mark.points
                            .map((point, index) => {
                                const at = toScreen(point);

                                return `${index ? "L" : "M"} ${at.x} ${at.y}`;
                            })
                            .join(" ");

                        return d
                            ? createSvgElement("path", {
                                d,
                                class:
                                    "drawing-analysis-curve",
                                ...strokeOptions
                            })
                            : null;
                    })();

            if (!element) {
                return;
            }

            /*
             * The curve is part of the diagram, not a separate thing to
             * pick: a student selecting the SFD means the whole of it,
             * curve and vertical jump included.
             */
            element.setAttribute("pointer-events", "none");

            svg.appendChild(element);
        });

        /*
         * ========================================================
         * SHOW EQUATIONS
         * ========================================================
         *
         * Off by default. A diagram with its equations written on it reads
         * as a finished answer, and a working sheet is not that - it is a
         * student thinking. This is a study aid they switch on deliberately,
         * and it says what they wrote rather than what it means.
         *
         * LAID OVER THE MARKS, never beside them, because the marks are the
         * diagram and moving them to make room for a label would change the
         * answer to suit its annotation.
         *
         * NOT PICKABLE. A click on a label means the student means the
         * diagram - that is what they are looking at - so it resolves to the
         * feature rather than becoming a target of its own.
         */
        if (geometry.showEquations === true) {
            equationLabels(geometry).forEach(
                label => {
                    const at = toScreen(label.at);

                    const text =
                        createSvgElement("text", {
                            x: at.x,
                            y: at.y - 6,
                            class: "drawing-analysis-equation",
                            "text-anchor": "middle",
                            "font-family": "Arial, sans-serif",
                            "font-size": zoomedFontHere(10),
                            fill: tint,
                            "stroke": "none"
                        });

                    text.textContent =
                        label.text;

                    text.setAttribute(
                        "pointer-events",
                        "none"
                    );

                    svg.appendChild(text);
                }
            );
        }
    }

    /*
     * ========================================================
     * THE EQUATION BESIDE EACH MARK
     * ========================================================
     *
     * Optional, and off by default: a diagram with its equations written on
     * it reads as a finished answer, which is not what a working sheet
     * looks like. It is a study aid - the student checking their own work -
     * so they turn it on when they want it.
     *
     * THE LABEL IS BESIDE THE MIDDLE OF ITS OWN MARK, never in a fixed
     * corner. Three regions of one SFD all need a label, and stacking them
     * at the same place would put two equations on top of each other and
     * leave a third describing nothing.
     *
     * IT IS THE STUDENT'S OWN TEXT, printed as typed. A vertical relation
     * has no equation to write, so it says `x = 4` rather than being given
     * an invented `V(x)` - there is no function there, and saying so would
     * be the lie this relation type exists to avoid.
     */
    function equationLabels(geometry) {
        /*
         * `window`, not `root`. This file is a plain IIFE with no `root`
         * parameter - every other module here takes one - so `root` is
         * simply undefined and reading through it throws the moment the
         * first label is asked for.
         */
        const equations = enggDiagramEquations;

        if (!equations) {
            return [];
        }

        const quantity =
            equations.quantityFor(geometry.diagramType);

        return analysisPlotMarks(geometry)
            .map(mark => {
                let text;

                if (mark.kind === "verticalLine") {
                    const station = analysisValueAt(geometry, mark.from);

                    text = station
                        ? `x = ${numberText(station.x)}`
                        : null;
                } else {
                    text = mark.equation
                        ? `${quantity} = ${mark.equation}`
                        : null;
                }

                if (!text) {
                    return null;
                }

                /*
                 * WHERE THE LABEL GOES.
                 *
                 * A curve is labelled beside the middle of its own points;
                 * a vertical relation has no points, so it is labelled at
                 * the middle of the line itself - its own `from`/`to`, and
                 * the point partway between them.
                 *
                 * Guarding on `points` alone would silently drop every
                 * vertical relation's label, which is the one kind of label
                 * that most needs to be there: it is the discontinuity, and
                 * the discontinuity is what the student is checking for.
                 */
                const middle = mark.points?.length
                    ? mark.points[
                          Math.floor(mark.points.length / 2)
                      ]
                    : {
                          x: (mark.from.x + mark.to.x) / 2,
                          y: (mark.from.y + mark.to.y) / 2,
                      };

                return {
                    id: mark.id,
                    text,
                    at: middle,
                };
            })
            .filter(Boolean);
    }

    /*
     * ========================================================
     * READING A CURSOR IN THE GRAPH'S OWN UNITS
     * ========================================================
     *
     * The status readout reports world coordinates, because that is what the
     * rest of the sheet is drawn in. But a student sketching a shear diagram
     * does not want the world y of a pixel - they want to know what VALUE
     * they are at, and how far along the member they are.
     *
     * So this converts one to the other, and it lives beside the projection
     * rather than in the caller. `analysisPlotMarks` already does the forward
     * direction; a second implementation of the inverse somewhere else is how
     * the two come to disagree, and a cursor readout that disagrees with the
     * graph beside it is worse than no readout at all.
     *
     * The same scale is used in both directions - fitted to the diagram's
     * peak, or to the student's set range - so the number this reports is
     * the number the curve is drawn at.
     */
    function analysisValueAt(geometry, worldPoint) {
        const localRange = geometry.localRange;

        if (!localRange || !geometry.start || !geometry.end) {
            return null;
        }

        const rangeWidth = localRange.to - localRange.from;

        if (!(rangeWidth > 0)) {
            return null;
        }

        /*
         * The peak is taken from whatever the diagram currently holds, so
         * the readout and the drawing move together as expressions are
         * edited. It is the same value the marks were built with.
         */
        const equations = enggDiagramEquations;

        let peak = 0;

        /*
         * ONLY A PLOT HAS A PEAK TO READ.
         *
         * A sketch's strokes are ordinary features now, so their extent is
         * their own geometry's - not something this diagram can measure from a
         * list it no longer holds. A sketch therefore falls through with a peak
         * of zero, and the readout uses the diagram's own scale, which is what
         * the strokes were drawn against.
         */
        if (geometry.mode === "plot" && equations) {
            peak = equations.peakMagnitude(
                equations.readPlot(geometry)
            );
        }

        const { unitHeight } = analysisValueScale(
            geometry,
            rangeWidth,
            peak
        );

        if (!unitHeight) {
            return null;
        }

        const axisLength =
            geometry.end.x - geometry.start.x;

        if (!axisLength) {
            return null;
        }

        const t =
            (worldPoint.x - geometry.start.x) / axisLength;

        return {
            x: localRange.from + t * rangeWidth,
            y: (worldPoint.y - geometry.start.y) / unitHeight,
        };
    }

export {
    ANALYSIS_DIAGRAM_TINTS,
    ANALYSIS_FRAME,
    analysisFrameExtents,
    ANALYSIS_DIAGRAM_AXES,
    analysisPlotMarks,
    MAX_TICKS_PER_AXIS,
    tickValues,
    numberText,
    analysisValueScale,
    appendAnalysisPlot,
    equationLabels,
    analysisValueAt
};
