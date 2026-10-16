/*
 * The Features panel's tree of components, and the analysis editors it opens.
 */

import enggDrawingState from "../../../shared/model/drawing-state.js";
import enggDiagramEquations from "../../../features/workspace/model/analysis/diagram-equations.js";
import enggDrawingRenderer from "../../../shared/rendering/renderer.js";
import enggPlotEditor from "../../../shared/ui/editors/plot-editor.js";
import enggSketchEditor from "../../../shared/ui/editors/sketch-editor.js";
import { featureIcons, toolIcons } from "../toolbar/tools.js";
import { renderCurrentDrawing } from "../workspace/canvas-render.js";
import { COORDINATE_SYSTEM_TYPE } from "../../../features/workspace/constants.js";
import { drawingProperties } from "../../../features/workspace/dom.js";
import { drawingState, editorState } from "../../../features/workspace/editor-state.js";
import { renderProperties } from "./feature-panel.js";
import enggPropertyPanel from "./property-panel.js";
import { finaliseRows, section } from "./feature-panel-markup.js";

function objectIcon(
    object
) {
    /*
     * featureIcons is the authoritative map from feature type
     * to icon, so the Feature Tree and the Features panel show
     * exactly the same artwork the toolbar uses for the tool
     * that created the feature.
     */
    const featureIcon =
        featureIcons[object.type];

    if (featureIcon) {
        return featureIcon;
    }

    return (
        toolIcons[
            object.type[0].toUpperCase() +
            object.type.slice(1)
        ] ||
        toolIcons.Line ||
        ""
    );
}

/*
 * ========================================================
 * WHAT KIND OF FEATURE IS THIS?
 * ========================================================
 *
 * The ONE answer to "which group does this feature belong in", used by
 * the Feature Tree and by the Features panel so the two cannot disagree.
 *
 * IT IS ASKED OF THE FEATURE, NOT INFERRED FROM ITS TYPE ALONE.
 *
 * Geometry and Statics SHARE implementations - one Line class, one Arc
 * function, one renderer - and what makes a Line a "Reference Line" is the
 * statics discipline recorded on the object, not anything about its
 * geometry. A function that classified by type would have to know every
 * statics type by name, and a new statics feature would be filed as plain
 * geometry the day it was added, which is exactly how the AFD/SFD/BMD
 * diagrams ended up among the geometry in the first place: their factory
 * was the one statics factory that never recorded the discipline, so every
 * reader of that field answered "geometry" and the tree obeyed.
 *
 * ========================================================
 * ONE STATICS GROUP. THERE IS NO "ANALYSIS" GROUP.
 * ========================================================
 *
 * An earlier version of this gave diagrams, resultants and components a
 * group of their own, on the reasoning that they are READINGS taken off
 * something else rather than marks on the sheet. The distinction is real.
 * It is also the wrong place to express it.
 *
 * The tree's job is to say what each feature depends on, and every one of
 * these depends on a BODY: a diagram is read off a member, a resultant off
 * the forces it sums, a components pair off the force it decomposes. So
 * they already appear NESTED UNDER that body. A second grouping on top of
 * that answered a question nobody asked while making the real one harder
 * to answer - a student looking for their SFD found a list of bodies and
 * had to know which one it was filed under before they could look inside.
 *
 * It is also a category a student cannot act on. You cannot drag a diagram
 * into "Analysis", and it is not a thing anybody placed. A group that
 * exists only to re-sort is a second classification competing with the
 * parent relationship, and the two disagree the moment a diagram's source
 * body changes - at which point the diagram belongs under a different body
 * but is still filed in the group it was first put in.
 *
 * So: one Statics group, and the parent relationship does the rest. A
 * diagram whose body is not on the sheet is still a Statics row - it has a
 * body, the sheet simply does not have it.
 */
function staticsCategory(
    object
) {
    return (
        object?.engineering?.discipline ===
            "statics"
            ? "Statics"
            : null
    );
}

/*
 * ============================================================
 * WHERE A FEATURE IS FILED IN THE TREE
 * ============================================================
 *
 * ONE answer, asked by both the root-row test and the child lookup, so a
 * feature cannot appear as a root row in one pass and as somebody's child
 * in another.
 *
 * `parentId` ALONE WAS NOT ENOUGH, AND THAT IS THE FAULT THIS FIXES.
 *
 * Force Components reads a force - that relationship is recorded in
 * `engineering.sourceFeatureIds` - and it was being filed under the force's
 * BODY, because its `parentId` was copied from the force's. So it appeared as
 * a loose sibling of the force rather than beneath it, and a student looking
 * for the decomposition of a force had to scan the whole branch to find it.
 * The same was true of a Resultant.
 *
 * It could not simply be given the force as its `parentId`, because
 * `parentId` means something specific everywhere else: it names the BODY a
 * feature is drawn on. The renderer looks it up to find the member a preview
 * belongs to, the Features panel prints it as "Relative to", and the parent
 * body's attached-feature counts filter on it. Overloading it with a force
 * would have moved the decomposition under the right row in the tree and
 * quietly broken the attachment it was still supposed to have - one correct
 * surface and three broken ones.
 *
 * SO A TREE PARENT IS A SEPARATE QUESTION FROM AN ATTACHMENT, and this is
 * the answer to it. A feature is filed under its own body when it has one,
 * and under the feature it READS when it does not. That matches what the
 * student is actually looking at: a force's components belong with the force,
 * a diagram belongs with its member, and neither relationship is invented
 * here - both are already recorded on the objects.
 *
 * The Resultant takes its FIRST source for the same reason the derivation
 * anchors it there: the sum is drawn from one force's application point, and
 * that is the one whose motion it follows.
 */
function treeParentIdOf(
    object
) {
    if (!object) {
        return null;
    }

    if (object.parentId) {
        return object.parentId;
    }

    /*
     * Only for features that are a READING of something else. A body, a
     * line or a point has no sources and returns null here, which is the
     * same answer it gave before this existed.
     */
    const engineering =
        object.engineering || {};

    const sources =
        Array.isArray(engineering.sourceFeatureIds)
            ? engineering.sourceFeatureIds
            : engineering.sourceFeatureId ||
                engineering.sourceId
                ? [
                      engineering.sourceFeatureId ||
                          engineering.sourceId
                  ]
                : [];

    return sources.length ? sources[0] : null;
}

function componentGroups() {
    const groups =
        new Map();

    drawingState.objects.forEach(
        object => {
            /*
             * A child is drawn under its parent, so it must
             * not also be listed as a root row. A parent that
             * no longer exists leaves the feature as a root,
             * which is what keeps an old saved file readable.
             */
            const parentId =
                treeParentIdOf(object);

            const parent = parentId
                ? drawingState.objects.find(
                      candidate =>
                          candidate.id === parentId
                  )
                : null;

            if (parent) {
                return;
            }

            /*
             * Features are grouped by the discipline that
             * created them. A statics feature keeps its
             * STATICS identity even when it reuses shared
             * geometry, so a Force never appears as a Line.
             *
             * THE TREE GROUPS A STATICS FEATURE BY WHAT IT IS.
             *
             * Statics is one discipline holding several kinds of thing -
             * the bodies, the things applied to them, and the diagrams
             * read off them - and putting them all under a single
             * "Statics" heading hides the distinction the student is
             * actually looking for. A Diagram is a READING of a body,
             * not a mark on the sheet like a Support or a Point Force,
             * and the group is where that is visible.
             *
             * THE ANSWER IS ONE FUNCTION, USED BY THE TREE AND THE
             * PANEL.
             *
             * Both surfaces classify from `staticsCategory` below, so
             * "the tree says Analysis" and "the panel says Geometry"
             * cannot happen: there is only one answer to ask for.
             */
            let group = staticsCategory(
                object
            ) || "Geometry";

            /*
             * ANNOTATE FEATURES FILE UNDER THEIR OWN HEADING.
             *
             * A note, a leader, a dimension and a table are marks ON a
             * drawing rather than geometry OF it, so "Geometry" would be a
             * lie about what they are. They group under "Annotate", which
             * is also the tool category that made them, so the tree and the
             * toolset read the same way.
             *
             * The legacy `annotation` type groups there too: a value label
             * beside a force is an annotation in exactly this sense, and two
             * headings for one idea would be a reading the student has to
             * reconcile.
             */
            if (
                group === "Geometry" &&
                (object.type === "annotate" ||
                    object.type === "annotation" ||
                    object.type === "dimension" ||
                    object.type === "variable-dimension")
            ) {
                group = "Annotate";
            }

            if (
                group === "Geometry" &&
                object.type === "construction"
            ) {
                group = "Construction";
            } else if (
                group === "Geometry" &&
                object.type ===
                    COORDINATE_SYSTEM_TYPE
            ) {
                group =
                    "Reference";
            }

            if (
                !groups.has(
                    group
                )
            ) {
                groups.set(
                    group,
                    []
                );
            }

            groups
                .get(group)
                .push(object);
        }
    );

    return groups;
}

/*
 * The features that belong to some other feature.
 *
 * A child is drawn beneath its parent rather than as a row
 * of its own, so a Point Force snapped onto a Beam reads as
 * Beam 1 > Point Force 1 and never appears twice.
 */
/*
 * Which Feature Tree branches the student has folded away.
 *
 * This is presentation only. It records nothing about the
 * features themselves, so a collapsed body still carries its
 * children and they still move and rotate with it.
 */
const collapsedComponents = new Set();

function componentChildren(
    parent
) {
    return drawingState.objects.filter(
        object =>
            treeParentIdOf(object) ===
                parent.id
    );
}

/*
 * One Feature Tree row, with its children indented
 * beneath it.
 *
 * The icon is resolved from the feature's own type, so the
 * tree always shows the real engineering identity of the
 * feature rather than whichever tool happens to be active.
 */
function componentRowMarkup(
    object,
    depth
) {
    const selected =
        drawingState.selection
            .selectedObjectIds
            .includes(
                object.id
            ) ||

        drawingState.selection
            .boxSelectionIds
            ?.includes(
                object.id
            );

    const children =
        componentChildren(object);

    /*
     * A feature that has children can be folded away. The
     * disclosure is a separate control from the row so
     * clicking the name still selects the feature rather than
     * toggling it.
     *
     * Collapsing is presentation only: the children stay
     * attached to this body whatever the row is showing, so a
     * folded Beam still carries its loads and its rotation
     * still transforms them.
     */
    const expanded =
        !collapsedComponents.has(object.id);

    const hasChildren =
        children.length > 0;

    return `
        <div
            class="drawing-component-branch"
            data-branch-id="${object.id}"
        >
            <div class="drawing-component-node">
                ${hasChildren
                    ? `<button
                        class="drawing-component-twisty${expanded ? " expanded" : ""}"
                        type="button"
                        data-twisty="${object.id}"
                        aria-expanded="${expanded}"
                        aria-label="${expanded ? "Collapse" : "Expand"} ${object.name}"
                    >${expanded ? "▾" : "▸"}</button>`
                    : '<span class="drawing-component-twisty-spacer" aria-hidden="true"></span>'}

                <button
                    class="drawing-component-row${selected ? " selected" : ""}${depth > 0 ? " drawing-component-row-child" : ""}"
                    type="button"
                    data-object-id="${object.id}"
                    aria-pressed="${selected}"
                    aria-expanded="${hasChildren ? expanded : undefined}"
                >
                    ${objectIcon(object)}
                    <span>${object.name}</span>
                </button>
            </div>

            ${hasChildren && expanded
                ? children
                      .map(
                          child =>
                              componentRowMarkup(
                                  child,
                                  depth + 1
                              )
                      )
                      .join("")
                : ""}
        </div>
    `;
}

/*
 * ========================================================
 * THE PANEL FOR A LOAD BEING BUILT
 * ========================================================
 *
 * What has been established so far, and the one thing still being asked for.
 *
 * THERE ARE NO FIELDS HERE, and there deliberately are none. Every question a
 * Distributed Load asks is a place on the sheet or a distance from one - which
 * body, which two ends of the loaded region, how hard and which way - and every
 * one of those is answered by pointing at the canvas. A numeric box for the
 * magnitude would be a second way to answer a question whose real answer is a
 * gesture, and an Angle box would let the student describe a direction no
 * arrow on the sheet is pointing.
 *
 * So the panel STATES what the tool has so far - the source body and the region
 * - and names the one action still outstanding. Nothing is written to the
 * document until the vector is given, so a student who presses Escape before
 * then has not created a load.
 */
export function renderLoadBuildPanel(
    interaction
) {
    const { number, readOnly } = enggPropertyPanel;

    const rows = [
        section("DISTRIBUTED LOAD"),
    ];

    const sourceId =
        interaction.loadSourceId;

    const source = sourceId
        ? drawingState.objects.find(
              candidate =>
                  candidate.id === sourceId
          )
        : null;

    rows.push(
        readOnly(
            "Source Body",
            source
                ? source.name ||
                  "Body"
                : "Free span"
        )
    );

    /*
     * THE REGION, ONCE IT EXISTS. Shown as the student selected it - not
     * as a default, and not at all before there is one - so the panel always
     * describes what the tool currently has.
     *
     * X and Y are TWO FIELDS. They used to be one field built by gluing the
     * two numbers together with a comma and appending "mm" to the pair:
     *
     *     Start
     *     150, 300 mm
     *
     * which made three separate mistakes at once. The unit read as though it
     * belonged to the second number and not the pair. The value could not be
     * read as a position, because "150, 300" is not how a position is
     * written - it is how two numbers are written when nobody decided which
     * one the field was about. And if one ordinate were ever absent, the
     * surviving one would have been printed next to a bare separator.
     *
     * Two engineering quantities, two rows.
     */
    [
        [
            "Start X",
            interaction.loadStart,
        ],
        [
            "End X",
            interaction.loadEnd,
        ],
    ].forEach(([caption, point]) => {
        if (!point) {
            return;
        }

        rows.push(
            readOnly(
                caption,
                number(point.x),
                "mm"
            )
        );
    });

    /*
     * ========================================================
     * THE PANEL SHOWS PROPERTIES, NOT INSTRUCTIONS
     * ========================================================
     *
     * What is shown here is what the tool HAS so far - the body it acts on
     * and the region traced - and nothing else. The one action still
     * outstanding is NOT written into this panel.
     *
     * The Features tab is a properties interface: it lists what a feature
     * is, and offers controls to change it. A sentence telling the student
     * what to do next is a different kind of thing, and it has exactly one
     * home - the bottom bar, which every tool already drives through
     * `setToolMessage` as the construction advances. Putting it here as well
     * meant two instruction areas that could disagree about the step, and one
     * of them sitting in a place that is meant to describe a feature.
     *
     * So the hint that used to sit under a "LOAD" heading is gone, and the
     * current step is reported only in the bottom bar.
     */

    drawingProperties.innerHTML =
        finaliseRows(rows);
}

export function renderComponentTree() {
    const groups =
        componentGroups();

    drawingProperties.dataset.selectedObjectId = '';
    drawingProperties.dataset.geometrySignature = '';

    if (
        !drawingState.objects.length
    ) {
        drawingProperties.innerHTML =
            '<div class="drawing-inspector-message">No components</div>';

        return;
    }

    const selectedCount =
        drawingState.selection
            .selectedObjectIds.length;

    const summary =
        selectedCount > 1
            ? `<div class="drawing-selection-summary">${selectedCount} components selected</div>`
            : "";

    const tree =
        [...groups.entries()]
            .map(
                ([groupName, objects]) => `
                    <div class="drawing-component-group">
                        ${groupName}
                    </div>

                    ${objects
                        .map(
                            object =>
                                componentRowMarkup(
                                    object,
                                    0
                                )
                        )
                        .join("")}
                `
            )
            .join("");

    drawingProperties.innerHTML =
        `${summary}<div class="drawing-component-tree">${tree}</div>`;

    drawingProperties
        .querySelectorAll(
            ".drawing-component-row"
        )
        .forEach(
            row => {
                row.addEventListener(
                    "click",
                    () => {
                        const id =
                            row.dataset
                                .objectId;

                        /*
                         * Clicking the selected row a SECOND
                         * time opens its editing page.
                         *
                         * The first click on a row records the
                         * pick and leaves the list on screen;
                         * the next click on that same row is the
                         * deliberate step into editing. A feature
                         * is selected automatically when it is
                         * created, so the test cannot simply be
                         * "is this row selected" - that is true
                         * from the start - and this is the flag
                         * that distinguishes the first click from
                         * the repeat.
                         */
                        const pickedAlready =
                            editorState.featurePanelView === 'tree' &&
                            editorState.featureTreePickedId === id;

                        if (pickedAlready) {
                            editorState.featurePanelView = 'edit';
                            editorState.featureTreePickedId = null;
                        } else {
                            editorState.featureTreePickedId = id;
                        }

                        enggDrawingState.selectObject(
                            drawingState,
                            id
                        );

                        renderProperties();
                        renderCurrentDrawing();
                    }
                );
            }
        );

    /*
     * CLICKING THE PANEL ITSELF DESELECTS.
     *
     * The rows above bind individually, so a click that lands on the
     * blank space below them - on a group heading, on the gap between
     * two groups, or on empty panel - reaches no row and does nothing
     * at all. The panel and the canvas then disagree: a feature is
     * still highlighted here and still selected there, with no way to
     * clear it short of hunting for its row.
     *
     * So a click anywhere on the panel that did NOT land on a row, a
     * twisty, or another control clears the selection - the same thing
     * clicking empty canvas does, which is what "the panel and the
     * canvas are two views of one selection" has to mean.
     *
     * Bound on the CONTAINER so it covers the whole panel including the
     * space after the last row, and it checks what was hit before
     * acting, so a click a row handled is left alone rather than being
     * immediately undone by this.
     */
    drawingProperties.addEventListener(
        "click",
        (event) => {
            /*
             * A row, a twisty, or a control has its own handling.
             */
            if (
                event.target.closest(
                    ".drawing-component-row," +
                    ".drawing-component-twisty," +
                    "button," +
                    "input," +
                    "select," +
                    "a," +
                    "label"
                )
            ) {
                return;
            }

            /*
             * The inspector may be showing an editing page rather than
             * the tree. Deselecting there would throw away the page the
             * student is on, which is not what clicking a gap in it
             * means. Only the list itself clears.
             */
            if (editorState.featurePanelView !== "tree") {
                return;
            }

            if (
                (drawingState.selection
                    .selectedObjectIds.length === 0 &&
                    editorState.featureTreePickedId === null)
            ) {
                return;
            }

            enggDrawingState.clearSelection(
                drawingState
            );

            editorState.featureTreePickedId = null;

            renderProperties();
            renderCurrentDrawing();
        }
    );

    /*
     * The disclosure control folds a branch's children away.
     *
     * Selecting a parent does not collapse it, so a click
     * that means "select this body" is never mistaken for a
     * click that means "hide what is attached to it".
     */
    drawingProperties
        .querySelectorAll(
            ".drawing-component-twisty"
        )
        .forEach(
            control => {
                control.addEventListener(
                    "click",
                    event => {
                        event.stopPropagation();

                        const id =
                            control.dataset
                                .twisty;

                        if (
                            collapsedComponents.has(id)
                        ) {
                            collapsedComponents.delete(id);
                        } else {
                            collapsedComponents.add(id);
                        }

                        renderProperties();
                    }
                );
            }
        );
}

/*
 * ========================================================
 * OPENING THE ANALYSIS EDITOR
 * ========================================================
 *
 * Sketch and Plot are two modes of ONE editor, and this is the single
 * place either is opened from. It is called from two places - the panel's
 * "Open Analysis Editor" button, and the placement commit - and both get
 * the same editor with the same content.
 *
 * The mode is the FEATURE's, not the button's. A student who placed a
 * Sketch and then opens the editor gets their sketch, not an empty Plot,
 * because the mode was stored on the diagram at creation and is read from
 * there every time.
 */
export function openAnalysisEditorFor(object) {
    if (!object || object.type !== 'analysis-diagram') {
        return false;
    }

    const equations =
        enggDiagramEquations;

    if (!equations) {
        return false;
    }

    const geometry = object.geometry || {};
    const mode = geometry.mode === 'plot'
        ? 'plot'
        : 'sketch';

    /*
     * Sketch and Plot are two modes of ONE editor, and this is the single
     * place either is opened from. It is called from two places - the panel's
     * "Open Analysis Editor" button, and the placement commit - and both get
     * the same editor with the same content.
     *
     * The mode is the FEATURE's, not the button's. A student who placed a
     * Sketch and then opens the editor gets their sketch, not an empty Plot,
     * because the mode was stored on the diagram at creation and is read from
     * there every time.
     *
     * WHICH MODE OPENS. Plot is entered as expressions, so it opens a dialog
     * with an expression list. Sketch is drawn by hand, so it opens the same
     * shaped dialog with the four sketching tools instead. There is one
     * dialog, two left-hand panels, and one Apply/Cancel.
     */
    if (mode === 'sketch') {
        return openSketchEditorFor(object, geometry);
    }

    const editor =
        enggPlotEditor;

    if (!editor) {
        return false;
    }

    const before =
        enggDrawingState.snapshotDrawing(
            drawingState
        );

    /*
     * THE QUANTITY IS CHOSEN, NOT TYPED. A student plotting a bending
     * moment diagram writes M(x), and the diagram already knows which of
     * the three it is - asking them to pick the letter would be asking
     * them to restate the choice they have already made, and would let
     * the two disagree.
     */
    editor.open({
        title: `${
            equations.titleFor(geometry.diagramType)
        } - Plot`,
        quantity:
            equations.quantityFor(
                geometry.diagramType
            ),
        range: geometry.localRange,
        expressions:
            equations.readPlot(geometry),
        onPreview: (expressions) => {
            geometry.expressions =
                expressions;
            renderCurrentDrawing();
        },
        onApply: (expressions) => {
            /*
             * THE LEGACY STORE IS CLEARED ONCE, HERE.
             *
             * An older file keeps its equations under `segments`, and the
             * reader takes that list when there are no expressions.
             * Leaving both behind would mean the old equations quietly
             * reappearing the next time a diagram is opened.
             */
            delete geometry.segments;

            geometry.expressions =
                expressions;

            enggDrawingState.commitDrawingChange(
                drawingState,
                before
            );
            renderCurrentDrawing();
            renderProperties();
        },
        onCancel: () => {
            renderCurrentDrawing();
            renderProperties();
        }
    });

    return true;
}

/*
 * OPENING A SKETCH.
 *
 * The twin of the Plot branch above, and deliberately the same shape: the
 * same title, the same range, the same preview-then-apply contract, the same
 * legacy-cleanup. The only difference is that what is being edited is a list
 * of drawn elements rather than a list of equations.
 *
 * The sketch elements live on the feature's own geometry, and nowhere else.
 * They are not ordinary Lines on the sheet: a line drawn here belongs to the
 * diagram, moves with it, and is deleted with it. Storing them as document
 * features would make each one an independent thing the student could
 * select, move and delete on its own - and a sketch element that can be
 * dragged off its own diagram is not part of any diagram.
 */
function openSketchEditorFor(object, geometry) {
    const editor = enggSketchEditor;
    const equations = enggDiagramEquations;

    if (!editor || !equations) {
        return false;
    }

    const before =
        enggDrawingState.snapshotDrawing(
            drawingState
        );

    editor.open({
        title: `${
            equations.titleFor(geometry.diagramType)
        } - Sketch`,
        range: geometry.localRange,
        elements: geometry.sketchElements || [],

        /*
         * THE DIAGRAM'S OWN VERTICAL EXTENT.
         *
         * The sketch's y-scale is fixed when the editor opens, and this is the
         * value it is fixed against: the same extent the PLOTTED mode draws to,
         * so switching between drawing and plotting a diagram shows it at one
         * size, and a sketch that is empty still has a real y-axis.
         */
        yRange: Number(geometry.yRange) || Number(geometry.unitHeight) || 0,

        /*
         * THE ORDINATE'S UNIT, from the diagram's own axis definition - kN
         * for a shear or axial diagram, kN·m for a bending moment. The Y-value
         * popup states the number in it, so the student sees "250 kN" rather
         * than a bare 250.
         */
        yUnit:
            enggDrawingRenderer?.ANALYSIS_DIAGRAM_AXES?.[
                geometry.diagramType
            ]?.unit || "",

        /*
         * THE BODY'S ELEMENT STATIONS, for the graph's ticks.
         *
         * These are the same live references the diagram already derives from
         * its source body on every pass, so the sketch's ticks are the real
         * x-locations of the forces, supports, loads and connections on the
         * member - and they follow the body, rather than being a second list
         * the sketch would have to keep in step.
         */
        stations: geometry.referencePositions || [],
        onPreview: (elements) => {
            geometry.sketchElements = elements;

            /*
             * The flag the renderer reads to decide whether the plot-area
             * highlight is earned. It is derived from the elements rather
             * than set by them, so it cannot disagree with what is actually
             * there - and an empty sketch shows no highlight, which is the
             * point of the flag.
             */
            geometry.sketchContent =
                elements.length > 0;

            renderCurrentDrawing();
        },
        onApply: (elements) => {
            geometry.sketchElements = elements;

            geometry.sketchContent =
                elements.length > 0;

            enggDrawingState.commitDrawingChange(
                drawingState,
                before
            );

            renderCurrentDrawing();
            renderProperties();
        },
        onCancel: () => {
            renderCurrentDrawing();
            renderProperties();
        }
    });

    return true;
}
