/*
 * The editor's DOM elements, looked up once.
 */

const dom = globalThis.document;

export const toolHeading = dom?.getElementById("drawingToolHeading");

export const toolList = dom?.getElementById("drawingToolList");

export const drawingCanvas = dom?.querySelector(".drawing-canvas");

/*
 * THE CANVAS'S INTERACTION SURFACE.
 *
 * The pointer wiring lives on the `.drawing-canvas-area` wrapper rather than on
 * the rendered sheet itself, because the multi-touch gestures (two-finger pan
 * and pinch) must be recognised even when a finger lands on the margin around
 * the sheet. The events BUBBLE up from the canvas, so every existing handler
 * still sees exactly the event it saw before - this only widens where a
 * gesture may begin.
 */
export const drawingCanvasArea = dom?.querySelector(".drawing-canvas-area");

export const drawingCoordinates = dom?.getElementById("drawingCoordinates");

export const drawingZoomValue = dom?.getElementById("drawingZoomValue");

export const drawingZoomOut = dom?.getElementById("drawingZoomOut");

export const drawingZoomIn = dom?.getElementById("drawingZoomIn");

export const drawingGridToggle = dom?.getElementById("drawingGridToggle");

export const drawingSnapToggle = dom?.getElementById("drawingSnapToggle");

/*
 * THE DISPLAY SETTINGS, beside Grid and Snap.
 *
 * UNITS IS NOT ONE OF THEM.
 *
 * There used to be a `Show Units` control here, and the dimension editor had a
 * per-dimension flag behind it as well - two switches that could both produce a
 * bare `500` where the answer is `500 mm`. A unit is part of what a number
 * MEANS rather than decoration laid over it: `100` is not a force without an N
 * and `500` is not a length without an mm, so hiding one leaves the value on
 * the sheet wrong rather than plainer.
 *
 * The remaining two are visibility controls and stay: Show Dimensions hides
 * annotations the student placed without touching any measurement, and Show
 * Magnitudes does the same for force, load and moment values.
 *
 * They are read from the page rather than created here, so that the
 * toolbar owns what the toolbar shows and this module only reacts to it.
 */
export const drawingDisplayToggles = [
    {
        id: "drawingDimensionsToggle",
        key: "showDimensions"
    },
    {
        id: "drawingMagnitudesToggle",
        key: "showMagnitudes"
    }
].map(entry => ({
    ...entry,
    button: dom?.getElementById(entry.id)
}));

export const drawingToolMessage = dom?.getElementById("drawingToolMessage");

export const drawingUndo = dom?.getElementById("drawingUndo");

export const drawingRedo = dom?.getElementById("drawingRedo");

export const drawingThickness = dom?.getElementById("drawingThickness");

export const drawingColor = dom?.getElementById("drawingColor");

export const drawingLineType = dom?.getElementById("drawingLineType");

/*
 * SPECIAL SYMBOLS, in the quick-access style strip beside Line Type. It opens
 * the Symbols list the Annotate category uses; see workspace-controls.js.
 */
export const drawingSpecialSymbols = dom?.getElementById("drawingSpecialSymbols");

export const drawingToolPanelToggle = dom?.getElementById("drawingToolPanelToggle");

export const drawingFeaturesPanelToggle = dom?.getElementById("drawingFeaturesPanelToggle");

/*
 * THE TOP BAR'S HIDE / SHOW PAIR.
 *
 * `headerHideButton` lives in the header and `drawingTopBarShow` on the
 * canvas, and they are the two halves of ONE state: while the bar is shown
 * the Hide button is present and the Show button is hidden, and while the
 * bar is hidden it is the other way round. Keeping both refs here lets the
 * workspace layout flip them together.
 */
export const headerHideButton = dom?.getElementById("headerHideButton");

/*
 * THE SHARED TOP RAIL - the menu bar stacked over the toolset bar, in one
 * horizontally scrolling area. It is one element so the two bars have ONE
 * scroll offset and cannot drift apart; see `.drawing-top-rail` in
 * workspace-chrome.css.
 */
export const drawingTopRail = dom?.getElementById("drawingTopRail");

export const drawingTopBarShow = dom?.getElementById("drawingTopBarShow");
