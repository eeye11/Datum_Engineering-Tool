// Formatting follows the edited text, not an exact copy of the template's
// original suffix. Restrict this to annotations explicitly marked as math.
export function annotationSubscript(text, metadata = {}) {
    const scripted = /^\s*([a-zA-Z])([\u0307]?)((?:[_^](?:\{[^{}]+\}|[a-zA-Z0-9,+-]+))+)([\s\S]*)$/.exec(String(text ?? ""));
    if (scripted) {
        const result = { base: scripted[1] + scripted[2], subscript: "", superscript: "", suffix: scripted[4] };
        for (const match of scripted[3].matchAll(/([_^])(?:\{([^{}]+)\}|([a-zA-Z0-9,+-]+))/g)) {
            result[match[1] === "_" ? "subscript" : "superscript"] = match[2] || match[3];
        }
        return result;
    }
    if (!metadata.mathSubscript) return null;
    const input = String(text ?? "").replace(/ₕ/g, "H").replace(/ₗ/g, "L");
    const match = /^\s*([qQTPW])\s*(?:_\s*\{\s*(net,out|in|out|atm|H|L)\s*\}|_\s*(net,out|in|out|atm|H|L)|(net,out|in|out|atm|H|L))(?=$|[^a-zA-Z0-9])([\s\S]*)$/i.exec(input);
    if (!match) return null;
    const subscript = match[2] || match[3] || match[4];
    return {
        base: match[1],
        subscript: /^[hl]$/i.test(subscript) ? subscript.toUpperCase() : subscript.toLowerCase(),
        suffix: match[5]
    };
}
