import { PlayerState } from '../../shared/types';
import { getMoveById } from '../data/moves';

interface EnergyResult {
  energyChanges: Record<string, number>;    // playerId -> net delta
  ouChain: { stealer: string; target: string; amount: number }[];
}

/**
 * Resolve energy gains and 欧 steal chains.
 *
 * Algorithm:
 * 1. Calculate base energy gains (运 → +1)
 * 2. Build 欧 steal directed graph
 * 3. Topological sort: process from leaf targets upward
 * 4. Handle cycles: break cycle, all in cycle get 0 net gain
 */
export function resolveEnergy(
  players: PlayerState[],
  playerMoves: Map<string, { moveId: string; targets: string[] }>
): EnergyResult {
  const energyChanges: Record<string, number> = {};
  const ouChain: { stealer: string; target: string; amount: number }[] = [];

  // Initialize: each player's thisRoundGain starts at 0
  const thisRoundGain: Record<string, number> = {};
  for (const p of players) {
    thisRoundGain[p.id] = 0;
    energyChanges[p.id] = 0;
  }

  // Phase 1: Direct gains
  for (const p of players) {
    const sub = playerMoves.get(p.id);
    if (!sub) continue;
    const move = getMoveById(sub.moveId);
    if (!move) continue;

    if (move.id === 'yun') {
      thisRoundGain[p.id] += 1;
    }
  }

  // Phase 2: Build 欧 steal graph
  // Each 欧 edge: stealer steals 2x target's gain
  const stealEdges: { stealer: string; target: string }[] = [];
  const stealsFrom: Set<string> = new Set(); // players who are stealing
  const stolenFrom: Set<string> = new Set(); // players being stolen from

  for (const p of players) {
    const sub = playerMoves.get(p.id);
    if (!sub) continue;
    const move = getMoveById(sub.moveId);
    if (!move || move.specialEffect !== 'ou_steal') continue;

    const targetId = sub.targets[0];
    if (!targetId) continue;

    stealEdges.push({ stealer: p.id, target: targetId });
    stealsFrom.add(p.id);
    stolenFrom.add(targetId);
  }

  if (stealEdges.length > 0) {
    // Find processing order: start from leaf targets
    // (players being stolen from who are NOT stealing from anyone)
    // Process iteratively until all edges resolved

    const processed = new Set<string>();
    const remaining = [...stealEdges];
    let iterations = 0;
    const maxIterations = stealEdges.length * 2; // safety

    while (remaining.length > 0 && iterations < maxIterations) {
      iterations++;
      const toProcess = remaining.filter(e =>
        !stealsFrom.has(e.target) || processed.has(e.target)
      );
      if (toProcess.length === 0) {
        // Cycle detected: break by processing remaining in arbitrary order
        // Zero out all cycle participants' gains
        for (const e of remaining) {
          thisRoundGain[e.target] = 0;
          thisRoundGain[e.stealer] += 0;
          ouChain.push({ stealer: e.stealer, target: e.target, amount: 0 });
          processed.add(e.stealer);
        }
        break;
      }
      for (const e of toProcess) {
        const amount = 2 * thisRoundGain[e.target];
        thisRoundGain[e.stealer] += amount;
        thisRoundGain[e.target] -= amount;
        ouChain.push({ stealer: e.stealer, target: e.target, amount });
        processed.add(e.stealer);
        remaining.splice(remaining.indexOf(e), 1);
      }
    }
  }

  // Phase 3: Apply net changes
  for (const p of players) {
    const move = playerMoves.get(p.id);
    const moveDef = move ? getMoveById(move.moveId) : null;
    // Deduct cost
    if (moveDef && moveDef.cost > 0) {
      energyChanges[p.id] -= moveDef.cost;
    }
    // Add gains
    energyChanges[p.id] += thisRoundGain[p.id];
  }

  return { energyChanges, ouChain };
}
