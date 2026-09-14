import { app, BrowserWindow, ipcMain, screen } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import chokidar from 'chokidar';
import { readSave } from '../server/save-reader.mjs';
import { buildState, setLivePositions } from '../server/catalog.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

function loadConfig() {
  const raw = JSON.parse(fs.readFileSync(path.join(projectRoot, 'config.json'), 'utf8'));
  const expand = (p) => p.replace('%LOCALAPPDATA%', process.env.LOCALAPPDATA ?? '');
  return {
    gameModsDir: expand(raw.gameModsDir),
    savePath: expand(raw.savePath),
  };
}

const config = loadConfig();
const positionsPath = path.join(projectRoot, 'server', 'data', 'puzzle-positions.json');
let positionsById = new Map(
  JSON.parse(fs.readFileSync(positionsPath, 'utf8')).map((p) => [p.puzzleId, p])
);

let mainWindow = null;
let tooltipWindow = null;
let latestCatalogState = null; // last buildState() result, for tooltip label lookups
let hoveredPuzzleId = null;
let inPuzzleState = false;
let tooltipWidth = 200;

ipcMain.on('tooltip-width', (_event, width) => {
  tooltipWidth = Math.max(60, Math.min(480, Math.round(width) + 4));
});

function sendState(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('state', payload);
  }
}

function sendTooltip(payload) {
  if (tooltipWindow && !tooltipWindow.isDestroyed()) {
    tooltipWindow.webContents.send('state', payload);
  }
}

function resolvePuzzleLabel(puzzleId) {
  if (!latestCatalogState || !puzzleId) return puzzleId || '';
  for (const w of latestCatalogState.windows) {
    const p = w.puzzles.find((x) => x.id === puzzleId);
    if (p) {
      const icon = p.solved ? '✓' : p.locked ? '🔒' : p.hidden && !p.discovered ? '+' : p.discovered ? '○' : '?';
      return `${icon} ${w.zoneName} · ${w.name} · #${p.number}`;
    }
  }
  return puzzleId;
}

function loadAndBroadcastSave() {
  try {
    const buf = fs.readFileSync(config.savePath);
    const { statusById } = readSave(buf);
    latestCatalogState = buildState(statusById);
    sendState({ type: 'save', data: latestCatalogState, savePath: config.savePath, updatedAt: Date.now() });
  } catch (err) {
    sendState({ type: 'save-error', message: String(err && err.message ? err.message : err) });
  }
}

function watchSave() {
  const watcher = chokidar.watch(config.savePath, {
    awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 50 },
  });
  watcher.on('add', loadAndBroadcastSave);
  watcher.on('change', loadAndBroadcastSave);
  watcher.on('error', (err) => sendState({ type: 'save-error', message: String(err) }));
}

// The Lua mod writes its live in-puzzle state here (see gamestate.txt format
// in the mod script): "1" while the puzzle-solving screen is open, else "0".
function watchGameState() {
  const gameStatePath = path.join(config.gameModsDir, 'gamestate.txt');
  const read = () => {
    try {
      const content = fs.readFileSync(gameStatePath, 'utf8').trim();
      inPuzzleState = content === '1';
      sendState({ type: 'gamestate', inPuzzle: inPuzzleState });
      updateTooltipVisibility();
      updateMainWindowClickThrough();
    } catch {
      // Mod not running / file not there yet -- not fatal, just no auto-hide.
    }
  };
  const watcher = chokidar.watch(gameStatePath, {
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
  });
  watcher.on('add', read);
  watcher.on('change', read);
  read();
}

// The Lua mod writes the puzzleId currently under the mouse cursor here
// (empty string if none), refreshed every ~500ms.
function watchHover() {
  const hoverPath = path.join(config.gameModsDir, 'hover.txt');
  const read = () => {
    try {
      const content = fs.readFileSync(hoverPath, 'utf8').trim();
      hoveredPuzzleId = content || null;
      const label = hoveredPuzzleId ? resolvePuzzleLabel(hoveredPuzzleId) : '';
      sendState({ type: 'hover', puzzleId: hoveredPuzzleId });
      sendTooltip({ type: 'hover-label', text: label });
      updateTooltipVisibility();
    } catch {
      // not fatal
    }
  };
  const watcher = chokidar.watch(hoverPath, {
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
  });
  watcher.on('add', read);
  watcher.on('change', read);
  read();
}

// The Lua mod periodically re-scans every live PuzzleCube_C and writes its
// full position list here (see main.lua's scan_puzzle_positions) -- so the
// catalog keeps working correctly even after a game update adds, removes,
// or moves puzzles, with no manual re-scan or app update needed. We also
// persist it over the bundled data/puzzle-positions.json snapshot, so the
// NEXT time the app starts (even before the game/mod has reported in yet)
// it already starts from the latest known-good data.
function watchLivePositions() {
  const livePath = path.join(config.gameModsDir, 'puzzle_positions_live.jsonl');
  const read = () => {
    try {
      const lines = fs.readFileSync(livePath, 'utf8').split('\n').filter((l) => l.trim());
      const positions = lines.map((l) => JSON.parse(l));
      if (positions.length === 0) return;
      setLivePositions(positions);
      positionsById = new Map(positions.map((p) => [p.puzzleId, p]));
      loadAndBroadcastSave();
      fs.writeFile(positionsPath, JSON.stringify(positions, null, 2), () => {});
    } catch {
      // Mod hasn't written it yet, or wrote a partial file mid-update -- not
      // fatal, chokidar's awaitWriteFinish should mostly avoid the latter.
    }
  };
  const watcher = chokidar.watch(livePath, {
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 50 },
  });
  watcher.on('add', read);
  watcher.on('change', read);
}

function updateTooltipVisibility() {
  if (!tooltipWindow || tooltipWindow.isDestroyed()) return;
  if (hoveredPuzzleId && !inPuzzleState) {
    if (!tooltipWindow.isVisible()) tooltipWindow.showInactive();
  } else {
    tooltipWindow.hide();
  }
}

// The panel fades out (CSS opacity 0 / pointer-events:none on the .panel
// element) while in a puzzle or the main menu, but the underlying OS window
// still occupies and captures that screen region unless we explicitly make
// it click-through too -- otherwise clicks on the game in that area get
// eaten by an invisible window instead of reaching the game.
function updateMainWindowClickThrough() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setIgnoreMouseEvents(inPuzzleState, { forward: true });
}

// Keeps the click-through tooltip window glued to the left of the OS cursor,
// independent of which app currently has focus (the game does).
function startCursorFollow() {
  const TOOLTIP_H = 38;
  setInterval(() => {
    if (!tooltipWindow || tooltipWindow.isDestroyed() || !hoveredPuzzleId) return;
    const { x, y } = screen.getCursorScreenPoint();
    tooltipWindow.setBounds({
      x: x - tooltipWidth - 14,
      y: Math.round(y - TOOLTIP_H / 2),
      width: tooltipWidth,
      height: TOOLTIP_H,
    });
  }, 40);
}

ipcMain.on('set-minimized', (_event, minimized) => {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindowBounds) return;
  const { x, y, width, fullHeight } = mainWindowBounds;
  mainWindow.setBounds({
    x,
    y,
    width,
    height: minimized ? MINIMIZED_HEIGHT : fullHeight,
  });
});

ipcMain.handle('locate', (_event, puzzleId) => {
  if (!positionsById.has(puzzleId)) return { ok: false, error: 'unknown puzzleId' };
  try {
    const requestPath = path.join(config.gameModsDir, 'goto_request.txt');
    fs.writeFileSync(requestPath, puzzleId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

const MINIMIZED_HEIGHT = 150;
let mainWindowBounds = null; // { x, width, top, fullHeight } for restoring after minimize

function createMainWindow() {
  const display = screen.getPrimaryDisplay();
  const { x: waX, y: waY, width: waWidth, height: waHeight } = display.workArea;
  const winWidth = 400;
  mainWindowBounds = { x: waX + waWidth - winWidth, y: waY, width: winWidth, fullHeight: waHeight };

  mainWindow = new BrowserWindow({
    width: winWidth,
    height: waHeight,
    x: mainWindowBounds.x,
    y: waY,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: false,
    hasShadow: false,
    focusable: false, // don't steal focus from the game when clicked
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.loadFile(path.join(projectRoot, 'renderer', 'index.html'));

  mainWindow.webContents.once('did-finish-load', () => {
    loadAndBroadcastSave();
    watchGameState();
    watchHover();
    watchLivePositions();
    startCursorFollow();
  });
}

function createTooltipWindow() {
  tooltipWindow = new BrowserWindow({
    width: 260,
    height: 38,
    x: 0,
    y: 0,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  tooltipWindow.setAlwaysOnTop(true, 'screen-saver');
  tooltipWindow.setIgnoreMouseEvents(true, { forward: true });
  tooltipWindow.loadFile(path.join(projectRoot, 'renderer', 'tooltip.html'));
}

app.whenReady().then(() => {
  createMainWindow();
  createTooltipWindow();
  watchSave();
});

app.on('window-all-closed', () => {
  app.quit();
});
