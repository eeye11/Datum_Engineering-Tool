function escapeLatexText(value) {
    return value.replace(/[\\#$%&_{}]/g, (character) => ({
        "\\": "\\textbackslash{}",
        "#": "\\#",
        "$": "\\$",
        "%": "\\%",
        "&": "\\&",
        "_": "\\_",
        "{": "\\{",
        "}": "\\}"
    })[character]);
}

function formatExpression(value) {
    const slash = value.indexOf("/");

    if (slash >= 0) {
        return `\\frac{${formatExpression(value.slice(0, slash))}}{${formatExpression(value.slice(slash + 1))}}`;
    }

    const output = [];
    const exponent = /\^(\{[^{}]*\}|[A-Za-z0-9+-])/g;
    let cursor = 0;
    let match;

    while ((match = exponent.exec(value))) {
        output.push(escapeLatexText(value.slice(cursor, match.index)));
        const exponentText = match[1].startsWith("{")
            ? match[1].slice(1, -1)
            : match[1];
        output.push(`^{${escapeLatexText(exponentText)}}`);
        cursor = exponent.lastIndex;
    }

    output.push(escapeLatexText(value.slice(cursor)));

    return output.join("");
}

export function blockLabelLatex(value) {
    return formatExpression(String(value ?? "").trim());
}

function appendExponentText(textElement, value, documentRef) {
    const exponent = /\^(\{[^{}]*\}|[A-Za-z0-9+-])/g;
    let cursor = 0;
    let match;

    while ((match = exponent.exec(value))) {
        if (match.index > cursor) {
            textElement.appendChild(documentRef.createTextNode(value.slice(cursor, match.index)));
        }

        const exponentText = match[1].startsWith("{")
            ? match[1].slice(1, -1)
            : match[1];
        const tspan = documentRef.createElementNS("http://www.w3.org/2000/svg", "tspan");
        tspan.setAttribute("baseline-shift", "super");
        tspan.setAttribute("font-size", "70%");
        tspan.textContent = exponentText;
        textElement.appendChild(tspan);
        cursor = exponent.lastIndex;
    }

    if (cursor < value.length) {
        textElement.appendChild(documentRef.createTextNode(value.slice(cursor)));
    }
}

/*
 * A BLOCK'S TRANSFER FUNCTION, drawn at a CANVAS font size.
 *
 * The size is a SCREEN size from the shared typography system, so `zoom` is the
 * camera this frame is drawn at: the nodes state `fontSize * zoom` and the group
 * is scaled by `1 / zoom` about the label's own point, which leaves the formula
 * the same size on screen at every magnification while its position still
 * follows the block.
 */
export function appendBlockLabelSvg(group, value, documentRef, { x, y, fill, fontSize = 12, zoom = 1 }) {
    const expression = String(value ?? "").trim();
    const slash = expression.indexOf("/");

    const view = Number(zoom) > 0 ? Number(zoom) : 1;
    const size = Number(fontSize) > 0 ? Number(fontSize) : 12;

    const transform = view === 1
        ? null
        : `translate(${x} ${y}) scale(${Math.round((1 / view) * 1e6) / 1e6})`;

    /* The fraction's parts are laid out in the UNZOOMED space the group is in. */
    const stamped = (attribute, element) => {
        element.setAttribute(attribute, size * view);
    };

    if (slash < 0) {
        const label = documentRef.createElementNS("http://www.w3.org/2000/svg", "text");
        label.setAttribute("x", x);
        label.setAttribute("y", y);
        label.setAttribute("fill", fill);
        stamped("font-size", label);
        label.setAttribute("font-family", "sans-serif");
        label.setAttribute("text-anchor", "middle");
        label.setAttribute("dominant-baseline", "central");

        if (transform) {
            label.setAttribute("transform", transform);
        } else {
            label.setAttribute("x", x);
        }

        appendExponentText(label, expression, documentRef);
        group.appendChild(label);

        return;
    }

    const numerator = expression.slice(0, slash).trim();
    const denominator = expression.slice(slash + 1).trim();
    const fractionWidth = Math.max(numerator.length, denominator.length, 1) * size * 0.65;

    for (const [text, baseline] of [[numerator, y - size * 0.45], [denominator, y + size * 0.95]]) {
        const label = documentRef.createElementNS("http://www.w3.org/2000/svg", "text");
        label.setAttribute("x", x);
        label.setAttribute("y", baseline);
        label.setAttribute("fill", fill);
        stamped("font-size", label);
        label.setAttribute("font-family", "sans-serif");
        label.setAttribute("text-anchor", "middle");

        if (view !== 1) {
            label.setAttribute("transform", `translate(${x} ${baseline}) scale(${Math.round((1 / view) * 1e6) / 1e6})`);
            label.setAttribute("y", 0);
        }

        appendExponentText(label, text, documentRef);
        group.appendChild(label);
    }

    const bar = documentRef.createElementNS("http://www.w3.org/2000/svg", "line");
    bar.setAttribute("x1", x - fractionWidth / 2);
    bar.setAttribute("x2", x + fractionWidth / 2);
    bar.setAttribute("y1", y + size * 0.15);
    bar.setAttribute("y2", y + size * 0.15);
    bar.setAttribute("stroke", fill);
    bar.setAttribute("stroke-width", "1");
    group.appendChild(bar);
}
