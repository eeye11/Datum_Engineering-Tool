/* Central source of truth for structured engineering drawings. */
import enggAnnotationModel from "../../features/annotations/annotation-model.js";
import enggAnnotate from "../../features/annotations/annotate-model.js";
import enggDimensionModel from "../../features/dimensions/dimension-model.js";
import enggVariableDimension from "../../features/dimensions/variable-dimension.js";
import enggMeasurement from "../geometry/measurement-core.js";
import enggDrawingSnap from "../snapping/object-snap.js";
import { deepClone } from "../util/clone.js";

const BASE_PIXELS_PER_UNIT = 2.4;

/*
 * Vertices of a regular polygon, derived from its
 * stored parameters.
 *
 * This lives with the geometry model so the
 * renderer, the drawing controller, hit-testing and
 * the snapping candidates all derive the shape from
 * the same definition and can never disagree.
 */
function polygonVertices(
    geometry
) {
    const sides =
        Math.max(
            3,
            Math.round(
                Number(geometry.sides) || 3
            )
        );

    const radius =
        Number(geometry.radius) || 0;

    const center =
        geometry.center || {
            x: 0,
            y: 0
        };

    const rotation =
        Number(geometry.rotation) || 0;

    const points = [];

    for (
        let index = 0;
        index < sides;
        index += 1
    ) {
        const angle =
            rotation +
            (
                index *
                2 *
                Math.PI
            ) /
                sides;

        points.push({
            x:
                center.x +
                radius *
                    Math.cos(angle),

            y:
                center.y +
                radius *
                    Math.sin(angle)
        });
    }

    return points;
}

function createDrawingState() {
    return {
        version: 1,
        units: "mm",

        /*
         * THE DOCUMENT'S LENGTH CALIBRATION, DECLARED UP FRONT.
         *
         * `null` means UNCALIBRATED: the geometry is real, but nothing has
         * said how long any of it is, so a dimension has no honest number
         * to print. That is a real state rather than a missing field -
         * `undefined` meant the document could not tell "never calibrated"
         * from "calibration lost", which is how a saved drawing silently
         * came back uncalibrated.
         *
         * It belongs HERE, on the document, because it is one fact about
         * the whole drawing. A scale stored per feature would be a second
         * source of truth for every object that had one, free to disagree
         * with its neighbours, and a beam measured in millimetres beside
         * its own load measured in something else.
         *
         * Declared here it is also part of the document SHAPE, so the
         * snapshot and the serializer below carry it without either of
         * them having to remember to - which is exactly how it went
         * missing before.
         */
        scale: null,

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

        /*
         * THE STATICS ENVIRONMENT'S DISPLAY SETTINGS.
         *
         * One block for the whole Statics workspace, held at
         * drawing level rather than on any individual feature. The
         * Vector Scale in here is the single shared value that every
         * force and load arrow is drawn through.
         *
         * It is a DISPLAY setting and nothing else. It changes how
         * big the arrows look and never how big the forces are: a
         * 100 N force drawn at 4x is still 100 N, and the analysis
         * that reads it never sees this value at all.
         */
        /*
         * ========================================================
         * THE THREE DISPLAY SETTINGS
         * ========================================================
         *
         * Workspace settings, not sheet settings and not feature
         * settings: they are how the drawing is READ rather than what
         * is on it, which is why they sit beside Grid and Snap rather
         * than in any feature's panel.
         *
         * Each is DEFAULTED ON here, and an absent field is read the
         * same way by the annotation model. That matters for saved
         * drawings: a file written before these existed has no field at
         * all, and the conservative reading of "nobody said otherwise"
         * has to be the behaviour it always had, or opening an old
         * sheet would silently strip every unit off it.
         */
        display: {
            showUnits: true,
            showMagnitudes: true,
            showDimensions: true
        },
        statics: {
            vectorScale: 1
        },
        objectSnap: {
            enabled: true,

            /*
             * NO STORED TOLERANCE.
             *
             * This used to carry `tolerancePx: 10`, which quietly
             * overrode the snap engine's own constant - `getTolerancePx`
             * prefers a configured value over its floor, so the number
             * that was actually in force was neither the one in the
             * engine nor the one a reader of the engine would expect,
             * and changing the engine's constant changed nothing at all.
             * That is how a snap tolerance can be narrowed in a comment
             * and stay exactly as sticky in the product.
             *
             * So the tolerance lives in ONE place - the snap engine -
             * and the state says only whether snapping is on. A
             * tolerance a user can set is a separate feature; until there
             * is one, a second copy of the number here is a second
             * source of truth about how far the cursor has to be.
             */

            /*
             * The catch band for horizontal and vertical
             * alignment is deliberately WIDER than the band
             * for snapping onto a point.
             *
             * Landing on a point is an aiming task: the user
             * is looking at a specific spot and can correct
             * towards it. Lining up with an alignment is not:
             * the user is judging a direction against a long
             * chord, and the error is spread along that chord
             * rather than visible as a single miss. Judging it
             * in degrees from a long member is much harder
             * than aiming at its end, so a band narrower than
             * the point tolerance makes alignment feel broken
             * precisely where it is most useful - joining a
             * truss member or a loaded span to a joint it is
             * meant to line up with.
             *
             * Left unset for the same reason as the point
             * tolerance above: the engine states both figures
             * itself, so that narrowing one cannot silently
             * drag the other with it.
             */
        },
        styleDefaults: {
            stroke: themeLineColour,

            /*
             * HAS THE STUDENT CHOSEN A COLOUR OF THEIR OWN?
             *
             * `false` means the stroke above is only the THEME's default, so a
             * later theme change may re-point it (affecting new features only).
             * The colour picker sets this `true` the moment a colour is chosen
             * with nothing selected, from which point the choice is preserved
             * across theme changes - the precedence in §4.6.
             */
            strokeExplicit: false,
            fill: "none",
            lineWidth: 0.5,
            lineType: "solid",
            opacity: 1
        },
        /*
         * SELECT IS THE DEFAULT, and was `null`.
         *
         * With nothing active, every click fell through the tool
         * handlers to the selection code - so clicking DID select, but
         * by absence rather than by choice. That is not the same thing,
         * and the difference shows in three places: nothing in the
         * toolbar showed which tool was live, so a student who had never
         * touched the toolbar had no way to tell they were in a tool;
         * `activateTool` would not see "select" already active and so
         * could not take the "re-clicking cancels it" path; and any
         * status text that read the active tool had nothing to report.
         *
         * Naming it makes the default state an ordinary one - the same
         * state reached by clicking the Select button - rather than a
         * special case that behaves like it.
         */
        activeTool: "select",
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
            selectionDragging: false,

            /*
             * The construction's own contribution to the
             * shared snap context.
             *
             * `snapGeometry` is the geometry that exists
             * only in the interaction - a truss's members so
             * far, a load's points so far - published to the
             * snap system so a construction can snap to what
             * it has already built.
             *
             * `snapQuarterSnap` says that geometry offers
             * quarter regions, which is a Truss capability
             * and is declared rather than inferred.
             *
             * `snapToolId` is the tool the construction is
             * really being, kept separately from the armed
             * tool so a construction does not lose its own
             * snapping behaviour once the student changes
             * tool mid-way.
             */
            snapGeometry: [],
            snapQuarterSnap: false,
            snapToolId: null,
            guideline: null,
            points: [],
            previewObjects: [],
            modifyAxisObjectIds: [],
            arcLastAngle: null,
            arcAccumulatedSweep: 0,
            arcMode: "centrepoint",
            arcCursorAngle: null,
            polygonSides: null,
            polygonMode: null,
            polygonAdditionalSides: null,
            polygonFeatureType: null
        },
        selection: {
            selectedObjectIds: [],
            boxSelectionIds: [],
            hoveredObjectId: null
        },
        history: {
            past: [],
            future: []
        },

        /*
         * HOW A HISTORY ENTRY REACHES THE SHEET COLLECTION.
         *
         * The collection is not on the state, and cannot be: the editor
         * is the LIVE COPY of the active sheet and the collection sits
         * beside it in the controller. So the controller hands in three
         * functions and the history uses them.
         *
         *   capture  a copy of the whole collection, for the snapshot
         *   restore  put a captured collection back
         *   adopt    re-read the restored active sheet's viewport and
         *            settings into the editor
         *
         * Absent means the document has no collection, which is the
         * case for everything that is not the full editor - the
         * module-load check, the pure geometry tests - and undo then
         * behaves exactly as it always did.
         */
        historySinks: null
    };
}

/*
 * ========================================================
 * THE DEFAULT DRAWING LINE COLOUR, AND WHERE IT COMES FROM
 * ========================================================
 *
 * A NEWLY drawn feature gets a stroke when the student has not chosen one. That
 * value is no longer a fixed literal: it follows the INTERFACE THEME - a dark
 * teal-charcoal on the light sheet, an ice-white on the dark one - so a default
 * line is always legible against the paper it lands on.
 *
 * WHY A SETTABLE VALUE RATHER THAN AN IMPORT.
 *
 * `core` is the model: it has no DOM and no theme. Reading `theme.js` from here
 * would make the model depend on the interface, so instead the EDITOR hands the
 * current theme's default in (`setThemeLineColour`, called when the theme is
 * applied). Core stays pure, and the value it stores is just a colour.
 *
 * THE PRECEDENCE, stated once so there is no second opinion:
 *
 *   1. an EXPLICIT stroke on the style       - the student's own choice, kept
 *   2. `styleDefaults.stroke`, when the user has marked it explicit
 *      (`styleDefaults.strokeExplicit !== false`)               - a saved choice
 *   3. the theme default                      - `themeLineColour`
 *
 * The fallback literal is the LIGHT default, so a module-load check or a pure
 * geometry test - which never sets a theme - still draws a real, dark line.
 */
const LIGHT_LINE_COLOUR = "#193335";

let themeLineColour = LIGHT_LINE_COLOUR;

/*
 * The stroke a NEW feature gets. `overrides.stroke` wins when present, so an
 * explicit colour - the eyedropper, the colour picker, a saved file - is never
 * replaced by the theme default.
 */
function resolveDefaultStroke(overrides = {}) {
    if (overrides && overrides.stroke) {
        return overrides.stroke;
    }

    return themeLineColour;
}

/*
 * Called by the editor when the theme changes, with the theme's own default line
 * colour. It affects only features created AFTERWARDS: nothing re-stamps the
 * existing objects, because the theme must never recolour the drawing.
 */
function setThemeLineColour(colour) {
    if (typeof colour === "string" && /^#[0-9a-fA-F]{6}$/.test(colour)) {
        themeLineColour = colour;
    }

    return themeLineColour;
}

function createStyle(overrides = {}) {
    return {
        stroke: resolveDefaultStroke(overrides),
        fill: "none",
        lineWidth: 0.5,
        lineType: "solid",
        opacity: 1,
        ...overrides
    };
}

/*
 * ========================================================
 * A SUPPORT'S ATTACHMENT IS WHERE IT WAS PUT
 * ========================================================
 *
 * The four support factories all seeded
 *
 *     attachment: seedSupportAttachment(position)
 *
 * which reads as "at the very start of the member". That is not a
 * default the student can see or correct - it is a second position,
 * and the renderer PREFERS it over the `position` they clicked at:
 *
 *     const attachmentPoint = frame
 *         ? attachmentPoint(frame, geometry.attachment)
 *         : null;
 *
 * so every support was drawn at the body's start whatever the cursor
 * was over. That is the "supports jump to the end" report. It was not
 * the placement code and not the snap - both used the cursor's point
 * correctly. The click was recorded, then discarded in favour of a
 * constant written at construction time.
 *
 * THE ATTACHMENT IS SEEDED FROM THE POSITION PASSED IN, and from
 * nothing else. `position` is where the tool put it, so an attachment
 * that says otherwise is the tool disagreeing with itself.
 *
 * `attachmentFor` is not callable from here - it needs the body frame,
 * which only the renderer has at this point - so the attachment is
 * written as a distance along the member, which `attachmentFraction`
 * converts. A support created from a click therefore resolves to the
 * point that was clicked, and one created by the panel at a named
 * position resolves to that position.
 *
 * A SUPPORT WITH NO POSITION AT ALL still starts at zero, because
 * there is nothing else it could mean.
 */
function seedSupportAttachment(
    position,
    attachment = {}
) {
    if (!position) {
        return attachment;
    }

    /*
     * A caller that has already worked out the attachment - the
     * placement path does, from the body frame - is left alone. This is
     * a default for the ones that have not, not an overwrite.
     */
    if (
        attachment.unit === "fraction" &&
        Number.isFinite(Number(attachment.fraction))
    ) {
        return attachment;
    }

    const along = Number(position.distance);

    if (Number.isFinite(along)) {
        return { distance: along };
    }

    const x = Number(position.x);

    if (Number.isFinite(x)) {
        return { distance: x };
    }

    return attachment;
}

function createGeometryObject(type, geometry, options = {}) {
    const generatedId = globalThis.crypto && typeof globalThis.crypto.randomUUID === "function"
        ? globalThis.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const typeLabel = {
        line: "Line",
        point: "Point",
        polyline: "Polyline",
        triangle: "Triangle",
        polygon: "Polygon",
        circle: "Circle",
        arc: "Arc",
        rectangle: "Rectangle",

        /*
         * Statics features. Every one of these is a real,
         * separately selectable feature with its own
         * authoritative type, so it never collapses into a
         * generic Line, Point or generic Force.
         */
        particle: "Particle",
        "rigid-body": "Rigid Body",
        beam: "Beam",
        truss: "Truss",
        cable: "Cable",
        shaft: "Shaft",
        force: "Point Force",
        resultant: "Resultant",
        "force-components": "Force Components",

        /*
         * The three diagram types are separate FEATURES, not
         * one "Diagram" with a setting, so the Features panel
         * reads "SFD 1" rather than "Diagram 1" and the type
         * is visible without opening anything.
         */
        "shear-force-diagram": "SFD",
        "bending-moment-diagram": "BMD",
        "axial-force-diagram": "AFD",
        moment: "Applied Moment",
        load: "Distributed Load",
        "varying-load": "Varying Distributed Load",
        "pin-support": "Pin Support",
        "roller-support": "Roller Support",
        "fixed-support": "Fixed Support",
        "smooth-support": "Smooth Support",
        "pin-connection": "Pin Connection",
        "fixed-connection": "Fixed Connection",
        "slider-connection": "Slider Connection",
        "coordinate-system-2d": "2D Coordinate System",
        /*
         * Named as FEATURES, not as measurements.
         *
         * A dimension is "Dimension 1" in the Features list
         * however it happens to be measured, because that list is
         * how a student finds a dimension to select, edit or
         * delete. Named after the measurement instead, a list of
         * them read as a column of "Horizontal"s with no way to
         * tell them apart.
         *
         * The measurement's own label is not lost: it is on the
         * dimension as it is drawn. A feature's NAME identifies
         * the feature; the measurement describes it.
         */
        dimension: "Dimension",
        annotation: "Annotation",

        /*
         * THE ANNOTATE FEATURES.
         *
         * One type, `annotate`, with a kind deciding the specifics - see
         * features/annotations/annotate-model.js for why one type rather
         * than eight. The NAME is per-kind so a Features list reads
         * "Note 1" and "Leader 2" rather than "Annotate 1" eight times;
         * `addObject` numbers duplicates within a kind through the same
         * naming pass every other feature uses.
         */
        annotate: "Annotation"
    }[type] || type;

    return {
        id: options.id || `${type}-${generatedId}`,
        name: options.name || typeLabel,
        type,
        geometry,
        style: createStyle(options.style),
        metadata: options.metadata || {},

        /*
         * A feature's own non-geometric data, kept whole.
         *
         * A dimension's references and placement, and an
         * annotation's text and source, are not geometry and are
         * not style - but they are the feature. This object
         * returns a fixed set of fields on purpose, so that a
         * caller cannot smuggle an unexpected one in; a feature
         * that needs more than the set has to be added here
         * rather than worked around.
         *
         * Copied rather than referenced, so that the feature
         * cannot be changed by writing to the model it came from,
         * and so that it survives a round trip through
         * serialisation with its own contents rather than a live
         * reference to something that will not be there.
         *
         * SPREAD ONTO THE FEATURE, not nested under `content`.
         *
         * The dimension and annotation models both read their own
         * fields straight off the feature - `dimension.sourceRefs`,
         * `annotation.placement`, `annotation.textMode` - because
         * a model is handed a feature and is entitled to ask it
         * what it is. Nesting those fields under `content` meant
         * every such lookup landed on undefined: a dimension could
         * not be measured or formatted and drew nothing, and an
         * annotation could not find its source feature or its own
         * position. Both stayed well-formed enough to select,
         * save and undo, which is what made the failure quiet.
         *
         * They are spread AFTER the fixed fields so that a
         * dimension or annotation really is the model, and the
         * fixed fields below cannot be overwritten by them.
         */
        ...(options.content
            ? deepClone(options.content)
            : {}),

        /*
         * A child records the feature it belongs to, so
         * a force snapped onto a Beam nests under it in
         * the Feature Tree. Undefined means unattached,
         * which is the normal case for a standalone
         * feature or a piece of plain geometry.
         */
        parentId:
            options.parentId ||
            undefined,

        engineering: options.engineering || undefined
    };
}

const geometryFactories = {
    line: (start, end, options) =>
        createGeometryObject(
            "line",
            { start, end },
            options
        ),

    point: (position, options) =>
        createGeometryObject(
            "point",
            { position },
            options
        ),

    polyline: (points, options) =>
        createGeometryObject(
            "polyline",
            { points },
            options
        ),

    /*
     * A triangle is one feature. Its geometry keeps
     * the three corner points, closed back to the
     * first point, so it stays a single selectable
     * and editable object.
     */
    triangle: (points, options) =>
        createGeometryObject(
            "triangle",
            {
                points,

                closed: true
            },
            options
        ),

    circle: (center, radius, options) =>
        createGeometryObject(
            "circle",
            { center, radius },
            options
        ),

    arc: (center, radius, startAngle, endAngle, options) =>
        createGeometryObject(
            "arc",
            {
                center,
                radius,
                startAngle,
                endAngle
            },
            options
        ),

    rectangle: (position, width, height, rotation = 0, options) =>
        createGeometryObject(
            "rectangle",
            {
                position,
                width,
                height,
                rotation
            },
            options
        ),

    /*
     * A regular polygon is stored as its defining
     * parameters: centre, radius, rotation and side
     * count. The vertices are always derived from
     * these, so the canvas preview, the committed
     * geometry and the Features panel all read and
     * write one authoritative model.
     */
    polygon: (center, radius, sides, rotation = 0, options) =>
        createGeometryObject(
            "polygon",
            {
                center,
                radius,
                sides,
                rotation
            },
            options
        ),

    /*
     * Statics features.
     *
     * A point force is a force applied at one location on
     * a body: an arrow from its point of application, with
     * a magnitude in newtons and a direction in degrees. It
     * is one coherent feature with its own type.
     */
    force: (start, end, options) =>
        createGeometryObject(
            "force",
            {
                start,
                end,
                position: start,
                magnitude: Math.hypot(
                    end.x - start.x,
                    end.y - start.y
                ),
                angle:
                    Math.atan2(
                        end.y - start.y,
                        end.x - start.x
                    ) * 180 / Math.PI
            },

            /*
             * NO LINE WEIGHT IS SET HERE.
             *
             * This factory used to force a force to 2, arguing
             * that a symbol needs more presence than an outline.
             * That put the default thickness of a Point Force at a
             * different number from the default thickness of every
             * other feature, so a force could never be compared
             * with a line and neither was wrong - and because it
             * was applied as a default it was ALSO applied over
             * the top of a width the student or the tool had
             * already chosen, silently discarding it.
             *
             * A force that needs more presence is expressed by
             * setting a line weight, which every feature has and
             * which the Features panel exposes for all of them.
             * A default that quietly disagrees with the rest of
             * the sheet is not a kindness, and one that overrides
             * an explicit choice is a fault.
             *
             * So the options are passed through untouched and the
             * force is drawn at whatever weight was asked for -
             * the same weight a Line would get.
             */
            options
        ),

    forceFromMagnitude: (position, magnitude, angleDegrees, options) => {
        const radians =
            angleDegrees * Math.PI / 180;
        const end = {
            x: position.x + magnitude * Math.cos(radians),
            y: position.y + magnitude * Math.sin(radians)
        };

        return geometryFactories.force(
            position,
            end,
            options
        );
    },

    /*
     * A particle is an idealised body: a point with no
     * size and no rotation. It reuses point geometry
     * internally but keeps its own feature type so the
     * Features panel identifies it correctly.
     */
    particle: (position, options) =>
        createGeometryObject(
            "particle",
            { position },
            options
        ),

    /*
     * A rigid body is a rectangle with size, position and
     * rotation. It reuses the rectangle geometry shape
     * but keeps its own feature type, so it stays one
     * coherent body rather than four separate lines.
     */
    "rigid-body": (position, width, height, options) =>
        createGeometryObject(
            "rigid-body",
            {
                position,
                width,
                height,
                rotation: 0
            },
            options
        ),

    /*
     * Slender structural members: beam, truss, cable and
     * shaft.
     *
     * Each is one coherent feature defined by its two end
     * points, so they share the same shape while keeping
     * their own feature type and their own engineering
     * properties. They are not generic lines with a label
     * attached.
     */
    beam: (start, end, options) =>
        createGeometryObject(
            "beam",
            {
                start,
                end,
                depth: 12
            },
            options
        ),

    /*
     * A truss is one coherent feature: a pin-jointed
     * member span. The panels its renderer draws are
     * visual output, not separate selectable members.
     */
    truss: (start, end, options) =>
        createGeometryObject(
            "truss",
            {
                start,
                end,
                panels: 4
            },
            options
        ),

    cable: (start, end, options) =>
        createGeometryObject(
            "cable",
            {
                start,
                end,
                tension: 0
            },
            options
        ),

    shaft: (start, end, options) =>
        createGeometryObject(
            "shaft",
            {
                start,
                end,
                diameter: 20,
                torque: 0
            },
            options
        ),

    /*
     * Support symbols. Each variant keeps its own feature
     * type so the renderer can draw the right engineering
     * symbol and the panel can name it correctly.
     */
    /*
     * THE SUPPORTS.
     *
     * `position` is where the SYMBOL is drawn, which is outside
     * the body; where it is ATTACHED is carried separately on the
     * geometry, in the body's own frame, by whoever creates it.
     *
     * That separation is the whole of how a support works, and
     * putting it in the factory rather than in the renderer is
     * deliberate: the attachment is part of what the feature IS,
     * so it has to be saved, undone and redone with it. Deriving
     * it at draw time would make a reloaded support depend on the
     * renderer still being asked the same question, and a support
     * moved along its beam would be unable to remember where on
     * the beam it had been.
     *
     * `flipped` is which side of the body the symbol is on. It is
     * false for a new support because the default is the
     * conventional one - underneath a level beam - and it is the
     * only thing the Flip control changes.
     */
    "pin-support": (position, options) =>
        createGeometryObject(
            "pin-support",
            {
                position,
                orientation: 0,
                flipped: false,
                attachment: seedSupportAttachment(position)
            },
            options
        ),

    "roller-support": (position, options) =>
        createGeometryObject(
            "roller-support",
            {
                position,
                orientation: 0,
                flipped: false,
                attachment: seedSupportAttachment(position)
            },
            options
        ),

    "fixed-support": (position, options) =>
        createGeometryObject(
            "fixed-support",
            {
                position,
                orientation: 0,
                flipped: false,
                attachment: seedSupportAttachment(position)
            },
            options
        ),

    "smooth-support": (position, options) =>
        createGeometryObject(
            "smooth-support",
            {
                position,
                orientation: 0,
                flipped: false,
                attachment: seedSupportAttachment(position)
            },
            options
        ),

    /*
     * Connection symbols. Each keeps its own type so the
     * pin, fixed and slider joints render distinctly.
     */
    "pin-connection": (start, end, options) =>
        createGeometryObject(
            "pin-connection",
            { start, end },
            options
        ),

    "fixed-connection": (start, end, options) =>
        createGeometryObject(
            "fixed-connection",
            { start, end },
            options
        ),

    "slider-connection": (start, end, options) =>
        createGeometryObject(
            "slider-connection",
            { start, end },
            options
        ),

    /*
     * A varying distributed load carries an intensity at
     * each end, so it can describe a triangular or
     * trapezoidal distribution without extra geometry.
     * The arrows its renderer draws are visual output of
     * this one feature, not separate selectable features.
     */
    "varying-load": (start, end, startIntensity, endIntensity, options) =>
        createGeometryObject(
            "varying-load",
            {
                start,
                end,
                startIntensity,
                endIntensity,

                /*
                 * ONE UNIT FOR THE WHOLE PROFILE. Every point of a varying
                 * load is stated in the same unit, so it lives on the
                 * geometry rather than on each point - a profile whose points
                 * disagreed about their units could not be drawn on one axis.
                 */
                loadUnit:
                    options?.loadUnit ??
                    "kN/m"
            },
            options
        ),

    /*
     * A distributed load is ONE continuous feature: a body, a
     * single force direction for the whole of it, and a small
     * set of magnitude-defining points along that body. The row
     * of arrows is the renderer sampling the profile between
     * those points, so editing one of them reshapes the field
     * instead of editing one force out of many.
     *
     * `direction` is stored in degrees and shared by every
     * arrow, which is what makes them parallel by construction
     * rather than by the renderer remembering to keep them so.
     */
    load: (start, end, intensity, options) =>
        createGeometryObject(
            "load",
            {
                start,
                end,
                intensity,

                direction:
                    options?.direction ??
                    -90,

                interval: 20,

                /*
                 * THE UNIT THE MAGNITUDE IS STATED IN. kN/m is the drawing's
                 * long-standing unit and the default; the student may switch
                 * the load to N/mm, which is the same physical quantity.
                 */
                loadUnit:
                    options?.loadUnit ??
                    "kN/m",

                points: [
                    {
                        t: 0,
                        magnitude: intensity
                    },
                    {
                        t: 1,
                        magnitude: intensity
                    }
                ]
            },
            options
        ),

    /*
     * AN APPLIED MOMENT IS A ROTATIONAL ACTION AT A POINT.
     *
     * Every part of it is a separate, named fact, and the names
     * matter as much as the values:
     *
     *   position       WHERE it acts. The clicked or snapped point,
     *                 and never anything else - not the body's
     *                 centre, not its nearest end, not a tidier
     *                 spot. Where the student pointed is the
     *                 answer.
     *   magnitude      HOW MUCH. Engineering data, in N-m, and
     *                 wholly independent of how big the symbol is
     *                 drawn.
     *   direction      WHICH WAY it turns, as "CCW" or "CW".
     *   unit           the engineering unit, kept on the feature
     *                 rather than assumed from the document.
     *   arrowType      the head's SHAPE, which is a presentation
     *                 choice like a line width.
     *   arrowSize      the head's size, scaled from the line width
     *                 unless the student overrides it.
     *   arcRadius      how large the curved arrow is DRAWN.
     *
     * DIRECTION IS A WORD, NOT A BOOLEAN.
     *
     * It used to be a `clockwise` flag, and a flag cannot be read:
     * `clockwise: false` leaves the reader working out that the
     * moment is anticlockwise. Worse, it is easy to invert - every
     * place that read it had to remember which way round it was,
     * and one that did not drew the arrow the wrong way round
     * while still being called "correct". A value that names its
     * own meaning removes both problems, and it is the value a
     * saved file and a Features panel can both show.
     *
     * The flag is still accepted below for files saved before
     * this, so an older drawing keeps the direction it was drawn
     * with.
     */
    moment: (
        position,
        magnitude,
        direction,
        options
    ) => {
        const geometry = {
            position,

            /*
             * The direction, normalised. A Moment is
             * anticlockwise unless something says otherwise, and
             * anything that is not recognisably "CW" is treated as
             * anticlockwise rather than being stored verbatim -
             * a direction nobody can read is worse than one that is
             * merely a default.
             */
            direction:
                String(direction) === "CW"
                    ? "CW"
                    : "CCW",

            magnitude: Number(magnitude) || 0,

            /*
             * The engineering unit, stored rather than assumed.
             * A drawing can mix N-m and kN-m, and a moment whose
             * unit is only in the document settings cannot be
             * re-labelled when the document's units change.
             */
            unit: "N·m"
        };

        /*
         * THE RADIUS IS NEVER DERIVED FROM THE MAGNITUDE.
         *
         * It is left unset here, which is the point: a moment that
         * was never resized stores nothing, and the renderer falls
         * back to the shared default. A magnitude of 500 and one
         * of 5 are the same size on the drawing, because a drawing
         * shows which way something turns rather than how hard -
         * and a symbol that grew with its value would be claiming
         * an engineering meaning it does not have.
         */
        return createGeometryObject(
            "moment",
            geometry,
            options
        );
    },

    /*
     * A generic connection link, kept so older saved
     * drawings still load. New connections are created as
     * the specific pin, fixed or slider type.
     */
    connection: (start, end, options) =>
        createGeometryObject(
            "connection",
            {
                start,
                end,
                reaction: 0
            },
            options
        ),

    coordinateSystem2D: (origin, options = {}) => {
        const xAxisLength = Number.isFinite(options.xAxisLength)
            ? options.xAxisLength
            : 25;

        const yAxisLength = Number.isFinite(options.yAxisLength)
            ? options.yAxisLength
            : xAxisLength;

        return createGeometryObject(
            "coordinate-system-2d",
            {
                origin,
                xAxisLength,
                yAxisLength
            },
            options
        );
    },

    /*
     * A dimension and an annotation, as ordinary features.
     *
     * Both go through the feature factories rather than being
     * built inline, so they are named, numbered, selected,
     * deleted and undone by exactly the same code as every other
     * feature. A dimension is a feature on a drawing, not a
     * decoration painted over one.
     *
     * The models are reached by name rather than captured,
     * because drawing-state loads before them. A direct reference
     * would make the load order something that could be got
     * wrong, and getting it wrong would throw at creation time
     * and take the drawing down with it.
     */
    /*
     * A RESULTANT and a FORCE COMPONENTS ANALYSIS.
     *
     * Both are real features rather than answers printed in the status
     * line, because each one carries engineering information that has to be
     * LABELLED: a resultant states its magnitude and direction, and the
     * component analysis states Fx and Fy. Before these existed the
     * annotation kinds for them were correct but had nothing to attach to,

     * so a student could not put "R = 250 N" on the drawing at all.

     *
     * The geometry is deliberately the same shape a Point Force uses -

     * a start, an end, and the magnitude and angle they imply - so the

     * annotation layer, the measurement layer and the renderer can all

     * read them without a special case per kind.

     *
     * What they are NOT is a calculation about the drawing. The resultant

     * tool decides where to place the arrow from the forces the student

     * selected; it does not work out reactions or equilibrium, because the

     * student does that. The values stored are what the student states.

     */
    resultant: (start, end, options) =>
        createGeometryObject(
            "resultant",
            {
                start,
                end,
                position: start,
                magnitude: Math.hypot(
                    end.x - start.x,
                    end.y - start.y
                ),
                angle:
                    Math.atan2(
                        end.y - start.y,
                        end.x - start.x
                    ) * 180 / Math.PI
            },
            options
        ),

    "force-components": (start, end, options) =>
        createGeometryObject(
            "force-components",
            {
                start,
                end,
                position: start,
                magnitude: Math.hypot(
                    end.x - start.x,
                    end.y - start.y
                ),
                angle:
                    Math.atan2(
                        end.y - start.y,
                        end.x - start.x
                    ) * 180 / Math.PI
            },
                       options
                   ),

            /*
             * ========================================================
             * ANALYSIS DIAGRAM TEMPLATES
             * ========================================================
             *
             * A SHEAR FORCE DIAGRAM, a BENDING MOMENT DIAGRAM and an
             * AXIAL FORCE DIAGRAM are each created here as ONE
             * semantic feature, not as a pile of lines and points.
             *
             * They are TEMPLATES, and that is the whole point. EnggDraw
             * draws the frame - a zero axis to measure against, a
             * region to draw in, and the source beam's span where there
             * is one - and the student draws the diagram itself with the
             * ordinary Line and Arc tools. Nothing here computes a shear
             * value, a bending moment, an axial force, a sign or a
             * curve. These tools organise and document the student's own
             * reasoning; solving it for them would remove the only thing
             * the exercise is for.
             *
             * One object each, because that is what one is on the
             * drawing: a student has an SFD, not four hundred lines.
             * Being a single feature is what lets it be selected, moved,
             * named, saved and undone as the single thing it appears to
             * be, and it is why the Features panel reads "SFD 1"
             * instead of a list of anonymous segments.
             *
             * Three named factories rather than one parameterised by a
             * flag, because they are genuinely different documents: they
             * are told apart by name, icon, heading and tint, and folding
             * them together would push that difference into every branch
             * that reads them.
             */

            /*
             * The shape all three share.
             *
             * `diagramType` is the identity. It drives the label, the
             * icon, the tint and the Features-panel entry, so the three
             * are distinguishable at a glance without a heading drawn
             * on the sheet.
             */
            "analysis-diagram": (
                diagramType,
                start,
                end,
                options
            ) =>
                createGeometryObject(
                    "analysis-diagram",
                    {
                        start,
                        end,
                        diagramType,

                        /*
                         * The zero axis is the line the student
                         * measures against, and it is part of the
                         * TEMPLATE rather than a Line feature of its
                         * own.
                         *
                         * A zero axis is a reference, not a piece of
                         * the drawing. It must not be selectable, must
                         * not be dragged away, and must not appear in
                         * the Features list as geometry the student
                         * created. Anything that could accidentally
                         * disturb it would be a fault, so the renderer
                         * draws it from this span and it cannot be
                         * picked up at all.
                         */
                        zeroAxis: {
                            from: { ...start },
                            to: { ...end }
                        },

                        /*
                         * The region the solution is drawn in. A
                         * height, given to the renderer to suggest the
                         * frame without imposing a shape on it: the
                         * student may draw far above or below this and
                         * nothing constrains them to it.
                         */
                        drawingHeight:
                            options?.drawingHeight ??
                            90,

                        /*
                         * Reference positions carried from the source
                         * beam, where the diagram was made from one.
                         *
                         * These are the only things transferred, and
                         * they are positions the student can already
                         * see: the ends of the span, where a support
                         * sits, where a load is applied. Transferring
                         * them saves redrawing the stations.
                         *
                         * Shear jumps, magnitudes, slopes, curve shape
                         * and sign are deliberately excluded. Those are
                         * the solution, and nothing here may produce
                         * one.
                         */
                        referencePositions:
                            options
                                ?.referencePositions ??
                            [],

                        /*
                         * The feature is NAMED as the diagram it is,
                         * so the Features panel and the Feature Tree
                         * read "SFD 1" rather than exposing the shared
                         * "analysis-diagram" type to the student.
                         *
                         * The type stays shared - one renderer, one
                         * hit test, one persistence path for all three -
                         * but the shared type is an implementation
                         * detail and should never be the thing the
                         * student sees. A separate name per feature
                         * keeps the three distinguishable in every list
                         * without branching each of them on a flag.
                         *
                         * The number is supplied by the CALLER, which
                         * counts features of this diagram's own kind.
                         * Counting here would be wrong: it would count
                         * every object on the sheet, so a second SFD
                         * made after a Beam and a truss would arrive as
                         * "SFD 4" and the student would be left
                         * wondering where three diagrams had gone.
                         */

                        /*
                         * Subordinate on purpose: a template that
                         * competes with the geometry drawn on it
                         * defeats its own purpose, so the background is
                         * a faint tint and is never selectable.
                         */
                        backgroundVisible: true
                    },
                    {
                        ...options,

                        /*
                         * The feature's NAME goes here, not in
                         * the geometry, because that is where
                         * createGeometryObject reads it from.
                         * A name placed in the geometry object is
                         * silently ignored and the feature falls
                         * back to its raw type - so the panel
                         * would read "analysis-diagram" and the
                         * student would see the implementation's
                         * type instead of the diagram they made.
                         *
                         * The number is supplied by the CALLER,
                         * which counts features of this kind.
                         * Counting every object instead would make
                         * the second SFD on a sheet that already
                         * has a Beam and a truss arrive as
                         * "SFD 4", and the student would be left
                         * wondering where three diagrams went.
                         */
                        name:
                            options?.name ??
                            diagramType
                    }
                ),

            "shear-force-diagram": (start, end, options) =>
                geometryFactories["analysis-diagram"](
                    "sfd",
                    start,
                    end,
                    options
                ),

            "bending-moment-diagram": (start, end, options) =>
                geometryFactories["analysis-diagram"](
                    "bmd",
                    start,
                    end,
                    options
                ),

            "axial-force-diagram": (start, end, options) =>
                geometryFactories["analysis-diagram"](
                    "afd",
                    start,
                    end,
                    options
                ),

               dimension: (options = {}) => {
        const created =
            enggDimensionModel
                .createDimension(options);

        return createGeometryObject(
            "dimension",
            {},

            /*
             * The measurement is carried through `content`, which
             * createGeometryObject spreads onto the feature itself.
             * It has to arrive that way: the dimension model reads
             * `dimension.sourceRefs` and `dimension.placement`
             * directly, so a feature that hid them one level down
             * could not be measured, formatted or drawn.
             *
             * Only the identity is passed alongside it. The NAME is
             * left to addObject, which derives it from the
             * feature's type and numbers it - so dimensions read as
             * "Dimension 1", "Dimension 2" in the Features list
             * however they are measured.
             *
             * Passing the model's own name bypassed that, and the
             * model's name is the measurement's label, which is
             * right for a panel heading and wrong for a feature
             * identity: a student looking for their dimension in
             * the list would have found a column of
             * "Horizontal"s and "Vertical"s.
             */
            {
                id: created.id,
                content: {
                    dimensionType:
                        created.dimensionType,
                    sourceRefs:
                        created.sourceRefs,
                    placement:
                        created.placement,
                    label: created.label,
                    orientation:
                        created.orientation,
                    /*
                     * THE DRIVEN BIT TRAVELS TOO.
                     *
                     * It was left out here, so a Driven dimension built through the
                     * factory - which is EVERY dimension the tool creates - arrived
                     * without its state and behaved as Driving. A dimension that had
                     * been created as a reading could then move geometry, which is
                     * the exact thing the Driven state exists to prevent. The model
                     * sets the bit; the factory has to carry it, or the two disagree
                     * about what the feature is.
                     */
                    driven: created.driven === true,
                    resolved:
                        created.resolved
                }
            }
        );
    },

    "variable-dimension": (options = {}) => {
        const created =
            enggVariableDimension
                .createVariableDimension(options);

        /*
         * THE SYMBOL TRAVELS IN `content`, like a dimension's measurement.
         *
         * The panel, the renderer and the hit test all read `variable.symbol`
         * off the feature itself, so it has to arrive at that level rather than
         * one layer down. The name is left to `addObject`, which numbers it -
         * so a list of them reads "Variable Dimension 1, 2, 3".
         */
        return createGeometryObject(
            "variable-dimension",
            {},
            {
                id: created.id,
                content: {
                    sourceRefs: created.sourceRefs,
                    symbol: created.symbol,
                    unknown: created.unknown,
                    label: created.label,
                    placement: created.placement,
                    orientation: created.orientation
                }
            }
        );
    },

    annotation: (options = {}) => {
        const created =
            enggAnnotationModel
                .createAnnotation(options);

        return createGeometryObject(
            "annotation",
            {},

            /*
             * Carried through `content` and spread onto the
             * feature, for the same reason as a dimension's
             * measurement: the annotation model reads
             * `annotation.textMode`, `annotation.sourceFeatureId`
             * and `annotation.placement` off the feature itself.
             *
             * These four are deliberately not folded together.
             * The link to the source feature, the text the label
             * currently shows, where the student has put the box,
             * and whether that position was their choice are four
             * separate facts. Keeping them apart is what lets the
             * student move the text box anywhere on the sheet
             * while it goes on updating from its feature.
             */
            {
                id: created.id,
                content: {
                    annotationKind:
                        created.annotationKind,
                    textMode: created.textMode,
                    text: created.text,
                    sourceFeatureId:
                        created.sourceFeatureId,
                    anchorRef:
                        created.anchorRef,
                    placement:
                        created.placement,
                    placementMode:
                        created.placementMode,
                    leader: created.leader,
                    visible: created.visible,
                    unresolved:
                        created.unresolved ??
                        false
                }
            }
        );
    },

    /*
     * THE ANNOTATE FEATURES: notes, labels, leaders, callouts, arrows,
     * symbols, tolerances and tables.
     *
     * ONE factory for all eight, because they are one type. The kind lives
     * in `content.annotateKind` and the specifics - a tolerance's mode and
     * values, a table's grid, a symbol's id - live in `content.geometry`,
     * which `createGeometryObject` copies verbatim on the way onto the
     * feature and `cloneFeatureForSave` copies on the way into a file.
     *
     * The geometric data is therefore REAL geometry on the feature, not a
     * borrowed field: it moves with the drawing, survives zoom and Fit, and
     * serialises without any special case in the save or load path.
     */
    annotate: (options = {}) => {
        const created =
            enggAnnotate.createAnnotate(options);

        return createGeometryObject(
            "annotate",
            created.geometry,
            {
                id: created.id,

                /*
                 * NAMED BY ITS KIND, so a Features list reads "Note 1",
                 * "Leader 2", "Table 1" rather than "Annotation 1" eight
                 * times. `addObject` numbers duplicates within a name through
                 * the same pass every other feature uses, so two notes become
                 * Note 1 and Note 2 without any numbering logic here.
                 */
                name: created.name,
                style: created.style,
                content: {
                    annotateKind: created.annotateKind,
                    text: created.text,
                    targetFeatureId: created.targetFeatureId,
                    visible: created.visible
                }
            }
        );
    }
};

/*
 * A fresh identity for a pasted copy.
 *
 * addObject only renames a feature; the identity is minted
 * when a feature is first created. A copy is created by
 * cloning rather than by running the factory, so it needs an
 * identity of its own here, or it would arrive with none and
 * could not be selected, found in the tree or referenced.
 *
 * The original's id is deliberately not reused: two features
 * sharing one would make the copy impossible to tell from the
 * thing it was copied from.
 */
function newFeatureId(
    type
) {
    const generated =
        globalThis.crypto &&
        typeof globalThis.crypto.randomUUID ===
            "function"
            ? globalThis.crypto.randomUUID()
            : `${Date.now()}-${Math.random()
                    .toString(16)
                    .slice(2)}`;

    return `${type}-${generated}`;
}

/*
 * Add a feature to the document, and return THE OBJECT THAT WAS STORED.
 *
 * RETURNING THE STORED OBJECT IS THE POINT OF THIS CHANGE, and it fixes a
 * trap that had already caught two features.
 *
 * The naming branch below builds `{ ...object, name }` - a SHALLOW COPY - and
 * pushes THAT. So a caller who kept the object it passed in was holding a
 * reference to something NOT in the document: every later write to it, however
 * correct, changed nothing on the sheet. A Moment's magnitude popup wrote
 * `unknownValues` onto the copy, and the panel went on showing the placeholder.
 *
 * The two branches also used to return DIFFERENT KINDS of thing - the copy in
 * one, and an id string in the other - so a caller could not rely on either.
 * They now both return the stored object, which carries its `id`, so an
 * existing `const id = addObject(...)` still works.
 */
function addObject(state, object) {
    const baseName =
        object.name.match(/\d+$/)
            ? object.name.replace(
                  /\d+$/,
                  ""
              ).trim()
            : object.name;

    const nameIndex =
        state.objects.filter(
            candidate =>
                candidate.type === object.type
        ).length + 1;

    /*
     * A NAME THE CALLER ASKED FOR SPECIFICALLY IS USED AS GIVEN.
     *
     * Everything below numbers features by their TYPE, because
     * that is right for almost every feature: two rectangles
     * are "Rectangle 1" and "Rectangle 2" whichever way round
     * they were added, and a pasted copy never arrives as a
     * second "Rectangle 1".
     *
     * It is not right when one type covers several genuinely
     * different features. The three analysis diagrams share
     * the "analysis-diagram" type - deliberately, so they get
     * one renderer, one hit test and one persistence path - so
     * numbering by type made an SFD, a BMD and an AFD read
     * "SFD 1", "SFD 2", "SFD 3". The student sees three
     * different diagrams carrying three different names, and
     * the type-based numbering has quietly thrown that away.
     *
     * A caller that has already worked out the name it wants -
     * because it counts a real category, not a storage type -
     * therefore gets exactly that name.
     *
     * The name must still not CLASH. A repeated name is left to
     * the numbering below, so two features of the same kind are
     * never both called "SFD 1"; only a name that is free is
     * honoured. The check is on the name and not the type, so
     * a genuine collision anywhere on the sheet is caught.
     */
    const requestedName =
        typeof object.name === "string" &&
        object.name.trim() !== "" &&
        !state.objects.some(
            candidate =>
                candidate.name === object.name
        );

    if (requestedName) {
        /*
         * A SHALLOW COPY, but it is the copy that is STORED and RETURNED - so
         * a caller's reference is the document's object rather than a stray
         * one the naming step left behind.
         */
        const named = {
            ...object,
            name: object.name
        };

        state.objects.push(named);

        return named;
    }

    /*
     * Every feature of a type is numbered in order, so a
     * pasted copy is "Rectangle 2" rather than a second
     * "Rectangle 1". The name of the feature being added is
     * never trusted to already carry the right number,
     * because a copy necessarily carries the number it was
     * copied from.
     */
    object.name = `${baseName} ${nameIndex}`;

    /*
     * A feature cloned by the clipboard arrives without an
     * identity, because it was copied rather than created.
     * One is minted here so the copy is a first-class feature:
     * selectable, listed in the tree, and independent of the
     * feature it was copied from.
     */
    if (!object.id) {
        object.id = newFeatureId(
            object.type
        );
    }

    state.objects.push(object);

    return object;
}
function removeObject(state, objectId) {
    state.objects = state.objects.filter(
        object => object.id !== objectId
    );

    state.selection.selectedObjectIds =
        state.selection.selectedObjectIds.filter(
            id => id !== objectId
        );
}

/*
 * ========================================================
 * DELETING SOMETHING DELETES WHAT DEPENDS ON IT
 * ========================================================
 *
 * The parent relationship is not a tree the Feature Tree draws and
 * nothing more - it is a statement that the child has no meaning
 * without the parent. A support with no member is not a support, it is
 * an arrowhead in empty space; a diagram with no span has no x-axis to
 * put an x (m) label on.
 *
 * So deleting a Beam removes its supports, loads, moments, connections
 * and diagrams, and deleting a support removes whatever it in turn
 * carried. What was left standing before was the reason a deleted
 * diagram kept drawing its axes: not a node the renderer failed to
 * clear, but a FEATURE that was still in the document with nothing
 * behind it.
 *
 * ONE PASS, BOTTOM-UP, AND NOT A LOOP.
 *
 * The descendants are collected first and the list is filtered once.
 * Iterating until nothing changed would be simpler to write and would
 * hang on a file whose parentId fields had somehow formed a cycle -
 * which is the sort of corruption a partially-written save produces,
 * and the one moment where hanging is least acceptable. Collecting
 * cannot loop at all.
 *
 * THE SELECTION AND THE HOVER CLEAR TOO.
 *
 * Leaving a deleted child's id in `selectedObjectIds` produces a
 * selection pointing at nothing, which the panel then renders as an
 * empty property page and the next click has to dig out of.
 */
function removeObjectsAndDescendants(
    state,
    ids
) {
    const roots = ids instanceof Set
        ? [...ids]
        : Array.isArray(ids)
            ? [...ids]
            : ids
                ? [ids]
                : [];

    if (!roots.length) {
        return [];
    }

    /*
     * A parent index, so "who depends on this" is one lookup rather
     * than a scan per level. Rebuilt from the CURRENT list only, so a
     * parentId naming a feature that is not there simply matches
     * nothing and the child is treated as a root - which is what keeps
     * an older file with a dangling reference readable instead of
     * silently deleting half the sheet.
     */
    const childrenOf = new Map();

    state.objects.forEach(object => {
        if (!object.parentId) {
            return;
        }

        const siblings =
            childrenOf.get(object.parentId) || [];

        siblings.push(object.id);

        childrenOf.set(
            object.parentId,
            siblings
        );
    });

    const doomed = new Set(roots);
    const queue = [...roots];

    while (queue.length) {
        const id = queue.pop();

        (childrenOf.get(id) || []).forEach(childId => {
            /*
             * Only ever enqueued ONCE. `doomed` is the visited set as
             * well as the removal set, so a cycle terminates here
             * rather than running forever.
             */
            if (doomed.has(childId)) {
                return;
            }

            doomed.add(childId);
            queue.push(childId);
        });
    }

    state.objects = state.objects.filter(
        object => !doomed.has(object.id)
    );

    state.selection.selectedObjectIds =
        state.selection.selectedObjectIds.filter(
            id => !doomed.has(id)
        );

    if (Array.isArray(state.selection.boxSelectionIds)) {
        state.selection.boxSelectionIds =
            state.selection.boxSelectionIds.filter(
                id => !doomed.has(id)
            );
    }

    if (
        doomed.has(state.selection.hoveredObjectId)
    ) {
        state.selection.hoveredObjectId = null;
    }

    resetScaleIfSheetIsEmpty(state);

    return [...doomed];
}

/*
 * ========================================================
 * AN EMPTY SHEET HAS NO SCALE
 * ========================================================
 *
 * A sheet's scale is the relationship between ITS geometry and
 * real lengths, so when the last of that geometry is gone the
 * relationship has nothing left to relate. Keeping it would mean a
 * new beam drawn on the emptied sheet was silently measured with a
 * calibration established by geometry that no longer exists - the
 * student would be told a length nobody could account for.
 *
 * So the scale is dropped automatically, with no command for the
 * student to find, and the sheet's next first length establishes a
 * new one. That is the same rule the first length used to follow,
 * applied from the other end.
 *
 * ONLY THE ACTIVE SHEET IS CONSIDERED. The scale belongs to a
 * sheet, so emptying this one says nothing about any other: a
 * second sheet with its own calibration keeps it.
 *
 * WHAT DECIDES IT: THE LAST LENGTH FEATURE.
 * ----------------------------------------
 * The scale is DEFINED by a Length - the first dimension states what a drawn
 * distance really is - so it is the LENGTH FEATURES that hold it, not the raw
 * geometry. When the last of them is deleted the scale has nothing left behind
 * it, and a beam still sitting on the sheet does not change that: the thing that
 * declared what the beam MEASURED is what has gone.
 *
 * That is the rule the first-length calibration already follows, read from the
 * other end, and it is why this asks about Length features rather than about
 * whether any geometry remains.
 */

/*
 * THE FEATURES THAT CAN DEFINE THE SCALE.
 *
 * A measured dimension is the ONE feature that states what a drawn distance is
 * really worth, so it is the one that establishes the sheet's scale - and when
 * the last one is deleted the scale has nothing left behind it.
 *
 * A `variable-dimension` is deliberately absent: it names a symbol (`L`, `L/2`)
 * rather than declaring a measurement, and a variable has never been able to
 * calibrate a sheet. Counting it here would keep a stale scale alive behind a
 * feature that never established it.
 */
const SCALE_DEFINING_TYPES = new Set([
    "dimension"
]);

function resetScaleIfSheetIsEmpty(state) {
    if (!state.scale) {
        return false;
    }

    const objects = state.objects || [];

    /*
     * ========================================================
     * THE LAST LENGTH FEATURE TAKES THE SCALE WITH IT
     * ========================================================
     *
     * The scale is DEFINED by a Length - the first dimension states what a
     * drawn distance really is - so when the last of those goes, the
     * definition has nothing left behind it and is reset. The NEXT Length the
     * student makes becomes the new defining one, exactly as the first ever
     * did.
     *
     * THIS IS ASKED FIRST, BEFORE THE GEOMETRY TEST BELOW, because it is the
     * narrower and more precise question: a sheet may still carry a beam and a
     * load while every Length has been deleted, and the requirement is that the
     * scale resets then too - not only when the sheet is swept completely bare.
     *
     * WHAT COUNTS AS A LENGTH FEATURE. The structured kinds that state a
     * measured length between geometry: a `dimension`. A `variable-dimension`
     * is deliberately NOT one - it names a symbol (`L`, `L/2`) rather than
     * declaring what the drawing measures, and a variable has never been able
     * to establish a scale.
     */
    const holdsLengthFeature = objects.some(object =>
        SCALE_DEFINING_TYPES.has(object.type)
    );

    if (holdsLengthFeature) {
        return false;
    }

    /*
     * NO LENGTH FEATURE REMAINS, so the scale goes.
     *
     * The geometry test that used to be the whole condition is subsumed by
     * this one and is not asked separately. Its question - "is any drawn
     * geometry left?" - was the right question while the scale was held by the
     * GEOMETRY itself. Now that a Length DEFINES the scale, a sheet can keep
     * every beam it ever drew and still have no scale to relate them to, because
     * the feature that declared what they measured is gone.
     *
     * Leaving the geometry test in would in fact be the bug: a beam with no
     * dimension on it would keep a calibration whose only justification has been
     * deleted, and the next Length the student drew would be measured against a
     * scale they can no longer see the source of.
     */

    /*
     * Left in the HISTORY SNAPSHOT rather than applied here.
     *
     * This function runs while the edit is being made, but Undo
     * works from snapshots taken before each change - and those
     * already carry the scale. So resetting here makes the current
     * state correct, and Undo restores the snapshot that had the
     * scale in it, which is the same reasoning that lets Undo put
     * a calibration back after it was withdrawn.
     */
    state.scale = null;

    return true;
}

function selectObjects(state, objectIds) {
    state.selection.selectedObjectIds = [
        ...new Set(objectIds)
    ];
}

function selectObject(state, objectId) {
    selectObjects(state, [objectId]);
}

function clearSelection(state) {
    state.selection.selectedObjectIds = [];
}

/*
 * A DEEP COPY OF WHATEVER THE HISTORY STORES, through the shared helper.
 *
 * WHAT THIS IS HANDED IS NOT ALWAYS AN ARRAY. It began as the feature list,
 * and it is now the DOCUMENT snapshot - an object carrying the objects, the
 * sheets, the scale and the camera - so a helper that assumed a list returned
 * an empty array and Undo restored an empty drawing.
 *
 * `deepClone` copies either shape, which is why it is the one used here. The
 * array-shaped `deepCloneAll` exists for the callers that genuinely have only
 * a list and want the empty case answered without a JSON round trip; it is
 * deliberately not used on a value that might not be one.
 */
function cloneObjects(objects) {
    return deepClone(objects);
}

/*
 * ========================================================
 * THE SNAPSHOT EVERY EDIT TAKES
 * ========================================================
 *
 * A DOCUMENT snapshot - the objects AND the sheet collection - rather
 * than a list of objects.
 *
 * It used to be a plain list. That made undo work perfectly for
 * drawing edits and silently do nothing for everything else about the
 * document, which is most of it: the editor is the LIVE COPY of the
 * active sheet, and a snapshot of one sheet's objects cannot express a
 * sheet being added, renamed, reordered or deleted, nor a change to
 * another sheet's features, nor the document's units.
 *
 * CHANGED HERE RATHER THAN AT FORTY-EIGHT CALL SITES.
 *
 * Every mutation in the application takes its "before" snapshot with
 * this one call, and every one of them commits through the same
 * commit. Making the snapshot a document snapshot therefore fixes all
 * of them at once - including the sheet operations that were never
 * going to be covered by a per-call-site change - and leaves one place
 * where "what an undo step restores" is decided.
 *
 * THE SHAPE IS ACCEPTED BOTH WAYS on restore, so an entry from before
 * this change - a bare list - still restores rather than throwing.
 */
/*
 * ========================================================
 * THE DEPENDENCIES MUST UPDATE WHILE THE STUDENT TYPES
 * ========================================================
 *
 * `commitDrawingChange` is where every analysis object is refreshed -
 * a Components pair and a Resultant included - because it is the one
 * place every committed edit passes through.
 *
 * The panel's typing handler used to call it on `change`, which is
 * when a field loses focus. So a student typing a new magnitude into a
 * force's panel watched the arrow move and the decomposition beside it
 * stay at the old value until they clicked somewhere else. The
 * feature bar and the drawing disagreed for as long as they kept
 * typing, which is exactly as long as it takes to think something is
 * broken.
 *
 * So the refresh is asked for DIRECTLY here, on every keystroke. The
 * commit still happens on blur, which is where the history entry
 * belongs - one entry for the whole edit rather than one per
 * character - and because `commitDrawingChange` refreshes again before
 * it snapshots, the undo entry is still consistent.
 *
 * NOTHING IS RECORDED FOR THE TYPING. A refresh is a derived value
 * catching up with the authoritative one, which is a consequence of an
 * edit and not an edit of its own; recording it would fill the undo
 * stack with one entry per keystroke.
 */
function refreshDerivedFeatures(state) {
    refreshAnalysisObjects(state);

    return state;
}

    function snapshotDrawing(state) {
    return snapshotDocument(state);
}

/*
 * The dependency registry is set by its own module at load time,
 * and held here rather than reached for directly, so this module
 * keeps no knowledge of it and the analysis update can be absent -
 * as it is in the module-load check - without this one failing.
 */
let analysisDependencyRegistry = null;

function setAnalysisDependencyRegistry(registry) {
    analysisDependencyRegistry = registry;
}

function refreshAnalysisObjects(state) {
    if (!analysisDependencyRegistry) {
        return 0;
    }

    return analysisDependencyRegistry.refreshAll(state);
}

function resolveAnalysisAfterDeletion(
    state,
    deletedIds
) {
    if (!analysisDependencyRegistry) {
        return [];
    }

    return analysisDependencyRegistry.resolveDeletedSources(
        state,
        deletedIds
    );
}

/*
 * Notified whenever the document is committed to, so the
 * controller can mark it as having unsaved changes.
 *
 * Set by the controller at startup. It is a hook rather than a
 * direct call so that this module stays free of any knowledge of
 * files, and so the notification is impossible to invoke by
 * accident from elsewhere.
 */
let onDocumentChanged = null;

function commitDrawingChange(state, previousObjects) {
    /*
     * Keep every Analysis object true of its sources, HERE, before
     * the snapshot is taken.
     *
     * This is the one place every committed edit passes through -
     * a created feature, a dragged handle, a typed magnitude, a
     * reversed load - so putting the refresh here means no tool
     * needs to know that a Resultant exists, and a tool written
     * tomorrow is covered without being thought about. Putting it
     * anywhere else would mean every path that can change a force
     * had to remember to update the analysis that depends on it.
     *
     * IT IS HERE, NOT IN EACH TOOL, BECAUSE OF HISTORY.
     *
     * The refresh runs BEFORE the previous state is captured for
     * the Undo stack, so the snapshot it stores is the one in which
     * the analysis objects were ALREADY consistent with their
     * sources. Undoing therefore returns the force to where it was
     * with its components correct for that moment, rather than
     * restoring a components object that was still describing the
     * old position - which is the state a student would see if
     * Undo ran before the refresh, and the one they would report
     * as Undo being broken.
     *
     * And it records nothing itself: one edit by the student is
     * one entry in the History list, however many analysis objects
     * it happened to update.
     */
    refreshAnalysisObjects(state);

    pushHistory(
        state.history.past,
        cloneObjects(previousObjects)
    );

    state.history.future = [];

    /*
     * Every committed edit passes through here, so this is the
     * one place that knows the document no longer matches what
     * is on disk.
     *
     * Marking it here rather than in each of the many code paths
     * that edit the drawing - a created feature, a dragged
     * handle, a typed value, a reversed load, an edited
     * distribution point - is what means none of them can be
     * forgotten. A missed call would mean the unsaved indicator
     * lies and the user loses work on close.
     *
     * The controller owns the document's file and dirty state,
     * so it is told rather than asked; this module has no opinion
     * about files.
     */
    if (
        typeof onDocumentChanged === "function"
    ) {
        onDocumentChanged();
    }
}

function restoreObjects(state, objects) {
    state.objects = cloneObjects(objects);

    const existingIds = new Set(
        state.objects.map(object => object.id)
    );

    state.selection.selectedObjectIds =
        state.selection.selectedObjectIds.filter(
            id => existingIds.has(id)
        );

    clearInteraction(state);
}

/*
 * Replace the document's objects with a set read from a file.
 *
 * The objects arrive with the ids they were saved under, and
 * those ids are the whole of the file's relationship model: a
 * load's parent, a support's body, a dimension's measured
 * geometry. They are therefore kept exactly as they are, rather
 * than being regenerated, so a child that was saved under a
 * particular parent comes back under that same parent. A fresh
 * id would silently break every relationship in the file.
 */
function restoreDocument(state, document) {
    if (document && Array.isArray(document.objects)) {
        restoreObjects(state, document.objects);
    }

    if (document?.units) {
        state.units = document.units;
    }

    if (document?.scale) {
        state.scale = { ...document.scale };
    }

    return state;
}

/*
 * ========================================================
 * WHAT A HISTORY ENTRY ACTUALLY IS
 * ========================================================
 *
 * A DOCUMENT SNAPSHOT, not a list of objects.
 *
 * It used to be `state.objects` and nothing else, which made undo
 * work perfectly for drawing edits and silently do nothing for
 * everything else about the document - and most of everything else is
 * not on the current sheet.
 *
 * The application holds a COLLECTION of sheets, each with its own
 * features, its own viewport and its own history; the editor shows one
 * of them. A snapshot of the active sheet's objects therefore cannot
 * express:
 *
 *   - a sheet being added, removed, renamed or reordered,
 *   - a change to ANOTHER sheet's features,
 *   - a change to the document's units or scale.
 *
 * So the collection goes into the snapshot too. `sheets` is whatever
 * the caller supplies through `state.historySinks` - the editor is the
 * live copy of the active sheet, and the sheet collection lives
 * alongside it, so it cannot be reached from here without being handed
 * in. A document with no collection simply has none in its snapshots,
 * which is exactly what it was doing before and still works.
 *
 * THIS IS ONE ENTRY PER USER ACTION, still. Adding the collection does
 * not add entries: it makes the ONE entry each action already makes
 * complete, so Undo puts the whole document back rather than only the
 * part of it that happened to be on screen.
 */
function setHistorySinks(state, sinks) {
    state.historySinks = sinks || null;

    return state;
}

/*
 * THE ENTRY IS AN ARRAY WITH THE COLLECTION ON IT.
 *
 * An array, carrying `sheets` as a property, rather than an object
 * with `objects` on it. That looks odd and is deliberate: every one of
 * the forty-odd call sites passes the result straight back to
 * `commitDrawingChange`, and a change in shape would break all of them
 * at once for no gain. An array also compares and serialises the way
 * the code has always expected, so nothing downstream can tell the
 * difference.
 */
function snapshotDocument(state) {
    const entry = cloneObjects(state.objects);

    const sinks = state.historySinks;

    if (sinks && typeof sinks.capture === "function") {
        /*
         * THE COLLECTION IS A BONUS, NOT A REQUIREMENT.
         *
         * The objects are what Undo is fundamentally about, and they
         * are captured before the sink is even asked. So a sink that
         * throws - a renamed function, a missing sheet module - must
         * cost the sheet history and nothing else.
         *
         * This is not a hypothetical guard. The first version of this
         * called three functions that did not exist, and because a
         * snapshot is taken on the click that PLACES every feature,
         * the throw happened on every tool in the application: nothing
         * could be drawn at all. A history improvement took out the
         * whole editor.
         */
        try {
            entry.sheets = sinks.capture();
        } catch (error) {
            entry.sheets = null;
        }
    }

    /*
     * ========================================================
     * THE ENTRY HAS TO BE AN OBJECT, NOT AN ARRAY WITH A PROPERTY
     * ========================================================
     *
     * The entry used to be the cloned array itself, carrying the
     * collection as a property hung off it - which looks like a way of
     * changing nothing about a shape forty-eight call sites depend on,
     * and is exactly that until anything SERIALISES it.
     *
     * `commitDrawingChange` stores the snapshot with
     * `cloneObjects`, which is `JSON.parse(JSON.stringify(...))`, and
     * JSON serialises an array's ELEMENTS and nothing else. Every other
     * property on that array is silently dropped. So `sheets` was
     * attached, passed through the commit, and deleted - and Undo
     * restored the objects perfectly while the collection was quietly
     * never there.
     *
     * The shape is changed HERE rather than at the call sites, and the
     * restore accepts both: an entry written now is an object with
     * `objects` on it, and one from before this change is a bare array.
     * That means an existing history stack - a drawing reopened from a
     * file, a session still open - keeps undoing.
     */
    return {
        version: 1,
        objects: entry,
        sheets: entry.sheets ?? null,

        /*
         * THE CALIBRATION TRAVELS WITH THE OBJECTS.
         *
         * A length only means something because of the scale, so a
         * snapshot that restored the geometry but not the scale restored
         * a drawing whose every dimension was wrong by a factor nobody
         * could see - Undo of anything that followed a calibration gave
         * back the numbers but not their meaning.
         *
         * `null` is the honest answer for a document that has never been
         * calibrated, and it is distinct from a missing field for the same
         * reason it is in the document: "never calibrated" and "calibration
         * lost" must not look alike.
         */
        scale: state.scale
            ? deepClone(state.scale)
            : null
    };
}

function restoreDocumentSnapshot(state, entry) {
    /*
     * THE COLLECTION FIRST.
     *
     * Sheets are restored before objects because restoring a sheet can
     * make one active, and making one active writes the editor's
     * current objects into it - which would stamp the outgoing sheet
     * with the incoming sheet's features.
     */
    const sinks = state.historySinks;

    if (
        entry &&
        entry.sheets &&
        sinks &&
        typeof sinks.restore === "function"
    ) {
        try {
            sinks.restore(entry.sheets);
        } catch (error) {
            /* See snapshotDocument: a sink cannot break Undo. */
        }
    }

    restoreObjects(state, entry.objects || entry);

    /*
     * ...AND THE SCALE WITH IT, and from the entry rather than from
     * whatever the document happens to hold now. The snapshot is the
     * whole state at one moment, and restoring only part of it is how a
     * drawing ends up self-inconsistent: real geometry paired with
     * somebody else's scale.
     */
    if (entry && Object.prototype.hasOwnProperty.call(entry, "scale")) {
        state.scale = entry.scale
            ? deepClone(entry.scale)
            : null;
    }
    /*
     * A RESTORED SHEET'S VIEWPORT AND SETTINGS.
     *
     * The objects are the sheet's content, but the editor's zoom, pan,
     * grid and snapping came from it too, and restoring only the objects
     * leaves the sheet looking at the drawing through the previous
     * sheet's camera.
     */
    if (sinks && typeof sinks.adopt === "function") {
        try {
            sinks.adopt(state);
        } catch (error) {
            /* See snapshotDocument: a sink cannot break Undo. */
        }
    }
}

/*
 * HOW FAR BACK UNDO GOES.
 *
 * Every history entry is a full copy of the document, so an unbounded
 * history grows with every edit for as long as the page is open - a long
 * session on a large drawing would hold hundreds of copies of it. A
 * hundred steps is far more than anyone undoes; the oldest is dropped
 * once there are more.
 */
const HISTORY_LIMIT = 100;

function pushHistory(list, entry) {
    list.push(entry);

    if (list.length > HISTORY_LIMIT) {
        list.splice(0, list.length - HISTORY_LIMIT);
    }
}

function canUndo(state) {
    return state.history.past.length > 0;
}

function canRedo(state) {
    return state.history.future.length > 0;
}

function undo(state) {
    if (!canUndo(state)) {
        return false;
    }

    pushHistory(
        state.history.future,
        snapshotDocument(state)
    );

    restoreDocumentSnapshot(
        state,
        state.history.past.pop()
    );

    return true;
}

function redo(state) {
    if (!canRedo(state)) {
        return false;
    }

    pushHistory(
        state.history.past,
        snapshotDocument(state)
    );

    restoreDocumentSnapshot(
        state,
        state.history.future.pop()
    );

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

    /*
     * The snap context is part of the interaction, so it is
     * cleared with it.
     *
     * Leaving it behind would be actively wrong rather than
     * merely untidy: a finished truss's members would keep
     * being published as live construction geometry, so a
     * later construction would snap to a structure that is
     * no longer being drawn, and a leftover quarter flag
     * would offer quarter regions to a tool that must not
     * have them.
     */
    state.interaction.snapGeometry = [];
    state.interaction.snapQuarterSnap = false;
    state.interaction.snapToolId = null;

    /*
     * A construction that is over has no guide to hold, and
     * a leftover one would be drawn over the next drawing
     * until the pointer happened to move.
     */
    state.interaction.guideline = null;

    /*
     * The parent is decided by the first click of a
     * span tool, so it is cleared with the rest of the
     * interaction. Leaving it behind would let a later
     * force attach itself to a body the student has
     * stopped working on.
     */
    state.interaction.parentId = null;

    /*
     * A body-attached feature holds its target body and
     * the points placed on it only for the life of the
     * operation. Dropping them here is what makes a
     * cancelled load or support leave the body untouched
     * and create no partial feature.
     */
    state.interaction.staticsTarget = null;
    state.interaction.attachmentPoints = [];

    /*
     * A truss under construction is temporary state too, so
     * it is dropped with the rest of the interaction. Nothing
     * it has drawn can survive a cancel, which is what keeps
     * a half-built structure out of the feature collection.
     */
    state.interaction.trussStage = 0;
    state.interaction.trussMembers = [];
    state.interaction.trussOutline = [];
    state.interaction.trussInProgress = null;
    /*
     * A dimension being created.
     *
     * Held on the interaction rather than on the feature because a
     * dimension does not exist until it is placed: Escape has to be
     * able to leave nothing behind, and clearInteraction is what
     * runs on Escape and on switching tools. Everything here is
     * therefore temporary, and clearing it removes no committed
     * dimension from the drawing.
     */
    state.interaction.dimensionTarget = null;
    state.interaction.dimensionTargets = null;
    state.interaction.dimensionRefs = null;
    state.interaction.dimensionPlacement = null;

    /*
     * THE SMART DIMENSION STATE MACHINE.
     *
     * `dimensionStage` records where in the workflow the tool is -
     * collecting references, or placing the annotation - and the
     * reference fields hold everything chosen so far.
     *
     * `dimensionPickedRefs` is the ACCUMULATED selection. It is
     * cleared here for the same reason as everything beside it and
     * with the same consequence if it were not: the tool now
     * collects references until Enter, so this array is the whole
     * of what the student has chosen, and a stale entry would
     * silently measure the next dimension against geometry from
     * the last one.
     */
    state.interaction.dimensionStage = null;
    state.interaction.dimensionFirstRef = null;
    state.interaction.dimensionFirstPoint = null;
    state.interaction.dimensionSecondRef = null;
    state.interaction.dimensionPickedRefs = null;
    state.interaction.dimensionChoice = null;
    state.interaction.dimensionCandidates = null;
    /*
     * THE ANALYSIS AXIS BEING POSITIONED.
     *
     * The same reasoning as the dimension above, and the same omission
     * once caused it. `renderPreview` draws this as a complete
     * analysis-diagram in the diagram's own colour - the SFD's is
     * #1f5c38 - so a placement left behind is a green graph that stays
     * on the sheet after the real one has been created, moved or
     * deleted. Nothing else removed it: the field was set on every
     * pointermove during placement and belonged to no clear path, so
     * it survived the phase change that ended the placement.
     *
     * It is temporary in exactly the sense the rest of this function
     * means - it exists only while the axis is being dragged - so it
     * goes here with everything else.
     */
    state.interaction.analysisPlacement = null;

    /*
     * THE MOMENT'S TWO TEMPORARY FIGURES.
     *
     * `placementY` is where the student's pointer put the moment
     * during the radius phase, and `radiusPx` is the arc radius they
     * chose in the following phase. Both are read to build the moment
     * and then mean nothing to anyone - but neither was ever reset,
     * so they survived into the next tool.
     *
     * `placementY` is the sharper of the two: it is written on every
     * pointermove in the placement phase and read back by the preview,
     * so a stale value silently repositions the NEXT preview that
     * consults it. It is the same shape of fault as the analysis
     * placement preview that left a green graph on the sheet, and it
     * was found by scanning for the class rather than the instance.
     */
    state.interaction.placementY = null;
    state.interaction.radiusPx = null;
    state.interaction.annotationKind = null;
    state.interaction.annotationKinds = null;
    state.interaction.annotationTarget = null;
    state.interaction.annotationTargetName = null;
    state.interaction.annotationPlacement = null;

    /*
     * AN ANNOTATE FEATURE BEING MADE.
     *
     * A geometric annotate mark - a leader, a callout, an arrow - holds its
     * first end on the interaction while the student chooses the second, and
     * its kind and target alongside it. All of it is temporary: nothing is in
     * the document until the commit, so this is what Escape clears and what
     * switching tools must clear too.
     *
     * LEAVING `annotateStage` BEHIND WAS A REAL DEFECT. The next tool's first
     * press would find the stale anchor still held and complete a SECOND
     * feature of the PREVIOUS kind - so clicking Arrow after Leader produced
     * two leaders. Everything the operation owns is therefore dropped here,
     * with the rest of the interaction.
     */
    state.interaction.annotateStage = null;
    state.interaction.annotateKind = null;
    state.interaction.annotateStart = null;
    state.interaction.annotateEnd = null;
    state.interaction.annotateTarget = null;

    state.interaction.effectiveConstructionPoint = null;

    /*
     * The live geometry a construction publishes to the snap
     * system. It belongs to the unfinished operation, so it
     * goes with it: leaving it behind would let a later tool
     * snap to members that no longer exist.
     */
    state.interaction.snapGeometry = [];

    /*
     * The distributed load's construction state: the body it
     * loads, the direction its first force set, and the
     * magnitude points placed so far. All of it is temporary,
     * so cancelling leaves no partial load behind.
     */
    state.interaction.distributedLoadStart = null;
    state.interaction.distributedLoadEnd = null;
    state.interaction.distributedLoadDirection = null;
    state.interaction.distributedLoadPoints = [];
    state.interaction.distributedLoadHasProfile = false;

    /*
     * The constant load's own construction state, for the
     * same reason: the body it loads, the direction and the
     * single magnitude. It is kept apart from the varying
     * load's profile state because the two are different
     * constructions, and clearing one must never leave the
     * other half-built.
     */
    state.interaction.loadStart = null;
    state.interaction.loadEnd = null;
    state.interaction.loadDirection = null;
    state.interaction.loadMagnitude = 0;

    /*
     * ========================================================
     * THE DISTRIBUTED LOAD'S FIVE STEPS
     * ========================================================
     *
     * One field per thing the student has to decide, so each can be
     * cleared, inspected and tested on its own.
     *
     * `loadSourceId` is the BODY, and it is the only thing the first
     * click establishes. It used to be handed the body's own endpoints
     * at the same time, which is why a load appeared across the whole
     * member the instant it was clicked - the span had already been
     * decided by someone else.
     *
     * `loadStart` and `loadEnd` are null until the student puts them
     * there, and they are BODY-LOCAL engineering positions rather than
     * world points, so the loaded interval survives the body moving and
     * being resized.
     *
     * `loadDirection` is null until the last step, and it is a real
     * vector rather than an angle or a flag - the renderer, the analysis
     * and Switch Direction all read this one field, so they cannot
     * disagree about which way the load points.
     */
    state.interaction.loadSourceId = null;
    state.interaction.loadStart = null;
    state.interaction.loadEnd = null;
    state.interaction.loadDirection = null;
    state.interaction.loadMagnitude = 0;

    /*
     * THE FIXED ORIGIN FOR THE MAGNITUDE/DIRECTION VECTOR.
     *
     * It is captured when the loaded region is completed and read back
     * unchanged while the student aims, so it is temporary construction state
     * exactly like the span beside it. Clearing it here is what makes the
     * NEXT load establish a fresh reference point: a stale one would measure
     * the new load's direction from the previous load's midpoint, and the
     * student would see their arrows turn for no reason they could point to.
     */
    state.interaction.loadReferencePoint = null;

    state.interaction.snapCandidate = null;
    state.interaction.hoveredEntity = null;
    state.interaction.inference = null;
    state.interaction.selectionStart = null;
    state.interaction.selectionCurrent = null;
    state.interaction.selectionBox = null;
    state.interaction.selectionDragging = false;
    state.interaction.points = [];
    state.interaction.previewObjects = [];
    state.interaction.modifyAxisObjectIds = [];
    state.interaction.arcLastAngle = null;
    state.interaction.arcAccumulatedSweep = 0;
    state.interaction.arcMode = "centrepoint";
    state.interaction.arcCursorAngle = null;
    state.interaction.polygonSides = null;
    state.interaction.polygonMode = null;
    state.interaction.polygonAdditionalSides = null;
    state.interaction.polygonFeatureType = null;
}

function setInteraction(state, interaction) {
    state.interaction = {
        ...state.interaction,
        ...interaction
    };

    /*
     * Record WHEN a guideline was last established, so the
     * snap system can hold it briefly once the cursor drifts
     * out of its region.
     *
     * Stored as part of the interaction rather than kept in
     * the snap module, because a guideline belongs to the
     * construction being drawn: it is cleared with the
     * construction, it is not written into the document, and
     * undo does not need to know it ever existed.
     *
     * The clock is the snap system's own, not a second one
     * written here. Two clocks for one timestamp would differ
     * by however far the page has been open - and
     * performance.now() and Date.now() are not the same
     * origin - so a guideline would look either centuries
     * old or impossibly fresh depending on which one read
     * it. Asking the module that owns the hold keeps the
     * two ends of the comparison in the same time base.
     */
    if (
        interaction?.guideline
    ) {
        state.interaction.guideline = {
            inference:
                interaction.guideline,

            at: enggDrawingSnap
                ?.nowMs?.() ??
                Date.now()
        };
    }
}

function normalizeZoom(zoom) {
    let value =
        Number(zoom);

    if (
        !Number.isFinite(
            value
        )
    ) {
        return 1;
    }

    /*
     * The zoom percentage is always an
     * integer so that repeated
     * multiplication, restoration and
     * fit operations can never
     * accumulate floating point
     * artefacts.
     */
    /*
     * Rounded as a PERCENTAGE, not as the factor.
     *
     * The zoom is held as a factor - 1 is 100% - but the thing
     * that must be a whole number is the percentage the user sees.
     * Rounding the factor instead would round every zoom level to
     * the nearest whole number of TIMES: 150% would become 2
     * (200%), and 50% would become 1 (100%), because there is no
     * whole number of times between them. Every intermediate zoom
     * - the ones people actually work at - would be unreachable,
     * and the two controls meant to step through them would jump
     * straight past.
     *
     * Rounding the percentage and converting back keeps the
     * original guarantee - the stored value is a whole number of
     * percent, so 100.0000001%, 149.999999% and 199.9999998% can
     * never be stored or displayed - while making every step
     * between 25% and 500% reachable and exact.
     */
    value = Math.round(value * 100) / 100;

    if (
        !Number.isFinite(
            value
        )
    ) {
        return 1;
    }

    return Math.min(
        5,
        Math.max(
            0.25,
            value
        )
    );
}

function setCameraZoom(state, zoom) {
    state.camera.zoom =
        normalizeZoom(zoom);
}

function panCamera(state, panX, panY) {
    state.camera.panX = panX;
    state.camera.panY = panY;
}

function snapCoordinate(value, state) {
    if (
        !state.snap.enabled ||
        state.snap.spacing <= 0
    ) {
        return value;
    }

    return (
        Math.round(
            value / state.snap.spacing
        ) * state.snap.spacing
    );
}

function engineeringToScreen(point, bounds, state) {
    const scale =
        BASE_PIXELS_PER_UNIT *
        state.camera.zoom;

    return {
        x:
            bounds.width / 2 +
            (point.x - state.camera.panX) *
                scale,

        y:
            bounds.height / 2 -
            (point.y - state.camera.panY) *
                scale
    };
}

function screenToEngineering(
    point,
    bounds,
    state,
    shouldSnap = false
) {
    const scale =
        BASE_PIXELS_PER_UNIT *
        state.camera.zoom;

    const engineeringPoint = {
        x:
            (point.x - bounds.width / 2) /
                scale +
            state.camera.panX,

        y:
            (bounds.height / 2 - point.y) /
                scale +
            state.camera.panY
    };

    if (!shouldSnap) {
        return engineeringPoint;
    }

    return {
        x: snapCoordinate(
            engineeringPoint.x,
            state
        ),
        y: snapCoordinate(
            engineeringPoint.y,
            state
        )
    };
}

/*
 * A feature as it is written to a file.
 *
 * EVERY FIELD IS DEEP-COPIED, DERIVED FROM THE OBJECT'S OWN KEYS.
 *
 * This is where the file format decides what a feature IS, and it used to be a
 * shallow spread plus a HAND-WRITTEN LIST of sub-objects - `placement`,
 * `sourceRefs`, `leader` and seven more. The list worked, and it was a trap: a
 * field added to a feature tomorrow would be spread as a LIVE REFERENCE, save
 * and load would both appear to work, and the defect would only show as two
 * features quietly sharing one sub-object.
 *
 * Derived from the keys, a new field is serialised BY CONSTRUCTION - there is no
 * list to remember to extend, so the file cannot fall behind the model.
 *
 * `deepClone` ANSWERS `undefined` WITH `undefined`, which is what lets this be
 * unconditional: the `if (x !== undefined)` guards this used to carry existed
 * because `JSON.parse(JSON.stringify(undefined))` THROWS, and one site that
 * forgot made SAVING A DRAWING THAT CONTAINED ANY ANNOTATION fail outright. A
 * field that was absent stays absent, so a reopened feature has the shape it
 * was saved with.
 */
function cloneFeatureForSave(object) {
    const copy = {};

    Object.keys(object).forEach((key) => {
        copy[key] = deepClone(object[key]);
    });

    return copy;
}

function serializeDrawing(state) {
    return JSON.stringify(
        {
            version: state.version,
            units: state.units,

            /*
             * THE CALIBRATION IS PART OF THE DOCUMENT.
             *
             * It is what makes a length mean anything, so a drawing saved
             * without it reopened with every dimension wrong - the numbers
             * were still right, they were just no longer in the units they
             * claimed. The whole shape travels together for that reason.
             */
            scale: state.scale
                ? {
                      ...state.scale,
                      reference: state.scale.reference
                          ? {
                                ...state.scale.reference
                            }
                          : undefined
                  }
                : null,

            camera: {
                ...state.camera
            },
            grid: {
                ...state.grid
            },
            statics: {
                ...state.statics
            },
            snap: {
                ...state.snap
            },
            objectSnap: {
                ...state.objectSnap
            },
            styleDefaults: {
                ...state.styleDefaults
            },
            objects: state.objects.map(
                object => cloneFeatureForSave(object)
            )
        },
        null,
        2
    );
}

const enggDrawingState = {
    BASE_PIXELS_PER_UNIT,
    createDrawingState,
    restoreDocument,
    restoreObjects,
    setDocumentChangedHandler(handler) {
        onDocumentChanged = handler;
    },
    createStyle,
    resolveDefaultStroke,
    setThemeLineColour,
    createGeometryObject,
    geometryFactories,
    addObject,
    removeObject,
    removeObjectsAndDescendants,
    resetScaleIfSheetIsEmpty,
    selectObjects,
    selectObject,
    clearSelection,
    setHistorySinks,
    HISTORY_LIMIT,
    snapshotDocument,
    snapshotDrawing,
    commitDrawingChange,
    setAnalysisDependencyRegistry,
    refreshAnalysisObjects,
    refreshDerivedFeatures,
    resolveAnalysisAfterDeletion,
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
    polygonVertices,
    serializeDrawing,

    /*
     * The measurement, dimension and annotation models, reached
     * through the one namespace the application already uses.
     *
     * Getters rather than the modules themselves, so a consumer
     * that read one at load time does not end up holding
     * undefined because it had not been defined yet.
     */
    get measurement() {
        return enggMeasurement;
    },
    get dimensionModel() {
        return enggDimensionModel;
    },
    get annotationModel() {
        return enggAnnotationModel;
    }
};

export default enggDrawingState;
