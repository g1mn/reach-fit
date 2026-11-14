import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { installSfxExportHook } from './audio/index.ts';
import { installErrorLog, startGame } from './game/index.ts';
import { initLocale } from './i18n/index.ts';
import { downloadLog, logger } from './logger.ts';
import { installTestApi } from './test-api.ts';
import { mountPage } from './ui/page.ts';

async function main(): Promise<void> {
  // Frame-stepped clock for video capture. The condition is a build-time
  // constant, so production builds drop the import entirely.
  if (import.meta.env.VITE_CAPTURE === '1') {
    await import('./capture/boot.ts');
  }

  // Empty test API until the game is up, so outside scripts never see undefined.
  installTestApi();
  installErrorLog(logger);
  initLocale();
  // WAV export of the effects for video editing. Dev server and capture build only.
  installSfxExportHook();
  mountPage(() => downloadLog(logger));

  const world = await World.create(
    document.getElementById('scene-container') as HTMLDivElement,
    projectOptions,
  );

  // Levels, saving, theme, sound and the real test API.
  startGame(world);
}

void main();
