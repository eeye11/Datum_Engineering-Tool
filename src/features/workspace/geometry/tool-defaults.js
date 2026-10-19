/*
 * ============================================================
 * TOOL DEFAULTS - THE STARTING SHAPE A GEOMETRY TOOL WILL DRAW
 * ============================================================
 *
 * Two things need exactly the same answer to "what would this tool create right
 * now?":
 *
 *   - the Features tab, when nothing is selected. It edits the ACTIVE TOOL's
 *     construction settings, so it has to show the shape those settings
 *     describe - not a form over a blank canvas.
 *   - any future preview of an unstarted construction.
 *
 * So the answer lives here, once, as data about the tool rather than as markup.
 *
 * SNAPPING IS SHARED, NOT COPIED. Every default point is passed through the
 * same grid snap a drag falls through to (`snapPointToGrid`), so a default
 * preview sits on the lattice and on the same coordinates a committed gesture
 * from the same place would land on. There is no second snapping rule here.
 *
 * SETTINGS ARE THE TOOL'S OWN. The side count, arc method and polygon method
 * come from the tool's `features.json` through the one store
 * (`toolSetting`), so a change in Features reaches the preview and the next
 * creation, and a tool never carries a second copy of its own defaults.
 *
 * NOTHING HERE TOUCHES THE DRAWING. These are previews - temporary objects with
 * their own ids - built by the same geometry factories and from the same shape
 * maths the committed geometry uses, so a preview cannot describe a shape the
 * tool would not actually create.
 */

import enggDrawingSnap from "../../../shared/snapping/object-snap.js";
import { toolSetting } from "../../../components/layout/panels/tool-settings-store.js";
import { drawingState } from "../editor-state.js";
import { COORDINATE_SYSTEM_TYPE } from "../constants.js";
import { arcThroughThreePoints } from "./construction-geometry.js";
import { polygonSideCount } from "./geometry-creation.js";

/*
 * The preview stroke. The same signal colour the construction previews use, so
 * a default preview reads as "a guide, not yet a feature" in either theme.
 */
const PREVIEW_STROKE = "#1f5c38";

/* How large a default shape is drawn, in drawing units. */
const DEFAULT_SPAN = 30;
const DEFAULT_RADIUS = 15;

function preview(type, geometry) {
    return {
        id: `preview-${type}-default`,
        type,
        geometry,
        style: {
            stroke: PREVIEW_STROKE,
            fill: "none",
            lineWidth: 0.5,
            lineType: "dashed",
            opacity: 1
        }
    };
}

function snap(point) {
    return enggDrawingSnap.snapPointToGrid(point, drawingState);
}

/*
 * The two-point span every two-point default is drawn over: centred on the
 * viewport's pan position, so it appears where the student is looking rather
 * than at the drawing's origin - and snapped, so it sits on the grid.
 */
function spanStart() {
    return snap({
        x: (Number(drawingState.camera?.panX) || 0) - DEFAULT_SPAN / 2,
        y: (Number(drawingState.camera?.panY) || 0) - DEFAULT_SPAN / 2
    });
}

function spanEnd() {
    return snap({
        x: (Number(drawingState.camera?.panX) || 0) + DEFAULT_SPAN / 2,
        y: (Number(drawingState.camera?.panY) || 0) + DEFAULT_SPAN / 2
    });
}

/*
 * THE ARC METHOD A NEW ARC WOULD USE.
 *
 * The tool's interaction carries the method while a construction is running;
 * between constructions the method is the one the tool declared, so the
 * default preview shows the arc the next drag would really produce.
 */
export function arcMethod() {
    return drawingState.interaction?.arcMode === "three-point"
        ? "three-point"
        : "centre";
}

export function polygonMethod() {
    return drawingState.interaction?.polygonMode === "sides"
        ? "sides"
        : "centre";
}

export function livePolygonSides() {
    return polygonSideCount({
        polygonSides: toolSetting("polygon", "sides")
    });
}

/* ============================================================
 * THE TOOL -> SHAPE TABLE
 * ============================================================ */

const BUILDERS = {
    point() {
        return preview("point", { position: snap({ x: 0, y: 0 }) });
    },

    line() {
        return preview("line", { start: spanStart(), end: spanEnd() });
    },

    triangle() {
        const start = spanStart();
        const end = spanEnd();

        return preview("triangle", {
            points: [start, end, snap({ x: start.x, y: end.y })],
            closed: true
        });
    },

    rectangle() {
        const start = spanStart();
        const end = spanEnd();

        return preview("rectangle", {
            position: { x: Math.min(start.x, end.x), y: Math.max(start.y, end.y) },
            width: Math.abs(end.x - start.x),
            height: Math.abs(end.y - start.y),
            rotation: 0
        });
    },

    circle() {
        return preview("circle", {
            center: snap({ x: 0, y: 0 }),
            radius: enggDrawingSnap.snapPointToGrid({ x: DEFAULT_RADIUS, y: 0 }, drawingState).x
        });
    },

    arc() {
        const eight = Math.PI / 4;
        const radius = enggDrawingSnap.snapPointToGrid({ x: DEFAULT_RADIUS, y: 0 }, drawingState).x || DEFAULT_RADIUS;

        if (arcMethod() === "three-point") {
            const centre = { x: 0, y: 0 };

            /* Through the quarter point, so the default matches what a third
             * gesture in that direction would produce. */
            const geometry = arcThroughThreePoints(
                { x: centre.x + radius, y: centre.y },
                { x: centre.x + radius * Math.cos(eight), y: centre.y + radius * Math.sin(eight) },
                { x: centre.x, y: centre.y + radius }
            );

            return geometry ? preview("arc", geometry) : null;
        }

        return preview("arc", {
            center: { x: 0, y: 0 },
            radius,
            startAngle: 0,
            endAngle: 90,
            sweep: Math.PI / 2
        });
    },

    polygon() {
        const sides = livePolygonSides();
        const radius = enggDrawingSnap.snapPointToGrid({ x: DEFAULT_RADIUS, y: 0 }, drawingState).x || DEFAULT_RADIUS;

        return preview("polygon", {
            center: { x: 0, y: 0 },
            radius,
            sides,
            rotation: 0
        });
    },

    "freeform-polygon"() {
        const start = spanStart();
        const end = spanEnd();

        return preview("polygon", {
            points: [
                start,
                end,
                snap({ x: end.x, y: start.y }),
                snap({ x: start.x, y: end.y })
            ],
            closed: true
        });
    },

    /*
     * THE AXIS IS DRAWN THE WAY A GESTURE WOULD DRAW IT: a horizontal X arm of
     * the default length, and a Y arm of the same length. The committed axis
     * carries a rotation of 0, and so does this, so the preview and the placed
     * feature agree.
     */
    "coordinate-system-2d"() {
        const origin = snap({ x: 0, y: 0 });
        const arm =
            enggDrawingSnap.snapPointToGrid(
                { x: DEFAULT_RADIUS, y: 0 },
                drawingState
            ).x || DEFAULT_RADIUS;

        return preview(COORDINATE_SYSTEM_TYPE, {
            origin,
            rotation: 0,
            xPositiveLength: arm,
            xNegativeLength: arm,
            yPositiveLength: arm,
            yNegativeLength: arm
        });
    }
};

/*
 * The preview for a tool, or null when it is not one of the Geometry tools.
 * `toolId` is the toolbar's tool id, which is also the feature type for every
 * Create tool and `coordinate-system-2d` for the Construction tool.
 */
export function defaultPreviewFor(toolId) {
    const builder = BUILDERS[toolId];

    return typeof builder === "function" ? builder() : null;
}

export default {
    defaultPreviewFor,
    arcMethod,
    polygonMethod,
    livePolygonSides
};
