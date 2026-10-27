// Closed ideal Brayton equipment schematic; no process-assumption notes.
export function appendBraytonCycle({ pipe, path, box, stateCircle, label, arrow }, problemData = {}) {
    const compressor = [[0.12, 0.66], [0.36, 0.58], [0.36, 0.42], [0.12, 0.34], [0.12, 0.66]];
    const turbine = [[0.64, 0.58], [0.88, 0.66], [0.88, 0.34], [0.64, 0.42], [0.64, 0.58]];
    // 1 -> 2 compressor, 2 -> 3 heat addition, 3 -> 4 turbine,
    // 4 -> 1 heat rejection.
    pipe([[0.14, 0.34], [0.14, 0.16], [0.37, 0.16]], "blue", compressor);
    pipe([[0.32, 0.60], [0.32, 0.70], [0.24, 0.70], [0.24, 0.84], [0.37, 0.84]], "blue", compressor);
    pipe([[0.63, 0.84], [0.76, 0.84], [0.76, 0.70], [0.67, 0.70], [0.67, 0.58]], "red", null, turbine);
    pipe([[0.86, 0.34], [0.86, 0.16], [0.63, 0.16]], "red", turbine);
    box(0.37, 0.78, 0.26, 0.12);
    box(0.37, 0.10, 0.26, 0.12);
    path(compressor);
    path(turbine);
    path([[0.36, 0.505], [0.64, 0.505]]);
    path([[0.36, 0.48], [0.64, 0.48]]);
    // A narrow turn around the shaft, with an arrowhead tangent to the arc.
    const rotation = Array.from({ length: 49 }, (_, index) => {
        const angle = (40 + index * 280 / 48) * Math.PI / 180;
        return [0.50 + 0.021 * Math.cos(angle), 0.4925 + 0.075 * Math.sin(angle)];
    });
    path(rotation, "gray");
    const tip = rotation[rotation.length - 1];
    const angle = 320 * Math.PI / 180;
    const dx = -0.021 * Math.sin(angle), dy = 0.075 * Math.cos(angle);
    const length = Math.hypot(dx, dy);
    const ux = dx / length, uy = dy / length;
    path([[tip[0] - ux * 0.016 - uy * 0.006, tip[1] - uy * 0.016 + ux * 0.006], tip,
        [tip[0] - ux * 0.016 + uy * 0.006, tip[1] - uy * 0.016 - ux * 0.006]], "gray");
    path([[0.88, 0.50], [0.91, 0.50]]);
    label(0.24, 0.50, "Compressor");
    label(0.76, 0.50, "Turbine");
    label(0.50, 0.84, "Heat\nexchanger");
    label(0.50, 0.16, "Heat\nexchanger");
    const states = [[0.25, 0.24], [0.17, 0.77], [0.83, 0.77], [0.93, 0.25]];
    states.forEach(([x, y], index) => {
        stateCircle(x, y);
        label(x, y, String(index + 1));
    });
    arrow(0.19, 0.22, 0, 0.07, "gray", 0.65);
    arrow(0.285, 0.74, 0, 0.06, "gray", 0.65);
    arrow(0.715, 0.80, 0, -0.06, "gray", 0.65);
    arrow(0.81, 0.29, 0, -0.07, "gray", 0.65);
    arrow(0.50, 0.985, 0, -0.065, "red");
    arrow(0.50, 0.08, 0, -0.065, "red");
    arrow(0.91, 0.50, 0.075, 0, "red");
    label(0.43, 0.955, "q in", "$q_{in}$");
    label(0.58, 0.045, "q out", "$q_{out}$");
    label(0.94, 0.56, "w net", "$w_{net}$");
    const annotate = (x, y, value, prefix = "") => {
        const lines = String(value || "").split(/[;\n]/).map(line => line.trim()).filter(Boolean);
        lines.forEach((line, i) => label(x, y - i * 0.04, prefix ? `${prefix}: ${line}` : line, line, true));
        return lines.length;
    };
    [[0.32, 0.30], [0.40, 0.73], [0.59, 0.73], [0.68, 0.30]].forEach(([x, y], index) => annotate(x, y, problemData[`state${index + 1}`]));
    let y = 0.66;
    for (const [key, title] of [["massFlow", "Mass flow"], ["compressor", "Compressor"], ["turbine", "Turbine"], ["heatAddition", "Heat addition"], ["heatRejection", "Heat rejection"]]) {
        y -= annotate(0.50, y, problemData[key], title) * 0.04;
    }
}
