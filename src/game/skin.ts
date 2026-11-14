/**
 * Puts the MV06 theme on the board the XR layer draws, without changing the
 * layer: the layer keeps its tile entities (Tile_r_c), their interaction and
 * its gaze ring logic, and this module
 *  - hides the placeholder meshes of each tile and of the arc plate
 *    (material.visible = false, so they still take pointer hits),
 *  - hangs a createTileVisual() under each tile root and an arc base under
 *    the board,
 *  - forwards TileView calls (rotation, light, hover, gaze progress, update,
 *    dispose) to that visual by wrapping TileView.prototype once.
 *
 * The wrap is the agreed way to swap the look while src/xr stays read-only
 * for this task (see view.ts header: keep the method names so the swap stays
 * local).
 */
import { Mesh, type Material, type Object3D, type Scene } from '@iwsdk/core';
import type { Board, LightResult, Rotation, TileKind } from '../puzzle/types.ts';
import { tileEntityName, type ReachArc } from '../test-api.ts';
import { createArcBase, createTileVisual, type TileVisual } from '../theme/index.ts';
import { layoutBoard, TILE_SIZE } from '../xr/arc.ts';
import { TileView } from '../xr/view.ts';

/** Same padding the layer gives its plate, in tile sizes (layer.ts showBoard). */
const BASE_PAD_TILES = 0.7;
/** Lift of the arc base over the arc center, m. Same as the layer's plate. */
const BASE_LIFT = 0.001;

const skins = new WeakMap<Object3D, TileVisual>();
let wrapped = false;
let gazeListener: ((tileName: string, progress: number) => void) | null = null;

function hideMeshes(root: Object3D): void {
  root.traverse((o) => {
    if (o instanceof Mesh) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats as Material[]) {
        m.visible = false;
      }
    }
  });
}

/** Wraps TileView.prototype once so calls reach the themed visual too. */
export function wrapTileView(onGaze?: (tileName: string, progress: number) => void): void {
  gazeListener = onGaze ?? null;
  if (wrapped) {
    return;
  }
  wrapped = true;
  const proto = TileView.prototype;
  const base = {
    setRotation: proto.setRotation,
    setLit: proto.setLit,
    setHover: proto.setHover,
    setGazeProgress: proto.setGazeProgress,
    update: proto.update,
    dispose: proto.dispose,
  };
  proto.setRotation = function (this: TileView, rot: Rotation, animate = true): void {
    base.setRotation.call(this, rot, animate);
    skins.get(this.root)?.setRotation(rot, animate);
  };
  proto.setLit = function (this: TileView, lit: boolean, kind: TileKind): void {
    base.setLit.call(this, lit, kind);
    skins.get(this.root)?.setLit(lit);
  };
  proto.setHover = function (this: TileView, on: boolean): void {
    base.setHover.call(this, on);
    skins.get(this.root)?.setHover(on);
  };
  proto.setGazeProgress = function (this: TileView, p: number): void {
    base.setGazeProgress.call(this, p);
    const skin = skins.get(this.root);
    if (skin) {
      skin.setGazeProgress(p);
      gazeListener?.(this.root.name, p);
    }
  };
  proto.update = function (this: TileView, dtSec: number): void {
    base.update.call(this, dtSec);
    skins.get(this.root)?.update(dtSec * 1000);
  };
  proto.dispose = function (this: TileView): void {
    const skin = skins.get(this.root);
    if (skin) {
      skin.dispose();
      skins.delete(this.root);
    }
    base.dispose.call(this);
  };
}

export interface BoardSkin {
  /** Call right after layer.showBoard(board, light). */
  apply(arc: ReachArc, board: Board, light: LightResult): void;
  /** Removes the arc base (tile visuals go with their TileView). */
  clear(): void;
}

export function createBoardSkin(scene: Scene): BoardSkin {
  let arcBase: Mesh | null = null;

  function clear(): void {
    if (arcBase) {
      arcBase.removeFromParent();
      // The material is the theme's shared one; only the shape is ours.
      arcBase.geometry.dispose();
      arcBase = null;
    }
  }

  function apply(arc: ReachArc, board: Board, light: LightResult): void {
    clear();
    const boardRoot = scene.getObjectByName('ReachFitBoard');
    if (!boardRoot) {
      return;
    }
    const plate = boardRoot.getObjectByName('board-base');
    if (plate) {
      hideMeshes(plate);
    }
    const layout = layoutBoard(arc, board.rows, board.cols);
    const inner = layout.rowRadii[layout.rowRadii.length - 1];
    const outer = layout.rowRadii[0];
    const degs = layout.cells.map((c) => c.deg);
    const padDeg = ((TILE_SIZE * BASE_PAD_TILES) / inner) * (180 / Math.PI);
    arcBase = createArcBase({
      innerRadius: inner - TILE_SIZE * BASE_PAD_TILES,
      outerRadius: outer + TILE_SIZE * BASE_PAD_TILES,
      startDeg: Math.min(...degs) - padDeg,
      endDeg: Math.max(...degs) + padDeg,
    });
    arcBase.position.set(arc.center[0], arc.center[1] + BASE_LIFT, arc.center[2]);
    boardRoot.add(arcBase);

    for (const cell of layout.cells) {
      const i = cell.r * board.cols + cell.c;
      const tile = board.tiles[i];
      const root = boardRoot.getObjectByName(tileEntityName(cell.r, cell.c));
      if (!tile || !root || skins.has(root)) {
        continue;
      }
      for (const child of root.children) {
        if (!child.name.startsWith('Grip_')) {
          hideMeshes(child);
        }
      }
      const visual = createTileVisual(tile.kind, tile.rot);
      visual.object3d.scale.setScalar(cell.size);
      root.add(visual.object3d);
      visual.setLit(light.lit[i] ?? false);
      skins.set(root, visual);
    }
  }

  return { apply, clear };
}
