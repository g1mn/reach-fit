/**
 * Public surface of the XR layer for src/index.ts and, later, src/game (MV08).
 */
export { createXrLayer } from './layer.ts';
export type { LayerPhase, MessagePart, XrLayer, XrLayerCallbacks, XrLayerOptions } from './layer.ts';
export { startStandalone } from './standalone.ts';
export type { Standalone } from './standalone.ts';
export { BUTTON_NAMES } from './view.ts';
export type { ButtonName } from './view.ts';
export { DWELL_MS, DWELL_REPEAT_MS } from './dwell.ts';
export { TILE_SIZE, layoutBoard } from './arc.ts';
export { puzzle } from './puzzle-source.ts';
