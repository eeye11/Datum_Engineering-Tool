/* Whole-note typography shared by the canvas, editor, and document export. */
export const NOTE_FONTS = [
    {value:"Arial", label:"Arial (sans serif)"},
    {value:"Times New Roman", label:"Times New Roman (serif)"},
    {value:"Courier New", label:"Courier New (monospace)"}
];
const clamp = (value, fallback, min, max) => Number.isFinite(Number(value))
    ? Math.min(max, Math.max(min, Number(value))) : fallback;
export function noteTextStyle(style = {}) {
    return {
        fontFamily:NOTE_FONTS.some(font => font.value === style.fontFamily) ? style.fontFamily : "Arial",
        fontSize:clamp(style.fontSize ?? 12,12,6,64),
        bold:style.bold === true,
        italic:style.italic === true,
        underline:style.underline === true,
        align:["left","center","right"].includes(style.align) ? style.align : "left",
        indent:clamp(style.indent ?? 0,0,0,1000),
        lineSpacing:clamp(style.lineSpacing ?? 1.2,1.2,1,3)
    };
}
export function noteFontPixels(style, zoom = 1) {
    return Math.min(64, Math.max(6, noteTextStyle(style).fontSize *
        Math.min(1.6, Math.max(0.55, Math.sqrt(zoom)))));
}
export function noteTextWidth(text, style, fontPixels) {
    const typography = noteTextStyle(style);
    const factor = typography.fontFamily === "Courier New" ? 0.61 : 0.62;
    return Math.max(1,...String(text).split("\n").map(line => line.length)) *
        fontPixels * factor * (typography.bold ? 1.06 : 1);
}
