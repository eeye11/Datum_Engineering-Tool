/* Derived object snapping and geometric inference for construction tools. */
(function () {
    const SNAP_TOLERANCE_PX = 10;
    const INFERENCE_TOLERANCE_DEGREES = 7;
    const SNAP_PRIORITY = {
        endpoint: 1,
        intersection: 2,
        center: 3,
        midpoint: 4,
        quadrant: 5,
        pointOnEntity: 6
    };

    function point(x, y) {
        return { x, y };
    }

    function addCandidate(candidates, type, objectId, candidatePoint) {
        candidates.push({
            type,
            objectId,
            point: { ...candidatePoint },
            priority: SNAP_PRIORITY[type]
        });
    }

    function segmentCandidates(candidates, objectId, start, end) {
        addCandidate(candidates, "endpoint", objectId, start);
        addCandidate(candidates, "endpoint", objectId, end);
        addCandidate(candidates, "midpoint", objectId, point((start.x + end.x) / 2, (start.y + end.y) / 2));
    }

    function rectangleSegments(geometry) {
        const left = geometry.position.x;
        const right = left + geometry.width;
        const top = geometry.position.y;
        const bottom = top - geometry.height;
        return [
            [point(left, top), point(right, top)],
            [point(right, top), point(right, bottom)],
            [point(right, bottom), point(left, bottom)],
            [point(left, bottom), point(left, top)]
        ];
    }

    function angleOnArc(angle, startAngle, endAngle) {
        const twoPi = Math.PI * 2;
        const normalize = value => (value + twoPi) % twoPi;
        const start = normalize(startAngle);
        const end = normalize(endAngle);
        const current = normalize(angle);
        if (end >= start) {
            return current >= start && current <= end;
        }
        return current >= start || current <= end;
    }

    function addObjectCandidates(candidates, object) {
        const geometry = object.geometry;
        if (object.type === "line") {
            segmentCandidates(candidates, object.id, geometry.start, geometry.end);
        } else if (object.type === "polyline") {
            geometry.points.forEach((current, index) => {
                addCandidate(candidates, "endpoint", object.id, current);
                if (index > 0) {
                    const previous = geometry.points[index - 1];
                    addCandidate(candidates, "midpoint", object.id, point((previous.x + current.x) / 2, (previous.y + current.y) / 2));
                }
            });
        } else if (object.type === "rectangle") {
            rectangleSegments(geometry).forEach(([start, end]) => segmentCandidates(candidates, object.id, start, end));
        } else if (object.type === "circle") {
            addCandidate(candidates, "center", object.id, geometry.center);
            [0, Math.PI / 2, Math.PI, Math.PI * 1.5].forEach(angle => {
                addCandidate(candidates, "quadrant", object.id, point(
                    geometry.center.x + Math.cos(angle) * geometry.radius,
                    geometry.center.y + Math.sin(angle) * geometry.radius
                ));
            });
        } else if (object.type === "arc") {
            const start = point(
                geometry.center.x + Math.cos(geometry.startAngle) * geometry.radius,
                geometry.center.y + Math.sin(geometry.startAngle) * geometry.radius
            );
            const end = point(
                geometry.center.x + Math.cos(geometry.endAngle) * geometry.radius,
                geometry.center.y + Math.sin(geometry.endAngle) * geometry.radius
            );
            addCandidate(candidates, "endpoint", object.id, start);
            addCandidate(candidates, "endpoint", object.id, end);
            addCandidate(candidates, "center", object.id, geometry.center);
            [0, Math.PI / 2, Math.PI, Math.PI * 1.5].forEach(angle => {
                if (angleOnArc(angle, geometry.startAngle, geometry.endAngle)) {
                    addCandidate(candidates, "quadrant", object.id, point(
                        geometry.center.x + Math.cos(angle) * geometry.radius,
                        geometry.center.y + Math.sin(angle) * geometry.radius
                    ));
                }
            });
        }
    }

    function lineIntersection(firstStart, firstEnd, secondStart, secondEnd) {
        const denominator = (firstStart.x - firstEnd.x) * (secondStart.y - secondEnd.y) - (firstStart.y - firstEnd.y) * (secondStart.x - secondEnd.x);
        if (Math.abs(denominator) < 1e-9) {
            return null;
        }

        const firstCross = firstStart.x * firstEnd.y - firstStart.y * firstEnd.x;
        const secondCross = secondStart.x * secondEnd.y - secondStart.y * secondEnd.x;
        const x = (firstCross * (secondStart.x - secondEnd.x) - (firstStart.x - firstEnd.x) * secondCross) / denominator;
        const y = (firstCross * (secondStart.y - secondEnd.y) - (firstStart.y - firstEnd.y) * secondCross) / denominator;
        const within = (start, end, value) => value >= Math.min(start, end) - 1e-9 && value <= Math.max(start, end) + 1e-9;
        return within(firstStart.x, firstEnd.x, x) && within(firstStart.y, firstEnd.y, y) && within(secondStart.x, secondEnd.x, x) && within(secondStart.y, secondEnd.y, y) ? point(x, y) : null;
    }

    function lineSegments(object) {
        if (object.type === "line") {
            return [[object.geometry.start, object.geometry.end]];
        }
        if (object.type === "polyline") {
            return object.geometry.points.slice(1).map((end, index) => [object.geometry.points[index], end]);
        }
        if (object.type === "rectangle") {
            return rectangleSegments(object.geometry);
        }
        return [];
    }

    function addIntersections(candidates, objects) {
        objects.forEach((first, firstIndex) => {
            const firstSegments = lineSegments(first);
            objects.slice(firstIndex + 1).forEach(second => {
                lineSegments(second).forEach(secondSegment => {
                    firstSegments.forEach(firstSegment => {
                        const intersection = lineIntersection(firstSegment[0], firstSegment[1], secondSegment[0], secondSegment[1]);
                        if (intersection) {
                            addCandidate(candidates, "intersection", `${first.id}:${second.id}`, intersection);
                        }
                    });
                });
            });
        });
    }

    function closestPointOnSegment(target, start, end) {
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const lengthSquared = dx * dx + dy * dy;
        const ratio = lengthSquared ? Math.max(0, Math.min(1, ((target.x - start.x) * dx + (target.y - start.y) * dy) / lengthSquared)) : 0;
        return point(start.x + ratio * dx, start.y + ratio * dy);
    }

    function closestPointOnObject(rawPoint, object) {
        const geometry = object.geometry;
        if (object.type === "line") return closestPointOnSegment(rawPoint, geometry.start, geometry.end);
        if (object.type === "polyline") {
            return geometry.points.slice(1).map((end, index) => closestPointOnSegment(rawPoint, geometry.points[index], end)).sort((a, b) => Math.hypot(a.x - rawPoint.x, a.y - rawPoint.y) - Math.hypot(b.x - rawPoint.x, b.y - rawPoint.y))[0];
        }
        if (object.type === "circle" || object.type === "arc") {
            const angle = Math.atan2(rawPoint.y - geometry.center.y, rawPoint.x - geometry.center.x);
            const candidate = point(geometry.center.x + Math.cos(angle) * geometry.radius, geometry.center.y + Math.sin(angle) * geometry.radius);
            return object.type === "circle" || angleOnArc(angle, geometry.startAngle, geometry.endAngle) ? candidate : null;
        }
        if (object.type === "rectangle") {
            const candidates = rectangleSegments(geometry).map(segment => closestPointOnSegment(rawPoint, segment[0], segment[1]));
            return candidates.sort((a, b) => Math.hypot(a.x - rawPoint.x, a.y - rawPoint.y) - Math.hypot(b.x - rawPoint.x, b.y - rawPoint.y))[0];
        }
        return null;
    }

    function curveHoverDistance(rawPoint, object, state) {
        const geometry = object.geometry;
        const scale = enggDrawingState.BASE_PIXELS_PER_UNIT * state.camera.zoom;
        const distanceFromCenter = Math.hypot(rawPoint.x - geometry.center.x, rawPoint.y - geometry.center.y);
        const curveDistance = Math.abs(distanceFromCenter - geometry.radius) * scale;

        if (object.type === "circle") {
            return curveDistance;
        }

        const angle = Math.atan2(rawPoint.y - geometry.center.y, rawPoint.x - geometry.center.x);
        return angleOnArc(angle, geometry.startAngle, geometry.endAngle) ? curveDistance : Infinity;
    }

    function buildSnapCandidates(state) {
        const candidates = [];
        state.objects.forEach(object => addObjectCandidates(candidates, object));
        addIntersections(candidates, state.objects);
        return candidates;
    }

    function findSnapCandidate(rawPoint, state, bounds) {
        if (!state.objectSnap.enabled || !state.objects.length) {
            return null;
        }

        const rawScreenPoint = enggDrawingState.engineeringToScreen(rawPoint, bounds, state);
        const candidates = buildSnapCandidates(state);
        const nearby = candidates.map(candidate => {
            const screenPoint = enggDrawingState.engineeringToScreen(candidate.point, bounds, state);
            return {
                ...candidate,
                screenPoint,
                distance: Math.hypot(screenPoint.x - rawScreenPoint.x, screenPoint.y - rawScreenPoint.y)
            };
        }).filter(candidate => candidate.distance <= state.objectSnap.tolerancePx);

        state.objects.forEach(object => {
            const closest = closestPointOnObject(rawPoint, object);
            if (!closest) return;
            const screenPoint = enggDrawingState.engineeringToScreen(closest, bounds, state);
            const distance = Math.hypot(screenPoint.x - rawScreenPoint.x, screenPoint.y - rawScreenPoint.y);
            if (distance <= state.objectSnap.tolerancePx) {
                nearby.push({ type: "pointOnEntity", objectId: object.id, point: closest, priority: SNAP_PRIORITY.pointOnEntity, screenPoint, distance });
            }
        });

        state.objects.forEach(object => {
            if (object.type !== "circle" && object.type !== "arc") return;
            const distanceToCurve = curveHoverDistance(rawPoint, object, state);
            if (distanceToCurve > state.objectSnap.tolerancePx) return;
            const centerCandidate = candidates.find(candidate => candidate.objectId === object.id && candidate.type === "center");
            if (!centerCandidate) return;
            nearby.push({
                ...centerCandidate,
                screenPoint: enggDrawingState.engineeringToScreen(centerCandidate.point, bounds, state),
                distance: distanceToCurve,
                source: "curve-hover"
            });
        });

        nearby.sort((first, second) => {
            if (Math.abs(first.distance - second.distance) <= 3) {
                return first.priority - second.priority;
            }
            return first.distance - second.distance;
        });

        return nearby[0] || null;
    }

    function inferLinePoint(startPoint, targetPoint) {
        const dx = targetPoint.x - startPoint.x;
        const dy = targetPoint.y - startPoint.y;
        const angle = Math.atan2(dy, dx) * 180 / Math.PI;
        const tolerance = INFERENCE_TOLERANCE_DEGREES;
        const horizontal = Math.min(Math.abs(angle), Math.abs(Math.abs(angle) - 180)) <= tolerance;
        const vertical = Math.abs(Math.abs(angle) - 90) <= tolerance;

        if (horizontal) {
            return { point: { x: targetPoint.x, y: startPoint.y }, type: "Horizontal" };
        }
        if (vertical) {
            return { point: { x: startPoint.x, y: targetPoint.y }, type: "Vertical" };
        }
        return { point: targetPoint, type: null };
    }

    function resolveConstructionPoint(rawPoint, state, bounds, options = {}) {
        const snapCandidate = findSnapCandidate(rawPoint, state, bounds);
        const snappedPoint = snapCandidate ? { ...snapCandidate.point } : null;
        let effectivePoint = snappedPoint || (state.snap.enabled ? {
            x: enggDrawingState.snapCoordinate(rawPoint.x, state),
            y: enggDrawingState.snapCoordinate(rawPoint.y, state)
        } : { ...rawPoint });
        let inference = null;

        if (options.lineStart && options.tool === "line") {
            const inferred = inferLinePoint(options.lineStart, effectivePoint);
            inference = inferred.type;
            if (!snapCandidate) {
                effectivePoint = inferred.point;
            }
        }

        return {
            rawPointerPoint: { ...rawPoint },
            snappedPoint,
            inferredPoint: inference ? { ...effectivePoint } : null,
            effectiveConstructionPoint: effectivePoint,
            snapCandidate,
            hoveredEntity: snapCandidate?.objectId || null,
            inference
        };
    }

    window.enggDrawingSnap = {
        SNAP_TOLERANCE_PX,
        INFERENCE_TOLERANCE_DEGREES,
        buildSnapCandidates,
        findSnapCandidate,
        inferLinePoint,
        resolveConstructionPoint
    };
})();
