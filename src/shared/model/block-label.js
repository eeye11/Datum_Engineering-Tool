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

export function appendBlockLabelSvg(group, value, documentRef, { x, y, fill, fontSize = 10 }) {
    const expression = String(value ?? "").trim();
    const slash = expression.indexOf("/");

    if (slash < 0) {
        const label = documentRef.createElementNS("http://www.w3.org/2000/svg", "text");
        label.setAttribute("x", x);
        label.setAttribute("y", y);
        label.setAttribute("fill", fill);
        label.setAttribute("font-size", fontSize);
        label.setAttribute("font-family", "sans-serif");
        label.setAttribute("text-anchor", "middle");
        label.setAttribute("dominant-baseline", "central");
        appendExponentText(label, expression, documentRef);
        group.appendChild(label);

        return;
    }

    const numerator = expression.slice(0, slash).trim();
    const denominator = expression.slice(slash + 1).trim();
    const fractionWidth = Math.max(numerator.length, denominator.length, 1) * fontSize * 0.65;

    for (const [text, baseline] of [[numerator, y - fontSize * 0.45], [denominator, y + fontSize * 0.95]]) {
        const label = documentRef.createElementNS("http://www.w3.org/2000/svg", "text");
        label.setAttribute("x", x);
        label.setAttribute("y", baseline);
        label.setAttribute("fill", fill);
        label.setAttribute("font-size", fontSize);
        label.setAttribute("font-family", "sans-serif");
        label.setAttribute("text-anchor", "middle");
        appendExponentText(label, text, documentRef);
        group.appendChild(label);
    }

    const bar = documentRef.createElementNS("http://www.w3.org/2000/svg", "line");
    bar.setAttribute("x1", x - fractionWidth / 2);
    bar.setAttribute("x2", x + fractionWidth / 2);
    bar.setAttribute("y1", y + fontSize * 0.15);
    bar.setAttribute("y2", y + fontSize * 0.15);
    bar.setAttribute("stroke", fill);
    bar.setAttribute("stroke-width", "1");
    group.appendChild(bar);
}
