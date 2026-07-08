import { PlayerState, RoundResolution } from '../../shared/types';
import { getMoveById } from '../data/moves';

interface AttackRecord {
  attacker: string;   // playerId (client resolves to nickname)
  target: string;     // playerId
  atk: number;
  def: number;
  landing: boolean;
  description: string;
}

export function resolveAttacks(
  players: PlayerState[],
  moves: Map<string, { moveId: string; targets: string[] }>,
  duoKills: Set<string>
): { attacks: AttackRecord[]; deaths: string[]; deathDetails: Record<string, string> } {
  const attacks: AttackRecord[] = [];
  const deaths: string[] = [];
  const deathDetails: Record<string, string> = {};

  const aliveMap = new Map(players.map(p => [p.id, p.alive]));
  const playerMap = new Map(players.map(p => [p.id, p]));
  // Lookup nickname from playerId
  const N = (id: string) => playerMap.get(id)?.nickname || id;

  interface PendingAttack {
    attackerId: string;
    attackerAtk: number;
    targetIds: string[];
    moveId: string;
  }

  const pendingAttacks: PendingAttack[] = [];

  for (const p of players) {
    if (!p.alive) continue;
    const sub = moves.get(p.id);
    if (!sub) continue;
    const moveDef = getMoveById(sub.moveId);
    if (!moveDef) continue;
    if (moveDef.atk > 0) {
      pendingAttacks.push({
        attackerId: p.id,
        attackerAtk: moveDef.atk,
        targetIds: sub.targets,
        moveId: moveDef.id,
      });
    }
  }

  for (const pa of pendingAttacks) {
    for (const targetId of pa.targetIds) {
      if (!aliveMap.get(targetId)) continue;

      const target = playerMap.get(targetId);
      if (!target) continue;

      const targetSub = moves.get(targetId);
      const targetMove = targetSub ? getMoveById(targetSub.moveId) : null;

      // Attacker killed by 跺
      if (duoKills.has(pa.attackerId)) {
        attacks.push({
          attacker: pa.attackerId, target: targetId,
          atk: pa.attackerAtk, def: 0, landing: false,
          description: `${N(pa.attackerId)} 被跺反制，攻击失效`,
        });
        continue;
      }

      const targetIsAttackingBack = targetMove && targetMove.atk > 0 &&
        targetSub!.targets.includes(pa.attackerId);
      const targetIsDefending = targetMove && targetMove.def > 0;
      const targetIsLongdun = targetMove?.specialEffect === 'longdun_block';
      const targetIsDudun = targetMove?.specialEffect === 'dudun_block';

      let landing = false;
      let description = '';

      const atkMoveName = getMoveById(pa.moveId)?.name || '?';
      const defMoveName = targetMove?.name || '?';

      // CASE 1: Mutual attack
      if (targetIsAttackingBack) {
        const targetAtk = targetMove!.atk;
        const diff = Math.abs(pa.attackerAtk - targetAtk);
        if (diff < 9) {
          landing = false;
          description = `${N(pa.attackerId)}「${atkMoveName}」vs ${N(targetId)}「${defMoveName}」→ 对攻平手（差${diff}<9）`;
        } else if (pa.attackerAtk < targetAtk) {
          deaths.push(pa.attackerId);
          deathDetails[pa.attackerId] =
            `${N(pa.attackerId)} 的「${atkMoveName}」(${pa.attackerAtk}攻) 不敌 ${N(targetId)} 的「${defMoveName}」(${targetAtk}攻)，对攻败北`;
          landing = false;
          description = `对攻败北，${N(pa.attackerId)} 死亡`;
        } else {
          deaths.push(targetId);
          deathDetails[targetId] =
            `${N(targetId)} 的「${defMoveName}」(${targetAtk}攻) 不敌 ${N(pa.attackerId)} 的「${atkMoveName}」(${pa.attackerAtk}攻)，对攻败北`;
          landing = true;
          description = `对攻胜出，${N(targetId)} 死亡`;
        }
      }
      // CASE 2: Target defending (or special rule blocks)
      else if (targetIsDefending || targetIsLongdun || targetIsDudun) {
        if (targetIsLongdun && ['longzhua', 'xianglong'].includes(pa.moveId)) {
          landing = false;
          description = `${N(targetId)} 的龙盾免疫「${atkMoveName}」`;
        } else if (targetIsDudun && pa.moveId === 'du') {
          landing = false;
          description = `${N(targetId)} 的毒盾免疫「毒」`;
        } else if (pa.attackerAtk > (targetMove?.def ?? 0)) {
          deaths.push(targetId);
          deathDetails[targetId] =
            `${N(pa.attackerId)} 的「${atkMoveName}」(${pa.attackerAtk}攻) 击破 ${N(targetId)} 的「${defMoveName}」(${targetMove?.def ?? 0}防)`;
          landing = true;
          description = `${pa.attackerAtk}攻 > ${targetMove?.def ?? 0}防，击破`;
        } else {
          landing = false;
          description = `${N(targetId)} 的「${defMoveName}」(${targetMove?.def ?? 0}防) 挡住「${atkMoveName}」(${pa.attackerAtk}攻)`;
        }
      }
      // CASE 3: Target not defending
      else {
        landing = true;
        deaths.push(targetId);
        deathDetails[targetId] =
          `${N(pa.attackerId)} 的「${atkMoveName}」(${pa.attackerAtk}攻) 命中无防御的 ${N(targetId)}`;
        description = `${N(targetId)} 无防御，被击杀`;
      }

      attacks.push({
        attacker: pa.attackerId, target: targetId,
        atk: pa.attackerAtk, def: targetMove?.def ?? 0,
        landing, description,
      });

      if (landing && deaths.includes(targetId)) aliveMap.set(targetId, false);
      if (deaths.includes(pa.attackerId)) {
        aliveMap.set(pa.attackerId, false);
        break;
      }
    }
  }

  return { attacks, deaths: [...new Set(deaths)], deathDetails };
}

export function resolveRound(): RoundResolution {
  return { moves: {}, energyChanges: {}, ouChain: [], attacks: [], deaths: [], deathDetails: {} };
}
