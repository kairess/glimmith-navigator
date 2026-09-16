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
# of a signal our `trap cleanup` below can catch), the old Navigator process
# is orphaned and keeps running. Starting a second one on top of it makes
# both fight over the same docked position/always-on-top state, which looks
# like the overlay is broken. Make sure nothing from a previous session is
# still around before launching a fresh one.
pkill -f "node_modules/electron/dist/electron \. --no-sandbox" 2>/dev/null
sleep 0.5

# --disable-gpu: this is a plain 2D UI panel, no GPU acceleration needed --
# and while the game is actively rendering, Electron's GPU process can hang
# waiting for a GPU channel, which blocks window creation entirely (the
# process stays alive but never shows a window). Software rendering avoids
# fighting the game for the GPU.
setsid bash -c "cd '$NAV_DIR' && exec node_modules/electron/dist/electron . --no-sandbox --disable-gpu" \
  < /dev/null >"$LOG" 2>&1 &
NAV_PID=$!
disown

cleanup() {
  kill "$NAV_PID" 2>/dev/null
}
trap cleanup EXIT INT TERM

"$@"
GAME_STATUS=$?

exit "$GAME_STATUS"
