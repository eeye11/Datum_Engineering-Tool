/* SVG renderer for the engineering drawing workspace. */
import enggErrorLog from "../app/error-log.js";
import enggBodyFrames from "../core/geometry/body-frames.js";
import enggFeatureGeometry from "../core/geometry/feature-geometry.js";
import { processLabelPoint } from "../features/thermodynamics/process-labels.js";
import { isSaturationCurve, saturationPaths } from "../features/thermodynamics/saturation-curve.js";
import { selectionBounds, selectionCorners } from "../core/selection/selection-transform.js";
import { cylinderPoint, isPistonCylinder, pistonFraction, stopperFraction, stopperPaths } from "../features/thermodynamics/piston-cylinder.js";
import { coordinateSystemArms, rigidBodyHandles, trussJoints } from "../core/geometry/feature-handles.js";
import enggMeasurement from "../core/geometry/measurement-core.js";
import enggDrawingState from "../core/model/drawing-state.js";
import { axisLabelPositions } from "../core/geometry/axis-labels.js";
import enggDiagramEquations from "../features/analysis/diagram-equations.js";
import enggAnalysisFrame from "../features/analysis/analysis-frame.js";
import enggLoadProfile from "../features/analysis/load-profile.js";
import enggDrawingRotationalArrow from "../features/analysis/rotational-arrow.js";
import enggAnnotationModel from "../features/annotations/annotation-model.js";
import enggAnnotate from "../features/annotations/annotate-model.js";
import enggDimensionModel from "../features/dimensions/dimension-model.js";
import enggVariableDimension from "../features/dimensions/variable-dimension.js";
import enggTheme from "../editor/theme.js";
import enggCanvasPalette from "./canvas-palette.js";

    const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

    /*
     * HOW FAR A FEATURE'S LABEL SITS FROM ITS ANCHOR, in screen pixels.
     *
     * A few pixels up and to the right, so the text clears the marker it
     * belongs to without drifting far enough to look like it labels something
     * else. It is a SCREEN offset - not a world one - so a label stays the same
     * readable distance from its feature at every zoom, and zooming in does not
     * walk the text away from the point.
     */
    const LABEL_OFFSET_PX = 7;

    /*
     * ========================================================
     * TEXT SCALES WITH THE ZOOM; NOTHING ELSE DOES
     * ========================================================
     *
     * Zooming in makes TEXT bigger so it stays readable as the drawing grows,
     * and zooming out makes it smaller so it stops crowding the geometry. It
     * changes NOTHING else: lines, arrows, symbols, dimension extension lines,
     * supports, moments and every geometric position are drawn in world units
     * through the camera, exactly as they were - they already scale with zoom
     * because they ARE the drawing, and a second scaling on top of that would
     * make an arrow twice the size the student drew.
     *
     * WHY A MODULE-LEVEL VALUE RATHER THAN A PARAMETER.
     *
     * Twelve places emit a `font-size`: the annotation model, the annotate
     * features, dimension and variable-dimension text, the diagram axis labels
     * and tick numbers, and a handful inside the drawing helpers. Threading
     * `state` through every one of them - and through the helpers that do not
     * currently receive it - would be a dozen signature changes to carry one
     * number, and each would be a chance to forget one. It is set ONCE at the
     * top of every render, from the state that render was given, so it cannot
     * describe a zoom other than the one being drawn.
     *
     * IT IS READ-ONLY TO EVERYTHING BELOW. Nothing writes `state.camera.zoom`
     * from here, and nothing writes a feature's stored `style.fontSize` - the
     * student's own setting is theirs, and this only changes how large it is
     * PAINTED.
     */
    let activeZoom = 1;

    /*
     * ========================================================
     * THE THEME THE CURRENT FRAME IS BEING PAINTED IN
     * ========================================================
     *
     * A feature's stored colour is the AUTHORED one and must never change. What
     * the canvas paints is that colour RESOLVED for the active theme - ink on a
     * light sheet, ice on a dark one - so the same drawing is legible either way
     * without the document being rewritten.
     *
     * It is set ONCE at the top of every render, from the same place the zoom is,
     * and for the same reason: hundreds of call sites set a stroke, and threading
     * the theme through every one of them would be hundreds of chances to forget.
     * `paintColour` reads it, and it describes the frame being drawn because the
     * frame being drawn is what set it.
     *
     * IT IS READ-ONLY TO EVERYTHING BELOW. Nothing writes a feature's stored
     * `style.stroke` from here - `canvas-palette.js` is a pure function, so the
     * same authored colour always resolves to the same display colour and a theme
     * toggle can never accumulate.
     */
    let activeTheme = "light";

    /*
     * THE ONE PLACE A COLOUR BECOMES A PAINTED COLOUR.
     *
     * Every stroke and fill the renderer emits goes through here, so the rule is
     * stated once instead of being re-implemented - and re-implemented
     * differently - in each drawing function. That is what keeps geometry,
     * dimensions, annotations, forces, loads, supports and analysis graphics
     * consistent with one another, which the requirement asks for explicitly.
     *
     * `currentColor`, `none`, a URL and a named CSS colour are all returned
     * UNCHANGED by the palette: it only rewrites colours it can parse, so an
     * unfilled shape does not become a filled one.
     */
    function paintColour(colour) {
        return enggCanvasPalette.displayColourFor(colour, activeTheme);
    }

    /*
     * HOW MUCH BIGGER THAN ITS STORED SIZE A FONT IS PAINTED.
     *
     * The restriction is deliberately WEAKER than the camera's: at 400% zoom a
     * word at four times its size would cover the drawing it labels, and at 25%
     * it would be unreadable. So the text follows the zoom only within a band -
     * past either end it stops, and the drawing keeps scaling around it.
     *
     * A square root rather than the zoom itself is the curve: it keeps the text
     * responding visibly across the whole range instead of hitting the ceiling
     * within the first two zoom steps, which is what a student actually notices.
     */
    const TEXT_SCALE_MIN = 0.55;
    const TEXT_SCALE_MAX = 1.6;

    function textScale(state) {
        const zoom = Number(state?.camera?.zoom);

        if (!Number.isFinite(zoom) || zoom <= 0) {
            return 1;
        }

        const scaled = Math.sqrt(zoom);

        return Math.min(TEXT_SCALE_MAX, Math.max(TEXT_SCALE_MIN, scaled));
    }

    /*
     * A stored font size, in the size it is actually painted at.
     *
     * EVERY `font-size` the renderer emits goes through this, so there is one
     * place that decides how text responds to zoom and no site can disagree
     * with another. There is the HARD CEILING and FLOOR here too, in absolute
     * pixels: a note stored at 30 stays readable at extreme zoom-out, and one
     * stored at 4 does not become a hairline at extreme zoom-in.
     */
    const FONT_PX_MIN = 6;
    const FONT_PX_MAX = 64;

    function zoomedFont(base, state) {
        const size = Number(base);

        if (!Number.isFinite(size) || size <= 0) {
            return base;
        }

        const scaled = size * textScale(state ?? { camera: { zoom: activeZoom } });

        return Math.min(FONT_PX_MAX, Math.max(FONT_PX_MIN, scaled));
    }

    /*
     * The paint size for a font when the STATE is not in scope.
     *
     * A few helpers - the created-plate text, the annotate kinds - are deep
     * enough that threading `state` would reach several call sites for one
     * number. They read the zoom this render was started with instead, which is
     * the same value, set once per frame.
     */
    function zoomedFontHere(base) {
        return zoomedFont(base, null);
    }

    function createSvgElement(type, attributes = {}) {
        const element =
            document.createElementNS(
                SVG_NAMESPACE,
                type
            );

        Object.entries(attributes).forEach(
            ([key, value]) => {
                element.setAttribute(
                    key,
                    value
                );
            }
        );

        return element;
    }

    function arcPathData(center, radius, startAngle, endAngle) {
        const sweep = endAngle - startAngle;

        if (
            !Number.isFinite(sweep) ||
            Math.abs(sweep) <= 1e-10 ||
            !Number.isFinite(radius) ||
            radius <= 0
        ) {
            return "";
        }

        const start = {
            x: center.x + radius * Math.cos(startAngle),
            y: center.y - radius * Math.sin(startAngle)
        };
        const segmentCount = Math.max(
            1,
            Math.ceil(Math.abs(sweep) / Math.PI)
        );
        const segmentSweep = sweep / segmentCount;
        let path = `M ${start.x} ${start.y}`;

        for (let index = 1; index <= segmentCount; index += 1) {
            const angle = startAngle + segmentSweep * index;
            const end = {
                x: center.x + radius * Math.cos(angle),
                y: center.y - radius * Math.sin(angle)
            };

            path += ` A ${radius} ${radius} 0 0 ${segmentSweep < 0 ? 1 : 0} ${end.x} ${end.y}`;
        }

        return path;
    }

    function ensureSvg(canvas) {
        let svg =
            canvas.querySelector(
                ".drawing-renderer"
            );

        if (!svg) {
            svg =
                document.createElementNS(
                    SVG_NAMESPACE,
                    "svg"
                );

            svg.classList.add(
                "drawing-renderer"
            );

            svg.setAttribute(
                "aria-hidden",
                "true"
            );

            canvas.appendChild(svg);
        }

        const bounds =
            canvas.getBoundingClientRect();

        svg.setAttribute(
            "viewBox",
            `0 0 ${bounds.width} ${bounds.height}`
        );

        svg.setAttribute(
            "width",
            bounds.width
        );

        svg.setAttribute(
            "height",
            bounds.height
        );

        return svg;
    }

    /*
     * The dash pattern a line type draws with, or null for a solid
     * one.
     *
     * Factored out of applyStyle so the force and load shafts, which
     * build their lines element by element rather than through
     * applyStyle, can honour the line type the Features panel
     * actually selected. Without this, a load drawn as a dashed or
     * centre line stored the choice and silently ignored it, while
     * every other feature in the drawing honoured it.
     */
    function dashPatternFor(
        lineType
    ) {
        if (lineType === "dotted") return "1 4";
        if (lineType === "dashed") {
            return "8 5";
        }

        if (lineType === "center") {
            return "12 4 2 4";
        }

        if (lineType === "construction") {
            return "4 4";
        }

        return null;
    }

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

    function styledLine(
        from,
        to,
        style,
        widthOverride
    ) {
        /*
         * The same shared scale every other stroke uses.
         *
         * This took `style.lineWidth` as if the millimetre value were
         * already a pixel width, so a Line drawn through here came out
         * thinner than the same Line drawn through applyStyle. One
         * number, one meaning: a configured weight in millimetres in,
         * a consistent weight on screen out.
         *
         * An explicit `widthOverride` is still honoured, because that
         * is a caller asking for a specific width - snap markers and
         * the like, which are UI furniture rather than drawing.
         */
        const width = Number.isFinite(widthOverride)
            ? widthOverride
            : scaledStrokeWidth(style?.lineWidth);

        const attributes = {
            x1: from.x,
            y1: from.y,
            x2: to.x,
            y2: to.y,
            stroke: style?.stroke || "#000000",
            "stroke-width": width,
            "stroke-linecap": "round"
        };

        const dash =
            dashPatternFor(style?.lineType);

        if (dash) {
            attributes["stroke-dasharray"] = dash;
        }

        return createSvgElement(
            "line",
            attributes
        );
    }

    /*
     * THE SHARED STROKE-WIDTH SCALE.
     *
     * A configured line width is a real-world weight in millimetres.
     * The drawing is rendered in pixels, so every stroke has to be
     * scaled from that weight into the same on-screen thickness an
     * ordinary line of the same weight gets. This is that scale, and
     * it is the ONLY place the conversion happens.
     *
     * It matters that there is one place. The force arrow used to
     * apply its own width, taken straight from the style, while every
     * other feature went through here. So a Point Force at the sheet's
     * default 0.5 drew at 0.5 pixels while a Line at the identical
     * 0.5 drew at 1.2 - the force looked THINNER than ordinary
     * geometry, which is precisely what a force must never do, and
     * the two could not be compared because neither was wrong.
     *
     * The floor keeps a hairline visible at extreme zoom-out, and is
     * the same for every feature so it cannot reintroduce a
     * difference between them.
     */
    const STROKE_SCALE = 2.4;
    const STROKE_MIN = 0.5;

    /*
     * The on-screen stroke width for a configured line weight.
     *
     * Read by the styled line, by applyStyle, and by the force arrow,
     * so a force shaft and a Line of the same weight are the same
     * number of pixels - which is what "the force is as thick as the
     * line" has to mean if it is to be true on screen and not only
     * in the settings.
     */
    function scaledStrokeWidth(lineWidth) {
        const width = Number.isFinite(lineWidth)
            ? lineWidth
            : 0.5;

        return Math.max(STROKE_MIN, width * STROKE_SCALE);
    }

    function applyStyle(
        element,
        style = {}
    ) {
        const lineWidth =
            Number.isFinite(
                style.lineWidth
            )
                ? style.lineWidth
                : 0.5;

        /*
         * THE AUTHORED COLOUR IS RESOLVED FOR THE ACTIVE THEME, not rewritten.
         *
         * `style.stroke` is the student's own colour and stays exactly as it is
         * in the document; `paintColour` maps it to what that colour means on the
         * sheet being painted. The fallback is the theme's DEFAULT LINE COLOUR
         * rather than a literal `#000000`, so a feature with no stroke of its own
         * follows the theme the way every other default does - the literal here
         * was a second source of truth for "default ink", and it was the light
         * theme's.
         */
        element.setAttribute(
            "stroke",
            paintColour(
                style.stroke ||
                    enggTheme.defaultLineColour()
            )
        );

        element.setAttribute(
            "fill",
            paintColour(
                style.fill ||
                    "none"
            )
        );

        element.setAttribute(
            "stroke-width",
            scaledStrokeWidth(lineWidth)
        );

        if (
            style.opacity != null
        ) {
            element.setAttribute(
                "opacity",
                style.opacity
            );
        }

        if (style.lineType === "dotted") {
            element.setAttribute("stroke-dasharray", "1 4");
            element.setAttribute("stroke-linecap", "round");
        }

        if (
            style.lineType ===
            "dashed"
        ) {
            element.setAttribute(
                "stroke-dasharray",
                "8 5"
            );
        }

        if (
            style.lineType ===
            "center"
        ) {
            element.setAttribute(
                "stroke-dasharray",
                "12 4 2 4"
            );
        }

        if (
            style.lineType ===
            "construction"
        ) {
            element.setAttribute(
                "stroke-dasharray",
                "4 4"
            );

            element.setAttribute(
                "opacity",
                "0.65"
            );
        }
    }

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
     * line without ever turning upside down. A small white plate sits
     * behind the text so it stays readable where it crosses the
     * dimension line - the standard drafting treatment for a dimension
     * that interrupts its own line.
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
        const fontSize = 11;
        const lineHeight = fontSize * 1.15;

        const group = createSvgElement("g", {
            transform: `translate(${origin.x} ${origin.y}) rotate(${frame.angle || 0})`
        });

        const plateWidth =
            Math.max(...lines.map(line => line.length)) * fontSize * 0.58 +
            6;

        /*
         * THE TEXT PLATE IS PAPER, NOT INK.
         *
         * It is the pale backing that keeps a label legible where it crosses the
         * geometry, so it must match the SHEET it sits on - not invert with the
         * drawing. Resolved through `paintColour` with an explicit white authored
         * value, it becomes white on the light canvas and the dark canvas's own
         * background on a dark one, so the label reads in both without the plate
         * ever becoming a dark block on white paper.
         */
        group.appendChild(
            createSvgElement("rect", {
                x: -plateWidth / 2,
                y: (-lines.length * lineHeight) / 2,
                width: plateWidth,
                height: lines.length * lineHeight,
                fill: paintColour(enggCanvasPalette.CANVAS_BACKGROUND.light),
                stroke: "none",
                "fill-opacity": 0.9
            })
        );

        lines.forEach((line, index) => {
            const span = createSvgElement("text", {
                x: 0,
                y: (index - (lines.length - 1) / 2) * lineHeight + fontSize * 0.35,
                fill: stroke,
                "font-size": zoomedFontHere(fontSize),
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
         * A DRIVEN DIMENSION IS DRAWN IN THE DRIVEN COLOUR.
         *
         * The requirement asks for a distinct colour as the visual indicator of
         * the Driving/Driven state, and NOT parentheses. The colour is read from
         * the model so the canvas, the preview and the panel agree, and it falls
         * back to the normal dimension colour for a Driving dimension - which is
         * what every dimension created before this state existed is.
         */
        const stroke = paintColour(
            entity.driven === true && model.DRIVEN_COLOUR
                ? model.DRIVEN_COLOUR
                : style.stroke || enggTheme.defaultLineColour()
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

    /*
     * A VARIABLE DIMENSION IS DRAWN LIKE A DIMENSION, WITH A SYMBOL.
     *
     * The witness lines, the arrowheads and the text frame all come from the
     * SAME model call a measured dimension uses, against a descriptor the
     * dimension model accepts - so `x` sits in exactly the place a `500 mm`
     * would, in the same style, and the two cannot drift apart in appearance.
     *
     * The one difference is the value: the text frame is filled with the
     * SYMBOL rather than a measurement. Building the frame from the symbol's own
     * length also keeps the box the right size for what it contains - a box
     * sized for "500 mm" around an "x" would look like a value had failed to
     * load.
     */
    function appendVariableDimensionEntity(svg, entity, state, toScreen, style) {
        const model = enggDimensionModel;

        if (!model) {
            return;
        }

        const symbol = enggVariableDimension.variableText(entity);

        if (!symbol.trim()) {
            return;
        }

        /*
         * The geometry, from the shared model. A variable has no measurement
         * type, so it is described as a plain linear span - which is what the
         * placement, the witness lines and the arrows are computed from, and
         * has nothing to do with what the text says.
         */
        const graphics = model.graphicsFor(
            {
                ...entity,
                dimensionType: entity.dimensionType || "linear"
            },
            state
        );

        if (!graphics) {
            return;
        }

        const stroke = paintColour(style.stroke || enggTheme.defaultLineColour());
        const lineWidth = Number(style.lineWidth) || 0.5;

        graphics.lines?.forEach((segment) => {
            const a = toScreen(segment.from);
            const b = toScreen(segment.to);

            svg.appendChild(
                createSvgElement("line", {
                    x1: a.x,
                    y1: a.y,
                    x2: b.x,
                    y2: b.y,
                    stroke,
                    "stroke-width": Math.max(0.6, lineWidth * 1.4)
                })
            );
        });

        /*
         * The text is the SYMBOL, in a frame measured from the symbol itself.
         * `textFrame` is recomputed here rather than reused, because the model
         * sized it for a number this feature does not have.
         */
        const anchor = graphics.text?.position || graphics.textFrame?.centre;

        if (!anchor) {
            return;
        }

        const screen = toScreen(anchor);

        const fontSize = Number(entity.style?.fontSize) || 12;

        const width = Math.max(18, symbol.length * fontSize * 0.72);
        const height = fontSize * 1.5;

        svg.appendChild(
            createSvgElement("rect", {
                x: screen.x - width / 2,
                y: screen.y - height / 2,
                width,
                height,
                fill: "#ffffff",
                stroke: "none"
            })
        );

        const label = createSvgElement("text", {
            x: screen.x,
            y: screen.y + fontSize * 0.36,
            fill: stroke,
            "font-size": zoomedFontHere(fontSize),
            "font-family": "Arial, sans-serif",
            "font-weight": "600",
            "text-anchor": "middle"
        });

        label.textContent = symbol;

        svg.appendChild(label);
    }

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
        const textAt = anchor || end;

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

        if (textAt && text) {
            const lines = String(text).split("\n");

            /*
             * A CALLOUT AND A TOLERANCE WEAR A BOX.
             *
             * The box is what says "this is a statement about the part",
             * as against a bare note, and it is sized to the text it holds
             * so the two cannot come apart.
             */
            if (kind === "callout" || kind === "tolerance") {
                const width = widestLineWidth(lines, fontSize) + 8;
                const height = lines.length * lineHeight + 4;

                svg.appendChild(
                    createSvgElement("rect", {
                        x: textAt.x - width / 2,
                        y: textAt.y - height / 2,
                        width,
                        height,
                        fill: "#ffffff",
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
            } else {
                appendAnnotateText(
                    svg,
                    lines,
                    textAt,
                    textStroke,
                    fontSize,
                    lineHeight,
                    entity.style?.align
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
        align
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
            "font-family": "Arial, sans-serif",
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
     * ========================================================
     * A SKETCH DIAGRAM'S STROKES, IN WORLD COORDINATES
     * ========================================================
     *
     * THE ONE PLACE a hand-drawn diagram is turned into world-space marks,
     * used by the renderer that DRAWS it and by anything that has to test
     * against it - box selection, fit bounds, hit testing. That is the whole
     * point of extracting it: a selection rectangle and the ink it is drawn
     * over must be the same geometry, and two implementations of "where is
     * this stroke" are two chances for them to disagree.
     *
     * WHAT IS WRONG WITHOUT IT. A sketch element stores GRAPH-LOCAL points:
     * x is a station on the member, y is the value in kN or kN·m. The sheet
     * draws them at `along(x, value)`, which maps the x onto the member's own
     * length and the value onto the frame's scale. Testing selection against
     * the RAW stored points tests numbers that are not on the sheet at all, so
     * a box drawn over the ink finds nothing.
     *
     * The return shape mirrors `analysisPlotMarks`, so a caller can treat a
     * sketched and a plotted diagram the same way:
     *
     *   { kind: "curve", id, points: [worldPoint, …] }
     */
    function analysisSketchMarks(geometry) {
        const elements = Array.isArray(geometry?.sketchElements)
            ? geometry.sketchElements
            : [];

        if (!elements.length) {
            return [];
        }

        const localRange = geometry.localRange;
        const start = geometry.start;
        const end = geometry.end;

        if (!localRange || !start || !end) {
            return [];
        }

        const rangeWidth = localRange.to - localRange.from;

        if (!(rangeWidth > 0)) {
            return [];
        }

        /*
         * The peak is taken from the sketch's own points, because a sketch
         * has no equations to read one from. This is the same value the
         * drawing path uses, so the marks and the ink cannot be on different
         * scales.
         */
        let peak = 0;

        elements.forEach(element => {
            sketchPointsOf(element).forEach(point => {
                if (Number.isFinite(point.y)) {
                    peak = Math.max(peak, Math.abs(point.y));
                }
            });
        });

        const { unitHeight: scale } = analysisValueScale(
            geometry,
            rangeWidth,
            peak
        );

        /*
         * `scale`, not `unitHeight`: the two differ exactly when the student
         * has set a y-range, and using the wrong one would put the strokes on
         * one scale and the axis on another.
         */
        const along = (x, value) => ({
            x:
                start.x +
                (end.x - start.x) *
                    ((x - localRange.from) / rangeWidth),

            y: start.y + value * scale,
        });

        return elements
            .map(element => {
                const points = sketchPointsOf(element);

                if (points.length < 2) {
                    return null;
                }

                return {
                    kind: element.kind === "line" ? "line" : "curve",
                    id: element.id,
                    points: points.map(point =>
                        along(point.x, point.y)
                    ),
                };
            })
            .filter(Boolean);
    }

    /*
     * DRAW THE STUDENT'S SKETCH
     * ========================================================
     *
     * The hand-drawn half of an analysis diagram, and the twin of
     * appendAnalysisPlot above.
     *
     * THE SAME PROJECTION, because the two must agree exactly. A student
     * who sketches an SFD and then plots the same diagram should get the
     * same shape in the same place - so both read x as a fraction of the
     * member's own length and both use the same fixed units-per-frame-height.
     * A sketch and a plot that sat on different scales would make the two
     * modes look like two different quantities.
     *
     * THE MARKS COME FROM `analysisSketchMarks`, so what is drawn here is
     * exactly what a selection rectangle is tested against - one projection,
     * used twice rather than written twice.
     */
    function appendAnalysisSketch(
        svg,
        geometry,
        toScreen,
        tint
    ) {
        const elements = Array.isArray(geometry.sketchElements)
            ? geometry.sketchElements
            : [];

        if (!elements.length) {
            return;
        }

        const localRange = geometry.localRange;
        const start = geometry.start;
        const end = geometry.end;

        if (!localRange || !start || !end) {
            return;
        }

        const rangeWidth = localRange.to - localRange.from;

        if (!(rangeWidth > 0)) {
            return;
        }

        const strokeOptions = {
            fill: "none",
            stroke: tint,
            "stroke-width": 1.8,
            "stroke-linejoin": "round",
            "stroke-linecap": "round",
        };

        /*
         * DRAWN FROM THE SHARED MARKS. The projection that places this ink is
         * `analysisSketchMarks`, which box selection also tests against - so a
         * rectangle drawn over a stroke provably covers the stroke, rather
         * than covering a second, separate calculation of where it is.
         */
        analysisSketchMarks(geometry).forEach(mark => {
            const screen = mark.points.map(toScreen);

            if (screen.length < 2) {
                return;
            }

            if (mark.kind === "line") {
                svg.appendChild(
                    createSvgElement("line", {
                        x1: screen[0].x,
                        y1: screen[0].y,
                        x2: screen[1].x,
                        y2: screen[1].y,
                        ...strokeOptions,
                    })
                );

                return;
            }

            /*
             * THE SAME QUADRATIC THE EDITOR DRAWS. If the sheet smoothed it
             * differently from the dialog, the student would place a curve
             * and get a different curve - so the rule is stated once here and
             * once there rather than approximated twice.
             */
            const d = [`M ${screen[0].x} ${screen[0].y}`];

            for (let i = 1; i < screen.length - 1; i++) {
                const mid = {
                    x: (screen[i].x + screen[i + 1].x) / 2,
                    y: (screen[i].y + screen[i + 1].y) / 2,
                };

                d.push(
                    `Q ${screen[i].x} ${screen[i].y} ${mid.x} ${mid.y}`
                );
            }

            const last = screen[screen.length - 1];

            d.push(`L ${last.x} ${last.y}`);

            svg.appendChild(
                createSvgElement("path", {
                    d: d.join(" "),
                    ...strokeOptions,
                })
            );
        });
    }

    /*
     * The points an element is drawn through. A LINE has two, a THREE-POINT
     * CURVE has its Start, Bend and End, and a legacy curve has as many as were
     * clicked.
     *
     * `curve3` WAS MISSING, and its absence was not cosmetic: this function is
     * what both the RENDERER and the box-selection test read, so a three-point
     * curve returned no points at all - it was never drawn on the sheet, and it
     * could never be selected. The one curve tool the editor actually creates
     * was the one curve the sheet could not draw.
     */
    function sketchPointsOf(element) {
        if (!element) {
            return [];
        }

        if (element.kind === "line") {
            return [element.start, element.end];
        }

        if (element.kind === "curve3") {
            return [element.start, element.bend, element.end].filter(
                point => point && Number.isFinite(point.x)
            );
        }

        return Array.isArray(element.points) ? element.points : [];
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
            entity.type === "pin-support" ||
            entity.type === "roller-support" ||
            entity.type === "fixed-support" ||
            entity.type === "smooth-support" ||
            entity.type === "pin-connection" ||
            entity.type === "fixed-connection" ||
            entity.type === "slider-connection"
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
                entity.type === "pin-support" ||
                entity.type === "roller-support" ||
                entity.type === "fixed-support" ||
                entity.type === "smooth-support"
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
                entity.type === "pin-connection" ||
                entity.type === "fixed-connection" ||
                entity.type === "slider-connection"
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

        let processOverlay = null;
        if (entity.metadata?.thermodynamicsKind === "process-path") {
            processOverlay = createSvgElement("g");
            const points = (geometry.points || []).map(toScreen);
            const colour = paintColour(style.stroke || "#dc2626");
            points.forEach((point, index) => {
                if (index >= (entity.metadata.stateCount ?? points.length)) return;
                const labelPoint = toScreen(processLabelPoint(geometry, index, scale));
                processOverlay.appendChild(createSvgElement("circle", { cx: point.x, cy: point.y, r: 3, fill: colour }));
                processOverlay.appendChild(createSvgElement("circle", {
                    cx: labelPoint.x, cy: labelPoint.y, r: 9, fill: "white", stroke: "none", cursor: "move"
                }));
                const label = createSvgElement("text", {
                    x: labelPoint.x, y: labelPoint.y, fill: colour, "font-size": 12, "font-family": "sans-serif", cursor: "move",
                    "text-anchor": "middle", "dominant-baseline": "central"
                });
                label.textContent = String(index + 1);
                processOverlay.appendChild(label);
                if (!index) return;
                const previous = points[index - 1];
                const length = Math.hypot(point.x - previous.x, point.y - previous.y);
                if (length < 12) return;
                const ux = (point.x - previous.x) / length;
                const uy = (point.y - previous.y) / length;
                const mx = (point.x + previous.x) / 2;
                const my = (point.y + previous.y) / 2;
                processOverlay.appendChild(createSvgElement("polygon", {
                    points: `${mx + ux * 4},${my + uy * 4} ${mx - ux * 4 - uy * 3},${my - uy * 4 + ux * 3} ${mx - ux * 4 + uy * 3},${my - uy * 4 - ux * 3}`,
                    fill: colour, stroke: "none"
                }));
            });
        }

        if (isSaturationCurve(entity)) {
            for (const [index, points] of saturationPaths(geometry).entries()) {
                const screen = points.map(toScreen);
                const path = createSvgElement("path", {
                    d: screen.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ")
                });
                applyStyle(path, { ...style, fill: "none" });
                if (index === 1 || index === 2) {
                    path.setAttribute("fill", paintColour(style.stroke || enggTheme.defaultLineColour()));
                    path.setAttribute("stroke", "none");
                }
                svg.appendChild(path);
            }
            for (const [key, x, y] of [["yLabel", 0.04, 0.94], ["xLabel", 0.98, 0.02]]) {
                const label = geometry[key] || "insert axis label";
                const point = toScreen(cylinderPoint(geometry, x, y));
                const text = createSvgElement("text", {
                    x: point.x, y: point.y, fill: paintColour(style.stroke || enggTheme.defaultLineColour()),
                    "font-size": 12, "text-anchor": "end", "font-family": "sans-serif",
                    "data-saturation-axis": key, "data-axis-feature-id": entity.id,
                    cursor: "text"
                });
                text.textContent = label;
                svg.appendChild(text);
            }
        }

        if (isPistonCylinder(entity)) {
            const level = pistonFraction(geometry);
            const thickness = Math.min(0.04, level / 2);
            const paths = [
                [[0, 1], [0, 0], [1, 0], [1, 1]],
                [[0, level], [1, level], [1, level - thickness], [0, level - thickness], [0, level]],
                [[0.5, level], [0.5, 1]],
                ...stopperPaths(geometry)
            ];
            for (const points of paths) {
                const screenPoints = points.map(([x, y]) => toScreen(cylinderPoint(geometry, x, y)));
                const path = createSvgElement("path", {
                    d: screenPoints.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ")
                });
                applyStyle(path, { ...style, fill: "none" });
                svg.appendChild(path);
            }
        }

        /*
         * RECTANGLE
         *
         * A rigid body stores the same shape, so it renders
         * through the same branch and stays one coherent
         * feature rather than four separate lines.
         */
        if (
            (entity.type ===
                "rectangle" && !isPistonCylinder(entity) && !isSaturationCurve(entity)) ||
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
        if (processOverlay) svg.appendChild(processOverlay);
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

    /*
     * ========================================================
     * A DIRECTION, IN SCREEN SPACE
     * ========================================================
     *
     * TWO WAYS TO KNOW WHICH WAY A VECTOR POINTS, BOTH HANDLED HERE.
     *
     * A force is stored either as two endpoints with the head on one of
     * them, or as a magnitude and an angle. Both are ordinary, and both
     * reach the same shared arrow - so the difference is settled in one
     * place rather than at each call site, where getting it wrong draws a
     * force pointing the wrong way with no error to notice.
     *
     * FROM TWO POINTS: measure the difference. There is no sign to get
     * wrong here, which is the reason this is the preferred form wherever
     * it is available.
     *
     * FROM AN ANGLE: the angle is an ENGINEERING one - measured from the
     * positive x axis, anticlockwise, in a world whose y grows upward. It
     * is turned into a WORLD point one unit away from the world
     * application point and then PROJECTED, rather than being converted by
     * hand.
     *
     * THE WORLD POINT HAS TO BE A WORLD POINT.
     *
     * Adding a world-space offset to an already-projected point mixes the
     * two frames: the offset gets scaled and inverted a second time, which
     * turned a force pointing straight up into one pointing up-and-to-the-
     * right by whatever amount the projection happened to add. The offset
     * is therefore measured from the world application point, and only the
     * result is projected - so the inversion happens exactly once, inside
     * the one function that owns it.
     */
    function forceDirectionOnScreen(
        head,
        tail
    ) {
        const dx = head.x - tail.x;
        const dy = head.y - tail.y;

        const length = Math.hypot(dx, dy);

        if (!(length > 0)) {
            /*
             * A zero-length vector has no direction. Rather than invent
             * one, this returns "no direction" and the arrow is not drawn:
             * a force of magnitude zero is nothing to see, and a default
             * arrow pointing right would be a claim about it.
             */
            return null;
        }

        return { x: dx / length, y: dy / length };
    }

    /* eslint-disable-next-line no-unused-vars -- available to callers of this
     * closure; the angle path routes through it. */
    function toScreenUnitDirection(
        toScreen,
        worldAnchor,
        geometry
    ) {
        const angle = Number(geometry.angle);

        if (!Number.isFinite(angle)) {
            return null;
        }

        const radians = angle * Math.PI / 180;

        /*
         * ONE UNIT OF THE WORLD VECTOR, projected by the same transform as
         * every other point. The direction that comes back is in screen
         * units per world unit of the vector, which is the only sense in
         * which a direction exists on the sheet.
         */
        return forceDirectionOnScreen(
            toScreen({
                x: worldAnchor.x + Math.cos(radians),
                y: worldAnchor.y + Math.sin(radians)
            }),
            toScreen(worldAnchor)
        );
    }

    /*
     * ========================================================
     * ONE VECTOR ARROW, IN SCREEN SPACE
     * ========================================================
     *
     * The single place a Statics vector becomes ink. A Point Force, a
     * Resultant, each of a Force Components' three vectors, and a
     * Distributed Load's arrows all come through here, so an arrowhead is
     * computed one way for all of them.
     *
     * WHY IT TAKES TWO POINTS AND NOT AN ANGLE
     * ----------------------------------------
     * The previous version of this took an `angleDegrees` and a
     * `length`, and reconstructed the tip as
     *
     *     y: anchor.y - Math.sin(radians) * length
     *
     * That leading minus is the bug. `anchor` is already a SCREEN point,
     * and screen y grows DOWNWARD, so subtracting the vertical component
     * sent every force drawn through this path to the wrong side of its
     * application point: a force pointing up was drawn pointing down.
     *
     * The caller at the time made it look right by handing in a negated
     * angle (`Math.atan2(-dy, dx)`), so the two sign errors cancelled and
     * the picture happened to be correct - which is exactly why it survived.
     * Two wrongs in one place is not a working arrangement: it cannot be
     * changed, reused for a new vector type, or reasoned about without
     * working out which of the two signs is wrong for a given quadrant.
     *
     * The fix is not to correct the sign but to remove the need for one.
     * A caller that already HAS both ends - which is every vector in this
     * module, since engineering geometry is stored as a tail and a head -
     * hands both over, and the arrowhead direction is measured from them:
     *
     *     angle = atan2(headScreen.y - tailScreen.y,
     *                   headScreen.x - tailScreen.x)
     *
     * ONE conversion, in ONE place: world to screen, at the boundary,
     * through `toScreen`. The engineering vector keeps its own signs, and
     * nothing downstream has to know that the sheet is drawn upside down
     * relative to the axes.
     *
     * The two points are the whole truth about a vector, so a magnitude of
     * zero is now visible as two coincident points rather than having to
     * be inferred from an angle of 0 and a length of 0.
     */
    function appendVectorArrow(
        svg,
        tail,
        head,
        stroke,
        style,
        kind = "solid"
    ) {
        const dx = head.x - tail.x;
        const dy = head.y - tail.y;

        const length = Math.hypot(dx, dy);

        if (length < 0.01) {
            return;
        }

        const construction = kind === "construction";

        svg.appendChild(
            createSvgElement("line", {
                x1: tail.x,
                y1: tail.y,
                x2: head.x,
                y2: head.y,
                stroke,
                "stroke-width":
                    scaledStrokeWidth(
                        Number(style.lineWidth) || 0.5
                    ),
                "stroke-linecap": "round",
                ...(construction
                    ? {
                        "stroke-dasharray": "4 3"
                    }
                    : {})
            })
        );

        if (construction) {
            return;
        }

        /*
         * The head is sized from the line weight like every other
         * arrowhead on the sheet, so a thicker analysis line gets a
         * thicker head rather than the same small triangle that reads
         * as a mistake.
         */
        appendArrowHead(
            svg,
            head,
            Math.atan2(dy, dx),
            stroke,
            arrowHeadSize(
                Number(style.lineWidth) || 0.5
            )
        );
    }

    /*
     * The Analysis tool icons' geometry lives in the same file as the
     * drawing, so an icon and the thing it draws cannot drift apart.
     */
    /*
     * ========================================================
     * A POINT FORCE, AS A VECTOR
     * ========================================================
     *
     * A FORCE IS A VECTOR, so it is drawn by the shared arrow rather than
     * by a routine of its own. This only decides where the two ends are.
     *
     * A force is stored as a fixed pair of endpoints with the arrowhead
     * on one of them, so both ends are known in engineering coordinates and
     * both go through the same projection. There is no angle to recover and
     * no length to rebuild, which is what removes the sign error this used
     * to carry: see appendVectorArrow above.
     */
    function appendForceArrow(
        svg,
        anchor,
        direction,
        length,
        stroke,
        style
    ) {
        /*
         * No direction means nothing to draw, which is what a zero-length
         * vector means and is the only honest reading of it.
         */
        if (!direction) {
            return;
        }

        appendVectorArrow(
            svg,
            anchor,
            {
                x: anchor.x + direction.x * length,
                y: anchor.y + direction.y * length
            },
            stroke,
            style
        );
    }

    /*
     * HOW WIDE AN ARROWHEAD OPENS.
     *
     * The half-angle at the tip, in radians. 0.4 is about 23 degrees each
     * side, which is a long thin head that stays legible on a 0.5 mm shaft
     * without swallowing it.
     *
     * NAMED rather than written as a literal at the two places that need
     * it, because the previous code had 0.4 twice - once per base corner -
     * and two copies of a shape parameter is two chances for them to
     * disagree about how big a head is.
     */
    const ARROW_HEAD_SPREAD = 0.4;

    /*
     * THE TWO BASE CORNERS OF AN ARROWHEAD, one either side of the shaft.
     *
     * Returned rather than appended so that every head on the sheet - the
     * shared vector arrow, the distributed loads' arrows - is built from
     * the same two points. There were three head builders before this, each
     * with its own copy of the shape, and one of them had a sign wrong in a
     * way that was invisible on the axes and wrong on the diagonals. A
     * shape that has been got wrong once should not be reachable twice.
     *
     * BUILT FROM THE AXIS, not by rotating a polar angle. Going backwards
     * from the tip by `theta +/- spread` only produces a symmetric head if
     * both the cosine and the sine are negated; rotating one way and adding
     * the other walks both corners off to the same side.
     */
    function arrowHeadCorners(
        tip,
        radians,
        head
    ) {
        /* The unit axis, pointing the way the arrow points. On screen, so
         * y grows downward and no further inversion belongs here. */
        const axis = {
            x: Math.cos(radians),
            y: Math.sin(radians)
        };

        /* ACROSS the axis, at right angles. */
        const across = {
            x: -axis.y,
            y: axis.x
        };

        const back =
            head * Math.cos(ARROW_HEAD_SPREAD);

        const halfWidth =
            head * Math.sin(ARROW_HEAD_SPREAD);

        return [
            {
                x:
                    tip.x -
                    axis.x * back +
                    across.x * halfWidth,
                y:
                    tip.y -
                    axis.y * back +
                    across.y * halfWidth
            },
            {
                x:
                    tip.x -
                    axis.x * back -
                    across.x * halfWidth,
                y:
                    tip.y -
                    axis.y * back -
                    across.y * halfWidth
            }
        ];
    }

    /*
     * ========================================================
     * A FILLED ARROW HEAD POINTING ALONG A SCREEN ANGLE
     * ========================================================
     *
     * Three points: the tip, and the two base corners `headSize` back from
     * it, one either side of the shaft's axis.
     *
     * ========================================================
     * THE BASE CORNERS WERE ON THE WRONG SIDE OF THE AXIS
     * ========================================================
     *
     * They were placed at
     *
     *     tip.x - head * cos(radians -/+ 0.4)
     *     tip.y + head * sin(radians -/+ 0.4)
     *
     * Note the signs. The x term subtracts and the y term ADDS. For a
     * triangle that is symmetric about the axis, the y term has to
     * subtract too: rotating backwards from the tip by `theta - 0.4` and by
     * `theta + 0.4` walks the axis in opposite directions, and only the
     * cos/sin pair with the SAME sign on both components puts the corners
     * on opposite sides.
     *
     * WITH `+ sin` THE TWO CORNERS LAND ON THE SAME SIDE, and how badly it
     * goes wrong depends on the direction:
     *
     *     angle 0    (horizontal)   looks correct - cos and sin are
     *                               symmetric about 0, so the flip is
     *                               invisible
     *     angle 90   (vertical)     looks correct - sin is symmetric about
     *                               pi/2
     *     angle 45, 135, -45       WRONG - both corners on one side, and
     *                               the head reads as a fin rather than
     *                               an arrow
     *
     * So the bug was invisible on exactly the two axes and broken on the
     * diagonals - which is why it survived being written down as correct,
     * and why every test that used a horizontal or vertical force passed.
     * A test that checks where the TIP is cannot see it at all: the tip
     * was always right.
     */
    function appendArrowHead(
        svg,
        tip,
        radians,
        stroke,
        head
    ) {
        const [left, right] =
            arrowHeadCorners(
                tip,
                radians,
                head
            );

        svg.appendChild(
            createSvgElement("polygon", {
                points: [
                    `${tip.x},${tip.y}`,
                    `${left.x},${left.y}`,
                    `${right.x},${right.y}`
                ].join(" "),
                fill: stroke,
                stroke: "none"
            })
        );
    }

    /*
     * The two ends of one drawn force, as distinct geometry.
     *
     * A force is a LINE with a fixed pair of endpoints, and which
     * end carries the arrowhead is a SEPARATE fact about it. Keeping
     * the two apart is what makes reversing a direction impossible to
     * do by accident:
     *
     *   application - the point on the body where the force acts.
     *                 It is the physical meaning of the load and
     *                 must never move.
     *   far        - the other end of the drawn line. It is a fixed
     *                 piece of geometry, and it must not move either.
     *
     * ========================================================
     * THE LINE IS THE LOAD; THE HEAD IS WHICH WAY IT PUSHES
     * ========================================================
     *
     * The shaft is drawn ALONG THE FORCE DIRECTION itself, so an arrow
     * points the way the load acts - up, down, left, right or any diagonal -
     * and a load at 45 degrees on a level beam genuinely appears at 45
     * degrees rather than being snapped onto the body's normal.
     *
     * `bodyNormal` is still handed in, and still decides which SIDE of the
     * body the arrow is drawn FROM when the direction is square to the span
     * (the ordinary case, where the two agree). The direction is what places
     * the far end; the normal only tells the renderer which of the direction
     * and its opposite is the side the load acts from, so a "down" load hangs
     * below a level beam rather than lying along it.
     */
    function forceEndpoints(
        application,
        direction,
        length,
        bodyNormal
    ) {
        /*
         * THE DIRECTION IS THE LINE. Its screen projection is the only thing
         * that decides where the far end sits, so two loads that differ only
         * in direction draw two different lines - which is the whole point of
         * a direction being a real vector.
         */
        const screenDirection = {
            x: direction.x,
            y: -direction.y
        };

        /*
         * A DEGENERATE DIRECTION - one that could not be read from the
         * pointer - falls back to the span's own normal, so a load that lost
         * its direction still draws the field of arrows it always drew rather
         * than collapsing to a point.
         */
        const usable =
            Math.abs(screenDirection.x) > 1e-9 ||
            Math.abs(screenDirection.y) > 1e-9;

        const screenAway =
            usable
                ? screenDirection
                : bodyNormal
                    ? { x: bodyNormal.x, y: -bodyNormal.y }
                    : { x: 0, y: 1 };

        return {
            application,
            far: {
                x:
                    application.x +
                    screenAway.x * length,
                y:
                    application.y +
                    screenAway.y * length
            }
        };
    }

    /*
     * Where the arrowhead goes on a force line.
     *
     * Reversal flips WHICH endpoint is the head. It does not change
     * the line, so this is a choice between two points that both
     * already exist.
     */
    function arrowheadTip(
        endpoints,
        direction,
        reversed
    ) {
        return reversed
            ? endpoints.application
            : endpoints.far;
    }

    /*
     * The direction the head POINTS, for its own geometry.
     *
     * The head sits on ONE endpoint and points along the line,
     * outward, AWAY from the other endpoint. That is what makes it
     * an arrowhead rather than a fin: the apex is the extreme point
     * of the triangle and the base sits back along the shaft, so the
     * head is attached to the line and its tip is on the endpoint.
     *
     * The head is built from this vector as
     * `tip - head * direction` for the two base corners, so the sign
     * matters: a vector pointing back INTO the line puts the base
     * beyond the endpoint and the tip at the far end of the base,
     * which draws the arrowhead outside the force and pointing the
     * wrong way. Both branches below therefore point outward, away
     * from whichever endpoint is NOT carrying the head:
     *
     *   normal    head on the far end,     points far - application
     *   reversed  head on the application, points application - far
     */
    function arrowheadDirection(
        endpoints,
        reversed
    ) {
        return reversed
            ? {
                  x:
                      endpoints.application.x -
                      endpoints.far.x,
                  y:
                      endpoints.application.y -
                      endpoints.far.y
              }
            : {
                  x:
                      endpoints.far.x -
                      endpoints.application.x,
                  y:
                      endpoints.far.y -
                      endpoints.application.y
              };
    }

    /*
     * The screen length of one arrow of a distributed load.
     *
     * A load's arrows are drawn at the MAGNITUDE itself, in world
     * units converted to screen space by the caller. That is what
     * makes a heavier load look heavier: pulling the cursor
     * further from the body stores a larger magnitude, and the
     * arrow grows with it. There is no ceiling, because a capped
     * arrow stops telling the truth: the drawing would go on
     * saying "this is the biggest force here" for magnitudes
     * that differ several times over, and the student would be
     * shown a load that is not the one they built.
     *
     * The one thing that IS scaled is the head, which follows the
     * shaft rather than sitting at a fixed size, so a long arrow
     * does not end in a head too small to read.
     */
    /*
     * The shared Statics Vector Scale, read once per render.
     *
     * Read from the drawing rather than passed down through every
     * drawing routine, so there is exactly one place that decides how
     * large Statics arrows are and no drawing path can quietly use a
     * different one. A missing or unrecognised value falls back to 1,
     * which is how arrows were drawn before the setting existed.
     */
    function vectorScaleOf(state) {
        /*
         * The load drawing paths already guard their use of the profile,
         * so this guards it too. Falling back to 1 keeps arrows at their
         * true length rather than failing to draw.
         */
        if (typeof enggLoadProfile === "undefined") {
            return 1;
        }

        return enggLoadProfile.vectorScaleFor(state);
    }

    const DISTRIBUTED_LOAD_ARROW_MIN_PX = 2;

    /*
     * A distributed load's arrow length, from its intensity.
     *
     * `scale` is the canvas zoom. It is multiplied by the shared
     * Statics Vector Scale as well, so the arrows on screen are the true
     * intensities drawn at whatever size the user has asked for.
     *
     * The Vector Scale multiplies EVERY arrow by the SAME factor. It is
     * never applied per arrow, which is what keeps a varying load's
     * profile honest: a load rising from 2 to 8 stays in that 1:4
     * relationship at any scale. Normalising each arrow to fit would
     * flatten the profile and hide the very thing the diagram exists to
     * show, so one factor is applied to the whole representation and the
     * shape of it is untouched.
     *
     * The minimum is a legibility floor so a small load still has an
     * arrow that ends in a head big enough to read. It is applied AFTER
     * the scaling, so it cannot flatten the profile either - a tiny
     * arrow is clamped to readable size rather than stretched.
     */
    function distributedLoadArrowLength(
        magnitude,
        scale,
        vectorScale = 1
    ) {
        const world = Math.abs(
            Number(magnitude) || 0
        );

        if (world <= 0) {
            return 0;
        }

        return Math.max(
            DISTRIBUTED_LOAD_ARROW_MIN_PX,
            world *
                Math.max(scale, 1e-6) *
                Math.max(vectorScale, 1e-6)
        );
    }

    /*
     * A force line's weight as it is actually drawn on screen.
     *
     * The Features panel's Line Width is the weight of the feature
     * in world units, but a force's shaft is drawn at the screen
     * scale, so the width is converted the same way the arrow
     * length is. Reading it back as a raw number is what made a
     * thicker load look identical to a thin one: the stored value
     * differs, but the drawn stroke did not.
     */
    function forceStrokeWidth(
        style,
        scale
    ) {
        const width =
            Number(style?.lineWidth);

        if (!Number.isFinite(width) || width <= 0) {
            return 1.3;
        }

        return Math.max(
            0.8,
            width * Math.max(scale, 1e-6)
        );
    }

    /*
     * The head of a distributed load's arrow, scaled to its own
     * shaft so a short arrow and a long one both end in a head
     * that reads as part of the same line, and scaled to the shaft's
     * WEIGHT as well so a heavy force line ends in a heavy head.
     *
     * Sizing the head from the arrow's length alone is not enough:
     * two loads of equal magnitude drawn at different line widths
     * are the same length, and without the width term they would
     * finish in identical heads, so a heavier line would end in a
     * head too small to read as belonging to it.
     */
    function distributedLoadHeadSize(
        length,
        strokeWidth
    ) {
        const width = Math.max(0, Number(strokeWidth) || 0);

        /*
         * The head is a multiple of the SHAFT WIDTH, because the
         * shaft width is what the user actually sets with Line
         * Width, and that weight has to keep reading all the way
         * to the tip. A heavier force line has to end in a heavier
         * head, or the weight the user chose stops at the shaft.
         *
         * The arrow's length is a BOUND and nothing more. Letting
         * length raise the head is what produced the fixed-size
         * behaviour this replaces: a long arrow computed the same
         * oversized head whatever its shaft was doing, so width
         * stopped mattering the moment the arrow got long.
         *
         * The head may never exceed its own shaft, or it stops
         * reading as an arrow and becomes a separate mark.
         */
        return Math.max(
            3,
            Math.min(width * 5, length)
        );
    }

    /*
     * The filled head of a distributed load's arrow, as an SVG
     * points string.
     *
     * It is built from the screen-space direction the arrow was
     * drawn along, so the head is always square to its own shaft
     * no matter which way the load points.
     *
     * IT IS THE SAME HEAD AS EVERY OTHER ARROW, from the same corner
     * builder, with the load's own size. Only the size differs: a load's
     * head is sized from its shaft width and its arrow length, which are
     * things a load has and a plain vector does not.
     */
    function distributedLoadArrowHead(
        tip,
        screenDirection,
        length,
        strokeWidth
    ) {
        const radians =
            Math.atan2(
                screenDirection.y,
                screenDirection.x
            );

        const head =
            distributedLoadHeadSize(
                length,
                strokeWidth
            );

        const corners =
            arrowHeadCorners(
                tip,
                radians,
                head
            );

        return [
            `${tip.x},${tip.y}`,
            ...corners.map(
                corner => `${corner.x},${corner.y}`
            )
        ].join(" ");
    }

    /*
     * THE ROTATIONAL ARROW.
     *
     * One curved arrow, drawn for a Moment: a centre it turns about, a
     * radius, a sense of rotation, and a head ON the curve.
     *
     * The geometry itself - the sweep, the gap, the tangent and the
     * head - is asked of enggDrawingRotationalArrow rather than being
     * worked out here, so the drawing, the hit test and the Features
     * panel are all reading the same arc instead of three roughly
     * similar ones.
     *
     * The radius is a PRESENTATION value and nothing else. It is
     * taken from `arcRadius` when the student has set one and falls
     * back to the shared default otherwise, and it is never derived
     * from the magnitude: on a drawing a moment shows which way
     * something turns, and a moment that grew with its value would
     * be claiming an engineering meaning the symbol does not have.
     */
    function appendRotationalArrow(
        svg,
        center,
        clockwise,
        style = {},
        arcRadius
    ) {
        const rotational =
            enggDrawingRotationalArrow;

        if (!rotational) {
            return;
        }

        const stroke =
            paintColour(style.stroke || enggTheme.defaultLineColour());

        const arc =
            rotational.arcFor(
                center,
                clockwise,
                arcRadius
            );

        /*
         * The curve is drawn at the feature's OWN line weight, through
         * the same conversion every other line on the sheet uses. It
         * used to be a literal 1.6, which meant a moment on a 0.5 mm
         * sheet was drawn three times heavier than the beam it was
         * applied to, and changing the thickness in the panel did
         * nothing to it at all.
         */
        svg.appendChild(
            createSvgElement("path", {
                d: rotational.arcPath(arc),
                fill: "none",
                stroke,
                "stroke-width":
                    scaledStrokeWidth(
                        Number(style.lineWidth) || 0.5
                    ),
                "stroke-linecap": "round"
            })
        );

        /*
         * The head, sized from that same line weight so the two stay
         * in proportion, and placed at the arc's end along its
         * TANGENT - so it lies along the curve instead of pointing
         * inward at the centre, which is the difference between a
         * moment and a force arrow.
         */
        const lineWidth =
            Number(style.lineWidth) || 0.5;

        const head =
            rotational.headPoints(
                arc,
                arrowHeadSize(lineWidth) * 0.8
            );

        svg.appendChild(
            createSvgElement("polygon", {
                points: head
                    .map(
                        (point) =>
                            `${point.x},${point.y}`
                    )
                    .join(" "),
                fill: stroke,
                stroke: "none"
            })
        );

        /*
         * THE CENTRE DOT: THE POINT THE MOMENT IS APPLIED AT.
         *
         * A moment's centre is its APPLICATION POINT - the exact spot the
         * couple acts on - and the curved arrow alone does not say where that
         * is: a reader can see which way something turns without being able to
         * tell the joint it turns about. The dot marks it.
         *
         * IT SITS AT THE ARC'S OWN CENTRE, which is the moment's attachment
         * coordinate passed in by the caller (`toScreen(position)`). There is
         * no offset of any kind, so the moment's attachment point, the centre of
         * the symbol and the centre of the dot are the same point by
         * construction - and they stay together when the moment moves.
         *
         * IT IS DRAWN IN SCREEN SPACE, at a FIXED pixel radius, so it is a
         * constant small marker at every zoom: clearly visible when zoomed out,
         * and never swelling into a blob when zoomed in. That is why it is not
         * derived from the arc radius, which is a presentation size the student
         * may change - the attachment marker must not grow with the symbol.
         *
         * IT IS VISUALLY SUBORDINATE. A dot smaller than the arc's stroke
         * weight times a little would vanish; one as large as the arrowhead
         * would compete with it. The radius below is deliberately between the
         * two, in the panel's own dark stroke, so it reads as an engineering
         * reference mark rather than as a second arrowhead.
         *
         * IT IS NOT A FEATURE. It is drawn as part of the moment and is owned
         * by it - not selectable, not movable and not deletable on its own, so
         * it cannot be separated from the point it marks.
         */
        const centreDotRadius = 2.2;

        svg.appendChild(
            createSvgElement("circle", {
                cx: arc.center.x,
                cy: arc.center.y,
                r: centreDotRadius,
                fill: stroke,
                stroke: "none"
            })
        );
    }

    /*
     * THE SENSE OF ROTATION, AS THE ONE BOOLEAN THE GEOMETRY USES.
     *
     * A feature states its direction as the word "CCW" or "CW",
     * because that is what a student reads and what a saved file
     * should say. The geometry works in a boolean, and the conversion
     * belongs in one function so no two call sites can disagree about
     * which way round a moment turns.
     *
     * A file saved before directions were words stored a `clockwise`
     * flag, and it is still read here. Without that, every moment in
     * an older drawing would silently become anticlockwise the moment
     * it was opened: a direction change nobody asked for and nobody
     * can see.
     */
    function momentIsClockwise(
        geometry
    ) {
        if (
            geometry?.direction != null
        ) {
            return String(geometry.direction) === "CW";
        }

        return geometry?.clockwise === true;
    }

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
        isPreview = false
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
                1,
                Number.isFinite(Number(value)) && Number(value) > 0
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

        svg.append(
            ...elements
        );
    }

    /*
     * ========================================================
     * SNAP MARKERS
     * ========================================================
     *
     * Different snap types deliberately have different
     * geometric symbols so the user can immediately tell
     * what has been detected.
     */

    function renderSnapMarker(
        svg,
        candidate,
        screenPoint
    ) {
        const x =
            screenPoint.x;

        const y =
            screenPoint.y;

        const size = 6;

        const stroke =
            "#00a9c7";

        const fill =
            "#ffffff";

        /*
         * ENDPOINT
         *
         * Square
         */
        if (
            candidate.type ===
            "endpoint"
        ) {
            const square =
                createSvgElement(
                    "rect",
                    {
                        x:
                            x -
                            size / 2,
                        y:
                            y -
                            size / 2,
                        width:
                            size,
                        height:
                            size,
                        fill,
                        stroke,
                        "stroke-width":
                            1.5
                    }
                );

            svg.appendChild(
                square
            );

            return;
        }

        /*
         * MIDPOINT
         *
         * Triangle
         */
        if (
            candidate.type ===
            "midpoint"
        ) {
            const triangle =
                createSvgElement(
                    "path",
                    {
                        d:
                            `M ${x} ${y - size / 2}
                             L ${x + size / 2} ${y + size / 2}
                             L ${x - size / 2} ${y + size / 2}
                             Z`,
                        fill,
                        stroke,
                        "stroke-width":
                            1.5
                    }
                );

            svg.appendChild(
                triangle
            );

            return;
        }

        /*
         * CENTER
         *
         * Circle with crosshair.
         */
        if (
            candidate.type ===
            "center"
        ) {
            const circle =
                createSvgElement(
                    "circle",
                    {
                        cx: x,
                        cy: y,
                        r: 4,
                        fill,
                        stroke,
                        "stroke-width":
                            1.4
                    }
                );

            const horizontal =
                createSvgElement(
                    "line",
                    {
                        x1:
                            x - 6,
                        y1: y,
                        x2:
                            x + 6,
                        y2: y,
                        stroke,
                        "stroke-width":
                            1.2
                    }
                );

            const vertical =
                createSvgElement(
                    "line",
                    {
                        x1: x,
                        y1:
                            y - 6,
                        x2: x,
                        y2:
                            y + 6,
                        stroke,
                        "stroke-width":
                            1.2
                    }
                );

            svg.append(
                circle,
                horizontal,
                vertical
            );

            return;
        }

        /*
         * INTERSECTION
         *
         * X
         */
        if (
            candidate.type ===
            "intersection"
        ) {
            const intersection =
                createSvgElement(
                    "path",
                    {
                        d:
                            `M ${x - 5} ${y - 5}
                             L ${x + 5} ${y + 5}
                             M ${x + 5} ${y - 5}
                             L ${x - 5} ${y + 5}`,
                        fill: "none",
                        stroke,
                        "stroke-width":
                            1.7
                    }
                );

            svg.appendChild(
                intersection
            );

            return;
        }

        /*
         * QUADRANT
         *
         * Diamond
         */
        if (
            candidate.type ===
            "quadrant"
        ) {
            const diamond =
                createSvgElement(
                    "path",
                    {
                        d:
                            `M ${x} ${y - 5}
                             L ${x + 5} ${y}
                             L ${x} ${y + 5}
                             L ${x - 5} ${y}
                             Z`,
                        fill,
                        stroke,
                        "stroke-width":
                            1.5
                    }
                );

            svg.appendChild(
                diamond
            );

            return;
        }

        /*
         * POINT ON ENTITY
         *
         * Small circle.
         */
        if (
            candidate.type ===
            "pointOnEntity"
        ) {
            const pointMarker =
                createSvgElement(
                    "circle",
                    {
                        cx: x,
                        cy: y,
                        r: 3,
                        fill,
                        stroke,
                        "stroke-width":
                            1.5
                    }
                );

            svg.appendChild(
                pointMarker
            );

            return;
        }

        /*
         * Fallback
         */
        const fallback =
            createSvgElement(
                "circle",
                {
                    cx: x,
                    cy: y,
                    r: 4,
                    fill,
                    stroke,
                    "stroke-width":
                        1.5
                }
            );

        svg.appendChild(
            fallback
        );
    }

    function renderInferenceLine(
        svg,
        state,
        bounds
    ) {
        /*
         * The HELD guide, not the raw inference.
         *
         * The guide is kept up for a short period after the
         * cursor leaves its region, so that a student lining a
         * member up sees the guide settle rather than flicker
         * off and on with every small movement. Reading the
         * stored guideline rather than the current inference is
         * what makes that hold actually visible; reading the
         * live inference would draw the guide exactly as often
         * as before and the hold would be invisible.
         */
        const inference =
            state.interaction?.guideline
                ?.inference ||
            state.interaction?.inference;

        if (
            !inference?.referencePoint ||
            !inference?.point
        ) {
            return;
        }

        const pointScreen =
            enggDrawingState.engineeringToScreen(
                inference.point,
                bounds,
                state
            );

        /*
         * A combined inference aligns with one point
         * horizontally and another vertically, so draw
         * a guide line for each axis.
         */
        const references =
            inference.horizontalReferencePoint ||
            inference.verticalReferencePoint
                ? [
                    inference.horizontalReferencePoint,
                    inference.verticalReferencePoint
                ].filter(Boolean)
                : [
                    inference.referencePoint
                ];

        references.forEach(
            reference => {
                const referenceScreen =
                    enggDrawingState
                        .engineeringToScreen(
                            reference,
                            bounds,
                            state
                        );

                const line =
                    createSvgElement(
                        "line",
                        {
                            x1: referenceScreen.x,
                            y1: referenceScreen.y,
                            x2: pointScreen.x,
                            y2: pointScreen.y,
                            stroke: paintColour("#4b8198"),
                            "stroke-width": 1,
                            "stroke-dasharray": "3 3",
                            opacity: 0.9
                        }
                    );

                svg.appendChild(line);
            }
        );
    }

    function renderSnapIndicator(
        svg,
        state,
        bounds
    ) {
        const candidate =
            state.interaction
                .snapCandidate;

        if (!candidate) {
            return;
        }

        const screenPoint =
            enggDrawingState
                .engineeringToScreen(
                    candidate.point,
                    bounds,
                    state
                );

        /*
         * THE MARKER, AND NOTHING ELSE.
         *
         * There used to be a text label drawn beside the marker, saying
         * what kind of snap it was - and falling back to the bare word
         * "Snap" for any candidate it had no name for. That put the
         * word "snap" on the drawing itself, next to the student's work,
         * where it is neither drafting nor annotation: it is status
         * output drawn into the document, and it is captured by every
         * export, print and Drawing Reference.
         *
         * The marker already says what happened, graphically and
         * unambiguously, and the bottom status line says it in words -
         * "Horizontal", "Centreline", "Endpoint" - which is where a
         * transient message belongs and where it does not travel with
         * the drawing. So the label is not moved to the status line,
         * because it is already there; it is simply removed from the
         * sheet.
         */
        renderSnapMarker(
            svg,
            candidate,
            screenPoint
        );
    }

    /*
     * ========================================================
     * SELECTION BOX
     * ========================================================
     */

    function renderSelectionBox(
        svg,
        state,
        bounds
    ) {
        const box =
            state.interaction
                .selectionBox;

        if (!box) {
            return;
        }

        if (
            Number.isFinite(
                box.minX
            ) &&
            Number.isFinite(
                box.maxX
            ) &&
            Number.isFinite(
                box.minY
            ) &&
            Number.isFinite(
                box.maxY
            )
        ) {
            const topLeft =
                enggDrawingState
                    .engineeringToScreen(
                        {
                            x: box.minX,
                            y: box.maxY
                        },
                        bounds,
                        state
                    );

            const bottomRight =
                enggDrawingState
                    .engineeringToScreen(
                        {
                            x: box.maxX,
                            y: box.minY
                        },
                        bounds,
                        state
                    );

            const rect =
                createSvgElement(
                    "rect",
                    {
                        x:
                            Math.min(
                                topLeft.x,
                                bottomRight.x
                            ),
                        y:
                            Math.min(
                                topLeft.y,
                                bottomRight.y
                            ),
                        width:
                            Math.abs(
                                bottomRight.x -
                                    topLeft.x
                            ),
                        height:
                            Math.abs(
                                bottomRight.y -
                                    topLeft.y
                            ),
                        class:
                            "drawing-selection-box"
                    }
                );

            svg.appendChild(
                rect
            );

            return;
        }

        if (
            Number.isFinite(
                box.x
            ) &&
            Number.isFinite(
                box.y
            ) &&
            Number.isFinite(
                box.width
            ) &&
            Number.isFinite(
                box.height
            )
        ) {
            const rect =
                createSvgElement(
                    "rect",
                    {
                        x: box.x,
                        y: box.y,
                        width:
                            box.width,
                        height:
                            box.height,
                        class:
                            "drawing-selection-box"
                    }
                );

            svg.appendChild(
                rect
            );
        }
    }

    function renderEngineeringGrid(svg, state, bounds) {
        const spacing = Number(state.grid?.spacing);
        if (!state.grid?.visible || !Number.isFinite(spacing) || spacing <= 0) return;
        const scale = enggDrawingState.BASE_PIXELS_PER_UNIT * state.camera.zoom;
        if (!Number.isFinite(scale) || scale <= 0) return;
        const minX = state.camera.panX - bounds.width / (2 * scale);
        const maxX = state.camera.panX + bounds.width / (2 * scale);
        const minY = state.camera.panY - bounds.height / (2 * scale);
        const maxY = state.camera.panY + bounds.height / (2 * scale);
        const segments = [];
        for (let x = Math.ceil(minX / spacing) * spacing, count = 0; x <= maxX && count < 1500; x += spacing, count += 1) {
            const screen = enggDrawingState.engineeringToScreen({ x, y: 0 }, bounds, state);
            segments.push(`M ${screen.x} 0 V ${bounds.height}`);
        }
        for (let y = Math.ceil(minY / spacing) * spacing, count = 0; y <= maxY && count < 1500; y += spacing, count += 1) {
            const screen = enggDrawingState.engineeringToScreen({ x: 0, y }, bounds, state);
            segments.push(`M 0 ${screen.y} H ${bounds.width}`);
        }
        if (!segments.length) return;

        /*
         * THE GRID'S COLOUR COMES FROM THE THEME, NEVER FROM A LITERAL HERE.
         *
         * IT USED TO BE `stroke: "#e7ecef"`, a hardcoded pale grey. That is why
         * the grid disappeared in dark mode, and it is worth being precise about
         * the mechanism, because the class was already there and did nothing: a
         * PRESENTATION ATTRIBUTE OUTRANKS A STYLESHEET RULE. The CSS said
         * `stroke: var(--grid-minor-color)` and the attribute said `#e7ecef`, and
         * the attribute won every time - so the grid stayed pale grey on a
         * charcoal sheet and became invisible.
         *
         * The attribute is removed, so the class decides and the theme is
         * honoured. `currentColor` would not help here: the grid is a sibling of
         * the geometry and does not inherit a feature's colour.
         *
         * THE STANDALONE-OUTPUT CONCERN IS MET DIFFERENTLY. The reason the
         * literal was here is real - an SVG export, a printed page and a Drawing
         * Reference are rendered WITHOUT the editor stylesheet, so a grid styled
         * only by class would not appear in them. Those outputs are therefore
         * given the theme's grid colour EXPLICITLY by the code that builds them,
         * which knows what background it is painting onto. Stating it here, where
         * the screen renderer draws, is what made one output's need into the
         * screen's bug.
         */
        svg.appendChild(createSvgElement("path", {
            d: segments.join(" "),
            class: "drawing-engineering-grid",
            fill: "none",
            "stroke-width": 0.65
        }));
    }

    /*
     * The rigid body handles, resolved the same way the drag
     * layer resolves them.
     *
     * The drag layer owns the list so there is one answer to
     * what a rigid body's handles are; the renderer only needs
     * to know where to draw them.
     */
    function rigidBodyHandlesForRender(object) {
        if (typeof rigidBodyHandles === "function") {
            return rigidBodyHandles(object);
        }

        return enggFeatureGeometry
            .rectangleCorners(object.geometry || {})
            .map((point) => ({ point }));
    }

    function renderSelectionHandles(svg, state, bounds) {
        const selected = new Set(state.selection?.selectedObjectIds || []);
        if (!selected.size) return;
        const toScreen = point => enggDrawingState.engineeringToScreen(point, bounds, state);
        const scale =
            enggDrawingState.BASE_PIXELS_PER_UNIT *
            state.camera.zoom;
        const add = (point, kind = "") => {
            if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
            const screen = toScreen(point);
            svg.appendChild(createSvgElement("circle", {
                cx: screen.x,
                cy: screen.y,
                r: 3.8,
                class: `drawing-manipulation-handle${kind ? ` ${kind}` : ""}`
            }));
        };

        const frame = selectionBounds(state.objects, [...selected]);
        if (frame) {
            const first = toScreen({ x: frame.minX, y: frame.maxY });
            const last = toScreen({ x: frame.maxX, y: frame.minY });
            svg.appendChild(createSvgElement("rect", {
                x: first.x - 8, y: first.y - 8,
                width: Math.max(16, last.x - first.x + 16), height: Math.max(16, last.y - first.y + 16),
                fill: "none", stroke: "#3b82f6", "stroke-width": 1,
                "stroke-dasharray": "4 3", "pointer-events": "none"
            }));
            if (selected.size > 1) {
                selectionCorners(frame).forEach(point => add(point, "group-resize"));
                // Keep the cylinder's internal controls available even when
                // its surrounding control volume is selected with it.
                state.objects.filter(object => selected.has(object.id) && isPistonCylinder(object))
                    .forEach(object => {
                        const g = object.geometry;
                        add(cylinderPoint(g, 0.5, pistonFraction(g)), "piston-height");
                        if (g.hasStoppers) {
                            [0.09, 0.91].forEach(x => add(cylinderPoint(g, x, stopperFraction(g)), "stopper-height"));
                        }
                    });
                return;
            }
        }

        /*
         * THE SELECTED ANNOTATION'S BOX.
         *
         * A derived magnitude is not a document feature, so its id is
         * never in `selectedObjectIds` and the per-object loop below
         * never sees it — yet the spec asks for exactly this: when the
         * student clicks a value label, a compact box appears around
         * THE TEXT, not around the feature it belongs to.
         *
         * The box is the annotation model's own text bounds — the same
         * measurement the hit test uses, plus the same padding — so
         * what is highlighted is what a click selects, and what a drag
         * grabs. The padding follows the hit test's padding in screen
         * pixels, so the highlight is never smaller than the click
         * target it describes.
         *
         * Editor-only by construction: the selected set is cleared in
         * the clean renders that print and export use, so the box can
         * never reach paper or a file. It disappears on deselect
         * because it is drawn fresh on every frame from the selection.
         */
        const selectionPaddingPx =
            (state.selection?.annotationPickPaddingPx ?? 2);

        const model = enggAnnotationModel;

        if (model && typeof model.derivedAnnotations === "function") {
            /*
             * A TIGHT BOX AROUND THE ACTUAL RENDERED TEXT.
             *
             * The label is drawn as SVG text at `fontSize` SCREEN pixels - it
             * does not scale with the camera - so its box is measured in
             * screen pixels too, from the same placement point and the same
             * font size the text node is built with. Measuring it in world
             * units and projecting that would tie the box to the zoom and
             * make it many times larger than the glyphs it is meant to
             * outline.
             *
             * The padding is a couple of pixels on every side: enough to read
             * as a frame around the text, not the large surrounding rectangle
             * it used to be. It is an editor aid only - drawn fresh from the
             * selection every frame, and cleared for the clean renders that
             * print and export use - so it never reaches paper or a file.
             */

            /*
             * The box is keyed by the DERIVED annotation's id - the same
             * pseudo-id a click stored - so the highlight follows the
             * label the student picked, including one label of a
             * varying load and not its siblings.
             */
            state.objects.forEach(object => {
                (model.derivedAnnotations(object, state) || []).forEach(annotation => {
                    if (!selected.has(annotation.id)) return;

                    const placement = annotation.placement;

                    if (
                        !placement ||
                        !Number.isFinite(placement.x) ||
                        !Number.isFinite(placement.y)
                    ) {
                        return;
                    }

                    const text = String(
                        model.textFor(annotation, state) || ""
                    );

                    const lines = text.split("\n");

                    const fontSize =
                        Number(annotation.style?.fontSize) || 12;

                    const lineHeight = fontSize * 1.2;

                    const longest = lines.reduce(
                        (max, line) => Math.max(max, line.length),
                        0
                    );

                    /*
                     * The same character-width estimate the hit test uses,
                     * so what is outlined is what a click can grab.
                     */
                    const textWidth =
                        longest * fontSize * 0.62;

                    const textHeight = Math.max(
                        fontSize * 1.2,
                        lines.length * lineHeight
                    );

                    /*
                     * The text is centred on the placement point (the
                     * renderer uses text-anchor: middle), so the box is
                     * centred there too and grows by the padding on each
                     * side.
                     */
                    const origin = toScreen(placement);

                    const x =
                        origin.x - textWidth / 2 - selectionPaddingPx;

                    const y =
                        origin.y - textHeight / 2 - selectionPaddingPx;

                    const width =
                        textWidth + selectionPaddingPx * 2;

                    const height =
                        textHeight + selectionPaddingPx * 2;

                    svg.appendChild(createSvgElement("rect", {
                        x,
                        y,
                        width,
                        height,
                        class: "drawing-annotation-selection-box"
                    }));
                });
            });
        }

        /*
         * THE SELECTED AXIS LABEL'S BOX.
         *
         * A coordinate system's X and Y labels are drawing-space text, so they
         * get the same tight box a magnitude label gets - around THE TEXT, from
         * the same character-width estimate the hit test uses, so what is
         * outlined is exactly what a click can grab.
         *
         * It is measured in SCREEN pixels because the label is drawn at a fixed
         * screen font size rather than scaling with the camera, and it is drawn
         * fresh from the selection every frame - so it is editor-only by
         * construction and cannot reach paper or a file.
         */
        state.objects.forEach(object => {
            if (object.type !== "coordinate-system-2d") {
                return;
            }

            const labels = axisLabelPositions(object);

            labels.forEach((label) => {
                if (!selected.has(label.id)) {
                    return;
                }

                const fontSize = 13;

                const width =
                    label.text.length * fontSize * 0.62 +
                    selectionPaddingPx * 2;

                const height =
                    fontSize * 1.2 + selectionPaddingPx * 2;

                const origin = toScreen(label.position);

                svg.appendChild(createSvgElement("rect", {
                    x: origin.x - width / 2,
                    y: origin.y - height / 2,
                    width,
                    height,
                    class: "drawing-annotation-selection-box"
                }));
            });
        });

        state.objects.forEach(object => {
            if (!selected.has(object.id)) return;
            const geometry = object.geometry || {};
            if (object.type === "point") {
                add(geometry.position || geometry.point || geometry);
            } else if (object.type === "line") {
                add(geometry.start);
                add(geometry.end);
            } else if (object.type === "circle") {
                add(geometry.center);
                add({ x: geometry.center.x + geometry.radius, y: geometry.center.y });
            } else if (object.type === "arc") {
                add(geometry.center);
                add({ x: geometry.center.x + geometry.radius * Math.cos(geometry.startAngle), y: geometry.center.y + geometry.radius * Math.sin(geometry.startAngle) });
                add({ x: geometry.center.x + geometry.radius * Math.cos(geometry.endAngle), y: geometry.center.y + geometry.radius * Math.sin(geometry.endAngle) });
            } else if (object.type === "rectangle") {
                enggFeatureGeometry
                    .rectangleCorners(geometry)
                    .forEach((point) => add(point));
                if (isPistonCylinder(object)) {
                    add(cylinderPoint(geometry, 0.5, pistonFraction(geometry)), "piston-height");
                    if (geometry.hasStoppers) {
                        [0.09, 0.91].forEach(x => add(cylinderPoint(geometry, x, stopperFraction(geometry)), "stopper-height"));
                    }
                }
            } else if (object.type === "rigid-body") {
                /*
                 * A rigid body's handles follow its current shape,
                 * resolved through the same helper the drag layer
                 * uses, so a drawn handle and a grabbable handle can
                 * never be in different places.
                 */
                rigidBodyHandlesForRender(object).forEach(
                    (handle) => add(handle.point)
                );
            } else if (object.type === "polygon") {
                enggDrawingState.polygonVertices(geometry).forEach((point) => add(point));
            } else if (object.type === "particle") {
                /*
                 * A particle has one position handle.
                 */
                add(geometry.position);
            } else if (object.type === "load" || object.type === "varying-load") {
                add(geometry.start);
                add(geometry.end);
                add({
                    x: geometry.start.x,
                    y: geometry.start.y + 26 / Math.max(scale, 1e-6)
                });
            } else if (object.type === "force") {
                /*
                 * A force's arrowhead handle sits WHERE THE ARROW IS
                 * DRAWN, not at the stored end.
                 *
                 * The stored end is the engineering vector - exactly
                 * `magnitude` from the application point - while the
                 * arrow is drawn at the shared Statics display scale. At
                 * 4x the two are four times apart, so a handle at the
                 * stored end would float in the middle of its own arrow.
                 *
                 * The generic `start`/`end` branch below reads
                 * `geometry.end` directly, so a force needs its own case
                 * here. It asks the same model function the drag layer
                 * asks, so a drawn handle and a grabbable handle can never
                 * be in different places.
                 */
                add(geometry.start || geometry.position);

                add(
                    enggLoadProfile.drawnForceEnd(
                        state,
                        geometry
                    )
                );
            } else if (geometry.start && geometry.end) {
                add(geometry.start);
                add(geometry.end);
            } else if (geometry.position) {
                add(geometry.position);
            } else if (object.type === "polyline") {
                const points = geometry.points || [];
                const lastPoint = points[points.length - 1];
                const closed = points.length > 2 && Math.hypot(points[0].x - lastPoint.x, points[0].y - lastPoint.y) < 1e-8;
                points.slice(0, closed ? -1 : undefined).forEach(point => add(point));
            } else if (object.type === "coordinate-system-2d") {
                /*
                 * One handle per axis end, so each of the four
                 * extensions can be dragged on its own while the
                 * feature stays a single object.
                 */
                coordinateSystemArms(
                    geometry
                ).forEach(
                    arm =>
                        add(arm.end, arm.kind)
                );

                add(geometry.origin, "origin");
            }
        });
    }

    /*
     * ========================================================
     * LIVE PREVIEW HELPERS
     * ========================================================
     */

    function previewStyle(preview) {
        return {
            stroke:
                preview?.style?.stroke || "#1f5c38",
            fill:
                "none",
            lineWidth:
                0.7,
            opacity:
                preview?.style?.opacity ?? 0.72,
            lineType:
                preview?.style?.lineType || "solid"
        };
    }

    function renderPreview(
        svg,
        state,
        bounds
    ) {
        if (["process-path", "constant-temp-pressure-lines"].includes(state.interaction.preview?.metadata?.thermodynamicsKind)) {
            appendEntity(svg, state.interaction.preview, state, bounds);
            return;
        }
        if (isSaturationCurve(state.interaction.preview)) {
            appendEntity(svg, state.interaction.preview, state, bounds);
            return;
        }
        const toScreenAll =
            point =>
                enggDrawingState.engineeringToScreen(point, bounds, state);

        /*
         * THE PIECE OF LINE TRIM WILL REMOVE.
         *
         * Drawn as a thick highlight over the segment itself, because that is
         * the question the student is asking - "is this the part I mean?" - and
         * the answer has to be the same segment the click removes. It comes from
         * the session's own `trimPreview`, which was computed by the same
         * function the commit uses, so the two cannot disagree.
         *
         * Editor-only by construction: a preview is drawn fresh from the session
         * on every frame, and a clean render - print, export, thumbnail - has no
         * session at all, so it can never reach paper or a file.
         */
        const trimPreview = state.interaction.trimPreview;

        if (trimPreview?.from && trimPreview?.to) {
            const a = toScreenAll(trimPreview.from);
            const b = toScreenAll(trimPreview.to);

            svg.appendChild(
                createSvgElement("line", {
                    x1: a.x,
                    y1: a.y,
                    x2: b.x,
                    y2: b.y,
                    class: "drawing-trim-preview",
                    stroke: paintColour("#b00020"),
                    "stroke-width": 3,
                    "stroke-linecap": "round",

                    /*
                     * Semi-transparent, so the geometry being cut is still
                     * visible under the highlight rather than hidden by it.
                     */
                    opacity: 0.55
                })
            );
        }
        /*
         * THE ANALYSIS AXIS BEING POSITIONED.
         *
         * Drawn through exactly the same routine that draws a committed
         * diagram, for the same reason the dimension preview is: a
         * preview that looked even slightly different from the real
         * thing would leave the student placing something other than
         * what they were shown.
         *
         * What marks it as a preview is the language, not a different
         * drawing - dashed and translucent, as every other preview in
         * this file is. The shape on screen is the shape the click will
         * produce.
         */
        const axisPlacement =
            state.interaction.analysisPlacement;

        if (axisPlacement) {
            const group =
                createSvgElement("g");

            group.classList.add(
                "drawing-analysis-axis-preview"
            );

            group.setAttribute(
                "opacity",
                "0.72"
            );

            /*
             * Drawn as a real analysis object so it is the same
             * routine, with the preview's own styling.
             */
            appendEntity(
                group,
                {
                    id: "analysis-axis-preview",
                    type: "analysis-diagram",
                    geometry: {
                        start: axisPlacement.start,
                        end: axisPlacement.end,
                        diagramType: axisPlacement.diagramType,
                        drawingHeight: 90,
                        backgroundVisible: true,
                        referencePositions: []
                    },
                    style: {
                        stroke: "#1f5c38",
                        lineWidth: 0.7
                    }
                },
                state,
                bounds
            );

            svg.appendChild(group);
        }

        /*
         * THE DIMENSION PREVIEW
         *
         * Drawn BEFORE the ordinary preview check below, because a
         * dimension being placed is not a `preview` object: it has no
         * geometry of its own yet - it refers to geometry that already
         * exists, and only its POSITION is still undecided.
         *
         * So the preview is built here as a throwaway dimension at the
         * cursor, and drawn through exactly the same routine that
         * draws a committed one. That is deliberate: a preview that
         * looked even slightly different from the real thing would
         * leave the student placing something other than what they
         * were shown, and the value they confirm is the value they
         * saw only because both come from the same measurement.
         */
        /*
         * THE FIRST REFERENCE, WHILE THE TOOL WAITS.
         *
         * A chosen point must be visibly held, so the student can see
         * which reference is already in and that the tool is waiting
         * rather than idle. It is a small marker at the resolved model
         * point, drawn in the tool's own colour, and it disappears the
         * moment the reference is committed or cancelled.
         */
        const heldFirst =
            state.interaction
                .dimensionStage === "first" ||
            state.interaction
                .dimensionStage === "armed"
                ? state.interaction
                      .dimensionFirstRef
                : null;

        if (heldFirst) {
            const heldObject = (
                state.objects || []
            ).find(
                object =>
                    object.id === heldFirst.featureId
            );

            const heldPoint =
                enggMeasurement?.resolveAnchor?.(
                    heldObject,
                    heldFirst.anchor
                );

            if (heldPoint) {
                const screenPoint =
                    enggDrawingState
                        .engineeringToScreen(
                            heldPoint,
                            bounds,
                            state
                        );

                const marker =
                    createSvgElement("circle");

                marker.setAttribute(
                    "cx",
                    screenPoint.x
                );
                marker.setAttribute(
                    "cy",
                    screenPoint.y
                );
                marker.setAttribute("r", "4");
                marker.setAttribute(
                    "fill",
                    "#1f5c38"
                );
                marker.setAttribute(
                    "stroke",
                    "#ffffff"
                );
                marker.setAttribute(
                    "stroke-width",
                    "1.5"
                );

                marker.classList.add(
                    "drawing-dimension-reference"
                );

                svg.appendChild(marker);
            }
        }

        const armed =
            state.interaction
                .dimensionRefs;

        if (armed && armed.length) {
            const toScreen =
                point =>
                    enggDrawingState
                        .engineeringToScreen(
                            point,
                            bounds,
                            state
                        );

            /*
             * A VARIABLE DIMENSION'S PREVIEW SHOWS THE DIMENSION GEOMETRY AND
             * NOT AN ANSWER.
             *
             * The preview was always built as a `dimension` probe, so an
             * armed VARIABLE dimension drew the MEASURED value - "100 mm" on a
             * line the student was about to name `L`. That number is not the
             * feature's value and never becomes it, so showing it was telling
             * the student something the drawing would then contradict.
             *
             * The extension lines, the arrows and the placement are the same
             * either way - they come from the shared dimension model - so the
             * variable case is drawn as a variable with an EMPTY symbol, and
             * `appendVariableDimensionEntity` returns before drawing any text.
             * The shape appears, the value does not.
             */
            const previewingVariable =
                state.activeTool === "variable-dimension";

            const previewDimension = {
                id: "dimension-preview",
                type: previewingVariable ? "variable-dimension" : "dimension",

                /*
                 * AN EMPTY SYMBOL IS THE "not written yet" STATE, and the
                 * variable renderer draws nothing for it - which is exactly
                 * the empty value the requirement asks the preview to show.
                 */
                symbol: previewingVariable ? "" : undefined,

                dimensionType:
                    state.interaction
                        .dimensionChoice,
                sourceRefs: armed,
                placement:
                    state.interaction
                        .dimensionPlacement,
                style: {
                    stroke: "#1f5c38",
                    lineWidth: 0.7
                }
            };

            const previewGroup =
                createSvgElement("g");

            previewGroup.classList.add(
                "drawing-dimension-preview"
            );

            /*
             * Dashed and translucent, the convention every other
             * preview in this file uses for "not placed yet".
             */
            previewGroup.setAttribute(
                "opacity",
                "0.72"
            );

            /*
             * DRAWN BY THE RENDERER FOR ITS OWN KIND, so the preview and the
             * committed feature cannot disagree: a variable previews through
             * the variable renderer (which draws the shape and no text for an
             * empty symbol), and a dimension through the dimension one.
             */
            if (previewingVariable) {
                appendVariableDimensionEntity(
                    previewGroup,
                    previewDimension,
                    state,
                    toScreen,
                    previewDimension.style
                );
            } else {
                appendDimensionEntity(
                    previewGroup,
                    previewDimension,
                    state,
                    toScreen,
                    previewDimension.style
                );
            }

            svg.appendChild(previewGroup);
        }

/*
 * The annotation preview, appended to the Dimension preview branch in
 * renderPreview.
 */
        /*
         * THE ANNOTATION PREVIEW
         *
         * Drawn in the same place as the dimension preview and by the
         * same routine that draws a committed annotation, so what the
         * student is shown is exactly what will appear.
         *
         * A generated label previews the TEXT ITS FEATURE WOULD SHOW,
         * read from the source by the annotation model - not a
         * placeholder like "250 N". That matters when the point of the
         * label is the value: a student deciding where to put it should
         * be able to read it before committing.
         *
         * A note previews the words "Double-click to write", because
         * there is nothing to show until they have written something.
         */
        const armedAnnotation =
            state.interaction.annotationKind;

        if (armedAnnotation) {
            const toScreenAnnotation =
                (point) =>
                    enggDrawingState.engineeringToScreen(
                        point,
                        bounds,
                        state
                    );

            const placement =
                state.interaction
                    .annotationPlacement;

            if (placement) {
                const sourceFeatureId =
                    state.interaction
                        .annotationTarget;

                const sourceObject =
                    sourceFeatureId
                        ? state.objects.find(
                            (object) =>
                                object.id === sourceFeatureId
                        )
                        : null;

                const probe = {
                    id: "annotation-preview",
                    type: "annotation",
                    annotationKind: armedAnnotation,
                    textMode: "auto",
                    text: "",
                    sourceFeatureId,
                    placement
                };

                const shown =
                    sourceObject &&
                    enggAnnotationModel.textFor(
                        probe,
                        state
                    );

                const previewGroup =
                    createSvgElement("g");

                previewGroup.classList.add(
                    "drawing-annotation-preview"
                );
                previewGroup.setAttribute(
                    "opacity",
                    "0.72"
                );

                appendAnnotationEntity(
                    previewGroup,
                    {
                        ...probe,
                        text: shown || "Double-click to write"
                    },
                    state,
                    toScreenAnnotation,
                    { stroke: "#1f5c38", fontSize: 12 }
                );

                svg.appendChild(previewGroup);
            }
        }

        /*
         * THE ANNOTATE PREVIEW.
         *
         * An armed leader, callout or arrow is drawn from its held anchor to
         * the cursor, through the very routine that draws the committed
         * feature - so the pen, the head and the box the student sees are
         * exactly what they will get. The preview lives on the INTERACTION,
         * never the document, so it cannot be selected, saved or undone, and
         * Escape removes it by clearing the interaction.
         */
        if (
            state.interaction.annotateStage === "anchor" &&
            state.interaction.annotateStart
        ) {
            const toScreenAnnotate =
                (point) =>
                    enggDrawingState.engineeringToScreen(
                        point,
                        bounds,
                        state
                    );

            const previewMark = {
                id: "annotate-preview",
                type: "annotate",
                annotateKind:
                    state.interaction.annotateKind,
                text: "",
                geometry: {
                    start: state.interaction.annotateStart,
                    end: state.interaction.annotateEnd
                },
                style: {
                    stroke: "#1f5c38",
                    fontSize: 12,
                    arrowhead: "closed"
                }
            };

            const previewGroup =
                createSvgElement("g");

            previewGroup.classList.add(
                "drawing-annotate-preview"
            );
            previewGroup.setAttribute(
                "opacity",
                "0.72"
            );

            appendAnnotateEntity(
                previewGroup,
                previewMark,
                state,
                toScreenAnnotate,
                previewMark.style
            );

            svg.appendChild(previewGroup);
        }

        const preview =
            state.interaction
                .preview;

        if (
            !preview ||
            !preview.geometry
        ) {
            return;
        }

        const geometry =
            preview.geometry;

        const scale =
            enggDrawingState
                .BASE_PIXELS_PER_UNIT *
            state.camera.zoom;

        const toScreen =
            point =>
                enggDrawingState
                    .engineeringToScreen(
                        point,
                        bounds,
                        state
                    );

        const style =
            previewStyle(preview);

        /*
         * VALID PLACEMENT LOCATIONS
         *
         * The points along the selected body where this
         * feature may be placed. They are drawn as small
         * markers so the valid positions are obvious, and
         * they are pure preview: they are never features,
         * never enter the collection and cannot be picked.
         */
        if (
            Array.isArray(preview.locations)
        ) {
            preview.locations.forEach(location => {
                if (
                    !location ||
                    !Number.isFinite(location.x) ||
                    !Number.isFinite(location.y)
                ) {
                    return;
                }

                const screen =
                    toScreen(location);

                svg.appendChild(
                    createSvgElement("circle", {
                        cx: screen.x,
                        cy: screen.y,
                        r: 2.5,
                        fill: style.stroke,
                        stroke: "none",
                        opacity: 0.55
                    })
                );
            });
        }

        /*
         * THE CURRENT TARGET BODY
         *
         * The body being attached to is outlined while the
         * feature is being placed, so it is clear which body
         * the result will belong to.
         */
        if (
            preview.targetBody
        ) {
            enggFeatureGeometry
                .definingPoints(
                    preview.targetBody.geometry,
                    preview.targetBody.type
                )
                .forEach(point => {
                    const screen =
                        toScreen(point);

                    svg.appendChild(
                        createSvgElement("circle", {
                            cx: screen.x,
                            cy: screen.y,
                            r: 3,
                            fill: "none",
                            stroke: style.stroke,
                            "stroke-width": 1.2,
                            "stroke-dasharray": "3 2",
                            opacity: 0.75
                        })
                    );
                });
        }

        if (preview.type === "point") {
            const position = geometry.position || geometry.point || geometry;
            const screen = toScreen(position);
            svg.appendChild(createSvgElement("circle", {
                cx: screen.x,
                cy: screen.y,
                r: 4,
                fill: "none",
                stroke: style.stroke,
                "stroke-width": 1.5,
                opacity: style.opacity
            }));
            return;
        }

        /*
         * TRUSS CONSTRUCTION
         *
         * The members drawn so far and the member in progress are
         * preview geometry. They belong to the construction, not to
         * the feature collection, so they are never selectable and
         * never appear in the tree; they are replaced by the one
         * Truss feature when the student double-clicks.
         *
         * Every member already placed stays drawn, so the whole
         * structure being built is always visible, and all of it is
         * highlighted together with the member in progress. The
         * highlight is what distinguishes an unfinished truss from a
         * finished one, and it is dropped the moment the
         * construction is committed.
         *
         * This is drawn here, before the plain LINE branch, because
         * a truss member in progress previews as a line and would
         * otherwise be caught by that branch and return before the
         * rest of the structure was drawn.
         */
        if (state.interaction.phase === 'truss-construct') {
            const truss = state.interaction.trussMembers || [];
            const inProgress = state.interaction.trussInProgress;
            const constructionStroke =
                state.interaction.trussStyle?.stroke || style.stroke;

            if (truss.length) {
                /*
                 * A wide, translucent pass under the members. One
                 * path for the whole structure is what makes the
                 * construction read as a single highlighted object
                 * rather than as a set of loose lines.
                 */
                svg.appendChild(
                    createSvgElement("path", {
                        d: truss
                            .map(member => {
                                const a = toScreen(member.start);
                                const b = toScreen(member.end);

                                return `M${a.x},${a.y}L${b.x},${b.y}`;
                            })
                            .join(" "),
                        fill: "none",
                        stroke: constructionStroke,
                        "stroke-width": 7,
                        "stroke-opacity": 0.22,
                        "stroke-linecap": "round",
                        "stroke-linejoin": "round"
                    })
                );

                truss.forEach(member => {
                    const a = toScreen(member.start);
                    const b = toScreen(member.end);

                    svg.appendChild(
                        createSvgElement("line", {
                            x1: a.x,
                            y1: a.y,
                            x2: b.x,
                            y2: b.y,
                            stroke: constructionStroke,
                            "stroke-width": 1.8
                        })
                    );
                });

                /*
                 * The joints, so it is visible which points are
                 * already part of the structure and where a new member
                 * can meet it.
                 */
                trussJoints(truss).forEach(joint => {
                    const p = toScreen(joint);

                    svg.appendChild(
                        createSvgElement("circle", {
                            cx: p.x,
                            cy: p.y,
                            r: 3,
                            fill: "#ffffff",
                            stroke: constructionStroke,
                            "stroke-width": 1.4
                        })
                    );
                });
            }

            if (inProgress) {
                const a = toScreen(inProgress);
                const b = toScreen(geometry.end);

                /*
                 * The member in progress is drawn on the same
                 * highlight as the members already placed, with a
                 * dashed line only to mark it as not yet committed.
                 */
                svg.appendChild(
                    createSvgElement("line", {
                        x1: a.x,
                        y1: a.y,
                        x2: b.x,
                        y2: b.y,
                        stroke: constructionStroke,
                        "stroke-width": 6,
                        "stroke-opacity": 0.22,
                        "stroke-linecap": "round"
                    })
                );

                svg.appendChild(
                    createSvgElement("line", {
                        x1: a.x,
                        y1: a.y,
                        x2: b.x,
                        y2: b.y,
                        stroke: constructionStroke,
                        "stroke-width": 1.8,
                        "stroke-dasharray": "6 4"
                    })
                );
            }
        }

        /*
         * LINE
         */
        if (
            preview.type ===
            "line"
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
                        y2: end.y,
                        stroke:
                            style.stroke,
                        "stroke-width":
                            1.5,
                        "stroke-dasharray":
                            "6 4",
                        opacity:
                            style.opacity
                    }
                );

            svg.appendChild(
                line
            );

            return;
        }

        /*
         * CIRCLE
         */
        if (
            preview.type ===
            "circle"
        ) {
            if (
                !geometry.center ||
                !Number.isFinite(
                    geometry.radius
                )
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
                        cx:
                            center.x,
                        cy:
                            center.y,
                        r:
                            Math.max(
                                0,
                                geometry.radius *
                                    scale
                            ),
                        fill:
                            "none",
                        stroke:
                            style.stroke,
                        "stroke-width":
                            1.5,
                        "stroke-dasharray":
                            "6 4",
                        opacity:
                            style.opacity
                    }
                );

            svg.appendChild(
                circle
            );

            return;
        }

        /*
         * RECTANGLE
         */
        if (
            preview.type ===
            "rectangle"
        ) {
            if (
                !geometry.position
            ) {
                return;
            }

            const x =
                geometry.position.x;

            const y =
                geometry.position.y;

            const width =
                geometry.width ??
                0;

            const height =
                geometry.height ??
                0;

            const topLeft =
                toScreen({
                    x,
                    y
                });

            /*
             * Same convention as the committed rectangle:
             * position is the top-left corner and toScreen
             * already flips Y, so no extra height offset is
             * applied. This keeps the preview identical to
             * the committed geometry.
             */
            const rect =
                createSvgElement(
                    "rect",
                    {
                        x:
                            topLeft.x,
                        y:
                            topLeft.y,
                        width:
                            width *
                            scale,
                        height:
                            height *
                            scale,
                        fill:
                            "none",
                        stroke:
                            style.stroke,
                        "stroke-width":
                            1.5,
                        "stroke-dasharray":
                            "6 4",
                        opacity:
                            style.opacity
                    }
                );

            const rotation =
                geometry.rotation ??
                0;

            if (rotation) {
                /*
                 * Same convention as the committed rectangle:
                 * position is the top-left corner, so the pivot
                 * is half a height below it.
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

            svg.appendChild(
                rect
            );

            return;
        }

        /*
         * POLYLINE
         */
        if (
            preview.type ===
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

            if (!points) {
                return;
            }

            const polyline =
                createSvgElement(
                    "polyline",
                    {
                        points,
                        fill:
                            "none",
                        stroke:
                            style.stroke,
                        "stroke-width":
                            1.5,
                        "stroke-dasharray":
                            "6 4",
                        opacity:
                            style.opacity
                    }
                );

            svg.appendChild(
                polyline
            );

            return;
        }

        /*
         * POLYGON
         *
         * Live preview derived from the same defining
         * parameters the committed feature will store.
         */
        if (
            preview.type ===
            "polygon"
        ) {
            const polygonPoints =
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

            if (polygonPoints) {
                const polygon =
                    createSvgElement(
                        "polygon",
                        {
                            points:
                                polygonPoints,
                            fill:
                                "none",
                            stroke:
                                style.stroke,
                            "stroke-width":
                                1.5,
                            "stroke-dasharray":
                                "6 4",
                            opacity:
                                style.opacity
                        }
                    );

                svg.appendChild(
                    polygon
                );
            }

            return;
        }

        /*
         * TRIANGLE
         *
         * Live preview of all three sides, closed
         * back to the first point.
         */
        if (
            preview.type ===
            "triangle"
        ) {
            const trianglePoints =
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

            if (trianglePoints) {
                const triangle =
                    createSvgElement(
                        "polygon",
                        {
                            points:
                                trianglePoints,
                            fill:
                                "none",
                            stroke:
                                style.stroke,
                            "stroke-width":
                                1.5,
                            "stroke-dasharray":
                                "6 4",
                            opacity:
                                style.opacity
                        }
                    );

                svg.appendChild(
                    triangle
                );
            }

            return;
        }

        /*
         * ARC
         */
        if (
            preview.type ===
            "arc"
        ) {
            if (
                !geometry.center ||
                !Number.isFinite(
                    geometry.radius
                )
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
                    "path",
                    {
                        d:
                            arcPathData(
                                center,
                                radius,
                                startAngle,
                                endAngle
                            ),
                        fill:
                            "none",
                        stroke:
                            style.stroke,
                        "stroke-width":
                            1.5,
                        "stroke-dasharray":
                            "6 4",
                        opacity:
                            style.opacity
                    }
                );

            svg.appendChild(
                path
            );

            return;
        }

        /*
         * 2D COORDINATE SYSTEM
         */

        if (
            preview.type ===
            "coordinate-system-2d"
        ) {
            appendCoordinateSystem(
                svg,
                geometry,
                style,
                state,
                bounds,
                true
            );
            return;
        }

        /*
         * STATICS SPAN PREVIEW
         *
         * A force, a load or a connection previews as the
         * very symbol it will become, so it runs through the
         * ordinary entity renderer rather than gaining a
         * second drawing system just for the preview. The
         * preview id keeps it out of selection and hit
         * testing, and its dashed style keeps it visually
         * distinct from the committed feature.
         */
        if (
            STATICS_PREVIEW_TYPES.includes(
                preview.type
            )
        ) {
            appendEntity(
                svg,
                {
                    ...preview,
                    isPreview: true
                },
                state,
                bounds
            );
        }
    }

    /*
     * Statics features that can be previewed as a two-point
     * span. They are drawn by appendEntity, so the preview
     * and the committed feature always match.
     */
    const STATICS_PREVIEW_TYPES = [
        "force",
        "load",
        "varying-load",
        "pin-connection",
        "fixed-connection",
        "slider-connection",
        "moment",
        "pin-support",
        "roller-support",
        "fixed-support",
        "smooth-support",
        "beam",
        "truss",
        "cable",
        "shaft",

        /*
         * An analysis diagram is here for the same reason as the rest.
         *
         * Without it, moving a graph drew NOTHING at the drag-to position
         * - no frame, no axis, no curve - so the student saw the graph
         * refuse to move until they released, then jump. It was listed as
         * absent because a diagram is not a two-point span like a beam, and
         * this list started out as spans only; the ones added since (loads,
         * moments, supports) are all things with their own drawing routine
         * that appendEntity handles just as well.
         */
        "analysis-diagram"
    ];

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

    /*
     * ========================================================
     * MAIN RENDERER
     * ========================================================
     */

    /*
     * Report features that could not be drawn.
     *
     * Collected for the whole pass and reported once, so a drawing with a dozen
     * broken features does not fill the console with a dozen identical stacks.
     *
     * The failures are LOGGED, never swallowed and never turned into a change
     * to the document: an error in one feature's renderer is a bug to be fixed,
     * and the evidence for it is the error and the feature's type and id.
     * Nothing here removes a feature, so a rendering problem can never become
     * data loss.
     */
    let lastRenderFailureSignature = null;

    function reportRenderFailures(failures) {
        const signature = failures
            .map(failure => `${failure.type}:${failure.error && failure.error.message}`)
            .join("|");

        /*
         * Reported when it CHANGES, rather than on every frame. A render runs
         * on every pointermove during a drag, and the same broken feature would
         * otherwise log continuously.
         */
        if (signature === lastRenderFailureSignature) {
            return;
        }

        lastRenderFailureSignature = signature;

        failures.forEach(failure => {
            enggErrorLog.reportError(
                "render feature",
                failure.error,
                { featureId: failure.id, featureType: failure.type }
            );
        });
    }

    function renderDrawing(
        state,
        canvas
    ) {
        if (!canvas) {
            return;
        }

        /*
         * THE ZOOM THIS FRAME IS DRAWN AT, recorded once so every font scale
         * in the whole pass agrees - see the note on `activeZoom`.
         */
        activeZoom = Number(state?.camera?.zoom) || 1;

        /*
         * AND THE THEME THIS FRAME IS PAINTED IN.
         *
         * Read from the document element, which is where `theme.js` records the
         * active theme - so the canvas resolves the SAME theme the interface is
         * showing, rather than keeping a second copy that could disagree. It is
         * captured per render rather than per feature, so every stroke in one
         * frame is resolved against one theme and a mid-render switch cannot
         * produce a sheet that is half light and half dark.
         *
         * This is also what makes the theme change take effect on the canvas: a
         * redraw re-reads the attribute, so the new theme is picked up without
         * anything having to notify the renderer.
         */
        activeTheme = enggCanvasPalette.activeCanvasTheme();

        const svg =
            ensureSvg(canvas);

        while (
            svg.firstChild
        ) {
            svg.removeChild(
                svg.firstChild
            );
        }

        const bounds =
            canvas.getBoundingClientRect();

        renderEngineeringGrid(svg, state, bounds);

        /*
         * Committed geometry
         *
         * EVERY FEATURE IS DRAWN IN ITS OWN TRY, AND A FAILURE IN ONE DOES
         * NOT STOP THE OTHERS.
         *
         * A drawing is a set of independent features, but the renderer draws
         * them in one pass - so an exception anywhere used to abandon the whole
         * repaint and leave a blank or half-drawn canvas, which is the moment a
         * student most fears their work is gone. The feature that failed is
         * almost never the only thing on the sheet.
         *
         * Containing it here keeps the guarantee the rest of the application
         * depends on: the MODEL stays authoritative. The feature that could not
         * be drawn is still in `state.objects`, still selectable, still
         * saveable - only its picture is missing. It is reported once per
         * render so the failure is visible rather than silent, and never
         * deleted.
         */
        const renderFailures = [];

        state.objects.forEach(
            entity => {
                try {
                    appendEntity(
                        svg,
                        entity,
                        state,
                        bounds
                    );
                } catch (error) {
                    renderFailures.push({
                        id: entity && entity.id,
                        type: entity && entity.type,
                        error
                    });
                }
            }
        );

        if (renderFailures.length) {
            reportRenderFailures(renderFailures);
        }

        /*
         * ========================================================
         * THE FEATURE'S OWN LABEL
         * ========================================================
         *
         * A second pass, over the SAME objects, drawing the label a student gave
         * a feature in the Features panel. It is deliberately not drawn inside
         * `appendEntity`: a label sits ON TOP of everything (so a line's label is
         * not clipped by the line), and keeping it in its own pass is what makes
         * "every feature's label" one behaviour rather than a branch per type -
         * which is exactly the branch that was missing for Line and Point.
         */
        state.objects.forEach((entity) => {
            try {
                appendFeatureLabel(svg, entity, state, bounds);
            } catch (error) {
                renderFailures.push({
                    id: entity && entity.id,
                    type: entity && entity.type,
                    error
                });
            }
        });

        /*
         * Live construction preview
         *
         * Must be rendered before snap feedback so that
         * the snap marker remains visually on top.
         */
        const activePreview = state.interaction.preview;
        for (const preview of state.interaction.previewObjects || []) {
            state.interaction.preview = preview;
            renderPreview(svg, state, bounds);
        }
        state.interaction.preview = activePreview;
        renderPreview(svg, state, bounds);

        renderInferenceLine(
            svg,
            state,
            bounds
        );

        /*
         * Snap marker
         */
        renderSnapIndicator(
            svg,
            state,
            bounds
        );

        /*
         * Selection rectangle
         */
        renderSelectionBox(
            svg,
            state,
            bounds
        );

        renderSelectionHandles(svg, state, bounds);
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

        if (geometry.mode === "plot" && equations) {
            peak = equations.peakMagnitude(
                equations.readPlot(geometry)
            );
        } else if (geometry.mode === "sketch") {
            (geometry.sketchElements || []).forEach(element => {
                sketchPointsOf(element).forEach(point => {
                    if (Number.isFinite(point.y)) {
                        peak = Math.max(
                            peak,
                            Math.abs(point.y)
                        );
                    }
                });
            });
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

    const enggDrawingRenderer = {
        renderDrawing,

        /*
         * THE ANALYSIS FRAME'S PUBLIC PARTS.
         *
         * Exposed so the Plot Editor draws its graph through the same
         * constants the canvas does. The editor is a second view of the
         * feature, not a second implementation of it, and the two drifting
         * apart - a different axis length here, a different scale there -
         * would mean the graph the student edited against is not the graph
         * they get.
         */
        ANALYSIS_FRAME,
        ANALYSIS_DIAGRAM_TINTS,
        ANALYSIS_DIAGRAM_AXES,
        analysisFrameExtents,
        analysisPlotMarks,
        analysisValueAt,
        analysisSketchMarks,
        equationLabels
    };

export default enggDrawingRenderer;
