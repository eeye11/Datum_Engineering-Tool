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
import { resistorPoints } from "../../features/workspace/model/thermodynamics/resistor.js";
import enggTheme from "../../components/layout/workspace/theme.js";
import { LABEL_OFFSET_PX, createSvgElement, paintColour, zoomedFontHere } from "./svg-primitives.js";


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
        const fontSize = Number(style.fontSize) || 12;
        const lineHeight = fontSize * 1.2;
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
            y: origin.y - ((lines.length - 1) * lineHeight) / 2 + fontSize * 0.35,
            fill: unresolved ? "#999999" : stroke,
            "font-size": zoomedFontHere(fontSize),
            "font-family": "Arial, sans-serif",
            "text-anchor": "middle",
            ...(unresolved ? { "text-decoration": "underline dotted" } : {})
        });

        lines.forEach((line, index) => {
            if (index === 0) {
                textNode.textContent = line;
                return;
            }

            const tspan = createSvgElement("tspan", {
                x: origin.x,
                dy: lineHeight
            });

            tspan.textContent = line;
            textNode.appendChild(tspan);
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

        if (entity.metadata?.thermodynamicsKind === "electric-work") {
            svg.appendChild(createSvgElement("polyline", {
                points: resistorPoints(geometry).map(toScreen).map(point => `${point.x},${point.y}`).join(" "),
                fill: "none", stroke: paintColour(style.stroke || enggTheme.defaultLineColour()), "stroke-width": 1.5,
                "stroke-linecap": "round", "stroke-linejoin": "round"
            }));
            return;
        }

        const stroke = paintColour(style.stroke || enggTheme.defaultLineColour());
        const fontSize = Number(style.fontSize) || 12;
        const lineHeight = fontSize * 1.2;

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

        if (pathScreen.length >= 2) {
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
        if (kind === "label" && model.labelLeaderGap) {
            const labelAnchor =
                geometry.start && toScreen(geometry.start);

            const labelText =
                geometry.position && toScreen(geometry.position);

            if (labelAnchor && labelText) {
                const gap = Math.hypot(
                    labelText.x - labelAnchor.x,
                    labelText.y - labelAnchor.y
                );

                if (gap > 2.5 * fontSize) {
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
                (kind === "arrow" || kind === "leader" || kind === "callout") &&
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
                    createSvgElement("rect", {
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
                appendAnnotateText(
                    svg,
                    lines,
                    textAt,
                    textStroke,
                    fontSize,
                    note ? zoomedFontHere(fontSize) * typography.lineSpacing : lineHeight,
                    kind === "callout" ? "center" : entity.style?.align,
                    note ? typography : {}
                );
            }
        }
    }

    function widestLineWidth(lines, fontSize) {
        const widest = Math.max(
            1,
            ...lines.map((line) => String(line).length)
        );

        return widest * fontSize * 0.58;
    }

    /*
     * The words, centred on the point they belong to.
     */
    function appendAnnotateText(
        svg,
        lines,
        at,
        stroke,
        fontSize,
        lineHeight,
        align,
        typography = {}
    ) {
        const anchorName =
            align === "center"
                ? "middle"
                : align === "right"
                  ? "end"
                  : "start";

        const firstY =
            at.y -
            ((lines.length - 1) * lineHeight) / 2 +
            fontSize * 0.35;

        const textNode = createSvgElement("text", {
            x: at.x,
            y: firstY,
            fill: stroke,
            "font-size": zoomedFontHere(fontSize),
            "font-family": typography.fontFamily || "Arial, sans-serif",
            "font-weight": typography.bold ? "bold" : "normal",
            "font-style": typography.italic ? "italic" : "normal",
            "text-decoration": typography.underline ? "underline" : "none",
            "text-anchor": anchorName
        });

        lines.forEach((line, index) => {
            if (index === 0) {
                textNode.textContent = line;
                return;
            }

            const tspan = createSvgElement("tspan", {
                x: at.x,
                dy: lineHeight
            });

            tspan.textContent = line;
            textNode.appendChild(tspan);
        });

        svg.appendChild(textNode);
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
                        (height * (row + 0.5)) / rows +
                        fontSize * 0.35
                };

                const textNode = createSvgElement("text", {
                    x: cellCentre.x,
                    y: cellCentre.y,
                    fill: stroke,
                    "font-size": zoomedFontHere(fontSize * 0.85),
                    "font-family": "Arial, sans-serif",
                    "text-anchor": "middle"
                });

                textNode.textContent = value;
                svg.appendChild(textNode);
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

        const point =
            geometry.position ||
            geometry.point ||
            geometry.center ||
            null;

        if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
            return toScreen(point);
        }

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

        return null;
    }

    function appendFeatureLabel(svg, entity, state, bounds) {
        const text = typeof entity?.label === "string" ? entity.label.trim() : "";

        if (!text) {
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
         * THE LABEL TAKES THE FEATURE'S OWN COLOUR, so it reads as part of the
         * drawing rather than as interface furniture, and a student who
         * colour-coded a line gets a label to match.
         */
        const colour =
            entity.style && typeof entity.style.stroke === "string"
                ? entity.style.stroke
                : "#000000";

        const label = createSvgElement("text", {
            x: anchor.x + LABEL_OFFSET_PX,
            y: anchor.y - LABEL_OFFSET_PX,
            fill: colour,
            "font-size": zoomedFontHere(11),
            "font-family": "Arial, sans-serif",
            "text-anchor": "start",

            /*
             * A LABEL MUST NOT SWALLOW THE POINTER. It is drawing, not a
             * handle: a click on the text should select the FEATURE underneath,
             * and snap candidates, dimension targets and handles all sit in the
             * same few pixels. `none` is what keeps the label from becoming an
             * invisible obstruction over its own feature.
             */
            "pointer-events": "none"
        });

        label.textContent = text;

        svg.appendChild(label);
    }

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
