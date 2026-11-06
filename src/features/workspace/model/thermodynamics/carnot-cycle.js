import { cylinderPoint } from "./piston-cylinder.js";
import { processPathPoints } from "./process-curves.js";
import { layoutCycleLabels } from "./cycle-label-layout.js";

// Editable four-state Carnot P-V template, with the enclosed net-work area.
export function carnotCycleFeatures(geometry) {
    const g = { ...geometry, xLabel: "V", yLabel: "P" };
    const at = (x, y) => cylinderPoint(g, x, y);
    const plotId = "carnot-plot";
    const features = [{ id: plotId, type: "rectangle", name: "Carnot P-V Diagram", geometry: g,
        metadata: { thermodynamicsKind: "process-plot" }, style: { stroke: "#000000", lineWidth: 0.7, lineType: "solid", fill: "none" } }];
    const local = [[0.23, 0.78], [0.56, 0.56], [0.80, 0.22], [0.40, 0.35], [0.23, 0.78]];
    const points = local.map(([x, y]) => at(x, y));
    const bends = [-0.045, -0.02, 0.035, 0.025].map((bend, index) => {
        const dx = Math.abs(points[index + 1].x - points[index].x), dy = Math.abs(points[index + 1].y - points[index].y);
        const limit = dx > 1e-9 && dy > 1e-9 ? 0.24 * Math.min(dx / dy, dy / dx) : 0;
        return Math.sign(bend) * Math.min(Math.abs(bend), limit);
    });
    const offsets = [[0, 0.045], [0.005, 0.045], [0.015, -0.045], [-0.02, -0.045]].map(([dx, dy]) => ({ dx: dx * g.width, dy: dy * g.height }));
    const process = { id: "carnot-path", type: "polyline", name: "Carnot Process Path", parentId: plotId,
        geometry: { points, segmentBends: bends, stateLabelOffsets: offsets, closed: true },
        metadata: { thermodynamicsKind: "process-path", closed: true, stateCount: 4 },
        style: { stroke: "#2563a6", lineWidth: 0.7, fill: "#add8f0", fillOpacity: 0.3, fillMode: "solid", lineType: "solid" } };
    features.push(process);
    const line = (id, a, b) => features.push({ id: `carnot-${id}`, type: "line", name: "Isotherm Extension", parentId: plotId,
        geometry: { start: at(...a), end: at(...b) }, metadata: {}, style: { stroke: "#333333", lineWidth: 0.5, lineType: "solid" } });
    line("hot-before", [0.18, 0.825], local[0]);
    line("hot-after", local[1], [0.68, 0.53]);
    line("cold-before", [0.32, 0.39], local[3]);
    line("cold-after", local[2], [0.91, 0.205]);
    const note = (id, x, y, base, subscript, suffix = "") => features.push({ id: `carnot-${id}`, type: "annotate", annotateKind: "note", name: `${base} ${subscript}${suffix}`, text: `${base} ${subscript}${suffix}`, parentId: plotId,
        geometry: { position: at(x, y) }, metadata: { mathSymbol: base, mathSubscript: subscript, mathSuffix: suffix }, style: { stroke: "#000000", fontSize: 12, align: "center" } });
    note("hot-label", 0.72, 0.60, "T", "H", " = const.");
    note("cold-label", 0.87, 0.28, "T", "L", " = const.");
    note("work", 0.48, 0.45, "W", "net,out");
    for (const [id, start, end, label, subscript] of [["heat-in", [0.40, 0.75], [0.40, 0.55], [0.40, 0.80], "H"],
        ["heat-out", [0.54, 0.38], [0.56, 0.20], [0.59, 0.14], "L"]]) {
        features.push({ id: `carnot-${id}-arrow`, type: "annotate", annotateKind: "arrow", text: "", name: "Heat Transfer", parentId: plotId,
            geometry: { start: at(...start), end: at(...end) }, metadata: {}, style: { stroke: "#dc2626", lineWidth: 1.1, arrowhead: "closed" } });
        note(id, ...label, "Q", subscript);
    }
    const notes = features.filter(item => item.annotateKind === "note");
    const obstacles = [{ points: [at(0.08, 0.95), at(0.08, 0.08), at(0.95, 0.08)] }, { points: processPathPoints(process.geometry) },
        ...features.filter(item => item.type === "line" || item.annotateKind === "arrow").map(item => ({ points: [item.geometry.start, item.geometry.end] }))];
    const labels = notes.map(item => ({ point: item.geometry.position, text: item.text, plainText: item.metadata.mathSymbol !== "W" }));
    const states = points.slice(0, 4).map((p, index) => ({ point: { x: p.x + offsets[index].dx, y: p.y + offsets[index].dy }, text: String(index + 1) }));
    layoutCycleLabels(obstacles, [...labels, ...states], g);
    notes.forEach((item, index) => { item.geometry.position = labels[index].point; });
    return features;
}
