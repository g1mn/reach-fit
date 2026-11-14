/**
 * Public surface of the game layer for src/index.ts.
 */
export { startGame } from './game.ts';
export type { Game } from './game.ts';
export { installErrorLog, mountStartOver, START_OVER_TEST_ID } from './page-extras.ts';
export { DAILY_INDEX, MAIN_LEVEL_COUNT, flowReducer, initialFlow, resumeIndex } from './flow.ts';
export type { FlowEvent, FlowState } from './flow.ts';
export { BRIDGE_LINE_MAX, chunkForLines, logLines } from './bridge.ts';
