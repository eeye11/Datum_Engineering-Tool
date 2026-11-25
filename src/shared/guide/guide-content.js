/*
 * ============================================================
 * THE USER GUIDE'S CONTENT
 * ============================================================
 *
 * WHAT IS DATA AND WHAT IS DERIVED
 * --------------------------------
 * The sections, their descriptions, their tutorials and the authored part of
 * each tool's reference (how it is used after the first click, what the
 * Features panel offers, tips) are DATA - they are teaching material, and
 * nothing in the application holds them.
 *
 * The tool NAMES, their groups, their shortcuts, their opening instruction and
 * the gesture each one takes are NOT here. They are asked of the live registry
 * through `guide-tool-metadata.js`, so the Tool Reference lists exactly the
 * tools the toolbar offers and cannot drift from them. A tool with no authored
 * entry below still appears, described by what the registry says and marked as
 * not yet documented - never with invented behaviour.
 *
 * EVERY TUTORIAL STEP HAS A TARGET
 * --------------------------------
 * A step names `target`, and the overlay highlights that element in the LIVE
 * application:
 *
 *   { kind: "category", id: "GEOMETRY" }  the real toolset button
 *   { kind: "tool", id: "line" }          the real tool button for that id
 *   { kind: "control", id: "drawingGridToggle" }
 *   { kind: "canvas" }                    the drawing area
 *   { kind: "guide" }                     the guide's own tutorial list
 *   { kind: "tutorial" }                  the overlay's own navigation
 *
 * {"menu", id} is still understood for a step about the menu bar itself, but
 * NO TUTORIAL OPENS ON ONE: the tutorial is already open when its steps begin,
 * so a first step that pointed at Help would be pointing at the door the
 * student just came through. The first step always names the real control or
 * canvas action the student has to use.
 *
 * "guide" and "tutorial" are the two targets that are not part of the drawing
 * workspace - they are the guide explaining itself, and both exist the moment
 * the guide is open. A step whose target cannot be found at run time (a
 * collapsed panel, a menu that moved) degrades to the target's own container
 * with a note, rather than pointing at nothing.
 *
 * TUTORIALS NEVER RUN A COMMAND. A step can SHOW where a control is; it cannot
 * press it. That is the rule that makes "a tutorial must not modify the
 * drawing" true by construction rather than by care.
 */

/*
 * ============================================================
 * THE ELEVEN SECTIONS
 * ============================================================
 *
 * In the order the toolset bar shows them, with Workspace & Navigation first
 * because it explains the frame the other ten are drawn in.
 *
 * `category` is the `data-category` the toolset button carries, and it is what
 * the section's Tool Reference reads its tools from. Workspace & Navigation has
 * no category: its reference is the general commands below.
 */
export const SECTIONS = [
  {
    id: "workspace",
    title: "Workspace & Navigation",
    icon: "hand",
    category: null,
    blurb:
      "The canvas, the menus and the commands that move or manage what is drawn.",
    description:
      "How the window is arranged, how to move around the sheet, and the general commands that act on objects rather than create them.",
  },
  {
    id: "geometry",
    title: "Geometry",
    icon: "shapes",
    category: "GEOMETRY",
    blurb: "Points, lines, shapes and the coordinate system.",
    description:
      "The drawing primitives: points, lines, triangles, rectangles, circles, arcs and polygons, plus the coordinate system used to orient them.",
  },
  {
    id: "annotate",
    title: "Annotate",
    icon: "ruler",
    category: "ANNOTATE",
    blurb: "Dimensions, notes, labels, callouts, symbols and tables.",
    description:
      "Measurements and written information placed on the drawing: dimensions that follow the geometry, text and labels, callouts and tables.",
  },
  {
    id: "statics",
    title: "Statics",
    icon: "snap-inference",
    category: "STATICS",
    blurb: "Bodies, loads, supports, connections and beam diagrams.",
    description:
      "Free-body diagrams: bodies, applied loads and moments, supports, connections, and the analysis features that document forces.",
  },
  {
    id: "dynamics",
    title: "Dynamics",
    icon: "arrow-up-right",
    category: "DYNAMICS",
    blurb: "Particles, bodies, kinematics and mechanical elements.",
    description:
      "Motion: particles and rigid bodies, vectors, paths, springs, dampers and pulleys drawn as an engineering sketch.",
  },
  {
    id: "fluids",
    title: "Fluids",
    icon: "grid",
    category: "FLUIDS",
    blurb: "Runs, fittings, equipment and flow diagrams.",
    description:
      "Schematics of flow: pipework runs, fittings, equipment, flow indicators and the profile diagrams drawn beside them.",
  },
  {
    id: "thermodynamics",
    title: "Thermodynamics",
    icon: "maximize-2",
    category: "THERMODYNAMICS",
    blurb: "Process devices, cycles and property diagrams.",
    description:
      "Energy systems: tanks, control volumes, turbines and compressors, heat and work arrows, and the cycles drawn on property axes.",
  },
  {
    id: "heat",
    title: "Heat Transfer",
    icon: "grid",
    category: "HEAT TRANSFER",
    blurb: "Regions, walls, paths, boundaries and thermal circuits.",
    description:
      "Heat flow: regions and walls, conduction, convection and radiation paths, boundary conditions, sources and thermal circuits.",
  },
  {
    id: "solid",
    title: "Solid Mechanics",
    icon: "scan-search",
    category: "SOLID MECHANICS",
    blurb: "Stress elements and boundary stress on a body.",
    description:
      "Stress states: stress elements and the boundary stress drawn on a loaded plate, with their symbolic edge equations.",
  },
  {
    id: "controls",
    title: "Controls",
    icon: "shapes",
    category: "CONTROLS",
    blurb: "Blocks, gains, summing junctions and signal lines.",
    description:
      "Block diagrams: plants, gains, summing junctions and the signal lines that connect them into a system.",
  },
  {
    id: "math",
    title: "Math / Analysis",
    icon: "file-text",
    category: "MATH / ANALYSIS",
    blurb: "Points, vectors, graphs, equations and tangent constructions.",
    description:
      "The mathematical layer: points and vectors, functions drawn as graphs, typeset equations and the tangent and slope constructions derived from them.",
  },
];

export function sectionById(id) {
  return SECTIONS.find((section) => section.id === id) || null;
}

/*
 * ============================================================
 * TARGETS
 * ============================================================
 *
 * One helper per kind, so a tutorial reads as English rather than as object
 * literals, and so the overlay has one place to look for what a kind means.
 */
const menu = (id, label) => ({ kind: "menu", id, label });
const category = (id, label) => ({ kind: "category", id, label });
const tool = (id, label) => ({ kind: "tool", id, label });
const control = (id, label) => ({ kind: "control", id, label });
const canvas = (label) => ({ kind: "canvas", label });

/*
 * The guide's own screens, as targets. Used by a step that explains the guide
 * itself - the section list, the two tabs, the tutorial's navigation - so a
 * tour of the guide is made of the same steps as a tour of the drawing.
 */
export const GUIDE_TARGETS = {
  list: { kind: "guide", label: "the section list" },
  tabs: { kind: "guide", part: "tabs", label: "the Tutorials and Tool Reference tabs" },
  content: { kind: "guide", part: "content", label: "this section's contents" },
  navigation: { kind: "tutorial", label: "the tutorial navigation" },
};

/*
 * The real, stable ids the highlights are placed on. Named here so a tutorial
 * says "the grid toggle" and the overlay knows which element that is, without
 * either of them repeating a CSS selector.
 */
export const CONTROLS = {
  commandSearch: { id: "drawingCommandSearch", label: "Command Search" },
  undo: { id: "drawingUndo", label: "Undo" },
  redo: { id: "drawingRedo", label: "Redo" },
  thickness: { id: "drawingThickness", label: "Line thickness" },
  colour: { id: "drawingColor", label: "Drawing colour" },
  lineType: { id: "drawingLineType", label: "Line type" },
  grid: { id: "drawingGridToggle", label: "Grid" },
  snap: { id: "drawingSnapToggle", label: "Snap" },
  dimensions: { id: "drawingDimensionsToggle", label: "Dimensions" },
  magnitudes: { id: "drawingMagnitudesToggle", label: "Magnitudes" },
  fit: { id: "drawingFitView", label: "Fit drawing to view" },
  zoomOut: { id: "drawingZoomOut", label: "Zoom out" },
  zoomIn: { id: "drawingZoomIn", label: "Zoom in" },
  zoomValue: { id: "drawingZoomValue", label: "Zoom percentage" },
  toolsPanel: { id: "drawingToolPanel", label: "Tools panel" },
  toolList: { id: "drawingToolList", label: "the tool list" },
  inspector: { id: "drawingFeaturesPanel", label: "Drawing inspector" },
  objectsTab: { id: "drawingPanelTabObjects", label: "Objects tab" },
  featuresTab: { id: "drawingPanelTabFeatures", label: "Features tab" },
  sourceTab: { id: "drawingPanelTabSource", label: "Source tab" },
  statusBar: { id: "drawingToolMessage", label: "Status line" },
};

/*
 * ============================================================
 * TUTORIALS
 * ============================================================
 *
 * A tutorial is an ordered walkthrough of real work. Each step is one
 * instruction, shown beside the control it names, and the student does the
 * work themselves.
 *
 * TWO KINDS OF STEP
 * -----------------
 *
 *   INFORMATIONAL   `action: null`. Nothing to perform; Next advances it.
 *                   Used only where there is no meaningful interaction - an
 *                   introduction, or the explanation that comes before the
 *                   first thing the student does.
 *
 *   ACTION          `action: {...}`. The student must perform it in the real
 *                   interface. Next stays disabled until the application's
 *                   own state shows the action happened (`guide-actions.js`
 *                   says how each kind is checked), and the guide cursor keeps
 *                   demonstrating until then.
 *
 *     { kind: "category", category: "GEOMETRY" }     a toolset is pressed
 *     { kind: "openGroup", group: "body", tool: "beam" }  its group opened AND
 *                                                     one tool inside armed
 *     { kind: "tool",     tool: "rectangle" }        a tool is armed
 *     { kind: "create",   type: "rectangle" }        an object of that type exists
 *     { kind: "select",   type: "rectangle" }        such an object is selected
 *     { kind: "change",   type: "rectangle" }        its geometry was changed
 *     { kind: "property", property: "fill" }         a property changed
 *     { kind: "setting",  group: "display", key: "showDimensions", to: false }
 *     { kind: "source",   contains: "\\draw" }        the source was edited
 *     { kind: "panel",    panel: "features" }         a tab is showing
 *
 * `perform` is the instruction in the student's own words, and it is what the
 * panel shows while the action is outstanding.
 *
 * A STEP'S TARGET IS WHERE THE CURSOR DEMONSTRATES. It highlights and points
 * at a real control in the running application, and the gated step is what
 * makes that demonstration do actual teaching work: the student watches a real
 * control being pointed at, then uses it.
 *
 * These tutorials run in the TEMPORARY TUTORIAL WORKSPACE (see
 * `guide-workspace.js`), so the student draws for real without touching their
 * own sheet.
 */
export const TUTORIALS = {
  workspace: [
    {
      id: "workspace-find-and-draw",
      title: "Find the tools, then draw a line",
      summary:
        "The whole loop: choose a toolset, arm a tool, draw a line on the sheet, then put the tool away.",
      steps: [
        {
          target: category("GEOMETRY", "GEOMETRY"),
          title: "Choose the Geometry toolset",
          text: "The toolset row chooses which set of drawing tools the Tools panel lists. It is already on screen, so start here.",
          perform: "Click GEOMETRY in the toolset row.",
          gesture: "click",
          action: { kind: "category", category: "GEOMETRY" },
        },
        {
          target: tool("line", "Line"),
          title: "Arm the Line tool",
          text: "Pressing Line arms it. The status line at the bottom of the window then says what the tool wants next.",
          perform: "Click the Line tool in the Geometry tools list.",
          gesture: "click",
          action: { kind: "tool", tool: "line" },
        },
        {
          target: canvas("the drawing area"),
          title: "Draw a line",
          text: "Press on the sheet and drag to the other end, or click once for each end. Snapping aligns the ends as you go.",
          perform: "Draw a line on the drawing area.",
          gesture: "drag",
          action: { kind: "create", type: "line", minLength: 20 },
        },
        {
          target: tool("select", "Select"),
          title: "Put the tool away",
          text: "Escape, or the Select tool, ends the line and hands the canvas back - the status line confirms it is Select again.",
          perform: "Press Escape, or click the Select tool.",
          gesture: "press",
          action: { kind: "tool", tool: "select" },
        },
      ],
    },
    {
      id: "workspace-navigate",
      title: "Move around the sheet",
      summary:
        "Zoom about the pointer, zoom in steps, and fit the whole drawing - without touching the drawing itself.",
      steps: [
        {
          target: control(CONTROLS.zoomIn.id, CONTROLS.zoomIn.label),
          title: "Zoom in one step",
          text: "The + button steps the zoom in about the centre of the view. The percentage between the buttons shows the result.",
          perform: "Click the + zoom button.",
          gesture: "click",
          action: { kind: "zoom", direction: "in" },
        },
        {
          target: canvas("the drawing area"),
          title: "Zoom about the pointer",
          text: "The mouse wheel zooms about wherever the pointer is, so the point you are looking at stays where it is.",
          perform: "Use the mouse wheel over the drawing area.",
          gesture: "scroll",
          action: { kind: "zoom", direction: "wheel" },
        },
        {
          target: control(CONTROLS.fit.id, CONTROLS.fit.label),
          title: "Fit the whole drawing",
          text: "Fit sets the zoom and pan so the whole drawing is visible. It changes nothing about the drawing itself.",
          perform: "Click the Fit button.",
          gesture: "click",
          action: { kind: "zoom", direction: "fit" },
        },
        {
          target: control(CONTROLS.statusBar.id, CONTROLS.statusBar.label),
          title: "Escape returns to Select",
          text: "Escape cancels the tool in progress and hands the canvas back to Select, leaving the view as it is.",
          perform: "Press Escape.",
          gesture: "press",
          action: { kind: "tool", tool: "select" },
        },
      ],
    },
    {
      id: "workspace-manage",
      title: "Select, inspect and remove an object",
      summary:
        "Select a line you drew, look at its properties, then delete it and bring it back with Undo.",
      prelude: {
        recipe: "line",
        what: "a line to work with",
      },
      steps: [
        {
          target: tool("select", "Select"),
          title: "Return to Select",
          text: "Select is the resting state of the editor, and the only tool that acts on work already drawn.",
          perform: "Click the Select tool.",
          gesture: "click",
          action: { kind: "tool", tool: "select" },
        },
        {
          target: control(CONTROLS.inspector.id, CONTROLS.inspector.label),
          title: "Select the line",
          text: "Clicking a feature selects it, and its properties appear in this inspector.",
          perform: "Click the line in the drawing area.",
          gesture: "click",
          action: { kind: "select", type: "line" },
        },
        {
          target: control(CONTROLS.featuresTab.id, CONTROLS.featuresTab.label),
          title: "Look at its properties",
          text: "The Features tab edits whatever is selected - its endpoints, length, angle and appearance.",
          perform: "Open the Features tab.",
          gesture: "click",
          action: { kind: "panel", panel: "features" },
        },
        {
          target: control(CONTROLS.featuresTab.id, CONTROLS.featuresTab.label),
          title: "Delete it",
          text: "Delete removes the selected features. It is one history entry, so it can be undone - from Edit, the quick-access Undo button, or Ctrl+Z.",
          perform: "Press Delete, or use Edit \u2192 Delete, to remove the selected line.",
          gesture: "press",
          action: { kind: "delete", type: "line" },
        },
        {
          target: control(CONTROLS.undo.id, CONTROLS.undo.label),
          title: "Bring it back",
          text: "Each command is one history entry. Undo steps it back; Redo steps it forward again.",
          perform: "Click Undo.",
          gesture: "click",
          action: { kind: "undo" },
        },
      ],
    },
  ],

  geometry: [
    {
      id: "geometry-draw-a-shape",
      title: "Draw a rectangle",
      summary:
        "Arm the Rectangle tool, draw one on the sheet, then change its line style - the whole loop of tool, work, property.",
      steps: [
        {
          target: category("GEOMETRY", "GEOMETRY"),
          title: "Open Geometry",
          text: "Geometry holds the primitives. Its tools are listed directly in the Tools panel.",
          perform: "Click GEOMETRY in the toolset row.",
          gesture: "click",
          action: { kind: "category", category: "GEOMETRY" },
        },
        {
          target: tool("rectangle", "Rectangle"),
          title: "Arm Rectangle",
          text: "The status line asks for the first corner once the tool is armed.",
          perform: "Click the Rectangle tool in the Tools panel.",
          gesture: "click",
          action: { kind: "tool", tool: "rectangle" },
        },
        {
          target: canvas("the drawing area"),
          title: "Draw the rectangle",
          text: "Click one corner, then the opposite corner - or drag from one corner to the other. Shift on the second click makes a square.",
          perform: "Draw a rectangle on the drawing area.",
          gesture: "drag",
          action: { kind: "create", type: "rectangle" },
        },
        {
          target: control(CONTROLS.featuresTab.id, CONTROLS.featuresTab.label),
          title: "Edit it in the inspector",
          text: "The new rectangle is selected. The Features tab lists its size, position and appearance.",
          perform: "Open the Features tab.",
          gesture: "click",
          action: { kind: "panel", panel: "features" },
        },
        {
          target: control(CONTROLS.lineType.id, CONTROLS.lineType.label),
          title: "Give it a dashed outline",
          text: "Line type in the quick-access strip applies to the selection, and is undoable. Its button opens the list of line styles.",
          perform: "Choose Dashed from the Line type list.",
          gesture: "click",
          action: { kind: "property", type: "rectangle", path: ["style", "lineType"], to: "dashed" },
        },
      ],
    },
    {
      id: "geometry-load-an-arc",
      title: "Draw an arc",
      summary:
        "An Arc has two construction methods. Choose one, then build the arc from the points it asks for.",
      steps: [
        {
          target: category("GEOMETRY", "GEOMETRY"),
          title: "Open Geometry",
          text: "The Arc tool lives in Geometry's tools, beside Line and Rectangle.",
          perform: "Click GEOMETRY in the toolset row.",
          gesture: "click",
          action: { kind: "category", category: "GEOMETRY" },
        },
        {
          target: tool("arc", "Arc"),
          title: "Arc has a menu",
          text: "The caret beside Arc means it offers two construction methods rather than arming immediately. Press it to see them.",
          perform: "Open the Arc tool's menu.",
          gesture: "click",
          action: { kind: "tool", tool: "arc" },
        },
        {
          target: tool("arc", "Arc"),
          title: "Centrepoint or three-point",
          text: "Centrepoint Arc asks for the centre, then the start and the end. 3-Point Arc asks for three points on the curve.",
          perform: "Choose Centrepoint Arc from the Arc menu.",
          gesture: "click",
          action: { kind: "tool", tool: "arc" },
        },
        {
          target: canvas("the drawing area"),
          title: "Place its points",
          text: "Click each point the method asks for. Snapping aligns them to existing geometry.",
          perform: "Draw an arc on the drawing area.",
          gesture: "click",
          action: { kind: "create", type: "arc", minLength: 20 },
        },
      ],
    },
  ],

  annotate: [
    {
      id: "annotate-a-dimension",
      title: "Place a dimension",
      summary:
        "Draw something to measure, then dimension it and hide the dimensions again - without deleting anything.",
      prelude: {
        recipe: "line",
        what: "a line to measure",
      },
      steps: [
        {
          target: category("ANNOTATE", "ANNOTATE"),
          title: "Open Annotate",
          text: "Annotate holds dimensions, text, callouts and tables, grouped by what each one does.",
          perform: "Click ANNOTATE in the toolset row.",
          gesture: "click",
          action: { kind: "category", category: "ANNOTATE" },
        },
        {
          target: tool("dimension", "Length"),
          title: "Arm Length",
          text: "The status line asks for the first dimension endpoint.",
          perform: "Click the Length tool.",
          gesture: "click",
          action: { kind: "tool", tool: "dimension" },
        },
        {
          target: canvas("the drawing area"),
          title: "Pick the two endpoints",
          text: "Click near each end of the line. Geometry under the pointer snaps, so the dimension lands exactly on it.",
          perform: "Dimension the line: click its two ends.",
          gesture: "click",
          action: { kind: "create", type: "dimension" },
        },
        {
          target: control(CONTROLS.dimensions.id, CONTROLS.dimensions.label),
          title: "Hide the dimensions",
          text: "This switch draws dimensions or hides them - it never deletes one, so turning it back on restores every dimension.",
          perform: "Click the Dimensions switch.",
          gesture: "click",
          action: { kind: "setting", group: "display", key: "showDimensions", to: false },
        },
      ],
    },
  ],

  statics: [
    {
      id: "statics-free-body",
      title: "Build a free-body diagram",
      summary:
        "A beam and a point load - the two features a first free-body diagram is made of.",
      steps: [
        {
          target: category("STATICS", "STATICS"),
          title: "Open Statics",
          text: "Statics is organised into Create, Analysis and Reference sections, inside a group of its own.",
          perform: "Click STATICS in the toolset row.",
          gesture: "click",
          action: { kind: "category", category: "STATICS" },
        },
        {
          target: tool("body", "Bodies"),
          title: "Open Bodies",
          text: "Bodies is a group. Pressing it opens the tools inside it in place, rather than arming anything itself.",
          perform: "Open the Bodies group, then arm the Beam tool inside it.",
          gesture: "click",
          action: { kind: "openGroup", group: "body", tool: "beam" },
        },
        {
          target: tool("beam", "Beam"),
          title: "Arm Beam",
          text: "A Beam is drawn between two points, and the status line says so.",
          perform: "Click the Beam tool.",
          gesture: "click",
          action: { kind: "tool", tool: "beam" },
        },
        {
          target: canvas("the drawing area"),
          title: "Draw the beam",
          text: "Click each end of the beam - or drag from one end to the other. It stays selected afterwards.",
          perform: "Draw a beam on the drawing area.",
          gesture: "drag",
          action: { kind: "create", type: "beam", minLength: 60 },
        },
        {
          target: tool("point-force", "Point Load"),
          title: "Add a point load",
          text: "Open Loads, then arm Point Load. The status line asks which body the force acts on.",
          perform: "Arm the Point Load tool, then click the beam.",
          gesture: "click",
          action: { kind: "create", type: "force" },
        },
      ],
    },
  ],

  dynamics: [],

  fluids: [
    {
      id: "fluids-draw-a-run",
      title: "Draw a pipe run",
      summary:
        "A run is drawn as a sequence of drags, and ends when you say it ends.",
      steps: [
        {
          target: category("FLUIDS", "FLUIDS"),
          title: "Open Fluids",
          text: "Fluids is organised like Statics: Selection, Create, Analysis and Reference.",
          perform: "Click FLUIDS in the toolset row.",
          gesture: "click",
          action: { kind: "category", category: "FLUIDS" },
        },
        {
          target: tool("fluids-flow-paths", "Flow Paths"),
          title: "Open Flow Paths",
          text: "The run and its fittings are grouped here. The group opens in place, listing the tools inside it.",
          perform: "Open the Flow Paths group, then arm Pipe / Duct.",
          gesture: "click",
          action: { kind: "openGroup", group: "fluids-flow-paths", tool: "pipe-duct" },
        },
        {
          target: tool("pipe-duct", "Pipe / Duct"),
          title: "Arm Pipe / Duct",
          text: "The status line asks for the start of the run.",
          perform: "Click the Pipe / Duct tool.",
          gesture: "click",
          action: { kind: "tool", tool: "pipe-duct" },
        },
        {
          target: canvas("the drawing area"),
          title: "Drag out each leg",
          text: "Press at the start of a leg and drag to its end. Repeat for the next leg; the tool stays armed between them.",
          perform: "Drag out a pipe leg on the drawing area.",
          gesture: "drag",
          action: { kind: "create", type: "pipe-duct" },
        },
        {
          target: control(CONTROLS.statusBar.id, CONTROLS.statusBar.label),
          title: "Finish the path",
          text: "Double-click or press Enter to end the run. Escape discards the leg in progress without writing anything.",
          perform: "Press Enter to finish the run.",
          gesture: "press",
          action: { kind: "finish" },
        },
      ],
    },
  ],

  thermodynamics: [],

  heat: [],

  solid: [],

  controls: [],

  math: [],
};

/*
 * ============================================================
 * THE GENERAL COMMANDS (Workspace & Navigation)
 * ============================================================
 *
 * These are not drawing tools, so they do not come from a toolset registry.
 * Each one names the real place it is reached from and is marked tutorial-ready
 * only where a highlight target genuinely exists.
 */
export const WORKSPACE_REFERENCE = [
  {
    id: "workspace-arrangement",
    title: "Window layout",
    where: "Always visible",
    purpose:
      "The header names the document and its unsaved state. Beneath it the menu bar holds the application's commands, and the toolset row chooses which drawing tools are shown.",
    usage: [
      "The Tools panel on the left lists the active toolset's tools, grouped by section.",
      "The drawing area in the middle is the sheet.",
      "The inspector on the right holds Objects (everything drawn), Features (the selection's properties) and Source (the drawing's LaTeX).",
      "The status bar along the bottom states what the armed tool wants next.",
    ],
    target: control(CONTROLS.toolsPanel.id, CONTROLS.toolsPanel.label),
  },
  {
    id: "workspace-grid",
    title: "Grid",
    where: "View menu and the quick-access strip",
    purpose:
      "The grid is drawn on the canvas behind the geometry as a guide to size and alignment.",
    usage: [
      "The Grid toggle shows or hides the grid lines.",
      "Showing the grid and snapping to it are separate settings: one does not turn the other on.",
    ],
    target: control(CONTROLS.grid.id, CONTROLS.grid.label),
  },
  {
    id: "workspace-snap",
    title: "Snapping",
    where:
      "The Snap toggle; detailed settings under Tools → Precision & Snapping",
    purpose:
      "While a tool is armed the pointer snaps to useful points on the drawing - endpoints, midpoints, centres and intersections - and the status line names what it found.",
    usage: [
      "The Snap toggle turns snapping on or off.",
      "Precision & Snapping sets the snap distance and which kinds of point are considered.",
    ],
    target: control(CONTROLS.snap.id, CONTROLS.snap.label),
  },
  {
    id: "workspace-zoom",
    title: "Zoom",
    where:
      "The zoom controls in the status bar; View → Zoom In / Zoom Out; the mouse wheel",
    purpose:
      "Changes how large the sheet is drawn, without changing the drawing itself.",
    usage: [
      "The wheel zooms about the pointer, so the point under the cursor stays put.",
      "The − and + buttons step the zoom, and the percentage field can be typed into.",
      "View → Zoom In and Zoom Out step the zoom about the centre of the view.",
    ],
    target: control(CONTROLS.zoomValue.id, CONTROLS.zoomValue.label),
  },
  {
    id: "workspace-pan",
    title: "Pan",
    where: "View → Pan; the Pan tool",
    purpose:
      "Moves the view across the sheet without moving anything that is drawn.",
    usage: [
      "Arm Pan from the View menu or the tool list, then drag the sheet.",
      "Escape returns to Select without changing the drawing or the view.",
    ],
    target: control(CONTROLS.statusBar.id, CONTROLS.statusBar.label),
  },
  {
    id: "workspace-fit",
    title: "Fit to view",
    where:
      "The Fit button in the quick-access strip; View → Fit to Screen; Ctrl+0",
    purpose:
      "Sets the zoom and pan so the whole drawing is visible. It is a one-shot command, not a switch.",
    usage: [
      "Fit does not change the drawing, the selection or the history.",
      "On a blank sheet it simply centres the view.",
    ],
    target: control(CONTROLS.fit.id, CONTROLS.fit.label),
  },
  {
    id: "workspace-select",
    title: "Selection",
    where: "The Select tool, offered first in every toolset",
    purpose:
      "Select is the resting state of the editor. It picks features, and it is the only tool that moves or edits work already drawn.",
    usage: [
      "Click a feature to select it; its properties appear in the Features tab.",
      "Escape from any tool returns to Select.",
    ],
    target: control(CONTROLS.inspector.id, CONTROLS.inspector.label),
  },
  {
    id: "workspace-multi-select",
    title: "Multi-selection",
    where: "The drawing area, with Select armed",
    purpose:
      "Selects several features at once so a command can act on all of them.",
    usage: [
      "Dragging on empty canvas draws a selection rectangle; everything it crosses is selected.",
      "Edit → Select All (Ctrl+A) selects every feature on the active sheet.",
      "The Features tab states when several features are selected together.",
    ],
    target: control(CONTROLS.inspector.id, CONTROLS.inspector.label),
  },
  {
    id: "workspace-copy",
    title: "Copy, cut and paste",
    where: "The Edit menu; Ctrl+C, Ctrl+X, Ctrl+V",
    purpose: "Moves or repeats features without redrawing them.",
    usage: [
      "Copy and Cut act on the current selection.",
      "Paste places a copy of what was copied.",
      "The clipboard belongs to the session, not to the document.",
    ],
    target: menu("edit", "Edit"),
  },
  {
    id: "workspace-delete",
    title: "Delete",
    where: "Edit → Delete; the Delete or Backspace key",
    purpose: "Removes the selected features from the sheet.",
    usage: [
      "Delete acts on the selection; with nothing selected it does nothing.",
      "Ctrl+Z (Undo) brings a deleted feature back.",
    ],
    target: menu("edit", "Edit"),
  },
  {
    id: "workspace-move",
    title: "Moving and nudging features",
    where: "Tools → Move; the arrow keys with a selection",
    purpose:
      "Repositions features. Features that depend on another - a dimension on a line, a components drawing on a force - follow it.",
    usage: [
      "Move arms a tool that drags the selection to a new place.",
      "The arrow keys nudge the selection one step at a time while the canvas has focus.",
    ],
    target: menu("tools", "Tools"),
  },
  {
    id: "workspace-mirror",
    title: "Mirror, rotate, trim and extend",
    where: "The Tools menu",
    purpose:
      "The modify tools. Each arms a tool, then the drawing area is used to define the mirror line, the angle, or the part to trim.",
    usage: [
      "Mirror reflects the selection about a line you draw.",
      "Rotate turns the selection about a point.",
      "Trim and Extend work on lines against boundaries you pick.",
    ],
    target: menu("tools", "Tools"),
  },
  {
    id: "workspace-order",
    title: "Draw order",
    where: "Tools → Bring to Front / Forward / Backward / Send to Back",
    purpose:
      "Changes what is painted on top of what. It is purely presentational: it does not change selection, hit testing or geometry.",
    usage: [
      "The commands act on the selection and are unavailable with nothing selected.",
      "A feature sent to the back can still be clicked.",
    ],
    target: menu("tools", "Tools"),
  },
  {
    id: "workspace-undo",
    title: "Undo and redo",
    where:
      "The Edit menu; the Undo and Redo buttons; Ctrl+Z, Ctrl+Y / Ctrl+Shift+Z",
    purpose:
      "Steps an edit back or forward. One edit is one history entry, however many objects the edit touched.",
    usage: [
      "Undo is greyed out when there is nothing to undo, and Redo when there is nothing to redo.",
      "A drag records one entry on release, not one per frame.",
    ],
    target: control(CONTROLS.undo.id, CONTROLS.undo.label),
  },
  {
    id: "workspace-shortcuts",
    title: "Keyboard shortcuts",
    where: "Tools → Keyboard Shortcuts…",
    purpose: "The keys that are actually bound, listed by the application.",
    usage: [
      "Ctrl+N New, Ctrl+S Save, Ctrl+Shift+S Save As, Ctrl+Shift+P Print.",
      "Ctrl+Z Undo, Ctrl+Y Redo, Ctrl+C Copy, Ctrl+X Cut, Ctrl+V Paste, Ctrl+A Select All.",
      "Ctrl+0 Fit to screen; Ctrl+K focuses Command Search; Ctrl+Shift+F formats the source.",
      "Escape cancels what is in progress; Enter finishes a construction; Delete or Backspace removes the selection; the arrow keys nudge it.",
      "A tool with a letter beside it in the Tools panel is armed by pressing that letter.",
    ],
    target: control(CONTROLS.commandSearch.id, CONTROLS.commandSearch.label),
  },
  {
    id: "workspace-command-search",
    title: "Command Search",
    where: "The search field at the left of the quick-access strip; Ctrl+K",
    purpose:
      "Finds any tool, menu command, panel or feature by name and runs it, so a command does not have to be found in its menu first.",
    usage: [
      "Results are the application's own commands, so choosing one does exactly what the menu item does.",
      "A result that cannot run right now says why.",
    ],
    target: control(CONTROLS.commandSearch.id, CONTROLS.commandSearch.label),
  },
  {
    id: "workspace-properties",
    title: "Line thickness, colour and line type",
    where: "The quick-access strip",
    purpose:
      "The three drawing properties applied to newly drawn features, and editable on a selection in the Features tab.",
    usage: [
      "Each control shows the current value and is also reachable with the keyboard.",
      "With a selection, a change applies to what is selected and is undoable.",
    ],
    target: control(CONTROLS.thickness.id, CONTROLS.thickness.label),
  },
  {
    id: "workspace-display",
    title: "Dimensions and magnitudes",
    where: "The quick-access strip; View menu",
    purpose:
      "Two independent display switches. Dimensions shows or hides dimension annotations; Magnitudes shows or hides the values written beside arrows.",
    usage: [
      "Hiding is by not drawing, so nothing is deleted - turning the switch back on restores everything exactly as it was.",
      "They are independent, so magnitudes can be hidden while dimensions stay on.",
    ],
    target: control(CONTROLS.magnitudes.id, CONTROLS.magnitudes.label),
  },
  {
    id: "workspace-sheets",
    title: "Sheets",
    where: "The sheet bar beneath the drawing area",
    purpose:
      "A document contains sheets, and each sheet holds its own objects. The editor always shows one sheet at a time.",
    usage: [
      "Switching sheets changes which objects are on screen; the drawing itself is unchanged.",
      "Select All and other selection commands act only on the active sheet.",
    ],
    target: control(CONTROLS.objectsTab.id, CONTROLS.objectsTab.label),
  },
  {
    id: "workspace-objects",
    title: "Objects and Features",
    where: "The inspector's Objects and Features tabs",
    purpose:
      "Objects lists everything drawn on the sheet and selects it; Features edits the properties of whatever is selected.",
    usage: [
      "Clicking a row in Objects selects that feature.",
      "Features is empty until something is selected - that is the honest state, not an error.",
    ],
    target: control(CONTROLS.objectsTab.id, CONTROLS.objectsTab.label),
  },
  {
    id: "workspace-source",
    title: "The Source tab",
    where: "The inspector's Source tab; Tools → Format Source",
    purpose:
      "The drawing's own LaTeX, editable directly. Changes to the source update the drawing.",
    usage: [
      "The footer states whether the source is up to date and reports any diagnostics.",
      "Ctrl+Shift+F formats the source.",
    ],
    target: control(CONTROLS.sourceTab.id, CONTROLS.sourceTab.label),
  },
  {
    id: "workspace-help",
    title: "Help, settings and About",
    where: "The Help and Tools menus",
    purpose:
      "Help → User Guide opens this guide. Help → Drawing Help, Report a Problem / Feedback and About DAETUM are the other help entries. Tools → Drawing Settings, Precision & Snapping, Measurement & Inspection and Keyboard Shortcuts are the settings pages.",
    usage: [
      "The guide opens over the current drawing and closes back to it unchanged.",
    ],
    target: menu("help", "Help"),
  },
];

/*
 * ============================================================
 * THE TOOL REFERENCE NOTES
 * ============================================================
 *
 * Keyed by the tool id the toolbar uses, so an entry here is attached to that
 * tool or to nothing at all - it can never become a listing of its own. The
 * NAME, the GROUP, the SHORTCUT and the OPENING INSTRUCTION are added by the
 * view from the live registry; an entry below adds only what the registry
 * cannot know, and skips any field it has nothing true to say about.
 *
 *   context    what the tool's clicks are aimed at (a body, a reference, empty space)
 *   usage      the steps after the first click, in the order they happen
 *   properties what the Features tab offers for the feature it makes
 *   handles    the grips drawn on the selected feature and what each one does
 *   tips       the one or two things that are easy to get wrong
 *
 * A TOOL WITH NO ENTRY IS STILL LISTED, with a clear "not yet documented" note.
 * That is deliberate: a reference that described a tool nobody had checked
 * would be worse than one that says plainly it is not written yet, because the
 * student would trust it and the object on the sheet would not match.
 */
export const TOOL_NOTES = {
  /* ------------------------------------------------------- Geometry */
  point: {
    usage:
      "Click anywhere on the sheet to place a point. The tool stays armed, so several can be placed in a row.",
    tips: [
      "A point is a feature in its own right: it can be selected, moved and dimensioned to.",
    ],
  },
  line: {
    usage:
      "Click the start, then the end - or press at the start and drag. The line stays selected so its properties open.",
    properties:
      "Endpoints, length, angle, the line weight, colour and line type.",
    handles:
      "Grips at each end move that end independently; the body of the line moves the whole line.",
    tips: [
      "While a tool is armed the pointer snaps to endpoints and midpoints; the status line names the snap.",
    ],
  },
  triangle: {
    usage:
      "Click the first corner, then the next, then the last. The third click closes the triangle.",
    properties: "The three vertices, its line style and its name.",
    handles: "One grip per vertex.",
  },
  rectangle: {
    usage:
      "Click one corner, then the opposite corner - or drag from one corner to the other.",
    properties:
      "Width, height, position and corner radius where it is offered; plus its line style.",
    handles: "Corner grips resize it; the edge grips resize one side.",
    tips: ["Holding Shift on the second click makes it a square."],
  },
  circle: {
    usage:
      "Click the centre, then a point on the circumference - or drag out from the centre.",
    properties: "Centre, radius and the line style.",
    handles:
      "The centre grip moves the circle; the radius grip changes its size.",
  },
  arc: {
    usage:
      "Pick a construction method (Centrepoint or 3-Point), then click the points it asks for. The status line names each one.",
    properties: "Centre, radius, start and end angles, and the line style.",
    handles: "Grips at the centre and at each end of the arc.",
  },
  polygon: {
    usage:
      "Choose By Sides or By Centre, then click where the polygon should sit. A prompt asks for the number of sides.",
    properties:
      "Centre, radius, side count, rotation and the line style.",
    handles: "The centre grip moves it; the radius grip resizes it.",
    tips: ["The number of sides must be 3 or more."],
  },
  "freeform-polygon": {
    usage:
      "Click each vertex in turn. Double-click or press Enter to close the outline; Backspace takes back the last vertex.",
    properties: "Its vertices and the line style.",
    handles: "One grip per vertex.",
    tips: [
      "While placing vertices, Backspace removes the last one rather than deleting a selected feature.",
    ],
  },
  "coordinate-system": {
    usage:
      "Drag out the area for the axes: the width sets the X direction and the height sets Y.",
    properties: "The origin, the two axis directions and the axis labels.",
    handles:
      "The centre grip moves the axes; the corner grips resize them.",
  },

  /* ------------------------------------------------------- Annotate */
  dimension: {
    usage:
      "Pick the two references to measure. Geometry under the pointer snaps, so a click lands exactly on it. D or Tab changes what the dimension measures.",
    properties:
      "The measured value (which can be replaced with any text or symbol you type), its placement and its text size.",
    handles:
      "A grip on the dimension line moves where the value is written, without changing what is measured.",
    tips: [
      "A dimension measures the geometry it points at and follows it: move the geometry and the number follows.",
      "Double-clicking a dimension opens its value box - it never asks about scale. A dimension reads the drawing; it never resizes what it measures.",
      "View → Hide Dimensions stops them being drawn without deleting them.",
    ],
  },
  angle: {
    usage:
      "Pick the first line or edge, then the second. The angle between them is measured.",
    properties: "The measured angle and where its text sits.",
    tips: [
      "Like a length dimension, its text can be replaced with any value or symbol.",
    ],
  },
  note: {
    usage:
      "Click empty space to place a text box and type into it, or click a feature to attach writing to it. Enter ends the line.",
    properties: "The text, its size, alignment and where it sits.",
    tips: [
      "With a note selected, Enter opens it for typing rather than creating another one.",
    ],
  },
  label: {
    usage:
      "Click the feature the label belongs to; the label is attached to it.",
    properties: "The label text and where it hangs off its feature.",
    tips: [
      "A label belongs to what it names - move the feature and the label goes with it.",
    ],
  },
  leader: {
    usage:
      "Click the feature to point at, then where the text should sit.",
    properties: "The leader's endpoints and its text.",
    handles:
      "The grip at the text end moves the writing; the point end stays on what it points at.",
  },
  callout: {
    usage:
      "Click the feature to point at, then drag or click to place the bubble. Clicking again places its next point.",
    properties:
      "The bubble's position, its text and the arrowhead at the pointed end.",
    handles:
      "The bubble grip moves the callout; the shoulder grip moves the bend.",
  },
  symbol: {
    usage:
      "Click where the symbol should go, then choose it from the symbol list.",
    properties: "The chosen glyph, its size and its position.",
  },
  table: {
    usage:
      "Choose the number of rows and columns, then click where the table should sit.",
    properties:
      "The cell contents, the column widths and the table's position.",
    tips: ["The same size grid is offered by Insert → Table."],
  },

  /* ------------------------------------------------------- Statics */
  particle: {
    usage:
      "Click to place the particle. It is a single point a free-body diagram can be built around.",
    properties: "Position, its label and its appearance.",
    handles: [
      "A grip at the particle moves it. Features attached to it move with it.",
    ],
  },
  "rigid-body": {
    usage:
      "Drag out the body's extent - or click one corner and then the opposite one.",
    properties: "Size, position, rotation and the line style.",
    handles: ["Corner grips resize the body; the rotation grip turns it."],
  },
  beam: {
    usage:
      "Click each end of the beam - or press at one end and drag to the other. The beam stays selected afterwards.",
    properties: "Its endpoints, length, depth and line style.",
    handles: [
      "The end grips extend or shorten the beam; supports and analysis diagrams attached to it follow.",
      "The body grip moves the whole beam, taking everything attached with it.",
    ],
    tips: [
      "A diagram drawn on this beam keeps its place on the beam when the beam's length changes.",
    ],
  },
  truss: {
    usage:
      "Click the first joint, then each further joint. Enter finishes the structure; Escape throws the construction away.",
    properties: "Its joints, members, and the line style.",
    handles: [
      "A grip per joint moves that joint and every member meeting there.",
    ],
    tips: [
      "Escape discards the whole truss in progress, leaving the tool armed for another attempt.",
    ],
  },
  cable: {
    usage: "Click the two points the cable spans - or drag between them.",
    properties: "Its two ends and the line style.",
    handles: ["Grips at each end."],
  },
  "point-force": {
    usage:
      "Choose the body the force acts on, then click where it is applied (or drag out its length).",
    properties:
      "Its magnitude, angle, unit and application point. The arrow's drawn length and its stated value are separate facts.",
    handles: [
      "The arrow's tip grip re-aims and re-sizes the arrow; the tail grip moves where it is applied.",
    ],
    tips: [
      "The arrow is as long as you draw it; its value - 20 N, 5 kN/m - is the label beside it, shown or hidden by the Magnitudes switch.",
      "Changing the value never changes the drawn length, and dragging the arrow never changes the value.",
    ],
  },
  "distributed-load": {
    usage:
      "Choose the body it loads, then drag along the span the load covers.",
    properties: "The span, the load's magnitude and unit, and its intensity.",
    handles: ["Grips at each end of the span."],
    tips: [
      "Escape mid-way discards the load being built and leaves the tool armed.",
    ],
  },
  "varying-distributed-load": {
    usage:
      "Choose the body, then drag along the span and set the two end intensities.",
    properties: "The span, and the value at each end of it.",
    handles: ["End grips; the height grips set each end's intensity."],
  },
  moment: {
    usage:
      "Choose the body, then click the point the moment is applied at; the arrow is sized by the pointer afterwards.",
    properties: "Its magnitude, its unit and its direction of rotation.",
    handles: [
      "The arc's grip changes the moment's size; the centre grip moves its point of application.",
    ],
  },
  "pin-support": {
    usage: "Choose the body to prop, then click the location along it.",
    properties: "Its position along the member and its orientation.",
    handles: ["The support slides along the member it is attached to."],
  },
  "roller-support": {
    usage: "Choose the body to prop, then click the location along it.",
    properties: "Its position along the member and its orientation.",
    handles: ["The support slides along the member it is attached to."],
  },
  "fixed-support": {
    usage: "Choose the body, then click the end that is fixed.",
    properties: "Its position and orientation.",
  },
  "smooth-support": {
    usage: "Choose the body, then click the location along it.",
    properties: "Its position along the member and its orientation.",
  },
  "pin-connection": {
    usage: "Click the two members to connect with a pin.",
    properties: "Its location and orientation.",
  },
  "fixed-connection": {
    usage: "Click the two members to connect rigidly.",
    properties: "Its location and orientation.",
  },
  "slider-connection": {
    usage: "Click the two members to connect with a slider.",
    properties: "Its location, its orientation and its travel.",
  },
  resultant: {
    usage:
      "Click the forces the resultant should sum. It reads the forces you have already drawn and draws their sum.",
    context: "Forces already on the sheet.",
    tips: [
      "It follows its first force, and updates whenever a force it reads is edited.",
      "It draws a vector; it does not report an answer, and nothing in the drawing is solved.",
    ],
  },
  "force-components": {
    usage:
      "Draw a Point Load first, then click that arrow: its horizontal and vertical components are shown.",
    context: "A force already on the sheet.",
    tips: [
      "It follows the force's magnitude, direction and position, so it stays correct as the force is edited.",
    ],
  },
  "shear-force-diagram": {
    usage:
      "Sketch it yourself, or choose Plot and type the equations. First click the member the diagram belongs to, then drag the frame.",
    context: "A member the diagram is drawn against.",
    handles: [
      "End grips stretch the diagram along its member; the body grip moves the frame.",
    ],
    tips: [
      "The diagram follows the member: lengthen the member and the frame lengthens with it.",
      "It is the student's own working drawn on the sheet - DAETUM does not derive the diagram.",
    ],
  },
  "bending-moment-diagram": {
    usage:
      "Sketch it or choose Plot, then click the member and drag the frame.",
    context: "A member the diagram is drawn against.",
    handles: ["End grips stretch the diagram; the body grip moves the frame."],
    tips: [
      "It follows its member's length, exactly as a shear diagram does.",
    ],
  },
  "axial-force-diagram": {
    usage: "Sketch it or choose Plot, then click the member and drag the frame.",
    context: "A member the diagram is drawn against.",
    handles: ["End grips stretch the diagram; the body grip moves the frame."],
    tips: [
      "It follows its member's length, exactly as a shear diagram does.",
    ],
  },
  "reference-point": {
    usage:
      "Click to place a point that is construction rather than final geometry.",
    tips: [
      "Reference geometry is drawn in the construction line type so it reads as a working aid.",
    ],
  },
  "reference-line": {
    usage: "Click its two ends - or drag between them.",
    tips: [
      "It is ordinary line geometry drawn in the construction style; it snaps and is edited like a line.",
    ],
  },
  "reference-arc": {
    usage: "Pick a construction method, then click the points it asks for.",
    tips: [
      "It behaves exactly like an Arc while being built and edited; only the finished feature differs - it is construction geometry.",
    ],
  },

  /* ------------------------------------------------------- Dynamics */
  "dynamics-particle": {
    usage: "Click to place the particle.",
    properties: "Its position and its label.",
  },
  "dynamics-rigid-body": {
    usage: "Drag out the body's extent.",
    properties: "Size, position and rotation.",
    handles: ["Corner grips resize; the rotation grip turns it."],
  },
  "dynamics-polar-vector": {
    usage:
      "Press at the tail and drag to the head. The status line reads out magnitude and angle while you drag.",
    properties: "Its magnitude, angle and unit.",
    handles: [
      "The head grip re-aims and re-sizes it; the tail grip moves it.",
    ],
    tips: [
      "Dragging changes the drawn vector; a typed magnitude is a stated value and does not change what is drawn.",
    ],
  },

  /* ------------------------------------------------------- Fluids */
  "pipe-duct": {
    usage:
      "Drag out each straight leg from its start to its end. The tool stays armed between legs; double-click or Enter finishes the path.",
    properties: "Its segments, their joints and the line style.",
    handles: [
      "A grip per joint moves that corner and both legs meeting it.",
    ],
    tips: [
      "Escape discards the leg in progress, so no ghost geometry is left behind.",
      "A supported corner generates an elbow, which is the same fitting the Elbow tool places.",
    ],
  },
  elbow: {
    usage: "Press at the elbow's corner and drag to set its size.",
    properties: "Its centre, its radius and its orientation.",
    tips: [
      "An elbow drawn by hand and one generated at a pipe corner are the same feature, with the same editing.",
    ],
  },
  junction: {
    usage:
      "Press to place the hub, then drag to set the main run. The distance is not stored; the branches are what make it.",
    properties: "Its branches and their connections.",
  },
  "flow-arrow": {
    usage:
      "Press at the tail and drag to the tip to draw a free arrow - or press on a pipe to give that run a flow direction.",
    properties:
      "Its direction, its stated value and whether it is attached to a run.",
    handles: ["The tip grip re-aims it; the tail grip moves it."],
  },
  "reservoir-tank": {
    usage: "Drag out the vessel's box from one corner to the opposite one.",
    properties: "Its size, its position and its level.",
    handles: ["Corner grips resize the vessel."],
  },
  "flow-direction-diagram": {
    usage:
      "Drag out the frame, then draw the route and its arrows inside it.",
    properties: "Its frame, the arrows drawn in it and its axis labels.",
  },
  "flow-profile": {
    usage:
      "Drag out the plotting frame, then draw the flow curve and its stations.",
    properties:
      "Its axes, the curve drawn in it and the values stated at each station.",
  },
  "pressure-profile": {
    usage:
      "Drag out the plotting frame, then plot the student's own numbers along it.",
    properties: "Its axes, the plotted points and the curve between them.",
  },
  "section-plane": {
    usage:
      "Drag out the trace across the run, then set the viewing direction.",
    properties: "The trace's ends and the two direction arrows.",
    handles: ["A grip at each end of the trace."],
  },

  /* ------------------------------------------------------- Thermodynamics */
  tank: {
    usage:
      "Press at one corner and drag to the opposite corner to draw a closed tank.",
    properties: "Its size, its position and its rotation.",
    handles: ["Corner grips resize the tank; the rotation grip turns it."],
  },
  "control-volume": {
    usage: "Press at one corner and drag to the opposite corner.",
    properties:
      "Its extent - width and height read in Features as numbers or symbols.",
    handles: ["Corner grips resize the control volume."],
  },
  "piston-cylinder": {
    usage:
      "Press and drag to draw the cylinder; the piston's height is adjusted afterwards.",
    properties:
      "Its size, its position and the piston's height, each of which can be a number or a symbol.",
    handles: [
      "The centre dot adjusts the piston height; the corner grips resize the cylinder.",
    ],
    tips: [
      "Piston Cylinder has a second form - Piston Cylinder With Stoppers - offered from its menu; the stoppers' heights are dragged in the same way.",
    ],
  },
  "turbine-compressor": {
    usage:
      "Press at one corner and drag to the opposite one to draw the casing.",
    properties: "Its size, position and rotation.",
    handles: ["Corner grips resize it; the rotation grip turns it."],
  },
  "nozzle-diffuser": {
    usage: "Press at one corner and drag to the opposite one.",
    properties: "Its size, position and rotation.",
    handles: ["Corner grips resize it."],
  },
  "rankine-cycle": {
    usage:
      "Press at one corner and drag to the opposite one to place the cycle schematic.",
    properties: "The cycle's state points and the axes it is drawn on.",
  },
  "thermodynamic-cycles": {
    usage:
      "The cycle tools each place a schematic: Rankine, Reheat Rankine, Brayton, Otto, Diesel, Carnot and the vapour-compression refrigeration cycle. Choose the cycle from the group, then drag out its frame.",
    properties: "The cycle's state points and its axes.",
    tips: [
      "These draw a schematic for the student's own solution; DAETUM does not compute the cycle.",
    ],
  },
  "process-diagrams": {
    usage:
      "Choose a diagram - a Process Plot or a Saturation Curve - then drag out its frame and use the corner dots to resize it.",
    properties: "Its axes and their labels.",
    handles: ["The corner dots resize the frame and edit the axis labels."],
  },
  "process-path": {
    usage:
      "Click inside a process diagram to place the first process state, then each further state.",
    context: "A process diagram already on the sheet.",
  },
  "constant-temp-pressure-lines": {
    usage:
      "Click points on a process diagram to draw the line; Enter finishes it.",
    context: "A process diagram already on the sheet.",
  },
  work: {
    usage:
      "The Work group places arrows for work: a plain Work Arrow, Electric Work or Mechanical Work. Choose the one you mean, then press and drag.",
    properties: "The arrow's direction and its stated value.",
  },
  "heat-transfer": {
    usage:
      "Heat Entering and Heat Leaving place a heat arrow in the direction chosen.",
    properties: "The arrow's direction and its stated value.",
  },

  /* ------------------------------------------------------- Heat Transfer */
  "thermal-region": {
    usage: "Drag to draw the region.",
    properties:
      "Its extent, its position and the temperatures stated in it.",
    handles: ["Corner grips resize the region."],
  },
  "wall-slab": {
    usage: "Drag along the wall to draw it.",
    properties:
      "Its thickness, its properties and the temperatures on each face.",
    handles: [
      "End grips extend the wall along its line; the width grips set its thickness.",
    ],
  },
  "composite-wall": {
    usage: "Drag to draw the composite wall; widen it to add layers.",
    properties: "Its layers, each with its own thickness and properties.",
    handles: [
      "The layer dividers can be dragged to redistribute the layers' thickness.",
    ],
  },
  fin: {
    usage: "Click the base, then drag out the fin.",
    properties: "Its base, height, spacing and count.",
    handles: [
      "The height grip changes the fin's length; the base grip moves it.",
    ],
  },
  "conduction-path": {
    usage: "Click the start, click more points, Enter to finish.",
    handles: [
      "One grip per point; the points can be re-placed without redrawing the path.",
    ],
  },
  "convection-flow": {
    usage:
      "Click the start and the control points of the flow, Enter to finish.",
    handles: ["One grip per point."],
  },
  "radiation-path": {
    usage: "Click the start, then the end of the radiation path.",
    handles: ["A grip at each end."],
  },
  "heat-transfer-rate": {
    usage:
      "Drag to draw the arrow; its stated value is the rate.",
    properties: "Its direction, its value and its unit.",
    handles: ["The tip grip re-aims it; the tail grip moves it."],
  },
  "heat-flux": {
    usage: "Drag to draw the arrow; its stated value is the flux.",
    properties: "Its direction, its value and its unit.",
    handles: ["The tip grip re-aims it; the tail grip moves it."],
    tips: [
      "A flux on a surface is this arrow snapped to the boundary - it reuses the arrow's own geometry and label.",
    ],
  },
  "thermal-boundary": {
    usage:
      "The boundary tools - Fixed Temperature, Convection, Radiation and Adiabatic / Insulated - share one gesture: drag to draw the boundary segment. The variant decides the symbols drawn along it.",
    properties:
      "The boundary's ends, the condition it states and its symbols.",
    handles: ["A grip at each end of the boundary."],
    tips: [
      "Switching the variant replaces the symbol set rather than drawing a second set over the first.",
    ],
  },
  "thermal-contact": {
    usage: "Drag to draw the interface between the two bodies.",
    handles: ["A grip at each end."],
  },
  "heat-source": {
    usage: "Click to place the source.",
    properties: "Its stated rate and its position.",
  },
  "heat-sink": {
    usage: "Click to place the sink.",
    properties: "Its stated rate and its position.",
  },
  "thermal-circuit-node": {
    usage: "Click to place the node.",
  },
  "thermal-resistance": {
    usage:
      "Click to place the resistance; it draws two connection ports.",
    properties: "Its stated resistance and its orientation.",
  },
  "thermal-capacitance": {
    usage:
      "Click to place the capacitance; it draws two connection ports.",
    properties: "Its stated capacitance and its orientation.",
  },
  "temperature-marker": {
    usage: "Click to place the marker.",
    properties: "Its stated temperature and its position.",
  },
  isotherm: {
    usage: "Click points to draw the isotherm; Enter finishes it.",
    handles: ["One grip per point."],
  },
  "control-volume-boundary": {
    usage: "Drag to draw the control volume boundary.",
    handles: ["Corner grips resize it."],
  },
  "temperature-profile": {
    usage:
      "Drag to draw the graph's frame; the vertical axis is temperature.",
    properties: "Its axes, the curve drawn in it and its values.",
    tips: [
      "It is the application's own graph tool with a Heat Transfer preset - not a second plotting engine.",
    ],
  },

  /* ------------------------------------------------------- Solid Mechanics */
  "stress-element": {
    usage:
      "Drag opposite corners to draw a square stress element.",
    properties: "Its rotation, its size and the stress components shown.",
    handles: [
      "The rotation handle turns the element; the corner grips size it.",
    ],
    tips: ["The angle can also be typed into the Features panel."],
  },
  "boundary-stress": {
    usage:
      "Drag out a plate, set its width and height in Features, then enter the edge equations such as x/a or y/b.",
    properties:
      "Width and height - each a number or a symbol - and the equation for each edge.",
    handles: ["Corner grips resize the plate."],
    tips: [
      "Symbolic dimensions are drawn to a schematic scale, so a plate with symbolic sizes is a diagram rather than a to-scale drawing.",
    ],
  },

  /* ------------------------------------------------------- Controls */
  plant: {
    usage:
      "Press to place the plant (or drag out its extent), then set its transfer function.",
    properties: "Its transfer function, its size and position.",
  },
  block: {
    usage:
      "Press to place the block (or drag out its extent), then set its transfer function.",
    properties: "Its transfer function, its size and position.",
  },
  gain: {
    usage: "Click to place the gain block, then set its value.",
    properties: "Its gain and its position.",
  },
  sum: {
    usage:
      "Click to place the summing junction, then set the sign of each input.",
    properties: "Each input's sign and its position.",
  },
  "signal-line": {
    usage:
      "Click an output node to start a signal line, then click each further point; Enter finishes it.",
    properties: "Its points and the arrowhead at its end.",
    handles: ["One grip per point."],
    tips: [
      "The first click must be on a node of a block - the status line asks for an output node.",
    ],
  },

  /* ------------------------------------------------------- Math / Analysis */
  "math-point": {
    usage: "Click to place a point on the sheet.",
  },
  "math-vector": {
    usage:
      "Press at the tail and drag to the head - or click each end.",
    properties: "Its magnitude and direction, read from its two ends.",
    handles: ["The head grip re-aims it; the tail grip moves it."],
  },
  "math-plot": {
    usage:
      "Sketch mode: draw the graph's axes, lines and curves, then Apply. Plot mode: drag out the graph's frame, then add the expressions for DAETUM to draw.",
    properties:
      "The graph's axes, its limits and the expressions or strokes drawn in it.",
    notes:
      "The tool is called Graph in the Tools panel; Sketch and Plot are the two ways of making it, offered from its menu.",
  },
  "math-equation": {
    usage: "Click where the equation should sit, then type it.",
    properties: "The equation's text and its type size.",
  },
  "math-tangent": {
    usage:
      "Click the curve to place the construction on. Tangent / Normal derives the tangent and the normal at that point.",
    context: "A curve already drawn.",
  },
  "math-slope-triangle": {
    usage:
      "Click a straight line, then click the two positions along it that define the triangle.",
    context: "A straight line already drawn.",
  },
};

/*
 * The tutorials a section really offers, and how many steps each has. A
 * tutorial with no steps is not offered - a walkthrough with nothing to walk
 * through would be a promise the guide cannot keep.
 */
export function tutorialsFor(sectionId) {
  return (TUTORIALS[sectionId] || []).filter(
    (tutorial) =>
      Array.isArray(tutorial.steps) && tutorial.steps.length > 0,
  );
}

export function tutorialCountFor(sectionId) {
  return tutorialsFor(sectionId).length;
}

export default {
  SECTIONS,
  TUTORIALS,
  TOOL_NOTES,
  WORKSPACE_REFERENCE,
  CONTROLS,
  GUIDE_TARGETS,
  sectionById,
  tutorialsFor,
  tutorialCountFor,
};
