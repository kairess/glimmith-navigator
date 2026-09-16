#!/usr/bin/env bash
# Standalone launcher for Glimmith Navigator (dock icon / app menu / manual
# run) -- NOT tied to the game's lifetime, unlike launch-with-game.sh.
#
# See docs/LINUX.md for why --ozone-platform=x11 is required here.
set -uo pipefail

NAV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG="/tmp/glimmith-navigator.log"

: "${DISPLAY:=:0}"
if [ -z "${XAUTHORITY:-}" ] || [ ! -r "${XAUTHORITY:-}" ]; then
  XAUTHORITY=$(ls -t "/run/user/$(id -u)"/.mutter-Xwaylandauth.* 2>/dev/null | head -n1)
  : "${XAUTHORITY:=$HOME/.Xauthority}"
fi
export DISPLAY XAUTHORITY

# Don't stack a fresh instance on top of one already running.
if xwininfo -root -tree 2>/dev/null | grep -q '"Glimmith Navigator"'; then
  exit 0
fi
pkill -f "node_modules/electron/dist/electron \. --no-sandbox" 2>/dev/null
sleep 0.5

setsid bash -c "cd '$NAV_DIR' && exec node_modules/electron/dist/electron . --no-sandbox --ozone-platform=x11" \
  < /dev/null >"$LOG" 2>&1 &
disown
