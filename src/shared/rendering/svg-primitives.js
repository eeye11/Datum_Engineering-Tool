/*
 * The drawing primitives every part of the renderer shares: SVG element
 * creation, zoom-aware text and stroke sizes, line styles, and the zoom and
 * theme of the draw in progress.
 *
 * Part of the renderer (see renderer.js), split out by concern.
 */
import enggTheme from "../../components/layout/workspace/theme.js";
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
            globalThis.document.createElementNS(
                SVG_NAMESPACE,
                type
            );

        Object.entries(attributes).forEach(
            ([key, value]) => {
                /*
                 * AN UNRESOLVED VALUE IS NOT WRITTEN.
                 *
                 * `setAttribute("cx", undefined)` stores the literal string
                 * "undefined", which is not a number: the browser then discards
                 * the element's position (or refuses the whole attribute) with
                 * no error anywhere. A coordinate that could not be resolved is
                 * therefore omitted, so the shape keeps the SVG default and is
                 * visibly wrong rather than silently absent - and a caller's
                 * `null` no longer becomes geometry.
                 */
                if (value === undefined || value === null) {
                    return;
                }

                element.setAttribute(
                    key,
                    String(value)
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
     * The zoom and theme of the draw in progress are set by renderDrawing
     * (renderer.js). An imported binding is read-only, so it writes them here.
     */
    function setActiveZoom(zoom) {
        activeZoom = zoom;
    }

    function setActiveTheme(theme) {
        activeTheme = theme;
    }

export {
    SVG_NAMESPACE,
    LABEL_OFFSET_PX,
    activeZoom,
    activeTheme,
    paintColour,
    TEXT_SCALE_MIN,
    TEXT_SCALE_MAX,
    textScale,
    FONT_PX_MIN,
    FONT_PX_MAX,
    zoomedFont,
    zoomedFontHere,
    createSvgElement,
    arcPathData,
    ensureSvg,
    dashPatternFor,
    styledLine,
    STROKE_SCALE,
    STROKE_MIN,
    scaledStrokeWidth,
    applyStyle,
    setActiveZoom,
    setActiveTheme
};
