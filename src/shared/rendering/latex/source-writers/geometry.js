/*
 * ============================================================
 * GEOMETRY SOURCE WRITER
 * ============================================================
 *
 * Turns a structured geometry object into the TikZ commands that draw it.
 *
 * This is the SOURCE-GENERATION ADAPTER for the geometry tools: the bridge
 * between the object model and the drawing source. It is not a tool template -
 * a template is used to CREATE a new object, whereas this writes the source for
 * one that already exists.
 *
 * HOW IT IS WIRED. It registers itself with source-synchronization.js as the
 * source writer. When a geometry object changes, the synchronization layer asks
 * this module for its commands and updates only that object's region. The
 * geometry module therefore never imports the panel and the panel never imports
 * geometry - the seam is one registration.
 *
 * ONE WRITER, A TABLE OF SHAPES. A registered geometry type is a `\draw` of a
 * known form, so each one is a few lines describing which primitive to call and
 * with what. That is deliberately NOT a giant switch: the shapes share their
 * stroke options, their number formatting and their coordinates, and each entry
 * below states only what is different about it. A type with no entry returns
 * `null`, which the synchronization layer reads as "no source yet" and leaves
 * the object's region alone rather than overwriting it with a guess.
 *
 * WHAT IT DOES NOT DO. It does not read source back into geometry. Recognising
 * arbitrary TikZ well enough to rebuild a structured object is a larger piece
 * of work, and guessing at it would silently rewrite what the student drew. The
 * source is written from the model; the model is not rebuilt from the source.
 */

import {
    closedShape,
    coordinate,
    marker,
    num,
    point,
    polyline,
    rectangle as rectanglePrimitive,
    circle as circlePrimitive,
    arc as arcPrimitive,
    resolveLineWidth,
    straightLine,
    textNode
} from "../../../../tool-library/shared/primitives/tikz-primitives.js";
import enggFeatureGeometry from "../../../geometry/feature-geometry.js";
import enggTheme from "../../../../components/layout/workspace/theme.js";

function finite(value, fallback = 0) {
    const number = Number(value);

    return Number.isFinite(number) ? number : fallback;
}

/*
 * ============================================================
 * FROM THE OBJECT'S STYLE TO THE PRIMITIVES' STYLE
 * ============================================================
 *
 * The Features panel stores appearance in the vocabulary a student reads -
 * `lineWidth: "thin"`, `fillMode: "solid"`, `stroke: "#193335"` - while the
 * primitives expect the model's own numeric width and a `fill` that is either
 * a colour or the word `none`. This is the one place the two are reconciled,
 * so every shape's source follows the same rule instead of each entry
 * repeating the conversion (and one of them forgetting the fill mode).
 *
 * A Solid fill whose colour was never chosen falls back to the stroke colour,
 * which is what a student means by "fill it in" when they have picked one
 * colour. The style object itself is never mutated: the writer must not change
 * the model it was handed.
 */
/*
 * THE THEME'S DEFAULT INK, resolved through the published theme module.
 *
 * Reached by name rather than imported, for the same reason the Statics
 * writer does: `theme.js` owns the light/dark default, and a private copy of
 * the two hex values here would be a second answer to "what colour is a line
 * when nobody chose one". In a browser it is already loaded; a test that has
 * not loaded it simply falls back to black.
 */
function themeInk() {
    const theme = enggTheme;

    try {
        if (theme && typeof theme.defaultLineColour === "function") {
            return theme.defaultLineColour();
        }
    } catch {
        /* fall through */
    }

    return null;
}

function renderStyle(style = {}) {
    const normalised = { ...style };

    normalised.stroke = style.stroke || themeInk() || "#000000";

    const width = resolveLineWidth(style.lineWidth);

    normalised.lineWidth = width;

    normalised.fill =
        String(style.fillMode ?? "").toLowerCase() === "solid"
            ? style.fill && style.fill !== "none"
                ? style.fill
                : normalised.stroke
            : "none";

    return normalised;
}

function pointOf(candidate) {
    if (!candidate || typeof candidate !== "object") {
        return { x: 0, y: 0 };
    }

    return {
        x: finite(candidate.x),
        y: finite(candidate.y)
    };
}

function pointsOf(geometry) {
    return Array.isArray(geometry?.points) ? geometry.points.map(pointOf) : [];
}

/* The polygon's vertices, derived from centre, radius, sides and rotation. */
function polygonPoints(geometry) {
    const centre = pointOf(geometry?.center);
    const radius = finite(geometry?.radius);
    const sides = Math.max(3, Math.round(finite(geometry?.sides, 3)));
    const rotation = finite(geometry?.rotation);

    const points = [];

    for (let index = 0; index < sides; index += 1) {
        const angle = ((rotation + (index * 360) / sides) * Math.PI) / 180;

        points.push({
            x: centre.x + radius * Math.cos(angle),
            y: centre.y + radius * Math.sin(angle)
        });
    }

    return points;
}

/*
 * ============================================================
 * THE SHAPE TABLE
 * ============================================================
 *
 * Each entry returns the commands for one object, or null when its geometry is
 * not yet well-formed enough to draw. A half-built object - a line with one
 * endpoint - returns null rather than writing a degenerate command into the
 * source, which would be a drawing the student never asked for.
 */
/*
 * Marker sizes for a Point, in drawing units.
 *
 * The three names are the Features panel's Small / Medium / Large, and the
 * numbers are what each one is DRAWN at - a marker has no geometric extent,
 * so this is appearance only and never moves the point.
 */
const POINT_MARKER_SIZES = {
    small: 1.2,
    medium: 2,
    large: 3
};

function pointMarkerSize(style) {
    return POINT_MARKER_SIZES[style.markerSize] || POINT_MARKER_SIZES.medium;
}

/*
 * A Point drawn as a CROSS: two short strokes through the position. The arms
 * are half the marker's size each way, so a cross and a dot of the same named
 * size cover the same area on the sheet.
 */
function crossMarker(at, style, size) {
    const arm = size * 0.5;

    return [
        straightLine(
            { x: at.x - arm, y: at.y },
            { x: at.x + arm, y: at.y },
            style
        ),
        straightLine(
            { x: at.x, y: at.y - arm },
            { x: at.x, y: at.y + arm },
            style
        )
    ].join("\n");
}

const SHAPES = {
    line(object) {
        const start = pointOf(object.geometry?.start);
        const end = pointOf(object.geometry?.end);
        const style = renderStyle(object.style);

        /*
         * BEGIN AND END ARROWS ARE INDEPENDENT.
         *
         * The two arrow heads are appearance, so they are written into the
         * path options and never touch the endpoints. `arrowStart` / `arrowEnd`
         * are the style keys the Features panel sets; absent means none.
         */
        return straightLine(start, end, style, {
            arrowStart: style.arrowStart || "none",
            arrowEnd: style.arrowEnd || "none"
        });
    },

    point(object) {
        const at = pointOf(object.geometry?.position);
        const style = renderStyle(object.style);
        const size = pointMarkerSize(style);

        /*
         * A Point is a NAMED coordinate plus its drawn marker. The coordinate
         * lets a later command refer to the point by name; the marker is the
         * dot or the cross the student chose.
         */
        const drawn =
            style.markerStyle === "cross"
                ? crossMarker(at, style, size)
                : marker({ at, style, size });

        return [coordinate(`${safeName(object)}`, at.x, at.y), drawn].join("\n");
    },

    polyline(object) {
        const points = pointsOf(object.geometry);

        if (points.length < 2) {
            return null;
        }

        return polyline(points, renderStyle(object.style));
    },

    triangle(object) {
        const points = pointsOf(object.geometry);

        if (points.length < 3) {
            return null;
        }

        return closedShape(points, renderStyle(object.style));
    },

    /*
     * A Freeform Polygon is a closed path through its own vertices, in the order
     * they were placed. There is no centre or radius to derive them from, so the
     * stored points ARE the source - which is what makes the generated code
     * follow the shape the student actually drew.
     */
    "freeform-polygon"(object) {
        const points = pointsOf(object.geometry);

        if (points.length < 3) {
            return null;
        }

        return closedShape(points, renderStyle(object.style));
    },

    polygon(object) {
        return closedShape(polygonPoints(object.geometry), renderStyle(object.style));
    },

    rectangle(object) {
        const position = pointOf(object.geometry?.position);
        const width = finite(object.geometry?.width);
        const height = finite(object.geometry?.height);
        const rotation = finite(object.geometry?.rotation);
        const style = renderStyle(object.style);

        /*
         * `position` IS THE TOP-LEFT CORNER, with y growing upward, so the
         * rectangle runs DOWN from it - exactly as the canvas draws it. Adding
         * the height drew every rectangle one height too high.
         *
         * A rotated rectangle is not a rectangle to TikZ, so it is drawn as a
         * closed path through the model's own corners (rotated about the
         * centre, as `rectangleCorners` defines them) rather than being squared
         * up. A rotation of zero takes the exact `rectangle` operation, which
         * closes without a seam.
         */
        if (rotation !== 0) {
            const corners = enggFeatureGeometry.rectangleCorners(object.geometry);

            return corners.length === 4 ? closedShape(corners, style) : null;
        }

        return rectanglePrimitive({
            from: { x: position.x, y: position.y - height },
            to: { x: position.x + width, y: position.y },
            style
        });
    },

    circle(object) {
        const centre = pointOf(object.geometry?.center);
        const radius = finite(object.geometry?.radius);

        if (radius <= 0) {
            return null;
        }

        return circlePrimitive({ centre, radius, style: renderStyle(object.style) });
    },

    arc(object) {
        const centre = pointOf(object.geometry?.center);
        const radius = finite(object.geometry?.radius);
        const startAngle = finite(object.geometry?.startAngle);
        const endAngle = finite(object.geometry?.endAngle);

        if (radius <= 0 || startAngle === endAngle) {
            return null;
        }

        return arcPrimitive({
            centre,
            radius,
            startAngle,
            endAngle,
            style: renderStyle(object.style)
        });
    },

    /*
     * A Coordinate System is ONE object drawn as a cross of two axis paths and
     * their labels. The source is generated from the stored origin and the four
     * arm lengths, so the picture follows the system the student placed rather
     * than an invented cross at the centre of the sheet.
     *
     * The four arms are independent in the model (+X, -X, +Y, -Y can each be a
     * different length), so the axes are drawn as full segments spanning their
     * own extents. That keeps the source faithful to the drawing, and a
     * coordinate system that has been stretched along one arm still comes out
     * the length it is drawn.
     *
     * THE Y AXIS IS PERPENDICULAR BY CONSTRUCTION. Nothing here recomputes a
     * direction: the model stores axis-aligned arms, and writing them as the
     * picture sees them is what preserves the right angle. A snapped X arm can
     * therefore never skew the Y arm.
     *
     * OPTIONS. `showXAxis` / `showYAxis` (default on) and `showLabels` (default
     * on) decide what is emitted; the labels come from `xLabel` / `yLabel`, and
     * the origin label from `originLabel`. Hiding an axis or a label omits it
     * from the source and never moves the geometry, which is the requirement
     * that a display toggle is a display toggle.
     */
    "coordinate-system-2d"(object) {
        const geometry = object.geometry || {};
        const origin = pointOf(geometry.origin);
        const style = renderStyle(object.style);

        const arm = (value) => {
            const length = finite(value);

            return length > 0 ? length : 0;
        };

        const xPositive = arm(geometry.xPositiveLength);
        const xNegative = arm(geometry.xNegativeLength);
        const yPositive = arm(geometry.yPositiveLength);
        const yNegative = arm(geometry.yNegativeLength);

        const fallback = arm(geometry.axisLength) || 25;

        const showX = geometry.showXAxis !== false;
        const showY = geometry.showYAxis !== false;
        const showLabels = geometry.showLabels !== false;

        const commands = [];

        /*
         * THE AXES ARE WRITTEN IN THE ATTITUDE THEY WERE DRAWN IN.
         *
         * A system placed by a drag stores the angle its X arm points in.
         * The four endpoints are computed axis-aligned and then turned about
         * the origin, so the code describes the same cross the canvas draws -
         * and the Y arm stays square to the X arm, because it is rotated by
         * exactly the same angle. A system with a rotation of 0 lands on its
         * axis-aligned endpoints unchanged.
         */
        const angle = finite(geometry.rotation) || 0;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        const rotate = (dx, dy) => ({
            x: origin.x + dx * cos - dy * sin,
            y: origin.y + dx * sin + dy * cos
        });

        if (showX && (xPositive > 0 || xNegative > 0)) {
            const posX = xPositive > 0 ? xPositive : fallback;
            const negX = xNegative > 0 ? xNegative : fallback;

            commands.push(
                straightLine(
                    rotate(-negX, 0),
                    rotate(posX, 0),
                    style,
                    { arrow: "both" }
                )
            );
        }

        if (showY && (yPositive > 0 || yNegative > 0)) {
            const posY = yPositive > 0 ? yPositive : fallback;
            const negY = yNegative > 0 ? yNegative : fallback;

            commands.push(
                straightLine(
                    rotate(0, -negY),
                    rotate(0, posY),
                    style,
                    { arrow: "both" }
                )
            );
        }

        if (showLabels) {
            const xText = String(geometry.xLabel ?? "X");
            const yText = String(geometry.yLabel ?? "Y");
            const originText = String(geometry.originLabel ?? "");

            /*
             * THE LABELS SIT JUST OFF THE ARM THEY NAME, TURNED WITH IT.
             *
             * The label position is the arm's own endpoint plus a small
             * offset along the same rotated axes, so an "X" stays beside the
             * X arm and an "Y" beside the Y arm however the cross is turned.
             */
            if (showX && xText !== "") {
                const tip = rotate(
                    xPositive > 0 ? xPositive : fallback,
                    0
                );

                commands.push(
                    textNode({
                        at: {
                            x: tip.x + 3 * cos + 3 * sin,
                            y: tip.y + 3 * sin - 3 * cos
                        },
                        text: xText,
                        anchor: "west",
                        style: { stroke: style.stroke }
                    })
                );
            }

            if (showY && yText !== "") {
                const tip = rotate(
                    0,
                    yPositive > 0 ? yPositive : fallback
                );

                commands.push(
                    textNode({
                        at: {
                            x: tip.x - 3 * sin + 3 * cos,
                            y: tip.y + 3 * cos + 3 * sin
                        },
                        text: yText,
                        anchor: "south west",
                        style: { stroke: style.stroke }
                    })
                );
            }

            if (originText !== "") {
                commands.push(
                    textNode({
                        at: { x: origin.x - 3, y: origin.y - 3 },
                        text: originText,
                        anchor: "north east",
                        style: { stroke: style.stroke }
                    })
                );
            }
        }

        return commands.length ? commands.join("\n") : null;
    }
};

/*
 * A point's coordinate name has to be a valid LaTeX name: letters, digits and a
 * few symbols only. The object's id carries a hyphen, which is not valid in a
 * TikZ coordinate name, so it is replaced rather than escaped.
 */
function safeName(object) {
    return String(object.id || "P").replace(/[^A-Za-z0-9]/g, "");
}

/*
 * ============================================================
 * THE WRITER
 * ============================================================
 *
 * The function registered with source-synchronization.js. It returns commands,
 * or null when this object's type has no writer yet - which is how a tool whose
 * source is still being implemented is handled: its object exists, its region
 * is untouched, and nothing is fabricated.
 */
export function geometrySourceWriter(object) {
    if (!object || typeof object !== "object") {
        return null;
    }

    const shape = SHAPES[object.type];

    if (typeof shape !== "function") {
        return null;
    }

    return shape(object);
}

/*
 * The types this writer can produce source for. Exported so the registry
 * consistency check and a test can assert the list without reaching into the
 * table.
 */
export function writtenGeometryTypes() {
    return Object.keys(SHAPES);
}

/*
 * Register this writer with the synchronization layer. Called once at start-up.
 * Kept as a function rather than a top-level side effect so a test can import
 * the module without wiring it into the application's source manager.
 */
export function installGeometrySourceWriter({ setSourceWriter }) {
    if (typeof setSourceWriter === "function") {
        setSourceWriter(geometrySourceWriter);
    }
}

export default {
    geometrySourceWriter,
    writtenGeometryTypes,
    installGeometrySourceWriter,
    num,
    point
};
