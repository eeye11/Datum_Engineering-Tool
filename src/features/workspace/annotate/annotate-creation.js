/*
 * ========================================================
 * CREATING AN ANNOTATE FEATURE
 * ========================================================
 *
 * One module drives every Annotate tool - Note, Label, Leader, Callout,
 * Arrow, Symbol, Tolerance and Table - so the tools differ only in their
 * KIND and never in how they are made. A Note and a Leader go through the
 * same arming, the same preview, the same snap resolver, the same commit
 * and the same single undo entry; what changes is which fields the commit
 * fills in.
 *
 * TWO INTERACTION STYLES, DECIDED BY THE KIND
 * -------------------------------------------
 * A POINT-PLACED annotation - a note, a symbol, a tolerance, a table - is
 * placed with ONE click. There is no second point, so inventing a drag for
 * it would be a gesture with nothing to say.
 *
 * A GEOMETRIC annotation - a leader, a callout, an arrow - is a start and
 * an end, so it supports BOTH:
 *
 *     click start -> move -> click end        (click-move-click)
 *     press -> drag -> release                (click-drag)
 *
 * The classification is the SAME one the geometry tools use, and it lives
 * in creation-drag.js: the press arms, the first movement past the
 * threshold starts the feature, and the release commits. This module only
 * says which kinds take part (`isGeometricKind`); it does not re-implement
 * the drag.
 *
 * The one thing that had to be decided here is the CLICK-move-click half
 * for a geometric kind: after the first click the tool holds an anchor and
 * the preview follows the cursor, and the second click commits. That is
 * the `annotateStage` below.
 *
 * WHAT IS NEVER WRITTEN UNTIL THE END
 * -----------------------------------
 * Arming and previewing touch only the interaction. The document is
 * written once, on commit, through the ordinary snapshot/add/commit path -
 * so Escape leaves nothing behind, the preview never enters undo history,
 * and one creation is one undoable action.
 */
import enggDrawingState from "../../../shared/model/drawing-state.js";
import enggAnnotate from "../model/annotations/annotate-model.js";
import { HEAT_TRANSFER_TOOLS, heatTransferTool } from "../model/thermodynamics/heat-transfer.js";
import { renderCurrentDrawing } from "../../../components/layout/workspace/canvas-render.js";
import { drawingState } from "../editor-state.js";
import { renderProperties } from "../../../components/layout/panels/feature-panel.js";
import { hitTestAnnotateTarget } from "../interaction/hit-testing.js";
import { setToolMessage } from "../../../components/layout/toolbar/toolbar-render.js";

/*
 * The Annotate tools, and the kind each one makes.
 *
 * DERIVED FROM THE MODEL, NOT RESTATED.
 *
 * The eight kinds are already declared once, with their behaviour, in
 * features/annotations/annotate-model.js. Writing the same eight names again
 * here would be a second list to keep in step - and the failure would be
 * silent: a kind added to the model but not to this map would simply have no
 * tool, with nothing to say why.
 *
 * So the tool ids ARE the kind ids, and the map is built from the model's own
 * table. Adding a kind there and a tool to the toolset is then all that is
 * needed; this file cannot fall behind.
 */
export const ANNOTATE_TOOL_KINDS = Object.fromEntries(
  [...Object.keys(enggAnnotate.ANNOTATE_KINDS).map((kind) => [kind, kind]),
    ...Object.keys(HEAT_TRANSFER_TOOLS).map(toolId => [toolId, "arrow"]),
    ["electric-work", "arrow"], ["mechanical-work", "arrow"]]
);

const workToolLabels = {
  "electric-work": "Electric Work",
  "mechanical-work": "Mechanical Work"
};

/*
 * Is this one of the Annotate tools?
 *
 * Asked by name, from ONE table, so a tool added to the Annotate toolset
 * and forgotten here is impossible: the two are the same list read twice.
 */
export function isAnnotateTool(toolId) {
  return Boolean(ANNOTATE_TOOL_KINDS[toolId]);
}

export function annotateKindFor(toolId) {
  return ANNOTATE_TOOL_KINDS[toolId] || null;
}

/*
 * Whether this feature's text is the student's to write.
 *
 * A note, a label, a leader and a callout hold text the student typed, so
 * double-clicking one opens the write box. A symbol renders a library glyph,
 * a tolerance reads its own mode and values, and a table is a grid of cells
 * - none of those is free text, so none of them opens a text editor: they
 * are edited through their own panel rows, which is the honest place for a
 * value that is not a sentence.
 */
export function isEditableAnnotate(object) {
  if (!object || object.type !== "annotate") {
    return false;
  }

  return ["note", "label", "leader", "callout"].includes(
    object.annotateKind
  );
}

/*
 * Whether the active Annotate tool places with a single click or takes a
 * start-and-end gesture. The interaction routers ask this rather than
 * listing kinds, so the answer lives with the kind.
 */
export function isGeometricAnnotateTool(toolId) {
  const kind = annotateKindFor(toolId);

  return Boolean(kind) && enggAnnotate.isGeometricKind(kind);
}

/*
 * The instruction an Annotate tool opens with, so the bottom bar says what
 * to do next rather than leaving the previous tool's wording in place.
 */
export function annotateInstruction(toolId) {
  if (toolId === "electric-work") return "Drag from the upper lead to the lower lead; the resistor extends to the right";
  if (workToolLabels[toolId]) {
    return `${workToolLabels[toolId]}: drag from the arrow tail to where the work flows`;
  }
  const heat = heatTransferTool(toolId);
  if (heat) {
    return `${heat.label}: drag from the arrow tail to where the heat flows`;
  }
  const kind = annotateKindFor(toolId);

  if (!kind) {
    return "Specify location";
  }

  if (enggAnnotate.isGeometricKind(kind)) {
    return kind === "arrow"
      ? "Specify arrow start point"
      : "Specify the point to point at";
  }

  return (
    {
      note: "Specify note location",
      label: "Click the feature to label",
      symbol: "Specify symbol location",
      tolerance: "Specify tolerance location",
      table: "Specify table location"
    }[kind] || "Specify location"
  );
}

/*
 * The default geometry options for a freshly placed kind.
 *
 * Gathered in one place so the commit below has no per-kind branching
 * beyond this, and so the defaults a new note or table starts with are
 * stated once rather than at each call site.
 */
function defaultsFor(kind) {
  if (kind === "table") {
    return { rows: 3, columns: 3 };
  }

  if (kind === "tolerance") {
    return {
      toleranceMode: "symmetric",
      toleranceValues: { value: 0.1, upper: 0.1, lower: -0.1 }
    };
  }

  if (kind === "symbol") {
    return { symbolId: "datum" };
  }

  return {};
}

/*
 * Commit an Annotate feature from a placement and, for a geometric kind,
 * its two ends.
 *
 * ONE commit path for every kind and both interaction styles, so a leader
 * drawn by dragging and a leader drawn by two clicks produce identical
 * features through identical code - there is no second path for either to
 * drift onto.
 */
export function commitAnnotate(options) {
  const kind = options.kind;

  if (!kind) {
    return null;
  }

  const previousObjects =
    enggDrawingState.snapshotDrawing(drawingState);

  /*
   * A LABEL'S NAME COMES FROM THE DRAWING-WIDE A..Z SEQUENCE.
   *
   * Not from the type numbering `addObject` applies by default - that would
   * call it "Label 1". The sequence is read from the LIVE DRAWING STATE, so it
   * is continuous across the whole sheet and the next free letter is taken (see
   * `nextLabelName`). Every other kind keeps its ordinary numbered name.
   */
  const labelName =
    kind === "label" ? enggAnnotate.nextLabelName(drawingState) : undefined;

  const object =
    enggDrawingState.geometryFactories.annotate({
      kind,
      text: options.text,
      position: options.position,
      start: options.start,
      end: options.end,

      /*
       * A LABEL'S ANCHOR IS THE POINT IT WAS PLACED ON. The click point is the
       * place on the body the label marks; its text starts there too and may be
       * moved away, which is what the auto-leader bridges.
       */
      anchor: kind === "label" ? options.position : null,

      /*
       * A CHOSEN SYMBOL, when the caller supplied one - the Symbol tool's picker
       * passes it here. `defaultsFor` supplies "datum" otherwise, so a symbol
       * added by any other route still has a glyph.
       */
      symbolId: options.symbolId || undefined,

      targetFeatureId: options.targetFeatureId,
      ...defaultsFor(kind),

      /*
       * THE CHOSEN TABLE SIZE WINS OVER THE DEFAULT.
       *
       * Placed AFTER the defaults spread, so the grid picker's rows and columns
       * replace the 3x3 that `defaultsFor` supplies - a `rows: undefined` from a
       * caller that did not choose leaves the default in place.
       */
      ...(Number.isFinite(Number(options.rows)) &&
      Number.isFinite(Number(options.columns))
        ? { rows: options.rows, columns: options.columns }
        : {}),

      name: labelName
    });

  /*
   * A NOTE IS WRITTEN AFTER IT IS PLACED.
   *
   * It starts EMPTY on purpose - the student has not typed anything yet -
   * and the panel's text field is where it gets written. Committing it
   * with placeholder text would put a word on the drawing that the student
   * never chose.
   */
  if (kind === "note") {
    object.text = "";
  }

  /*
   * A LABEL STARTS CARRYING ITS OWN NAME.
   *
   * The A..Z sequence letter IS the label's content, so it is seeded as the
   * text. The student may overwrite it through the editor, exactly as before -
   * the name is only the starting content, not a lock.
   */
  if (kind === "label" && labelName) {
    object.text = labelName;
  }

  const heat = kind === "arrow" && heatTransferTool(drawingState.activeTool);
  const workLabel = kind === "arrow" && workToolLabels[drawingState.activeTool];
  if (workLabel) {
    object.name = drawingState.activeTool === "electric-work" ? "Resistor" : workLabel;
    object.metadata = { ...object.metadata, thermodynamicsKind: drawingState.activeTool };
  }
  if (heat) {
    object.name = heat.label;
    object.style.stroke = heat.colour;
    object.metadata = { ...object.metadata, thermodynamicsKind: drawingState.activeTool };
  }

  enggDrawingState.addObject(drawingState, object);

  enggDrawingState.commitDrawingChange(
    drawingState,
    previousObjects
  );

  enggDrawingState.clearInteraction(drawingState);

  enggDrawingState.selectObject(drawingState, object.id);

  setToolMessage(heat ? `${heat.label} arrow placed` : workLabel ? `${object.name} placed` : annotatePlacedMessage(kind));

  renderProperties();
  renderCurrentDrawing();

  /*
   * ========================================================
   * A WRITTEN ANNOTATION OPENS ITS EDITOR AS IT IS PLACED
   * ========================================================
   *
   * A note, a label, a leader and a callout are the student's own WORDS, so
   * placing one and then having to go and find its text is a step that exists
   * for no reason: the student has just said where it goes. The editor is
   * therefore opened at once, on the feature just created.
   *
   * IT IS THE SAME EDITOR a double-click opens - `openNoteEditorFor` - so there
   * is one write box for the whole application and both routes into it behave
   * identically. Imported LAZILY because canvas-click.js already reaches the
   * annotate layer, and a static import here would close that loop at load
   * time.
   *
   * The feature is committed BEFORE this runs, so cancelling the editor leaves
   * the (empty or defaulted) annotation in place rather than removing it - the
   * placement is its own act and the writing is another, exactly as the note
   * panel has always worked.
   */
  if (isEditableAnnotate(object)) {
    void import("../interaction/canvas-click.js").then((module) => {
      module.openNoteEditorFor?.(object);
    });
  }

  return object;
}

/**
 * Put the armed tool back to Select.
 *
 * Used by the Symbol tool, whose workflow is ONE placement per operation: after
 * a symbol is placed the tool hands back to Select so a stray click cannot place
 * a second. `setActiveTool` is the one place the active tool changes, so this
 * behaves exactly as a click on the Select button does.
 */
function returnToSelect() {
  enggDrawingState.setActiveTool(drawingState, "select");

  setToolMessage("Symbol placed - Select is active");

  renderCurrentDrawing();
}

function annotatePlacedMessage(kind) {
  return (
    {
      note: "Note placed - type its text in the panel",
      label: "Label placed - it will follow its feature",
      leader: "Leader placed",
      callout: "Callout placed",
      arrow: "Arrow placed",
      symbol: "Symbol placed",
      tolerance: "Tolerance placed",
      table: "Table placed - edit its cells in the panel"
    }[kind] || "Annotation placed"
  );
}

/*
 * ========================================================
 * A CLICK WHILE AN ANNOTATE TOOL IS ACTIVE
 * ========================================================
 *
 * Two shapes of tool, two shapes of click sequence:
 *
 * POINT-PLACED (note, symbol, tolerance, table)
 *     one click places it. Before that, a hover only previews.
 *
 * GEOMETRIC (leader, callout, arrow)
 *     click one sets the anchor and arms the preview;
 *     click two commits. Click one on empty space still sets
 *     the anchor, because an arrow genuinely may point from
 *     nowhere to nowhere - it is a free mark.
 *
 * A TARGETED kind (label, leader, callout, tolerance) records the feature
 * under the click so the annotation is ASSOCIATED with it. The association
 * is by feature id from the shared hit test, never by position, so it
 * survives the feature moving.
 */
export function handleAnnotateClick(resolution) {
  const toolId = drawingState.activeTool;
  const kind = annotateKindFor(toolId);

  if (!kind) {
    return false;
  }

  const point =
    resolution?.effectiveConstructionPoint ||
    resolution?.rawPointerPoint;

  if (!point) {
    return false;
  }

  const interaction = drawingState.interaction;

  /*
   * ASKED ONCE. The kind decides both whether this is a two-ended mark and
   * whether it attaches to a feature, and both questions are asked of the
   * same table - so they are answered together here rather than re-derived at
   * each branch below.
   */
  const geometric = enggAnnotate.isGeometricKind(kind);

  const here = { x: point.x, y: point.y };

  /*
   * A GEOMETRIC KIND WHOSE ANCHOR IS ALREADY SET: this click commits it.
   * The anchor was chosen on the previous click and the preview has been
   * following the cursor since. The target is carried over from the anchor -
   * NOT re-picked - because the second click is answered where the TEXT goes,
   * which is very often not on the feature that was pointed at.
   */
  if (geometric && interaction.annotateStage === "anchor" && interaction.annotateStart) {
    commitAnnotate({
      kind,
      start: interaction.annotateStart,
      end: here,
      targetFeatureId: interaction.annotateTarget || null
    });

    return true;
  }

  /*
   * A POINT-PLACED KIND commits on its single click, at the click point.
   */
  if (!geometric) {
    /*
     * ========================================================
     * SYMBOL: CHOOSE FROM THE LIBRARY, THEN PLACE ONCE
     * ========================================================
     *
     * The Symbol tool places ONE symbol and returns to Select. The symbol is
     * chosen from the searchable library FIRST - so the student sees the glyph
     * before committing to it - and the choice is held on the interaction
     * (`annotateSymbolId`) until the placement click.
     *
     * A first click with nothing chosen OPENS THE PICKER rather than placing the
     * default; once a symbol is chosen, the next click PLACES it and the tool
     * hands back to Select. That is the whole workflow the requirement asks for,
     * and it keeps one placement per operation.
     */
    if (kind === "symbol") {
      const chosen = interaction.annotateSymbolId;

      if (!chosen) {
        void import("../../../shared/ui/editors/symbol-picker.js").then((module) => {
          module.default?.open({
            onPick: (symbolId) => {
              enggDrawingState.setInteraction(drawingState, {
                annotateSymbolId: symbolId
              });

              setToolMessage(
                "Symbol chosen - click the canvas to place it"
              );

              renderCurrentDrawing();
            },

            onCancel: () => {
              setToolMessage(annotateInstruction(drawingState.activeTool));
            }
          });
        });

        return true;
      }

      commitAnnotate({
        kind,
        position: here,
        symbolId: chosen,
        targetFeatureId: null
      });

      /*
       * ONE SYMBOL PER OPERATION, THEN BACK TO SELECT. The interaction's symbol
       * choice is spent with the placement, and the tool is put back to Select
       * so a stray click does not place a second symbol.
       */
      enggDrawingState.setInteraction(drawingState, {
        annotateSymbolId: null
      });

      returnToSelect();

      return true;
    }

    if (kind === "table") {
      /*
       * The table's SHAPE is chosen first, from the grid picker, and held on the
       * interaction until the placement click - exactly as the symbol's choice
       * is. The grid is a real preview, so what is placed is what was chosen.
       */
      const chosen = interaction.annotateTableSize;

      if (!chosen) {
        void import("../../../shared/ui/editors/table-picker.js").then((module) => {
          module.default?.open({
            onPick: ({ rows, columns }) => {
              enggDrawingState.setInteraction(drawingState, {
                annotateTableSize: { rows, columns }
              });

              setToolMessage(
                `Table ${rows} x ${columns} - click the canvas to place it`
              );

              renderCurrentDrawing();
            },

            onCancel: () => {
              setToolMessage(annotateInstruction(drawingState.activeTool));
            }
          });
        });

        return true;
      }

      commitAnnotate({
        kind,
        position: here,
        rows: chosen.rows,
        columns: chosen.columns,
        targetFeatureId: null
      });

      enggDrawingState.setInteraction(drawingState, {
        annotateTableSize: null
      });

      return true;
    }

    commitAnnotate({
      kind,
      position: here,
      targetFeatureId: targetFor(kind, point)
    });

    return true;
  }

  /*
   * A GEOMETRIC KIND'S FIRST CLICK: set the anchor and wait. The preview
   * is drawn from this anchor to the cursor by the preview module, so the
   * student sees the leader or arrow before they commit it.
   */
  beginAnnotateAnchor({
    kind,
    point,
    targetFeatureId: targetFor(kind, point)
  });

  return true;
}

/*
 * The feature a targeted kind is about, from the shared hit test.
 *
 * `null` is a normal answer: a leader or callout may point at empty space,
 * and a label is the only one that insists on a target (checked at its
 * creation, not here). Resolved by feature id, so the annotation follows
 * the feature rather than the pixel.
 */
function targetFor(kind, point) {
  if (!enggAnnotate.ANNOTATE_KINDS[kind]?.targeted) {
    return null;
  }

  const target = hitTestAnnotateTarget(point);

  return target ? target.id : null;
}

/*
 * Hold the first end of a geometric annotation and wait for the second.
 *
 * Written to the INTERACTION, so nothing is in the document yet and Escape
 * abandons it with nothing to clean up.
 */
export function beginAnnotateAnchor({ kind, point, targetFeatureId }) {
  enggDrawingState.setInteraction(drawingState, {
    annotateStage: "anchor",
    annotateKind: kind,
    annotateStart: { x: point.x, y: point.y },
    annotateEnd: { x: point.x, y: point.y },
    annotateTarget: targetFeatureId || null
  });

  setToolMessage(
    drawingState.activeTool === "electric-work"
      ? "Place the lower lead to size the resistor; Esc cancels"
      : kind === "arrow"
      ? "Specify arrow endpoint"
      : "Move to place the text, click to confirm, Esc to cancel"
  );

  renderCurrentDrawing();
}

/*
 * Update the live end of an armed geometric annotation as the cursor
 * moves.
 *
 * Called from the pointer-move pipeline. Writes to the interaction only -
 * a per-frame cursor position is not a document change and must not become
 * a history entry.
 */
export function updateAnnotateAnchorPreview(resolution) {
  const interaction = drawingState.interaction;

  if (
    interaction.annotateStage !== "anchor" ||
    !interaction.annotateStart
  ) {
    return false;
  }

  const point = resolution?.effectiveConstructionPoint;

  if (!point) {
    return false;
  }

  interaction.annotateEnd = { x: point.x, y: point.y };

  return true;
}

/*
 * Complete an armed geometric annotation at a point.
 *
 * The DRAG path arrives here on release - the same function the second
 * click reaches - so both interaction styles commit through one call and
 * cannot produce different geometry.
 */
export function completeAnnotateAt(point) {
  const interaction = drawingState.interaction;

  if (
    interaction.annotateStage !== "anchor" ||
    !interaction.annotateStart
  ) {
    return false;
  }

  const kind = interaction.annotateKind;

  const start = interaction.annotateStart;
  const targetFeatureId = interaction.annotateTarget || null;

  /*
   * THE START OF THE ANCHOR IS THE ANNOTATION'S OWN POINT FOR A KIND THAT
   * IS NOT GEOMETRIC AFTER ALL - which cannot happen, but is guarded so a
   * future kind cannot route itself here and commit a two-ended feature it
   * does not have.
   */
  if (!enggAnnotate.isGeometricKind(kind)) {
    return false;
  }

  commitAnnotate({
    kind,
    start,
    end: { x: point.x, y: point.y },
    targetFeatureId
  });

  return true;
}

/*
 * The creation options a DRAG has established, so creation-drag.js can
 * hand its press and release points to the ONE commit above.
 *
 * A drag begins the anchor on its press and completes on its release; the
 * two halves are `beginAnnotateAnchor` and `completeAnnotateAt` above.
 * This exists so the drag module does not need to know the shape of the
 * interaction - it only knows "this tool takes a start and an end".
 */
export function beginAnnotateDragAnchor(point, targetFeatureId) {
  const kind = annotateKindFor(drawingState.activeTool);

  if (!kind || !enggAnnotate.isGeometricKind(kind)) {
    return false;
  }

  beginAnnotateAnchor({
    kind,
    point,
    targetFeatureId: targetFeatureId || null
  });

  return true;
}

/*
 * Cancel an armed annotation without creating anything.
 */
export function cancelAnnotateAnchor() {
  const interaction = drawingState.interaction;

  if (!interaction.annotateStage) {
    return false;
  }

  enggDrawingState.clearInteraction(drawingState);

  return true;
}

const enggAnnotateCreation = {
  ANNOTATE_TOOL_KINDS,
  isAnnotateTool,
  annotateKindFor,
  isGeometricAnnotateTool,
  annotateInstruction,
  handleAnnotateClick,
  beginAnnotateAnchor,
  beginAnnotateDragAnchor,
  updateAnnotateAnchorPreview,
  completeAnnotateAt,
  commitAnnotate,
  cancelAnnotateAnchor
};

export default enggAnnotateCreation;
