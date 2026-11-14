/**
 * Textures made in code. No image files.
 *
 * Both are gray gain maps (no color space): the material color carries the
 * palette color and the map only darkens it, never below the gains that
 * palette.ts checks.
 */
import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  RGBAFormat,
  UnsignedByteType,
} from 'three';
import { makeGrainData } from './grain.ts';
import { BOARD_GRAIN_MIN_GAIN, GRAIN_MIN_GAIN } from './palette.ts';

/** Design value: pixels per side of each texture. */
export const TEXTURE_SIZE = 128;

function grainTexture(data: Uint8Array, size: number, repeat: boolean): DataTexture {
  const tex = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  tex.wrapS = repeat ? RepeatWrapping : ClampToEdgeWrapping;
  tex.wrapT = repeat ? RepeatWrapping : ClampToEdgeWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** Fine grain with a soft bevel, for tile faces. */
export function createFaceTexture(): DataTexture {
  const data = makeGrainData({
    size: TEXTURE_SIZE,
    minGain: GRAIN_MIN_GAIN,
    seed: 17,
    cells: 6,
    bevel: true,
  });
  return grainTexture(data, TEXTURE_SIZE, false);
}

/** Coarser repeating grain for the dark base. */
export function createBoardTexture(): DataTexture {
  const data = makeGrainData({
    size: TEXTURE_SIZE,
    minGain: BOARD_GRAIN_MIN_GAIN,
    seed: 29,
    cells: 4,
  });
  return grainTexture(data, TEXTURE_SIZE, true);
}
