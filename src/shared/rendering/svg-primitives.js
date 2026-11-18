/*
 * The drawing primitives every part of the renderer shares: SVG element
 * creation, zoom-aware text and stroke sizes, line styles, and the zoom and
 * theme of the draw in progress.
 *
 * Part of the renderer (see renderer.js), split out by concern.
 */
import enggTheme from "../../components/layout/workspace/theme.js";
import enggCanvasPalette from "./canvas-palette.js";
import enggMathExpression from "../typography/math-expression.js";
import {
    DEFAULT_CANVAS_FONT_PX,
    SCRIPT_SCALE,
    normaliseFontSize,
    setTextTransform
} from "../typography/canvas-typography.js";
import { BASE_PIXELS_PER_UNIT } from "../typography/canvas-typography.js";


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
     * features, dimension text, the diagram axis labels
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
     * A CANVAS FONT SIZE IS A SCREEN SIZE, AND IT IS VALIDATED HERE.
     *
     * The size a label states is what it measures on the monitor - see
     * `shared/typography/canvas-typography.js`. It is never multiplied by the
     * zoom, because `textNode` cancels the camera on the glyphs instead. This
     * function is the one place a size is made safe: an object written before
     * the typography system may carry no size at all, a zero, a string, or a
     * negative, and every one of those resolves to the shared 16 px default
     * rather than to an attribute the browser refuses.
     *
     * (It used to multiply by `sqrt(zoom)` so text "responded" to the viewport.
     * That made a label grow by `zoom * sqrt(zoom)` while the drawing grew by
     * `zoom`, so the annotation drifted out of proportion as the student
     * zoomed - and the exported figure, which states a fixed physical size,
     * disagreed with the screen. The camera - or, now, its compensation - is
     * the only thing a zoom changes.)
     */
    function zoomedFont(base) {
        return normaliseFontSize(base, DEFAULT_CANVAS_FONT_PX).size;
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
        return zoomedFont(base);
    }

    /*
     * ========================================================
     * THE ONE WAY CANVAS TEXT IS DRAWN
     * ========================================================
     *
     * THE NODE IS SCALED BY THE CAMERA AND THEN DIVIDED BACK OUT.
     *
     * A `<text>` inside the overlay inherits the camera, so a plain
     * `font-size="16"` is sixteen DRAWING units and grows with the zoom. This
     * emits `font-size = 16 * zoom` together with `transform = scale(1 / zoom)`
     * anchored on the text's own point, so what reaches the screen is exactly
     * sixteen pixels - at 25%, at 100% and at 400% - while the POSITION is
     * still the projected drawing position. See `textTransform` in
     * `canvas-typography.js` for why the transform is anchored rather than
     * applied about the SVG origin.
     *
     * WHY A FUNCTION AND NOT TWELVE MORE `setAttribute` CALLS. Every painter
     * that puts words on the sheet goes through here, so "canvas text does not
     * scale with the zoom" is ONE rule that holds for notes, dimensions, tick
     * numbers, equations, symbols and feature labels alike - instead of a
     * property each painter has to remember. It also keeps the attribute
     * writer honest: a computed attribute name would have to be spelled
     * `["font-size"]`, and a quoted key in some builds is WHATWG-mapped onto a
     * DOM property instead of being written as an attribute.
     *
     * The caller still owns the CONTENT, the colour, the alignment and any
     * rotation: this only decides the TYPE.
     */
    function textNode(svg, at, content, options = {}) {
        const zoom =
            options.zoom !== undefined && options.zoom !== null
                ? Number(options.zoom) || 1
                : Number(activeZoom) || 1;

        const size = zoomedFont(
            options.size ?? DEFAULT_CANVAS_FONT_PX
        );

        const node = createSvgElement("text", {
            x: at?.x,
            y: at?.y
        });

        if (options.fill !== undefined && options.fill !== null) {
            node.setAttribute("fill", options.fill);
        }

        if (options.className) {
            node.setAttribute("class", options.className);
        }

        const view = zoom > 0 ? zoom : 1;

        const attributes = {
            "font-size": Math.round(size * view * 1000) / 1000,
            "font-family": options.fontFamily || undefined,
            "font-weight": options.fontWeight || undefined,
            "font-style": options.fontStyle || undefined,
            "text-anchor": options.anchor || undefined,
            "dominant-baseline": options.baseline || undefined,
            "text-decoration": options.textDecoration || undefined
        };

        Object.entries(attributes).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
                node.setAttribute(key, String(value));
            }
        });

        /*
         * THE TRANSFORM IS SET OR CLEARED, NEVER WRITTEN AS "null".
         *
         * At 1:1 there is no compensation to apply, so there is no transform -
         * and a node built by an earlier frame may still be carrying one. The
         * helper removes the attribute in that case rather than storing the
         * word "null", which the browser refuses as a transform and logs as an
         * error on the sheet.
         */
        setTextTransform(node, at, view, options.transform || "");

        Object.entries(options.extra || {}).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
                node.setAttribute(key, String(value));
            }
        });

        node.textContent = String(content ?? "");

        if (svg) {
            svg.appendChild(node);
        }

        return node;
    }

    /*
     * A MULTI-LINE BLOCK, as `<tspan>` lines off the first.
     *
     * The advance is the SCREEN line height converted into the node's own
     * camera-scaled space, so leading stays constant on screen at every zoom.
     * `parseMath` sends each line through the shared expression typesetter, so
     * `T_1` renders as a real subscript wherever it appears.
     */
    function appendTextLines(node, lines, at, options = {}) {
        const list = Array.isArray(lines)
            ? lines
            : String(lines ?? "").split("\n");

        if (!list.length || !node) {
            return node;
        }

        const zoom =
            options.zoom !== undefined && options.zoom !== null
                ? Number(options.zoom) || 1
                : Number(activeZoom) || 1;

        const size = zoomedFont(options.size ?? DEFAULT_CANVAS_FONT_PX);
        const spacing = Number(options.lineSpacing) > 0 ? Number(options.lineSpacing) : 1.2;
        const advance = Math.round(size * (zoom > 0 ? zoom : 1) * spacing * 1000) / 1000;

        list.forEach((line, index) => {
            if (index === 0) {
                if (options.parseMath === true) {
                    appendMathRuns(node, line, size);
                } else {
                    node.textContent = String(line ?? "");
                }

                return;
            }

            const span = createSvgElement("tspan", {
                x: at?.x,
                dy: advance
            });

            if (options.parseMath === true) {
                appendMathRuns(span, line, size);
            } else {
                span.textContent = String(line ?? "");
            }

            node.appendChild(span);
        });

        return node;
    }

    /*
     * AN EXPRESSION AS RUNS - the one typesetter the canvas has.
     *
     * `T_1`, `q''_{in}` and `\dot{Q}` are mathematics wherever they appear, so
     * a note, a label and a Heat notation all come through here. A script keeps
     * `SCRIPT_SCALE` of its base as a PERCENTAGE, which is a fraction of a
     * camera-scaled size and therefore stays camera-scaled itself - the
     * compensation reaches the small glyphs too.
     */
    function appendMathRuns(node, expression, size) {
        void size;

        const runs = enggMathExpression.parseMathExpression(expression);

        if (!runs.length || !node) {
            return node;
        }

        const scriptSize = `${Math.round(SCRIPT_SCALE * 100)}%`;

        runs.forEach((run) => {
            if (run.type === "text") {
                node.appendChild(globalThis.document.createTextNode(run.value));
                return;
            }

            if (run.type === "accent") {
                node.appendChild(globalThis.document.createTextNode(run.value + run.accent));
                return;
            }

            const script = createSvgElement("tspan", {
                "baseline-shift": run.type === "sub" ? "sub" : "super",
                "font-size": scriptSize,
                dy: run.type === "sub" ? "0.15em" : "-0.35em"
            });

            script.textContent = run.value;
            node.appendChild(script);
        });

        return node;
    }

    function createSvgElement(type, attributes = {}) {
        const element =
            globalThis.document.createElementNS(
                SVG_NAMESPACE,
                type
            );

        Object.entries(attributes).forEach(
            ([key, value]) => {
                /*
                 * AN UNRESOLVED COORDINATE IS OMITTED, NOT WRITTEN.
                 *
                 * `setAttribute(key, undefined)` stores the STRING 'undefined',
                 * which a shape's cy then reads back as - a visible, wrong
                 * coordinate drawn at the sheet's origin. A value that could
                 * not be resolved leaves the attribute absent, which is both
                 * honest (no attribute = no value) and what the test for this
                 * regression asks for.
                 */
                if (value === undefined || value === null) {
                    return;
                }

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
                globalThis.document.createElementNS(
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
     * ========================================================
     * ONE CONVERSION FROM THE DRAWING TO THE SHEET
     * ========================================================
     *
     * Every painter draws into the overlay in SCREEN pixels: its geometry has
     * already been projected by `engineeringToScreen`, so a point ten drawing
     * units away from another is ten times the camera scale away on the sheet.
     * A size that is a property of the OBJECT - a radius, a symbol's reach, an
     * arrow's head, a dash length, a pen - is therefore wrong if it is written
     * in the same units, because it would stay the same size while the geometry
     * around it grew.
     *
     * THE OBJECT'S OWN SIZE MUST BE MULTIPLIED BY THE SAME SCALE THE GEOMETRY
     * WENT THROUGH. That is what `worldLength` is: the ONE place a length that
     * belongs to the drawing becomes the pixels the overlay needs. It is the
     * same number for every painter, at every zoom, so a support, an arrowhead
     * and a circle drawn to the same millimetres are the same size on the sheet.
     *
     * THE MISTAKE THIS REPLACES was to write such a size as a bare number and
     * then correct it, in some painters and not others, by a private `* zoom`
     * (or by dividing a stroke back through the zoom, which is the opposite
     * direction). Six renderers each carried their own version of that
     * correction, so a symbol could be right in one tool and half-size in the
     * next - and the ones that had no correction at all were right at 100% and
     * wrong everywhere else, which is exactly the inconsistency this replaces.
     */ 

    /*
     * A STROKE WIDTH IS THE DRAWING'S, NOT THE VIEWPORT'S.
     *
     * Read by the styled line, by applyStyle, and by the force arrow,
     * so a force shaft and a Line of the same weight are the same
     * width - which is what "the force is as thick as the line" has to
     * mean if it is to be true on screen and not only in the settings.
     *
     * WHY THE ZOOM IS DIVIDED BACK OUT.
     *
     * The caller projects the geometry through the camera, so `stroke-width`
     * is read in PIXELS of the overlay's own viewBox - and every point of that
     * pixels is drawn `zoom` times larger on screen. A width emitted here is
     * therefore painted `zoom` times wider (or thinner, when zoomed out) than
     * it states, which is a stroke that changes weight with the camera.
     *
     * Dividing by the zoom in force makes the PAINTED width the stored weight
     * on both sides of the drawing: the canvas at every magnification, and the
     * compiled picture, whose own strokes are written at that same nominal
     * weight (`tikz-style.js`, which owns the calibration). A Line does not
     * become four times thicker because the student zoomed in to place it.
     *
     * THE FLOOR IS A WORLD-SPACE FLOOR TOO. `STROKE_MIN` is the smallest
     * painted width, so at 25% it is four times the stored width - keeping a
     * hairline visible as the drawing shrinks, exactly as the note above says,
     * without it becoming a frame around a zoomed-out sheet.
     */
    /*
     * A PEN KEEPS ITS STATED WEIGHT ON THE SHEET, AT EVERY MAGNIFICATION.
     *
     * `STROKE_SCALE` converts the model's line weight into the drawing's own
     * pixels - 0.5 mm becomes 1.2 of them - and that number is the weight the
     * source states and the compiled picture draws. A stroke is read in the
     * OVERLAY's pixels, which the camera then paints `zoom` times over, so the
     * zoom is DIVIDED out: the painted width is then the stated weight at 25%,
     * at 100% and at 400%, exactly as the Features panel says.
     *
     * WITHOUT THE DIVISION a line thickened with the camera - six times its
     * weight at 400% - so a drawing's pens no longer matched the figure it
     * compiles to, and the same beam looked like a different line at every zoom.
     *
     * THE FLOOR IS A WORLD FLOOR. `STROKE_MIN` is the smallest painted width, so
     * a hairline stays visible when the drawing is zoomed far out, without the
     * floor itself becoming a frame around a zoomed-out sheet.
     */
    function scaledStrokeWidth(lineWidth) {
        const width = Number.isFinite(lineWidth)
            ? lineWidth
            : 0.5;

        const zoom = Number(activeZoom) > 0 ? Number(activeZoom) : 1;

        return Math.max(STROKE_MIN, width * STROKE_SCALE) / zoom;
    }

    /*
     * A length that belongs to the drawing, in the pixels the overlay
     * needs for it at the zoom being drawn.
     *
     * `activeZoom` is set once per pass from the camera that pass was given, so
     * this cannot describe a zoom other than the one on screen - and because
     * every painter asks HERE, no painter can apply the conversion twice or
     * forget it.
     *
     * WHAT IT IS FOR, EXACTLY: a WORLD length - a symbol's reach, a radius, a
     * dash - becoming overlay pixels. NOT for a stroke, which
     * `scaledStrokeWidth` already states in the drawing's own pixels.
     */
    function worldLength(units) {
        const length = Number(units);

        if (!Number.isFinite(length)) {
            return 0;
        }

        return length * (Number(activeZoom) > 0 ? Number(activeZoom) : 1);
    }

    /*
     * THE CAMERA'S SCALE, IN OVERLAY PIXELS PER DRAWING UNIT.
     *
     * One drawing unit is ONE OF THESE at the current zoom, which is what
     * `engineeringToScreen` multiplies by - so a world size converts with THIS
     * number, not with the bare zoom. Using the zoom alone made every converted
     * length 2.4 times out at 100% and, worse, made a symbol's size disagree with
     * the scale its own geometry had been projected through.
     *
     * `activeZoom` is the camera the pass was drawn with, so this cannot describe
     * a view other than the one on screen.
     */
    function cameraScale() {
        const zoom = Number(activeZoom) > 0 ? Number(activeZoom) : 1;

        return BASE_PIXELS_PER_UNIT * zoom;
    }

    /*
     * A LENGTH THAT IS PART OF A PATH rather than of the camera: the dash
     * pattern a styled line is painted with.
     *
     * A dash is a mark in the drawing - the same number of millimetres between
     * strokes on a beam however far the student has zoomed - so it goes through
     * the same conversion as every other world length. It used to be emitted as
     * a bare `"8 5"`, which is eight OVERLAY pixels: on a drawing zoomed to 25%
     * the dashes closed up into a solid line, and at 400% a dashed line became
     * a handful of long strokes, while the compiled picture kept the authored
     * gap because TikZ states it in the drawing's own unit.
     */
    function dashArrayFor(pattern) {
        if (!pattern) {
            return null;
        }

        const lengths = String(pattern)
            .trim()
            .split(/[\s,]+/)
            .filter(Boolean)
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value) && value >= 0);

        if (!lengths.length) {
            return null;
        }

        return lengths.map((value) => round3(worldLength(value))).join(" ");
    }

    function round3(value) {
        return Math.round(Number(value) * 1000) / 1000;
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

        if (style.fillMode === "solid" && style.fillOpacityEnabled === true) {
            element.setAttribute("fill-opacity", "0.35");
        }

        element.setAttribute(
            "stroke-width",
            scaledStrokeWidth(lineWidth)
        );

        if (Number.isFinite(style.fillOpacity)) {
            element.setAttribute("fill-opacity", Math.max(0, Math.min(1, style.fillOpacity)));
        }

        if (
            style.opacity != null
        ) {
            element.setAttribute(
                "opacity",
                style.opacity
            );
        }

        /*
         * A DASH PATTERN IS THE DRAWING'S TOO, so it is converted by the same
         * one function as every other world length. Written as bare numbers it
         * was a handful of OVERLAY pixels: eight at 100%, eight at 400%, and at
         * 25% so short that a dashed line read as solid.
         */
        const dash = dashArrayFor(dashPatternFor(style.lineType));

        if (dash) {
            element.setAttribute("stroke-dasharray", dash);
        }

        if (style.lineType === "dotted") {
            element.setAttribute("stroke-linecap", "round");
        }

        if (
            style.lineType ===
            "construction"
        ) {

            element.setAttribute(
                "opacity",
                "0.65"
            );
        }
    }

    /*
     * The zoom and theme of the draw in progress are set by renderDrawing
     * (renderer.js). An imported binding is read-only, so it writes them here.
     */
    function setActiveZoom(zoom) {
        activeZoom = zoom;
    }

    function setActiveTheme(theme) {
        activeTheme = theme;
    }

/*
 * ONLY NAMES THIS MODULE DECLARES. `TEXT_SCALE_MIN`, `TEXT_SCALE_MAX`,
 * `textScale`, `FONT_PX_MIN` and `FONT_PX_MAX` were the old zoom-multiplier
 * constants: a stored size used to be multiplied by `sqrt(zoom)` and clamped
 * between them. Text is now painted at its stored size - see `zoomedFont` - so
 * the constants went, and their names were left behind in the list below. A
 * name in an `export { }` clause that the module does not declare is a MODULE
 * LOAD ERROR in ES modules, so the whole renderer failed to load and every
 * test that boots the application failed with it.
 *
 * THE LIST IS KEPT FLAT - one name per line, no comments between the names -
 * because the module-export check reads it as text.
 */
export {
    SVG_NAMESPACE,
    LABEL_OFFSET_PX,
    activeZoom,
    activeTheme,
    paintColour,
    zoomedFont,
    zoomedFontHere,
    textNode,
    appendTextLines,
    appendMathRuns,
    createSvgElement,
    arcPathData,
    ensureSvg,
    dashPatternFor,
    styledLine,
    STROKE_SCALE,
    STROKE_MIN,
    scaledStrokeWidth,
    worldLength,
    cameraScale,
    dashArrayFor,
    applyStyle,
    setActiveZoom,
    setActiveTheme
};
