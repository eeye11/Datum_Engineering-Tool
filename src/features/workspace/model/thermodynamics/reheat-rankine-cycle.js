// Layout for the six-state reheat cycle, using the same drawing primitives
// as the simple Rankine cycle so pipe spacing and arrows stay consistent.
export function appendReheatRankineCycle({ pipe, path, box, circle, stateCircle, label, arrow, pumpCasing }, problemData = {}) {
    const pump = pumpCasing.map(([x, y]) => [0.28 + (x - 0.195) * 0.7, 0.20 + (y - 0.49) * 0.7]);
    const turbine = x => [[x, 0.75], [x + 0.16, 0.81], [x + 0.16, 0.63], [x, 0.69], [x, 0.75]];
    const high = turbine(0.40), low = turbine(0.70);

    // 1 -> 2 pump; 2 -> 3 boiler; 3 -> 4 HP turbine;
    // 4 -> 5 reheater; 5 -> 6 LP turbine; 6 -> 1 condenser.
    pipe([[0.46, 0.15], [0.35, 0.15], [0.35, 0.20], [0.32, 0.20]], "blue", null, pump);
    pipe([[0.2695, 0.256], [0.2695, 0.29], [0.17, 0.29], [0.17, 0.36]], "blue", pump);
    pipe([[0.17, 0.62], [0.17, 0.90], [0.44, 0.90], [0.44, 0.78]], "red", null, high);
    pipe([[0.51, 0.65], [0.51, 0.55], [0.22, 0.55]], "red", high);
    pipe([[0.22, 0.43], [0.73, 0.43], [0.73, 0.74]], "red", null, low);
    pipe([[0.82, 0.64], [0.82, 0.15], [0.73, 0.15]], "red", low);
    // Vertical boiler with a plain outline and its label outside on the left.
    box(0.12, 0.36, 0.10, 0.26);
    box(0.46, 0.10, 0.27, 0.10);
    path(pump);
    circle(0.28, 0.20, 0.0126);
    path(high);
    path(low);
    path([[0.56, 0.72], [0.70, 0.72]]);
    label(0.065, 0.49, "Boiler");
    label(0.32, 0.60, "Reheater");
    label(0.36, 0.26, "Pump");
    label(0.595, 0.15, "Condenser");
    label(0.48, 0.72, "HP Turbine");
    label(0.78, 0.72, "LP Turbine");
    label(0.46, 0.38, "P4 = P5 = P reheat", "$P_4=P_5=P_{reheat}$");

    const states = [[0.40, 0.09], [0.10, 0.30], [0.34, 0.96], [0.43, 0.61], [0.61, 0.37], [0.88, 0.34]];
    states.forEach(([x, y], i) => {
        stateCircle(x, y);
        label(x, y, String(i + 1));
    });
    // Put one direction marker directly on each pipe's straight section,
    // so opposing reheat flows cannot be mistaken for the adjacent line.
    arrow(0.435, 0.15, -0.055, 0, "gray", 0.45);
    arrow(0.17, 0.329, 0, 0.023, "gray", 0.45);
    arrow(0.27, 0.90, 0.07, 0, "gray", 0.45);
    arrow(0.42, 0.55, -0.07, 0, "gray", 0.45);
    arrow(0.52, 0.43, 0.07, 0, "gray", 0.45);
    arrow(0.82, 0.35, 0, -0.08, "gray", 0.45);

    const annotate = (x, y, text) => String(text || "").split(/[;\n]/).map(value => value.trim()).filter(Boolean).forEach((line, i) => label(x, y - i * 0.032, line, line, true));
    const positions = [[0.38, 0.04], [0.30, 0.34], [0.34, 0.995], [0.38, 0.66], [0.60, 0.31], [0.80, 0.29]];
    positions.forEach(([x, y], i) => annotate(x, y, problemData[`state${i + 1}`]));
    let notesY = 0.82;
    for (const [key, title] of [["massFlow", "Mass flow"], ["boiler", "Boiler"], ["reheater", "Reheater"], ["highTurbine", "HP turbine"], ["lowTurbine", "LP turbine"], ["turbine", "Turbines"], ["condenser", "Condenser"], ["pump", "Pump"]]) {
        if (!problemData[key]) continue;
        annotate(0.63, notesY, `${title}: ${problemData[key]}`);
        notesY -= 0.04;
    }
}
