/*
 * ============================================================
 * WHAT EACH FEATURE TYPE IS
 * ============================================================
 *
 * One entry per stored feature type (the `type` field of a feature),
 * declaring the groups it belongs to. Code that needs to know "is this a
 * support?" or "can a load attach to this?" asks the predicates below,
 * rather than keeping its own list of type names - so adding a type, or
 * moving one between groups, is one edit here instead of a hunt through
 * every module that once listed it.
 *
 * TRAITS
 * ------
 *   body        a Statics body that other Statics features attach to
 *               (supports, loads, moments, connections)
 *   attachable  a Statics feature that can be attached to a body
 *   support     a support (pin, roller, fixed, smooth)
 *   connection  a connection between bodies (pin, fixed, slider)
 *   vector      drawn with the shared vector arrows, so it carries the
 *               Statics vector display settings
 *   spanShaped  a straight member between two ends: hit-tested and
 *               box-selected along its span rather than as an area
 *
 * The order of entries is meaningful where a list is derived from it:
 * typesWith("body") lists bodies in the order the Statics tools offer
 * them.
 */
export const FEATURE_TYPES = Object.freeze({
    /*
     * ====================================================
     * THE TRAIT REGISTRY
     * ====================================================
     *
     * Every feature type the application can create answers here, so the
     * SHARED systems - hit testing, box selection, fit bounds, attachment,
     * vector scale - can ask what a thing IS rather than testing for it by
     * name.
     *
     * `spanShaped`  a straight member between two ends: measured along its
     *               span rather than as an area.
     * `body`        something a load, support or connection attaches to.
     * `vector`      drawn as an arrow whose length is the shared Vector Scale.
     * `pointLike`   an engineering node drawn AT a position.
     * `area`        a closed outline, selected as a shape rather than a span.
     *
     * A TYPE MISSING FROM HERE FALLS TO THE LAST-RESORT TEST, which asks only
     * whether one of its defining POINTS is inside a selection rectangle. That
     * fallback is honest but weak: a long polyline crossing a box is not
     * "inside" it, so a feature the registry has not heard of can be clickable
     * and yet impossible to sweep up. That is what `polyline` did.
     */
    line: { spanShaped: true },

    /*
     * A POLYLINE IS A CHAIN OF SPANS. It is span-shaped for the same reason a
     * line is - a box that crosses one of its segments has crossed the
     * feature - and leaving it out meant a polyline could only be box-selected
     * by catching one of its own vertices.
     */
    polyline: { spanShaped: true },

    /*
     * THE CLOSED GEOMETRY IS `area`: a rectangle, a triangle and a polygon are
     * outlines rather than spans, so they are tested as shapes. A circle and an
     * arc are area-like too - a box anywhere near the ring has crossed it.
     */
    rectangle: { area: true },
    triangle: { area: true },
    polygon: { area: true },
    circle: { area: true },
    arc: { area: true },

    point: { pointLike: true },
    particle: { body: true, pointLike: true },
    "rigid-body": { body: true, area: true },
    beam: { body: true, spanShaped: true },
    truss: { body: true, spanShaped: true },
    cable: { body: true, spanShaped: true },
    shaft: { body: true, spanShaped: true },

    force: { attachable: true, vector: true },
    /*
     * ====================================================
     * THE DERIVED CHILDREN OF A FORCE
     * ====================================================
     *
     * A Resultant and a Force Components pair are ANALYSIS CHILDREN of the
     * force(s) they read. They are selectable, inspectable, deletable and they
     * contribute to Fit - but they are NOT independently movable, because their
     * position, direction and magnitude are all derived from their parents.
     *
     * `derived` records that explicitly, so the shared Move system asks what a
     * feature IS rather than keeping its own list of type names - and a future
     * derived child gets the same treatment by being listed here once.
     */
    resultant: { vector: true, derived: true },
    load: { attachable: true, vector: true },
    "varying-load": { attachable: true, vector: true },
    moment: { attachable: true, pointLike: true },

    "force-components": { annotation: true, derived: true },

    "pin-support": { attachable: true, support: true, pointLike: true },
    "roller-support": { attachable: true, support: true, pointLike: true },
    "fixed-support": { attachable: true, support: true, pointLike: true },
    "smooth-support": { attachable: true, support: true, pointLike: true },

    "pin-connection": { connection: true, spanShaped: true },
    "fixed-connection": { connection: true, spanShaped: true },
    "slider-connection": { connection: true, spanShaped: true },
    /* The generic connection, kept so older documents still read correctly. */
    connection: { spanShaped: true },

    /*
     * ====================================================
     * ANNOTATE
     * ====================================================
     *
     * Dimensions and annotations are drawing content: they are selectable,
     * movable, deletable and they contribute to Fit. They are NOT bodies,
     * vectors or spans - a dimension's ink is its own - so they carry no trait
     * beyond being recognised at all, which is what the entry itself records.
     *
     * A `variable-dimension` is listed separately because it is a separate
     * TYPE, and a type the registry has not heard of is a type the shared
     * systems can only half-see.
     */
    dimension: { annotation: true },
    "variable-dimension": { annotation: true },
    annotation: { annotation: true },
    annotate: { annotation: true },

    "analysis-diagram": { annotation: true },
    "coordinate-system-2d": { annotation: true },

    construction: { annotation: true }
});

const traitOf = (type, trait) => Boolean(FEATURE_TYPES[type]?.[trait]);

/* Every type with a trait, in the order they are declared above. */
export function typesWith(trait) {
    return Object.keys(FEATURE_TYPES).filter(type => traitOf(type, trait));
}

/* The Statics bodies, in the order the Statics tools offer them. */
export const STATICS_BODY_TYPES = Object.freeze(typesWith("body"));
export const SUPPORT_TYPES = Object.freeze(typesWith("support"));
export const CONNECTION_TYPES = Object.freeze(typesWith("connection"));

export const isStaticsBodyType = type => traitOf(type, "body");
export const attachableStaticsType = type => traitOf(type, "attachable");
export const isSupportType = type => traitOf(type, "support");
export const isConnectionType = type => traitOf(type, "connection");
export const isSpanShapedType = type => traitOf(type, "spanShaped");
export const usesStaticsVectors = object => traitOf(object?.type, "vector");

/*
 * THE TWO TRAITS THE GENERAL SYSTEMS ASK ABOUT.
 *
 * `isAreaType` and `isPointLikeType` exist for the same reason `isSpanShapedType`
 * does: a shared system asks what a feature IS, from one registry, rather than
 * testing for a list of names. A box-selection rule that spelled out
 * `rectangle || triangle || polygon || circle || arc` would need editing every
 * time another closed shape was added - and the one that was forgotten would be
 * the one that silently stopped being selectable.
 */
export const isAreaType = type => traitOf(type, "area");
export const isPointLikeType = type => traitOf(type, "pointLike");
export const isAnnotationType = type => traitOf(type, "annotation");

/*
 * ====================================================
 * A DERIVED FEATURE IS READ, NOT MOVED
 * ====================================================
 *
 * A Resultant and a Force Components pair are static children of the force(s)
 * they read. Their position, direction and magnitude are all re-derived from
 * those parents, so moving one directly would be a change the next refresh
 * immediately undoes - or worse, an offset that survives as a lie about where
 * the reading belongs.
 *
 * They may still be SELECTED, inspected, box-selected, fitted, hovered and
 * deleted; only the Move is refused, and it is refused because the thing the
 * student wants changed lives on the PARENT.
 */
export const isDerivedType = type => traitOf(type, "derived");

/*
 * Is this feature one whose geometry is decided by something else?
 *
 * Asked of an OBJECT rather than a type, so callers that have the feature in
 * hand do not have to name its type.
 */
export const isDerivedFeature = object =>
    Boolean(object) && traitOf(object.type, "derived");

/*
 * IS THIS TYPE KNOWN AT ALL?
 *
 * The shared systems use it to notice a feature the registry has not heard of.
 * An unknown type is not an error - a document from a newer build may carry
 * one - but it is worth being able to ask, because the answer is "this feature
 * gets the fallback treatment", and that is exactly the state that made a
 * polyline impossible to box-select.
 */
export const isKnownFeatureType = type => Boolean(FEATURE_TYPES[type]);
export const hasTrait = (type, trait) => traitOf(type, trait);
