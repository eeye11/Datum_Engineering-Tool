export const PLANT_KIND = "plant";
export const BLOCK_KIND = "block";
export const DEFAULT_PLANT_FILL = "#D9D9D9";

export function isPlant(object) {
    return object?.type === "rectangle" && object.metadata?.controlsKind === PLANT_KIND;
}

export function isBlock(object) {
    return object?.type === "rectangle" && object.metadata?.controlsKind === BLOCK_KIND;
}

export function isControlBlock(object) {
    return isPlant(object) || isBlock(object);
}

export function plantStyle(style = {}) {
    const fill = String(style.fill ?? "").toLowerCase();

    if (fill === "#e5e7eb" || fill === "#f3f4f6") {
        return { ...style, fill: DEFAULT_PLANT_FILL, fillMode: "solid" };
    }

    if (
        String(style.fillMode ?? "").toLowerCase() === "solid" &&
        fill &&
        fill !== "none"
    ) {
        return style;
    }

    return {
        ...style,
        fill: DEFAULT_PLANT_FILL,
        fillMode: "solid"
    };
}

export function plantValue(object, key) {
    if (!isControlBlock(object)) {
        return undefined;
    }

    if (key === "inputs" || key === "outputs") {
        const value = Number(object.metadata[key]);

        return Number.isSafeInteger(value) && value >= 0 ? value : 1;
    }

    if (key === "showNodeLabels") {
        return object.metadata[key] !== false;
    }

    if (key === "plantLabel") {
        return isPlant(object) && typeof object.metadata.plantLabel === "string"
            ? object.metadata.plantLabel
            : "";
    }

    if (key === "blockLabel" || key === "blockLowerLabel") {
        const value = object.metadata[key];
        return typeof value === "string" ? value : "";
    }

    return undefined;
}

export function plantNodeLabel(object, side, index) {
    if (
        !isControlBlock(object) ||
        (side !== "inputs" && side !== "outputs") ||
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index >= plantValue(object, side)
    ) {
        return undefined;
    }

    const stored = object.metadata?.nodeLabels?.[side]?.[index];

    return typeof stored === "string"
        ? stored
        : `${side === "inputs" ? "Input" : "Output"} ${index + 1}`;
}

export function setPlantNodeLabel(object, side, index, value) {
    if (
        !isControlBlock(object) ||
        (side !== "inputs" && side !== "outputs") ||
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index >= plantValue(object, side) ||
        typeof value !== "string"
    ) {
        return false;
    }

    const labels = object.metadata.nodeLabels || {};
    const sideLabels = [...(labels[side] || [])];
    sideLabels[index] = value;
    object.metadata = {
        ...object.metadata,
        nodeLabels: {
            ...labels,
            [side]: sideLabels
        }
    };

    return true;
}

export function plantNodePosition(object, side, index) {
    if (
        !isControlBlock(object) ||
        (side !== "inputs" && side !== "outputs") ||
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index >= plantValue(object, side)
    ) {
        return null;
    }

    const { position = {}, width, height, rotation = 0 } = object.geometry || {};
    const numericWidth = Number(width);
    const numericHeight = Number(height);

    if (![position.x, position.y, numericWidth, numericHeight, rotation].every(Number.isFinite)) {
        return null;
    }

    const isInput = side === "inputs";
    const x = isInput ? -numericWidth / 2 : numericWidth / 2;
    const outward = isInput ? -1 : 1;
    const margin = Math.min(numericHeight * 0.15, 2);
    const usableHeight = Math.max(0, numericHeight - margin * 2);
    const y = plantValue(object, side) === 1
        ? 0
        : numericHeight / 2 - margin - index * usableHeight / (plantValue(object, side) - 1);
    const centre = {
        x: position.x + numericWidth / 2,
        y: position.y - numericHeight / 2
    };
    const radians = rotation * Math.PI / 180;
    const localX = x + outward * 4;

    return {
        x: centre.x + localX * Math.cos(radians) - y * Math.sin(radians),
        y: centre.y + localX * Math.sin(radians) + y * Math.cos(radians)
    };
}

export function plantNodeAtPoint(object, point, tolerance) {
    if (!isControlBlock(object) || !point || !Number.isFinite(tolerance)) {
        return null;
    }

    for (const side of ["inputs", "outputs"]) {
        for (let index = 0; index < plantValue(object, side); index += 1) {
            const terminal = plantNodePosition(object, side, index);

            if (terminal && Math.hypot(point.x - terminal.x, point.y - terminal.y) <= tolerance) {
                return { side, index };
            }
        }
    }

    return null;
}

export function setPlantValue(object, key, value) {
    if (!isControlBlock(object)) {
        return false;
    }

    if (
        (key === "inputs" || key === "outputs") &&
        (!Number.isSafeInteger(value) || value < 0)
    ) {
        return false;
    }

    if (
        key !== "inputs" &&
        key !== "outputs" &&
        key !== "showNodeLabels" &&
        key !== "plantLabel" &&
        key !== "blockLabel" &&
        key !== "blockLowerLabel"
    ) {
        return false;
    }

    if (key === "plantLabel" && (!isPlant(object) || typeof value !== "string")) {
        return false;
    }

    if ((key === "blockLabel" || key === "blockLowerLabel") && (!isBlock(object) || typeof value !== "string")) {
        return false;
    }

    object.metadata = {
        ...object.metadata,
        [key]: key === "showNodeLabels" ? Boolean(value) : value
    };

    return true;
}
