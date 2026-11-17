#!/usr/bin/env sh
# Renders dashboard/screenshots from the page's own files, in a headless browser, at the size the
# gate keeps (1440x980: long side at most 1440, short side at least 800).
#
#   1. mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
#   2. CHROME=/path/to/chrome sh tools/render-screenshots.sh
#   3. MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json   # so the dossier carries them
#
# The three views are the three the judge is shown: the ranked board (the cover, first by name), one
# protocol's own view, and the board filtered to the house watchlist. Each is a deep link the page
# supports, so a reader of this repository can reproduce every one of them by hand.
set -eu

CHROME="${CHROME:-google-chrome}"
OUT="${OUT:-out}"
SIZE="${SIZE:-1440,1400}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DASH="file://$ROOT/$OUT/dashboard/index.html"
SHOTS="$ROOT/screenshots"

mkdir -p "$SHOTS"

render() { # $1 query string, $2 output file
  "$CHROME" --headless=new --no-sandbox --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=1 --window-size="$SIZE" --virtual-time-budget=8000 \
    --run-all-compositor-stages-before-draw --screenshot="$SHOTS/$2" "$DASH$1" >/dev/null 2>&1
  printf '%s %s bytes\n' "screenshots/$2" "$(wc -c <"$SHOTS/$2")"
}

render ""                                            "1-board.png"
render "?slug=steakhouse-financial"                  "2-detail.png"
render "?tier=watchlist&sort=tvl"                    "3-filtered.png"
