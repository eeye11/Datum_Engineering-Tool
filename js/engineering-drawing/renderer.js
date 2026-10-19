/* Renderer boundary: visuals read from drawing state, never own drawing data. */
(function () {
    const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

    function ensureSvg(canvas) {
        let svg = canvas.querySelector(".drawing-renderer");

        if (!svg) {
            svg = document.createElementNS(SVG_NAMESPACE, "svg");
            svg.classList.add("drawing-renderer");
            svg.setAttribute("aria-hidden", "true");
            canvas.appendChild(svg);
        }

        return svg;
    }

    function applyStyle(element, style, selected = false, hovered = false, temporarySelected = false) {
        const drawingStyle = style || {};
        element.setAttribute("fill", drawingStyle.fill || "none");
        element.setAttribute(
            "stroke",
            selected
                ? "#17643b"
                : hovered || temporarySelected
                    ? "#00a9c7"
                    : drawingStyle.stroke || "#000000"
        );
        element.setAttribute(
            "stroke-width",
            String(
                (drawingStyle.lineWidth || 0.5) *
                (selected ? 2 : hovered || temporarySelected ? 1.5 : 1.5)
            )
        );
        element.setAttribute("opacity", String(drawingStyle.opacity ?? 1));

        if (drawingStyle.lineType === "dashed") {
            element.setAttribute("stroke-dasharray", "5 3");
        }
    }

    function appendEntity(svg, entity, state, canvas, isPreview = false) {
        if (!entity || !entity.geometry) {
            return;
        }

        const bounds = {
            width: canvas.clientWidth,
            height: canvas.clientHeight
        };

        const selected =
            !isPreview &&
            state.selection.selectedObjectIds.includes(entity.id);

        const temporarySelected =
            !isPreview &&
            state.selection.boxSelectionIds?.includes(entity.id);

        const hovered =
            !isPreview &&
            state.interaction.hoveredEntity === entity.id;

        const geometry = entity.geometry;
        let element;

        if (entity.type === "line") {
            const start = enggDrawingState.engineeringToScreen(
                geometry.start,
                bounds,
                state
            );

            const end = enggDrawingState.engineeringToScreen(
                geometry.end,
                bounds,
                state
            );

            element = document.createElementNS(SVG_NAMESPACE, "line");
            element.setAttribute("x1", start.x);
            element.setAttribute("y1", start.y);
            element.setAttribute("x2", end.x);
            element.setAttribute("y2", end.y);

        } else if (entity.type === "circle") {
            const center = enggDrawingState.engineeringToScreen(
                geometry.center,
                bounds,
                state
            );

            element = document.createElementNS(SVG_NAMESPACE, "circle");
            element.setAttribute("cx", center.x);
            element.setAttribute("cy", center.y);
            element.setAttribute(
                "r",
                geometry.radius *
                    enggDrawingState.BASE_PIXELS_PER_UNIT *
                    state.camera.zoom
            );

        } else if (entity.type === "rectangle") {
            /*
             * Rectangle geometry is stored using:
             * position = top-left engineering corner
             * width    = positive X dimension
             * height   = positive Y dimension
             *
             * Because engineering Y increases upward while SVG Y
             * increases downward, calculate both engineering corners
             * and convert them independently.
             */

            const topLeftEngineering = {
                x: geometry.position.x,
                y: geometry.position.y
            };

            const bottomRightEngineering = {
                x: geometry.position.x + geometry.width,
                y: geometry.position.y - geometry.height
            };

            const topLeft = enggDrawingState.engineeringToScreen(
                topLeftEngineering,
                bounds,
                state
            );

            const bottomRight = enggDrawingState.engineeringToScreen(
                bottomRightEngineering,
                bounds,
                state
            );

            element = document.createElementNS(SVG_NAMESPACE, "rect");

            element.setAttribute(
                "x",
                Math.min(topLeft.x, bottomRight.x)
            );

            element.setAttribute(
                "y",
                Math.min(topLeft.y, bottomRight.y)
            );

            element.setAttribute(
                "width",
                Math.abs(bottomRight.x - topLeft.x)
            );

            element.setAttribute(
                "height",
                Math.abs(bottomRight.y - topLeft.y)
            );

            if (geometry.rotation) {
                const centerX = (topLeft.x + bottomRight.x) / 2;
                const centerY = (topLeft.y + bottomRight.y) / 2;

                element.setAttribute(
                    "transform",
                    `rotate(${-geometry.rotation} ${centerX} ${centerY})`
                );
            }

        } else if (entity.type === "polyline") {
            element = document.createElementNS(
                SVG_NAMESPACE,
                "polyline"
            );

            element.setAttribute(
                "points",
                geometry.points
                    .map(point => {
                        const screenPoint =
                            enggDrawingState.engineeringToScreen(
                                point,
                                bounds,
                                state
                            );

                        return `${screenPoint.x},${screenPoint.y}`;
                    })
                    .join(" ")
            );

        } else if (entity.type === "arc") {
            const scale =
                enggDrawingState.BASE_PIXELS_PER_UNIT *
                state.camera.zoom;

            const start = {
                x:
                    geometry.center.x +
                    Math.cos(geometry.startAngle) *
                        geometry.radius,
                y:
                    geometry.center.y +
                    Math.sin(geometry.startAngle) *
                        geometry.radius
            };

            const end = {
                x:
                    geometry.center.x +
                    Math.cos(geometry.endAngle) *
                        geometry.radius,
                y:
                    geometry.center.y +
                    Math.sin(geometry.endAngle) *
                        geometry.radius
            };

            const screenStart =
                enggDrawingState.engineeringToScreen(
                    start,
                    bounds,
                    state
                );

            const screenEnd =
                enggDrawingState.engineeringToScreen(
                    end,
                    bounds,
                    state
                );

            const largeArc =
                Math.abs(
                    geometry.endAngle - geometry.startAngle
                ) > Math.PI
                    ? 1
                    : 0;

            const sweep =
                geometry.endAngle > geometry.startAngle
                    ? 0
                    : 1;

            element = document.createElementNS(
                SVG_NAMESPACE,
                "path"
            );

            element.setAttribute(
                "d",
                `M ${screenStart.x} ${screenStart.y} A ${
                    geometry.radius * scale
                } ${geometry.radius * scale} 0 ${largeArc} ${sweep} ${
                    screenEnd.x
                } ${screenEnd.y}`
            );
        }

        if (!element) {
            return;
        }

        applyStyle(
            element,
            entity.style,
            selected,
            hovered,
            temporarySelected
        );

        if (isPreview) {
            element.setAttribute(
                "stroke-dasharray",
                "4 3"
            );
            element.setAttribute(
                "opacity",
                "0.7"
            );
        }

        svg.appendChild(element);
    }

    function renderSnapIndicator(svg, state, canvas) {
        const candidate = state.interaction.snapCandidate;

        if (
            !candidate ||
            ![
                "line",
                "polyline",
                "circle",
                "arc",
                "rectangle",
                "construction"
            ].includes(state.activeTool)
        ) {
            return;
        }

        const bounds = {
            width: canvas.clientWidth,
            height: canvas.clientHeight
        };

        const screenPoint =
            enggDrawingState.engineeringToScreen(
                candidate.point,
                bounds,
                state
            );

        const group = document.createElementNS(
            SVG_NAMESPACE,
            "g"
        );

        group.classList.add(
            "drawing-snap-indicator"
        );

        group.setAttribute(
            "transform",
            `translate(${screenPoint.x} ${screenPoint.y})`
        );

        let marker;

        if (candidate.type === "endpoint") {
            marker = document.createElementNS(
                SVG_NAMESPACE,
                "rect"
            );

            marker.setAttribute("x", "-4");
            marker.setAttribute("y", "-4");
            marker.setAttribute("width", "8");
            marker.setAttribute("height", "8");

        } else if (candidate.type === "midpoint") {
            marker = document.createElementNS(
                SVG_NAMESPACE,
                "path"
            );

            marker.setAttribute(
                "d",
                "M 0 -5 L 5 4 L -5 4 Z"
            );

        } else if (candidate.type === "center") {
            marker = document.createElementNS(
                SVG_NAMESPACE,
                "circle"
            );

            marker.setAttribute("r", "4");

        } else {
            marker = document.createElementNS(
                SVG_NAMESPACE,
                "path"
            );

            marker.setAttribute(
                "d",
                "M 0 -5 L 5 0 L 0 5 L -5 0 Z"
            );
        }

        marker.setAttribute(
            "class",
            "drawing-snap-marker"
        );

        group.appendChild(marker);

        const label = document.createElementNS(
            SVG_NAMESPACE,
            "text"
        );

        label.classList.add(
            "drawing-snap-label"
        );

        label.setAttribute("x", "8");
        label.setAttribute("y", "-7");

        label.textContent =
            candidate.type === "pointOnEntity"
                ? `Point on ${candidate.objectId.split("-")[0]}`
                : candidate.type[0].toUpperCase() +
                  candidate.type.slice(1);

        group.appendChild(label);
        svg.appendChild(group);
    }

    function renderSelectionBox(svg, state, canvas) {
        const box = state.interaction.selectionBox;

        if (!box || !state.interaction.selectionDragging) {
            return;
        }

        const bounds = {
            width: canvas.clientWidth,
            height: canvas.clientHeight
        };

        const start =
            enggDrawingState.engineeringToScreen(
                box.start,
                bounds,
                state
            );

        const end =
            enggDrawingState.engineeringToScreen(
                box.end,
                bounds,
                state
            );

        const selection = document.createElementNS(
            SVG_NAMESPACE,
            "rect"
        );

        selection.classList.add(
            "drawing-selection-box"
        );

        selection.setAttribute(
            "x",
            Math.min(start.x, end.x)
        );

        selection.setAttribute(
            "y",
            Math.min(start.y, end.y)
        );

        selection.setAttribute(
            "width",
            Math.abs(end.x - start.x)
        );

        selection.setAttribute(
            "height",
            Math.abs(end.y - start.y)
        );

        svg.appendChild(selection);
    }

    function renderDrawing(state, canvas) {
        if (!canvas) {
            return;
        }

        const svg = ensureSvg(canvas);

        svg.replaceChildren();

        svg.setAttribute(
            "viewBox",
            `0 0 ${canvas.clientWidth} ${canvas.clientHeight}`
        );

        state.objects.forEach(object =>
            appendEntity(
                svg,
                object,
                state,
                canvas
            )
        );

        appendEntity(
            svg,
            state.interaction.preview,
            state,
            canvas,
            true
        );

        renderSnapIndicator(
            svg,
            state,
            canvas
        );

        renderSelectionBox(
            svg,
            state,
            canvas
        );

        canvas.dataset.objectCount =
            String(state.objects.length);

        canvas.dataset.zoom =
            String(state.camera.zoom);

        canvas.dataset.panX =
            String(state.camera.panX);

        canvas.dataset.panY =
            String(state.camera.panY);
    }

    window.enggDrawingRenderer = {
        renderDrawing
    };
})();