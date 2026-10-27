// Map the model camera into the coordinate space of the compiled TikZ picture.
// The backend seats the picture at zero; the source writers translate and
// uniformly scale model coordinates for export. Both mappings must be respected.
export function pictureViewBox(bounds, camera, pixelsPerUnit, transform) {
    const zoom = Number(camera?.zoom) || 1;
    const k = pixelsPerUnit * zoom;
    const width = bounds.width / k;
    const height = bounds.height / k;
    const panX = Number(camera?.panX) || 0;
    const panY = Number(camera?.panY) || 0;
    const point = transform?.point(panX - width / 2, panY + height / 2)
        || { x: panX - width / 2, y: panY + height / 2 };
    const scale = (transform?.factor ?? 1) * 72.27 / 25.4;
    const pt = 72.27 / 25.4;
    return [point.x * pt, -point.y * pt, width * scale, height * scale];
}
