/**
 * Theme: high-contrast board and tiles, on by default.
 *
 * How the game layer uses it (one line per step):
 * 1. Per tile: const v = createTileVisual(tile.kind, tile.rot); v.object3d.scale.setScalar(TILE_SIZE); add v.object3d under the Tile_r_c entity.
 * 2. Optional base: createArcBase({ innerRadius, outerRadius, startDeg, endDeg }) at the arc center, table height (meters, not scaled).
 * 3. After every move: v.setRotation(tile.rot) for the turned tile, then v.setLit(trace.lit[i]) for every tile.
 * 4. While gaze dwells on a tile: v.setGazeProgress(heldMs / dwellMs); 0 when the gaze leaves.
 * 5. Hover (hand near or gaze on): v.setHover(true / false).
 * 6. Every frame: updateTheme(dtMs) once, and v.update(dtMs) for each tile.
 * 7. Board change: v.dispose() for each old tile. disposeTheme() and disposeTileShapes() only at shutdown.
 *
 * Panels can use PALETTE.panelBg, panelText and panelAccent; those pairs are
 * in the contrast check too.
 */
export {
  CONTRAST_MODES,
  CONTRAST_PAIRS,
  MIN_CONTRAST,
  PALETTE,
  PALETTES,
  contrastRatio,
  isContrastMode,
  pulseGain,
  type ContrastMode,
  type ContrastPair,
  type Palette,
  type PaletteKey,
} from './palette.ts';
export {
  disposeTheme,
  getThemeMaterials,
  getThemeMode,
  setThemeMode,
  updateTheme,
  type ThemeMaterials,
} from './materials.ts';
export { createTileVisual, disposeTileShapes, TILE_LAYOUT, type TileVisual } from './tile-visual.ts';
export { cellCenter, createArcBase, createBoardBase, type ArcBaseOptions } from './board-base.ts';
