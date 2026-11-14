#!/usr/bin/env bash
# Reach Fit autorun in the IWSDK emulator: every level by hand pinch or by head gaze only.
# Run from the app folder:
#   bash tools/autorun/autorun.sh pinch
#
# usage: autorun.sh <pinch|gaze> [--levels N] [--locale CODE] [--no-daily] [--shot FILE] [--out FILE]
# Result: artifacts/autorun-<mode>-<YYYYMMDD>.json (see README.md).
set -euo pipefail

usage() {
  echo "usage: autorun.sh <pinch|gaze> [--levels N] [--locale CODE] [--no-daily] [--shot FILE] [--out FILE]" >&2
  exit 64
}

MODE="${1:-}"
if [ "$MODE" != pinch ] && [ "$MODE" != gaze ]; then
  usage
fi
shift
LEVELS=12
LOCALE=en
DAILY=1
SHOT=
OUT=
while [ $# -gt 0 ]; do
  case "$1" in
    --levels) LEVELS="${2:?}"; shift 2 ;;
    --locale) LOCALE="${2:?}"; shift 2 ;;
    --no-daily) DAILY=0; shift ;;
    --shot) SHOT="${2:?}"; shift 2 ;;
    --out) OUT="${2:?}"; shift 2 ;;
    *) usage ;;
  esac
done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$(cd "$HERE/../.." && pwd)"
cd "$APP"
if [ -z "$OUT" ]; then
  OUT="$APP/artifacts/autorun-$MODE-$(date +%Y%m%d).json"
fi
mkdir -p "$(dirname "$OUT")"

iw() {
  npx --no-install @iwsdk/cli "$@"
}

cleanup() {
  iw xr exit --input-json '{}' >/dev/null 2>&1 || true
  iw dev down >/dev/null 2>&1 || true
}
trap cleanup EXIT

STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "[autorun] $MODE, levels $LEVELS, locale $LOCALE, daily $DAILY"

iw dev up --headless --timeout 45000
# Start from L01 whatever the browser profile saved (2D page button, src/game/page-extras.ts).
# The managed browser and the game come up a little after `dev up` returns, so start-over.mjs
# retries the click for up to 90 s and reads the state line back until L01 is on show.
if ! node "$HERE/start-over.mjs" --timeout-ms 90000; then
  echo "[autorun] the page did not come up at L01 (start-over)" >&2
  exit 3
fi
iw xr enter --input-json '{}'

if [ "$MODE" = pinch ]; then
  iw xr set-input-mode --input-json '{"mode":"hand"}'
  # Right index finger tip draws an arc at table height: the reach sweep.
  iw xr run-sequence --input-json "$(cat "$HERE/sequences/sweep-right.json")" --timeout 45000
  DISCONNECTED='[]'
else
  # Head gaze only: no hands, no controllers. The layer falls back to the gaze edges after its hand wait.
  for device in hand-left hand-right controller-left controller-right; do
    iw xr set-connected --input-json "{\"device\":\"$device\",\"connected\":false}"
  done
  DISCONNECTED='["hand-left","hand-right","controller-left","controller-right"]'
fi

node "$HERE/run.mjs" \
  --mode "$MODE" \
  --levels "$LEVELS" \
  --locale "$LOCALE" \
  --daily "$DAILY" \
  --started "$STARTED" \
  --disconnected "$DISCONNECTED" \
  --shot "$SHOT" \
  --out "$OUT"
