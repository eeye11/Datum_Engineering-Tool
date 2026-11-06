export const PLANT_KIND = "plant";
export const BLOCK_KIND = "block";
export const GAIN_KIND = "gain";
export const SUM_KIND = "sum";
export const DEFAULT_PLANT_FILL = "#D9D9D9";
export const SUM_NODE_MIN_SPACING = 8;
const CONTROL_NODE_ALIGNMENT_TOLERANCE = 6;

export function isPlant(object) {
    return object?.type === "rectangle" && object.metadata?.controlsKind === PLANT_KIND;
}

export function isBlock(object) {
    return object?.type === "rectangle" && object.metadata?.controlsKind === BLOCK_KIND;
}

export function isGain(object) {
    return object?.type === "rectangle" && object.metadata?.controlsKind === GAIN_KIND;
}

export function isSum(object) {
    return object?.type === "circle" && object.metadata?.controlsKind === SUM_KIND;
}

export function isControlBlock(object) {
    return isPlant(object) || isBlock(object) || isGain(object);
}

export function isControlSymbol(object) {
    return isControlBlock(object) || isSum(object);
}

function cleanCoordinate(value) {
    return Math.abs(value) < 1e-10 ? 0 : value;
}

export function gainTrianglePoints(object) {
    if (!isGain(object)) {
        return [];
    }

    const { position = {}, width, height, rotation = 0 } = object.geometry || {};
    const numericWidth = Number(width);
    const numericHeight = Number(height);

    if (![position.x, position.y, numericWidth, numericHeight, rotation].every(Number.isFinite)) {
        return [];
    }

    const centre = {
        x: position.x + numericWidth / 2,
        y: position.y - numericHeight / 2
    };
    const radians = rotation * Math.PI / 180;

    return [
        [-numericWidth / 2, numericHeight / 2],
        [-numericWidth / 2, -numericHeight / 2],
        [numericWidth / 2, 0]
    ].map(([x, y]) => ({
        x: centre.x + x * Math.cos(radians) - y * Math.sin(radians),
        y: centre.y + x * Math.sin(radians) + y * Math.cos(radians)
    }));
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
    if (!isControlSymbol(object)) {
        return undefined;
    }

    if (key === "inputs" || key === "outputs") {
        if (isGain(object)) {
            return 1;
        }
        if (isSum(object)) {
            if (key === "outputs") {
                return 1;
            }

            const count = Number(object.metadata.inputs);
            return Number.isSafeInteger(count) && count >= 2 ? count : 2;
        }

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

    if (key === "gainValue") {
        return isGain(object) && typeof object.metadata.gainValue === "string"
            ? object.metadata.gainValue
            : "1";
    }

    if (key === "blockLabel" || key === "blockLowerLabel") {
        const value = object.metadata[key];
        return typeof value === "string" ? value : "";
    }

    return undefined;
}

export function plantNodeLabel(object, side, index) {
    if (
        (!isPlant(object) && !isBlock(object)) ||
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
        (!isPlant(object) && !isBlock(object)) ||
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
        !isControlSymbol(object) ||
        (side !== "inputs" && side !== "outputs") ||
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index >= plantValue(object, side)
    ) {
        return null;
    }

    if (isSum(object)) {
        const centre = object.geometry.center;
        const radius = Number(object.geometry.radius);
        if (![centre?.x, centre?.y, radius].every(Number.isFinite) || radius <= 0) {
            return null;
        }

        const angle = sumNodeAngle(object, side, index);
        const rotatedAngle = angle + (Number(object.geometry.rotation) || 0) * Math.PI / 180;
        const terminalRadius = radius + 4;

        return {
            x: cleanCoordinate(centre.x + terminalRadius * Math.cos(rotatedAngle)),
            y: cleanCoordinate(centre.y + terminalRadius * Math.sin(rotatedAngle))
        };
    }

    const { position = {}, width, height, rotation = 0 } = object.geometry || {};
    const numericWidth = Number(width);
    const numericHeight = Number(height);

    if (![position.x, position.y, numericWidth, numericHeight, rotation].every(Number.isFinite)) {
        return null;
    }

    if (isGain(object)) {
        const isInput = side === "inputs";
        const x = isInput ? -numericWidth / 2 : numericWidth / 2;
        const outward = isInput ? -1 : 1;
        const centre = {
            x: position.x + numericWidth / 2,
            y: position.y - numericHeight / 2
        };
        const radians = rotation * Math.PI / 180;
        const localX = x + outward * 4;

        return {
            x: centre.x + localX * Math.cos(radians),
            y: centre.y + localX * Math.sin(radians)
        };
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

export function controlNodeAlignmentOffset(object, candidates, dx, dy) {
    let closest = null;
    const movingNodes = ["inputs", "outputs"].flatMap(side =>
        Array.from({ length: plantValue(object, side) }, (_, index) => ({
            side,
            point: plantNodePosition(object, side, index)
        }))
    );

    for (const target of candidates) {
        if (target.id === object.id || !isControlSymbol(target)) {
            continue;
        }

        for (const moving of movingNodes) {
            if (!moving.point) {
                continue;
            }
            const movingPoint = {
                x: moving.point.x + dx,
                y: moving.point.y + dy
            };
            const targetSide = moving.side === "inputs" ? "outputs" : "inputs";

            for (let index = 0; index < plantValue(target, targetSide); index += 1) {
                const targetPoint = plantNodePosition(target, targetSide, index);
                if (!targetPoint) {
                    continue;
                }

                const xOffset = targetPoint.x - movingPoint.x;
                const yOffset = targetPoint.y - movingPoint.y;
                for (const alignment of [
                    { dx: xOffset, dy: 0 },
                    { dx: 0, dy: yOffset }
                ]) {
                    const distance = Math.abs(alignment.dx || alignment.dy);
                    if (
                        distance > 1e-9 &&
                        distance <= CONTROL_NODE_ALIGNMENT_TOLERANCE &&
                        (!closest || distance < closest.distance)
                    ) {
                        closest = { ...alignment, distance };
                    }
                }
            }
        }
    }

    return closest ? { dx: closest.dx, dy: closest.dy } : null;
}

export function plantNodeAtPoint(object, point, tolerance) {
    if (!isControlSymbol(object) || !point || !Number.isFinite(tolerance)) {
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
    if (!isControlSymbol(object)) {
        return false;
    }

    if (isGain(object) && key !== "gainValue") {
        return false;
    }
    if (isSum(object) && key !== "inputs") {
        return false;
    }

    if (key === "inputs" || key === "outputs") {
        const minimum = isSum(object) && key === "inputs" ? 2 : 0;
        if (!Number.isSafeInteger(value) || value < minimum || (isSum(object) && key === "outputs")) {
            return false;
        }
        if (isSum(object) && !canSetSumInputCount(object, value)) {
            return false;
        }
    }

    if (
        key !== "inputs" &&
        key !== "outputs" &&
        key !== "showNodeLabels" &&
        key !== "plantLabel" &&
        key !== "blockLabel" &&
        key !== "blockLowerLabel" &&
        key !== "gainValue"
    ) {
        return false;
    }

    if (key === "plantLabel" && (!isPlant(object) || typeof value !== "string")) {
        return false;
    }

    if ((key === "blockLabel" || key === "blockLowerLabel") && (!isBlock(object) || typeof value !== "string")) {
        return false;
    }
    if (key === "gainValue" && (!isGain(object) || typeof value !== "string")) {
        return false;
    }

    const metadata = {
        ...object.metadata,
        [key]: key === "showNodeLabels" ? Boolean(value) : value
    };

    if (isSum(object) && key === "inputs") {
        metadata.inputAngles = sumInputAnglesForCount(object, value);
        metadata.inputSigns = Array.from({ length: value }, (_, index) => sumInputSign(object, index) || "+");
    }
    object.metadata = metadata;
    return true;
}

export function sumInputSign(object, index) {
    if (!isSum(object) || !Number.isSafeInteger(index) || index < 0 || index >= plantValue(object, "inputs")) {
        return undefined;
    }

    return object.metadata.inputSigns?.[index] === "-" ? "-" : "+";
}

function defaultSumInputAngle(index, count) {
    return Math.PI / 2 + index * (Math.PI / 2) / (count - 1);
}

export function sumNodeAngle(object, side, index) {
    if (!isSum(object) || !Number.isSafeInteger(index) || index < 0 ||
        index >= plantValue(object, side) || !["inputs", "outputs"].includes(side)) {
        return undefined;
    }

    if (side === "outputs") {
        const angle = Number(object.metadata.outputAngle);
        return Number.isFinite(angle) ? angle : 0;
    }

    const angle = Number(object.metadata.inputAngles?.[index]);
    return Number.isFinite(angle) ? angle : defaultSumInputAngle(index, plantValue(object, "inputs"));
}

function sumNodePointAtAngle(object, angle) {
    const centre = object.geometry.center;
    const terminalRadius = Number(object.geometry.radius) + 4;
    const rotatedAngle = angle + (Number(object.geometry.rotation) || 0) * Math.PI / 180;
    return {
        x: centre.x + terminalRadius * Math.cos(rotatedAngle),
        y: centre.y + terminalRadius * Math.sin(rotatedAngle)
    };
}

function sumInputAnglesForCount(object, count) {
    const currentCount = plantValue(object, "inputs");
    const angles = Array.from(
        { length: Math.min(count, currentCount) },
        (_, index) => sumNodeAngle(object, "inputs", index)
    );
    const outputAngle = sumNodeAngle(object, "outputs", 0);

    while (angles.length < count) {
        const existing = [
            ...angles.map(angle => sumNodePointAtAngle(object, angle)),
            sumNodePointAtAngle(object, outputAngle)
        ];
        let bestAngle = null;
        let bestDistance = -Infinity;

        for (let degrees = 0; degrees < 360; degrees += 1) {
            const angle = degrees * Math.PI / 180;
            const point = sumNodePointAtAngle(object, angle);
            const minimumDistance = Math.min(...existing.map(other => Math.hypot(point.x - other.x, point.y - other.y)));

            if (minimumDistance > bestDistance) {
                bestAngle = angle;
                bestDistance = minimumDistance;
            }
        }

        if (bestDistance < SUM_NODE_MIN_SPACING) {
            return null;
        }
        angles.push(bestAngle);
    }

    return angles;
}

function canSetSumInputCount(object, count) {
    return sumInputAnglesForCount(object, count) !== null;
}

export function setSumInputSign(object, index, value) {
    if (!isSum(object) || !Number.isSafeInteger(index) || index < 0 ||
        index >= plantValue(object, "inputs") || !["+", "-"].includes(value)) {
        return false;
    }

    const signs = Array.from(
        { length: plantValue(object, "inputs") },
        (_, signIndex) => sumInputSign(object, signIndex)
    );
    signs[index] = value;
    object.metadata = { ...object.metadata, inputSigns: signs };
    return true;
}

export function setSumNodeAngle(object, side, index, angle) {
    if (!isSum(object) || !["inputs", "outputs"].includes(side) ||
        !Number.isSafeInteger(index) || index < 0 || index >= plantValue(object, side) ||
        !Number.isFinite(angle)) {
        return false;
    }

    const currentPoint = plantNodePosition(object, side, index);
    const testObject = structuredClone(object);
    const normalizedAngle = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

    if (side === "outputs") {
        testObject.metadata.outputAngle = normalizedAngle;
    } else {
        const angles = Array.from(
            { length: plantValue(object, "inputs") },
            (_, inputIndex) => sumNodeAngle(object, "inputs", inputIndex)
        );
        angles[index] = normalizedAngle;
        testObject.metadata.inputAngles = angles;
    }

    const nextPoint = plantNodePosition(testObject, side, index);
    if (!currentPoint || !nextPoint) {
        return false;
    }

    const otherNodes = [
        ...Array.from({ length: plantValue(object, "inputs") }, (_, inputIndex) =>
            inputIndex === index && side === "inputs"
                ? null
                : plantNodePosition(testObject, "inputs", inputIndex)
        ),
        ...(side === "outputs" ? [] : [plantNodePosition(testObject, "outputs", 0)])
    ].filter(Boolean);

    if (otherNodes.some(point => Math.hypot(nextPoint.x - point.x, nextPoint.y - point.y) < SUM_NODE_MIN_SPACING)) {
        return false;
    }

    if (side === "outputs") {
        object.metadata = { ...object.metadata, outputAngle: normalizedAngle };
    } else {
        const angles = Array.from(
            { length: plantValue(object, "inputs") },
            (_, inputIndex) => sumNodeAngle(object, "inputs", inputIndex)
        );
        angles[index] = normalizedAngle;
        object.metadata = { ...object.metadata, inputAngles: angles };
    }
    return true;
}

export function sumInputSignPosition(object, index) {
    if (!isSum(object) || !Number.isSafeInteger(index) || index < 0 || index >= plantValue(object, "inputs")) {
        return null;
    }

    const centre = object.geometry.center;
    const radius = Number(object.geometry.radius) - 7;
    if (![centre?.x, centre?.y, radius].every(Number.isFinite) || radius <= 0) {
        return null;
    }

    const angle = sumNodeAngle(object, "inputs", index);
    const rotatedAngle = angle + (Number(object.geometry.rotation) || 0) * Math.PI / 180;
    return {
        x: cleanCoordinate(centre.x + radius * Math.cos(rotatedAngle)),
        y: cleanCoordinate(centre.y + radius * Math.sin(rotatedAngle))
    };
}

export function sumNodePortPosition(object, side, index) {
    const terminal = plantNodePosition(object, side, index);
    if (!terminal || !isSum(object)) {
        return null;
    }

    const centre = object.geometry.center;
    const radius = Number(object.geometry.radius);
    const angle = sumNodeAngle(object, side, index) + (Number(object.geometry.rotation) || 0) * Math.PI / 180;
    return {
        x: cleanCoordinate(centre.x + radius * Math.cos(angle)),
        y: cleanCoordinate(centre.y + radius * Math.sin(angle))
    };
}
