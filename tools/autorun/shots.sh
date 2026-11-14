#!/usr/bin/env bash
# Reach Fit pictures in the IWSDK emulator: one per UI language and submission
# image candidates (see shots-run.mjs). Run from the app folder:
#   bash tools/autorun/shots.sh
#
# usage: shots.sh [--out-dir DIR] [--burst-dir DIR] [--manifest FILE] [--level N] [--seat-z Z]
# Default out dir app/artifacts: i18n/<code>.png and submission/*.png (png is
# git-ignored).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$(cd "$HERE/../.." && pwd)"
cd "$APP"

iw() {
  npx --no-install @iwsdk/cli "$@"
}

cleanup() {
  iw xr exit --input-json '{}' >/dev/null 2>&1 || true
  iw dev down >/dev/null 2>&1 || true
}
trap cleanup EXIT

# --allow-browser-automation turns on `browser run` (Playwright in the managed tab).
# Agent mode makes the screenshot size the page viewport: 1920x1080 pictures.
iw dev up --ai-mode agent --headless --allow-browser-automation --screenshot-width 1920 --screenshot-height 1080 --timeout 45000 >/dev/null
if ! node "$HERE/start-over.mjs" --timeout-ms 90000; then
  echo "[shots] the page did not come up at L01 (start-over)" >&2
  exit 3
fi
node "$HERE/shots-run.mjs" "$@"
