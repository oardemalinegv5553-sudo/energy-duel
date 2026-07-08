import { PlayerState, Ranking, LevelUp } from '../../shared/types';

/**
 * Compute final rankings and level-ups.
 *
 * Rules:
 * - eliminationOrder[0] = died first = lowest rank
 * - Same-round deaths = tied rank
 * - Rankings: last to die = rank 1
 * - Level-up slots = floor(N/2)
 * - Allocate from highest rank down: if rank group fits in remaining slots → all upgrade;
 *   otherwise → none of them upgrade
 * - §3.4 catch-up is handled before game starts (not here)
 */
export function computeRankings(
  players: PlayerState[],
  eliminationOrder: string[]
): Ranking[] {
  const allPlayers = [...players];
  const n = allPlayers.length;

  // Build elimination groups: we need to know which players died in the same "batch"
  // For simplicity, we treat eliminationOrder as the order of death (each entry = one death).
  // Same-round deaths appear adjacent in order.
  // Actually, we need a proper grouping. Let's use a simpler approach:
  //
  // eliminationOrder is built as: each time resolveRound completes,
  // all deaths from that round are pushed together.
  // We need to track round boundaries. For now, use a flat order.

  // The last player alive (or last to die in final round) = rank 1
  // Reverse elimination order to get rankings
  const aliveAtEnd = allPlayers.filter(p => p.alive);
  const allDead = allPlayers.filter(p => !p.alive);

  // Group by elimination batch (simplified: one batch per entry for now)
  // In practice, we'll tag eliminationOrder with batch IDs in GameRoom

  const rankings: Ranking[] = [];
  const reversed = [...eliminationOrder].reverse();

  let currentRank = 1;
  for (let i = 0; i < reversed.length; i++) {
    rankings.push({
      rank: currentRank,
      playerId: reversed[i],
      nickname: allPlayers.find(p => p.id === reversed[i])?.nickname || '?',
    });
    currentRank++;
  }

  // Alive players get top ranks (they survived all rounds)
  for (const p of aliveAtEnd) {
    rankings.unshift({
      rank: 1,
      playerId: p.id,
      nickname: p.nickname,
    });
  }

  // Fix ranking numbers after insertion
  // Recompute based on position
  const finalRankings = rankings.map((r, i) => ({ ...r, rank: i + 1 }));

  return finalRankings;
}

/**
 * Calculate level-ups per §3.5 rules.
 * - upgradeSlots = floor(N/2)
 * - Distribute by ranking, whole rank group must fit or skip
 */
export function computeLevelUps(
  rankings: Ranking[],
  players: PlayerState[]
): LevelUp[] {
  const n = players.length;
  const upgradeSlots = Math.floor(n / 2);
  if (upgradeSlots === 0) return [];

  const levelUps: LevelUp[] = [];
  let remainingSlots = upgradeSlots;

  // Group rankings by rank number
  const rankGroups: { rank: number; playerIds: string[] }[] = [];
  for (const r of rankings) {
    const last = rankGroups[rankGroups.length - 1];
    if (last && last.rank === r.rank) {
      last.playerIds.push(r.playerId);
    } else {
      rankGroups.push({ rank: r.rank, playerIds: [r.playerId] });
    }
  }

  for (const group of rankGroups) {
    if (group.playerIds.length <= remainingSlots) {
      for (const pid of group.playerIds) {
        const player = players.find(p => p.id === pid);
        if (player) {
          levelUps.push({
            playerId: pid,
            nickname: player.nickname,
            oldLevel: player.level,
            newLevel: player.level + 1,
          });
        }
      }
      remainingSlots -= group.playerIds.length;
    }
    // If group is too big, skip — no partial upgrades
  }

  return levelUps;
}

/**
 * Apply level-up results to player states.
 */
export function applyLevelUps(levelUps: LevelUp[], players: Map<string, PlayerState>): void {
  for (const lu of levelUps) {
    const p = players.get(lu.playerId);
    if (p) {
      p.level = lu.newLevel;
    }
  }
}
