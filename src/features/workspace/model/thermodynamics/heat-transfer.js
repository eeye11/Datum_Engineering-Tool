export const HEAT_TRANSFER_TOOLS = {
    "heat-entering": { label: "Heat Entering", colour: "#dc2626" },
    "heat-leaving": { label: "Heat Leaving", colour: "#2563eb" }
};

export function heatTransferTool(toolId) {
    return HEAT_TRANSFER_TOOLS[toolId] || null;
}
