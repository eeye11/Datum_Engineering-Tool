/*
 * Editor overlays drawn over the sheet: snap markers, inference lines, the
 * selection box and handles, and the grid.
 *
 * Part of the renderer (see renderer.js), split out by concern.
 */
import enggFeatureGeometry from "../geometry/feature-geometry.js";
import { rigidBodyHandles } from "../geometry/feature-handles.js";
import enggDrawingState from "../model/drawing-state.js";
import { axisLabelPositions } from "../geometry/axis-labels.js";
import enggAnnotationModel from "../../features/workspace/model/annotations/annotation-model.js";
import { createSvgElement, paintColour } from "./svg-primitives.js";
import { SVG_NAMESPACE } from "../../features/workspace/constants.js";
import { selectionBounds, selectionCorners } from "../selection/selection-transform.js";
import { cylinderPoint, isPistonCylinder, pistonFraction, stopperFraction } from "../../features/workspace/model/thermodynamics/piston-cylinder.js";


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

        /*
         * A MALFORMED CANDIDATE IS SKIPPED, NOT FATAL.
         *
         * The snap marker is the least important thing on the overlay - grid,
         * preview and the drawing itself are above it in importance - so a
         * candidate with no point must not abort the whole render. It is
         * dropped, the picture survives, and the next pointer move replaces it
         * with a well-formed one.
         */
        if (!candidate.point || !Number.isFinite(Number(candidate.point.x)) ||
            !Number.isFinite(Number(candidate.point.y))) {
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

        /*
         * ========================================================
         * ONE RESOLVER FOR EVERY EDITING HANDLE
         * ========================================================
         *
         * The list is produced by ONE function - the same one the hit test
         * searches - so every handle drawn here can actually be grabbed, and
         * every handle that can be grabbed is drawn here. It is supplied by
         * the editor through `setHandleResolver` rather than imported, so the
         * renderer keeps no dependency on the interaction layer (which would
         * be a cycle: the interaction layer reaches the renderer).
         *
         * The rotation handle is drawn differently from the shape handles: a
         * ring with a turn arrow, joined to the object by a short stem, so it
         * is never mistaken for one of the shape's own control points.
         *
         * A FIXED OBJECT GETS NO HANDLES AT ALL - the resolver returns none
         * for a locked feature - so the lock reads as absolute on the sheet
         * rather than only being enforced when a drag starts.
         */
        state.objects.forEach(object => {
            if (!selected.has(object.id)) return;

            const handles = handleResolver
                ? handleResolver(object)
                : fallbackHandlesFor(object);

            handles.forEach(handle => {
                if (handle.kind === "rotate") {
                    renderRotationHandle(svg, handle, toScreen);
                    return;
                }

                add(handle.point, handle.kind);
            });
        });
    }

    /*
     * The handle list supplied by the editor. Set once at start-up; absent in
     * a render that has no editor behind it (a test or an export), where the
     * small fallback below still draws the defining points.
     */
    let handleResolver = null;

    function setHandleResolver(resolver) {
        handleResolver = typeof resolver === "function" ? resolver : null;
    }

    /*
     * The last-resort handle list, used only when no editor resolver has been
     * supplied. It draws the feature's own defining points - never a guess -
     * so a headless render still shows something truthful and grabbable.
     */
    function fallbackHandlesFor(object) {
        const geometry = object?.geometry || {};

        if (object?.locked === true) {
            return [];
        }

        if (object?.type === "rigid-body") {
            return rigidBodyHandlesForRender(object);
        }

        return enggFeatureGeometry
            .definingPoints(geometry, object?.type)
            .map(point => ({ kind: "handle", point }));
    }

    /*
     * ========================================================
     * THE ROTATION HANDLE
     * ========================================================
     *
     * A stem from the top of the object's bounds out to a compact ring with a
     * turn arrow. It is deliberately NOT a filled dot: shape handles are small
     * centred markers, and this has to read as a different action at a glance.
     *
     * Everything is drawn in SCREEN space, so the ring is the same size at
     * every zoom and the stem is always the same reach. It is editor-only
     * overlay ink - it is emitted by the overlay renderer, which the clean
     * print/export renders do not call, so it can never reach paper or a TikZ
     * file.
     */
    function renderRotationHandle(svg, handle, toScreen) {
        const anchor = toScreen(handle.anchor);
        const centre = toScreen(handle.point);

        const stem = createSvgElement("line", {
            x1: anchor.x,
            y1: anchor.y,
            x2: centre.x,
            y2: centre.y,
            class: "drawing-rotation-handle-stem"
        });

        const ring = createSvgElement("circle", {
            cx: centre.x,
            cy: centre.y,
            r: 7,
            class: "drawing-rotation-handle"
        });

        /*
         * The turn arrow: an arc with a gap at the bottom-right and a small
         * head, drawn inside the ring. It says "this turns" without words.
         */
        const r = 3.6;

        const arrow = createSvgElement("path", {
            d:
                `M ${centre.x + r} ${centre.y} ` +
                `A ${r} ${r} 0 1 1 ${centre.x} ${centre.y - r}`,
            class: "drawing-rotation-handle-arrow"
        });

        const head = createSvgElement("path", {
            d:
                `M ${centre.x} ${centre.y - r} ` +
                `l 2.4 1.2 l -2.4 1.2 z`,
            class: "drawing-rotation-handle-arrowhead"
        });

        svg.append(stem, ring, arrow, head);
    }

export {
    renderSnapMarker,
    renderInferenceLine,
    renderSnapIndicator,
    renderSelectionBox,
    renderEngineeringGrid,
    rigidBodyHandlesForRender,
    renderSelectionHandles,
    renderSelectionOutline,
    setHandleResolver
};

    /*
     * ========================================================
     * THE SELECTION OUTLINE
     * ========================================================
     *
     * The drawing itself is the compiled source's picture, so a selected
     * feature cannot be highlighted by recolouring it - doing so would mean
     * drawing the feature a second time, which is the one thing the Drawing
     * Space no longer does.
     *
     * Instead the selection is an OUTLINE: the feature's own bounds, in the
     * selection colour, drawn in the interaction layer above the picture. It
     * says what is selected without pretending to be part of the drawing, and
     * it cannot reach an export.
     *
     * A single selected feature gets its outline; a multiple selection is
     * already framed by `renderSelectionHandles` as one dashed group box, so
     * only the group box is drawn then.
     */
    function renderSelectionOutline(svg, state, bounds) {
        const selected = new Set(state.selection?.selectedObjectIds || []);

        if (!selected.size) {
            return;
        }

        const toScreen = point => enggDrawingState.engineeringToScreen(point, bounds, state);

        state.objects
            .filter(object => selected.has(object?.id))
            .forEach(object => {
                let frame;

                try {
                    frame = selectionBounds([object], [object.id]);
                } catch {
                    frame = null;
                }

                if (!frame) {
                    return;
                }

                const first = toScreen({ x: frame.minX, y: frame.maxY });
                const last = toScreen({ x: frame.maxX, y: frame.minY });

                const width = Math.max(2, last.x - first.x);
                const height = Math.max(2, last.y - first.y);

                svg.appendChild(createSvgElement("rect", {
                    x: first.x - 3,
                    y: first.y - 3,
                    width: width + 6,
                    height: height + 6,
                    fill: "none",
                    stroke: "#17643b",
                    "stroke-width": 1.2,
                    "stroke-dasharray": "5 3",
                    "pointer-events": "none",
                    "data-selection-outline-for": object.id
                }));
            });
    }

/*
 * ========================================================
 * THE CONSTRUCTION CROSSHAIR
 * ========================================================
 *
 * A thin crosshair at the POINTER, drawn in the interaction overlay, while a
 * construction is actually running.
 *
 * WHY IT IS DRAWN HERE AT ALL.
 *
 * The canvas used to say `cursor: crosshair`, which is the WINDOW SYSTEM's
 * crosshair: full-screen sized on a high-DPI display, unstylable, and painted
 * over everything - the panel, the Source editor, a dialog - for as long as a
 * tool stayed armed. This is the same information at the editor's own scale: two
 * hairline arms, 7 px each, in the tool's colour.
 *
 * WHEN IT IS ABSENT, which matters as much as when it is present:
 *
 *   - no construction running (idle), so selecting, panning, hovering and
 *     clicking the panel all use the normal pointer;
 *   - the pointer is outside the canvas, so nothing is left behind at the last
 *     position;
 *   - a clean render (print, export, a Drawing Reference) never calls this at
 *     all - it is overlay-only, like every other interaction mark.
 *
 * It never takes a click: the SVG is `pointer-events: none`, so the hit test and
 * the tool underneath it see the press, exactly as before.
 */
export function renderCrosshair(svg, state, bounds) {
    const interaction = state.interaction || {};

    /*
     * A CONSTRUCTION IS RUNNING. `phase` moves off "idle" when the first point is
     * placed; `preview` covers the tools that track the pointer before the first
     * click. Both mean the student is placing geometry, which is the only time a
     * crosshair says anything the arrow does not.
     */
    const running = interaction.phase && interaction.phase !== "idle";
    const tracking = Boolean(interaction.preview) || Boolean(interaction.snapCandidate);

    if (!running && !tracking) {
        return;
    }

    const point = interaction.rawPointerPoint || interaction.snapCandidate?.point;

    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        return;
    }

    const screen = enggDrawingState.engineeringToScreen(point, bounds, state);

    /*
     * INSIDE THE CANVAS, OR NOTHING. A crosshair at the edge is the pointer
     * having left through it; drawing one there would leave a mark behind on the
     * sheet after the student moved to the panel.
     */
    if (screen.x < 0 || screen.y < 0 || screen.x > bounds.width || screen.y > bounds.height) {
        return;
    }

    const arm = 7;
    const group = document.createElementNS(SVG_NAMESPACE, "g");

    group.setAttribute("class", "drawing-crosshair");
    group.setAttribute("pointer-events", "none");
    group.setAttribute("data-editor-only", "crosshair");

    [
        [screen.x - arm, screen.y, screen.x + arm, screen.y],
        [screen.x, screen.y - arm, screen.x, screen.y + arm]
    ].forEach(([x1, y1, x2, y2]) => {
        const line = document.createElementNS(SVG_NAMESPACE, "line");

        line.setAttribute("x1", String(x1));
        line.setAttribute("y1", String(y1));
        line.setAttribute("x2", String(x2));
        line.setAttribute("y2", String(y2));
        line.setAttribute("stroke", "#00a9c7");
        line.setAttribute("stroke-width", "1");
        line.setAttribute("vector-effect", "non-scaling-stroke");
        line.setAttribute("pointer-events", "none");

        group.appendChild(line);
    });

    svg.appendChild(group);
}
