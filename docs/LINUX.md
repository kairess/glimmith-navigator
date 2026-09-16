# Running on Linux (Steam Proton)

The Artisan of Glimmith is a Windows-only game, but it runs fine under
Proton, and Glimmith Navigator itself is just an Electron app, so it runs
natively on Linux too — no Wine needed for the overlay itself. This doc
covers what's different from the Windows steps in the main README.

## 1. Find your real (native) paths

`config.json` on Windows uses `C:/...` and `%LOCALAPPDATA%`. Under Proton,
the game's "Windows" filesystem is actually a prefix directory on your real
disk, so translate both paths into that prefix:

- **Game folder** (`gameModsDir`'s base) is just wherever Steam installed it
  — no translation needed:
  `<steam library>/steamapps/common/The Artisan of Glimmith/Geri/Binaries/Win64`
- **Save file / `%LOCALAPPDATA%`** lives inside the game's Proton prefix:
  `<steam library>/steamapps/compatdata/<appid>/pfx/drive_c/users/steamuser/AppData/Local`

The Artisan of Glimmith's Steam appid is `4160210`, so on a default Steam
install this usually looks like:

```json
{
  "gameModsDir": "/home/<you>/.steam/steam/steamapps/common/The Artisan of Glimmith/Geri/Binaries/Win64/Mods/GlimmithNavDiag",
  "savePath": "/home/<you>/.steam/steam/steamapps/compatdata/4160210/pfx/drive_c/users/steamuser/AppData/Local/Geri/Saved/SaveGames/SaveFile1.sav"
}
```

(Some Steam installs use `~/.steam/debian-installation/steamapps/...`
instead of `~/.steam/steam/steamapps/...` — check whichever actually has a
`compatdata/4160210` folder.)

Copy `config.example.json` to `config.json` and fill in your real paths.

## 2. Install UE4SS into the Proton prefix

Same two files as the Windows steps (`game-mod/Scripts/main.lua` +
`mods.txt` with `GlimmithNavDiag : 1`), just dropped into the native path
from step 1 instead of a `C:\...` path. In addition, install UE4SS's own
release files (`UE4SS.dll`, `dwmapi.dll`, `UE4SS-settings.ini` from a
[UE4SS release](https://github.com/UE4SS-RE/RE-UE4SS/releases)) directly
into that same `Win64` folder.

### Proton won't load UE4SS without a DLL override

UE4SS injects itself via a `dwmapi.dll` proxy next to the game exe. Wine
ships its own builtin `dwmapi.dll`, which normally wins the DLL search over
the native one UE4SS dropped in `Win64/` — so UE4SS silently never loads.
Fix it by forcing Wine to prefer the native DLL:

```
WINEDLLOVERRIDES="dwmapi=n,b"
```

`launch-with-game.sh` (below) already sets this for you, so you only need to
set it by hand if you're launching some other way (e.g. adding it directly
to Steam's launch options: `WINEDLLOVERRIDES="dwmapi=n,b" %command%`).

### "Fatal error" shortly after UE4SS loads

If the game crashes right after `UE4SS.log` shows `Event loop start`, it's
UE4SS's engine-function hooks (`ProcessInternal` etc.) patching the wrong
address for this particular build. This mod's script (`main.lua`) doesn't
use any of those hooks — it only polls files — so it's safe to turn them
all off in `UE4SS-settings.ini`:

```ini
[General]
bUseUObjectArrayCache = false   ; the ini file itself suggests this for crash-on-startup

[Debug]
GuiConsoleEnabled = 0           ; also worth trying first, cheaper to rule out

[Hooks]
HookProcessInternal = 0
HookProcessLocalScriptFunction = 0
HookInitGameState = 0
HookCallFunctionByNameWithArguments = 0
HookBeginPlay  = 0
HookLocalPlayerExec = 0
```

## 3. Auto-launch the overlay with the game

`launch-with-game.sh` (repo root) starts Glimmith Navigator in the
background, execs the actual game command, and closes the overlay again
when the game exits. It auto-detects `DISPLAY`/`XAUTHORITY` and sets the
`WINEDLLOVERRIDES` above, so it works whether Steam already has a working
graphical environment or not.

Set it as the game's Steam launch option (Library → right-click the game →
Properties → General → Launch Options):

```
/path/to/glimmith-navigator/launch-with-game.sh %command%
```

`npm install` must have been run in the repo first (see main README).

The overlay is launched with `--ozone-platform=x11`. Without it: launched
from inside a real graphical session (as Steam and the desktop's app
launcher both are -- `XDG_SESSION_TYPE=wayland` plus `WAYLAND_DISPLAY` set),
Electron auto-detects Wayland and picks its native Wayland backend. On the
Electron/Mutter combination this was tested on, that backend **never shows
a window at all** -- the process stays alive, the log has nothing useful in
it, and it looks like the overlay silently "didn't start". Forcing
`--ozone-platform=x11` makes it use Xwayland like a normal X11 client
instead, which reliably works. (A shell launched over plain SSH, with no
`WAYLAND_DISPLAY` of its own, doesn't hit this -- Electron falls back to X11
on its own there, which is why a manual test from such a shell can look
fine while the dock icon or Steam launch option doesn't.)

### Launching it standalone (dock icon / app menu)

`run-navigator.sh` is the same launch logic as `launch-with-game.sh`, minus
the game-wrapping -- use it as the `Exec=` line of a `.desktop` file (or run
it directly) for a dock/app-menu icon. Don't point a launcher directly at
the `electron` binary; without `--ozone-platform=x11` it hits the same
window-never-appears issue above.

## Known Linux/GNOME quirks

These come from testing on GNOME (Mutter) + Xwayland; other desktops/WMs may
differ. They all assume `--ozone-platform=x11` above is already in effect --
without it, the symptom is just "no window," not any of these.

- **Window position**: some GNOME setups force all new windows to open
  centered (`gsettings get org.gnome.mutter center-new-windows`). The app
  re-asserts its docked position right after the window is shown (and every
  2s after) specifically to fight this, so it should self-correct within a
  couple seconds even if it flashes centered for a moment.
- **Always-on-top**: also re-asserted every 2s for the same reason —
  focusing the game can otherwise raise it above the overlay.
- **Window vanishes entirely**: also observed — the panel can get
  unmapped/withdrawn by the compositor with no corresponding Electron
  `hide`/`closed` event (the `BrowserWindow` object stays alive,
  `isDestroyed()` stays false, the process keeps running). The same 2s
  re-assert loop checks `isVisible()` and calls `showInactive()` to bring it
  back without stealing game focus. Root cause on the Mutter/Xwayland side
  isn't nailed down; this is a mitigation, not a fix for the underlying
  compositor behavior.
- **Interacting with the panel (click/scroll)**: the panel needs to actually
  have window focus before scroll wheel input works (a plain click on it
  both focuses it and registers, so that part works standalone; scroll
  alone doesn't focus it first). There's no clean fix for this yet —
  `_NET_WM_WINDOW_TYPE_DOCK` was tried as an EWMH-correct way to get
  panel-like click-without-focus behavior, but on tested Mutter versions it
  blocked input entirely instead, so it's not used. If you want the panel to
  focus itself just by hovering (no click needed), GNOME's built-in
  "focus follows mouse" preference does this for every window, not just this
  app: `gsettings set org.gnome.desktop.wm.preferences focus-mode 'mouse'`
  (revert with `'click'`).
