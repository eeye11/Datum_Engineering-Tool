/*
 * Analysis tools: resultant, force components, and the SFD/BMD/AFD diagram frames.
 */

import enggDrawingState from "../../../shared/model/drawing-state.js";
import enggAnalysisDependencies from "../model/analysis/analysis-dependencies.js";
import enggDiagramEquations from "../model/analysis/diagram-equations.js";
import enggLoadProfile from "../model/analysis/load-profile.js";
import { distanceToSegment } from "../../../shared/geometry/points.js";
import { renderCurrentDrawing } from "../../../components/layout/workspace/canvas-render.js";
import { drawingState } from "../editor-state.js";
import { renderProperties } from "../../../components/layout/panels/feature-panel.js";
import { openAnalysisEditorFor } from "./analysis-editor.js";
import { setToolMessage } from "../../../components/layout/toolbar/toolbar-render.js";

/*
 * Statics analysis tools.
 *
 * These assist a student's own reasoning rather than
 * solving the problem for them: they report the sums and
 * resolved components of whatever is currently selected,
 * and leave the interpretation to the user. Nothing here
 * invents unknowns or picks a solution.
 */
export const STATICS_ANALYSIS_TOOLS = [
    "resultant",
    "force-components",
    "shear-force-diagram",
    "bending-moment-diagram",
    "axial-force-diagram"
];

/*
 * The three diagram tools, named.
 *
 * The key is the diagram's identity, which is what the factory,
 * the renderer, the icon and the Features entry all read. Naming
 * it here rather than deriving it from the tool id keeps the tool
 * a way of asking for a diagram and the diagram itself a thing
 * with an identity of its own.
 *
 * Equilibrium and Moment Analysis are deliberately absent. They
 * read the student's forces and print a verdict, which is a
 * first step into doing the exercise for them.
 */
export const ANALYSIS_DIAGRAM_TOOLS = {
    "shear-force-diagram": "shear-force-diagram",
    "bending-moment-diagram": "bending-moment-diagram",
    "axial-force-diagram": "axial-force-diagram"
};

/*
 * The abbreviation each diagram is named and recognised by.
 *
 * "SFD", "BMD" and "AFD" are what a student calls these and what
 * they will search for in the Features panel, so the abbreviation
 * IS the name here - the long form lives in the tool's label and on
 * the template's own heading, where there is room for it.
 */
const ANALYSIS_DIAGRAM_NAMES = {
    "shear-force-diagram": "SFD",
    "bending-moment-diagram": "BMD",
    "axial-force-diagram": "AFD"
};

/*
 * SKETCH OR PLOT, PER DIAGRAM TOOL.
 *
 * The three diagrams differ only in WHICH force they carry, and a student
 * gets to the same place either way: choose a body, then either draw the
 * answer by hand or type the equations and have it drawn. So the choice
 * is a property of the TOOL PICK, not of the diagram, and it is recorded
 * once here and read by the one shared placement path.
 *
 * A third mode is deliberate. An automated diagram solves the exercise,
 * which is the thing these tools exist to avoid - a scaffold that already
 * contains the answer teaches nothing. So the default and only starting
 * point is the student working it out.
 */
export const ANALYSIS_DIAGRAM_MODES = ["sketch", "plot"];

export const ANALYSIS_DIAGRAM_MODE_LABELS = {
    sketch: "Sketch",
    plot: "Plot"
};

/*
 * The quantity each diagram plots used to be listed here, keyed by feature
 * type, and the equation field in the Features panel was labelled from it.
 *
 * That table is gone. The symbol is now read from the diagram's own type by
 * the equations module, which is where the diagrams are described - and a
 * second table beside it was a second answer to "what is this diagram
 * plotting?", free to disagree with the first.
 */

/*
 * Selected statics features, or every statics feature when
 * nothing is selected, so a tool still does something
 * useful on a bare diagram.
 */
export function selectedStaticsFeatures() {
    const selected =
        drawingState.selection
            .selectedObjectIds;

    return drawingState.objects.filter(
        object =>
            object.engineering?.discipline ===
                "statics" &&
            (selected.length
                ? selected.includes(
                    object.id
                )
                : true)
    );
}

/*
 * Kept for the future tool library: the analysis tools will read force
 * features again once their LaTeX implementations are written. Unused
 * during the Phase 1 reset, and exported so ESLint keeps it visible.
 */
export function forcesOf(features) {
    void features;

    return [];
}

/*
 * The BODY an analysis diagram should be read against.
 *
 * A diagram measures a member, so it needs one: a Beam, a Truss, a
 * shaft, a cable, a rigid body - anything that has a span. If a
 * support or a force is selected instead, the body they are attached
 * to is the thing being measured, so their parent is followed; that
 * is what makes "select a support, then SFD" work, which is how a
 * student thinks about a beam they have propped up rather than about
 * the beam as a separate object.
 *
 * Returns null when nothing suitable is selected, which is not an
 * error: a diagram with no source is a valid blank axis to draw a
 * solution against.
 */
export function analysisSourceBody(
    candidates
) {
    /*
     * A candidate can be missing: a click that snapped to something which
     * is not a feature (a grid point, empty space) arrives as undefined.
     * It is simply not a body, rather than a crash.
     */
    const features =
        candidates.filter(Boolean);

    const member =
        features.find(
            object =>
                object.type === "beam" ||
                object.type === "truss" ||
                object.type === "shaft" ||
                object.type === "cable" ||
                object.type === "rigid-body"
        );

    if (member) {
        return member;
    }

    /*
     * Nothing that is itself a member, so follow the parent of
     * whatever was selected. Taken from the whole sheet rather than
     * from the selection, because a support the student selected may
     * not be a statics feature in the list the caller was given.
     */
    const child = features[0];

    if (child && child.parentId) {
        return drawingState.objects.find(
            object =>
                object.id === child.parentId
        ) || null;
    }

    return null;
}

function componentOf(
    force
) {
    const radians =
        (Number(force.geometry.angle) || 0) *
        Math.PI /
        180;

    const magnitude =
        Number(force.geometry.magnitude) || 0;

    return {
        x: magnitude * Math.cos(radians),
        y: magnitude * Math.sin(radians)
    };
}

/*
/*
 * The name for the next diagram of a given kind.
 *
 * Counted among features of the SAME kind only, so an SFD is "SFD 2"
 * on a sheet that already carries a Beam, a truss and an SFD, rather
 * than picking up a number from features that have nothing to do
 * with it.
 *
 * Both the shared feature type and the name are checked, because a
 * diagram created before the name existed is still a diagram and
 * still occupies a number. Counting only by name would let it
 * reappear as "SFD 1" alongside a diagram that was already SFD 1.
 */
function nextAnalysisDiagramName(
    type
) {
    const prefix =
        ANALYSIS_DIAGRAM_NAMES[type] ||
        type;

    /*
     * Counted by the diagram's OWN kind.
     *
     * Counting the shared feature type instead would number all
     * three diagrams from one running total, so the first BMD on
     * a sheet would arrive as "BMD 2" simply because an SFD
     * existed - which reads as though a diagram had been lost.
     * Each kind counts itself.
     *
     * Both the stored diagramType and the stored name are checked,
     * because a diagram created before the name existed is still a
     * diagram and still occupies a number. Counting only by name
     * would let it reappear as "SFD 1" alongside a diagram that
     * was already SFD 1.
     */
    const used = drawingState.objects.filter(
        object => {
            if (
                object.type !==
                "analysis-diagram"
            ) {
                return false;
            }

            return (
                object.geometry
                    ?.diagramType === prefix ||
                (
                    typeof object.name ===
                        "string" &&
                    object.name.startsWith(
                        `${prefix} `
                    )
                )
            );
        }
    ).length;

    return `${prefix} ${used + 1}`;
}

export function beginAnalysisDiagram(
    diagramType
) {
    /*
     * THE SOURCE, AND THE AXIS IT IMPLIES.
     *
     * The diagram is a view of a body, so the body decides what
     * the axis is: its length, its direction, and where it starts.
     * The student is asked for one thing only - how far above or
     * below their drawing the diagram should sit - because that is
     * the one thing the source cannot know and the one thing that
     * is purely presentational.
     *
     * It used to be placed by click-drag across a span, which meant
     * the student was asked to REDEFINE the span the diagram
     * measures. Doing so by hand let the two disagree - drag a
     * diagram narrower than its beam and the stations on it no
     * longer line up with the loads, with nothing to say so. The
     * span is now read from the body and never re-entered.
     *
     * With no body selected there is no span to read, so the tool
     * says what it needs rather than placing an axis that would
     * be a guess. A free-standing axis is still possible - by
     * drawing a Line - but it will not pretend to belong to a
     * member it was never given.
     */
    /*
     * ========================================================
     * ALWAYS WAIT FOR THE CLICK THAT NAMES THE MEMBER
     * ========================================================
     *
     * The tool used to adopt a body that happened to be selected when it was
     * armed. A beam is very often still selected straight after being drawn, so
     * the source was set before the student had said anything - and the FIRST
     * click then committed the diagram instead of naming its body. Two steps
     * silently became one, and the status line went on to say "Place analysis
     * axis" over a diagram that already existed.
     *
     * So the source is deliberately NOT resolved here. Arming always asks the
     * same question - which member? - and the answer is the click that lands on
     * it. That is one rule for every route into the tool, it is the same
     * two-stage shape a support or a load uses, and it removes the case where a
     * leftover selection decided what the student got.
     */
    const source =
        null;

    /*
     * The mode was chosen just before this was called, and is
     * carried through rather than re-derived: it is the student's
     * answer to a question this function did not ask, and
     * overwriting the interaction with a fresh object would
     * silently discard it.
     */
    const mode =
        drawingState.interaction
            ?.analysisMode || "sketch";

    const span =
        source
            ? enggAnalysisDependencies.spanOf(
                  source
              )
            : null;

    /*
     * THE BODY IS CHOSEN ON THE FIRST CLICK, NOT BEFORE THE BUTTON.
     *
     * A body that happens to be selected when the tool is chosen is used,
     * because it is right and saves a click. But requiring one is not: it
     * made the two tools unreachable in practice, because a diagram tool
     * cannot select anything - it is not the Select tool - so the student
     * was told to select a beam, clicked the beam, and nothing happened.
     * The instruction was impossible to satisfy from inside the tool that
     * gave it.
     *
     * So the interaction is armed either way, and with no source yet it
     * simply waits for one. That is the same two-stage shape every other
     * body-attached Statics tool uses - select the tool, click the body,
     * place it - rather than a rule of its own.
     */
    enggDrawingState.setInteraction(
        drawingState,
        {
            phase: "analysis-axis",

            analysisKind: diagramType,
            analysisMode: mode,
            sourceId: source?.id ?? null,

            /*
             * The starting height is the suggested offset below the
             * source, so the first frame appears somewhere readable
             * rather than on top of the beam. With no source yet there is
             * nothing to measure from, and the cursor's own height is the
             * only sensible answer until the body is picked.
             */
            placementY: span
                ? span.start.y +
                    enggAnalysisDependencies
                        .DEFAULT_ANALYSIS_OFFSET
                : null,

            startPoint: null,
            currentPoint: null
        }
    );

    if (!source) {
        /*
         * WHY THE DIAGRAM CANNOT START, SAID SPECIFICALLY.
         *
         * `analysisDiagramIntroMessage` distinguishes an empty sheet from an
         * empty selection, so a student who has drawn nothing is told to draw a
         * Beam rather than to click one that is not there.
         */
        setToolMessage(
            analysisDiagramIntroMessage(null)
        );

        renderCurrentDrawing();

        return;
    }

    /*
     * A body that exists but has no span cannot carry a diagram, and
     * saying so is better than arming a placement whose axis can never be
     * built. The offset is measured from the span's start, so without one
     * there is nothing to measure from and the placement would sit at no
     * height at all - the click would be swallowed and the tool would stay
     * armed with nothing to show for it.
     */
    if (!span) {
        setToolMessage(
            "The selected feature is not a beam. Select the Beam, Truss, Cable or " +
                "Shaft this diagram belongs to"
        );

        return;
    }

    setToolMessage(
        "Move the pointer up or down to position the diagram, then click to place it"
    );

    renderCurrentDrawing();
}

/*
 * ========================================================
 * WHY A DIAGRAM CANNOT BE MADE, SAID SPECIFICALLY
 * ========================================================
 *
 * An SFD, a BMD and an AFD all measure a MEMBER. When there is no member to
 * measure, the tool has to say which of three different situations the student
 * is actually in, because the fix is different in each:
 *
 *   NO MEMBER ON THE SHEET AT ALL   they must draw one first
 *   A MEMBER EXISTS, NONE SELECTED  they must pick one
 *   THE SELECTION IS NOT A MEMBER   they picked the wrong thing
 *
 * One message covering all three - "Click the Beam, Truss or member the diagram
 * belongs to" - is what the tool said before, and it is unhelpful in two of the
 * three: a student with nothing drawn is told to click something that is not
 * there, and a student who clicked a force is told to click a Beam without
 * being told that the thing they clicked was the problem.
 *
 * THE CHECK IS A QUESTION ABOUT THE SHEET, asked once and answered by type, so
 * the wording and the condition cannot drift apart.
 */
const DIAGRAM_MEMBER_TYPES = [
    "beam",
    "truss",
    "shaft",
    "cable",
    "rigid-body"
];

/*
 * Whether a feature is a member a diagram can be measured against.
 *
 * The same list `analysisSourceBody` accepts, kept beside it so a member added
 * to one is added to the other - a diagram's idea of "a suitable beam" and the
 * message's idea of it must be the same idea.
 */
export function isDiagramMember(object) {
    return Boolean(
        object &&
            DIAGRAM_MEMBER_TYPES.includes(object.type)
    );
}

/*
 * The reason a diagram cannot start, phrased for the student - or null when it
 * can.
 *
 * `source` is what the tool resolved from the selection (possibly null).
 * `selectionWasEmpty` distinguishes "nothing picked" from "picked something
 * unsuitable", which are the two cases the middle message exists for.
 */
export function diagramPrerequisiteMessage(
    source,
    selectionWasEmpty
) {
    if (source) {
        /*
         * A source with no span is a different failure again, and it is
         * reported by the caller where the span is actually known.
         */
        return null;
    }

    const anyMember =
        drawingState.objects.some(isDiagramMember);

    if (!anyMember) {
        return (
            "No suitable beam found. Create a Beam (or a Truss, Cable or Shaft) " +
            "first, then start this diagram."
        );
    }

    if (selectionWasEmpty) {
        return (
            "Select the beam this diagram belongs to before creating it."
        );
    }

    return (
        "The selected feature is not a beam. Select the Beam, Truss, Cable or " +
        "Shaft this diagram belongs to."
    );
}

/*
 * The instruction a NEWLY ARMED diagram tool shows before any click.
 *
 * It is the prerequisite message when the student is starting from nothing, and
 * the placement hint once a source is known - so arming the tool with no beam
 * on the sheet says what to draw rather than what to click.
 */
export function analysisDiagramIntroMessage(source) {
    if (source) {
        return (
            "Move the pointer up or down to position the diagram, then click to place it"
        );
    }

    return (
        diagramPrerequisiteMessage(null, true) ||
        "Select the beam this diagram belongs to"
    );
}

/*
 * The axis the current placement would produce.
 *
 * Asked for on every frame, by the preview and again on the click.
 * Deriving it in one place is what guarantees the committed axis
 * is EXACTLY where the preview showed it - there is no second,
 * slightly different calculation for the click to use.
 */
export function analysisAxisForPlacement() {
    const interaction =
        drawingState.interaction;

    const source =
        drawingState.objects.find(
            object =>
                object.id ===
                interaction.sourceId
        );

    if (!source) {
        return null;
    }

    return enggAnalysisDependencies
        .axisFromSource(
            source,
            interaction.placementY
        );
}

/*
 * COMMIT THE PLACED AXIS.
 *
 * Creates the real feature from the axis the student was just
 * looking at. The source relationship is recorded here rather than
 * in a general refresh, because this is the one moment the
 * relationship is established - from then on the dependency
 * registry keeps it true by itself.
 */
export function commitAnalysisAxis() {
    const interaction =
        drawingState.interaction;

    const axis =
        analysisAxisForPlacement();

    if (!axis) {
        return false;
    }

    const previousObjects =
        enggDrawingState.snapshotDrawing(
            drawingState
        );

    const object =
        enggDrawingState.geometryFactories[
            interaction.analysisKind
        ](
            axis.start,
            axis.end,

            /*
             * THE DIAGRAM IS A STATICS FEATURE, and it says so here.
             *
             * This is the only place the object is built, so an omitted
             * field is permanent - and it was omitted. Without it
             * `engineering.discipline` was undefined, the Feature Tree
             * fell through to its Geometry default, and AFD/SFD/BMD were
             * filed among the plain geometry. That was a categorisation
             * bug in the data model, not a mislabelled heading: the tree,
             * the panel and any query about "which discipline is this"
             * were all reading the same missing fact.
             *
             * `analysisKind` is recorded too, so a consumer can tell an
             * axial diagram from a bending one without reaching into the
             * feature's name.
             */
            {
                style:
                    drawingState
                        .styleDefaults,

                engineering: {
                    plane: "XY",
                    discipline: "statics",

                    /*
                     * The diagram this object is, as one of the three.
                     * The factory key is already the drawing type, so
                     * this is the same fact stated where the statics
                     * readers look for it.
                     */
                    analysisKind:
                        interaction.analysisKind,

                    /*
                     * THE SOURCE IS RECORDED HERE AS WELL AS BY
                     * registerDependency below.
                     *
                     * The diagram's whole coordinate system is the
                     * body's, and `parentId` - the field the Feature Tree
                     * nests children by - is not set until further down
                     * for the whole group of statics features to share
                     * one answer. Recording the source on the feature
                     * means "what body is this a diagram of" has a
                     * single authoritative answer rather than being
                     * reconstructed from proximity.
                     */
                    sourceFeatureIds: [
                        interaction.sourceId
                    ].filter(Boolean)
                },

                name:
                    nextAnalysisDiagramName(
                        interaction.analysisKind
                    )
            }
        );

    /*
     * The student's chosen height, stored as an offset along the
     * span's normal rather than as a world coordinate.
     *
     * A world y would move the diagram whenever the beam's own
     * height changed - resizing a beam would silently drag a
     * diagram the student had deliberately parked well clear up
     * against it. Measured from the source, the diagram keeps its
     * DISTANCE from the member and its length still follows the
     * span.
     */
    object.geometry.sourceOffset = {
        distance:
            enggAnalysisDependencies
                .verticalOffsetOf(
                    axis,
                    drawingState.objects.find(
                        object =>
                            object.id ===
                            interaction.sourceId
                    )
                )
    };

    /*
     * The confirmed axis is the base a free diagram would be
     * measured from, recorded so a later refresh is idempotent.
     */
    object.geometry.baseAxis = {
        start: { ...axis.start },
        end: { ...axis.end }
    };

    /*
     * THE MODE IS RECORDED ON THE FEATURE, not left on the
     * interaction, which has just been cleared.
     *
     * A Sketch frame and a Plot frame look the same when they are
     * both empty, so without this a saved drawing reopened later
     * would have lost the only record of which one it was - and the
     * student would find a diagram they could not type into, or
     * equations belonging to a frame they drew by hand.
     */
    const mode = interaction.analysisMode === "plot"
        ? "plot"
        : "sketch";

    object.geometry.mode = mode;

    /*
     * A PLOT STARTS WITH ONE EXPRESSION ALREADY SPANNING THE BODY.
     *
     * Seeded rather than empty because the range is not the student's to
     * work out: it is the body's own, and asking for it invites the one
     * error that matters here - a plot that does not line up with the
     * member above it. What the student still has to supply is the
     * equation, which is the part that is genuinely theirs.
     *
     * It is seeded as an EXPRESSION, through the same factory the Plot
     * Editor adds one with, so a fresh diagram and a diagram the student
     * has just edited are the same kind of thing. A stable id comes with
     * it, so "expression 1" is a thing the editor, the delete button and
     * a saved file can all name.
     */
    if (mode === "plot") {
        const source =
            drawingState.objects.find(
                entry =>
                    entry.id ===
                    interaction.sourceId
            );

        const span =
            source
                ? enggAnalysisDependencies.spanOf(
                      source
                  )
                : null;

        if (span) {
            /*
             * The range is the body's own, measured ALONG it from the
             * start, so a sloping member gets the same 0 to L as a level
             * one and a station at 2 m sits under the station at 2 m.
             */
            const length = span.length;

            object.geometry.localRange = {
                from: 0,
                to: length
            };

            object.geometry.expressions = [
                enggDiagramEquations.createExpression(
                    "functionX",
                    {
                        defaultRange: {
                            start: 0,
                            end: length
                        }
                    }
                )
            ];
        }
    }

    enggAnalysisDependencies
        .registerDependency(
            object,
            [interaction.sourceId]
        );

    enggDrawingState.addObject(
        drawingState,
        object
    );

    /*
     * The stations are mapped now, on commit, rather than when the
     * tool was chosen: the axis has to exist before there is
     * anything to map them onto. The refresh below does it from
     * the source, so the two can never disagree.
     */
    enggDrawingState.refreshAnalysisObjects(
        drawingState
    );

    enggDrawingState.clearInteraction(
        drawingState
    );

    /*
     * ========================================================
     * THE PLACEMENT IS FINISHED, SO THE TOOL STANDS DOWN
     * ========================================================
     *
     * Clearing the interaction removes the half-built placement, but the TOOL
     * was still armed - so the very next pointer move re-entered the
     * `analysis-axis` phase and rewrote the status line to "Place analysis
     * axis" over a diagram that had already been committed. The student saw a
     * finished diagram and an instruction to keep placing it.
     *
     * So the tool returns to Select, exactly as a completed Line or Beam does.
     * The feature is already in the document and selected, so the Features
     * panel shows it - and a second diagram is one click on the toolbar away
     * rather than something the cursor is still half-committed to placing.
     */
    enggDrawingState.setActiveTool(
        drawingState,
        "select"
    );

    /*
     * The placed feature becomes the selection, so its own Features panel is
     * open and the Plot Editor (below) is editing the thing just created.
     */
    enggDrawingState.selectObject(
        drawingState,
        object.id
    );

    enggDrawingState.commitDrawingChange(
        drawingState,
        previousObjects
    );

    renderProperties();
    renderCurrentDrawing();

    /*
     * THE PLACEMENT IS OVER, SO THE STATUS STOPS ASKING FOR ONE.
     *
     * While the axis was being positioned the bottom bar read "Place analysis
     * axis" - which is right up to the moment it is placed. Leaving that text
     * behind after the commit told the student to keep positioning a diagram
     * that was already finished, while the tool had stood down at the same time.
     * The message now says what actually happened.
     */
    setToolMessage(
        mode === "plot"
            ? "Diagram placed - enter its equation"
            : "Diagram placed"
    );

    /*
     * ========================================================
     * AND THE EDITOR OPENS NOW, NOT AFTER ANOTHER CLICK
     * ========================================================
     *
         * Placing the axes is the last step of CREATION, not the first step
         * of a separate editing session. At this point everything the editor
         * needs is already known - the source body, the position, the bounds,
         * the diagram type, the x domain - so making the student find the
         * feature in the tree and press "Open" is a step that exists only
         * because the two halves were written separately.
         *
         * IT RUNS AFTER THE COMMIT, so the feature is already in the document
         * and the snapshot the editor takes on Apply is against a state that
         * includes it. Opening it before would mean Apply could not also undo
         * the creation.
         *
         * A Sketch has no dialog to open yet - it is drawn with the ordinary
         * tools on the sheet - so it falls through to the message that says so,
         * rather than opening something empty.
         */
        if (
            openAnalysisEditorFor(
                object
            )
        ) {
            return true;
        }

        setToolMessage(
            "Reference axis placed - draw your diagram against it with the Line and Arc tools"
        );
        return true;
    }

/*
 * The metadata every ANALYSIS object is stamped with.
 *
 * Analysis objects are statics features, not geometry, and the
 * Features panel groups by discipline - so without this they
 * were filed under GEOMETRY, next to the lines and rectangles
 * they were derived from. A student looking for their Resultant
 * would have found it in the wrong list entirely, and the panel
 * could not show the Analysis group the specification asks for.
 *
 * `sourceFeatureId` is the important part. A resultant and a
 * force-components pair are READINGS OF a force, not independent
 * marks on the sheet: they depend on the force they came from,
 * they should sit under it in the Feature Tree, and deleting the
 * force should not leave an orphan claiming to describe it. So
 * the relationship is recorded on the object rather than
 * inferred from proximity.
 */
function analysisObjectOptions(
    sources,
    extra
) {
    return {
        ...(extra || {}),
        style: {
            ...drawingState.styleDefaults,
            ...(extra?.style || {})
        },
        engineering: {
            plane: "XY",
            discipline: "statics",
            analysisKind:
                extra?.analysisKind,
            sourceFeatureIds: sources
        }
    };
}

export function runStaticsAnalysis(
    toolId
) {
    /*
     * ========================================================
     * THE ANALYSIS TOOLS ARM THEMSELVES
     * ========================================================
     *
     * Resultant and Force Components are CHILD analysis features: they
     * read explicit Force feature(s) and derive everything from those. So
     * the tool enters the shared INPUT-SELECTION state - "Select force" /
     * "Select force(s)" - in which the student clicks the forces they
     * mean and commits with Enter.
     *
     * The three diagram tools are placed against a body, and their arming
     * path is `beginAnalysisDiagram` (reached through openAnalysisModeMenu,
     * which first asks Sketch or Plot). They are handled here too so a
     * programmatic call to runStaticsAnalysis always does something
     * truthful rather than reporting a placeholder.
     */
    if (isAnalysisInputTool(toolId)) {
        beginAnalysisInput(toolId);

        return;
    }

    if (
        Object.prototype.hasOwnProperty.call(
            ANALYSIS_DIAGRAM_TOOLS,
            toolId
        )
    ) {
        enggDrawingState.setActiveTool(
            drawingState,
            toolId
        );

        beginAnalysisDiagram(toolId);

        return;
    }

    setToolMessage(
        "Unknown analysis tool"
    );
}

/*
 * BUILD THE RESULTANT OF AN EXPLICIT SET OF FORCES.
 *
 * The forces arrive already chosen - by the input-selection workflow, not by
 * reading whatever happened to be selected. This function only does the
 * engineering and the bookkeeping; the decision of WHICH forces is made before
 * it is called, which is what keeps the two concerns apart.
 */
function createResultant(
    forces
) {
    {
        if (!forces.length) {
            setToolMessage(
                "Resultant needs at least one force"
            );

            return;
        }

        const sum =
            forces.reduce(
                (
                    total,
                    force
                ) => {
                    const part =
                        componentOf(force);

                    return {
                        x: total.x + part.x,
                        y: total.y + part.y
                    };
                },
                { x: 0, y: 0 }
            );

        /*
         * The resultant is PLACED, not just reported.

         * It was previously only written to the status line, which meant the

         * numbers describing it vanished the moment the student moved on.

         * Since these are a real feature, they can be labelled with the

         * existing resultant-value annotation, selected, dimensioned, undone

         * and saved like anything else on the sheet.

         * The arrow is drawn from the common point of the forces it sums, in

         * the summed direction, at a readable length. The VALUE is the sum

         * of the forces the student placed - this does not compute reactions

         * or equilibrium, which is the student's own work (spec 59).
         */
        const anchor = forces[0].geometry.start || forces[0].geometry.position || { x: 0, y: 0 };

        const previousObjects =
            enggDrawingState.snapshotDrawing(
                drawingState
            );

        const resultant =
            enggDrawingState.geometryFactories.resultant(
                { x: anchor.x, y: anchor.y },
                {
                    x: anchor.x + sum.x,
                    y: anchor.y + sum.y
                },
                analysisObjectOptions(
                    forces.map(
                        (force) => force.id
                    ),
                    {
                        analysisKind: "resultant",
                        name: "Resultant"
                    }
                )
            );

        /*
         * THE RESULTANT IS PARENTED BY WHOSE FORCE IT IS.
         *
         * It was created with its source ids and no `parentId`, so the
         * Feature Tree had nothing to nest it under and it sat at the top
         * of the sheet - which is why a resultant never appeared beside the
         * forces it was made from.
         *
         * `parentId` is the field the tree actually reads; the dependency
         * list below is what makes it re-derive. Both are needed and they
         * answer different questions: the parent says where the feature
         * LIVES, the sources say what it READS. A resultant of several
         * forces has no single parent body, so it is parented to the first
         * of them - the one whose application point it is drawn from, and
         * therefore the one whose motion it follows.
         */
        if (
            forces[0]?.parentId
        ) {
            resultant.parentId =
                forces[0].parentId;
        }

        enggDrawingState.addObject(
            drawingState,
            resultant
        );

        /*
         * The relationship to the forces it sums, recorded through the
         * registry rather than by hand.
         *
         * Storing the ids is what makes the resultant a READING of
         * those forces rather than a copy of what they were: the
         * registry re-derives the sum from their current values, so
         * moving, retuning or re-aiming any of them updates the
         * resultant with no further code. A resultant that stored only
         * the arrow it drew would keep pointing the way it did when
         * the forces were first placed.
         */
        enggAnalysisDependencies.registerDependency(
            resultant,
            forces.map(
                force => force.id
            )
        );

        enggDrawingState.commitDrawingChange(
            drawingState,
            previousObjects
        );

        renderCurrentDrawing();

        setToolMessage(
            `Resultant of ${forces.length} force${forces.length === 1 ? "" : "s"} placed - add an annotation to label it`

        );
    }
}

/*
 * BUILD THE FORCE COMPONENTS OF ONE FORCE.
 *
 * `force` is the force the student explicitly chose as the input, or undefined
 * if they committed without choosing one - which is refused rather than
 * guessed, so the components are never attached to a force the student did not
 * name.
 */
function createForceComponents(
    force
) {
    {
        if (!force) {
            setToolMessage(
                "Select a force to resolve"
            );

            return;
        }

        const part =
            componentOf(force);

        /*
         * The resolved components are PLACED, not just reported.

         * As with the resultant, printing Fx and Fy into the status line

         * meant the analysis existed only while the student was looking at

         * it. As a feature it can carry the force-components annotation, be

         * selected, dimensioned and saved.

         * The arrow runs from the force's own point in the direction of the

         * force, so it sits on the thing it describes.

         */
        const origin =
            force.geometry.start ||
            force.geometry.position || {
                x: 0,
                y: 0
            };

        const previousObjects =
            enggDrawingState.snapshotDrawing(
                drawingState
            );

        const resolved =
            enggDrawingState.geometryFactories[
                "force-components"
            ](
                { x: origin.x, y: origin.y },
                {
                    x: origin.x + part.x,
                    y: origin.y + part.y
                },
                analysisObjectOptions(
                    [force.id],
                    {
                        analysisKind: "force-components",
                        name: "Force Components"
                    }
                )
            );

        /*
         * THE COMPONENTS ARE PARENTED TO THEIR FORCE.
         *
         * The same omission as the resultant: the source ids were recorded
         * but `parentId` was not, so the Feature Tree had nothing to nest
         * it under and it appeared as a loose row at the top of the sheet
         * instead of beside the force it describes.
         *
         * The Force Components tool is invoked on a selection of forces,
         * and `forces[0]` is the one being decomposed - so its parent is
         * unambiguous, and that is what goes on the object.
         */
        if (force.parentId) {
            resolved.parentId =
                force.parentId;
        }

        enggDrawingState.addObject(
            drawingState,
            resolved
        );

        /*
         * The ONE force this is the decomposition OF.
         *
         * Recorded through the registry so the object follows that
         * force for the rest of its life: moving the force carries the
         * components with it, and changing its magnitude or direction
         * re-resolves them. The values drawn at creation are only the
         * first reading.
         */
        enggAnalysisDependencies.registerDependency(
            resolved,
            [force.id]
        );

        enggDrawingState.commitDrawingChange(
            drawingState,
            previousObjects
        );

        renderCurrentDrawing();

        setToolMessage(
            `${force.name} resolved into X and Y - add an annotation to label it`
        );
    }
}

/*
 * ========================================================
 * RESULTANT AND FORCE COMPONENTS: THE INPUT-SELECTION STATE
 * ========================================================
 *
 * These two are CHILD analysis features. A Resultant reads one or more Force
 * features and a Force Components pair reads exactly one, and everything either
 * of them shows is DERIVED from those forces. So the one thing the student must
 * be able to say, unambiguously, is WHICH force(s) the child reads.
 *
 * That question used to be answered for them - the tools read whatever was in
 * the selection at the instant the button was pressed. A force the student had
 * just drawn was still selected, so pressing Resultant produced a Resultant of
 * it without the student ever naming it, and a stray click during creation
 * could take an existing Resultant's parent as the input by proximity.
 *
 * The workflow here makes the input EXPLICIT:
 *
 *     activate the tool        -> "Select force" / "Select force(s)"
 *     click a Force            -> it is added as an input (never inferred)
 *     click a Resultant        -> nothing: not a Force, so not an input
 *     click empty space        -> nothing
 *     Enter                    -> the child is created from the inputs
 *
 * NOTHING IS GUESSED. A click on a child never stands in for its parent, the
 * nearest force is never chosen, and the previously selected force is never
 * reused. The Selected force(s) are shown by the ordinary selection highlight,
 * which is already the application's way of saying "this one is picked".
 */
export const ANALYSIS_INPUT_TOOLS = [
    "resultant",
    "force-components"
];

export function isAnalysisInputTool(toolId) {
    return ANALYSIS_INPUT_TOOLS.includes(toolId);
}

/*
 * The prompt the tool shows while it waits for its input.
 */
export function analysisInputMessage(toolId) {
    return toolId === "force-components"
        ? "Select force"
        : "Select force(s)";
}

/*
 * ARM THE TOOL AND ENTER THE INPUT-SELECTION STATE.
 *
 * The interaction phase is what routes the next click to this tool rather than
 * to universal selection, so the student is genuinely choosing the input rather
 * than selecting objects the application then reads.
 *
 * The SELECTION IS CLEARED on entry. That is deliberate and is the whole of
 * "do not use the last selected force": whatever was selected when the button
 * was pressed is not an input, and the student starts from a blank slate they
 * build themselves.
 */
export function beginAnalysisInput(toolId) {
    enggDrawingState.setActiveTool(drawingState, toolId);

    enggDrawingState.clearInteraction(drawingState);

    drawingState.interaction.phase = "analysis-input";
    drawingState.interaction.analysisKind = toolId;

    drawingState.selection.selectedObjectIds = [];
    drawingState.selection.boxSelectionIds = [];

    setToolMessage(analysisInputMessage(toolId));

    renderProperties();
    renderCurrentDrawing();
}

/*
 * A CLICK WHILE THE TOOL IS WAITING FOR ITS INPUT.
 *
 * ONLY A FORCE IS AN INPUT. Anything else - a Resultant, a Force Components
 * pair, a beam, a support, empty space - is not, so the click does nothing and
 * the tool keeps waiting. That is what stops a click on a child feature being
 * read as a click on its parent, and what stops unrelated geometry silently
 * being added.
 *
 * A force is TOGGLED: clicking one adds it, clicking it again removes it, and
 * clicking it a third time adds it once - never twice. So a Resultant of three
 * forces is built by three clicks and no duplicates can arise.
 *
 * For Force Components exactly ONE force is wanted, so a click REPLACES the
 * input rather than accumulating: the last force the student named is the one
 * being resolved, which is unambiguous.
 */
export function handleAnalysisInputClick(
    resolution,
    event
) {
    const toolId =
        drawingState.interaction.analysisKind ||
        drawingState.activeTool;

    const point =
        resolution?.rawPointerPoint ||
        resolution?.effectiveConstructionPoint ||
        null;

    const object = point
        ? drawingState.objects.find(
              candidate =>
                  candidate.type === "force" &&
                  objectAtPointForInput(candidate, point)
          )
        : null;

    if (!object) {
        /*
         * NOT A FORCE, SO NOT AN INPUT. The tool stays in its waiting state
         * and says so, rather than creating anything or selecting something
         * else.
         */
        setToolMessage(analysisInputMessage(toolId));

        return;
    }

    const selected =
        drawingState.selection.selectedObjectIds || [];

    if (toolId === "force-components") {
        /*
         * ONE FORCE, REPLACED RATHER THAN ACCUMULATED.
         */
        enggDrawingState.selectObject(drawingState, object.id);
    } else if (selected.includes(object.id)) {
        /*
         * CLICKING AN ALREADY-CHOSEN FORCE REMOVES IT. No duplicate can be
         * created, because the id is either present or it is not.
         */
        enggDrawingState.selectObjects(
            drawingState,
            selected.filter(id => id !== object.id)
        );
    } else {
        enggDrawingState.selectObjects(drawingState, [
            ...selected,
            object.id
        ]);
    }

    setToolMessage(analysisInputMessage(toolId));

    renderProperties();
    renderCurrentDrawing();
}

/*
 * COMMIT THE CHILD FROM THE EXPLICITLY CHOSEN INPUTS.
 *
 * The inputs are read from the SELECTION, which is what the student built by
 * clicking. A commit with nothing chosen creates nothing and says so, which is
 * the honest outcome for "I have not told you which force yet".
 */
export function commitAnalysisInput() {
    const toolId =
        drawingState.interaction.analysisKind ||
        drawingState.activeTool;

    const chosen =
        drawingState.objects.filter(
            object =>
                object.type === "force" &&
                drawingState.selection.selectedObjectIds.includes(
                    object.id
                )
        );

    if (!chosen.length) {
        setToolMessage(analysisInputMessage(toolId));

        return false;
    }

    if (toolId === "force-components") {
        createForceComponents(chosen[0]);
    } else {
        createResultant(chosen);
    }

    /*
     * THE OPERATION IS FINISHED, so the interaction is cleared but the TOOL
     * stays armed - the same "place another one" shape every placement tool
     * has. Escape is how the student leaves it.
     */
    enggDrawingState.clearInteraction(drawingState);
    drawingState.interaction.phase = "analysis-input";
    drawingState.interaction.analysisKind = toolId;

    drawingState.selection.selectedObjectIds = [];

    setToolMessage(analysisInputMessage(toolId));

    renderProperties();
    renderCurrentDrawing();

    return true;
}

/*
 * Is a point on a specific force?
 *
 * A thin local hit test, kept here so the input-selection state does not depend
 * on the general hit test's ordering - a click here is asking one question
 * only ("is this a FORCE?"), and the answer must not be influenced by what
 * else happens to be under the cursor.
 */
function objectAtPointForInput(
    force,
    point
) {
    const geometry = force.geometry || {};

    const start =
        geometry.start ||
        geometry.position;

    if (!start) {
        return false;
    }

    /*
     * The force is aimed at along its drawn arrow, using the same shared
     * resolver the renderer and the ordinary hit test use, so the click lands
     * on the arrow the student can actually see.
     */
    const tolerance =
        12 /
        Math.max(
            1,
            enggDrawingState.BASE_PIXELS_PER_UNIT *
                (drawingState.camera?.zoom || 1)
        );

    const end =
        enggLoadProfile.drawnForceEnd(
            drawingState,
            geometry
        );

    if (!end) {
        return false;
    }

    return distanceToSegment(point, start, end) <= tolerance;
}

