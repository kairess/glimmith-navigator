#!/usr/bin/env bash
# Steam launch options wrapper: starts Glimmith Navigator alongside the game,
# and closes it again when the game exits.
#
# Steam launch options for "The Artisan of Glimmith" (adjust the path to
# wherever you cloned this repo):
#   /path/to/glimmith-navigator/launch-with-game.sh %command%
#
# See docs/LINUX.md for the full Linux/Proton setup this script is part of.
set -uo pipefail

NAV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG="/tmp/glimmith-navigator.log"
SELF_PID=$$

# Steam normally already has a working DISPLAY/XAUTHORITY from the graphical
# session it was launched in. Only fall back to auto-detecting Xwayland's
# auth file (used by this GNOME/Wayland session) if those are missing.
: "${DISPLAY:=:0}"
if [ -z "${XAUTHORITY:-}" ] || [ ! -r "${XAUTHORITY:-}" ]; then
  XAUTHORITY=$(ls -t "/run/user/$(id -u)"/.mutter-Xwaylandauth.* 2>/dev/null | head -n1)
  : "${XAUTHORITY:=$HOME/.Xauthority}"
fi
export DISPLAY XAUTHORITY

# UE4SS injects itself via a dwmapi.dll proxy next to the game exe. Wine
# ships its own builtin dwmapi.dll, which by default wins the DLL search
# over the native one UE4SS dropped in Win64/ — this override makes Wine
# prefer the native (UE4SS) DLL so the mod loader actually initializes.
export WINEDLLOVERRIDES="dwmapi=n,b${WINEDLLOVERRIDES:+,$WINEDLLOVERRIDES}"

# If Steam/the desktop force-kills a previous game session (SIGKILL instead
# of a signal our supervisor below can catch), the old Navigator process is
# orphaned and keeps running. Starting a second one on top of it makes both
# fight over the same docked position/always-on-top state, which looks like
# the overlay is broken. Make sure nothing from a previous session is still
# around before launching a fresh one.
pkill -f "node_modules/electron/dist/electron \. --no-sandbox" 2>/dev/null
sleep 0.5

# --disable-gpu: this is a plain 2D UI panel, no GPU acceleration needed.
launch_nav() {
  setsid bash -c "cd '$NAV_DIR' && exec node_modules/electron/dist/electron . --no-sandbox --disable-gpu" \
    < /dev/null >"$LOG" 2>&1 &
  echo $!
}

nav_window_exists() {
  command -v xwininfo >/dev/null 2>&1 || return 0  # can't check -- assume it's fine
  xwininfo -root -tree 2>/dev/null | grep -q '"Glimmith Navigator"'
}

# Starting the game itself is heavy (Proton bootstrap, shader compilation,
# asset streaming) and can peg the CPU/compositor hard enough that a
# simultaneously-launched Electron window's handshake with the X server
# never completes -- not slow, just stuck indefinitely until that load
# eases. A plain "launch once and hope" misses the overlay entirely on a
# cold game start. So: launch it, and if its window hasn't shown up within
# ~20s, kill that attempt and try again (a retry into a now-less-loaded
# system reliably succeeds within seconds).
supervise_nav() {
  local nav_pid attempt ok i
  nav_pid=$(launch_nav)
  for attempt in 1 2 3; do
    ok=0
    for i in $(seq 1 20); do
      kill -0 "$SELF_PID" 2>/dev/null || { kill "$nav_pid" 2>/dev/null; return; }
      if nav_window_exists; then ok=1; break; fi
      sleep 1
    done
    [ "$ok" = 1 ] && break
    kill "$nav_pid" 2>/dev/null
    nav_pid=$(launch_nav)
  done
  # Main script (and the game it's exec'ing) still running -- keep this
  # instance around until it exits, then clean up. Polling our own parent's
  # liveness (rather than a trap in the main script) means this still works
  # even if the whole launch chain gets SIGKILLed instead of exiting cleanly.
  while kill -0 "$SELF_PID" 2>/dev/null; do sleep 2; done
  kill "$nav_pid" 2>/dev/null
}

supervise_nav &
disown

"$@"
exit $?
