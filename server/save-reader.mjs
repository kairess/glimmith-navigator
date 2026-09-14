// Parses a .sav buffer down to the bit we actually need: per-puzzle
// solved/discovered state, keyed by the same PuzzleID string used
// everywhere else in this project (e.g. "AGeri/Puzzles/Zone2/2-palisade/0441.puz").
//
// Window/catalog structure lives in catalog.mjs, which merges this against
// the full 1225-puzzle position database so the UI can show locked/
// undiscovered puzzles too, not just ones already opened in-game.

import { parseGvas } from './gvas.mjs';

/**
 * @param {Buffer} buf raw .sav file bytes
 * @returns {{ statusById: Map<string, {solved: boolean}>, raw: object, warnings: string[] }}
 */
export function readSave(buf) {
  const parsed = parseGvas(buf);
  const p = parsed.properties;
  const puzzleEntries = Array.isArray(p.PuzzleData) ? p.PuzzleData : [];

  const statusById = new Map();
  for (const [puzzleId, data] of puzzleEntries) {
    statusById.set(puzzleId, { solved: !!data.HasBeenSolved });
  }

  return {
    statusById,
    raw: {
      numPuzzlesSolved: p.numPuzzlesSolved,
      hasBeenStarted: p.hasBeenStarted,
    },
    warnings: parsed.warnings,
  };
}
