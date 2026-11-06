/*
 * Drawing one feature: Forces, resultants, force components, supports and connections.
 *
 * Each function draws one kind of feature into its group, from the context
 * appendEntity (entity-render.js) builds. It returns true when the feature
 * is finished, so no later renderer in the table runs for it.
 */
import { appendConnectionSymbol, appendSupportSymbol } from "../symbol-render.js";
import { appendDerivedMagnitude } from "../annotation-render.js";
import { appendForceArrow, appendVectorArrow, forceDirectionOnScreen } from "../vector-render.js";
import { createSvgElement, paintColour } from "../svg-primitives.js";
import enggBodyFrames from "../../geometry/body-frames.js";
import enggLoadProfile from "../../../features/workspace/model/analysis/load-profile.js";
import enggTheme from "../../../components/layout/workspace/theme.js";
import { COMPONENT_COLOURS } from "../component-colours.js";
import { isConnectionType, isSupportType } from "../../model/feature-types.js";


        /*
         * STATICS SYMBOL FEATURES
         *
         * A point force and the support and connection symbols
         * all draw from one anchor point, so they are handled
         * in this single pass. An applied moment, a
         * distributed load and a varying distributed load are
         * drawn by their own blocks further down.
         */
    export function drawVectorOrSymbol({ svg, parentSvg, entity, state, geometry, style, toScreen }) {
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
                return true;
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
                            COMPONENT_COLOURS.x,
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
                            COMPONENT_COLOURS.y,
                            style,
                            "solid"
                        );
                    }

                    const x = geometry.horizontal;
                    const y = geometry.vertical;
                    if (geometry.showX !== false && geometry.showY !== false &&
                        x?.start && x.end && y?.start && y.end && geometry.original?.end &&
                        Math.hypot(x.end.x - x.start.x, x.end.y - x.start.y) > 1e-9 &&
                        Math.hypot(y.end.x - y.start.x, y.end.y - y.start.y) > 1e-9) {
                        const guideStyle = { ...style, lineWidth: (Number(style.lineWidth) || 0.5) * 0.5 };
                        for (const end of [x.end, y.end]) {
                            appendVectorArrow(svg, toScreen(end), toScreen(geometry.original.end), stroke, guideStyle, "construction");
                        }
                    }
                    appendDerivedMagnitude(svg, entity, state, toScreen, style);
                    parentSvg.appendChild(svg);
                    return true;
                }
            }

            if (
                entity.type === "force" ||
                entity.type === "resultant"
            ) {
                /*
                 * THE ARROW THE STUDENT DREW.
                 *
                 * Tail and head are the force's stored drawn points (see
                 * `drawnForceAxis`); the magnitude is only the label. Nothing
                 * converts a value into a length.
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
                    entity.type === "fixed-support" && placement
                        ? -placement.orientation
                        : frame
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
                return true;
            }

            appendDerivedMagnitude(svg, entity, state, toScreen, style);
            parentSvg.appendChild(svg);
            return true;
        }


        /*
         * CONNECTION
         * Drawn as a link between two points with a marker
         * at each end.
         */
    export function drawGenericConnection({ svg, parentSvg, geometry, style, toScreen }) {
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
            return true;
        }
