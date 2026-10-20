/*
 * The live preview of a tool in use, before anything is committed.
 *
 * Part of the renderer (see renderer.js), split out by concern.
 */
import enggFeatureGeometry from "../geometry/feature-geometry.js";
import { trussJoints } from "../geometry/feature-handles.js";
import enggMeasurement from "../geometry/measurement-core.js";
import enggDrawingState from "../model/drawing-state.js";
import enggAnnotationModel from "../../features/workspace/model/annotations/annotation-model.js";
import { arcPathData, createSvgElement, paintColour } from "./svg-primitives.js";
import { appendDimensionEntity } from "./dimension-render.js";
import { appendAnnotateEntity, appendAnnotationEntity } from "./annotation-render.js";
import { appendCoordinateSystem } from "./symbol-render.js";
import { appendEntity } from "./entity-render.js";
import { isProcessDiagram } from "../../features/workspace/model/thermodynamics/saturation-curve.js";
import { heatTransferTool } from "../../features/workspace/model/thermodynamics/heat-transfer.js";
import enggPipeDuct from "../../features/workspace/model/fluids/pipe-duct.js";


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
        if (isProcessDiagram(state.interaction.preview)) {
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
             * THE PREVIEW IS THE DIMENSION THE PLACEMENT WILL COMMIT.
             *
             * It is built as a `dimension` probe and drawn by the dimension
             * renderer, so the extension lines, the arrows, the value and the
             * placement the student sees are exactly what the finished feature
             * will show.
             */
            const previewDimension = {
                id: "dimension-preview",
                type: "dimension",

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

            appendDimensionEntity(
                previewGroup,
                previewDimension,
                state,
                toScreen,
                previewDimension.style
            );

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
                metadata: state.activeTool === "electric-work" ? { thermodynamicsKind: "electric-work" } : {},
                annotateKind:
                    state.interaction.annotateKind,
                text: "",
                geometry: {
                    start: state.interaction.annotateStart,
                    end: state.interaction.annotateEnd
                },
                style: {
                    stroke: heatTransferTool(state.activeTool)?.colour || "#1f5c38",
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

        /*
         * A PIPE / DUCT SEGMENT BEING ROUTED: its two walls, dashed, from the
         * same `boundaryLines` the committed run is drawn with.
         */
        if (preview.type === "pipe-duct" && geometry.start && geometry.end) {
            enggPipeDuct.boundaryLines(
                geometry.start,
                geometry.end,
                geometry.engineering || preview.engineering || {}
            ).forEach((boundary) => {
                const from = toScreen(boundary.start);
                const to = toScreen(boundary.end);

                svg.appendChild(createSvgElement("line", {
                    x1: from.x,
                    y1: from.y,
                    x2: to.x,
                    y2: to.y,
                    stroke: style.stroke,
                    "stroke-width": 1.5,
                    "stroke-dasharray": "6 4",
                    opacity: style.opacity
                }));
            });

            return;
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

export {
    previewStyle,
    renderPreview,
    STATICS_PREVIEW_TYPES
};
