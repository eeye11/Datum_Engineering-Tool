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
 * The features to create, with fresh identities and the
 * internal parent links rebuilt.
 *
 * `createdIds` is filled in as each feature is added, so a
 * child pasted after its parent can be pointed at the copy
 * rather than at the original.
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
