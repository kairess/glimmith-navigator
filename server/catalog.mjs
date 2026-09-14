// The full 1225-puzzle catalog (every puzzle cube placed in the game world,
// discovered or not -- see server/data/puzzle-positions.json and
// docs/SAVE_FORMAT.md for how it was captured), grouped into "stained glass
// window" cards and merged with live save state.
//
// A window is considered OPENED if the save has at least one discovered
// puzzle in it; otherwise every puzzle in that window is treated as locked
// (its "stage" hasn't been reached yet) and Locate is disabled for it. This
// is a deliberate simplification -- the game also has finer per-puzzle
// prerequisite chains we don't model -- but it matches how players actually
// think about progress ("have I gotten to this area yet?").

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TUTORIAL_ZONE_ID = 'Data';

// Puzzle IDs confirmed dead/unreachable (not just "not found yet") -- none
// known currently. An earlier version of this list wrongly excluded 0054
// and 1393 as "orphans" because they never appeared in the save even once
// their window's Gold-tier counter read e.g. 10/10. That reasoning was
// wrong: per the game's wiki (namu.moe/w/The Artisan of Glimmith), the true
// total is exactly 1225 puzzles (matching puzzle-positions.json exactly),
// and each region has FOUR tiers -- Restore / Silver / Gold / Ruby -- where
// Ruby always needs exactly one more solve than Gold. The window's "X/X"
// display is the GOLD tier, not the window's real total; the missing 11th
// puzzle in each case (0054, 1393) turned out to be that region's Ruby-tier
// hidden puzzle, which the game deliberately keeps off the map (shown only
// as "+") until the ending -- see the "likely hidden" heuristic in
// buildState() below, which flags puzzles like these live from save data
// instead of a hardcoded ID list (tried finding a real per-puzzle "isHidden"
// flag via UE4SS reflection -- checked ShowSecretPopup/ShowBossPopup/
// MandatoryPuzzle on all 1225 live PuzzleCube_C instances; none of them
// correlate with 0054/1393 being hidden, so no such flag is exposed).
const EXCLUDED_PUZZLE_IDS = new Set([]);

// The asset folders group puzzles by RULE TYPE, not by physical stained-glass
// window -- usually that lines up 1:1 with a window anyway, but sometimes a
// rule type is split across an early/small folder and a later/large one that
// the game still tracks as a single glass+counter. This can't be inferred
// automatically (an earlier attempt to infer it from puzzle-position
// clustering was WRONG: Zone1/3-gemini-delta and Zone1/6-gemini-delta sit
// thousands of units apart in the world, yet the player confirmed in-game
// they're one glass showing a single pair of tier counters). Confirmed pairs
// only, added as the player verifies them in-game:
//   - Zone1/3-gemini-delta + Zone1/6-gemini-delta -> one "Gemini Delta" glass.
// Zone1/2-shape-bank vs Zone1/5-shape-bank were checked and are NOT the same
// glass (2-shape-bank alone already matched the in-game 10/10 exactly), so
// they stay split and just get an "(Area N)" suffix -- see below.
//
// IMPORTANT CAVEAT (investigated 2026-09-15, see server/data/plinth_tiers.jsonl):
// the game's 29 REAL stained-glass windows are BP_StainedGlassPlinth_C actors
// in the level, each with a real name (AreaName) and real Silver/Gold
// thresholds (silverObjective/gildObjective) -- confirmed exactly correct
// for Gemini Delta (silverObjective=21, gildObjective=33, matching the
// in-game 21/21, 21/33 exactly). BUT there is no discoverable link from a
// puzzle to its owning plinth: PuzzleCube_C has no back-reference property,
// no shared Tags, and no shared environmentTriggers identity with the
// plinth; nearest-3D-distance-to-plinth was also tried and is off by up to
// ~40 puzzles per window, so it's not simple spatial containment either.
// Concretely this means our "Zone1/2-shape-bank" folder is almost certainly
// NOT actually part of the real "도형 창고" (ShapeBank, gild=23) glass at
// all -- its coordinates sit ~12000 units from the ShapeBank plinth but only
// ~2400 units from the "글리미스 전망대" (Gate) plinth, whose own
// silverObjective=9/gildObjective=10 matches this folder's real 10/10
// exactly. In other words the folder-name-based grouping below is a
// best-effort approximation, not authoritative -- treat any single window's
// "X / Y" in the panel as roughly indicative, not a guaranteed match to the
// in-game glass for that same area. Revisit if a future UE4SS version (or a
// different reflection angle) exposes the real per-puzzle membership.
const WINDOW_MERGES = new Map([
  ['Zone1/3-gemini-delta', 'Zone1/gemini-delta'],
  ['Zone1/6-gemini-delta', 'Zone1/gemini-delta'],
]);

function humanizeSlug(slug) {
  const parts = slug.split('-');
  if (parts.length > 1 && /^\d+$/.test(parts[0])) parts.shift();
  return parts
    .map((tok) => {
      if (/[A-Z]/.test(tok)) return tok;
      if (!tok) return tok;
      return tok[0].toUpperCase() + tok.slice(1);
    })
    .join(' ');
}

function humanizeZone(zoneId) {
  const m = /^Zone(\d+)$/.exec(zoneId);
  if (m) return `Zone ${m[1]}`;
  if (zoneId === TUTORIAL_ZONE_ID) return 'Intro';
  return zoneId;
}

function leadingNumber(slug) {
  const m = /^(\d+)-/.exec(slug);
  return m ? parseInt(m[1], 10) : 999;
}

function zoneSortKey(zoneId) {
  const m = /^Zone(\d+)$/.exec(zoneId);
  if (m) return parseInt(m[1], 10);
  if (zoneId === TUTORIAL_ZONE_ID) return -1;
  return 999;
}

function splitPuzzleId(puzzleId) {
  const parts = puzzleId.split('/');
  const zoneId = parts[2] || 'Unknown';
  if (zoneId === TUTORIAL_ZONE_ID) {
    const label = parts[3] || puzzleId;
    return { zoneId, categorySlug: TUTORIAL_ZONE_ID, number: label, isTutorial: true };
  }
  const categorySlug = parts[3] || 'misc';
  const last = parts[4] || parts[3] || puzzleId;
  const number = last.replace(/\.puz$/i, '');
  return { zoneId, categorySlug, number, isTutorial: false };
}

let cachedCatalogWindows = null;

// Set by electron/main.js when the live-running game's Lua mod reports a
// fresh full scan of every PuzzleCube_C in the world (see
// puzzle_positions_live.jsonl and main.lua's periodic self-scan) -- lets the
// catalog stay correct after a game update adds/moves/removes puzzles,
// without needing the bundled data/puzzle-positions.json snapshot updated
// by hand. Falls back to that static snapshot when the game/mod isn't
// running (or hasn't reported yet), e.g. just viewing stats.
let livePositions = null;

export function setLivePositions(positions) {
  if (!Array.isArray(positions) || positions.length === 0) return;
  livePositions = positions;
  cachedCatalogWindows = null; // force a rebuild on next buildState()
}

function loadCatalogWindows() {
  if (cachedCatalogWindows) return cachedCatalogWindows;
  let positions = livePositions;
  if (!positions) {
    const positionsPath = path.join(__dirname, 'data', 'puzzle-positions.json');
    positions = JSON.parse(fs.readFileSync(positionsPath, 'utf8'));
  }

  const windowMap = new Map();
  for (const pos of positions) {
    if (EXCLUDED_PUZZLE_IDS.has(pos.puzzleId)) continue;
    const { zoneId, categorySlug, number, isTutorial } = splitPuzzleId(pos.puzzleId);
    const rawWindowId = isTutorial ? TUTORIAL_ZONE_ID : `${zoneId}/${categorySlug}`;
    const windowId = WINDOW_MERGES.get(rawWindowId) || rawWindowId;
    if (!windowMap.has(windowId)) {
      windowMap.set(windowId, {
        id: windowId,
        zoneId,
        zoneName: humanizeZone(zoneId),
        name: isTutorial ? 'Tutorial & Intro' : humanizeSlug(categorySlug),
        sortKey: [zoneSortKey(zoneId), isTutorial ? 0 : leadingNumber(categorySlug)],
        puzzles: [],
      });
    } else if (!isTutorial) {
      // Merged window (see WINDOW_MERGES): keep the smallest leading-number
      // among the merged folders as the sort position.
      const w = windowMap.get(windowId);
      const ln = leadingNumber(categorySlug);
      if (ln < w.sortKey[1]) w.sortKey[1] = ln;
    }
    windowMap.get(windowId).puzzles.push({
      id: pos.puzzleId,
      number,
      x: pos.x,
      y: pos.y,
      z: pos.z,
    });
  }

  const windows = [...windowMap.values()];
  for (const w of windows) {
    w.puzzles.sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
  }
  windows.sort((a, b) => a.sortKey[0] - b.sortKey[0] || a.sortKey[1] - b.sortKey[1]);

  // The in-game asset folders sometimes reuse the same puzzle-rule name for
  // two genuinely separate stained-glass windows in the same zone (e.g. two
  // distinct "Shape Bank" areas) -- confirmed by their puzzle-position
  // centroids sitting thousands of units apart, not one window split into
  // two catalog entries. Rather than guess and merge them (which would risk
  // reporting a made-up combined total), just disambiguate the display name
  // so they don't look like a duplicate/bug in the panel.
  const nameCounts = new Map();
  for (const w of windows) {
    const key = `${w.zoneId}::${w.name}`;
    nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
  }
  const seenIndex = new Map();
  for (const w of windows) {
    const key = `${w.zoneId}::${w.name}`;
    if (nameCounts.get(key) > 1) {
      const idx = (seenIndex.get(key) || 0) + 1;
      seenIndex.set(key, idx);
      w.name = `${w.name} (Area ${idx})`;
    }
  }

  cachedCatalogWindows = windows;
  return windows;
}

/**
 * @param {Map<string, {solved: boolean}>} statusById from save-reader.readSave()
 */
export function buildState(statusById) {
  const catalogWindows = loadCatalogWindows();

  const windows = catalogWindows.map((cw) => {
    const rawPuzzles = cw.puzzles.map((p) => {
      const status = statusById.get(p.id);
      const discovered = !!status;
      const solved = discovered && status.solved;
      return { id: p.id, number: p.number, discovered, solved };
    });
    const discoveredCount = rawPuzzles.filter((p) => p.discovered).length;
    const solvedCount = rawPuzzles.filter((p) => p.solved).length;
    const opened = discoveredCount > 0;
    const undiscoveredCount = rawPuzzles.length - discoveredCount;

    // "Likely hidden" heuristic (computed live, not a hardcoded ID list):
    // the window is open, every puzzle ever discovered in it has been
    // solved, and only a couple remain undiscovered. This is exactly the
    // signature that identified 0054 and 1393 by hand -- a window the game
    // shows fully complete (e.g. 10/10) while our raw catalog count is 1-2
    // higher, because the extra puzzle(s) are Ruby-tier and stay off the
    // map until the ending. Recomputes automatically as saves progress, so
    // it keeps working for windows we haven't manually checked in-game.
    const likelyHidden =
      opened && discoveredCount > 0 && solvedCount === discoveredCount && undiscoveredCount > 0 && undiscoveredCount <= 2;

    const puzzles = rawPuzzles.map((p) => ({
      ...p,
      hidden: likelyHidden && !p.discovered,
      locked: !opened,
      label: `${cw.zoneName} · ${cw.name} · #${p.number}`,
    }));
    const hiddenCount = puzzles.filter((p) => p.hidden).length;
    // Puzzles the player could actually reach before the ending -- what the
    // in-game Gold-tier counter is really counting. Hidden (Ruby-tier)
    // puzzles are excluded so a window that's genuinely maxed-out pre-ending
    // (e.g. real game shows 10/10) reads as complete here too, instead of a
    // permanently-unreachable "10/11".
    const visibleTotal = puzzles.length - hiddenCount;

    return {
      id: cw.id,
      zoneId: cw.zoneId,
      zoneName: cw.zoneName,
      name: cw.name,
      opened,
      total: puzzles.length,
      visibleTotal,
      discovered: discoveredCount,
      solved: solvedCount,
      perfected: visibleTotal > 0 && solvedCount === visibleTotal,
      puzzles,
    };
  });

  const totals = windows.reduce(
    (acc, w) => ({
      total: acc.total + w.total,
      discovered: acc.discovered + w.discovered,
      solved: acc.solved + w.solved,
    }),
    { total: 0, discovered: 0, solved: 0 }
  );

  return {
    totals,
    windows,
    windowsPerfected: windows.filter((w) => w.perfected).length,
    windowsOpened: windows.filter((w) => w.opened).length,
    windowCount: windows.length,
  };
}
