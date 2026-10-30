export const HEAT_TRANSFER_TOOLS = {
    "heat-entering": { label: "Heat Entering", colour: "#dc2626" },
    "heat-leaving": { label: "Heat Leaving", colour: "#2563eb" }
};

export function heatTransferTool(toolId) {
    return HEAT_TRANSFER_TOOLS[toolId] || null;
}

export function heatArrowLabel(geometry = {}, gap = 2) {
    const { start, end } = geometry;
    if (!start || !end) return null;
    const dx = end.x - start.x, dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-9) return null;
    return {
        position: { x: start.x - dx / length * gap, y: start.y - dy / length * gap },
        anchor: Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? "east" : "west") : (dy >= 0 ? "north" : "south")
    };
}
