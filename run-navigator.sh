#!/usr/bin/env bash
# Standalone launcher for Glimmith Navigator (dock icon / app menu / manual
# run) -- NOT tied to the game's lifetime, unlike launch-with-game.sh.
#
# Shares the same startup hardening as launch-with-game.sh: --disable-gpu
# (the game contending for the GPU can hang Electron's GPU process, which
# silently blocks window creation) and a retry loop (the game's own startup
# can peg the CPU/compositor hard enough that even with --disable-gpu, the
# X server handshake never completes -- not slow, stuck indefinitely, until
# a retry lands after the load eases). See docs/LINUX.md.
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

launch_nav() {
  setsid bash -c "cd '$NAV_DIR' && exec node_modules/electron/dist/electron . --no-sandbox --disable-gpu" \
    < /dev/null >"$LOG" 2>&1 &
  echo $!
}

nav_window_exists() {
  xwininfo -root -tree 2>/dev/null | grep -q '"Glimmith Navigator"'
}

nav_pid=$(launch_nav)
for attempt in 1 2 3; do
  ok=0
  for i in $(seq 1 20); do
    nav_window_exists && { ok=1; break; }
    sleep 1
  done
  [ "$ok" = 1 ] && break
  kill "$nav_pid" 2>/dev/null
  nav_pid=$(launch_nav)
done
