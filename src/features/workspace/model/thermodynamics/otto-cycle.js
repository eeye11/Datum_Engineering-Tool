import { cylinderPoint } from "./piston-cylinder.js";
import { processPathPoints } from "./process-curves.js";
import { layoutCycleLabels } from "./cycle-label-layout.js";

// Real engine indicator diagram above the ideal four-state Otto P-v plot.
// Both use native plots, process paths and annotations, like the Diesel tool.
export function ottoCycleFeatures(geometry) {
    const features = [];
    for (const [kind, top, bottom] of [["indicator", 0.99, 0.55], ["ideal", 0.48, 0.04]]) {
        const begin = features.length;
        const plotId = `otto-${kind}-plot`;
        const g = { position: cylinderPoint(geometry, 0, top), width: geometry.width, height: geometry.height * (top - bottom), rotation: 0, xLabel: "v", yLabel: "P" };
        const at = (x, y) => cylinderPoint(g, x, y);
        features.push({ id: plotId, name: kind === "indicator" ? "Otto Engine Indicator Diagram" : "Ideal Otto P-v Diagram", type: "rectangle", geometry: g,
            metadata: { thermodynamicsKind: "process-plot" }, style: { stroke: "#000000", lineWidth: 0.7, lineType: "solid", fill: "none" } });
        const note = (id, x, y, text, subscript = null) => features.push({ id: `otto-${kind}-${id}`, type: "annotate", annotateKind: "note", text, name: text, parentId: plotId,
            geometry: { position: at(x, y) }, metadata: subscript ? { mathSubscript: subscript } : {}, style: { stroke: "#000000", fontSize: 12, align: "center" } });
        const line = (id, a, b, dashed = false) => features.push({ id: `otto-${kind}-${id}`, type: "line", name: "Otto Cycle Reference", parentId: plotId,
            geometry: { start: at(...a), end: at(...b) }, metadata: {}, style: { stroke: "#555555", lineWidth: 0.4, lineType: dashed ? "dashed" : "solid" } });
        let local, bends, offsets;
        if (kind === "indicator") {
            local = [[0.84, 0.23], [0.23, 0.58], [0.25, 0.90], [0.37, 0.90], [0.82, 0.44], [0.84, 0.23], [0.22, 0.23], [0.22, 0.18], [0.84, 0.18], [0.84, 0.23]];
            bends = [0.075, 0.15, 0.15, -0.015, 0.24, 0, -0.25, 0, -0.25];
            offsets = [];
            note("compression", 0.55, 0.46, "Compression");
            note("expansion", 0.58, 0.81, "Expansion");
            note("exhaust", 0.45, 0.285, "Exhaust");
            note("intake", 0.53, 0.115, "Intake");
            for (const [id, state, x, y, text] of [["ignition", [0.23, 0.58], 0.36, 0.65, "Ignition"],
                ["exhaust-valve", [0.82, 0.44], 0.87, 0.67, "Exhaust valve\nopens"],
                ["intake-valve", [0.22, 0.23], 0.32, 0.38, "Intake valve\nopens"]]) {
                features.push({ id: `otto-${id}-point`, type: "point", name: text.replace("\n", " "), geometry: { position: at(...state) }, parentId: plotId, metadata: {}, style: { stroke: "#222222" } });
                note(id, x, y, text);
                line(`${id}-leader`, [x, y - 0.035], state);
            }
        } else {
            local = [[0.84, 0.15], [0.23, 0.40], [0.23, 0.85], [0.84, 0.27], [0.84, 0.15]];
            bends = [0.07, 0, -0.13, 0].map((bend, index) => {
                const dx = Math.abs(local[index + 1][0] - local[index][0]) * g.width;
                const dy = Math.abs(local[index + 1][1] - local[index][1]) * g.height;
                const limit = dx > 1e-9 && dy > 1e-9 ? 0.24 * Math.min(dx / dy, dy / dx) : 0;
                return Math.sign(bend) * Math.min(Math.abs(bend), limit);
            });
            offsets = [[0.045, -0.005], [-0.045, -0.01], [-0.025, 0.04], [0.045, 0.035]].map(([dx, dy]) => ({ dx: dx * g.width, dy: dy * g.height }));
            note("compression", 0.47, 0.31, "Isentropic");
            note("expansion", 0.59, 0.66, "Isentropic");
            for (const [id, a, b, labelAt, subscript] of [["qin", [0.17, 0.66], [0.29, 0.55], [0.14, 0.74], "in"],
                ["qout", [0.81, 0.23], [0.94, 0.19], [0.97, 0.17], "out"]]) {
                features.push({ id: `otto-${id}-arrow`, type: "annotate", annotateKind: "arrow", text: "", name: "Heat Transfer", parentId: plotId,
                    geometry: { start: at(...a), end: at(...b) }, metadata: {}, style: { stroke: "#dc2626", lineWidth: 1, arrowhead: "closed" } });
                note(id, ...labelAt, `q ${subscript}`, subscript);
            }
        }
        const points = local.map(([x, y]) => at(x, y));
        const process = { id: `otto-${kind}-path`, type: "polyline", name: kind === "indicator" ? "Otto Intake and Exhaust Path" : "Ideal Otto Process Path", parentId: plotId,
            geometry: { points, segmentBends: bends, stateLabelOffsets: offsets },
            metadata: { thermodynamicsKind: "process-path", stateCount: kind === "ideal" ? 4 : 0, closed: true,
                ...(kind === "indicator" ? { arrowSegments: [0, 3, 5, 7] } : {}) },
            style: { stroke: "#169447", lineWidth: 0.7, fill: "none", lineType: "solid" } };
        features.push(process);
        note("tdc", 0.23, 0.015, "TDC");
        note("bdc", 0.84, 0.015, "BDC");
        const members = features.slice(begin);
        const notes = members.filter(item => item.annotateKind === "note");
        const labels = notes.map(item => ({ point: item.geometry.position, text: item.text, plainText: true }));
        const numbers = kind === "ideal" ? points.slice(0, 4).map((p, i) => ({ point: { x: p.x + offsets[i].dx, y: p.y + offsets[i].dy }, text: String(i + 1) })) : [];
        // Leave extra space for the real rendered font and check leader lines
        // as well as curves. Recheck after attaching leaders to moved labels.
        const layoutGeometry = { ...g, height: g.height * 1.25 };
        for (let pass = 0; pass < 3; pass++) {
            const obstacles = [{ points: [at(0.08, 0.95), at(0.08, 0.08), at(0.95, 0.08)] }, { points: processPathPoints(process.geometry) },
                ...members.filter(item => item.annotateKind === "arrow" || item.type === "line").map(item => ({ points: [item.geometry.start, item.geometry.end] }))];
            layoutCycleLabels(obstacles, [...labels, ...numbers], layoutGeometry);
            notes.forEach((item, i) => {
                item.geometry.position = labels[i].point;
                item.text = labels[i].lines.join("\n");
                const leader = members.find(candidate => candidate.id === `${item.id}-leader`);
                if (!leader) return;
                const font = layoutGeometry.height * 0.036;
                const halfWidth = Math.max(...labels[i].lines.map(line => line.length)) * font * 0.30;
                const halfHeight = font * (1 + (labels[i].lines.length - 1) * 1.2) / 2;
                const centre = item.geometry.position, target = leader.geometry.end;
                const dx = target.x - centre.x, dy = target.y - centre.y;
                const length = Math.hypot(dx, dy);
                if (length < 1e-9) return;
                const t = Math.min(Math.abs(dx) > 1e-9 ? halfWidth / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-9 ? halfHeight / Math.abs(dy) : Infinity);
                const offset = Math.min(0.95, t + font * 0.4 / length);
                leader.geometry.start = { x: centre.x + dx * offset, y: centre.y + dy * offset };
            });
        }
    }
    return features;
}
