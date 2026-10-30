/* Layout shared by placement, measurement, preview, and export. */
import { noteFontPixels, noteTextStyle, noteTextWidth } from "../typography/note-text-style.js";

export function dimensionLabelSize(text, state = {}, style = {}) {
    const zoom=Number(state.camera?.zoom)||1,scale=2.4*zoom;
    const typography=noteTextStyle({fontSize:11,...style});
    const font=noteFontPixels(typography,zoom);
    const lines=String(text||"").split("\n");
    // Export uses a fixed physical text size. Zooming in must not shrink the
    // label's reserved world-space area below that canonical size.
    const fontWorld=Math.max(font/scale,typography.fontSize/2.4);
    // A one-em character bound also covers wide letters and math glyphs.
    return {halfWidth:noteTextWidth(text,typography,fontWorld)/2,
        halfHeight:lines.length*fontWorld*1.15/2,gap:Math.max(6/scale,6/2.4)};
}
