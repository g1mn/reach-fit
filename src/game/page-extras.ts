/**
 * Small additions to the 2D page that src/ui/page.ts mounts:
 *  - a 'Start over from level 1' button (also what the autorun clicks, by its
 *    data-testid, so every run starts from L01 whatever the browser saved),
 *  - window error listeners that put page errors into the play log.
 */
import { onLocaleChange, t } from '../i18n/index.ts';
import type { PlayLogger } from '../logger.ts';

/** data-testid of the start-over button (autorun clicks it). */
export const START_OVER_TEST_ID = 'rf-start-over';

/** Adds the button to the page box (or the body). Returns a remover. */
export function mountStartOver(onStartOver: () => void): () => void {
  if (typeof document === 'undefined') {
    return () => {};
  }
  const host = document.querySelector('.rf-page') ?? document.body;
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.testid = START_OVER_TEST_ID;
  button.style.marginLeft = '8px';
  button.style.marginTop = '6px';
  button.addEventListener('click', onStartOver);
  host.appendChild(button);
  const render = (): void => {
    button.textContent = t('page.startOver');
  };
  render();
  const off = onLocaleChange(render);
  return () => {
    off();
    button.remove();
  };
}

/** Logs window errors and unhandled rejections as 'error' events. */
export function installErrorLog(log: PlayLogger): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }
  const onError = (e: ErrorEvent): void => {
    log.push({ type: 'error', message: `window error: ${e.message || String(e.error)}` });
  };
  const onRejection = (e: PromiseRejectionEvent): void => {
    log.push({ type: 'error', message: `unhandled rejection: ${String(e.reason)}` });
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
