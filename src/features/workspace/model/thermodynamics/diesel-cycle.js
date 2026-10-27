import { cylinderPoint } from "./piston-cylinder.js";
import { processPathPoints } from "./process-curves.js";
import { layoutCycleLabels } from "./cycle-label-layout.js";

// Native process plots and paths, so states, bends and labels remain editable
// with the existing process-path tools after the template is placed.
export function dieselCycleFeatures(geometry) {
    const features = [];
    for (const [kind, top, bottom] of [["pv", 0.99, 0.55], ["ts", 0.48, 0.04]]) {
        const firstFeature = features.length;
        const plotId = `diesel-${kind}-plot`;
        const g = { position: cylinderPoint(geometry, 0, top), width: geometry.width, height: geometry.height * (top - bottom), rotation: 0,
            xLabel: kind === "pv" ? "v" : "s", yLabel: kind === "pv" ? "P" : "T" };
        const at = (x, y) => cylinderPoint(g, x, y);
        features.push({ id: plotId, type: "rectangle", name: kind === "pv" ? "Diesel P-v Diagram" : "Diesel T-s Diagram", geometry: g,
            metadata: { thermodynamicsKind: "process-plot" }, style: { stroke: "#000000", lineWidth: 0.7, fill: "none", lineType: "solid" } });
        const states = kind === "pv" ? [[0.84, 0.15], [0.22, 0.78], [0.49, 0.78], [0.84, 0.36]]
            : [[0.23, 0.16], [0.23, 0.49], [0.82, 0.80], [0.82, 0.53]];
        const points = [...states, states[0]].map(([x, y]) => at(x, y));
        const bends = kind === "pv" ? [0.12, 0, -0.16, 0] : [0, -0.035, 0, 0.06];
        // Preserve monotonic thermodynamic curves even in a very wide or
        // tall plot; a quadratic control point must stay between its states.
        const segmentBends = bends.map((bend, index) => {
            const dx = Math.abs(points[index + 1].x - points[index].x);
            const dy = Math.abs(points[index + 1].y - points[index].y);
            const limit = dx > 1e-9 && dy > 1e-9 ? 0.24 * Math.min(dx / dy, dy / dx) : 0;
            return Math.sign(bend) * Math.min(Math.abs(bend), limit);
        });
        const labelOffsets = (kind === "pv" ? [[0.025, -0.015], [-0.025, 0.01], [0.025, 0.02], [0.025, 0.015]]
            : [[-0.025, -0.015], [-0.025, 0.02], [0.025, 0.015], [0.025, -0.01]])
            .map(([dx, dy]) => ({ dx: dx * g.width, dy: dy * g.height }));
        features.push({ id: `diesel-${kind}-path`, type: "polyline", name: kind === "pv" ? "Diesel P-v Process Path" : "Diesel T-s Process Path", parentId: plotId,
            geometry: { points, segmentBends, stateLabelOffsets: labelOffsets },
            metadata: { thermodynamicsKind: "process-path", stateCount: 4, closed: true }, style: { stroke: "#169447", lineWidth: 0.7, fill: "none", lineType: "solid" } });
        const note = (id, x, y, text, subscript = null) => features.push({ id: `diesel-${kind}-${id}`, type: "annotate", annotateKind: "note", text, parentId: plotId,
            geometry: { position: at(x, y) }, style: { stroke: "#000000", fontSize: 12, align: "center" }, metadata: subscript ? { mathSubscript: subscript } : {} });
        for (const [id, x, y, dx, dy, caption, labelX, labelY] of kind === "pv"
            ? [["qin", 0.36, 0.94, 0, -0.23, "q in", 0.32, 0.995], ["qout", 0.78, 0.29, 0.14, -0.07, "q out", 0.97, 0.20]]
            : [["qin", 0.67, 0.92, 0, -0.21, "q in", 0.635, 0.995], ["qout", 0.66, 0.48, 0.13, -0.13, "q out", 0.84, 0.37]]) {
            features.push({ id: `diesel-${kind}-${id}-arrow`, type: "annotate", annotateKind: "arrow", text: "", parentId: plotId,
                geometry: { start: at(x, y), end: at(x + dx, y + dy) }, metadata: {}, style: { stroke: "#dc2626", lineWidth: 1, arrowEnd: true, arrowhead: "closed" } });
            note(id, labelX, labelY, caption, id === "qin" ? "in" : "out");
        }
        // Lay out note boxes against the real process curves, heat arrows,
        // axes, and state labels; preview and committed objects share this.
        const members = features.slice(firstFeature);
        const notes = members.filter(item => item.annotateKind === "note");
        const obstacles = [
            { points: [at(0.08, 0.95), at(0.08, 0.08), at(0.95, 0.08)] },
            { points: processPathPoints({ points, segmentBends }) },
            ...members.filter(item => item.annotateKind === "arrow").map(item => ({ points: [item.geometry.start, item.geometry.end] }))
        ];
        const labels = notes.map(item => ({ point: item.geometry.position, text: item.text, plainText: true }));
        const stateLabels = points.slice(0, 4).map((p, index) => ({ point: { x: p.x + labelOffsets[index].dx, y: p.y + labelOffsets[index].dy }, text: String(index + 1) }));
        layoutCycleLabels(obstacles, [...labels, ...stateLabels], g);
        notes.forEach((item, index) => {
            item.geometry.position = labels[index].point;
            item.text = labels[index].lines.join("\n");
        });
    }
    return features;
}
