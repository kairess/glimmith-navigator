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

# --ozone-platform=x11: launched from inside a real graphical session (as
# Steam is), Electron auto-detects Wayland (XDG_SESSION_TYPE=wayland +
# WAYLAND_DISPLAY) and picks its native Wayland backend -- on this
# Electron/Mutter combination that backend never shows a window at all.
# Forcing X11/Xwayland is what actually makes the window appear; see
# docs/LINUX.md.
setsid bash -c "cd '$NAV_DIR' && exec node_modules/electron/dist/electron . --no-sandbox --ozone-platform=x11" \
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
