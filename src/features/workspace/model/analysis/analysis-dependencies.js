/* Engineering drawing analysis dependencies - the one update mechanism. */
/*
 * An Analysis object is a READING OF OTHER FEATURES, not a mark on the
 * sheet. A Force Components is a reading of one Point Force; a
 * Resultant is a reading of several; an SFD's reference axis is a
 * reading of a Beam's span.
 *
 * That relationship is the whole feature, and it used to be copied
 * rather than held. Each Analysis object stored the numbers it had at
 * the moment it was created and nothing else, so moving the Point
 * Force left the components behind describing where it used to be,
 * and the only way to fix it was to delete the analysis and build it
 * again. Worse, the relationship lived in whatever had to be edited:
 * making a force follow its source would have meant remembering to
 * add a branch to every handler that can move a force.
 *
 * So there is exactly ONE place that knows how to keep an Analysis
 * object true: `refreshAnalysis`. Everything else registers a
 * dependency and forgets about it.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * -------------------------------
 * It recomputes from values that EXPLICITLY EXIST on the source
 * features. It never solves for anything. A missing shear value, an
 * unknown support reaction and the shape of a student's bending curve
 * are not derivable from the drawing without being the exercise, so
 * this file will not attempt them - see `deriveForceComponents` and
 * `deriveResultant` for the line between reading a value and inventing
 * one.
 */
import enggDrawingState from "../../../../shared/model/drawing-state.js";
import { isSupportType } from "../../../../shared/model/feature-types.js";

/*
 * The Analysis object types, and what each one derives itself from.
 *
 * Kept as a table rather than a switch inside the recalculation so
 * that adding a sixth kind of analysis is a matter of one row here
 * and one derivation function below, and so that the reverse
 * question - "is this object an analysis object at all?" - has one
 * answer used by selection, the Features panel and deletion alike.
 */
/*
 * Where a diagram sits when the student has not chosen.
 *
 * A starting SUGGESTION and nothing more. It exists so the preview
 * appears somewhere sensible the moment the tool is chosen, rather
 * than on top of the beam where it would be unreadable and the
 * student would have to drag it out from under their own drawing.
 *
 * A whole number of drawing units below the source, so the first
 * frame is at a predictable place and the axis lands on a round
 * number rather than wherever an arbitrary number of pixels fell.
 * The student's cursor immediately takes it from here.
 */
const DEFAULT_ANALYSIS_OFFSET = 120;

const ANALYSIS_KINDS = {
    "force-components": "forceComponents",
    resultant: "resultant",
    "shear-force-diagram": "shearForceDiagram",
    "bending-moment-diagram": "bendingMomentDiagram",
    "axial-force-diagram": "axialForceDiagram",

    /*
     * The shared type all three diagrams are actually STORED as.
     *
     * The three are separate features and are named separately -
     * "SFD 1" reads correctly in the Features panel, and the
     * Features tree can tell them apart - but they share one
     * renderer, one hit test and one persistence path, and sharing
     * the stored type is what makes that possible.
     *
     * So this name has to be recognised here too. It is an
     * implementation detail the student never sees, and an
     * implementation detail this module must not be ignorant of:
     * without it a diagram silently failed to refresh, because it
     * was not one of the five types it was checking for.
     */
    "analysis-diagram": "analysisDiagram"
};

function isAnalysisObject(object) {
    return Boolean(
        object &&
        object.engineering &&
        Object.prototype.hasOwnProperty.call(
            ANALYSIS_KINDS,
            object.type
        )
    );
}

/*
 * The ids this analysis object reads from.
 *
 * Read fresh each time rather than cached, because a Resultant's
 * source list is itself editable - a source can be added or removed
 * and the object has to follow - and a cached list would keep
 * updating a force the student has just detached.
 */
function sourceIdsOf(analysisObject) {
    const engineering =
        analysisObject.engineering || {};

    const single =
        engineering.sourceFeatureId ||
        engineering.sourceId;

    if (single) {
        return [single];
    }

    if (
        Array.isArray(engineering.sourceFeatureIds)
    ) {
        return engineering.sourceFeatureIds.filter(Boolean);
    }

    /*
     * Older drawings stored the relationship on the geometry
     * rather than under `engineering`. Read it from there too so a
     * file saved before this existed still follows its sources
     * instead of silently freezing.
     */
    const legacy =
        analysisObject.geometry &&
        (analysisObject.geometry.sourceFeatureIds ||
            analysisObject.geometry.sourceFeatureId);

    if (Array.isArray(legacy)) {
        return legacy.filter(Boolean);
    }

    if (legacy) {
        return [legacy];
    }

    return [];
}

/*
 * Record that `analysisObject` reads from `sourceIds`.
 *
 * The relationship is stored ON the analysis object rather than in
 * a registry here. That is deliberate: it is part of the feature,
 * so it is saved, undone, redone and copied with the object for
 * free, and a registry kept alongside would have to be rebuilt
 * after every one of those. This function exists so the shape of
 * that stored relationship is written in one place.
 */
function registerDependency(
    analysisObject,
    sourceIds
) {
    if (!analysisObject) {
        return analysisObject;
    }

    const ids = (Array.isArray(sourceIds)
        ? sourceIds
        : [sourceIds]
    ).filter(Boolean);

    analysisObject.engineering = {
        ...(analysisObject.engineering || {}),
        sourceFeatureIds: ids,
        analysisKind:
            analysisObject.engineering?.analysisKind ||
            ANALYSIS_KINDS[analysisObject.type]
    };

    return analysisObject;
}

/*
 * The live state of a source force, in the two forms a force can
 * be written in.
 *
 * A Point Force may state a magnitude and a direction, or it may
 * state its X and Y components directly. Both are EXPLICIT values
 * the student typed, so either may be used - but the components
 * win where both are present, because a student who has just typed
 * Fx and Fy means those, whatever the angle field still says.
 *
 * Returning `known: false` is the important part. A force with no
 * magnitude, or an angle that is not a number, produces a reading
 * of nothing - and the caller must draw nothing rather than
 * defaulting to zero and presenting that as an answer.
 */
/*
 * THE ARROW A FORCE IS DRAWN AS, as a vector from its application point.
 *
 * This is DRAWING geometry - the stored `start` to `end` the student drew -
 * and it is what a derived arrow (a Resultant, a pair of Components) is drawn
 * from. The force's VALUE is `readForceVector`, and it is what the derived
 * labels state. Keeping the two apart is what lets a 500 N force be drawn
 * whatever length the student chose, and its resultant follow the drawing.
 *
 * A force with no drawn end (saved before arrows kept their drawn length) is
 * drawn at its value, which is how it looked then.
 */
function drawnVectorOf(force) {
    const geometry = force?.geometry || {};
    const start = geometry.start || geometry.position;
    const end = geometry.end;

    if (
        start && end &&
        Number.isFinite(Number(start.x)) && Number.isFinite(Number(start.y)) &&
        Number.isFinite(Number(end.x)) && Number.isFinite(Number(end.y))
    ) {
        const x = Number(end.x) - Number(start.x);
        const y = Number(end.y) - Number(start.y);

        if (Math.hypot(x, y) > 1e-9) {
            return { known: true, x, y };
        }
    }

    const value = readForceVector(force);

    return value.known ? { known: true, x: value.x, y: value.y } : { known: false };
}

function readForceVector(force) {
    if (!force || !force.geometry) {
        return { known: false };
    }

    const geometry = force.geometry;

    const fx = Number(geometry.forceX);
    const fy = Number(geometry.forceY);

    if (
        Number.isFinite(fx) &&
        Number.isFinite(fy)
    ) {
        return {
            known: true,
            fromComponents: true,
            x: fx,
            y: fy,
            magnitude: Math.hypot(fx, fy)
        };
    }

    const magnitude = Number(geometry.magnitude);
    const angle = Number(geometry.angle);

    if (
        !Number.isFinite(magnitude) ||
        !Number.isFinite(angle)
    ) {
        return { known: false };
    }

    const radians = angle * Math.PI / 180;

    return {
        known: true,
        fromComponents: false,
        magnitude,
        angle,
        x: magnitude * Math.cos(radians),
        y: magnitude * Math.sin(radians)
    };
}

/*
 * The point a force acts at, which is also the ORIGIN of its
 * components. It is read from the source every time rather than
 * stored, so that moving the force carries the components with it
 * for free - which is the single most visible thing a
 * Force Components has to get right.
 */
function applicationPointOf(force) {
    if (!force || !force.geometry) {
        return null;
    }

    const point =
        force.geometry.start ||
        force.geometry.position ||
        force.geometry.origin;

    if (
        point &&
        Number.isFinite(point.x) &&
        Number.isFinite(point.y)
    ) {
        return { x: point.x, y: point.y };
    }

    return null;
}

/*
 * FORCE COMPONENTS, derived from a live source force.
 *
 * The original force, the horizontal component and the vertical
 * component all share ONE origin - the force's own application
 * point - because a decomposition that did not share its origin
 * would be three unrelated arrows rather than a decomposition of
 * something, and the whole point of the tool is that relationship.
 */
function deriveForceComponents(
    force
) {
    const vector = readForceVector(force);
    const origin = applicationPointOf(force);

    if (!vector.known || !origin) {
        return null;
    }

    /*
     * THE ARROWS ARE THE DRAWN FORCE'S PROJECTIONS; THE NUMBERS ARE ITS VALUE.
     * `x`/`y` carry the engineering components the labels state, `drawn` the
     * arrows the components are drawn as.
     */
    const drawn = drawnVectorOf(force);
    const arrow = drawn.known ? drawn : vector;

    return {
        origin,
        original: {
            x: vector.x,
            y: vector.y
        },
        x: {
            x: vector.x,
            y: 0
        },
        y: {
            x: 0,
            y: vector.y
        },
        drawn: {
            original: { x: arrow.x, y: arrow.y },
            x: { x: arrow.x, y: 0 },
            y: { x: 0, y: arrow.y }
        },
        magnitude: vector.magnitude,
        angle: vector.angle,
        fromComponents: vector.fromComponents
    };
}

/*
 * RESULTANT, derived from live source forces.
 *
 * Summing explicitly stated vectors IS this tool's stated purpose,
 * and it is not solving the exercise: it adds up numbers the
 * student has already typed. It computes no reaction, no
 * equilibrium and no unknown.
 *
 * Sources with nothing known about them are skipped rather than
 * treated as zero, so a force the student has not finished
 * describing cannot quietly contribute nothing to the answer.
 * Whether the Resultant is still meaningful is decided by the
 * caller, which knows how many sources it expected.
 */
function deriveResultant(
    forces
) {
    let x = 0;
    let y = 0;
    let used = 0;

    forces.forEach(force => {
        const vector = readForceVector(force);

        if (!vector.known) {
            return;
        }

        x += vector.x;
        y += vector.y;
        used += 1;
    });

    if (!used) {
        return null;
    }

    return {
        x,
        y,
        magnitude: Math.hypot(x, y),
        angle: Math.atan2(y, x) * 180 / Math.PI,
        usedSources: used
    };
}

/*
 * The span a body or member is drawn over.
 *
 * SFD, BMD and AFD are read against a member's length, so this is
 * how each kind of source reports its own extent. A Truss reports
 * its span rather than its web, because the diagram is read
 * against the whole member.
 */
function spanOf(object) {
    if (!object || !object.geometry) {
        return null;
    }

    const geometry = object.geometry;

    const start =
        geometry.start || geometry.position;

    const end = geometry.end;

    if (
        start &&
        end &&
        Number.isFinite(start.x) &&
        Number.isFinite(end.x)
    ) {
        const length = Math.hypot(
            end.x - start.x,
            end.y - start.y
        );

        if (length > 0) {
            return {
                start: { x: start.x, y: start.y },
                end: { x: end.x, y: end.y },
                length
            };
        }
    }

    return null;
}

/*
 * THE REFERENCE AXIS A SOURCE BODY IMPLIES.
 *
 * Given where the student has put the analysis vertically, this is
 * the axis that follows from it. It is derived rather than chosen,
 * and every part of it comes from the source:
 *
 *   LENGTH    the source span, exactly. Not a screen width, not a
 *             round number, and never a constant: an SFD that is
 *             not the same length as the beam it belongs to is not
 *             a scaled version of it, it is a different diagram.
 *   DIRECTION parallel to the source span, so a beam drawn at an
 *             angle produces an axis at the same angle and the
 *             stations still line up along it.
 *   HORIZONTAL
 *             POSITION
 *             the source's own, so A' sits under A. The student
 *             chose a HEIGHT, not a place - moving the diagram
 *             sideways during placement would silently break the
 *             alignment that makes the two readable together.
 *
 * The student's vertical choice is a real coordinate rather than a
 * distance from the source, because that is what keeps it stable:
 * see `verticalOffsetOf`.
 */
function axisFromSource(
    source,
    placementY
) {
    const span = spanOf(source);

    if (!span) {
        return null;
    }

    const dx = span.end.x - span.start.x;
    const dy = span.end.y - span.start.y;

    const unit = {
        x: dx / span.length,
        y: dy / span.length
    };

    /*
     * The normal to the span, which is the direction the student
     * is actually choosing. For a level beam it points straight
     * up, so "up" means up; for a sloping one it means "off the
     * member", which is the same idea.
     */
    const normal = {
        x: -unit.y,
        y: unit.x
    };

    /*
     * The student's chosen height, expressed as an offset ALONG
     * that normal from the source's own start.
     *
     * Resolving the cursor's y onto the normal rather than using it
     * directly is what makes the axis follow the cursor for a
     * level beam - the common case - while still moving in the
     * sensible direction for one that is not.
     */
    const offset = {
        x: placementY - span.start.y
    };

    const origin = {
        x: span.start.x + normal.x * offset.x,
        y: span.start.y + normal.y * offset.x
    };

    return {
        start: origin,
        end: {
            x: origin.x + unit.x * span.length,
            y: origin.y + unit.y * span.length
        },
        length: span.length,
        direction: unit,
        normal
    };
}

/*
 * HOW FAR OFF ITS SOURCE AN ANALYSIS SITS, in the source span's own
 * frame.
 *
 * The stored presentation choice is a distance along the span's
 * NORMAL, not a world coordinate, and this is the reason the
 * student's placement survives later edits to the source.
 *
 * A world y would be the obvious thing to store and it behaves
 * wrongly: resize the beam and its start y moves, so a diagram
 * placed at a fixed world y would slide bodily up or down with the
 * beam - dragging the analysis somewhere the student never put it,
 * which is precisely what must not happen. Measuring the offset
 * from the source means the diagram keeps its DISTANCE from the
 * member whether the member moves, grows or is re-drawn.
 */
function verticalOffsetOf(
    axis,
    source
) {
    const span = spanOf(source);

    if (!span || !axis) {
        return 0;
    }

    const dx = span.end.x - span.start.x;
    const dy = span.end.y - span.start.y;

    const length = Math.hypot(dx, dy);

    if (!length) {
        return 0;
    }

    const unit = { x: dx / length, y: dy / length };
    const normal = { x: -unit.y, y: unit.x };

    return (
        (axis.start.x - span.start.x) * normal.x +
        (axis.start.y - span.start.y) * normal.y
    );
}

/*
 * A point's position ALONG a span, as a fraction from 0 to 1.
 *
 * Fractions, not world coordinates, and that is the whole reason
 * this function exists. A beam 400 long with a load a third of the
 * way along gives 0.33; a beam 600 long with the same load in the
 * same place gives the same 0.33, because the fraction is taken
 * against the CURRENT span every time. A template that stored
 * world coordinates would drift off its own axis the moment the
 * beam was resized, and would need re-deriving from the outside
 * each time - this way the mapping is a function of the source's
 * present state and cannot fall behind.
 */
function projectOntoSpan(
    span,
    point
) {
    if (
        !span ||
        !point ||
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y)
    ) {
        return null;
    }

    const dx = span.end.x - span.start.x;
    const dy = span.end.y - span.start.y;

    const lengthSquared = dx * dx + dy * dy;

    if (!lengthSquared) {
        return null;
    }

    const t =
        ((point.x - span.start.x) * dx +
            (point.y - span.start.y) * dy) /
        lengthSquared;

    return Math.min(1, Math.max(0, t));
}

/*
 * WHERE A SOURCE'S STATIONS SAY THEY ARE, on a diagram's own axis.
 *
 * A diagram is not the member, so the fraction along the member
 * has to become a position along the diagram's axis - measured
 * from the diagram's OWN start, not the member's, because the two
 * are placed independently and the diagram is what the student is
 * drawing on.
 *
 * The source position is kept alongside as well. That is what lets
 * a marker move when the source moves: the template stores WHERE
 * ALONG the axis each station is, and re-derives the absolute
 * position from the axis it currently has.
 */
function mapStationOntoAxis(
    axis,
    t
) {
    return {
        x: axis.start.x + (axis.end.x - axis.start.x) * t,
        y: axis.start.y + (axis.end.y - axis.start.y) * t
    };
}

/*
 * The stations a diagram can inherit from its source.
 *
 * These are positions the student can already SEE on the member -
 * its two ends, and wherever a support or a load acts. Transferring
 * them saves drawing the same tick marks twice.
 *
 * What is deliberately absent is the answer. A shear jump, a
 * moment value, an axial force, a sign, a slope and a curve are the
 * SOLUTION; a template that produced any of them would be doing
 * the exercise rather than supporting it. So this returns positions
 * and nothing else, and there is no code path here that can reach
 * a value.
 */
function sourceStations(
    source,
    state
) {
    const span = spanOf(source);

    if (!span) {
        return [];
    }

    const stations = [
        { key: "start", label: "A", t: 0 },
        { key: "end", label: "B", t: 1 }
    ];

    /*
     * Anything acting ON the member contributes a station at the
     * fraction of the span it acts at. The fraction is recomputed
     * from the member's current geometry, so a support that slides
     * along the beam moves its tick mark on its own.
     */
    state.objects.forEach(object => {
        if (object.id === source.id) {
            return;
        }

        /*
         * Only features that ACT on a member count. A second beam
         * drawn below the first is not a station on it, and
         * including it would put a tick mark where there is no
         * event in the diagram.
         */
        const acts =
            object.type === "force" ||
            object.type === "load" ||
            object.type === "varying-load" ||
            object.type === "moment" ||
            isSupportKind(object.type) ||
            object.type === "reference-point";

        if (!acts) {
            return;
        }

        /*
         * A feature belongs to this member when its own parent is
         * the member, or when it simply lies along the span.
         * Checking the parent first keeps a load that was dropped
         * near - but not on - the beam from being counted against
         * it.
         */
        if (
            object.parentId &&
            object.parentId !== source.id
        ) {
            return;
        }

        const geometry = object.geometry || {};

        const points = [
            geometry.start,
            geometry.end,
            geometry.position
        ].filter(
            p =>
                p &&
                Number.isFinite(p.x) &&
                Number.isFinite(p.y)
        );

        /*
         * A load is a RANGE, and it acts at both of its ends, so
         * both are stations. A force or a support acts at one
         * point, and the arrow head of a force is not a station -
         * the load is applied where the arrow starts.
         */
        if (object.type === "load" || object.type === "varying-load") {
            [geometry.start, geometry.end].forEach((point, index) => {
                const t = projectOntoSpan(span, point);

                if (t !== null) {
                    stations.push({
                        key: object.id + ":load" + index,
                        label: "L",
                        t,
                        sourceId: object.id
                    });
                }
            });

            return;
        }

        const t = projectOntoSpan(span, points[0]);

        if (t !== null) {
            stations.push({
                key: object.id + ":act",
                label:
                    isSupportKind(object.type)
                        ? "S"
                        : "F",
                t,
                sourceId: object.id
            });
        }
    });

    return stations;
}

function isSupportKind(type) {
    return (
        isSupportType(type)
    );
}

/*
 * The diagram's own axis, with every station placed on it.
 *
 * The axis is where the student will DRAW, and the stations are
 * where they will DRAW AGAINST. Both are recomputed from the
 * source on every pass, so neither can fall behind it.
 *
 * The axis itself is read from the diagram's own `start`/`end`
 * rather than being moved to match the member's length: the
 * diagram is a separate object the student is free to place and
 * resize, and snapping its axis to the member's coordinates would
 * make it impossible to draw a diagram anywhere but under the
 * member it belongs to.
 */
function deriveDiagram(
    diagram,
    source,
    state
) {
    const axis = diagramAxis(diagram);

    const stations = source
        ? sourceStations(source, state)
        : [];

    return {
        axis,
        stations: stations.map(station => ({
            ...station,
            position: mapStationOntoAxis(axis, station.t)
        })),
        sourceSpan: source ? spanOf(source) : null
    };
}

function diagramAxis(diagram) {
    const geometry = diagram.geometry || {};

    const start = geometry.start || geometry.zeroAxis?.from;
    const end = geometry.end || geometry.zeroAxis?.to;

    if (
        start &&
        end &&
        Number.isFinite(start.x) &&
        Number.isFinite(end.x)
    ) {
        return {
            start: { x: start.x, y: start.y },
            end: { x: end.x, y: end.y }
        };
    }

    return null;
}

/*
 * REFRESH ONE ANALYSIS OBJECT FROM ITS SOURCES.
 *
 * This is the whole update mechanism, and it is deliberately a
 * PURE function of the current state: it reads the sources as they
 * are now and writes the derived values onto the analysis object.
 * Nothing is remembered between calls, so there is no cache to
 * invalidate and no order in which objects have to be refreshed -
 * which is what lets `refreshAll` simply walk the list.
 *
 * The geometry it writes is DERIVED and is marked as such, so that
 * a move made by the student can be told apart from a value that
 * arrived from the source. Without that distinction a moved object
 * would be pulled straight back by the next refresh, and the
 * student could never place their diagram anywhere.
 */
function refreshAnalysis(
    analysisObject,
    state
) {
    if (!isAnalysisObject(analysisObject)) {
        return analysisObject;
    }

    const geometry = analysisObject.geometry =
        analysisObject.geometry || {};

    /*
     * `engineering` is created even when this pass writes nothing
     * to it, because the unresolved flag below is set on it and
     * that is how a broken relationship is reported.
     */
    analysisObject.engineering =
        analysisObject.engineering || {};

    /*
     * THE OFFSET THE STUDENT CHOSE.
     *
     * Preserved across every refresh, and the reason a refresh can
     * run at all. A diagram the student has dragged 200 units
     * below its beam stays 200 units below it; what follows the
     * source is the SPAN and the STATIONS, not the place the
     * student put the object.
     */
    const offset = geometry.placementOffset;

    if (analysisObject.type === "force-components") {
        return refreshForceComponents(analysisObject, state, offset);
    }

    if (analysisObject.type === "resultant") {
        return refreshResultant(analysisObject, state, offset);
    }

    if (
        Object.prototype.hasOwnProperty.call(
            ANALYSIS_KINDS,
            analysisObject.type
        )
    ) {
        return refreshDiagram(
            analysisObject,
            state,
            offset
        );
    }

    return analysisObject;
}

function refreshForceComponents(
    analysisObject,
    state,
    offset
) {
    const source = findSource(analysisObject, state);

    if (!source) {
        /*
         * The force is gone. Marked rather than drawn: an
         * unresolved analysis object is visibly broken and says
         * so, which is the honest state. Silently drawing a
         * decomposition of a force that no longer exists would
         * look like a working answer.
         */
        analysisObject.engineering.unresolved = true;

        return analysisObject;
    }

    const derived = deriveForceComponents(source);

    if (!derived) {
        /*
         * The force exists but states nothing usable yet. Not
         * unresolved - the relationship is intact, there is simply
         * nothing to read - so this is a quiet state, and nothing
         * is drawn.
         */
        analysisObject.engineering.unresolved = false;

        return analysisObject;
    }

    analysisObject.engineering.unresolved = false;
    analysisObject.engineering.sourceFeatureId = source.id;

    const geometry = analysisObject.geometry;

    /*
     * A components object may be OFFSET from its force - the
     * student is allowed to move its presentation - but it is
     * never scaled or re-aimed by them. The decomposition always
     * describes the force as it is now.
     *
     * The origin is the force's own application point, so the three
     * vectors keep sharing it. That shared origin IS the
     * decomposition: without it they would be three arrows that
     * happen to point the right way, and moving the offset would
     * separate them into exactly that.
     */
    const origin = offset
        ? { x: derived.origin.x + offset.x, y: derived.origin.y + offset.y }
        : derived.origin;

    geometry.position = origin;
    geometry.origin = { ...derived.origin };

    geometry.original = {
        start: { ...origin },
        end: {
            x: origin.x + derived.drawn.original.x,
            y: origin.y + derived.drawn.original.y
        }
    };

    geometry.horizontal = {
        start: { ...origin },
        end: {
            x: origin.x + derived.drawn.x.x,
            y: origin.y + derived.drawn.x.y
        }
    };

    geometry.vertical = {
        start: { ...origin },
        end: {
            x: origin.x + derived.drawn.y.x,
            y: origin.y + derived.drawn.y.y
        }
    };

    /*
     * The legacy arrow, kept so anything already reading `start`
     * and `end` still gets the current force. It is the ORIGINAL
     * force rather than one component, because that is what this
     * object has always meant to its renderer and its hit test.
     */
    geometry.start = { ...origin };
    geometry.end = {
        x: origin.x + derived.drawn.original.x,
        y: origin.y + derived.drawn.original.y
    };

    geometry.magnitude = derived.magnitude;
    geometry.angle = derived.angle;
    geometry.forceX = derived.x.x;
    geometry.forceY = derived.y.y;

    return analysisObject;
}

function refreshResultant(
    analysisObject,
    state,
    offset
) {
    const sources = findSources(analysisObject, state);

    if (!sources.length) {
        analysisObject.engineering.unresolved = true;

        return analysisObject;
    }

    const derived = deriveResultant(sources);

    if (!derived) {
        analysisObject.engineering.unresolved = true;

        return analysisObject;
    }

    analysisObject.engineering.unresolved = false;
    analysisObject.engineering.sourceFeatureIds =
        sources.map(source => source.id);

    const geometry = analysisObject.geometry;

    /*
     * The resultant is drawn from the common point of the forces
     * it sums - the same place the student's own construction
     * starts from - so that the source vectors and the resultant
     * visibly share an origin.
     */
    const common = commonOrigin(sources);

    const origin = offset
        ? { x: common.x + offset.x, y: common.y + offset.y }
        : common;

    /*
     * THE ARROW IS THE SUM OF THE DRAWN ARROWS; THE NUMBER IS THE SUM OF
     * THE VALUES. A resultant is drawn the way the student would construct it
     * - tip to tail from the arrows on the sheet - so it is comparable with
     * them by eye, and its label states the engineering sum.
     */
    const drawn = drawnResultant(sources);

    geometry.position = origin;
    geometry.start = { ...origin };
    geometry.end = {
        x: origin.x + drawn.x,
        y: origin.y + drawn.y
    };

    geometry.magnitude = derived.magnitude;
    geometry.angle = derived.angle;
    geometry.forceX = derived.x;
    geometry.forceY = derived.y;

    return analysisObject;
}

/*
 * Where a set of source forces is drawn FROM.
 *
 * The first source's application point, which is the point the
 * student's own construction starts at. Averaging them would be
 * tidier and wrong: the resultant of forces applied at different
 * points is not a vector at an average position, and drawing it
 * somewhere plausible-looking would be a claim the drawing cannot
 * support.
 */
function commonOrigin(
    sources
) {
    const point = applicationPointOf(sources[0]);

    return point || { x: 0, y: 0 };
}

/*
 * The resultant's drawn vector: the sum of its sources' drawn arrows.
 *
 * A LEGIBILITY FLOOR, NOT A SCALE. A resultant that nearly cancels is drawn
 * short rather than not at all - a student who summed their forces to almost
 * nothing needs to see that - so only an arrow that would be invisible is
 * lengthened, along its own direction.
 */
const MIN_RESULTANT_UNITS = 2;

function drawnResultant(sources) {
    let x = 0;
    let y = 0;

    sources.forEach(source => {
        const arrow = drawnVectorOf(source);

        if (arrow.known) {
            x += arrow.x;
            y += arrow.y;
        }
    });

    const length = Math.hypot(x, y);

    if (length >= MIN_RESULTANT_UNITS) {
        return { x, y };
    }

    return length > 0
        ? { x: (x / length) * MIN_RESULTANT_UNITS, y: (y / length) * MIN_RESULTANT_UNITS }
        : { x: 0, y: 0 };
}

function refreshDiagram(
    analysisObject,
    state,
    offset
) {
    const source = findSource(analysisObject, state);
    const geometry = analysisObject.geometry;

    const span = source ? spanOf(source) : null;

    /*
     * A SOURCED DIAGRAM'S AXIS IS DERIVED FROM ITS SOURCE.
     *
     * This is the change that makes a diagram mean what it claims.
     * When there is a source, the axis is not an independent line
     * the student drew: its LENGTH is the source span and its
     * DIRECTION is the source's, so the two are the same measurement
     * seen twice. Resize the beam and the axis resizes with it;
     * that is not a convenience, it is what keeps the stations on
     * the axis corresponding to the loads on the beam.
     *
     * The student's choice is only ever the vertical PLACEMENT,
     * stored as an offset along the span's normal. It is applied
     * last, so it never influences the length or the direction.
     */
    if (span) {
        /*
         * THE STUDENT'S CHOSEN HEIGHT, IN WHATEVER FORM IT ARRIVED.
         *
         * Two different kinds of offset reach this point, and they
         * have to be told apart rather than assumed compatible:
         *
         *   `placementOffset`        a world vector from the normal
         *       Move system, dragging an already-placed diagram.
         *       A world vector, because a drag is a drag.
         *
         * A drag is converted into the same measure as a placement
         * so the two compose. Reading `distance` off a drag's
         * `{x, y}` gives undefined, which silently produced a NaN
         * axis - and a diagram that cannot be dragged at all, with
         * no error anywhere to say why.
         *
         * The two are combined rather than one replacing the
         * other: a student may place an axis, drag it, and drag it
         * again, and each move should add to where the diagram is
         * rather than the last one winning.
         */
        const distance =
            typeof geometry.sourceOffset?.distance ===
                "number"
                ? geometry.sourceOffset.distance
                : null;

        const drag =
            offset && Number.isFinite(offset.y)
                ? verticalOffsetOf(
                    {
                        start: {
                            x: span.start.x,
                            y: span.start.y + offset.y
                        },
                        end: span.end
                    },
                    source
                )
                : 0;

        /*
         * THE PLACEMENT, IN ORDER OF PREFERENCE.
         *
         * The stored one wins outright when it exists. A diagram
         * placed with the cursor, or dragged since, has a recorded
         * distance and that is the student's answer - it must not
         * be second-guessed by where the axis happens to be drawn.
         *
         * Reading the DRAWN axis second was a bug, and a quiet
         * one: a diagram placed below a beam stores a positive
         * distance, and when the beam was then moved, the axis was
         * still drawn at its old coordinates. Asking the drawn
         * axis for an offset measured -700 against the beam's new
         * position overrode the stored placement and snapped the
         * diagram back above its own source on the next refresh.
         *
         * So the drawn axis is asked only when there is genuinely
         * nothing recorded - a diagram from before placements were
         * stored - and even then it is a seed, not a decision.
         */
        const seed =
            distance === null
                ? verticalOffsetOf(
                    geometry.start && geometry.end
                        ? {
                            start: geometry.start,
                            end: geometry.end
                        }
                        : null,
                    source
                )
                : null;

        /*
         * Nothing chosen at all: a diagram from before this
         * existed, or one that has never been placed. Laid out
         * just below its source, which is where a diagram belongs
         * and where the student will move it from.
         *
         * The `seed` is only taken when it is non-zero, because a
         * seed of zero means the drawn axis lies exactly ON the
         * source - the unplaced state - and the fallback is
         * strictly better than drawing it there.
         */
        const placement =
            distance !== null
                ? distance + drag
                : seed
                    ? seed
                    : -DEFAULT_ANALYSIS_OFFSET;

        const axis = axisFromSource(
            source,
            span.start.y + placement
        );

        if (axis) {
            /*
             * The placement is recorded so it can be re-applied
             * after the source moves. Without it the axis would be
             * rebuilt from the source's own height every time, and
             * a diagram the student had deliberately parked well
             * clear would be dragged up against its beam on the
             * next edit to anything.
             */
            geometry.sourceOffset = {
                distance: placement
            };

            /*
             * A drag has been folded into the distance, so the
             * world vector must not also be applied on the next
             * refresh - or the diagram would jump by the drag
             * again every time anything was edited.
             */
            geometry.placementOffset = null;

            writeDiagramAxis(
                analysisObject,
                axis,
                source,
                state
            );

            return analysisObject;
        }
    }

    /*
     * NO SOURCE, OR THE SOURCE HAS NO SPAN: FALL BACK TO THE
     * DRAWN AXIS.
     *
     * A diagram with no source is a legitimate thing to want - a
     * blank axis to draw a solution against - and it behaves
     * exactly as it did before: it is its own geometry, moved by
     * the offset, and the refresh leaves it alone.
     */
    const base =
        geometry.baseAxis ||
        (geometry.start && geometry.end
            ? {
                start: { ...geometry.start },
                end: { ...geometry.end }
            }
            : null);

    if (!base) {
        return analysisObject;
    }

    geometry.baseAxis = {
        start: { ...base.start },
        end: { ...base.end }
    };

    const axis = offset
        ? {
            start: {
                x: base.start.x + offset.x,
                y: base.start.y + offset.y
            },
            end: {
                x: base.end.x + offset.x,
                y: base.end.y + offset.y
            }
        }
        : base;

    writeDiagramAxis(analysisObject, axis, null, state);

    return analysisObject;
}

/*
 * WRITE AN AXIS AND ITS STATIONS ONTO A DIAGRAM.
 *
 * One place, because a sourced diagram and a free one differ only
 * in where the axis came from - what they do with it afterwards is
 * identical, and duplicating that is how the two would drift.
 */
function writeDiagramAxis(
    analysisObject,
    axis,
    source,
    state
) {
    const geometry = analysisObject.geometry;

    geometry.start = { ...axis.start };
    geometry.end = { ...axis.end };

    geometry.zeroAxis = {
        from: { ...axis.start },
        to: { ...axis.end }
    };

    /*
     * The base the offset is measured from, kept for a free diagram
     * and as a record of the axis the student confirmed. It is not
     * read for a sourced diagram - that one always starts from the
     * source - but it is what makes an unplaced diagram stable
     * across a refresh.
     */
    if (!geometry.baseAxis) {
        geometry.baseAxis = {
            start: { ...axis.start },
            end: { ...axis.end }
        };
    }

    /*
     * THE RANGE IS THE MEMBER'S, AND IS RESTATED WHENEVER THE MEMBER
     * CHANGES.
     *
     * The graph's x domain is the body the diagram describes: it is where a
     * support sits, where a load ends, and where the student reads a
     * station off. That makes it DERIVED from the body rather than a number
     * the student typed, and a derived value has to be re-derived whenever
     * its source changes.
     *
     * It was seeded once, at creation, and never touched again - so a beam
     * whose Length was edited afterwards left the diagram spanning the OLD
     * length. The axis was rewritten to the new one, the graph was drawn on
     * the new one, and every station came out in the wrong place against
     * it: a diagram that looks right and reads wrong.
     *
     * So it is written from the same span that produced the axis, and this
     * runs for a sourced diagram on every dependency update. Measured ALONG
     * the body from its start, so a sloping member gets the same 0 to L as a
     * level one.
     *
     * THE EXPRESSIONS ARE NOT RESTATED, and that is deliberate. An
     * expression's own range says where that relation EXISTS - it is part of
     * what the student wrote - so widening it along with the body would
     * silently redraw their work. A plot whose body was lengthened keeps the
     * regions it has and simply stops covering the new ground, which is
     * visible and correctable. Stretching the student's equations is not.
     */
    if (source) {
        const length = spanOf(source)?.length;

        if (Number.isFinite(length)) {
            geometry.localRange = {
                from: 0,
                to: length
            };
        }
    }

    const stations = source
        ? sourceStations(source, state)
        : [];

    geometry.referencePositions = stations.map(
        station => ({
            key: station.key,
            label: station.label,
            sourceId: station.sourceId,

            /*
             * WHERE ALONG THE AXIS, as a fraction.
             *
             * Stored as the fraction and not as a world point, so
             * the marker is re-placed from the axis on every pass.
             * A world point would be correct for exactly one size
             * of beam and wrong for every other.
             */
            t: station.t,
            position: mapStationOntoAxis(
                axis,
                station.t
            )
        })
    );

    const sourceSpan = source ? spanOf(source) : null;

    /*
     * The source's span is reported, not imposed. A diagram
     * measures the same member the beam does, and it is drawn
     * wherever the student put it.
     */
    geometry.sourceSpan = sourceSpan
        ? {
            start: { ...sourceSpan.start },
            end: { ...sourceSpan.end },
            length: sourceSpan.length
        }
        : null;

    analysisObject.engineering.unresolved = false;
    analysisObject.engineering.sourceFeatureId = source
        ? source.id
        : undefined;

    return analysisObject;
}

/*
 * The source object, or null if it has been deleted.
 */
function findSource(
    analysisObject,
    state
) {
    const [id] = sourceIdsOf(analysisObject);

    if (!id) {
        return null;
    }

    return (
        state.objects.find(
            object => object.id === id
        ) || null
    );
}

function findSources(
    analysisObject,
    state
) {
    return sourceIdsOf(analysisObject)
        .map(id =>
            state.objects.find(
                object => object.id === id
            )
        )
        .filter(Boolean);
}

/*
 * REFRESH EVERY ANALYSIS OBJECT IN THE DRAWING.
 *
 * Called once after a change, from the one place that commits a
 * change. It is not subscribed per object and it is not called from
 * individual tools: a tool that moves a force does not know a
 * Resultant exists, which is the property that stops this from
 * needing a new case every time a feature becomes editable.
 *
 * Nothing here records history. An automatic update caused by a
 * student's edit is part of THAT edit, and recording it separately
 * would fill the Undo list with entries the student never made and
 * would need an undo to reverse.
 */
function refreshAll(
    state
) {
    if (!state) {
        return 0;
    }

    let count = 0;

    state.objects.forEach(object => {
        if (!isAnalysisObject(object)) {
            return;
        }

        refreshAnalysis(object, state);
        count += 1;
    });

    return count;
}

/*
 * Resolve what happens to analysis objects whose source is gone.
 *
 * Run after a deletion. A Force Components and a Resultant are
 * generated FROM their sources and mean nothing alone, so they are
 * removed with them - leaving one behind would put a live-looking
 * object on the sheet that silently describes a force which is not
 * there. A diagram is NOT removed: it is a workspace the student
 * has been drawing in, with their own solution geometry in it that
 * no deletion can reconstruct, so losing its member costs it its
 * reference framework and nothing else. It is marked unresolved
 * and stays editable.
 */
function resolveDeletedSources(
    state,
    deletedIds
) {
    /*
     * THE GUARD MUST ACCEPT A SET AS WELL AS AN ARRAY.
     *
     * This checked `deletedIds.length`, and a Set has no length - it
     * has `size`. So a Set argument made the guard read `undefined`,
     * which is falsy, and the function returned without doing
     * anything at all.
     *
     * That is not a theoretical shape: the guard below normalises the
     * argument to a Set anyway, and the delete handler passes an
     * ARRAY of ids - but any caller passing a Set, which is the
     * natural type for a set of deleted ids and the type this
     * function goes on to build, silently got no cleanup. Deleting a
     * force then left a Force Components and a Resultant on the
     * sheet, still drawn, still describing a force that was no longer
     * there - which is the exact failure the code below exists to
     * prevent, and it failed quietly, with no error anywhere.
     */
    const ids =
        deletedIds instanceof Set
            ? [...deletedIds]
            : Array.isArray(deletedIds)
                ? deletedIds
                : deletedIds
                    ? [deletedIds]
                    : [];

    if (!state || !ids.length) {
        return [];
    }

    const gone = new Set(ids);
    const removed = [];

    state.objects = state.objects.filter(object => {
        if (!isAnalysisObject(object)) {
            return true;
        }

        const ids = sourceIdsOf(object);

        if (!ids.some(id => gone.has(id))) {
            return true;
        }

        const generated =
            object.type === "force-components" ||
            object.type === "resultant";

        /*
         * A generated object is rebuilt from its remaining
         * sources, or goes if none are left - either way it never
         * keeps a reference to something that no longer exists.
         */
        if (generated) {
            object.engineering.sourceFeatureIds =
                ids.filter(id => !gone.has(id));

            const surviving = findSources(object, state);

            if (!surviving.length) {
                removed.push(object.id);

                return false;
            }

            refreshAnalysis(object, state);

            return true;
        }

        /*
         * A diagram keeps its own work. The member it was read
         * against is simply no longer there to read.
         */
        object.engineering.unresolved = true;

        return true;
    });

    return removed;
}

const registry = {
    ANALYSIS_KINDS,
    DEFAULT_ANALYSIS_OFFSET,
    isAnalysisObject,
    sourceIdsOf,
    registerDependency,
    readForceVector,
    applicationPointOf,
    deriveForceComponents,
    deriveResultant,
    spanOf,
    axisFromSource,
    verticalOffsetOf,
    projectOntoSpan,
    mapStationOntoAxis,
    sourceStations,
    deriveDiagram,
    refreshAnalysis,
    refreshAll,
    resolveDeletedSources
};

const enggAnalysisDependencies = registry;

export default enggAnalysisDependencies;

/*
 * Hand this to the state module so that every committed edit
 * refreshes the analysis objects.
 *
 * Self-registering rather than being wired up by the controller,
 * because the alternative is a list in some other file that has to
 * remember to include this one - and a registry that is present
 * but not connected fails completely silently: everything still
 * loads, every feature still works, and the analysis objects just
 * quietly stop following their sources.
 */
if (
    enggDrawingState &&
    typeof enggDrawingState
        .setAnalysisDependencyRegistry ===
        "function"
) {
    enggDrawingState
        .setAnalysisDependencyRegistry(registry);
}
