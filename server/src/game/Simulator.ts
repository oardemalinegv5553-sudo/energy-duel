/**
 * Bot vs Bot simulator — multi-player, any level.
 * Usage: npx tsx src/game/Simulator.ts
 */
import { PlayerState } from '../../shared/types';
import { getMoveById } from '../data/moves';
import { chooseBotMove, createBotMemory, recordOpponentMove } from './BotEngine';
import { resolveEnergy } from './EnergyResolver';
import { resolveAttacks } from './MoveResolver';

const MAX_ROUNDS = 20;

function makeBot(name: string, level: number): PlayerState {
  return {
    id: name, nickname: name, level, hp: 1, energy: 0,
    alive: true, buffs: [], isBot: true, botLevel: 'normal',
  };
}

function formatEnergy(n: number): string {
  if (n < 0.01) return '0';
  if (Math.abs(n % 1) < 0.01) return String(Math.round(n));
  if (Math.abs((n % 1) - 1/3) < 0.01) return `${Math.floor(n)}⅓`;
  if (Math.abs((n % 1) - 0.5) < 0.01) return `${Math.floor(n)}½`;
  return n.toFixed(1);
}

const LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

function runGame(gameNum: number, level: number, botCount: number): void {
  const label = botCount === 2 ? '双人' : '三人';
  console.log(`\n${'═'.repeat(55)}`);
  console.log(` 第 ${gameNum} 局 — ${label}对局 Lv.${level}`);
  console.log(`${'═'.repeat(55)}`);

  const bots = Array.from({ length: botCount }, (_, i) => makeBot(`人机${LABELS[i]}`, level));
  const mems = bots.map(() => createBotMemory());
  let round = 1;
  let eliminationOrder: string[] = [];

  // Show initial strategies
  console.log(' 初始策略: ' + bots.map((b, i) => `${LABELS[i]}(${mems[i].strategy.name}${mems[i].isTrickster ? '+诡诈' : ''})`).join(' | '));
  console.log();

  while (bots.filter(b => b.alive).length > 1 && round <= MAX_ROUNDS) {
    const alive = bots.filter(b => b.alive);

    // Bots choose moves
    const moveResults = bots.map((bot, i) => {
      if (!bot.alive) return { botId: bot.id, moveId: 'yun', targets: [] as string[] };
      const r = chooseBotMove('normal', bot, bots, round, mems[i]);
      // Auto-target for single/dual moves
      const def = getMoveById(r.moveId);
      const others = bots.filter(b => b.alive && b.id !== bot.id).map(b => b.id);
      if (def && def.targetType === 'single') r.targets = others.length > 0 ? [others[randInt(others.length)]] : [];
      if (def && def.targetType === 'dual') r.targets = others.slice(0, Math.min(others.length, randInt(2) + 1));
      return r;
    });

    const moves = new Map(bots.map((b, i) => [b.id, moveResults[i]]));

    // Energy
    const { energyChanges, ouChain } = resolveEnergy(bots, moves);
    for (const b of bots) {
      b.energy += energyChanges[b.id] || 0;
      if (b.energy < 0) b.energy = 0;
    }

    // 跺 pre-check
    const duoKills = new Set<string>();
    for (const b of bots) {
      if (!b.alive) continue;
      const sub = moves.get(b.id);
      if (!sub) continue;
      const m = getMoveById(sub.moveId);
      if (m?.specialEffect !== 'duo_counter') continue;
      for (const other of bots) {
        if (!other.alive || other.id === b.id) continue;
        const os = moves.get(other.id);
        if (!os) continue;
        const om = getMoveById(os.moveId);
        if (om?.specialEffect === 'ou_steal' && os.targets.includes(b.id)) duoKills.add(other.id);
      }
    }

    // Attacks
    const { attacks, deaths, deathDetails } = resolveAttacks(bots, moves, duoKills);
    for (const pid of duoKills) if (!deaths.includes(pid)) deaths.push(pid);
    for (const pid of deaths) {
      const p = bots.find(x => x.id === pid);
      if (p && p.alive) { p.hp = 0; p.alive = false; eliminationOrder.push(pid); }
    }

    // Display
    const parts = alive.map(b => {
      const sub = moves.get(b.id);
      const def = sub ? getMoveById(sub.moveId) : null;
      return `${LABELS[bots.indexOf(b)]}「${def?.name || '?'}」(${formatEnergy(b.energy)}气)`;
    });
    let line = ` R${round}: ${parts.join(' | ')}`;
    if (deaths.length > 0) {
      line += ` → 💀 ${deaths.map(pid => {
        const idx = bots.findIndex(b => b.id === pid);
        return `${LABELS[idx]}(${deathDetails[pid]?.slice(0, 30) || '死'})`;
      }).join(' ')}`;
    } else if (ouChain.length > 0) {
      line += ` [欧:${ouChain.map(c => c.amount).join(',')}]`;
    }
    console.log(line);

    // Record history
    for (let i = 0; i < bots.length; i++) {
      if (!bots[i].alive) continue;
      for (let j = 0; j < bots.length; j++) {
        if (i === j || !bots[j].alive) continue;
        recordOpponentMove(mems[i], bots[j].id, moveResults[j].moveId);
      }
    }

    // Tick buffs
    for (const b of bots) {
      b.buffs = b.buffs.map(bf => ({ ...bf, remainingRounds: bf.remainingRounds - 1 })).filter(bf => bf.remainingRounds > 0);
    }

    // Death = energy reset for survivors
    if (deaths.length > 0) {
      for (const b of bots) if (b.alive) b.energy = 0;
    }

    round++;
  }

  if (round > MAX_ROUNDS) console.log(' (超时平局)');
  const survivors = bots.filter(b => b.alive).map(b => LABELS[bots.indexOf(b)]);
  console.log(`\n 🏆 结果: ${survivors.length > 0 ? survivors.join('、') + ' 存活' : '全员阵亡'} (${round - 1}回合)`);
}

function randInt(max: number): number { return Math.floor(Math.random() * max); }

// ===== Run =====
console.log('═'.repeat(55));
console.log('🤖 普通人机 双人对战 ×3 — Lv.4');
console.log('═'.repeat(55));
for (let i = 1; i <= 3; i++) runGame(i, 4, 2);

console.log('\n\n' + '═'.repeat(55));
console.log('🤖 普通人机 三人混战 ×3 — Lv.4');
console.log('═'.repeat(55));
for (let i = 1; i <= 3; i++) runGame(i, 4, 3);
