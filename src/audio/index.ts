/**
 * Sound: per-cell positional notes and six synthesized effects, on by default.
 *
 * How the game layer uses it (one line per step):
 * 1. Once: const audio = createSpatialAudio({ rows, cols }); installSfxExportHook() in index.ts.
 * 2. First user action and XR session start: void audio.resume().
 * 3. New board: audio.setBoardSize(board.rows, board.cols).
 * 4. Every frame: audio.setListener(headPosition, headForward, headUp) in world space.
 * 5. Tile turned: audio.playAt('rotate', tileWorldPos, r, c). Turned a tile that cannot turn: playAt('error', ...).
 * 6. A tile newly lit: audio.playAt('connect', tileWorldPos, r, c). Gaze ring step: playAt('gazeTick', ...).
 * 7. Level solved: audio.play('levelDone'). Reach set: audio.play('reachSet').
 * 8. Sound button: audio.setEnabled(on), saved with the other settings.
 */
export { CELL_NOTE_SFX, createSpatialAudio, PANNER, type SpatialAudio, type SpatialAudioOptions, type Vec3Like } from './spatial.ts';
export { playSfx, SFX_DEFAULT_HZ, SFX_NAMES, SFX_SECONDS, type SfxName, type SfxOptions } from './sfx.ts';
export { tilePitch, tileWave, PITCH_BASE_HZ, type Wave } from './pitch.ts';
export { encodeWav, bytesToBase64 } from './wav.ts';
export { exportAllSfx, installSfxExportHook, renderSfx, EXPORT_SAMPLE_RATE, type SfxExportApi } from './export.ts';
