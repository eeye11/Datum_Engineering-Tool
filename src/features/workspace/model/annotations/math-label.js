// Formatting follows the edited text, not an exact copy of the template's
// original suffix. Restrict this to annotations explicitly marked as math.
export function annotationSubscript(text, metadata = {}) {
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
