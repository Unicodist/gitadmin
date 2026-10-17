// Pan and zoom of the canvas graph. The viewport is the point of the graph at the top left corner of the canvas and
// the zoom, a point of the graph is drawn at (point - origin) * zoom.

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 3;
// Zoom of a step of the buttons and of the keyboard
export const ZOOM_STEP = 1.25;

export function clampZoom(zoom: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function toScreen(viewport: Viewport, x: number, y: number): [number, number] {
  return [(x - viewport.x) * viewport.zoom, (y - viewport.y) * viewport.zoom];
}

export function toWorld(viewport: Viewport, x: number, y: number): [number, number] {
  return [viewport.x + x / viewport.zoom, viewport.y + y / viewport.zoom];
}

// Moves the graph by a number of pixels of the screen
export function panBy(viewport: Viewport, dx: number, dy: number): Viewport {
  return { x: viewport.x - dx / viewport.zoom, y: viewport.y - dy / viewport.zoom, zoom: viewport.zoom };
}

// Zooms in or out around a point of the screen, which stays under the pointer
export function zoomAt(viewport: Viewport, zoom: number, x: number, y: number): Viewport {
  const newZoom = clampZoom(zoom);
  const [worldX, worldY] = toWorld(viewport, x, y);
  return { x: worldX - x / newZoom, y: worldY - y / newZoom, zoom: newZoom };
}

// Puts a point of the graph in the middle of a canvas of this size
export function centerOn(viewport: Viewport, x: number, y: number, width: number, height: number): Viewport {
  return { x: x - width / 2 / viewport.zoom, y: y - height / 2 / viewport.zoom, zoom: viewport.zoom };
}

// True if the point of the graph is in the canvas, at least margin pixels from its sides
export function isVisible(viewport: Viewport, x: number, y: number, width: number, height: number, margin = 0) {
  const [screenX, screenY] = toScreen(viewport, x, y);
  return screenX >= margin && screenX <= width - margin && screenY >= margin && screenY <= height - margin;
}

// Shows the whole graph, or its top left corner when it is too big for the smallest zoom
export function fitBounds(bounds: Bounds, width: number, height: number, padding: number, maxZoom = 1): Viewport {
  const availableWidth = Math.max(1, width - 2 * padding);
  const availableHeight = Math.max(1, height - 2 * padding);
  const fit = Math.min(availableWidth / Math.max(1, bounds.width), availableHeight / Math.max(1, bounds.height));
  const zoom = clampZoom(Math.min(maxZoom, fit));
  const x = zoom * bounds.width <= availableWidth ?
    bounds.x + bounds.width / 2 - width / 2 / zoom :
    bounds.x - padding / zoom;
  const y = zoom * bounds.height <= availableHeight ?
    bounds.y + bounds.height / 2 - height / 2 / zoom :
    bounds.y - padding / zoom;
  return { x, y, zoom };
}

// Keeps at least margin pixels of the graph in the canvas, so that it cannot be lost by panning
export function clampViewport(viewport: Viewport, bounds: Bounds, width: number, height: number, margin: number): Viewport {
  const clampAxis = (origin: number, start: number, size: number, screenSize: number) => {
    const min = start + Math.min(size, margin / viewport.zoom) - screenSize / viewport.zoom;
    const max = start + size - Math.min(size, margin / viewport.zoom);
    return Math.min(max, Math.max(min, origin));
  };
  return {
    x: clampAxis(viewport.x, bounds.x, bounds.width, width),
    y: clampAxis(viewport.y, bounds.y, bounds.height, height),
    zoom: viewport.zoom
  };
}

// Rows of the graph in the canvas, from start included to end excluded, the rows are rowHeight high from y = 0
export function getVisibleRows(viewport: Viewport, height: number, rowHeight: number, count: number): [number, number] {
  const start = Math.max(0, Math.floor(viewport.y / rowHeight));
  const end = Math.min(count, Math.ceil((viewport.y + height / viewport.zoom) / rowHeight));
  return [start, Math.max(start, end)];
}

// Zoom of a wheel event: a pinch of the trackpad comes as a wheel event with Ctrl, its steps are smaller
export function getWheelZoom(zoom: number, deltaY: number, deltaMode: number) {
  // Lines and pages are turned into pixels
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return clampZoom(zoom * Math.exp(-pixels * 0.0025));
}
