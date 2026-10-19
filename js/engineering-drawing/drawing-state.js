/* Central source of truth for structured engineering drawings. */
(function () {
    const BASE_PIXELS_PER_UNIT = 2.4;

    function createDrawingState() {
        return {
            version: 1,
            units: "mm",
            objects: [],
            camera: {
                zoom: 1,
                panX: 0,
                panY: 0
            },
            grid: {
                visible: true,
                spacing: 5
            },
            snap: {
                enabled: true,
                spacing: 1
            },
            objectSnap: {
                enabled: true,
                tolerancePx: 10
            },
            styleDefaults: {
                stroke: "#000000",
                fill: "none",
                lineWidth: 0.5,
                lineType: "solid",
                opacity: 1
            },
            activeTool: null,
            interaction: {
                preview: null,
                phase: "idle",
                startPoint: null,
                currentPoint: null,
                rawPointerPoint: null,
                snappedPoint: null,
                inferredPoint: null,
                effectiveConstructionPoint: null,
                snapCandidate: null,
                hoveredEntity: null,
                inference: null,
                selectionStart: null,
                selectionCurrent: null,
                selectionBox: null,
                selectionDragging: false
                ,points: []
            },
            selection: {
                selectedObjectIds: [],
                boxSelectionIds: [],
                hoveredObjectId: null
            },
            history: {
                past: [],
                future: []
            }
        };
    }

    function createStyle(overrides = {}) {
        return {
            stroke: "#000000",
            fill: "none",
            lineWidth: 0.5,
            lineType: "solid",
            opacity: 1,
            ...overrides
        };
    }

    function createGeometryObject(type, geometry, options = {}) {
        const generatedId = globalThis.crypto && typeof globalThis.crypto.randomUUID === "function"
            ? globalThis.crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

        const typeLabel = {
            line: "Line",
            polyline: "Polyline",
            circle: "Circle",
            arc: "Arc",
            rectangle: "Rectangle"
        }[type] || type;

        return {
            id: options.id || `${type}-${generatedId}`,
            name: options.name || typeLabel,
            type,
            geometry,
            style: createStyle(options.style),
            metadata: options.metadata || {},
            engineering: options.engineering || undefined
        };
    }

    const geometryFactories = {
        line: (start, end, options) => createGeometryObject("line", { start, end }, options),
        polyline: (points, options) => createGeometryObject("polyline", { points }, options),
        circle: (center, radius, options) => createGeometryObject("circle", { center, radius }, options),
        arc: (center, radius, startAngle, endAngle, options) => createGeometryObject("arc", {
            center,
            radius,
            startAngle,
            endAngle
        }, options),
        rectangle: (position, width, height, rotation = 0, options) => createGeometryObject("rectangle", {
            position,
            width,
            height,
            rotation
        }, options)
    };

    function addObject(state, object) {
        const baseName = object.name;
        const nameIndex = state.objects.filter(candidate => candidate.type === object.type).length + 1;
        object.name = baseName.match(/\d+$/) ? baseName : `${baseName} ${nameIndex}`;
        state.objects.push(object);
        return object.id;
    }

    function removeObject(state, objectId) {
        state.objects = state.objects.filter(object => object.id !== objectId);
        state.selection.selectedObjectIds = state.selection.selectedObjectIds.filter(id => id !== objectId);
    }

    function selectObjects(state, objectIds) {
        state.selection.selectedObjectIds = [...new Set(objectIds)];
    }

    function selectObject(state, objectId) {
        selectObjects(state, [objectId]);
    }

    function clearSelection(state) {
        state.selection.selectedObjectIds = [];
    }

    function cloneObjects(objects) {
        return JSON.parse(JSON.stringify(objects));
    }

    function snapshotDrawing(state) {
        return cloneObjects(state.objects);
    }

    function commitDrawingChange(state, previousObjects) {
        state.history.past.push(cloneObjects(previousObjects));
        state.history.future = [];
    }

    function restoreObjects(state, objects) {
        state.objects = cloneObjects(objects);
        const existingIds = new Set(state.objects.map(object => object.id));
        state.selection.selectedObjectIds = state.selection.selectedObjectIds.filter(id => existingIds.has(id));
        clearInteraction(state);
    }

    function canUndo(state) {
        return state.history.past.length > 0;
    }

    function canRedo(state) {
        return state.history.future.length > 0;
    }

    function undo(state) {
        if (!canUndo(state)) return false;
        state.history.future.push(snapshotDrawing(state));
        restoreObjects(state, state.history.past.pop());
        return true;
    }

    function redo(state) {
        if (!canRedo(state)) return false;
        state.history.past.push(snapshotDrawing(state));
        restoreObjects(state, state.history.future.pop());
        return true;
    }

    function setActiveTool(state, toolId) {
        state.activeTool = toolId;
        clearInteraction(state);
    }

    function clearInteraction(state) {
        state.interaction.preview = null;
        state.interaction.phase = "idle";
        state.interaction.startPoint = null;
        state.interaction.currentPoint = null;
        state.interaction.rawPointerPoint = null;
        state.interaction.snappedPoint = null;
        state.interaction.inferredPoint = null;
        state.interaction.effectiveConstructionPoint = null;
        state.interaction.snapCandidate = null;
        state.interaction.hoveredEntity = null;
        state.interaction.inference = null;
        state.interaction.selectionStart = null;
        state.interaction.selectionCurrent = null;
        state.interaction.selectionBox = null;
        state.interaction.selectionDragging = false;
        state.interaction.points = [];
    }

    function setInteraction(state, interaction) {
        state.interaction = {
            ...state.interaction,
            ...interaction
        };
    }

    function setCameraZoom(state, zoom) {
        state.camera.zoom = Math.min(20, Math.max(0.25, zoom));
    }

    function panCamera(state, panX, panY) {
        state.camera.panX = panX;
        state.camera.panY = panY;
    }

    function snapCoordinate(value, state) {
        if (!state.snap.enabled || state.snap.spacing <= 0) {
            return value;
        }

        return Math.round(value / state.snap.spacing) * state.snap.spacing;
    }

    function engineeringToScreen(point, bounds, state) {
        const scale = BASE_PIXELS_PER_UNIT * state.camera.zoom;
        return {
            x: bounds.width / 2 + (point.x - state.camera.panX) * scale,
            y: bounds.height / 2 - (point.y - state.camera.panY) * scale
        };
    }

    function screenToEngineering(point, bounds, state, shouldSnap = false) {
        const scale = BASE_PIXELS_PER_UNIT * state.camera.zoom;
        const engineeringPoint = {
            x: (point.x - bounds.width / 2) / scale + state.camera.panX,
            y: (bounds.height / 2 - point.y) / scale + state.camera.panY
        };

        if (!shouldSnap) {
            return engineeringPoint;
        }

        return {
            x: snapCoordinate(engineeringPoint.x, state),
            y: snapCoordinate(engineeringPoint.y, state)
        };
    }

    function serializeDrawing(state) {
        return JSON.stringify({
            version: state.version,
            units: state.units,
            camera: { ...state.camera },
            grid: { ...state.grid },
            snap: { ...state.snap },
            objectSnap: { ...state.objectSnap },
            styleDefaults: { ...state.styleDefaults },
            objects: state.objects.map(object => ({
                ...object,
                geometry: JSON.parse(JSON.stringify(object.geometry)),
                style: { ...object.style },
                metadata: { ...object.metadata }
            }))
        }, null, 2);
    }

    window.enggDrawingState = {
        BASE_PIXELS_PER_UNIT,
        createDrawingState,
        createStyle,
        createGeometryObject,
        geometryFactories,
        addObject,
        removeObject,
        selectObjects,
        selectObject,
        clearSelection,
        snapshotDrawing,
        commitDrawingChange,
        canUndo,
        canRedo,
        undo,
        redo,
        setActiveTool,
        clearInteraction,
        setInteraction,
        setCameraZoom,
        panCamera,
        snapCoordinate,
        engineeringToScreen,
        screenToEngineering,
        serializeDrawing
    };
})();
