/*
 * The editor's DOM elements, looked up once.
 */

export const toolHeading = document.getElementById("drawingToolHeading");

export const toolList = document.getElementById("drawingToolList");

export const drawingCanvas = document.querySelector(".drawing-canvas");

export const drawingCoordinates = document.getElementById("drawingCoordinates");

export const drawingZoomValue = document.getElementById("drawingZoomValue");

export const drawingZoomOut = document.getElementById("drawingZoomOut");

export const drawingZoomIn = document.getElementById("drawingZoomIn");

export const drawingGridToggle = document.getElementById("drawingGridToggle");

export const drawingSnapToggle = document.getElementById("drawingSnapToggle");

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
    button: document.getElementById(entry.id)
}));

/*
 * THE GLOBAL VECTOR SCALE.
 *
 * One setting that decides how large every force and load arrow is DRAWN. It
 * lives on the top toolbar beside Magnitudes, because both are display controls
 * for the same arrows - Magnitudes hides their values, this sizes their vectors.
 *
 * It is a property of the SHEET, not of any one force, so there is deliberately
 * no copy of it inside a feature's own panel: a feature that carried its own
 * scale would draw at a size the rest of the sheet did not share.
 *
 * The SELECT carries the decades and the practical multipliers, with a CUSTOM
 * entry at the end; the FIELD beside it is shown only while Custom is chosen,
 * for a value the list does not carry.
 */
export const drawingVectorScale = document.getElementById("drawingVectorScale");

export const drawingVectorScaleCustom = document.getElementById(
    "drawingVectorScaleCustom"
);

export const drawingProperties = document.getElementById("drawingProperties");

export const drawingToolMessage = document.getElementById("drawingToolMessage");

export const drawingComponentsBack = document.getElementById("drawingFeaturesBack");

export const drawingUndo = document.getElementById("drawingUndo");

export const drawingRedo = document.getElementById("drawingRedo");

export const drawingThickness = document.getElementById("drawingThickness");

export const drawingColor = document.getElementById("drawingColor");

export const drawingLineType = document.getElementById("drawingLineType");

/*
 * THE VECTOR SCALE'S VISIBLE VALUE.
 *
 * The scale is the one control in the row that keeps its number on screen - it
 * is a value selector and the current scale is information to read at a glance -
 * so this element is the readout, kept in step by the control's own sync.
 */
export const drawingVectorScaleValue = document.getElementById(
    "drawingVectorScaleValue"
);

export const drawingToolPanelToggle = document.getElementById("drawingToolPanelToggle");

export const drawingFeaturesPanelToggle = document.getElementById("drawingFeaturesPanelToggle");

/*
 * THE TOP BAR'S HIDE / SHOW PAIR.
 *
 * `headerHideButton` lives in the header and `drawingTopBarShow` on the
 * canvas, and they are the two halves of ONE state: while the bar is shown
 * the Hide button is present and the Show button is hidden, and while the
 * bar is hidden it is the other way round. Keeping both refs here lets the
 * workspace layout flip them together.
 */
export const headerHideButton = document.getElementById("headerHideButton");

export const drawingTopBarShow = document.getElementById("drawingTopBarShow");
