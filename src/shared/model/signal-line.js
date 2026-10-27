import { isControlSymbol, isSum, plantNodePosition, plantValue } from "./plant.js";

const ROUTE_CLEARANCE = 2;
const CROSSOVER_GAP = 3;
const EPSILON = 1e-8;

export function isSignalLine(object) {
    return object?.type === "polyline" && object.metadata?.controlsKind === "signal-line";
}

export function signalInputIsConnected(objects, objectId, index) {
    return (objects || []).some(object => {
        const destination = object?.metadata?.to;

        return isSignalLine(object) &&
            destination?.objectId === objectId &&
            destination.side === "inputs" &&
            destination.index === index;
    });
}

export function signalLinePath(object, objects = []) {
    if (!isSignalLine(object)) {
        return object?.geometry?.points || [];
    }

    const resolveEndpoint = reference => {
        if (!reference?.objectId) {
            return null;
        }

        const owner = objects.find(candidate => candidate?.id === reference?.objectId);
        return owner
            ? plantNodePosition(owner, reference.side, reference.index)
            : null;
    };
    const start = resolveEndpoint(object.metadata?.from);
    const end = resolveEndpoint(object.metadata?.to);

    if (start && end) {
        return routeSignalLine(start, end, objects) || object.geometry?.points || [];
    }

    return object.geometry?.points || [];
}

export function signalNodeAtPoint(objects, point, tolerance, side = null) {
    if (
        !point ||
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        !Number.isFinite(tolerance) ||
        tolerance < 0
    ) {
        return null;
    }

    let nearest = null;
    let nearestDistance = tolerance;

    for (const object of objects || []) {
        if (!isControlSymbol(object)) {
            continue;
        }

        for (const candidateSide of side ? [side] : ["inputs", "outputs"]) {
            for (let index = 0; index < plantValue(object, candidateSide); index += 1) {
                const position = plantNodePosition(object, candidateSide, index);

                if (!position) {
                    continue;
                }

                const distance = Math.hypot(point.x - position.x, point.y - position.y);

                if (distance <= nearestDistance) {
                    nearest = { object, side: candidateSide, index, position };
                    nearestDistance = distance;
                }
            }
        }
    }

    return nearest;
}

function rectangleBounds(object) {
    if (isSum(object)) {
        const { center, radius } = object.geometry || {};
        const numericRadius = Number(radius);

        if (![center?.x, center?.y, numericRadius].every(Number.isFinite) || numericRadius <= 0) {
            return null;
        }

        return {
            minX: center.x - numericRadius,
            maxX: center.x + numericRadius,
            minY: center.y - numericRadius,
            maxY: center.y + numericRadius
        };
    }

    const { position = {}, width, height, rotation = 0 } = object.geometry || {};
    const numericWidth = Number(width);
    const numericHeight = Number(height);

    if (![position.x, position.y, numericWidth, numericHeight, rotation].every(Number.isFinite)) {
        return null;
    }

    const centre = {
        x: position.x + numericWidth / 2,
        y: position.y - numericHeight / 2
    };
    const radians = rotation * Math.PI / 180;
    const corners = [
        [-numericWidth / 2, -numericHeight / 2],
        [numericWidth / 2, -numericHeight / 2],
        [numericWidth / 2, numericHeight / 2],
        [-numericWidth / 2, numericHeight / 2]
    ].map(([x, y]) => ({
        x: centre.x + x * Math.cos(radians) - y * Math.sin(radians),
        y: centre.y + x * Math.sin(radians) + y * Math.cos(radians)
    }));

    return {
        minX: Math.min(...corners.map(point => point.x)),
        maxX: Math.max(...corners.map(point => point.x)),
        minY: Math.min(...corners.map(point => point.y)),
        maxY: Math.max(...corners.map(point => point.y))
    };
}

function insideObstacle(point, obstacles) {
    return obstacles.some(obstacle =>
        point.x > obstacle.minX + EPSILON &&
        point.x < obstacle.maxX - EPSILON &&
        point.y > obstacle.minY + EPSILON &&
        point.y < obstacle.maxY - EPSILON
    );
}

function segmentBlocked(start, end, obstacles) {
    if (Math.abs(start.y - end.y) < EPSILON) {
        const left = Math.min(start.x, end.x);
        const right = Math.max(start.x, end.x);

        return obstacles.some(obstacle =>
            start.y > obstacle.minY + EPSILON &&
            start.y < obstacle.maxY - EPSILON &&
            right > obstacle.minX + EPSILON &&
            left < obstacle.maxX - EPSILON
        );
    }

    const bottom = Math.min(start.y, end.y);
    const top = Math.max(start.y, end.y);

    return obstacles.some(obstacle =>
        start.x > obstacle.minX + EPSILON &&
        start.x < obstacle.maxX - EPSILON &&
        top > obstacle.minY + EPSILON &&
        bottom < obstacle.maxY - EPSILON
    );
}

function uniqueSorted(values) {
    return [...new Set(values.map(value => Number(value.toFixed(8))))].sort((a, b) => a - b);
}

function simplifyPath(points) {
    const result = [];

    for (const point of points) {
        const previous = result[result.length - 1];

        if (previous && (
            Math.hypot(point.x - previous.x, point.y - previous.y) < EPSILON ||
            (result.length > 1 && (
                (Math.abs(result[result.length - 2].x - previous.x) < EPSILON &&
                    Math.abs(previous.x - point.x) < EPSILON) ||
                (Math.abs(result[result.length - 2].y - previous.y) < EPSILON &&
                    Math.abs(previous.y - point.y) < EPSILON)
            ))
        )) {
            if (result.length > 1) {
                result[result.length - 1] = point;
            }
        } else {
            result.push(point);
        }
    }

    return result;
}

export function routeSignalLine(start, end, objects) {
    const obstacles = (objects || [])
        .filter(isControlSymbol)
        .map(rectangleBounds)
        .filter(Boolean)
        .map(bounds => ({
            minX: bounds.minX - ROUTE_CLEARANCE,
            maxX: bounds.maxX + ROUTE_CLEARANCE,
            minY: bounds.minY - ROUTE_CLEARANCE,
            maxY: bounds.maxY + ROUTE_CLEARANCE
        }));

    if (obstacles.some(obstacle => insideObstacle(start, [obstacle]) || insideObstacle(end, [obstacle]))) {
        return null;
    }

    const xs = uniqueSorted([
        start.x,
        end.x,
        ...obstacles.flatMap(obstacle => [obstacle.minX, obstacle.maxX])
    ]);
    const ys = uniqueSorted([
        start.y,
        end.y,
        ...obstacles.flatMap(obstacle => [obstacle.minY, obstacle.maxY])
    ]);
    const points = [];
    const pointIndex = new Map();

    for (let xIndex = 0; xIndex < xs.length; xIndex += 1) {
        for (let yIndex = 0; yIndex < ys.length; yIndex += 1) {
            const point = { x: xs[xIndex], y: ys[yIndex] };

            if (insideObstacle(point, obstacles)) {
                continue;
            }

            const index = points.length;
            points.push(point);
            pointIndex.set(`${xIndex},${yIndex}`, index);
        }
    }

    const startIndex = pointIndex.get(`${xs.indexOf(Number(start.x.toFixed(8)))},${ys.indexOf(Number(start.y.toFixed(8)))}`);
    const endIndex = pointIndex.get(`${xs.indexOf(Number(end.x.toFixed(8)))},${ys.indexOf(Number(end.y.toFixed(8)))}`);

    if (startIndex === undefined || endIndex === undefined) {
        return null;
    }

    const neighbors = points.map(() => []);
    const connect = (a, b, direction) => {
        if (a === undefined || b === undefined || segmentBlocked(points[a], points[b], obstacles)) {
            return;
        }

        const distance = Math.abs(points[a].x - points[b].x) + Math.abs(points[a].y - points[b].y);
        neighbors[a].push({ index: b, direction, distance });
        neighbors[b].push({ index: a, direction, distance });
    };

    for (let xIndex = 0; xIndex < xs.length; xIndex += 1) {
        for (let yIndex = 0; yIndex < ys.length; yIndex += 1) {
            const key = `${xIndex},${yIndex}`;
            const current = pointIndex.get(key);
            connect(current, pointIndex.get(`${xIndex + 1},${yIndex}`), "horizontal");
            connect(current, pointIndex.get(`${xIndex},${yIndex + 1}`), "vertical");
        }
    }

    const queue = [{ index: startIndex, direction: "none", cost: 0 }];
    const distances = new Map([[`${startIndex},none`, 0]]);
    const previous = new Map();
    let destination = null;

    while (queue.length) {
        queue.sort((a, b) => a.cost - b.cost);
        const current = queue.shift();
        const stateKey = `${current.index},${current.direction}`;

        if (current.cost !== distances.get(stateKey)) {
            continue;
        }
        if (current.index === endIndex) {
            destination = stateKey;
            break;
        }

        for (const neighbor of neighbors[current.index]) {
            const bendCost = current.direction === "none" || current.direction === neighbor.direction ? 0 : 12;
            const cost = current.cost + neighbor.distance + bendCost;
            const nextKey = `${neighbor.index},${neighbor.direction}`;

            if (cost < (distances.get(nextKey) ?? Infinity)) {
                distances.set(nextKey, cost);
                previous.set(nextKey, stateKey);
                queue.push({ index: neighbor.index, direction: neighbor.direction, cost });
            }
        }
    }

    if (!destination) {
        return null;
    }

    const path = [];
    let key = destination;

    while (key) {
        path.push(points[Number(key.split(",")[0])]);
        key = previous.get(key);
    }

    return simplifyPath(path.reverse());
}

function perpendicularIntersection(a, b, c, d) {
    const aHorizontal = Math.abs(a.y - b.y) < EPSILON;
    const cHorizontal = Math.abs(c.y - d.y) < EPSILON;

    if (aHorizontal === cHorizontal) {
        return null;
    }

    const horizontalStart = aHorizontal ? a : c;
    const horizontalEnd = aHorizontal ? b : d;
    const verticalStart = aHorizontal ? c : a;
    const verticalEnd = aHorizontal ? d : b;
    const x = verticalStart.x;
    const y = horizontalStart.y;

    if (
        x <= Math.min(horizontalStart.x, horizontalEnd.x) + EPSILON ||
        x >= Math.max(horizontalStart.x, horizontalEnd.x) - EPSILON ||
        y <= Math.min(verticalStart.y, verticalEnd.y) + EPSILON ||
        y >= Math.max(verticalStart.y, verticalEnd.y) - EPSILON
    ) {
        return null;
    }

    return { x, y };
}

export function signalLineSegments(object, objects = []) {
    const points = signalLinePath(object, objects);
    const objectIndex = objects.indexOf(object);
    const gaps = [];

    if (objectIndex >= 0 && isSignalLine(object)) {
        for (const laterLine of objects.slice(objectIndex + 1).filter(isSignalLine)) {
            const laterPath = signalLinePath(laterLine, objects);

            for (let lineIndex = 1; lineIndex < points.length; lineIndex += 1) {
                const previous = points[lineIndex - 1];
                const current = points[lineIndex];
                const segmentLength = Math.hypot(current.x - previous.x, current.y - previous.y);

                for (let pathIndex = 1; pathIndex < laterPath.length; pathIndex += 1) {
                    const intersection = perpendicularIntersection(previous, current, laterPath[pathIndex - 1], laterPath[pathIndex]);

                    if (intersection) {
                        const offset = Math.hypot(intersection.x - previous.x, intersection.y - previous.y);
                        if (
                            offset > CROSSOVER_GAP / 2 &&
                            offset < segmentLength - CROSSOVER_GAP / 2 &&
                            !gaps.some(gap => gap.segmentIndex === lineIndex - 1 && Math.abs(gap.offset - offset) < CROSSOVER_GAP)
                        ) {
                            gaps.push({ segmentIndex: lineIndex - 1, offset });
                        }
                    }
                }
            }
        }
    }

    const segments = [];

    for (let index = 1; index < points.length; index += 1) {
        const start = points[index - 1];
        const end = points[index];
        const length = Math.hypot(end.x - start.x, end.y - start.y);
        const segmentGaps = gaps
            .filter(gap => gap.segmentIndex === index - 1)
            .map(gap => ({
                start: Math.max(0, gap.offset - CROSSOVER_GAP / 2),
                end: Math.min(length, gap.offset + CROSSOVER_GAP / 2)
            }))
            .sort((a, b) => a.start - b.start);
        let cursor = 0;

        const at = distance => ({
            x: start.x + (end.x - start.x) * distance / length,
            y: start.y + (end.y - start.y) * distance / length
        });

        for (const gap of segmentGaps) {
            if (gap.start > cursor + EPSILON) {
                segments.push({
                    start: at(cursor),
                    end: at(gap.start),
                    hasArrow: index === points.length - 1 && gap.end >= length - EPSILON
                });
            }
            cursor = Math.max(cursor, gap.end);
        }

        if (cursor < length - EPSILON) {
            segments.push({
                start: at(cursor),
                end: end,
                hasArrow: index === points.length - 1
            });
        }
    }

    return segments;
}
