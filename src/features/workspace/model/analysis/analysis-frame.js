/*
 * ========================================================
 * THE ANALYSIS FRAME
 * ========================================================
 *
 * The rectangle an SFD, BMD or AFD is drawn inside: a zero axis with room
 * above and below it for the student's curve.
 *
 * WHY THIS IS ITS OWN MODULE
 * --------------------------
 * Two places need these numbers and they must agree:
 *
 *   - the RENDERER, which draws the frame
 *   - the FIT, which has to reserve the frame's height, or a fitted diagram
 *     loses the very area the student draws in
 *
 * The renderer is not importable from the fit: the fit is reached from the
 * canvas renderer, which the renderer itself uses, so importing one into the
 * other makes a cycle - and a cycle in this graph breaks start-up rather than
 * failing politely. A small module with no imports of its own is the way out,
 * and it is the same fix the coordinate-system axis labels needed.
 *
 * ALL VALUES ARE SCREEN PIXELS, measured from the zero line. Up is negative in
 * screen coordinates, so `top` is negative - and every caller adds them to the
 * zero line rather than treating them as absolute positions.
 */
const ANALYSIS_FRAME = {
  /*
   * How far the plot area reaches above and below the zero line.
   *
   * ONE number for both halves, deliberately: the frame is symmetric, and two
   * separate values would be an invitation to set them differently - which
   * would then be invisible until someone compared the two halves of an SFD.
   */
  ordinateHeightPx: 110,

  /* How far the x-axis runs past the body's far end. */
  axisExtensionPx: 46,

  /* The axis arrowhead, and the gap before the axis label. */
  arrowHeadPx: 7,
  labelGapPx: 7,

  /* Padding around the frame, and the corner rounding. */
  paddingPx: 8,
  radiusPx: 3,
};

/*
 * The frame's extents, in screen pixels from the zero line.
 *
 * `top` is negative because screen coordinates put up at negative y; both
 * halves carry the same magnitude.
 */
function analysisFrameExtents() {
  return {
    top: -ANALYSIS_FRAME.ordinateHeightPx,
    bottom: ANALYSIS_FRAME.ordinateHeightPx,
    right: ANALYSIS_FRAME.axisExtensionPx,
    arrowHead: ANALYSIS_FRAME.arrowHeadPx,
    labelGap: ANALYSIS_FRAME.labelGapPx,
  };
}

const enggAnalysisFrame = {
  ANALYSIS_FRAME,
  analysisFrameExtents,
};

export default enggAnalysisFrame;
export { ANALYSIS_FRAME, analysisFrameExtents };
