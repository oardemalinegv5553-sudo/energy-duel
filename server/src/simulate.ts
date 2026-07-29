/**
 * 人机对决模拟器
 * 使用完整 GameEngine，mock Socket.IO，定时器清零实现即时模拟
 *
 * Usage:
 *   npx tsx server/src/simulate.ts                                    # 默认：全 bot 对决，Lv.5+10，各20局
 *   npx tsx server/src/simulate.ts --level 7 --games 50               # Lv.7, 50局
 *   npx tsx server/src/simulate.ts --bot1 trivial --bot2 normal --level 5
 *   npx tsx server/src/simulate.ts --all --games 30                   # 所有两两组合
 *   npx tsx server/src/simulate.ts --bot1 trivial --bot2 normal --verbose  # 打印每局详情
 */

import { GameEngine } from './game/GameEngine';
import { GameRoom } from './room/GameRoom';
import { BotLevel, RoundResolution } from '../../shared/types';
import { getMoveById } from './data/moves';

// ================================================================
// Config
// ================================================================

const MAX_ROUNDS = 60; // 防止无限循环

interface SimConfig {
  bot1: BotLevel;
  bot2: BotLevel;
  level: number;
  games: number;
  verbose: boolean;
}

function parseArgs(): SimConfig | 'all' {
  const args = process.argv.slice(2);
  const get = (key: string) => {
    const i = args.indexOf(key);
    return i >= 0 ? args[i + 1] : null;
  };
  const has = (key: string) => args.includes(key);

  const all = has('--all');

  const config: SimConfig = {
    bot1: (get('--bot1') || 'trivial') as BotLevel,
    bot2: (get('--bot2') || 'normal') as BotLevel,
    level: parseInt(get('--level') || '5', 10),
    games: parseInt(get('--games') || '20', 10),
    verbose: has('--verbose') || has('-v'),
  };

  if (all) return 'all';
  return config;
}

// ================================================================
// Single game runner
// ================================================================

interface GameResult {
  winner: 'bot1' | 'bot2' | 'draw';
  rounds: number;
  endReason: string;
  roundsLog: {
    round: number;
    bot1Energy: number;
    bot2Energy: number;
    bot1Move: string;
    bot2Move: string;
    description: string;
  }[];
}

function runOneGame(level: number, bot1Type: BotLevel, bot2Type: BotLevel): GameResult {
  // ---- Mock Socket.IO ----
  let gameOverData: any = null;
  let lastResolution: RoundResolution | null = null;
  const roundsLog: GameResult['roundsLog'] = [];

  const mockIo = {
    to: (_room: string) => ({
      emit: (event: string, data: any) => {
        if (event === 'phase_change' && data.resolution) {
          lastResolution = data.resolution as RoundResolution;
        }
        if (event === 'game_over') {
          gameOverData = data;
        }
      },
    }),
  } as any;

  // ---- Setup ----
  const engine = new GameEngine(mockIo);
  const room = new GameRoom('SIM', 'duo');
  room.initialLevel = level;

  const bot1 = room.addBot(botName(bot1Type), bot1Type);
  const bot2 = room.addBot(botName(bot2Type), bot2Type);
  bot1.level = level;
  bot2.level = level;

  engine.startGame(room);

  // After startGame, first round is fully resolved (bots auto-submit synchronously)
  logRound(room, lastResolution, bot1.id, bot2.id, roundsLog);

  // ---- Main loop ----
  while (room.phase !== 'finished' && room.round < MAX_ROUNDS) {
    room.clearTimer();

    const aliveAfter = room.getAlivePlayers();
    const upgradeSlots = Math.floor(room.initialPlayerCount / 2);

    if (aliveAfter.length <= upgradeSlots) {
      engine.endGame(room);
      break;
    }

    // Replicate timer callback "continue" logic
    const hadDeaths = ((lastResolution as RoundResolution | null)?.deaths?.length ?? 0) > 0;
    if (hadDeaths) {
      for (const p of aliveAfter) {
        p.energy = 0;
      }
    }
    room.round++;
    engine.startThinkingPhase(room);

    logRound(room, lastResolution, bot1.id, bot2.id, roundsLog);
  }

  // Determine winner
  let winner: GameResult['winner'] = 'draw';
  let endReason = `达到最大回合数 ${MAX_ROUNDS}`;

  if (gameOverData) {
    const rankings = gameOverData.rankings;
    if (rankings && rankings.length > 0) {
      const first = rankings[0];
      if (first.playerId === bot1.id) winner = 'bot1';
      else if (first.playerId === bot2.id) winner = 'bot2';
      endReason = rankings.length === 2
        ? `排名: 1.${rankings[0].nickname} 2.${rankings[1].nickname}`
        : '正常结束';
    }
  } else {
    // No game_over → max rounds reached
    if (bot1.alive && !bot2.alive) winner = 'bot1';
    else if (!bot1.alive && bot2.alive) winner = 'bot2';
  }

  return { winner, rounds: room.round, endReason, roundsLog };
}

function logRound(
  room: GameRoom,
  resolution: RoundResolution | null,
  bot1Id: string, bot2Id: string,
  log: GameResult['roundsLog'],
) {
  if (!resolution) return;
  const m1 = resolution.moves[bot1Id];
  const m2 = resolution.moves[bot2Id];
  const p1 = room.players.get(bot1Id);
  const p2 = room.players.get(bot2Id);

  // Find most interesting attack description
  const relevantAttack = resolution.attacks.find(
    a => a.attacker === bot1Id || a.attacker === bot2Id,
  );

  log.push({
    round: room.round,
    bot1Energy: p1?.energy ?? 0,
    bot2Energy: p2?.energy ?? 0,
    bot1Move: m1 ? getMoveById(m1.moveId)?.name || m1.moveId : '?',
    bot2Move: m2 ? getMoveById(m2.moveId)?.name || m2.moveId : '?',
    description: relevantAttack?.description || (resolution.deaths.length > 0 ? `死亡: ${resolution.deaths.map(d => room.players.get(d)?.nickname || d).join(',')}` : '—'),
  });
}

function botName(level: BotLevel): string {
  const map: Record<BotLevel, string> = {
    trivial: '一般人机',
    easy: '简单人机',
    normal: '普通人机',
    hard: '困难人机',
  };
  return map[level];
}

// ================================================================
// Batch runner
// ================================================================

interface BatchStats {
  bot1Wins: number;
  bot2Wins: number;
  draws: number;
  totalRounds: number;
  games: number;
  bot1Type: BotLevel;
  bot2Type: BotLevel;
  level: number;
}

function runBatch(config: SimConfig): BatchStats {
  const stats: BatchStats = {
    bot1Wins: 0, bot2Wins: 0, draws: 0,
    totalRounds: 0, games: config.games,
    bot1Type: config.bot1, bot2Type: config.bot2,
    level: config.level,
  };

  console.log(`\n${'═'.repeat(62)}`);
  console.log(`  ${botName(config.bot1)}(${config.bot1})  vs  ${botName(config.bot2)}(${config.bot2})  @ Lv.${config.level}  ×${config.games}`);
  console.log(`${'═'.repeat(62)}`);

  const startTime = Date.now();

  for (let i = 0; i < config.games; i++) {
    const result = runOneGame(config.level, config.bot1, config.bot2);

    if (result.winner === 'bot1') stats.bot1Wins++;
    else if (result.winner === 'bot2') stats.bot2Wins++;
    else stats.draws++;
    stats.totalRounds += result.rounds;

    if (config.verbose) {
      const w = result.winner === 'bot1' ? botName(config.bot1) :
        result.winner === 'bot2' ? botName(config.bot2) : '平局';
      console.log(`\n  ── 第 ${i + 1} 局 ──  胜者: ${w}  (${result.rounds}回合)  ${result.endReason}`);
      if (config.verbose) {
        for (const r of result.roundsLog) {
          const e1 = r.bot1Energy.toFixed(1);
          const e2 = r.bot2Energy.toFixed(1);
          console.log(`    R${r.round}  ${r.bot1Move.padEnd(6)}(气${e1.padStart(4)})  ${r.bot2Move.padEnd(6)}(气${e2.padStart(4)})  ${r.description}`);
        }
      }
    }

    // Progress bar every 10 games
    if ((i + 1) % 10 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`  ... ${i + 1}/${config.games} (${elapsed}s)`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const avgRounds = (stats.totalRounds / stats.games).toFixed(1);
  const bot1Rate = ((stats.bot1Wins / stats.games) * 100).toFixed(1);
  const bot2Rate = ((stats.bot2Wins / stats.games) * 100).toFixed(1);
  const drawRate = ((stats.draws / stats.games) * 100).toFixed(1);

  console.log(`\n  ┌${'─'.repeat(58)}┐`);
  console.log(`  │ ${botName(config.bot1).padEnd(8)} 胜: ${String(stats.bot1Wins).padStart(3)} (${bot1Rate}%)  │ 平均回合: ${avgRounds.padStart(4)}  │`);
  console.log(`  │ ${botName(config.bot2).padEnd(8)} 胜: ${String(stats.bot2Wins).padStart(3)} (${bot2Rate}%)  │ 耗时: ${elapsed.padStart(5)}s  │`);
  if (stats.draws > 0) {
    console.log(`  │ 平局                    : ${String(stats.draws).padStart(3)} (${drawRate}%)  │                │`);
  }
  console.log(`  └${'─'.repeat(58)}┘`);

  return stats;
}

// ================================================================
// All-vs-all matrix
// ================================================================

function runAllMatchups(games: number) {
  const bots: BotLevel[] = ['trivial', 'easy', 'normal', 'hard'];
  const levels = [5, 10];

  const allStats: BatchStats[] = [];

  for (const level of levels) {
    for (let i = 0; i < bots.length; i++) {
      for (let j = i + 1; j < bots.length; j++) {
        const stats = runBatch({ bot1: bots[i], bot2: bots[j], level, games, verbose: false });
        allStats.push(stats);
      }
    }
  }

  // Summary matrix
  console.log(`\n${'═'.repeat(62)}`);
  console.log(`  汇总矩阵`);
  console.log(`${'═'.repeat(62)}`);

  for (const level of levels) {
    console.log(`\n  Lv.${level}:`);
    console.log(`  ${' '.repeat(10)}${bots.map(b => botName(b).padEnd(8)).join('')}`);
    for (const b1 of bots) {
      let row = `  ${botName(b1).padEnd(10)}`;
      for (const b2 of bots) {
        if (b1 === b2) {
          row += '  —    ';
          continue;
        }
        const stats = allStats.find(s =>
          s.level === level &&
          ((s.bot1Type === b1 && s.bot2Type === b2) || (s.bot1Type === b2 && s.bot2Type === b1)),
        );
        if (!stats) { row += '  ?    '; continue; }
        const b1Wins = stats.bot1Type === b1 ? stats.bot1Wins : stats.bot2Wins;
        const b2Wins = stats.bot1Type === b1 ? stats.bot2Wins : stats.bot1Wins;
        const total = b1Wins + b2Wins || 1;
        const rate = Math.round((b1Wins / total) * 100);
        row += `${rate}%`.padEnd(8);
      }
      console.log(row);
    }
  }
}

// ================================================================
// Main
// ================================================================

function main() {
  const config = parseArgs();

  if (config === 'all') {
    runAllMatchups(20);
  } else {
    runBatch(config);
  }
}

main();
