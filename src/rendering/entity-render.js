/*
 * Drawing one feature: the per-type dispatch that turns a stored feature
 * into SVG.
 *
 * Part of the renderer (see renderer.js), split out by concern.
 */
import enggBodyFrames from "../core/geometry/body-frames.js";
import enggDrawingState from "../core/model/drawing-state.js";
import enggDiagramEquations from "../features/analysis/diagram-equations.js";
import enggLoadProfile from "../features/analysis/load-profile.js";
import enggAnnotationModel from "../features/annotations/annotation-model.js";
import enggTheme from "../editor/workspace/theme.js";
import { isConnectionType, isSupportType } from "../core/model/feature-types.js";
import { applyStyle, arcPathData, createSvgElement, paintColour, scaledStrokeWidth, styledLine, zoomedFontHere } from "./svg-primitives.js";
import { appendDimensionEntity, appendVariableDimensionEntity } from "./dimension-render.js";
import { appendAnnotateEntity, appendAnnotationEntity, appendDerivedMagnitude } from "./annotation-render.js";
import { ANALYSIS_DIAGRAM_AXES, ANALYSIS_DIAGRAM_TINTS, MAX_TICKS_PER_AXIS, analysisFrameExtents, analysisValueScale, appendAnalysisPlot, appendAnalysisSketch, numberText, tickValues } from "./analysis-render.js";
import { appendForceArrow, appendRotationalArrow, appendVectorArrow, arrowheadDirection, arrowheadTip, distributedLoadArrowHead, distributedLoadArrowLength, forceDirectionOnScreen, forceEndpoints, forceStrokeWidth, momentIsClockwise, vectorScaleOf } from "./vector-render.js";
import { appendConnectionSymbol, appendCoordinateSystem, appendRigidBody, appendSupportSymbol } from "./symbol-render.js";


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

        /*
         * STATICS SYMBOL FEATURES
         *
         * A point force and the support and connection symbols
         * all draw from one anchor point, so they are handled
         * in this single pass. An applied moment, a
         * distributed load and a varying distributed load are
         * drawn by their own blocks further down.
         */
        if (
            entity.type === "force" ||
            /*
             * A resultant and a component analysis are vectors too, so they
             * share this pass rather than getting a symbol of their own. What
             * says which is which is the annotation beside them.
             */
            entity.type === "resultant" ||
            entity.type === "force-components" ||
            isSupportType(entity.type) ||
            isConnectionType(entity.type)
        ) {
            /*
                 * A FORCE AND A RESULTANT ARE DRAWN ALONG THEIR SPAN, NOT FROM
                 * THEIR APPLICATION POINT.
                 *
                 * The anchor for everything else is the stored point. For these
                 * two it is the OTHER end of the line from the arrowhead - which
                 * makes the shaft the whole span and the head one end of it.
                 *
                 * Anchoring at `start` made a reversal appear to relocate the
                 * arrow: the head moved to the far end of the span, so the line
                 * it was drawn on grew from the application point across to
                 * wherever the head had gone. A force drawn along 480->720 came
                 * out along 240->720 - the same length, somewhere else - which
                 * is the "the geometry flips" report.
                 *
                 * With the tail at the opposite end of the span, the line never
                 * moves and only the arrowhead changes side. That is a
                 * Distributed Load's convention, and the two should agree.
                 */
            const hasForceSpan =
                (entity.type === "force" ||
                    entity.type === "resultant") &&
                Number.isFinite(geometry?.end?.x) &&
                Number.isFinite(geometry?.end?.y) &&
                Math.hypot(
                    Number(geometry.end.x) -
                        (geometry.start?.x ?? geometry.position?.x ?? 0),
                    Number(geometry.end.y) -
                        (geometry.start?.y ?? geometry.position?.y ?? 0),
                ) > 1e-9;

            const position = hasForceSpan
                    ? enggLoadProfile.drawnForceTail(state, geometry)
                    : geometry.start || geometry.position;

            if (
                !position ||
                !Number.isFinite(position.x) ||
                !Number.isFinite(position.y)
            ) {
                return;
            }

            /*
             * THE ARROW IS DRAWN FROM THE POINT THE FORCE ACTS AT, IN THE
             * DIRECTION THE FORCE POINTS.
             *
             * Those are two questions and the drawing asks both. The anchor is
             * the application point - where the force acts on the member. The
             * direction is the stored vector, not the span.
             *
             * This branch used to derive the direction by measuring from the
             * anchor to `end`, which is the SPAN rather than the sense. A
             * reversed force was then drawn pointing exactly the same way as
             * before, because the span had not moved: the model recorded the
             * reversal correctly and the arrowhead never moved, which is the
             * worst combination - every check of the stored value passed and
             * the thing on the sheet was still wrong.
             *
             * Both halves of the arrow now come from `drawnForceEnd`, which
             * reads the length and the direction out of the same place. The
             * drawn arrow and the handle beside it are then the same point by
             * construction rather than by two calculations agreeing.
             */
            const anchor = toScreen(position);
            const stroke = paintColour(style.stroke || enggTheme.defaultLineColour());

            if (
                entity.type === "force-components"
            ) {
                /*
                 * A DECOMPOSITION, NOT AN ARROW.
                 *
                 * The three vectors share one origin - the force's own
                 * application point - because that shared origin is what
                 * makes the picture a decomposition rather than three
                 * arrows that happen to be near each other. The dashed
                 * lines close the triangle: they are the geometric
                 * fact that the components add back up to the original,
                 * shown rather than asserted.
                 *
                 * All three come from the analysis registry, which
                 * derives them from the source force, so this block
                 * draws what the model currently says and has no
                 * arithmetic of its own.
                 */
                if (geometry.horizontal || geometry.vertical) {
                    if (
                        geometry.original &&
                        /*
                         * ========================================================
                         * THE COMPONENTS ARE THE FEATURE. THE ORIGINAL IS NOT.
                         * ========================================================
                         *
                         * `geometry.original` is stored because the renderer and
                         * the hit test have always read it, and because it is a
                         * real reading of the source - but it must be ASKED
                         * FOR.
                         *
                         * This test used to be `!== false`, which draws the
                         * original whenever the field is absent - and the
                         * field is absent on every object the tool has ever
                         * created, because nothing wrote it. So the feature
                         * drew the force AND its two components: the student
                         * saw their own force twice, and Force Components
                         * read as a replica of it with a triangle drawn over
                         * the top.
                         *
                         * The default is therefore OFF, and only an explicit
                         * `true` turns it on. That is the difference between
                         * "a decomposition with the decomposed vector shown
                         * for reference" - genuinely useful - and "the same
                         * force again", which is not what this tool is for.
                         */
                        geometry.showOriginal === true
                    ) {
                        appendVectorArrow(
                            svg,
                            toScreen(geometry.original.start),
                            toScreen(geometry.original.end),
                            stroke,
                            style,
                            "solid"
                        );
                    }

                    if (
                        geometry.horizontal &&
                        geometry.showX !== false
                    ) {
                        appendVectorArrow(
                            svg,
                            toScreen(geometry.horizontal.start),
                            toScreen(geometry.horizontal.end),
                            stroke,
                            style,
                            "solid"
                        );
                    }

                    if (
                        geometry.vertical &&
                        geometry.showY !== false
                    ) {
                        appendVectorArrow(
                            svg,
                            toScreen(geometry.vertical.start),
                            toScreen(geometry.vertical.end),
                            stroke,
                            style,
                            "solid"
                        );
                    }

                    appendDerivedMagnitude(svg, entity, state, toScreen, style);
                    parentSvg.appendChild(svg);
                    return;
                }
            }

            if (
                entity.type === "force" ||
                entity.type === "resultant"
            ) {
                /*
                 * THE SHARED VECTOR SCALE.
                 *
                 * The arrow is drawn at the length the shared Statics
                 * display scale asks for. The scale is applied to the
                 * LENGTH, never to the stored magnitude - scaling the
                 * magnitude would change the engineering value, and
                 * scaling the application point would move where the force
                 * acts. A Vector Scale is a drawing setting and nothing
                 * else.
                 *
                 * BOTH ENDS GO THROUGH THE SAME PROJECTION.
                 *
                 * The caller used to recover an angle from the two screen
                 * points and hand that to a routine which rebuilt the tip,
                 * with a sign flip in the reconstruction to match a sign
                 * flip in the recovery. Both are gone: this passes the two
                 * points themselves, and the shared arrow measures its own
                 * direction from them. See appendVectorArrow.
                 */
                if (geometry.end) {
                    /*
                     * BOTH HALVES OF THE ARROW ARE ASKED FOR, NOT COMPUTED HERE.
                     *
                     * The length is how far this force is DRAWN and the
                     * direction is which way it PUSHES, and `drawnForceEnd`
                     * already knows both - the magnitude for the first, the
                     * stored vector for the second. This branch was measuring
                     * the length itself and deriving the direction from the
                     * span, which made it answer the direction question with
                     * the wrong fact: a reversed force was drawn pointing the
                     * same way it always was, because the span had not moved.
                     *
                     * Asking for the tip instead means the drawn arrow and the
                     * handle are the same point by construction - they used to
                     * be two calculations that agreed until they did not.
                     *
                     * ONE PROJECTION. `drawnForceEnd` answers in world units
                     * and this projects once, so the direction is derived
                     * after the screen-Y flip rather than before it.
                     *
                     * There was a SECOND path here, for a force with no stored
                     * end, which turned the angle into a direction and scaled
                     * the magnitude itself. Two paths meant two answers: at 270
                     * degrees they disagreed, and a force pointing down came
                     * out pointing down and to the left.
                     *
                     * That path is gone rather than corrected, because every
                     * force the application creates stores both ends -
                     * `setForceVector` writes them together - so it described a
                     * state that cannot occur while disagreeing with the real
                     * one. A force drawn straight down is not a corner case;
                     * it is the commonest load on a beam.
                     */
                    const tip = enggLoadProfile.drawnForceEnd(
                        state,
                        geometry
                    );

                    const drawnTip = toScreen(tip);

                    const drawn = Math.hypot(
                        drawnTip.x - anchor.x,
                        drawnTip.y - anchor.y
                    );

                    const direction =
                        forceDirectionOnScreen(
                            drawnTip,
                            anchor
                        );

                    appendForceArrow(
                        svg,
                        anchor,
                        direction,
                        drawn,
                        stroke,
                        style
                    );
                }
            } else if (
                isSupportType(entity.type)
            ) {
                /*
                 * A SUPPORT IS DRAWN FROM ITS ATTACHMENT, NOT FROM
                 * ITS STORED POINT.
                 *
                 * The stored position is where the symbol was drawn
                 * when it was made. The authoritative fact is the
                 * ATTACHMENT - a distance along the parent body's
                 * centreline - and the drawn position is recomputed
                 * from it here, every frame.
                 *
                 * That is what makes the support behave as an
                 * attachment rather than as a mark: move the beam and
                 * the support is still the same distance along it;
                 * rotate the beam and the symbol turns with it; deepen
                 * the beam and the symbol steps further out to clear
                 * the new face. None of that needs the support itself
                 * to be touched, and none of it can be got wrong by a
                 * stored coordinate going stale.
                 *
                 * A support with no parent, or whose parent has no
                 * usable span, falls back to the stored position and
                 * angle - which is what keeps a support drawn before
                 * this existed, or placed on nothing at all, still
                 * visible and still editable.
                 */
                const parent =
                    entity.parentId
                        ? state.objects.find(
                            candidate =>
                                candidate.id ===
                                entity.parentId
                        )
                        : null;

                /*
                 * A PREVIEW CARRIES ITS TARGET DIRECTLY.
                 *
                 * A preview is not a committed feature, so it is not
                 * in the object collection and there is nothing to
                 * find it by id. It rides on the body it is being
                 * attached to, which is the same body a real
                 * attachment would be resolved from.
                 *
                 * Without this the preview falls through to its
                 * fallback - the stored position - and draws the
                 * support ON the centreline, then jumps clear of the
                 * body when the click commits it. Showing the student
                 * one thing and giving them another is the fault a
                 * preview exists to prevent, and it would be visible on
                 * every single support placed.
                 */
                const body =
                    parent ||
                    entity.targetBody ||
                    null;

                const frame =
                    body
                        ? enggBodyFrames.frameOf(
                            body
                        )
                        : null;

                const flipped =
                    geometry.flipped === true;

                const attachmentPoint =
                    frame
                        ? enggBodyFrames.attachmentPoint(
                            frame,
                            geometry.attachment
                        )
                        : null;

                const placement =
                    frame && attachmentPoint
                        ? enggBodyFrames.supportPlacement(
                            body,
                            attachmentPoint,
                            flipped,

                            /*
                             * A FIXED SUPPORT'S WALL SITS AT THE ATTACHMENT
                             * POINT, because that is where the member ENDS.
                             * Every other support stands a clearance off the
                             * face so its symbol does not look half-inside the
                             * body; a fixed end has no such problem, and the
                             * clearance would leave a gap the member appeared
                             * to pass through.
                             */
                            { fixed: entity.type === "fixed-support" }
                        )
                        : null;

                const drawn =
                    placement
                        ? toScreen(placement.render)
                        : anchor;

                appendSupportSymbol(
                    svg,
                    drawn,
                    entity.type,

                    /*
                     * The symbol is turned to point AWAY from the
                     * body, along the body's own normal - so a support
                     * on a diagonal beam is rotated with it instead of
                     * hanging straight down beside it. Derived, never
                     * typed: there is no orientation for a student to
                     * set wrongly.
                     */
                    frame
                        ? enggBodyFrames.supportAngle(
                            frame,
                            flipped
                        )
                        : Number(geometry.orientation) || 0,

                    stroke
                );

                /*
                 * A short stem from the attachment out to the symbol.
                 *
                 * It is what makes the two separate positions
                 * LEGIBLE: without it a support drawn clear of the beam
                 * looks like it is simply floating near it, and the
                 * student cannot see that it is attached to the
                 * centreline rather than hovering beside the member.
                 */
                if (
                    placement &&
                    attachmentPoint
                ) {
                    const from =
                        toScreen(attachmentPoint);

                    const stem =
                        createSvgElement("line", {
                            x1: from.x,
                            y1: from.y,
                            x2: drawn.x,
                            y2: drawn.y,
                            stroke,
                            "stroke-width": 1,
                            "stroke-opacity": 0.75
                        });

                    stem.setAttribute(
                        "pointer-events",
                        "none"
                    );

                    svg.appendChild(stem);
                }
            } else if (
                isConnectionType(entity.type)
            ) {
                appendConnectionSymbol(
                    svg,
                    anchor,
                    entity.type,
                    stroke
                );
            } else {
                return;
            }

            appendDerivedMagnitude(svg, entity, state, toScreen, style);
            parentSvg.appendChild(svg);
            return;
        }
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
        if (entity.type === "moment") {
            const position = geometry.position;

            if (
                !position ||
                !Number.isFinite(position.x) ||
                !Number.isFinite(position.y)
            ) {
                return;
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
            return;
        }

        /*
         * DIMENSIONS AND ANNOTATIONS
         *
         * Both are real document objects, so they are drawn here in
         * the same pass as every other feature rather than being
         * overlaid afterwards. Their graphics are asked of the models,
         * which means the drawing shows the DIMENSION as a dimension
         * line with witness lines and arrowheads, and not as a number
         * floating over the geometry.
         *
         * The models also own the measurement, so a dimension drawn
         * here re-reads its source geometry every time it is drawn.
         * That is what keeps a dimension honest after the geometry
         * moves, without this file knowing anything about beams.
         */
        /*
         * SHOW DIMENSIONS.
         *
         * Hides the dimensions the STUDENT PLACED, by not drawing them.
         * It does not create them: a dimension nobody asked for is not a
         * dimension the drawing has, and generating one per line would be
         * the tool doing the exercise. An absent setting reads as on, so a
         * saved sheet drawn before the toggle existed opens unchanged.
         *
         * HIDDEN BY NOT DRAWING rather than by deleting, so turning the
         * toggle back restores every dimension exactly as it was - including
         * its measured value, which is recomputed from the geometry rather
         * than frozen, so nothing can come back stale.
         */
        if (entity.type === "dimension") {
            if (
                state.display?.showDimensions === false
            ) {
                return;
            }

            appendDimensionEntity(svg, entity, state, toScreen, style);
            parentSvg.appendChild(svg);
            return;
        }

        /*
         * A VARIABLE DIMENSION.
         *
         * Drawn with the SAME machinery a dimension is: the same witness
         * lines, the same arrowheads, the same text frame and the same font -
         * so `x` sits on the drawing exactly where a measured length would, and
         * the two read as members of one family.
         *
         * What differs is only the TEXT: a variable states its SYMBOL, and no
         * measurement is taken. An empty symbol draws NOTHING - the student has
         * named it but not written it, and inventing `0` or `?` would turn
         * their deliberate unknown into a failure.
         *
         * It follows the same SHOW DIMENSIONS toggle, because a variable is a
         * dimension in everything but its value - a student hiding their
         * dimensions does not want the symbolic ones left floating.
         */
        if (entity.type === "variable-dimension") {
            if (state.display?.showDimensions === false) {
                return;
            }

            appendVariableDimensionEntity(svg, entity, state, toScreen, style);
            parentSvg.appendChild(svg);
            return;
        }

        /*
         * AN ANNOTATE FEATURE.
         *
         * A note, a label, a leader, a callout, an arrow, a symbol, a
         * tolerance or a table. All eight are drawn by ONE function, because
         * they are one type; what differs is the kind, which decides the
         * shape drawn around the same text-and-placement core. A note is
         * text; a leader adds a pen; an arrow is a pen with a head; a table
         * is a grid. Keeping them in one function is what stops two of them
         * drifting apart in the way they respond to style or placement.
         */
        if (entity.type === "annotate") {
            appendAnnotateEntity(svg, entity, state, toScreen, style);
            parentSvg.appendChild(svg);
            return;
        }

        /*
         * SHOW MAGNITUDES.
         *
         * A generated value that is switched off is not drawn at all -
         * not drawn with its text emptied. An annotation with no text would
         * still contribute its leader line, so the drawing would keep a
         * line running to a blank spot where the value used to be, which
         * reads as something missing rather than something switched off.
         *
         * A note the student WROTE is unaffected: `isVisible` says so, and
         * says so in the annotation model rather than here, so the rule is
         * one answer rather than two places that have to agree about which
         * annotations are the student's own.
         *
         * THE MODEL IS LOOKED UP RATHER THAN ASSUMED. It is absent in some
         * loads of this file - the module-load check runs without it - so a
         * missing model has to mean "draw everything", which is what an
         * older behaviour did. Throwing here would take the whole drawing
         * down over a preference.
         */
        if (entity.type === "annotation") {
            const annotations =
                enggAnnotationModel;

            if (
                annotations &&
                !annotations.isVisible(
                    entity,
                    state
                )
            ) {
                return;
            }

            appendAnnotationEntity(svg, entity, state, toScreen, style);
            parentSvg.appendChild(svg);
            return;
        }

        /*
         * SLENDER STRUCTURAL MEMBERS
         *
         * Beam, truss, cable and shaft are all defined by
         * their two ends, but each is drawn to read as the
         * member it represents rather than as a plain line.
         */
        if (
            entity.type === "beam" ||
            entity.type === "truss" ||
            entity.type === "cable" ||
            entity.type === "shaft" ||
            /*
             * A diagram frame belongs here for one reason only, and it is
             * a mechanical one: this block is where the start/end test
             * and the shared stroke live, and the diagram branch below
             * reads both. It is NOT a diagram being a slender member.
             *
             * While the diagram was left out of this list, its branch
             * was still nested inside the block, so it was unreachable -
             * an analysis-diagram could never satisfy this test - and
             * every diagram was dropped without a word. The group was
             * built, left empty, and then discarded by the
             * `if (svg.childNodes.length)` guard below. Nothing threw,
             * so it surfaced as a tool that reported success, listed the
             * feature in the panel, and drew nothing.
             */
            entity.type === "analysis-diagram"
        ) {
            const start = geometry.start;
            const end = geometry.end;

            if (
                !start || !end ||
                !Number.isFinite(start.x) ||
                !Number.isFinite(end.x)
            ) {
                return;
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
                 */
                const depth = 6;

                svg.appendChild(
                    createSvgElement("polygon", {
                        points: [
                            `${from.x + nx * depth},${from.y + ny * depth}`,
                            `${to.x + nx * depth},${to.y + ny * depth}`,
                            `${to.x - nx * depth},${to.y - ny * depth}`,
                            `${from.x - nx * depth},${from.y - ny * depth}`
                        ].join(" "),
                        fill: "none",
                        stroke,
                        "stroke-width": 1.4
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
                    return;
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
                    return;
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
                 * so the curve is the same curve at any zoom and the
                 * vector scale cannot touch it.
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
            return;
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
        if (entity.type === "load") {
            const start = geometry.start;
            const end = geometry.end;

            if (
                !start || !end ||
                !Number.isFinite(start.x) ||
                !Number.isFinite(end.x)
            ) {
                return;
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
                return;
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
                return;
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
            return;
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
        if (entity.type === "varying-load") {
            const start = geometry.start;
            const end = geometry.end;

            if (
                !start || !end ||
                !Number.isFinite(start.x) ||
                !Number.isFinite(end.x)
            ) {
                return;
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
                return;
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
            return;
        }

        /*
         * CONNECTION
         * Drawn as a link between two points with a marker
         * at each end.
         */
        if (entity.type === "connection") {
            const start = geometry.start;
            const end = geometry.end;

            if (
                !start || !end ||
                !Number.isFinite(start.x) ||
                !Number.isFinite(end.x)
            ) {
                return;
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
                    "stroke-width": 1.6
                })
            );

            [from, to].forEach(point => {
                svg.appendChild(
                    createSvgElement("circle", {
                        cx: point.x,
                        cy: point.y,
                        r: 3.5,
                        fill: "#ffffff",
                        stroke,
                        "stroke-width": 1.6
                    })
                );
            });

            parentSvg.appendChild(svg);
            return;
        }

        if (entity.type === "point") {
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
            return;
        }

        /*
         * LINE
         */
        if (
            entity.type === "line"
        ) {
            if (
                !geometry.start ||
                !geometry.end
            ) {
                return;
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
        if (
            entity.type ===
            "circle"
        ) {
            if (
                !geometry.center
            ) {
                return;
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
         * PARTICLE
         *
         * An engineering point node: a small filled circle
         * centred on the actual world position.
         */
        if (entity.type === "particle") {
            const position = geometry.position;

            if (
                !position ||
                !Number.isFinite(position.x) ||
                !Number.isFinite(position.y)
            ) {
                return;
            }

            const node = toScreen(position);
            const stroke = paintColour(style.stroke || enggTheme.defaultLineColour());

            svg.appendChild(
                createSvgElement("circle", {
                    cx: node.x,
                    cy: node.y,
                    r: 4,
                    fill: stroke,
                    stroke: "none"
                })
            );

            parentSvg.appendChild(svg);
            return;
        }

        /*
         * RECTANGLE
         *
         * A rigid body stores the same shape, so it renders
         * through the same branch and stays one coherent
         * feature rather than four separate lines.
         */
        if (
            entity.type ===
                "rectangle" ||
            entity.type ===
                "rigid-body"
        ) {
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
        if (
            entity.type ===
                "rigid-body"
        ) {
            appendRigidBody(
                svg,
                entity,
                geometry,
                style,
                toScreen,
                scale
            );

            parentSvg.appendChild(svg);
            return;
        }

        /*
         * POLYLINE
         */
        if (
            entity.type ===
            "polyline"
        ) {
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
                const polyline =
                    createSvgElement(
                        "polyline",
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
        if (
            entity.type ===
            "polygon"
        ) {
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
        if (
            entity.type ===
            "triangle"
        ) {
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
        if (
            entity.type ===
            "arc"
        ) {
            if (
                !geometry.center
            ) {
                return;
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
        if (
            entity.type ===
            "coordinate-system-2d"
        ) {
            appendCoordinateSystem(
                svg,
                geometry,
                style,
                state,
                bounds,
                entity.isPreview
            );
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
        if (svg.childNodes.length) {
            parentSvg.appendChild(svg);
        }
    }

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

export {
    appendEntity,
    memberJoints
};
