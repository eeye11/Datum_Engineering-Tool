import enggCanvasPalette from "./canvas-palette.js";
/*
 * Annotations: derived magnitude labels, the Annotate features (notes,
 * leaders, callouts, symbols, tables) and feature labels.
 *
 * Part of the renderer (see renderer.js), split out by concern.
 */
import { noteTextStyle } from "../typography/note-text-style.js";
import enggDrawingState from "../model/drawing-state.js";
import enggAnnotationModel from "../../features/workspace/model/annotations/annotation-model.js";
import enggAnnotate from "../../features/workspace/model/annotations/annotate-model.js";
import { annotationSubscript } from "../../features/workspace/model/annotations/math-label.js";
import {
    CANVAS_BASELINE,
    CANVAS_FONT_STACK,
    AUXILIARY_FONT_PX,
    LINE_SPACING,
    PRIMARY_FONT_PX,
    SECONDARY_FONT_PX,
    fontSizeOf,
    setTextTransform,
    textWidthEstimate
} from "../typography/canvas-typography.js";
import { resistorPoints } from "../../features/workspace/model/thermodynamics/resistor.js";
import { fanPaths } from "../../features/workspace/model/thermodynamics/fan.js";
import { workArrowPoints } from "../../features/workspace/model/thermodynamics/work-arrow.js";
import enggTheme from "../../components/layout/workspace/theme.js";
import {
    LABEL_OFFSET_PX,
    activeZoom,
    appendMathRuns as appendMathRunsShared,
    appendTextLines,
    createSvgElement,
    paintColour
} from "./svg-primitives.js";


    /*
     * AN ANNOTATION
     *
     * Drawn at the position the student put it - NOT at the feature's
     * position - which is the whole point of the object. The link to
     * the source feature affects the TEXT (which is read from the
     * feature every time) and the optional LEADER (which follows
     * wherever either end moves), and nothing about where the box
     * sits.
     *
     * An unresolved annotation is drawn hollow and dashed, so a label
     * left behind by a deleted feature is visible as a problem rather
     * than quietly asserting a value.
     */
    /*
 * SHOW MAGNITUDES, DRAWN FROM THE FEATURE.
 *
 * Everything else here draws what the document happens to contain. A
 * force's magnitude is not a separate thing on the sheet - it is a property
 * OF the force - so there was nothing for the setting to switch on, and
 * turning it on changed nothing.
 *
 * DERIVED, NOT STORED. This is called on every frame and produces the text
      * from the feature's own geometry, so it cannot go stale when the magnitude
      * is edited and cannot drift when the force moves. A stored copy would be a
      * second number free to disagree with the first.
      *
      * BUT THE PLACEMENT IS STORED, because the student can MOVE it.
      *
      * It used to be argued that the box carries no document id, so a click on
      * it resolves to the feature - "which is what clicking a force should
      * do". That is right for a click on the ARROW and wrong for a click on
      * the NUMBER: the arrow is the force, the number is a label the student
      * placed and has every reason to want somewhere else, because
      * `F = 100 N` printed across the arrowhead is unreadable.
      *
      * So the box is picked as the box, and moving it stores an OFFSET on the
      * feature - not the value. The number is still derived, so it cannot go
      * stale; only where it sits is remembered, which is exactly the part the
      * student chose and the part the application has no opinion about.
      *
      * An offset of null means "wherever it naturally falls", which is where
      * it sat before any of this and where it returns when the student moves
      * it back.
      *
      * CALLED FROM BOTH EXITS. Statics features take an early return once their
      * own symbol is drawn, so appending only at the end of the pass silently
      * skipped every force, load, moment, support and connection - which is the
      * entire set of features that has a magnitude.
      */
function appendDerivedMagnitude(svg, entity, state, toScreen, style) {
    const model = enggAnnotationModel;

    if (!model) {
        return;
    }

    /*
     * A PREVIEW DRAWS ITS MAGNITUDES TOO.
     *
     * While a varying load's points are being defined, each one shows
     * its own magnitude beside it, updating as the cursor moves - so the
     * student sees the load and its values taking shape together, not the
     * geometry now and the numbers only once it is committed. The labels
     * follow their points, which follow the cursor.
     *
     * A preview's labels are not selectable: the hit test reads the
     * document's own objects, and a preview is not one.
     */

    /*
     * EVERY ANNOTATION THE FEATURE OWNS, not just one.
     *
     * A force has one magnitude, so it has one box. A VARYING
     * DISTRIBUTED LOAD has one magnitude PER DEFINING POINT, so it has
     * one box per point - and the list is derived from the points
     * themselves, so the drawn count can never disagree with the number
     * of points the student defined.
     */
    const derived =
        model.derivedAnnotations(entity, state);

    if (!derived || !derived.length) {
        return;
    }

    derived.forEach((annotation) => {
        const group = createSvgElement("g");

        /*
         * A REAL ID, so the box is picked as the box.
         *
         * `derived-<feature>-<kind>` - stable across frames, so the same box is
         * the same thing to a click every time, and distinct from the feature's
         * own id so picking one never selects the other. The id is NOT in the
         * document: it is computed, and a document feature is not created by
         * looking at a force with magnitudes on.
         *
         * A profile point's box carries its point id too, so the two boxes
         * on a two-point load are two different things to a click rather
         * than one thing drawn twice.
         *
         * The group's own data-feature-id is what the hit test reads, and the
         * text inside it has pointer-events disabled so the click lands on the
         * group rather than on the glyph - a glyph is not a shape to aim at, and
         * hit-testing text measures the letters rather than the box.
         */
        group.setAttribute(
          "data-feature-id",
          annotation.id,
        );

        group.classList.add("drawing-derived-magnitude");

        appendAnnotationEntity(group, annotation, state, toScreen, style);

        if (group.childNodes.length) {
            svg.appendChild(group);
        }
    });
}

function appendAnnotationEntity(svg, entity, state, toScreen, style) {
        const model = enggAnnotationModel;

        if (!model) {
            return;
        }

        if (entity.visible === false) {
            return;
        }

        /*
         * Read from the feature itself, which is where the annotation
         * model keeps these - see the factory in drawing-state for why
         * they are not nested.
         */
        const text =
            model.textFor(entity, state) ||
            entity.text ||
            "";

        if (!text) {
            return;
        }

        const placement = entity.placement;

        if (
            !placement ||
            !Number.isFinite(placement.x) ||
            !Number.isFinite(placement.y)
        ) {
            return;
        }

        const origin = toScreen(placement);
        const stroke = paintColour(style.stroke || enggTheme.defaultLineColour());

        /*
         * A MAGNITUDE IS SECONDARY TYPE, IN SCREEN PIXELS.
         *
         * It is one of the four roles of the shared typography system, not a
         * number chosen here - and `textNode` paints it at that many pixels
         * however far the sheet is zoomed, while its anchor stays the projected
         * drawing position.
         */
        const fontSize = fontSizeOf(Number(style.fontSize), SECONDARY_FONT_PX);
        const lines = String(text).split("\n");
        const unresolved = entity.unresolved === true;

        /*
         * THE LEADER
         *
         * Part of the annotation, not a Line feature: it is computed
         * from the annotation's position and its source feature on
         * every draw, so moving either end moves the leader and
         * neither can leave a stray line behind.
         */
        const leader = model.leaderFor(entity, state);

        if (leader) {
            const from = toScreen(leader.from);
            const to = toScreen(leader.to);

            svg.appendChild(
                createSvgElement("line", {
                    x1: from.x,
                    y1: from.y,
                    x2: to.x,
                    y2: to.y,
                    stroke: unresolved ? "#999999" : stroke,
                    "stroke-width": 1,
                    ...(unresolved ? { "stroke-dasharray": "4 3" } : {})
                })
            );
        }

        const textNode = createSvgElement("text", {
            x: origin.x,
            y: origin.y,
            fill: unresolved ? "#999999" : stroke,
            "font-family": CANVAS_FONT_STACK,
            "text-anchor": "middle"
        });

        /*
         * THE CAMERA IS CANCELLED ON THE GLYPHS, NOT ON THE ANCHOR.
         *
         * `textTransform` divides the viewport out about the label's own point,
         * so the number stays the same size on screen at every zoom and stays
         * exactly where the drawing puts it. The line advance is the SCREEN line
         * height carried into the node's camera-scaled space, so multi-line
         * labels keep their leading too.
         */
        const zoom = Number(state?.camera?.zoom) || 1;

        textNode.setAttribute("font-size", String(Math.round(fontSize * zoom * 1000) / 1000));
        setTextTransform(textNode, origin, zoom);

        appendTextLines(textNode, lines, origin, {
            size: fontSize,
            lineSpacing: LINE_SPACING,
            zoom
        });

        svg.appendChild(textNode);
    }

    /*
     * ========================================================
     * AN ANNOTATE FEATURE: ONE DRAW, EIGHT KINDS
     * ========================================================
     *
     * Every annotate feature shares a core: text at a placement, drawn in
     * the feature's own style. A kind adds to that core only what its shape
     * needs - a pen for a leader and a callout, a head for an arrow and a
     * leader, a box for a callout and a tolerance, a grid for a table - so
     * the eight cannot drift in how they honour placement, style or the
     * draw order. It is the same reason they share one FEATURE type.
     *
     * ALL GEOMETRY IS WORLD-SPACE. Every point is projected through
     * `toScreen` on the way out, so a mark sits where the drawing puts it at
     * any zoom, pan or window size, and never where the screen did.
     */
    function appendAnnotateEntity(svg, entity, state, toScreen, style) {
        const model = enggAnnotate;

        if (!model || entity.visible === false) {
            return;
        }

        const kind = entity.annotateKind;
        const geometry = entity.geometry || {};

        if (entity.metadata?.thermodynamicsKind === "mechanical-work") {
            for (const points of fanPaths(geometry)) {
                svg.appendChild(createSvgElement("polyline", {
                    points: points.map(toScreen).map(point => `${point.x},${point.y}`).join(" "),
                    fill: "none", stroke: paintColour(style.stroke || enggTheme.defaultLineColour()),
                    "stroke-width": 1.5, "stroke-linejoin": "round"
                }));
            }
            return;
        }

        if (entity.metadata?.thermodynamicsKind === "electric-work") {
            svg.appendChild(createSvgElement("polyline", {
                points: resistorPoints(geometry).map(toScreen).map(point => `${point.x},${point.y}`).join(" "),
                fill: "none", stroke: paintColour(style.stroke || enggTheme.defaultLineColour()), "stroke-width": 1.5,
                "stroke-linecap": "round", "stroke-linejoin": "round"
            }));
            return;
        }

        const stroke = paintColour(style.stroke || enggTheme.defaultLineColour());

        /*
         * A NOTE IS PRIMARY TYPE - 16 px, or the student's own size.
         *
         * The one exception is a TABLE, whose cells are compact auxiliaries inside
         * a grid rather than a note's own words: it states its size below.
         */
        const fontSize = fontSizeOf(
            Number(style.fontSize),
            entity.annotateKind === "table" ? AUXILIARY_FONT_PX : PRIMARY_FONT_PX
        );
        const lineHeight = fontSize * LINE_SPACING;

        const start =
            geometry.start && toScreen(geometry.start);

        const end =
            geometry.end && toScreen(geometry.end);

        const anchor =
            geometry.position && toScreen(geometry.position);

        /*
         * THE LEADER OR ARROW SHAFT, drawn before the content so the text
         * sits ON TOP of its own pen rather than under it.
         *
         * A LEADER OR CALLOUT DRAWS ITS WHOLE PATH - attachment, every bend,
         * endpoint - as one polyline, because that ordered list IS the pen. An
         * arrow, and a leader with no bends, is the same thing with a path two
         * points long, so there is one drawing path rather than a straight case
         * and a bent case that could disagree about where the line goes.
         */
        const pathScreen =
            (model.leaderPathPoints?.(entity) || []).map((point) =>
                toScreen(point)
            );

        const blockArrow = entity.metadata?.thermodynamicsKind === "work-arrow" ? workArrowPoints(geometry) : [];
        if (blockArrow.length) {
            svg.appendChild(createSvgElement("polygon", {
                points: blockArrow.map(toScreen).map(point => `${point.x},${point.y}`).join(" "),
                fill: stroke, stroke, "stroke-width": 1, "stroke-linejoin": "miter"
            }));
        } else if (pathScreen.length >= 2) {
            svg.appendChild(
                createSvgElement("polyline", {
                    points: pathScreen
                        .map((point) => `${point.x},${point.y}`)
                        .join(" "),
                    fill: "none",
                    stroke,
                    "stroke-width": 1,
                    "stroke-linejoin": "round"
                })
            );
        } else if (start && end) {
            svg.appendChild(
                createSvgElement("line", {
                    x1: start.x,
                    y1: start.y,
                    x2: end.x,
                    y2: end.y,
                    stroke,
                    "stroke-width": 1
                })
            );
        }

        /*
         * A LABEL'S LEADER APPEARS WITH DISTANCE.
         *
         * A label marks a point on a body; its text may be moved away for
         * legibility. A short offset needs no line, so none is drawn; once the
         * text is more than about 2.5 text heights from the anchor a leader is
         * drawn from the anchor to the text, and it disappears again when the
         * text is brought back close.
         *
         * THE DECISION IS THE MODEL'S, read through `labelLeaderGap`, so the
         * threshold is stated once in world/text units and cannot drift between
         * the renderer and anything else that asks. The gap is compared in
         * SCREEN space here because the text is sized in screen pixels - which
         * is what makes the rule hold at every zoom rather than only at 1:1.
         */
        /*
         * A PARENTED LABEL HAS NO ANCHOR DOT AND NO LEADER.
         *
         * A Heat Transfer notation belongs to a circuit node, a symbol or a
         * boundary that ALREADY draws itself, so a dot here is a second marker
         * for one object - and a leader back to it is furniture the student did
         * not draw. This is the same rule the source writer applies, so the
         * picture and the export agree.
         */
        const ownsItsAnchor = !entity.metadata?.heatParentId;

        if (kind === "label" && model.labelLeaderGap && ownsItsAnchor) {
            const labelAnchor =
                geometry.start && toScreen(geometry.start);

            const labelText =
                geometry.position && toScreen(geometry.position);

            /*
             * A LABEL SITTING ON ITS OWN ANCHOR marks nothing: the dot is
             * hidden under the words, so it is not drawn.
             */
            const sameSpot =
                labelAnchor &&
                labelText &&
                Math.hypot(labelText.x - labelAnchor.x, labelText.y - labelAnchor.y) < 0.5;

            if (labelAnchor && labelText && !sameSpot) {
                /*
                 * THE GAP IN SCREEN PIXELS, then in TEXT HEIGHTS.
                 *
                 * Both projected points are on screen, and the type is a screen
                 * size, so the comparison is a true "how many text heights
                 * apart is this" at every zoom - the leader appears and
                 * disappears at the same visual distance however far the sheet
                 * is magnified.
                 */
                const gapPx = Math.hypot(
                    labelText.x - labelAnchor.x,
                    labelText.y - labelAnchor.y
                );

                if (gapPx > 2.5 * fontSize) {
                    svg.appendChild(
                        createSvgElement("line", {
                            x1: labelAnchor.x,
                            y1: labelAnchor.y,
                            x2: labelText.x,
                            y2: labelText.y,
                            stroke,
                            "stroke-width": 1
                        })
                    );
                }

                /*
                 * AN ANCHOR MARKER is drawn at the marked point, so the label's
                 * attachment is visible on the body rather than only implied by
                 * where the line ends. It is a small filled dot at a fixed screen
                 * size, like every other marker in the application.
                 */
                svg.appendChild(
                    createSvgElement("circle", {
                        cx: labelAnchor.x,
                        cy: labelAnchor.y,
                        r: 2.5,
                        fill: stroke
                    })
                );
            }
        }

        if (start && end) {
            /*
             * THE ARROWHEAD SITS AT THE POINTED END.
             *
             * For a leader and a callout the pen points at the target, so
             * the head is at `start`. For an Arrow the head is at `end`, the
             * direction the student dragged towards - the two kinds point
             * opposite ways on purpose, and each says so here rather than by
             * a shared guess.
             */
            const headAt = kind === "arrow" ? end : start;

            /*
             * THE TAIL IS THE NEAREST PATH POINT, not always the far end - so
             * a bent leader's head still lies along the segment it actually
             * ends, rather than pointing back at the text box across the bends.
             */
            const tailAt =
                kind === "arrow"
                    ? start
                    : pathScreen[1] || end;

            if (
                !blockArrow.length && (kind === "arrow" || kind === "leader" || kind === "callout") &&
                style.arrowhead !== "none"
            ) {
                appendAnnotateArrowhead(
                    svg,
                    headAt,
                    tailAt,
                    stroke,
                    style.arrowhead
                );
            }
        }

        /*
         * THE TEXT AND ITS FRAME.
         *
         * The content sits at the END of a leader's pen, at the arrow's
         * head, or at its own placement - whichever the kind has. A kind
         * with no text (an arrow, a bare table) draws none.
         */
        const typography = noteTextStyle(style);
        const note = entity.annotateKind === "note";
        const baseTextAt = kind === "callout" ? end || anchor : anchor || end;
        const textAt = note && geometry.position
            ? toScreen({...geometry.position, x:geometry.position.x + typography.indent})
            : baseTextAt;

        /*
         * WHAT IS DRAWN IS THE CONTENT, OR THE PLACEHOLDER WHEN THERE IS
         * NONE.
         *
         * An empty annotation is still a visible, editable thing: it draws
         * its contextual placeholder - "Enter note", "Enter callout" - in a
         * MUTED style, so the student can see the feature they just placed and
         * write into it, and so the sheet distinguishes "not written yet" from
         * "written, and it says this". The placeholder is drawn only; it is
         * never stored on the feature.
         */
        const text = model.displayTextOf(entity);

        const isPlaceholderText = Boolean(model.isPlaceholder?.(entity));

        const textStroke = isPlaceholderText
            ? "#9aa4aa"
            : stroke;

        if (textAt && text && !(entity.annotateKind === "note" && state.textEntryObjectId === entity.id)) {
            const lines = String(text).split("\n");

            /*
             * A CALLOUT AND A TOLERANCE WEAR A BOX.
             *
             * The box is what says "this is a statement about the part",
             * as against a bare note, and it is sized to the text it holds
             * so the two cannot come apart.
             */
            if (kind === "callout" || kind === "tolerance") {
                const balloon = kind === "callout" ? model.calloutBox(entity, state) : null;
                const topLeft = balloon ? toScreen({x:balloon.minX,y:balloon.maxY}) : null;
                const bottomRight = balloon ? toScreen({x:balloon.maxX,y:balloon.minY}) : null;
                const width = balloon ? bottomRight.x-topLeft.x : widestLineWidth(lines, fontSize) + 8;
                const height = balloon ? bottomRight.y-topLeft.y : lines.length * lineHeight + 4;

                svg.appendChild(
                    createSvgElement(entity.style?.calloutShape === "circle" && kind === "callout" ? "circle" : "rect", {
                        cx:textAt.x, cy:textAt.y, r:width/2,
                        x: textAt.x - width / 2,
                        y: textAt.y - height / 2,
                        width,
                        height,
                        fill: enggCanvasPalette.CANVAS_BACKGROUND[enggCanvasPalette.activeCanvasTheme()],
                        stroke,
                        "stroke-width": 0.8
                    })
                );
            }

            /*
             * A TABLE IS ITS GRID AND ITS CELLS.
             */
            if (kind === "table") {
                appendAnnotateTable(
                    svg,
                    entity,
                    textAt,
                    toScreen,
                    stroke,
                    fontSize
                );
            } else if (!(kind === "callout" && state.textEntryObjectId === entity.id)) {
                /*
                 * THE NOTE'S OWN FRAME AND TURN.
                 *
                 * A background is drawn ONLY when the student enabled one - the
                 * default is transparent, so no white rectangle appears behind
                 * text nobody asked to box. The padding is part of the same
                 * style, in the same screen pixels as the type, so the box grows
                 * with the words rather than with the zoom.
                 *
                 * ROTATION wraps the text AND its frame in one group, turned
                 * about the text's own anchor - so a turned note keeps its
                 * anchor exactly where it was, and the box does not swing away
                 * from the words it surrounds.
                 */
                const target = note && typography.rotation ? createSvgElement("g") : svg;

                if (note && typography.background) {
                    const pad = Math.max(0, typography.padding);
                    const boxWidth = widestLineWidth(lines, fontSize) + pad * 2;
                    const boxHeight = lines.length * fontSize * typography.lineSpacing + pad * 2;

                    /* Left-aligned text starts at the anchor; centred and right
                     * aligned text is positioned by the anchor's own alignment. */
                    const left =
                        typography.align === "center"
                            ? textAt.x - boxWidth / 2
                            : typography.align === "right"
                              ? textAt.x - boxWidth
                              : textAt.x;

                    target.appendChild(
                        createSvgElement("rect", {
                            x: left - pad * 0.25,
                            y: textAt.y - fontSize + pad * 0.25,
                            width: boxWidth,
                            height: boxHeight,
                            fill: typography.backgroundColour,
                            stroke: "none",
                            "pointer-events": "none"
                        })
                    );
                }

                appendAnnotateText(
                    target,
                    lines,
                    textAt,
                    textStroke,
                    fontSize,
                    note ? fontSize * typography.lineSpacing : lineHeight,
                    kind === "callout" ? "center" : entity.style?.align,
                    note ? typography : {},
                    entity.metadata?.mathSubscript,
                    entity.metadata?.mathSymbol,
                    entity.metadata?.mathSuffix
                );

                if (target !== svg) {
                    target.setAttribute(
                        "transform",
                        `rotate(${Number(typography.rotation) || 0} ${textAt.x} ${textAt.y})`
                    );
                    svg.appendChild(target);
                }
            }
        }
    }

    /*
     * THE WIDEST LINE, IN SCREEN PIXELS.
     *
     * The estimate is the shared one, so a box drawn around words is the same
     * shape and the same size as the words themselves - and because the type is
     * a screen size, so is the box. Nothing here multiplies by the zoom: an
     * on-screen width is an on-screen width at every magnification.
     */
    function widestLineWidth(lines, fontSize) {
        return textWidthEstimate(
            lines.reduce(
                (widest, line) => (
                    String(line).length > widest.length ? String(line) : widest
                ),
                ""
            ),
            fontSize,
            { characterWidth: 0.58 }
        );
    }

    /*
     * The words, centred on the point they belong to.
     *
     * THE BLOCK IS CENTRED ON ITS ANCHOR AND THE CAMERA IS CANCELLED ON THE
     * GLYPHS. The node is translated to its anchor and scaled by `1 / zoom`, so
     * the type keeps its screen size and the block keeps its anchor - a label
     * neither shrinks as the student zooms out nor drifts off the point.
     * `dominant-baseline: middle` centres each line on its own advance, which is
     * what replaces the per-call-site `fontSize * 0.35` nudge.
     */
    function appendAnnotateText(
        svg,
        lines,
        at,
        stroke,
        fontSize,
        lineHeight,
        align,
        typography = {},
        mathSubscript = null,
        mathSymbol = null,
        mathSuffix = ""
    ) {
        const anchorName =
            align === "center"
                ? "middle"
                : align === "right"
                  ? "end"
                  : "start";

        const zoom = Math.max(Number(activeZoomForText()), 0.0001);

        /*
         * THE FIRST LINE'S OWN OFFSET, so a block of n lines is centred on the
         * anchor: line i sits at (i - (n - 1) / 2) advances from the centre.
         */
        const firstY = at.y - ((lines.length - 1) * lineHeight) / 2;

        const textNode = createSvgElement("text", {
            x: at.x,
            y: firstY,
            fill: stroke,
            "font-family": typography.fontFamily || CANVAS_FONT_STACK,
            "font-weight": typography.bold ? "bold" : "normal",
            "font-style": typography.italic ? "italic" : "normal",
            "text-decoration": typography.underline ? "underline" : "none",
            "text-anchor": anchorName,
            "dominant-baseline": CANVAS_BASELINE
        });

        textNode.setAttribute("font-size", String(Math.round(fontSize * zoom * 1000) / 1000));
        setTextTransform(textNode, at, zoom);

        lines.forEach((line, index) => {
            if (index === 0) {
                const math = lines.length === 1 && annotationSubscript(line, { mathSubscript, mathSymbol, mathSuffix });
                if (math) {
                    textNode.textContent = math.base;
                    const subscript = createSvgElement("tspan", { "baseline-shift": "sub", "font-size": "70%" });
                    subscript.textContent = math.subscript;
                    textNode.appendChild(subscript);
                    if (math.suffix) {
                        const suffix = createSvgElement("tspan", {});
                        suffix.textContent = math.suffix;
                        textNode.appendChild(suffix);
                    }
                    return;
                }
                /*
                 * A SINGLE LINE OF MATHEMATICS IS TYPESET.
                 *
                 * `T_1`, `q''_{in}`, `\dot{Q}` - the notation a Heat Transfer
                 * label holds - is rendered as runs rather than pasted with its
                 * markup, through the SAME parser the other label pass uses, so
                 * a configuration label and a Heat notation cannot disagree.
                 */
                appendMathRunsShared(textNode, line, fontSize);
                return;
            }

            const tspan = createSvgElement("tspan", {
                x: at.x,
                dy: Math.round(lineHeight * zoom * 1000) / 1000
            });

            tspan.textContent = line;
            textNode.appendChild(tspan);
        });

        svg.appendChild(textNode);
    }

    /*
     * THE ZOOM THIS FRAME IS DRAWN AT.
     *
     * The renderer records it once per pass (see `setActiveZoom`), because this
     * module draws into a group that has no `state` of its own when it is called
     * from a preview. One number, set by the pass, read here.
     */
    function activeZoomForText() {
        return Math.max(0.0001, Number(activeZoom) || 1);
    }

    /*
     * A head at the pointed end, aimed along the shaft.
     *
     * Built from the two projected ends rather than from an angle, so it
     * follows the pen exactly however the drawing is rotated or zoomed. A
     * closed head is filled; an open one is two strokes.
     */
    function appendAnnotateArrowhead(
        svg,
        head,
        tail,
        stroke,
        headStyle
    ) {
        const dx = head.x - tail.x;
        const dy = head.y - tail.y;
        const length = Math.hypot(dx, dy);

        if (length < 1e-6) {
            return;
        }

        const ux = dx / length;
        const uy = dy / length;

        const size = 9;
        const spread = 4;

        const base = {
            x: head.x - ux * size,
            y: head.y - uy * size
        };

        const left = {
            x: base.x - uy * spread,
            y: base.y + ux * spread
        };

        const right = {
            x: base.x + uy * spread,
            y: base.y - ux * spread
        };

        if (headStyle === "open") {
            svg.appendChild(
                createSvgElement("path", {
                    d: `M${left.x} ${left.y}L${head.x} ${head.y}L${right.x} ${right.y}`,
                    fill: "none",
                    stroke,
                    "stroke-width": 1.2,
                    "stroke-linecap": "round",
                    "stroke-linejoin": "round"
                })
            );

            return;
        }

        /*
         * A DOT: a filled marker at the pointed end.
         *
         * The engineering convention for a leader that touches a surface
         * rather than pointing at an edge - a small solid dot where the pen
         * lands. It is a circle on the head, so it needs no direction, which is
         * why it is drawn before the arrowhead geometry below.
         */
        if (headStyle === "dot") {
            svg.appendChild(
                createSvgElement("circle", {
                    cx: head.x,
                    cy: head.y,
                    r: 2.6,
                    fill: stroke
                })
            );

            return;
        }

        /*
         * A TICK: a short stroke across the pen at the pointed end.
         *
         * The convention for a leader that stops AT a line rather than
         * touching it. It is perpendicular to the pen so it reads as a mark on
         * the drawing, not a stray spur.
         */
        if (headStyle === "tick") {
            const tick = 4.5;

            svg.appendChild(
                createSvgElement("line", {
                    x1: head.x - uy * tick,
                    y1: head.y + ux * tick,
                    x2: head.x + uy * tick,
                    y2: head.y - ux * tick,
                    stroke,
                    "stroke-width": 1.4,
                    "stroke-linecap": "round"
                })
            );

            return;
        }

        svg.appendChild(
            createSvgElement("path", {
                d: `M${head.x} ${head.y}L${left.x} ${left.y}L${right.x} ${right.y}Z`,
                fill: stroke,
                stroke,
                "stroke-width": 0.8,
                "stroke-linejoin": "round"
            })
        );
    }

    /*
     * A table: its grid, then its cells.
     *
     * Drawn from the stored rows, columns and cells, in the feature's own
     * units, so the grid on screen IS the grid that was saved - not a
     * picture of one. Resizing the table resizes this, because there is
     * nothing but the feature's data behind it.
     */
    function appendAnnotateTable(
        svg,
        entity,
        at,
        toScreen,
        stroke,
        fontSize
    ) {
        const model = enggAnnotate;
        const geometry = entity.geometry || {};
        const rows = Number(geometry.rows) || 1;
        const columns = Number(geometry.columns) || 1;

        const cellW = model.TABLE_CELL_W;
        const cellH = model.TABLE_CELL_H;

        const topLeft = at;

        /* The outer frame. */
        const bottomRight = toScreen({
            x: geometry.position.x + columns * cellW,
            y: geometry.position.y + rows * cellH
        });

        const width = bottomRight.x - topLeft.x;
        const height = bottomRight.y - topLeft.y;

        svg.appendChild(
            createSvgElement("rect", {
                x: topLeft.x,
                y: topLeft.y,
                width,
                height,
                fill: "#ffffff",
                stroke,
                "stroke-width": 0.9
            })
        );

        /* The inner rules. */
        for (let column = 1; column < columns; column += 1) {
            const x = topLeft.x + (width * column) / columns;

            svg.appendChild(
                createSvgElement("line", {
                    x1: x,
                    y1: topLeft.y,
                    x2: x,
                    y2: topLeft.y + height,
                    stroke,
                    "stroke-width": 0.6
                })
            );
        }

        for (let row = 1; row < rows; row += 1) {
            const y = topLeft.y + (height * row) / rows;

            svg.appendChild(
                createSvgElement("line", {
                    x1: topLeft.x,
                    y1: y,
                    x2: topLeft.x + width,
                    y2: y,
                    stroke,
                    "stroke-width": 0.6
                })
            );
        }

        /* Every cell's own text. */
        const cells = Array.isArray(geometry.cells)
            ? geometry.cells
            : [];

        for (let row = 0; row < rows; row += 1) {
            for (let column = 0; column < columns; column += 1) {
                const value = cells[row * columns + column];

                if (!value) {
                    continue;
                }

                const cellCentre = {
                    x:
                        topLeft.x +
                        (width * (column + 0.5)) / columns,
                    y:
                        topLeft.y +
                        (height * (row + 0.5)) / rows
                };

                /*
                 * A CELL IS THE TABLE'S TYPE, centred on its own cell.
                 *
                 * No `* 0.85` multiplier: a table's cells took 85% of the
                 * table's size, which is how a table ended up with a size no
                 * role in the hierarchy could name. The table states its size
                 * (auxiliary, 12 px) and every cell is drawn at it.
                 */
                const cell = createSvgElement("text", {
                    x: cellCentre.x,
                    y: cellCentre.y,
                    fill: stroke,
                    "font-family": CANVAS_FONT_STACK,
                    "text-anchor": "middle",
                    "dominant-baseline": CANVAS_BASELINE
                });

                const zoom = activeZoomForText();

                cell.setAttribute("font-size", String(Math.round(fontSize * zoom * 1000) / 1000));
                setTextTransform(cell, cellCentre, zoom);

                cell.textContent = value;
                svg.appendChild(cell);
            }
        }
    }

    /*
     * ========================================================
     * A FEATURE'S LABEL, DRAWN BESIDE IT
     * ========================================================
     *
     * THE LABEL IS THE FEATURE'S OWN DATA. It is stored on the feature
     * (`object.label`), saved with it, cloned with it and undone with it, so it
     * follows the feature when it moves and cannot drift away from it - which is
     * what rules out drawing it as a detached text object somewhere near the
     * shape.
     *
     * WHERE IT SITS is the anchor of the shape: a point's position, a line's
     * midpoint, a circle's centre. That is a property of the GEOMETRY, so the
     * label moves with the feature for free, and every type is answered by one
     * function rather than by a per-type placement rule.
     *
     * AN EMPTY LABEL DRAWS NOTHING. "Carries no label" and "carries an empty
     * label" look the same on the sheet, and neither should leave a stray mark.
     */
    function labelAnchorFor(entity, toScreen) {
        const geometry = entity.geometry || {};

        /*
         * A DYNAMICS SPAN SYMBOL ANCHORS AT ITS MIDDLE. A spring, a damper, a
         * polar vector and a spring-damper carry their extents as two
         * terminals and no centre, so they are tested BEFORE the point list - a
         * symbol whose label was anchored to its start would print it at one
         * end rather than beside the thing it names.
         */
        if (
            geometry.start &&
            geometry.end &&
            Number.isFinite(geometry.start.x) &&
            Number.isFinite(geometry.end.x)
        ) {
            return toScreen({
                x: (geometry.start.x + geometry.end.x) / 2,
                y: (geometry.start.y + geometry.end.y) / 2
            });
        }

        const point =
            geometry.position ||
            geometry.point ||
            geometry.center ||
            null;

        if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
            return toScreen(point);
        }

        return null;
    }

    /*
     * WHERE THE LABEL SITS RELATIVE TO ITS ANCHOR, in drawing units.
     *
     * `geometry.labelOffset` is the explicit, editable offset a Dynamics
     * symbol offers; without one the label keeps the historical screen-space
     * nudge. It is measured from the anchor, so the label follows its parent
     * whenever the parent moves, turns or is resized - and it never draws a
     * leader, because it is text and nothing else.
     */
    function labelOffsetFor(entity, scale) {
        const offset = entity?.geometry?.labelOffset;

        if (offset && Number.isFinite(Number(offset.x)) && Number.isFinite(Number(offset.y))) {
            return {
                x: Number(offset.x) * scale,
                y: -Number(offset.y) * scale
            };
        }

        return { x: LABEL_OFFSET_PX, y: -LABEL_OFFSET_PX };
    }

    function appendFeatureLabel(svg, entity, state, bounds) {
        const text = typeof entity?.label === "string" ? entity.label.trim() : "";

        if (!text) {
            return;
        }

        /*
         * A HEAT TRANSFER LABEL IS ITS OWN OBJECT, SO IT IS NOT DRAWN HERE.
         *
         * Its notation is a child `annotate` feature which the ordinary
         * entity pass draws - and which the student can select and move on its
         * own. Drawing the parent's `label` string as well would print every
         * notation twice, once selectable and once not.
         */
        if (entity?.metadata?.heatTransfer === true) {
            return;
        }

        /*
         * The SAME projection every other mark uses, so a label lands exactly
         * where the drawing says it should at any zoom, pan or window size.
         */
        const toScreen = (point) =>
            enggDrawingState.engineeringToScreen(point, bounds, state);

        const anchor = labelAnchorFor(entity, toScreen);

        if (!anchor) {
            return;
        }

        /*
         * THE LABEL'S OWN STYLE, WHEN IT HAS ONE.
         *
         * A Heat Transfer label carries its own text colour, size and
         * alignment (`style.label*`), set from the Features Label section, so a
         * label can be coloured independently of the geometry it annotates.
         * Without one it keeps taking the feature's own colour, so it still
         * reads as part of the drawing rather than as interface furniture.
         */
        const labelStyle = entity.style || {};

        const colour =
            /^#[0-9a-f]{6}$/i.test(String(labelStyle.labelColour || ""))
                ? labelStyle.labelColour
                : typeof labelStyle.stroke === "string"
                  ? labelStyle.stroke
                  : "#000000";

        const scale =
            enggDrawingState.BASE_PIXELS_PER_UNIT * (state.camera?.zoom || 1);
        const offset = labelOffsetFor(entity, scale);

        /*
         * THE LABEL'S SIZE IS THE SYSTEM'S SIZE.
         *
         * It used to fall back to a hard-coded 11 when the feature carried no
         * `labelSize` - a size no role in the hierarchy names, and half the size
         * of an ordinary note. Now an absent size is the SECONDARY role (14 px),
         * and the student's own `labelSize` - or a `style.fontSize` written by
         * the quick-access control - is honoured as a screen size.
         */
        const labelSize = fontSizeOf(
            Number(labelStyle.labelSize) > 0
                ? Number(labelStyle.labelSize)
                : Number(labelStyle.fontSize),
            SECONDARY_FONT_PX
        );

        const anchorMode =
            ["start", "middle", "end"].includes(labelStyle.labelAnchor)
                ? labelStyle.labelAnchor
                : "start";

        /*
         * THE OFFSET IS A SCREEN DISTANCE, so it is divided by the camera before
         * it is added to a projected point: `labelOffsetFor` answers in drawing
         * units at the current scale, and this node is positioned in screen
         * pixels. An explicit `geometry.labelOffset` stays in drawing units and
         * therefore still moves with the geometry.
         */
        const zoom = Math.max(Number(state?.camera?.zoom) || 1, 0.0001);
        const explicit = entity?.geometry?.labelOffset;
        const hasExplicit = explicit && Number.isFinite(Number(explicit.x)) && Number.isFinite(Number(explicit.y));

        const at = {
            x: anchor.x + (hasExplicit ? offset.x : (LABEL_OFFSET_PX)),
            y: anchor.y + (hasExplicit ? offset.y : (-LABEL_OFFSET_PX))
        };

        const weight = labelStyle.labelBold === true ? "bold" : "normal";
        const slant = labelStyle.labelItalic === true ? "italic" : "normal";

        const label = createSvgElement("text", {
            x: at.x,
            y: at.y,
            fill: colour,
            "font-family": CANVAS_FONT_STACK,
            "font-weight": weight,
            "font-style": slant,
            "text-anchor": anchorMode,
            "dominant-baseline": CANVAS_BASELINE,

            /*
             * A LABEL MUST NOT SWALLOW THE POINTER. It is drawing, not a
             * handle: a click on the text should select the FEATURE underneath,
             * and snap candidates, dimension targets and handles all sit in the
             * same few pixels. `none` is what keeps the label from becoming an
             * invisible obstruction over its own feature.
             */
            "pointer-events": "none"
        });

        /*
         * THE CAMERA IS CANCELLED ON THE GLYPHS. The label's position is the
         * projected anchor plus a screen offset; its type is a screen size, so
         * it is the same size at every zoom while the label still travels with
         * the feature it names.
         */
        label.setAttribute("font-size", String(Math.round(labelSize * zoom * 1000) / 1000));
        setTextTransform(label, at, zoom);

        /*
         * THE TEXT IS TYPESET, NOT PASTED.
         *
         * `T_1`, `q''_{in}` and `\dot{Q}` are MATHEMATICS, so the runs the
         * expression parser returns are written as `<tspan>`s: a script shifts
         * its baseline and shrinks, an accent is drawn above its value. Raw
         * underscores and braces never reach the sheet.
         */
        appendMathRunsShared(label, text, labelSize);

        svg.appendChild(label);
    }

    /*
     * WRITE A TYPESET EXPRESSION INTO A <text>, as runs.
     *
     * THE ONE TYPESETTER LIVES IN `svg-primitives.js` and is re-exported here,
     * so a caller that already imported it from this module keeps working and
     * there is still exactly one way an expression becomes glyphs.
     */


export {
    appendDerivedMagnitude,
    appendAnnotationEntity,
    appendAnnotateEntity,
    widestLineWidth,
    appendAnnotateText,
    appendAnnotateArrowhead,
    appendAnnotateTable,
    labelAnchorFor,
    appendFeatureLabel
};
