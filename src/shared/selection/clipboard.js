/*
 * The drawing clipboard.
 *
 * Copy, paste and cut work on whole features rather than on
 * geometry types, so a Point Force comes back with its
 * magnitude, its direction and its appearance, and a
 * distributed load comes back with its profile. That is why
 * this module stores the complete feature rather than a
 * drawing-specific summary of it: whatever a feature needs in
 * order to exist, it has.
 *
 * A pasted feature is genuinely NEW. It gets a fresh identity,
 * it is renumbered by the normal add path, and it is placed at
 * an offset so it is visibly a copy rather than a duplicate
 * sitting exactly on the original. Its link to a body is
 * re-pointed at the copied body where one was copied with it,
 * so a body and the load on it stay together.
 */
/*
 * How far a pasted feature is offset, in world units.
 *
 * A copy placed exactly on its original would be impossible
 * to pick, because the two would be indistinguishable. This
 * is small enough to read as "the same thing, again" and
 * large enough to grab, and it matches how the Modify tools
 * already place a duplicate.
 */
const PASTE_OFFSET = { x: 10, y: -10 };

/*
 * The keys that describe a feature rather than locate it.
 *
 * These are regenerated on paste, so leaving them behind
 * would give the copy the original's identity and could
 * leave it pointing at the original's parent. Everything
 * else - geometry, style, constraints, engineering
 * metadata - is what makes the copy the same feature.
 */
const IDENTITY_KEYS = [
    "id",
    "parentId"
];

function clone(value) {
    return JSON.parse(
        JSON.stringify(value)
    );
}

/*
 * Everything needed to recreate the given features later.
 *
 * The source ids are kept alongside the copies so that a
 * relationship INSIDE the copied set can be rebuilt: a load
 * pasted with its beam must end up on the pasted beam, not
 * on the beam the original load still belongs to.
 */
function capture(
    objects
) {
    if (!objects.length) {
        return null;
    }

    const features = objects.map(clone);

    /*
     * The ids are regenerated on paste, so the original ids
     * are recorded now, before they are lost. A null source
     * id means the feature had no parent, which is
     * different from a parent that was not copied.
     */
    const sourceIds = features.map(
        feature => feature.id
    );

    return {
        features,
        sourceIds
    };
}

/*
 * Move a whole feature by a delta.
 *
 * It goes through the same transform the rest of the
 * application uses, so a pasted feature is offset through
 * the one definition of what a feature's points are. A
 * rotation is carried at the same time, so an oriented
 * feature does not suddenly lose its angle.
 *
 * EVERY point the feature is drawn through is moved, because a property that
 * described only the well-known keys would leave a shape the student drew
 * partly on the original. The named keys come first for readability; the
 * scan below catches the rest.
 */
function offsetFeature(
    feature,
    deltaX,
    deltaY
) {
    const geometry = feature.geometry || {};

    const move = point => {
        if (
            point &&
            Number.isFinite(point.x) &&
            Number.isFinite(point.y)
        ) {
            point.x += deltaX;
            point.y += deltaY;
        }
    };

    [
        "start",
        "end",
        "position",
        "point",
        "origin"
    ].forEach(key => move(geometry[key]));

    if (Array.isArray(geometry.points)) {
        geometry.points.forEach(move);
    }

    if (Array.isArray(geometry.members)) {
        geometry.members.forEach(member => {
            move(member.start);
            move(member.end);
        });
    }

    /*
     * A VERTEX LIST UNDER ANOTHER NAME IS STILL GEOMETRY.
     *
     * `points` above covers a Polyline and a Freeform Polygon. Every other
     * multi-point shape keeps its vertices under a name of its own, and a paste
     * that moved only the generic keys left those sitting on the original - so
     * the copy landed partly in place and partly offset. Any array of points in
     * the geometry is treated as geometry, which covers the shapes that exist
     * today and any vertex list added tomorrow, without a second list to keep in
     * step with the model.
     *
     * Members are skipped: they are moved above, point by point, and a member is
     * an object with ends rather than a point, so it would otherwise be moved
     * twice and land at double the offset.
     */
    Object.keys(geometry).forEach(key => {
        if (key === "points" || key === "members") {
            return;
        }

        const value = geometry[key];

        if (
            Array.isArray(value) &&
            value.length &&
            value.every(
                item => item && typeof item === "object" && "x" in item
            )
        ) {
            value.forEach(move);
        }
    });

    if (
        geometry.center &&
        Number.isFinite(geometry.center.x)
    ) {
        geometry.center = {
            x: geometry.center.x + deltaX,
            y: geometry.center.y + deltaY
        };
    }

    return feature;
}

/*
 * ============================================================
 * THE FEATURES TO CREATE, AS INDEPENDENT COPIES
 * ============================================================
 *
 * A copy must be a NEW feature: it keeps everything that makes it the same
 * KIND of thing - type, geometry, style, engineering metadata, parameters -
 * and loses only what identifies it. Three groups of key are handled here,
 * and they are all "where this feature sits", never "what this feature is".
 *
 *   1. IDENTITY                 `id` and `parentId` are regenerated, so the copy
 *                               has its own row in the Feature Tree.
 *
 *   2. INTERNAL LINKS           A parent that was ALSO copied is re-pointed at
 *                               the copy, so a load pasted with its beam sits on
 *                               the pasted beam - not on the original, which is
 *                               the bug that would otherwise make pasting a
 *                               connected group silently attach to the old
 *                               drawing.
 *
 *   3. EXTERNAL LINKS           A parent that was NOT copied is DROPPED, not
 *                               kept. `parentId` is the one field the Feature
 *                               Tree nests by and the one the dependent-feature
 *                               systems follow - deleting a body deletes its
 *                               children, moving one carries them. A copy left
 *                               pointing at the ORIGINAL body would therefore be
 *                               dragged around and deleted by something the
 *                               student never copied, which is the "do not break
 *                               unrelated attached objects" failure.
 *
 * DERIVED FEATURES ARE COPIED TOO. A Resultant is refused by the Move TOOL
 * because its position is re-derived from its parents; that is a rule about
 * moving, not about existing. A copy of one is a perfectly good independent
 * reading of the copied forces, and refusing it here would make Duplicate
 * behave differently for Statics children than for everything else.
 */
function prepare(
    clipboard,
    createdIds
) {
    if (!clipboard) {
        return [];
    }

    const idMap = new Map();

    const features =
        clipboard.features.map(
            (feature, index) => {
                const copy = clone(feature);

                IDENTITY_KEYS.forEach(
                    key => delete copy[key]
                );

                /*
                 * Remember which source each copy came from,
                 * so a link from one copied feature to
                 * another can be redirected to the copy.
                 */
                idMap.set(
                    clipboard.sourceIds[index],
                    index
                );

                return copy;
            }
        );

    /*
     * A feature's parent is re-pointed only if that parent
     * was itself copied. A feature pasted on its own keeps
     * no parent, because the body it belonged to is still
     * in the drawing and re-attaching it to a copy that was
     * never made would be wrong in the other direction.
     */
    clipboard.features.forEach(
        (source, index) => {
            const parentId =
                source.parentId;

            if (!parentId) {
                return;
            }

            const mapped =
                idMap.get(parentId);

            if (
                mapped === undefined
            ) {
                /*
                 * THE ORIGINAL IS STILL IN THE DRAWING, so the copy must not
                 * claim it as a parent. `delete` rather than reassignment, so
                 * the field is absent rather than null - which is what the
                 * serialiser and the Feature Tree both expect of a root.
                 */
                delete features[index]
                    .parentId;
            }
        }
    );

    return features;
}

const enggDrawingClipboard = {
    PASTE_OFFSET,
    capture,
    offsetFeature,
    prepare
};

export default enggDrawingClipboard;
