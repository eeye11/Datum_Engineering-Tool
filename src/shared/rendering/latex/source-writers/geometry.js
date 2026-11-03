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
import { definitionForName } from "../../../../tool-library/shared/primitives/tikz-style.js";
import enggFeatureGeometry from "../../../geometry/feature-geometry.js";
import { gainTrianglePoints, isControlBlock, isGain, isPlant, isSum, plantNodeLabel, plantNodePosition, plantStyle, plantValue, sumInputSign, sumInputSignPosition, sumNodePortPosition } from "../../../model/plant.js";
import { blockLabelLatex } from "../../../model/block-label.js";
import { isSignalLine, signalLineSegments } from "../../../model/signal-line.js";
import { applyObjectComments, ensureObjectId } from "../object-comments.js";

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
 * THE AUTHORED STYLE, AND NOTHING ELSE.
 *
 * `style.stroke` is the colour the student's object was drawn with; absent, the
 * drawing is BLACK. It is deliberately NOT the interface theme's default ink:
 * that value (`#193335`, a dark teal) is what a NEW object starts from, and
 * writing it into the source made every un-chosen black line a dark teal in TeX
 * - and would have made a saved file change colour when the interface theme
 * did. The colour conversion itself, the pen width and the opacity all come
 * from the shared `tikz-style.js`, through the primitives.
 */
const NO_STROKE = /^none$/i;

function renderStyle(style = {}) {
    const normalised = { ...style };

    const declared = String(style.stroke ?? "").trim();

    normalised.stroke = NO_STROKE.test(declared)
        ? "none"
        : declared || "#000000";

    /*
     * THE WIDTH STAYS NOMINAL HERE.
     *
     * `primitives` receive it with the export transform alongside, and reduce it
     * by that factor exactly once. Putting the factor on the style as well would
     * multiply twice - the failure this contract exists to prevent.
     */
    normalised.lineWidth = resolveLineWidth(style.lineWidth);

    normalised.fill =
        String(style.fillMode ?? "").toLowerCase() === "solid"
            ? style.fill && style.fill !== "none"
                ? style.fill
                : normalised.stroke
            : "none";

    return normalised;
}

/*
 * THE EXPORT TRANSFORM IN EFFECT, FOR THE OBJECT BEING WRITTEN.
 *
 * Every coordinate this writer emits goes through `pointOf`, so the export
 * reduction and the shift to a local origin are applied THERE - once, in one
 * place - rather than in every shape's own arithmetic. The model coordinates are
 * read unchanged; only what is written comes out normalized.
 *
 * It is set for ONE object's serialization and restored afterwards, so it cannot
 * leak between objects and a second pass over the same drawing starts from the
 * model again - which is what makes repeated generation idempotent.
 */
let exportTransformInEffect = null;

function withExportTransform(transform, fn) {
    const previous = exportTransformInEffect;

    exportTransformInEffect = transform && typeof transform.point === "function" ? transform : null;

    try {
        return fn();
    } finally {
        exportTransformInEffect = previous;
    }
}

function pointOf(candidate) {
    if (!candidate || typeof candidate !== "object") {
        return { x: 0, y: 0 };
    }

    const x = finite(candidate.x);
    const y = finite(candidate.y);

    return exportTransformInEffect ? exportTransformInEffect.point(x, y) : { x, y };
}

/*
 * A LENGTH IN MODEL UNITS, AT THE EXPORT SCALE.
 *
 * A radius, a width or a marker size is a DISTANCE, not a position: it has no
 * origin, so it is multiplied by the factor and never shifted. Scaling it here
 * - next to `pointOf`, where the coordinates are scaled - is what keeps a circle
 * circular and a rectangle's aspect ratio intact in a reduced figure.
 */
function lengthOf(value) {
    const number = finite(value);

    return exportTransformInEffect ? exportTransformInEffect.length(number) : number;
}

/*
 * AN ARC ANGLE IN DEGREES.
 *
 * The model stores degrees - that is what the factory takes and what the canvas
 * draws with. A value outside the degree range is a genuinely radian-valued arc
 * from an older file, and is converted ONCE; a degree value passes unchanged.
 * `5156.62` is what the old unconditional multiplication made of a right angle.
 */
function toDegrees(value) {
    const angle = finite(value);

    return Math.abs(angle) > 2 * Math.PI ? angle : (angle * 180) / Math.PI;
}

function pointsOf(geometry) {
    return Array.isArray(geometry?.points) ? geometry.points.map(pointOf) : [];
}

/* The polygon's vertices, derived from centre, radius, sides and rotation. */function polygonPoints(geometry) {
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

const SHAPES = {    line(object) {
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
            arrowEnd: style.arrowEnd || "none",
            transform: exportTransformInEffect
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
                ? crossMarker(at, style, lengthOf(size))
                : marker({ at, style, size: lengthOf(size) });

        return [coordinate(`${safeName(object)}`, at.x, at.y), drawn].join("\n");
    },

    polyline(object, context = {}) {
        if (isSignalLine(object)) {
            const style = renderStyle({
                stroke: "#000000",
                lineWidth: "thin",
                lineType: "solid",
                opacity: 1
            });

            return signalLineSegments(object, context.allObjects || [])
                .map(segment => straightLine(
                    pointOf(segment.start),
                    pointOf(segment.end),
                    style,
                    {
                        arrowEnd: segment.hasArrow ? "open-arrow" : "none",
                        transform: exportTransformInEffect
                    }
                ))
                .filter(Boolean)
                .join("\n");
        }

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
        if (isGain(object)) {
            const style = renderStyle(plantStyle(object.style));
            const vertices = gainTrianglePoints(object);

            if (vertices.length !== 3) {
                return null;
            }

            const centre = {
                x: vertices.reduce((sum, vertex) => sum + vertex.x, 0) / vertices.length,
                y: vertices.reduce((sum, vertex) => sum + vertex.y, 0) / vertices.length
            };
            const commands = [
                closedShape(vertices.map(pointOf), style),
                textNode({
                    at: pointOf(centre),
                    text: plantValue(object, "gainValue"),
                    style,
                    fontSize: lengthOf(8)
                })
            ];

            for (const [side, port] of [
                ["inputs", {
                    x: (vertices[0].x + vertices[1].x) / 2,
                    y: (vertices[0].y + vertices[1].y) / 2
                }],
                ["outputs", vertices[2]]
            ]) {
                const terminal = plantNodePosition(object, side, 0);
                commands.push(
                    straightLine(pointOf(port), pointOf(terminal), style),
                    circlePrimitive({
                        centre: pointOf(terminal),
                        radius: lengthOf(1.25),
                        style: { ...style, fill: style.stroke }
                    })
                );
            }

            return commands.filter(Boolean).join("\n");
        }

        /*
         * THE CORNER IS COMPUTED IN MODEL SPACE, THEN TRANSFORMED ONCE.
         *
         * `position` is the TOP-LEFT corner with y growing upward, so the
         * rectangle runs DOWN from it. The other corner is therefore computed
         * from the MODEL position and the MODEL height, and only the finished
         * pair is passed through `pointOf` - transforming `position` first and
         * then subtracting an export-scaled height would offset the corner
         * twice and leave the rectangle at a different size from its own
         * neighbours.
         */
        const position = {
            x: finite(object.geometry?.position?.x),
            y: finite(object.geometry?.position?.y)
        };

        const width = finite(object.geometry?.width);
        const height = finite(object.geometry?.height);
        const rotation = finite(object.geometry?.rotation);
        const style = renderStyle(isControlBlock(object) ? plantStyle(object.style) : object.style);
        let rectangle;

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
            /*
             * A rotated rectangle's corners are computed in MODEL space - that is
             * where the rotation lives - and then passed through `pointOf` into
             * export space, exactly as every other coordinate is. Transforming
             * them here keeps the corners in the same figure as the rest.
             */
            const corners = enggFeatureGeometry.rectangleCorners(object.geometry);

            rectangle = corners.length === 4 ? closedShape(corners.map(pointOf), style) : null;
        } else {
            rectangle = rectanglePrimitive({
                from: pointOf({ x: position.x, y: position.y - height }),
                to: pointOf({ x: position.x + width, y: position.y }),
                style
            });
        }

        if (!isControlBlock(object) || !rectangle) {
            return rectangle;
        }

        const centre = {
            x: position.x + width / 2,
            y: position.y - height / 2
        };
        const radians = (rotation * Math.PI) / 180;
        const rotate = (x, y) => ({
            x: centre.x + x * Math.cos(radians) - y * Math.sin(radians),
            y: centre.y + x * Math.sin(radians) + y * Math.cos(radians)
        });
        const commands = [rectangle];

        if (isPlant(object)) {
            commands.push(textNode({
                at: pointOf(centre),
                text: "Plant",
                style,
                fontSize: lengthOf(12)
            }));
        }
        const userLabel = plantValue(object, "plantLabel");

        if (isPlant(object) && userLabel.trim()) {
            commands.push(
                textNode({
                    at: pointOf({ x: centre.x, y: centre.y - 6 }),
                    text: `[${userLabel}]`,
                    style,
                    fontSize: lengthOf(4)
                })
            );
        }

        const blockLabel = plantValue(object, "blockLabel");

        if (blockLabel.trim()) {
            commands.push(
                textNode({
                    at: pointOf(centre),
                    text: `$${blockLabelLatex(blockLabel)}$`,
                    style,
                    fontSize: lengthOf(8)
                })
            );
        }

        const blockLowerLabel = plantValue(object, "blockLowerLabel");

        if (blockLowerLabel.trim()) {
            commands.push(
                textNode({
                    at: pointOf({ x: centre.x, y: centre.y - height / 2 - 5 }),
                    text: blockLowerLabel,
                    style,
                    fontSize: lengthOf(4)
                })
            );
        }

        for (const side of ["inputs", "outputs"]) {
            const count = plantValue(object, side);
            const isInput = side === "inputs";
            const x = isInput ? -width / 2 : width / 2;
            const outward = isInput ? -1 : 1;
            const margin = Math.min(height * 0.15, 2);
            const usableHeight = Math.max(0, height - margin * 2);

            for (let index = 0; index < count; index += 1) {
                const y = count === 1
                    ? 0
                    : height / 2 - margin - index * usableHeight / (count - 1);
                const port = rotate(x, y);
                const terminal = rotate(x + outward * 4, y);

                commands.push(
                    straightLine(pointOf(port), pointOf(terminal), style),
                    circlePrimitive({
                        centre: pointOf(terminal),
                        radius: lengthOf(1.25),
                        style: { ...style, fill: style.stroke }
                    })
                );

                if (plantValue(object, "showNodeLabels")) {
                    const labelPoint = rotate(x + outward * 7, y);
                    commands.push(
                        textNode({
                            at: pointOf({ x: labelPoint.x, y: labelPoint.y - 5 }),
                            text: plantNodeLabel(object, side, index),
                            anchor: outward * Math.cos(radians) < 0 ? "east" : "west",
                            style,
                            fontSize: lengthOf(4)
                        })
                    );
                }
            }
        }

        return commands.filter(Boolean).join("\n");
    },

    circle(object) {
        if (isSum(object)) {
            const style = renderStyle(plantStyle(object.style));
            const centre = pointOf(object.geometry?.center);
            const radius = lengthOf(object.geometry?.radius);

            if (radius <= 0) {
                return null;
            }

            const commands = [circlePrimitive({ centre, radius, style })];
            for (let index = 0; index < plantValue(object, "inputs"); index += 1) {
                const terminal = plantNodePosition(object, "inputs", index);
                const port = sumNodePortPosition(object, "inputs", index);
                const signPosition = sumInputSignPosition(object, index);
                commands.push(
                    straightLine(pointOf(port), pointOf(terminal), style),
                    circlePrimitive({
                        centre: pointOf(terminal),
                        radius: lengthOf(1.25),
                        style: { ...style, fill: style.stroke }
                    }),
                    textNode({
                        at: pointOf(signPosition),
                        text: sumInputSign(object, index),
                        style,
                        fontSize: lengthOf(6)
                    })
                );
            }

            const outputTerminal = plantNodePosition(object, "outputs", 0);
            const outputPort = sumNodePortPosition(object, "outputs", 0);
            commands.push(
                straightLine(pointOf(outputPort), pointOf(outputTerminal), style),
                circlePrimitive({
                    centre: pointOf(outputTerminal),
                    radius: lengthOf(1.25),
                    style: { ...style, fill: style.stroke }
                })
            );
            return commands.filter(Boolean).join("\n");
        }

        const centre = pointOf(object.geometry?.center);
        const radius = lengthOf(object.geometry?.radius);

        if (radius <= 0) {
            return null;
        }

        return circlePrimitive({ centre, radius, style: renderStyle(object.style) });
    },

    arc(object) {
        const centre = pointOf(object.geometry?.center);
        const radius = lengthOf(object.geometry?.radius);

        /*
         * THE MODEL STORES AN ARC'S ANGLES IN DEGREES, and TikZ takes degrees.
         *
         * The factories take the angle the student drew (`arc(centre, r, 0, 90)`),
         * and the geometry keeps it as given - so the conversion here was WRONG
         * IN BOTH DIRECTIONS: it multiplied an already-degree value by 180/pi,
         * turning a quarter circle into `end angle=5156.62`. The arc still looked
         * right on the live overlay, which draws from the model directly, and was
         * only wrong once the compiled picture arrived.
         *
         * `toDegrees` therefore accepts EITHER: a value the model stored in
         * degrees is written as it stands, and a value past the degree range - a
         * genuinely radian-valued arc from an older file - is converted once.
         */
        const startAngle = toDegrees(object.geometry?.startAngle);
        const endAngle = toDegrees(object.geometry?.endAngle);

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
export function geometrySourceWriter(object, context = {}) {
    if (!object || typeof object !== "object") {
        return null;
    }

    const shape = SHAPES[object.type];

    if (typeof shape !== "function") {
        return null;
    }

    /*
     * THE OBJECT IS WRITTEN INSIDE ITS EXPORT TRANSFORM.
     *
     * `context.transform` is the drawing's export context. It is in effect for
     * THIS object only: every coordinate comes out normalized and every length
     * reduced by the one export factor, and no other object can inherit it.
     * Without one the object is written at its authored size - which is what a
     * single-object preview and a test want.
     */
    return withExportTransform(context?.transform || null, () => {
        const written = shape(object, context);

        if (typeof written !== "string" || !written.trim()) {
            return written;
        }

        /*
         * THE COLOUR DEPENDENCIES GO WITH THE COMMAND THAT USES THEM.
         *
         * A hex colour is written as `daetumC<hex>` and NEEDS its
         * `\definecolor` line, or the picture fails with "Undefined color".
         * `strokeOptionsWithPrelude` already hands the definitions back beside
         * the options, but the shapes return only the command - so every
         * coloured object used to be written into the source without the one
         * line that makes its colour exist, and the whole sheet failed to
         * compile with an error that pointed at nothing the student could fix.
         *
         * The definitions are gathered from the command's own option group and
         * emitted ABOVE it: one definition per colour, in a deterministic order,
         * so the same drawing always writes the same text.
         */
        const definitions = colourDefinitionsIn(written);
        const body = definitions.length ? `${definitions.join("\n")}\n${written}` : written;

        /*
         * THE OBJECT'S HEADER. Its id is minted once and reused, so moving or
         * restyling the shape rewrites its region and never changes who it is.
         */
        const id = ensureObjectId(object, object.type);

        return applyObjectComments({ ...object, id }, body, { type: object.type });
    });
}

/*
 * THE COLOUR NAMES A COMMAND USES THAT DO NOT EXIST IN xcolor YET.
 *
 * Reads the command's `[...]` option group for `draw=`/`color=`/`fill=` values
 * of DAETUM's own form (`daetumC193335`) and returns the `\definecolor` line each
 * one needs, in a stable order. A name the student wrote themselves is left to
 * them: rewriting `red` into a definition would change a drawing that already
 * compiles.
 */
function colourDefinitionsIn(command) {
    const optionGroup = /^\\[A-Za-z]+\*?\s*\[([^\]]*)\]/.exec(command);

    if (!optionGroup) {
        return [];
    }

    const names = new Set();

    optionGroup[1].replace(
        /(?:draw|color|fill|text)\s*=\s*(\{)?\s*(daetumC[0-9A-Fa-f]{6})\b/g,
        (match, brace, name) => {
            names.add(name);
            return match;
        }
    );

    return [...names]
        .map((name) => definitionForName(name))
        .filter(Boolean);
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
