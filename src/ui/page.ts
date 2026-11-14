/**
 * The 2D page outside XR: name, one line on how to play, and a button that
 * saves the play log as JSON. All text comes from the i18n files.
 */
import { onLocaleChange, t } from '../i18n/index.ts';

const STYLE = `
.rf-page{position:fixed;top:12px;left:12px;z-index:10;max-width:min(420px,calc(100% - 24px));
box-sizing:border-box;padding:12px 14px;border-radius:10px;background:rgba(11,15,20,.88);color:#fff;
font:15px/1.45 system-ui,'Noto Sans CJK KR','Apple SD Gothic Neo','Hiragino Sans','PingFang SC',sans-serif;
word-break:keep-all;overflow-wrap:break-word}
.rf-page h1{margin:0 0 4px;font-size:20px}
.rf-page p{margin:0 0 8px}
.rf-page button{font:inherit;padding:6px 12px;border-radius:8px;border:1px solid #9aa7b8;background:#2d3a4a;color:#fff;cursor:pointer}
.rf-page button:focus-visible{outline:3px solid #ffd23f;outline-offset:2px}
`;

/** Mounts the overlay. Returns a function that removes it. */
export function mountPage(onDownloadLog: () => void): () => void {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const box = document.createElement('section');
  box.className = 'rf-page';
  const title = document.createElement('h1');
  const tagline = document.createElement('p');
  const hint = document.createElement('p');
  const download = document.createElement('button');
  download.type = 'button';
  download.addEventListener('click', onDownloadLog);
  box.append(title, tagline, hint, download);
  document.body.appendChild(box);

  const render = (): void => {
    title.textContent = t('app.title');
    tagline.textContent = t('app.tagline');
    hint.textContent = t('page.openInHeadset');
    download.textContent = t('page.downloadLog');
  };
  render();
  const off = onLocaleChange(render);

  return () => {
    off();
    box.remove();
    style.remove();
  };
}
