const toolHeading = document.getElementById("drawingToolHeading");
const toolList = document.getElementById("drawingToolList");
const drawingCanvas = document.querySelector(".drawing-canvas");
const drawingCoordinates = document.getElementById("drawingCoordinates");
const drawingZoomValue = document.getElementById("drawingZoomValue");
const drawingZoomOut = document.getElementById("drawingZoomOut");
const drawingZoomIn = document.getElementById("drawingZoomIn");
const drawingGridToggle = document.getElementById("drawingGridToggle");
const drawingSnapToggle = document.getElementById("drawingSnapToggle");
const drawingProperties = document.getElementById("drawingProperties");
const drawingToolMessage = document.getElementById("drawingToolMessage");
const drawingComponentsBack = document.getElementById("drawingComponentsBack");
const drawingUndo = document.getElementById("drawingUndo");
const drawingRedo = document.getElementById("drawingRedo");
const drawingThickness = document.getElementById("drawingThickness");
const drawingColor = document.getElementById("drawingColor");
const drawingLineType = document.getElementById("drawingLineType");
const drawingState = enggDrawingState.createDrawingState();
const drawingSnap = enggDrawingSnap;

window.enggDrawing = {
	state: drawingState,
	model: enggDrawingState,
	renderer: enggDrawingRenderer
};

const toolIdByLabel = Object.fromEntries(Object.entries(drawToolLabelById).map(([id, label]) => [label, id]));

function toolDefinitionForLabel(label) {
	return { id: toolIdByLabel[label] || label.toLowerCase().replace(/[^a-z]+/g, "-"), label };
}

function renderToolButton(tool) {
	const active = drawingState.activeTool === tool.id;
	const shortcut = tool.shortcut ? ` (${tool.shortcut})` : "";
	return `<button class="drawing-tool${active ? " active" : ""}" type="button" data-tool-id="${tool.id}" title="${tool.label}${shortcut}" aria-label="${tool.label}${shortcut}" aria-pressed="${active}"><span class="drawing-tool-icon" aria-hidden="true">${toolIcons[tool.label] || ""}</span><span>${tool.label}</span></button>`;
}

function renderEngineeringTools(category) {
	toolHeading.textContent = `${category} TOOLS`;

	if (category === "GEOMETRY") {
		toolList.innerHTML = drawingToolGroups.map(group => `<section class="drawing-tool-group" aria-labelledby="drawing-group-${group.id}"><h3 class="drawing-tool-group-label" id="drawing-group-${group.id}">${group.label}</h3>${group.tools.map(renderToolButton).join("")}</section>`).join("");
	} else {
		toolList.innerHTML = engineeringTools[category].map(label => renderToolButton(toolDefinitionForLabel(label))).join("");
	}

	toolList.querySelectorAll(".drawing-tool").forEach(button => {
		button.addEventListener("click", () => activateTool(button.dataset.toolId));
	});
}

function setToolMessage(message) {
	drawingToolMessage.textContent = message;
}

function activateTool(toolId) {
	const nextTool = drawingState.activeTool === toolId ? null : toolId;
	enggDrawingState.setActiveTool(drawingState, nextTool);
	setToolMessage("Ready");
	renderEngineeringTools(document.querySelector(".drawing-category.active").dataset.category);
	renderCurrentDrawing();
}

function renderCurrentDrawing() {
	drawingCanvas.classList.toggle("drawing-tool-active", Boolean(drawingState.activeTool));
	enggDrawingRenderer.renderDrawing(drawingState, drawingCanvas);
	updateHistoryControls();
}

function updateHistoryControls() {
	drawingUndo.disabled = !enggDrawingState.canUndo(drawingState);
	drawingRedo.disabled = !enggDrawingState.canRedo(drawingState);
}

function performUndo() {
	if (enggDrawingState.undo(drawingState)) {
		renderProperties();
		renderCurrentDrawing();
	}
}

function performRedo() {
	if (enggDrawingState.redo(drawingState)) {
		renderProperties();
		renderCurrentDrawing();
	}
}

function canvasPointFromEvent(event, shouldSnap = false) {
	const bounds = drawingCanvas.getBoundingClientRect();
	return enggDrawingState.screenToEngineering({
		x: event.clientX - bounds.left,
		y: event.clientY - bounds.top
	}, bounds, drawingState, shouldSnap);
}

function isConstructionTool(toolId) {
	return ["line", "polyline", "circle", "arc", "rectangle", "construction"].includes(toolId);
}

function resolvePointerPoint(rawPoint) {
	if (!isConstructionTool(drawingState.activeTool)) {
		return {
			rawPointerPoint: rawPoint,
			effectiveConstructionPoint: rawPoint,
			snapCandidate: null,
			inference: null
		};
	}

	const bounds = drawingCanvas.getBoundingClientRect();
	return drawingSnap.resolveConstructionPoint(rawPoint, drawingState, bounds, {
		lineStart: drawingState.activeTool === "polyline" && drawingState.interaction.points.length ? drawingState.interaction.points.at(-1) : drawingState.interaction.startPoint,
		tool: drawingState.activeTool
	});
}

function updateInteractionFeedback(resolution) {
	const effectivePoint = resolution.effectiveConstructionPoint;
	const feedback = [resolution.inference, resolution.snapCandidate?.type ? resolution.snapCandidate.type[0].toUpperCase() + resolution.snapCandidate.type.slice(1) : null].filter(Boolean);
	drawingCoordinates.textContent = `X: ${effectivePoint.x.toFixed(1)} Y: ${effectivePoint.y.toFixed(1)} mm`;
	drawingToolMessage.textContent = feedback.join(" · ") || (drawingState.interaction.phase === "idle" ? "Ready" : drawingToolMessage.textContent);
}

function updateDrawingCoordinates(event) {
	const rawPoint = canvasPointFromEvent(event);
	const resolution = resolvePointerPoint(rawPoint);
	enggDrawingState.setInteraction(drawingState, resolution);
	updateInteractionFeedback(resolution);
	updatePreview(resolution);
	renderCurrentDrawing();
}

function zoomAtCanvasPoint(nextZoom, event) {
	const bounds = drawingCanvas.getBoundingClientRect();
	const screenPoint = {
		x: event.clientX - bounds.left,
		y: event.clientY - bounds.top
	};
	const engineeringPoint = enggDrawingState.screenToEngineering(screenPoint, bounds, drawingState);
	enggDrawingState.setCameraZoom(drawingState, nextZoom);
	const scale = enggDrawingState.BASE_PIXELS_PER_UNIT * drawingState.camera.zoom;
	drawingState.camera.panX = engineeringPoint.x - (screenPoint.x - bounds.width / 2) / scale;
	drawingState.camera.panY = engineeringPoint.y - (bounds.height / 2 - screenPoint.y) / scale;
	drawingZoom = drawingState.camera.zoom * 100;
	drawingZoomValue.textContent = `${Math.round(drawingZoom)}%`;
	renderCurrentDrawing();
}

function createPreview(type, geometry) {
	return { id: `preview-${type}`, type, geometry, style: { stroke: "#1f5c38", fill: "none", lineWidth: 0.5, lineType: "dashed", opacity: 1 } };
}

function updatePreview(resolution) {
	const interaction = drawingState.interaction;
	if (interaction.phase !== "first-point" || !interaction.startPoint) {
		return;
	}

	const point = resolution.effectiveConstructionPoint;
	interaction.currentPoint = point;
	if (drawingState.activeTool === "line") {
		interaction.preview = createPreview("line", { start: interaction.startPoint, end: point });
		if (!resolution.inference && !resolution.snapCandidate) setToolMessage("Specify second point");
	} else if (drawingState.activeTool === "circle") {
		interaction.preview = createPreview("circle", { center: interaction.startPoint, radius: distance(interaction.startPoint, point) });
		if (!resolution.snapCandidate) setToolMessage("Specify radius");
	} else if (drawingState.activeTool === "rectangle") {
		interaction.preview = createPreview("rectangle", rectangleGeometry(interaction.startPoint, point));
		if (!resolution.snapCandidate) setToolMessage("Specify opposite corner");
	} else if (drawingState.activeTool === "polyline") {
		const points = [...interaction.points, point];
		interaction.preview = createPreview("polyline", { points });
		setToolMessage("Click next point or double-click to finish");
	} else if (drawingState.activeTool === "arc" && interaction.phase === "arc-end") {
		const start = interaction.points[0];
		const end = interaction.points[1];
		const center = circumcenter(start, end, point);
		if (center) {
			const radius = distance(center, start);
			interaction.preview = createPreview("arc", { center, radius, startAngle: Math.atan2(start.y - center.y, start.x - center.x), endAngle: Math.atan2(end.y - center.y, end.x - center.x) });
		}
		setToolMessage("Specify arc curvature");
	}

	renderCurrentDrawing();
}

function distance(first, second) {
	return Math.hypot(second.x - first.x, second.y - first.y);
}

function rectangleGeometry(first, second) {
	const left = Math.min(first.x, second.x);
	const top = Math.max(first.y, second.y);

	return {
		position: {
			x: left,
			y: top
		},
		width: Math.abs(second.x - first.x),
		height: Math.abs(second.y - first.y),
		rotation: 0
	};
}

function beginOrCompleteGeometry(resolution) {
	const interaction = drawingState.interaction;
	const point = resolution.effectiveConstructionPoint;
	if (interaction.phase === "idle") {
		enggDrawingState.setInteraction(drawingState, { ...resolution, phase: drawingState.activeTool === "arc" ? "arc-end" : "first-point", startPoint: point, currentPoint: point, points: [point] });
		setToolMessage(drawingState.activeTool === "polyline" ? "Specify next point" : drawingState.activeTool === "arc" ? "Specify arc endpoint" : "Specify second point");
		renderCurrentDrawing();
		return;
	}
	if (drawingState.activeTool === "polyline") {
		interaction.points.push(point);
		interaction.startPoint = point;
		return;
	}
	if (drawingState.activeTool === "arc" && interaction.phase === "arc-end") {
		interaction.points.push(point);
		interaction.phase = "first-point";
		setToolMessage("Specify arc curvature");
		return;
	}

	const first = interaction.startPoint;
	let object;
	if (drawingState.activeTool === "line") {
		object = enggDrawingState.geometryFactories.line(first, point, { style: { ...drawingState.styleDefaults } });
	} else if (drawingState.activeTool === "circle") {
		object = enggDrawingState.geometryFactories.circle(first, distance(first, point), { style: { ...drawingState.styleDefaults } });
	} else if (drawingState.activeTool === "rectangle") {
		object = enggDrawingState.geometryFactories.rectangle(...Object.values(rectangleGeometry(first, point)), { style: { ...drawingState.styleDefaults } });
	} else if (drawingState.activeTool === "polyline") {
		object = enggDrawingState.geometryFactories.polyline(interaction.points, { style: { ...drawingState.styleDefaults } });
	} else if (drawingState.activeTool === "construction") {
		object = enggDrawingState.geometryFactories.line(first, point, { style: { ...drawingState.styleDefaults, lineType: "construction" }, metadata: { construction: true } });
	} else if (drawingState.activeTool === "arc") {
		const center = circumcenter(interaction.points[0], interaction.points[1], point);
		if (center) {
			object = enggDrawingState.geometryFactories.arc(center, distance(center, interaction.points[0]), Math.atan2(interaction.points[0].y - center.y, interaction.points[0].x - center.x), Math.atan2(interaction.points[1].y - center.y, interaction.points[1].x - center.x), { style: { ...drawingState.styleDefaults } });
		}
	}

	if (object) {
		const previousObjects = enggDrawingState.snapshotDrawing(drawingState);
		enggDrawingState.addObject(drawingState, object);
		enggDrawingState.commitDrawingChange(drawingState, previousObjects);
	}

	enggDrawingState.clearInteraction(drawingState);
	setToolMessage("Ready");
	renderProperties();
	renderCurrentDrawing();
}

function circumcenter(first, second, third) {
	const denominator = 2 * (first.x * (second.y - third.y) + second.x * (third.y - first.y) + third.x * (first.y - second.y));
	if (Math.abs(denominator) < 1e-9) return null;
	const firstSquare = first.x * first.x + first.y * first.y;
	const secondSquare = second.x * second.x + second.y * second.y;
	const thirdSquare = third.x * third.x + third.y * third.y;
	return {
		x: (firstSquare * (second.y - third.y) + secondSquare * (third.y - first.y) + thirdSquare * (first.y - second.y)) / denominator,
		y: (firstSquare * (third.x - second.x) + secondSquare * (first.x - third.x) + thirdSquare * (second.x - first.x)) / denominator
	};
}

function distanceToSegment(point, start, end) {
	const dx = end.x - start.x;
	const dy = end.y - start.y;
	const lengthSquared = dx * dx + dy * dy;
	const ratio = lengthSquared ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)) : 0;
	return distance(point, { x: start.x + ratio * dx, y: start.y + ratio * dy });
}

function objectAtPoint(point) {
	const tolerance = 4 / drawingState.camera.zoom;
	return [...drawingState.objects].reverse().find(object => {
		const geometry = object.geometry;
		if (object.type === "line") return distanceToSegment(point, geometry.start, geometry.end) <= tolerance;
		if (object.type === "circle") return Math.abs(distance(point, geometry.center) - geometry.radius) <= tolerance;
		if (object.type === "rectangle") return point.x >= geometry.position.x - tolerance && point.x <= geometry.position.x + geometry.width + tolerance && point.y <= geometry.position.y + tolerance && point.y >= geometry.position.y - geometry.height - tolerance;
		if (object.type === "polyline") return geometry.points.some((current, index) => index && distanceToSegment(point, geometry.points[index - 1], current) <= tolerance);
		return false;
	});
}

function objectPoints(object) {
	const geometry = object.geometry;
	if (object.type === "line") return [geometry.start, geometry.end];
	if (object.type === "polyline") return geometry.points;
	if (object.type === "circle") return [{ x: geometry.center.x - geometry.radius, y: geometry.center.y - geometry.radius }, { x: geometry.center.x + geometry.radius, y: geometry.center.y + geometry.radius }];
	if (object.type === "rectangle") return [
		geometry.position,
		{ x: geometry.position.x + geometry.width, y: geometry.position.y },
		{ x: geometry.position.x, y: geometry.position.y - geometry.height },
		{ x: geometry.position.x + geometry.width, y: geometry.position.y - geometry.height }
	];
	if (object.type === "arc") return [
		{ x: geometry.center.x + Math.cos(geometry.startAngle) * geometry.radius, y: geometry.center.y + Math.sin(geometry.startAngle) * geometry.radius },
		{ x: geometry.center.x + Math.cos(geometry.endAngle) * geometry.radius, y: geometry.center.y + Math.sin(geometry.endAngle) * geometry.radius }
	];
	return [];
}

function objectInsideSelection(object, selectionBox) {
	const epsilon = 0.5;
	const inside = point => point.x >= selectionBox.minX - epsilon && point.x <= selectionBox.maxX + epsilon && point.y >= selectionBox.minY - epsilon && point.y <= selectionBox.maxY + epsilon;
	const corners = [
		{x: selectionBox.minX, y: selectionBox.minY}, {x: selectionBox.maxX, y: selectionBox.minY},
		{x: selectionBox.maxX, y: selectionBox.maxY}, {x: selectionBox.minX, y: selectionBox.maxY}
	];
	const edges = corners.map((corner, index) => [corner, corners[(index + 1) % 4]]);
	const segmentsIntersect = (a, b, c, d) => {
		const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
		const on = (p, q, r) => Math.abs(cross(p, q, r)) < epsilon && r.x >= Math.min(p.x, q.x) - epsilon && r.x <= Math.max(p.x, q.x) + epsilon && r.y >= Math.min(p.y, q.y) - epsilon && r.y <= Math.max(p.y, q.y) + epsilon;
		const ab = cross(a, b, c) * cross(a, b, d);
		const cd = cross(c, d, a) * cross(c, d, b);
		return ab <= epsilon && cd <= epsilon || on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b);
	};
	const geometrySegments = object => {
		if (object.type === "line") return [[object.geometry.start, object.geometry.end]];
		if (object.type === "polyline") return object.geometry.points.slice(1).map((end, index) => [object.geometry.points[index], end]);
		if (object.type === "rectangle") return rectangleCorners(object.geometry);
		return [];
	};
	const rectangleCorners = geometry => {
		const p = geometry.position;
		return [[p, {x:p.x + geometry.width, y:p.y}], [{x:p.x + geometry.width, y:p.y}, {x:p.x + geometry.width, y:p.y - geometry.height}], [{x:p.x + geometry.width, y:p.y - geometry.height}, {x:p.x, y:p.y - geometry.height}], [{x:p.x, y:p.y - geometry.height}, p]];
	};
	if (object.type === "rectangle") return rectangleCorners(object.geometry).some(segment => edges.some(edge => segmentsIntersect(segment[0], segment[1], edge[0], edge[1]))) || rectangleCorners(object.geometry).some(segment => inside(segment[0]));
	if (object.type === "circle") {
		const center = object.geometry.center;
		const closestX = Math.max(selectionBox.minX, Math.min(center.x, selectionBox.maxX));
		const closestY = Math.max(selectionBox.minY, Math.min(center.y, selectionBox.maxY));
		return inside(center) || distance(center, {x:closestX, y:closestY}) <= object.geometry.radius + epsilon;
	}
	if (object.type === "arc") return objectPoints(object).some(inside) || edges.some(edge => segmentsIntersect(edge[0], edge[1], objectPoints(object)[0], objectPoints(object)[1]));
	const segments = geometrySegments(object);
	return segments.some(segment => inside(segment[0]) || inside(segment[1]) || edges.some(edge => segmentsIntersect(segment[0], segment[1], edge[0], edge[1])));
}

function objectIcon(object) {
	return toolIcons[object.type[0].toUpperCase() + object.type.slice(1)] || toolIcons.Line;
}

function componentGroups() {
	const groups = new Map();
	drawingState.objects.forEach(object => {
		const group = object.type === "construction" ? "Construction" : "Geometry";
		if (!groups.has(group)) groups.set(group, []);
		groups.get(group).push(object);
	});
	return groups;
}

function renderComponentTree() {
	const groups = componentGroups();
	if (!drawingState.objects.length) {
		drawingProperties.innerHTML = "<div class=\"drawing-inspector-message\">No components</div>";
		return;
	}

	const summary = drawingState.selection.selectedObjectIds.length > 1
		? `<div class="drawing-selection-summary">${drawingState.selection.selectedObjectIds.length} components selected</div>`
		: "";
	const tree = [...groups.entries()].map(([groupName, objects]) => `<div class="drawing-component-group">${groupName}</div>${objects.map(object => {
		const selected = drawingState.selection.selectedObjectIds.includes(object.id) || drawingState.selection.boxSelectionIds?.includes(object.id);
		return `<button class="drawing-component-row${selected ? " selected" : ""}" type="button" data-object-id="${object.id}" aria-pressed="${selected}">${objectIcon(object)}<span>${object.name}</span></button>`;
	}).join("")}`).join("");
	drawingProperties.innerHTML = `${summary}<div class="drawing-component-tree">${tree}</div>`;
	drawingProperties.querySelectorAll(".drawing-component-row").forEach(row => {
		row.addEventListener("click", () => {
			enggDrawingState.selectObject(drawingState, row.dataset.objectId);
			renderProperties();
			renderCurrentDrawing();
		});
	});
}

function renderProperties() {
	syncStyleControls();
	const selectedId = drawingState.selection.selectedObjectIds[0];
	const object = drawingState.objects.find(candidate => candidate.id === selectedId);
	if (drawingState.selection.selectedObjectIds.length !== 1 || !object) {
		drawingComponentsBack.style.display = "none";
		renderComponentTree();
		return;
	}
	drawingComponentsBack.style.display = "block";

	const rows = [];
	if (object.type === "line") {
		rows.push(["Start", `(${object.geometry.start.x.toFixed(1)}, ${object.geometry.start.y.toFixed(1)}) mm`]);
		rows.push(["End", `(${object.geometry.end.x.toFixed(1)}, ${object.geometry.end.y.toFixed(1)}) mm`]);
		rows.push(["Length", `${distance(object.geometry.start, object.geometry.end).toFixed(1)} mm`]);
	} else if (object.type === "circle") {
		rows.push(["Center", `(${object.geometry.center.x.toFixed(1)}, ${object.geometry.center.y.toFixed(1)}) mm`]);
		rows.push(["Radius", `${object.geometry.radius.toFixed(1)} mm`]);
	} else if (object.type === "rectangle") {
		rows.push(["Position", `(${object.geometry.position.x.toFixed(1)}, ${object.geometry.position.y.toFixed(1)}) mm`]);
		rows.push(["Size", `${object.geometry.width.toFixed(1)} x ${object.geometry.height.toFixed(1)} mm`]);
	}

	drawingProperties.innerHTML = `<div class="drawing-properties-block"><div class="drawing-properties-title">${object.name}</div><div class="drawing-property-row"><span>Type</span><span>${object.type}</span></div>${rows.map(row => `<div class="drawing-property-row"><span>${row[0]}</span><span>${row[1]}</span></div>`).join("")}<div class="drawing-property-row"><span>Line</span><span>${object.style.lineType}</span></div><div class="drawing-property-row"><span>Width</span><span>${object.style.lineWidth} mm</span></div></div>`;
}

drawingComponentsBack.addEventListener("click", () => {
	drawingComponentsBack.style.display = "none";
	renderComponentTree();
});

function handleCanvasClick(event) {
	if (selectionClickSuppressed) {
		selectionClickSuppressed = false;
		return;
	}
	const resolution = resolvePointerPoint(canvasPointFromEvent(event));
	if (!drawingState.activeTool) {
		return;
	}
	if (["line", "circle", "rectangle", "construction"].includes(drawingState.activeTool)) {
		beginOrCompleteGeometry(resolution);
		return;
	}
	if (["polyline", "arc"].includes(drawingState.activeTool)) {
		beginOrCompleteGeometry(resolution);
		return;
	}

	if (drawingState.activeTool === "select") {
		const object = objectAtPoint(resolution.effectiveConstructionPoint);
		if (object) {
			enggDrawingState.selectObject(drawingState, object.id);
		} else {
			enggDrawingState.clearSelection(drawingState);
		}
		renderProperties();
		renderCurrentDrawing();
	}
}

let selectionClickSuppressed = false;

function beginSelectionDrag(event) {
	if (drawingState.activeTool !== "select" || event.button !== 0) return;
	const point = canvasPointFromEvent(event);
	if (objectAtPoint(point)) return;

	selectionClickSuppressed = false;
	drawingCanvas.setPointerCapture(event.pointerId);
	enggDrawingState.setInteraction(drawingState, {
		selectionStart: point,
		selectionCurrent: point,
		selectionBox: { start: point, end: point, minX: point.x, maxX: point.x, minY: point.y, maxY: point.y },
		selectionDragging: false
	});
}

function updateSelectionDrag(event) {
	if (!drawingState.interaction.selectionStart) return;
	const point = canvasPointFromEvent(event);
	const start = drawingState.interaction.selectionStart;
	const moved = distance(start, point) > 1;
	selectionClickSuppressed = selectionClickSuppressed || moved;
	enggDrawingState.setInteraction(drawingState, {
		selectionCurrent: point,
		selectionDragging: moved,
		selectionBox: {
			start,
			end: point,
			minX: Math.min(start.x, point.x),
			maxX: Math.max(start.x, point.x),
			minY: Math.min(start.y, point.y),
			maxY: Math.max(start.y, point.y)
		}
	});
	if (moved) {
		setToolMessage("Select components");
		drawingState.selection.boxSelectionIds = drawingState.objects.filter(object => objectInsideSelection(object, drawingState.interaction.selectionBox)).map(object => object.id);
		renderProperties();
		renderCurrentDrawing();
	}
}

function finishSelectionDrag(event) {
	if (!drawingState.interaction.selectionStart) return;
	const box = drawingState.interaction.selectionBox;
	if (drawingState.interaction.selectionDragging && box) {
		const selectedIds = drawingState.selection.boxSelectionIds || drawingState.objects.filter(object => objectInsideSelection(object, box)).map(object => object.id);
		enggDrawingState.selectObjects(drawingState, selectedIds);
		drawingState.selection.boxSelectionIds = [];
		renderProperties();
	}
	if (drawingCanvas.hasPointerCapture(event.pointerId)) drawingCanvas.releasePointerCapture(event.pointerId);
	enggDrawingState.setInteraction(drawingState, { selectionStart: null, selectionCurrent: null, selectionBox: null, selectionDragging: false });
	setToolMessage("Ready");
	renderCurrentDrawing();
}

function cancelInteraction() {
	if (drawingState.interaction.phase !== "idle") {
		enggDrawingState.clearInteraction(drawingState);
		setToolMessage("Ready");
		enggDrawingState.setActiveTool(drawingState, null);
		renderEngineeringTools(document.querySelector(".drawing-category.active").dataset.category);
		renderCurrentDrawing();
		return;
	}

	if (drawingState.selection.selectedObjectIds.length) {
		enggDrawingState.clearSelection(drawingState);
		renderProperties();
		renderCurrentDrawing();
	}

	enggDrawingState.setActiveTool(drawingState, null);
	setToolMessage("Ready");
	renderEngineeringTools(document.querySelector(".drawing-category.active").dataset.category);
	renderCurrentDrawing();
}

renderEngineeringTools("GEOMETRY");
drawingCanvas.addEventListener("mousemove", updateDrawingCoordinates);
drawingCanvas.addEventListener("click", handleCanvasClick);
drawingCanvas.addEventListener("dblclick", event => {
	if (drawingState.activeTool !== "polyline" || drawingState.interaction.points.length < 2) return;
	event.preventDefault();
	const previousObjects = enggDrawingState.snapshotDrawing(drawingState);
	enggDrawingState.addObject(drawingState, enggDrawingState.geometryFactories.polyline(drawingState.interaction.points, { style: { ...drawingState.styleDefaults } }));
	enggDrawingState.commitDrawingChange(drawingState, previousObjects);
	enggDrawingState.clearInteraction(drawingState);
	setToolMessage("Ready");
	renderProperties();
	renderCurrentDrawing();
});
drawingCanvas.addEventListener("pointerdown", beginSelectionDrag);
drawingCanvas.addEventListener("pointermove", updateSelectionDrag);
drawingCanvas.addEventListener("pointerup", finishSelectionDrag);
drawingCanvas.addEventListener("wheel", event => {
	event.preventDefault();
	const direction = event.deltaY < 0 ? 1.1 : 0.9;
	zoomAtCanvasPoint(drawingState.camera.zoom * direction, event);
}, { passive: false });

let panSession = null;
drawingCanvas.addEventListener("pointerdown", event => {
	if (drawingState.activeTool !== "pan") {
		return;
	}

	drawingCanvas.setPointerCapture(event.pointerId);
	panSession = { x: event.clientX, y: event.clientY };
	setToolMessage("Pan view");
});

drawingCanvas.addEventListener("pointermove", event => {
	if (!panSession) {
		return;
	}

	const scale = enggDrawingState.BASE_PIXELS_PER_UNIT * drawingState.camera.zoom;
	const deltaX = event.clientX - panSession.x;
	const deltaY = event.clientY - panSession.y;
	enggDrawingState.panCamera(
		drawingState,
		drawingState.camera.panX - deltaX / scale,
		drawingState.camera.panY + deltaY / scale
	);
	panSession = { x: event.clientX, y: event.clientY };
	renderCurrentDrawing();
});

drawingCanvas.addEventListener("pointerup", event => {
	if (panSession) {
		drawingCanvas.releasePointerCapture(event.pointerId);
	}
	panSession = null;
	setToolMessage("Ready");
});

drawingCanvas.addEventListener("mouseleave", () => {
	drawingCoordinates.textContent = "X: 0.0 Y: 0.0 mm";
	enggDrawingState.setInteraction(drawingState, { snapCandidate: null, inference: null });
	renderCurrentDrawing();
});

let drawingZoom = drawingState.camera.zoom * 100;

function updateDrawingZoom(nextZoom) {
	drawingZoom = Math.min(500, Math.max(25, nextZoom));
	enggDrawingState.setCameraZoom(drawingState, drawingZoom / 100);
	drawingZoomValue.textContent = `${drawingZoom}%`;
	renderCurrentDrawing();
}

drawingZoomOut.addEventListener("click", () => updateDrawingZoom(drawingZoom - 10));
drawingZoomIn.addEventListener("click", () => updateDrawingZoom(drawingZoom + 10));

function toggleWorkspaceSetting(button, label) {
	const enabled = button.getAttribute("aria-pressed") === "true";
	button.setAttribute("aria-pressed", String(!enabled));
	button.textContent = `${label} ${enabled ? "OFF" : "ON"}`;
	button.classList.toggle("active", !enabled);

	if (button === drawingGridToggle) {
		drawingState.grid.visible = !enabled;
		drawingCanvas.classList.toggle("grid-off", enabled);
	} else if (button === drawingSnapToggle) {
		drawingState.snap.enabled = !enabled;
	}
}

function applyStyleControls() {
	const selectedIds = drawingState.selection.selectedObjectIds;
	const nextStyle = {
		lineWidth: Number(drawingThickness.value),
		stroke: drawingColor.value,
		lineType: drawingLineType.value
	};
	if (!selectedIds.length) {
		drawingState.styleDefaults = { ...drawingState.styleDefaults, ...nextStyle };
		return;
	}
	const previousObjects = enggDrawingState.snapshotDrawing(drawingState);
	drawingState.objects.filter(object => selectedIds.includes(object.id)).forEach(object => {
		object.style = { ...object.style, ...nextStyle };
	});
	enggDrawingState.commitDrawingChange(drawingState, previousObjects);
	renderProperties();
	renderCurrentDrawing();
}

function syncStyleControls() {
	const object = drawingState.objects.find(candidate => drawingState.selection.selectedObjectIds.includes(candidate.id));
	const style = object?.style || drawingState.styleDefaults;
	drawingThickness.value = String(style.lineWidth);
	drawingColor.value = style.stroke;
	drawingLineType.value = style.lineType;
}

drawingGridToggle.addEventListener("click", () => toggleWorkspaceSetting(drawingGridToggle, "Grid"));
drawingSnapToggle.addEventListener("click", () => toggleWorkspaceSetting(drawingSnapToggle, "Snap"));
drawingUndo.addEventListener("click", performUndo);
drawingRedo.addEventListener("click", performRedo);
drawingThickness.addEventListener("change", applyStyleControls);
drawingColor.addEventListener("change", applyStyleControls);
drawingLineType.addEventListener("change", applyStyleControls);


function deleteSelectedObjects() {
    const selectedIds = [...drawingState.selection.selectedObjectIds];

    if (!selectedIds.length) {
        return;
    }

    // Do not delete while a drawing operation is unfinished.
    if (drawingState.interaction.phase !== "idle") {
        return;
    }

    // Save the current drawing so this entire delete
    // operation can be undone in one step.
    const previousObjects =
        enggDrawingState.snapshotDrawing(drawingState);

    const selectedSet = new Set(selectedIds);

    drawingState.objects =
        drawingState.objects.filter(
            object => !selectedSet.has(object.id)
        );

    // Clear selection-related state.
    drawingState.selection.selectedObjectIds = [];
    drawingState.selection.boxSelectionIds = [];
    drawingState.selection.hoveredObjectId = null;

    // Clear temporary hover/snap references.
    drawingState.interaction.hoveredEntity = null;
    drawingState.interaction.snapCandidate = null;

    // One Delete operation = one Undo history entry.
    enggDrawingState.commitDrawingChange(
        drawingState,
        previousObjects
    );

    renderProperties();
    renderCurrentDrawing();

    setToolMessage(
        `Deleted ${selectedIds.length} component${selectedIds.length === 1 ? "" : "s"}`
    );
}

document.addEventListener("keydown", event => {
	const editable =
		["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName) ||
		document.activeElement?.isContentEditable;

	// Undo
	if (!editable && event.ctrlKey && event.key.toLowerCase() === "z") {
		event.preventDefault();

		if (event.shiftKey) {
			performRedo();
		} else {
			performUndo();
		}

		return;
	}

	// Redo
	if (!editable && event.ctrlKey && event.key.toLowerCase() === "y") {
		event.preventDefault();
		performRedo();
		return;
	}

	// Escape
	if (event.key === "Escape") {
		event.preventDefault();

		if (drawingState.interaction.selectionStart) {
			enggDrawingState.clearInteraction(drawingState);
			setToolMessage("Ready");
			renderCurrentDrawing();
		} else {
			cancelInteraction();
		}

		return;
	}

	// Ignore shortcuts while typing
	if (editable) {
		return;
	}

	// Delete selected objects
	if (event.code === "Delete" || event.key === "Delete") {
		event.preventDefault();
		deleteSelectedObjects();
		return;
	}

	// Tool shortcuts
	const shortcut = event.key.toUpperCase();
	const tool = drawToolDefinitions.find(
		candidate => candidate.shortcut === shortcut
	);

	if (tool) {
		activateTool(tool.id);
	}
});

renderCurrentDrawing();
renderProperties();
