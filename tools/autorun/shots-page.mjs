// Playwright side of shots.sh (MV09): runs through `iwsdk browser run` against
// the managed browser. shots-run.mjs picks the action and its inputs with
// environment variables, because `browser run` takes no script arguments.
//
//   SHOTS_ACTION=sizes                                   page and canvas sizes
//   SHOTS_ACTION=shot      SHOTS_OUT, SHOTS_PAGE=0|1      one picture
//   SHOTS_ACTION=i18n      SHOTS_DIR, SHOTS_LOCALES=a,b   one picture per language, then SHOTS_FINAL_LOCALE
//   SHOTS_ACTION=burst     SHOTS_DIR, SHOTS_CLI, SHOTS_LOOK, SHOTS_AWAY, BURST_*
//
// Pictures are page screenshots (the whole managed tab), with the workspace
// toolbar and the 'Remote Control Active' badge hidden. SHOTS_PAGE=1 keeps the
// app's own 2D page box (title and buttons) in the picture.
export default async function ({ page, frame }) {
  const env = process.env;
  const action = env.SHOTS_ACTION || '';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const sizes = async () =>
    frame.evaluate(() => ({
      inner: [window.innerWidth, window.innerHeight, window.devicePixelRatio],
      canvas: [...document.querySelectorAll('canvas')].map((c) => [c.width, c.height]),
    }));
  const state = async () => frame.evaluate(() => window.__reachfit.state());

  // Hides everything in the workspace page around the app frame, the remote
  // control badge in the app frame, and (unless keepPage) the 2D page box.
  const hideChrome = async (keepPage) => {
    const outer = await page.evaluate(() => {
      const iframe = document.querySelector('iframe');
      let n = 0;
      let node = iframe;
      while (node && node.parentElement) {
        for (const sib of node.parentElement.children) {
          if (sib !== node && sib.tagName !== 'SCRIPT' && sib.tagName !== 'STYLE') {
            sib.style.setProperty('visibility', 'hidden', 'important');
            n++;
          }
        }
        node = node.parentElement;
      }
      return { iframe: !!iframe, hidden: n };
    });
    const inner = await frame.evaluate((keep) => {
      let badge = 0;
      for (const e of document.querySelectorAll('*')) {
        if (e.shadowRoot && /Remote Control Active/.test(e.shadowRoot.textContent || '')) {
          e.style.setProperty('display', 'none', 'important');
          badge++;
        }
      }
      const box = document.querySelector('.rf-page');
      if (box) {
        box.style.setProperty('visibility', keep ? 'visible' : 'hidden', 'important');
      }
      return { badge, pageBox: !!box, keepPage: keep };
    }, keepPage);
    return { outer, inner };
  };

  if (action === 'sizes') {
    return { sizes: await sizes(), viewport: page.viewportSize() };
  }

  if (action === 'shot') {
    const hidden = await hideChrome(env.SHOTS_PAGE === '1');
    await sleep(Number(env.SHOTS_WAIT_MS || 400));
    await page.screenshot({ path: env.SHOTS_OUT });
    return { out: env.SHOTS_OUT, hidden, sizes: await sizes(), state: await state() };
  }

  if (action === 'i18n') {
    const hidden = await hideChrome(env.SHOTS_PAGE === '1');
    const shots = [];
    for (const code of String(env.SHOTS_LOCALES || '').split(',').filter(Boolean)) {
      const ok = await frame.evaluate((c) => window.__reachfit.setLocale(c), code);
      // Canvas text is redrawn on the locale change; wait a few frames.
      await sleep(Number(env.SHOTS_WAIT_MS || 900));
      const st = await state();
      const out = `${env.SHOTS_DIR}/${code}.png`;
      await page.screenshot({ path: out });
      const texts = await frame.evaluate(() => {
        const box = document.querySelector('.rf-page');
        return box ? box.innerText : null;
      });
      shots.push({ code, setLocale: ok, stateLocale: st.locale, levelId: st.levelId, out, pageText: texts });
    }
    const finalLocale = env.SHOTS_FINAL_LOCALE || 'en';
    const restored = await frame.evaluate((c) => window.__reachfit.setLocale(c), finalLocale);
    return { hidden, sizes: await sizes(), shots, restored: { locale: finalLocale, ok: restored } };
  }

  if (action === 'burst') {
    // Pictures in a row while the head looks at one tile through a dwell fire.
    // The look is a CLI call started from here, so the pictures and the look
    // share one clock.
    const { spawn } = await import('node:child_process');
    const hidden = await hideChrome(false);
    const n = Number(env.BURST_N || 14);
    const every = Number(env.BURST_EVERY_MS || 120);
    const lookAtFrame = Number(env.BURST_LOOK_FRAME || 1);
    const awayAfter = Number(env.BURST_AWAY_MS || 1000);
    const look = (target) =>
      new Promise((resolve) => {
        const t0 = Date.now();
        const child = spawn(
          process.execPath,
          [env.SHOTS_CLI, 'xr', 'look-at', '--input-json', JSON.stringify({ device: 'headset', target })],
          { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] },
        );
        let out = '';
        child.stdout.on('data', (d) => (out += d));
        child.on('close', (code) => resolve({ code, ms: Date.now() - t0, ok: /"ok":\s*true/.test(out) }));
      });
    const start = Date.now();
    const frames = [];
    const calls = [];
    let lookStarted = null;
    for (let i = 0; i < n; i++) {
      const t = Date.now();
      if (i === lookAtFrame) {
        lookStarted = t - start;
        calls.push(look(JSON.parse(env.SHOTS_LOOK)).then((r) => ({ kind: 'look', at: lookStarted, ...r })));
        setTimeout(() => {
          calls.push(look(JSON.parse(env.SHOTS_AWAY)).then((r) => ({ kind: 'away', at: Date.now() - start, ...r })));
        }, awayAfter);
      }
      // JPEG: a 1920x1080 PNG took about 300 ms a frame (run of 2026-11-11 20:49), too slow for a 0.8 s ring.
      const out = `${env.SHOTS_DIR}/burst-${String(i).padStart(2, '0')}.jpg`;
      await page.screenshot({ path: out, type: 'jpeg', quality: 95 });
      const st = await state();
      frames.push({ i, tMs: t - start, shotMs: Date.now() - t, out, rotations: st.rotations, solved: st.solved, phase: st.phase });
      const left = every - (Date.now() - t);
      if (left > 0) {
        await sleep(left);
      }
    }
    await sleep(Math.max(0, awayAfter + 1500 - (Date.now() - start - (lookStarted ?? 0))));
    return { hidden, lookStartedMs: lookStarted, frames, calls: await Promise.all(calls), sizes: await sizes() };
  }

  return { error: `unknown SHOTS_ACTION ${action}` };
}
