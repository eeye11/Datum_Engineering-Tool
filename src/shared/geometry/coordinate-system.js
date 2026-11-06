// Size axes inside the dragged envelope instead of using the diagonal as
// both arm lengths. This keeps the preview under the pointer in any direction.
export function coordinateSystemFromDrag(first, point) {
    const width = Math.abs(point.x - first.x);
    const height = Math.abs(point.y - first.y);
    if (Math.max(width, height) <= 1e-9) return null;
    return {
        origin: { x: Math.min(first.x, point.x), y: Math.min(first.y, point.y) },
        rotation: 0,
        xPositiveLength: width || height * 0.6,
        yPositiveLength: height || width * 0.6,
        xNegativeLength: 0,
        yNegativeLength: 0
    };
}
