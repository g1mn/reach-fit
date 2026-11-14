# Autorun

Plays Reach Fit in the IWSDK emulator (Immersive Web Emulation Runtime) with no headset, in one of two ways:

- `pinch`: hand tracking. The right index finger tip sweeps an arc at table height (`sequences/sweep-right.json`), then every turn is a pinch over the tile (`xr run-sequence`): the hand's grasp point (where thumb and index meet) goes 2 cm over the tile center the app reports in `remaining[].position`, fingers down, then pinches in place. Not by `target: Tile_r_c`: with a target the CLI put the grasp on the near side of the tile's box, 3.4 cm toward the body for Tile_1_4 of L05, and the app (nearest center to the pinch point, src/xr/pinch.ts) turned Tile_1_3 every time (run of 2026-11-11 07:49). Buttons are pressed with the finger tip (`press` on the button name).
- `gaze`: head only. Both hands and both controllers are disconnected. After the layer's hand wait it asks for the two edges; the script looks left and right (`sequences/gaze-calibrate.json`). Every turn is a look at the tile center (`xr look-at headset`) held through one dwell fire, 1.0 s in all (the app's 0.8 s dwell plus 0.2 s), then a look away. The tile fires again 1.2 s after the first fire, so a slow look-away call turns it twice: with a 1.4 s look one look-away call took 924 ms and L05 took 7 turns for 5 (run of 2026-11-11 20:02). Buttons are pressed the same way.

```bash
bash tools/autorun/autorun.sh pinch            # 12 levels + today's board
bash tools/autorun/autorun.sh gaze --levels 2  # short run, no daily board
```

Options: `--levels N` (1 to 12; the daily board is added only when N is 12), `--locale CODE` (presses the language button until the state shows it, default `en`), `--no-daily`.

Exit code: 0 when every planned level was solved, 2 when some were not, other values for setup failures. `dev down` runs on exit either way.

## How it reads the app

The CLI cannot run page code, so the app (dev server only) prints console lines `[reachfit:<kind>] <json>` (src/game/game.ts) and the scripts read them with `browser logs` and a pattern:

Every line carries `page` (the page's `performance.timeOrigin`, one value per page load) and `seq` (grows within a page load). Readers take the newest page first, then the highest `seq`.

- `level` at every level start and when the board moves to a new arc: `seq`, `levelId`, `levelIndex`, `kind`, `minRotations`, `solution` (each `{ r, c, turns, target, position }`), `targets`, `buttons` (world positions, null while hidden), `dwellMs`, `repeatMs`.
- `state` on every change: `window.__reachfit.state()` plus `seq`, `calibratePhase`, `remaining` (solution from the current board), `head` (`x, y, z, yawDeg`), `buttons`.
- `log` at every level end, at the end of the daily board and when XR exits: the play log in parts `{ page, dump, part, of, events }` and `{ page, dump, part, of, frameSummaries }`, each line at most 4,000 characters. `parse.mjs mergeLog` joins the newest complete dump of one page load.

Every turn is planned from the newest `state` line (`remaining[0]`), so a missed or doubled turn is fixed on the next step. A level gets at most its fewest turns plus 8 actions.

Do not edit files under `app/` during a run: Vite reloads the page when a watched file changes, and the page leaves XR. Seen on 2026-11-11 when another task rewrote `src/i18n/*.json` mid-run. `run.mjs` notices the new `page` value, keeps the old page's last complete log dump, enters XR again (input mode and sweep, or the gaze setup) and goes on from the level the page resumed at (the game saves at every solve). It does this at most twice, then stops. Each reload is in `notes` and counted in `pageReloads`; turns made after the old page's last dump are lost from `appLog`, and a level row without a `level-end` in the kept log has `fromAppLog: false`.

The run starts with a click on the 2D page button `Start over from level 1` (`data-testid="rf-start-over"`), so a saved game in the browser profile does not change where it starts. `start-over.mjs` clicks and then reads the `state` line back until L01 is on show with no turns (retries for up to 90 s, exit 3 otherwise). If the board still opens at another level in XR, `run.mjs` clicks once more and notes it in `notes`.

Gaze calibration: both edge angles in `sequences/gaze-calibrate.json` are taken from the head yaw at the moment the layer asks for the left edge, because `src/xr/calibrate.ts` measures both turns from that yaw.

## Result

`artifacts/autorun-<mode>-<YYYYMMDD>.json`:

```text
{ mode, startedAt, finishedAt,
  device: { inputMode, disconnected: [...] },
  reach, table,
  levels: [{ levelId, solved, rotations, minRotations, ms, misGrabs, inputs, actions }],
  solvedCount, attempted, consoleErrors, consoleErrorSamples, pageReloads,
  cli: { calls, failed, meanMs, maxMs }, notes,
  appLog: [...], frameSummariesNote, frameSummaries: [...] }
```

`rotations`, `minRotations`, `ms`, `misGrabs` and `inputs` come from the app log (`level-end`, `rotate`, `mis-grab` events between a level's last `level-start` and its `level-end`). `actions` is how many pinches or looks the script made. `consoleErrors` counts `browser logs` entries at level error, repeats included. `ms` includes the CLI's own latency, so it is not a human play time. Frame times are from the emulator in a headless browser and say nothing about Quest performance.

## Pictures (shots.sh)

```bash
bash tools/autorun/shots.sh --burst-dir /tmp/somewhere --manifest /tmp/somewhere/manifest.json
```

One session, 1920x1080 (agent mode, see `shots.sh`): hand sweep, then `submission/a1-arc-placed.png` and `a2-arc-placed-wide.png` (board just placed, right hand at the arc end), hands off, `i18n/<code>.png` for the ten languages (`window.__reachfit.setLocale`, head in front of the panel, back to `en` at the end), L01 to L05 by head gaze, `submission/b1-gaze-ring.jpg` (last burst frame before the final turn of L05 lands, gaze ring around the tile) and `c1-light-connected.png`, `c2-light-connected-wide.png`. Pictures go to `artifacts/` (git-ignored). The head sits at z -1.5 before the sweep (`--seat-z`), so the board lands on the desk top (z -2.38 to -1.68); at -1.35 its near rows hung off the front edge (runs of 2026-11-11 21:14 and 21:18). `shots-page.mjs` is the Playwright half (`iwsdk browser run`, inputs by environment variables); `shots-run.mjs` drives the CLI.

Looks are aimed so they rest on no turnable tile and no button before a level is solved: in L01 the empty row 0, at the panel the text above the button row. A look of 0.8 s on either would turn or press it.

## CLI output shapes

Checked with one real call each (MV08 probe, 2026-11-10, @iwsdk/cli 1.1.0-rc.2). Every command prints one JSON value:

- success `{ "ok": true, "data": { "workspaceRoot", "operation", "result" } }`, failure `{ "ok": false, "error": { "code", "message", "details" } }` and a non-zero exit.
- `dev up`: `data = { action: "started", session: { port: 8081, localUrl, browser: { lifecycle: { state: "launching" } } } }`. The browser is still launching when it returns; a call right after fails with `Browser not ready`, so autorun.sh retries the first click for up to a minute.
- `browser logs`: `result` is an array of `{ timestamp, level, message, args, kind, url?, frameUrl?, repeatCount? }`. `message` holds the whole console text (cut at 16,000 characters), each of `args` is cut at 4,000. The CLI keeps the last 1,000 entries and folds an identical repeat into `repeatCount`. `pattern` is a case-insensitive RegExp on `message`.
- `xr run-sequence`: `result = { completed, cancelled, steps: [{ label, start, end, startPerf, endPerf }], events: [{ t, type: "selectstart" | "select" | "selectend" }], presses, warnings, pinchValue, final }`. `warnings` names targets the hand passes through.
- `xr look-at`: `result = { device, position, orientation }`. `xr get-transform`: `result = { device, position, orientation, euler }`.
- `xr list-targets`: `result = { resolver: true, targets: [{ name, position, size }] }`, with `Tile_r_c`, `Grip_r_c` and the `Btn_*` buttons.
- `xr set-input-mode`: `result = { mode, activeDevices }`. `xr enter`: `result = { success }`. `browser interact`: `result = { completed: [{ action, durationMs, index }], success }`.
- `browser screenshot --output-file F`: `result = { width, height, mimeType, ... }`, `screenshotPath`.

Seen in the probe: the emulated headset starts at x 0, y 1.6, z 0 facing -Z, and in the `home_office` room plane detection gives a table at 0.725 m, so the board lands on that table (`table.source: "plane"`).
