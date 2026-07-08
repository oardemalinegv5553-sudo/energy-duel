import { PlayerState } from '../../shared/types';
import { getMoveById } from '../data/moves';

interface EnergyResult {
  energyChanges: Record<string, number>;
  ouChain: { stealer: string; target: string; amount: number }[];
}

/**
 * Resolve energy gains and 欧 steal chains.
 *
 * Rules:
 * - 运 gives +1 base gain this round
 * - 欧 steals 2x the target's BASE gain (original from 运, immutable)
 * - The target's round gain is zeroed (they lose what they earned this round)
 * - Multiple 欧 on same target → each independently copies 2x the same base gain
 * - Chain: A运→B欧A→C欧B → B's base=0, gain from stealing=2, C copies 2×2=4
 * - Target never goes negative — steal only takes this-round gains, not saved energy
 */
export function resolveEnergy(
  players: PlayerState[],
  playerMoves: Map<string, { moveId: string; targets: string[] }>
): EnergyResult {
  const energyChanges: Record<string, number> = {};
  const ouChain: { stealer: string; target: string; amount: number }[] = [];

  const playerMap = new Map(players.map(p => [p.id, p]));

  // Phase 1: Calculate base gains (from 运, immutable for steal calculations)
  const baseGain: Record<string, number> = {};
  for (const p of players) {
    baseGain[p.id] = 0;
    energyChanges[p.id] = 0;
    const sub = playerMoves.get(p.id);
    if (!sub) continue;
    const move = getMoveById(sub.moveId);
    if (move?.id === 'yun') {
      baseGain[p.id] = 1;
    }
  }

  // Phase 2: Build steal graph
  const stealEdges: { stealer: string; target: string }[] = [];
  const stealsFrom: Set<string> = new Set();
  const stolenFrom: Set<string> = new Set();

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

  // Phase 3: Resolve steals using topological order + baseGain as source of truth
  // 欧 steals 2x target's BASE gain, target's own round gain is zeroed
  const finalGain: Record<string, number> = {};
  for (const p of players) {
    finalGain[p.id] = baseGain[p.id];  // start with base gain
  }

  // Track which stealers have been processed (for chain ordering)
  // Process in topological order: targets that don't steal go first
  if (stealEdges.length > 0) {
    const processed = new Set<string>();
    const remaining = [...stealEdges];
    let iterations = 0;
    const maxIterations = stealEdges.length * 2;

    while (remaining.length > 0 && iterations < maxIterations) {
      iterations++;
      // Find edges where target doesn't steal OR target has been processed
      const toProcess = remaining.filter(e =>
        !stealsFrom.has(e.target) || processed.has(e.target)
      );

      if (toProcess.length === 0) {
        // Cycle: all remaining stealers and targets get 0
        for (const e of remaining) {
          finalGain[e.target] = 0;
          ouChain.push({ stealer: e.stealer, target: e.target, amount: 0 });
        }
        break;
      }

      for (const e of toProcess) {
        // Steal amount = 2x target's BASE gain (NOT current finalGain)
        const amount = 2 * baseGain[e.target];
        finalGain[e.stealer] += amount;
        finalGain[e.target] = 0;  // target's round gain is stolen
        // Update baseGain for chain: if stealer gained from stealing,
        // downstream stealers can copy from this stealer's effective base
        baseGain[e.stealer] += amount;
        ouChain.push({ stealer: e.stealer, target: e.target, amount });
        processed.add(e.stealer);
        remaining.splice(remaining.indexOf(e), 1);
      }
    }
  }

  // Phase 4: Apply net changes
  for (const p of players) {
    const move = playerMoves.get(p.id);
    const moveDef = move ? getMoveById(move.moveId) : null;
    if (moveDef && moveDef.cost > 0) {
      energyChanges[p.id] -= moveDef.cost;
    }
    // Add final round gain (never negative — steals only zero the gain)
    energyChanges[p.id] += finalGain[p.id];
  }

  return { energyChanges, ouChain };
}
