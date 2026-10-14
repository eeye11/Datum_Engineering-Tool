/*
 * The Modify tools: Move, Rotate, Mirror, Trim and Extend.
 */

import enggDrawingState from "../core/model/drawing-state.js";
import { isDerivedFeature } from "../core/model/feature-types.js";
import { renderCurrentDrawing } from "./canvas-render.js";
import { objectsByIds } from "./clipboard-commands.js";
import { drawingCanvas } from "./dom.js";
import { drawingState, editorState } from "./editor-state.js";
import { renderProperties } from "./feature-panel.js";
import { objectAtPoint } from "./hit-testing.js";
import { modifyInstruction } from "./pointer.js";
import { activateTool } from "./tool-activation.js";
import { setToolMessage } from "./toolbar-render.js";
import { extendObjectToBoundary, mirrorObjectAcrossLine, rotateObjectAbout, translateObject, trimSegmentAt, trimSegmentAtCursor } from "./transforms.js";
import { fitDrawingToView, zoomAtCanvasPoint } from "./viewport.js";
import { clearGlobalToolHighlight } from "./workspace-controls.js";

export function beginModifySession(
    kind
) {
    cancelModifySession();

    editorState.modifySession = {
        kind,

        /*
         * Selected ids are captured up front so the
         * geometry being changed cannot shift under the
         * operation if the selection changes.
         */
        ids: [
            ...drawingState.selection
                .selectedObjectIds
        ],

        /*
         * Mirror skips its object-selection stage when the
         * user already selected the features before
         * activating the tool, so it goes straight to
         * "Select mirror line or point" as specified.
         */
        stage:
            kind === "mirror" &&
            drawingState.selection
                .selectedObjectIds.length
                ? "axis"
                : "base",

        basePoint:
            null,

        pivot:
            null,

        axisStart:
            null,

        axisEnd:
            null,

        boundaryId:
            null,

        preview:
            null
    };
}

export function cancelModifySession() {
    /*
     * The toolbar highlight is cleared even when no
     * session is running, so a cancelled tool never
     * looks active.
     */
    clearGlobalToolHighlight();

    if (!editorState.modifySession) {
        return;
    }

    editorState.modifySession =
        null;

    drawingState.interaction.preview =
        null;

    drawingState.interaction.previewObjects =
        [];

    renderCurrentDrawing();
}

/*
 * Modify tools start an interactive session rather than
 * applying a fixed offset. Geometry only changes when
 * the user commits.
 */
export function activateGlobalTool(
    toolId,
    button
) {
    if (toolId === "pan") {
        activateTool("pan");
        setToolMessage(
            "Drag to pan the view"
        );
        return;
    }

    if (toolId === "zoom") {
        /*
         * Zoom in one step around the canvas centre,
         * matching the toolbar zoom buttons.
         */
        const bounds =
            drawingCanvas.getBoundingClientRect();

        zoomAtCanvasPoint(
            drawingState.camera.zoom * 1.2,
            {
                clientX:
                    bounds.left +
                    bounds.width / 2,

                clientY:
                    bounds.top +
                    bounds.height / 2
            }
        );

        setToolMessage(
            "Zoom"
        );
        return;
    }

    if (toolId === "fit") {
        fitDrawingToView();
        return;
    }

    /*
     * Mirror begins by taking what to mirror from the CURRENT
     * selection, so the button behaves like the other Modify
     * tools rather than being the one that has to make its own
     * selection first.
     *
     * If something is already selected, the session goes
     * straight to the axis stage. If nothing is, it waits with
     * an instruction that says what to do, and the first click
     * picks the feature. Either way the axis is never demanded
     * from a click on empty space.
     */
    if (toolId === "mirror") {
        beginModifySession("mirror");

        const selected =
            drawingState.selection
                .selectedObjectIds;

        if (selected.length) {
            editorState.modifySession.ids =
                [...selected];

            editorState.modifySession.stage =
                "axis";
        }

        setToolMessage(
            modifyInstruction(
                editorState.modifySession
            )
        );

        renderProperties();
        renderCurrentDrawing();
        return;
    }

    if (
        !drawingState.selection
            .selectedObjectIds.length
    ) {
        setToolMessage(
            "Select geometry first"
        );

        return;
    }

    if (toolId === "move") {
        beginModifySession("move");

        setToolMessage(
            "Specify base point"
        );

        return;
    }

    if (toolId === "rotate") {
        beginModifySession("rotate");

        setToolMessage(
            "Specify rotation pivot"
        );

        return;
    }

    if (toolId === "trim") {
        beginModifySession("trim");

        /*
         * ONE INSTRUCTION, because there is one decision: which piece goes.
         * The crossings either side of the click define it, so nothing else is
         * asked for.
         */
        setToolMessage(
            "Click the part of the line you want removed"
        );

        return;
    }

    if (toolId === "extend") {
        beginModifySession("extend");

        setToolMessage(
            "Select the boundary to extend to"
        );
    }
}

/*
 * Build ghost copies of the objects being modified, so
 * the user sees the result before committing. The
 * originals are left untouched; these are throwaway
 * previews rendered with preview styling.
 */
function buildModifyPreview(
    transform
) {
    if (!editorState.modifySession) {
        return;
    }

    const ghosts =
        objectsByIds(
            editorState.modifySession.ids
        ).map(
            object => {
                const ghost =
                    JSON.parse(
                        JSON.stringify(
                            object
                        )
                    );

                ghost.id =
                    `preview-${object.id}`;

                transform(ghost);

                return ghost;
            }
        );

    drawingState.interaction.previewObjects =
        ghosts;
}

function clearModifyPreview() {
    drawingState.interaction.previewObjects =
        [];

    /*
     * The trim highlight goes with them, so a cursor that leaves the geometry
     * leaves nothing behind - a stale "this is about to be removed" mark would
     * be actively misleading.
     */
    if (editorState.modifySession) {
        editorState.modifySession.trimPreview = null;
    }

    drawingState.interaction.trimPreview = null;
}

/*
 * Live preview while a Modify session is in its final
 * stage, driven from the resolved cursor position.
 */
export function updateModifyPreview(
    resolution
) {
    if (!editorState.modifySession) {
        return;
    }

    const point =
        resolution.effectiveConstructionPoint;

    if (!point) {
        clearModifyPreview();
        return;
    }

    /*
     * TRIM SHOWS THE PIECE THAT WILL GO.
     *
     * The preview is not a ghost of the result - it is the SEGMENT ITSELF,
     * highlighted, because that is the question the student is asking: "is this
     * the part I mean?". It is computed by the same function the commit uses,
     * so the highlight and the removal cannot disagree about which piece is
     * which - a preview that promised one piece and removed another would be
     * worse than no preview at all.
     *
     * It follows the cursor from segment to segment, and is CLEARED whenever
     * there is no segment under it, so a stale highlight is never left behind.
     */
    if (editorState.modifySession.kind === "trim") {
        const rawPoint = resolution.rawPoint || point;

        const target = objectAtPoint(rawPoint);

        const segment = target
            ? trimSegmentAt(target, drawingState.objects, point)
            : null;

        if (!segment) {
            clearModifyPreview();

            return;
        }

        editorState.modifySession.trimPreview = {
            targetId: target.id,
            from: { ...segment.from },
            to: { ...segment.to }
        };

        /*
         * The highlight travels on the INTERACTION, which is the state the
         * renderer already reads - so the renderer needs no knowledge of a
         * Modify session, and no import that could cycle back to the editor.
         */
        drawingState.interaction.trimPreview = {
            from: { ...segment.from },
            to: { ...segment.to }
        };

        /*
         * No ghost objects: nothing is being built, so nothing is added to the
         * preview list. The highlight is drawn from `trimPreview` instead.
         */
        drawingState.interaction.previewObjects = [];
        drawingState.interaction.preview = null;

        renderCurrentDrawing();

        return;
    }

    if (
        editorState.modifySession.kind === "move" &&
        editorState.modifySession.stage === "target" &&
        editorState.modifySession.basePoint
    ) {
        const deltaX =
            point.x - editorState.modifySession.basePoint.x;

        const deltaY =
            point.y - editorState.modifySession.basePoint.y;

        buildModifyPreview(
            ghost =>
                translateObject(
                    ghost,
                    deltaX,
                    deltaY
                )
        );

        return;
    }

    if (
        editorState.modifySession.kind === "rotate" &&
        editorState.modifySession.stage === "target" &&
        editorState.modifySession.pivot
    ) {
        const radians =
            Math.atan2(
                point.y - editorState.modifySession.pivot.y,
                point.x - editorState.modifySession.pivot.x
            ) -
            (editorState.modifySession.rotateStart || 0);

        buildModifyPreview(
            ghost =>
                rotateObjectAbout(
                    ghost,
                    editorState.modifySession.pivot,
                    radians
                )
        );

        return;
    }

    if (
        editorState.modifySession.kind === "mirror" &&
        editorState.modifySession.stage === "axis-end" &&
        editorState.modifySession.axisStart
    ) {
        /*
         * Preview against the provisional axis while the
         * user is still choosing its second point.
         */
        buildModifyPreview(
            ghost =>
                mirrorObjectAcrossLine(
                    ghost,
                    editorState.modifySession.axisStart,
                    point
                )
        );
    }
}

/*
 * Handle a canvas click while a Modify session is
 * running. Each tool advances through its own stages
 * and commits only on the final click.
 */
export function handleModifyClick(
    resolution,
    rawPoint,
    shiftHeld = false
) {
    if (!editorState.modifySession) {
        return false;
    }

    const point =
        resolution.effectiveConstructionPoint ||
        rawPoint;

    if (!point) {
        return true;
    }

    const session =
        editorState.modifySession;

    /*
     * Mirror is a selection operation first. The features to
     * mirror are the ones already selected, which is what the
     * Select tool has been maintaining all along, so the session
     * adopts that selection rather than asking the user to
     * re-pick them.
     *
     * The object-picking stage is gone: it existed only to
     * demand a click on empty space as a way of saying "I'm
     * done picking", which is a step with no meaning of its own.
     * If nothing is selected the session says so and waits,
     * which is the only question that actually has to be asked.
     */
    if (
        session.kind === "mirror" &&
        session.stage === "base"
    ) {
        const object =
            objectAtPoint(
                rawPoint
            );

        if (!object) {
            setToolMessage(
                "Select the features to mirror first"
            );

            return true;
        }

        /*
         * A click with nothing picked yet takes the single
         * feature under the cursor, so the common case is one
         * click rather than select-then-Mirror. Once something
         * is already held, Shift toggles, so several can be
         * gathered the way they are with the Select tool.
         */
        if (shiftHeld || !session.ids.length) {
            enggDrawingState.selectObjects(
                drawingState,
                [
                    object.id
                ]
            );
        }

        session.ids = [
            ...drawingState.selection
                .selectedObjectIds
        ];

        session.stage = "axis";

        setToolMessage(
            modifyInstruction(session)
        );

        renderProperties();
        renderCurrentDrawing();

        return true;
    }

    if (
        session.kind === "trim" ||
        session.kind === "extend"
    ) {
        return handleTrimExtendClick(
            session,
            rawPoint,
            point
        );
    }

    if (session.kind === "move") {
        if (session.stage === "base") {
            session.basePoint = { ...point };
            session.stage = "target";

            setToolMessage(
                "Specify destination"
            );

            return true;
        }

        if (session.basePoint) {
            commitMove(
                point.x - session.basePoint.x,
                point.y - session.basePoint.y
            );
        }

        return true;
    }

    if (session.kind === "rotate") {
        if (session.stage === "base") {
            session.pivot = { ...point };
            session.stage = "target";

            /*
             * The rotation angle is measured from the
             * pivot's own +X direction, so the second
             * click's bearing from the pivot is the
             * angle to rotate by.
             */
            session.rotateStart = 0;

            setToolMessage(
                "Specify rotation angle"
            );

            return true;
        }

        if (session.pivot) {
            commitRotate(
                session.pivot,
                point
            );
        }

        return true;
    }

    if (session.kind === "mirror") {
        return handleMirrorClick(
            session,
            rawPoint,
            point
        );
    }

    return true;
}

/*
 * Move: translate the captured selection by the world
 * delta between the base point and the commit point.
 */
function commitMove(
    deltaX,
    deltaY
) {
    if (
        !editorState.modifySession ||
        (!deltaX && !deltaY)
    ) {
        cancelModifySession();
        return;
    }

    const previous =
        enggDrawingState.snapshotDrawing(
            drawingState
        );

    objectsByIds(
        editorState.modifySession.ids
    )
        /*
         * A DERIVED CHILD IS NOT MOVED BY THE MOVE TOOL EITHER.
         *
         * The Move tool asks nothing about what a feature IS - it translates
         * everything in the selection - so a Resultant caught in the selection
         * would be nudged like a drawn line. Its place comes from its source
         * force, so the general Move system must not assume that everything
         * selectable is movable; the feature's own capability decides it. A
         * feature the student wants moved is the FORCE, not its reading.
         */
        .filter(
            object =>
                !isDerivedFeature(object)
        )
        .forEach(
            object =>
                translateObject(
                    object,
                    deltaX,
                    deltaY
                )
        );

    enggDrawingState.commitDrawingChange(
        drawingState,
        previous
    );

    cancelModifySession();

    setToolMessage(
        "Moved selection"
    );

    renderProperties();
    renderCurrentDrawing();
}

/*
 * Rotate: rotate the captured selection about the chosen
 * pivot by the angle from the pivot to the commit
 * point, measured from the pivot to the base point.
 */
function commitRotate(
    pivot,
    target
) {
    const startAngle =
        editorState.modifySession &&
        editorState.modifySession.rotateStart !== undefined
            ? editorState.modifySession.rotateStart
            : Math.atan2(
                target.y - pivot.y,
                target.x - pivot.x
            );

    const endAngle =
        Math.atan2(
            target.y - pivot.y,
            target.x - pivot.x
        );

    const radians =
        endAngle -
        startAngle;

    if (
        !Number.isFinite(radians) ||
        Math.abs(radians) < 1e-9
    ) {
        cancelModifySession();
        return;
    }

    const previous =
        enggDrawingState.snapshotDrawing(
            drawingState
        );

    objectsByIds(
        editorState.modifySession.ids
    ).forEach(
        object =>
            rotateObjectAbout(
                object,
                pivot,
                radians
            )
    );

    enggDrawingState.commitDrawingChange(
        drawingState,
        previous
    );

    cancelModifySession();

    setToolMessage(
        "Rotated selection"
    );

    renderProperties();
    renderCurrentDrawing();
}

/*
 * Mirror axis resolution: an existing line becomes the
 * axis directly; an existing point becomes the first of
 * a two-point axis.
 */
function handleMirrorClick(
    session,
    rawPoint,
    point
) {
    if (session.stage === "axis") {
        const object =
            objectAtPoint(
                rawPoint
            );

        /*
         * A line provides the axis outright. It does not
         * have to be outside the selection, so a line the
         * user happens to have picked is still usable as
         * the mirror axis.
         */
        if (
            object &&
            object.type === "line"
        ) {
            /*
             * The axis is a reference, so it is removed
             * from the set being mirrored.
             */
            session.ids =
                session.ids.filter(
                    id =>
                        id !==
                        object.id
                );

            if (!session.ids.length) {
                setToolMessage(
                    "Select objects to mirror"
                );

                return true;
            }

            session.axisStart = {
                ...object.geometry.start
            };

            session.axisEnd = {
                ...object.geometry.end
            };

            commitMirror();
            return true;
        }

        /*
         * Anything else acts as the first axis point,
         * so the axis is the infinite line through it
         * and the next click.
         */
        session.axisStart = { ...point };
        session.stage = "axis-end";

        setToolMessage(
            "Specify second point"
        );

        return true;
    }

    if (session.stage === "axis-end") {
        session.axisEnd = { ...point };
        commitMirror();
        return true;
    }

    return true;
}

/*
 * Reflect the captured selection across the resolved
 * world-space axis.
 */
function commitMirror() {
    if (
        !editorState.modifySession ||
        !editorState.modifySession.axisStart ||
        !editorState.modifySession.axisEnd
    ) {
        cancelModifySession();
        return;
    }

    const start =
        editorState.modifySession.axisStart;

    const end =
        editorState.modifySession.axisEnd;

    if (
        Math.hypot(
            end.x - start.x,
            end.y - start.y
        ) < 1e-9
    ) {
        setToolMessage(
            "Mirror axis needs two distinct points"
        );

        cancelModifySession();
        return;
    }

    const previous =
        enggDrawingState.snapshotDrawing(
            drawingState
        );

    /*
     * Mirror is a duplicate operation: the originals stay
     * exactly where they are and the reflected geometry is
     * created as new, independent features.
     */
    const originals =
        objectsByIds(
            editorState.modifySession.ids
        );

    const mirrored = [];

    originals.forEach(
        object => {
            /*
             * Work on a deep copy so the source feature is
             * never touched.
             */
            const copy =
                JSON.parse(
                    JSON.stringify(
                        object
                    )
                );

            copy.id =
                `${object.type}-mirror-${object.id}`;

            mirrorObjectAcrossLine(
                copy,
                start,
                end
            );

            mirrored.push(
                copy
            );
        }
    );

    mirrored.forEach(
        copy => {
            /*
             * addObject assigns the final unique id and a
             * sequential name, so the mirror gets its own
             * feature identity in the tree. It returns the
             * STORED object, not an id - assigning it to
             * `copy.id` made the feature contain itself, and
             * the sheet could no longer be saved.
             */
            const stored =
                enggDrawingState.addObject(
                    drawingState,
                    copy
                );

            copy.id = stored.id;
        }
    );

    enggDrawingState.commitDrawingChange(
        drawingState,
        previous
    );

    /*
     * The new mirrored features become the selection, so
     * the user can see what was just created.
     */
    enggDrawingState.selectObjects(
        drawingState,
        mirrored.map(
            copy =>
                copy.id
        )
    );

    cancelModifySession();

    setToolMessage(
        mirrored.length === 1
            ? "Mirrored: created 1 new feature"
            : `Mirrored: created ${mirrored.length} new features`
    );

    renderProperties();
    renderCurrentDrawing();
}

/*
 * ========================================================
 * TRIM IS ONE CLICK; EXTEND IS TWO
 * ========================================================
 *
 * TRIM identifies a PIECE OF LINE, and the piece is found from the geometry -
 * the crossings either side of where the student clicked. So there is nothing
 * else to select: no cutting edge, no direction, no second click. The student
 * points at the part they want gone and it goes.
 *
 * EXTEND is genuinely two decisions - what to grow, and what to grow it TO - so
 * it keeps the boundary-then-target flow. Those two are not the same operation
 * and pretending otherwise would make Extend guess at a boundary.
 */
function handleTrimExtendClick(
    session,
    rawPoint,
    point
) {
    if (session.kind === "trim") {
        const target = objectAtPoint(rawPoint);

        if (!target) {
            return true;
        }

        trimSegmentAtCursor(target, point, drawingState.objects);

        return true;
    }

    if (session.stage === "base") {
        const boundary =
            objectAtPoint(
                rawPoint
            );

        if (!boundary) {
            return true;
        }

        session.boundaryId =
            boundary.id;

        session.stage =
            "target";

        setToolMessage(
            "Select the geometry to extend"
        );

        return true;
    }

    const target =
        objectAtPoint(
            rawPoint
        );

    if (!target) {
        return true;
    }

    const boundary =
        drawingState.objects.find(
            object =>
                object.id ===
                session.boundaryId
        );

    if (!boundary || boundary.id === target.id) {
        return true;
    }

    extendObjectToBoundary(
        target,
        boundary,
        point
    );

    return true;
}
