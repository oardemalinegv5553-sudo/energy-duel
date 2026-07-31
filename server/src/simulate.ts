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
 *   npx tsx server/src/simulate.ts --bot1 trivial --bot2 normal --level 1 --session 10  # 10局连续升级
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
  session: boolean;
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
    games: parseInt(get('--games') || get('--session') || '20', 10),
    verbose: has('--verbose') || has('-v'),
    session: has('--session'),
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
        const stats = runBatch({ bot1: bots[i], bot2: bots[j], level, games, verbose: false, session: false });
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
// Session runner — multi-game with level progression
// ================================================================

interface SessionEntry {
  game: number;
  winner: string;
  rounds: number;
  bot1Level: number;
  bot2Level: number;
}

function runSession(config: SimConfig) {
  console.log(`\n${'═'.repeat(62)}`);
  console.log(`  升级对局  ${botName(config.bot1)}(${config.bot1})  vs  ${botName(config.bot2)}(${config.bot2})  起步 Lv.${config.level}  ×${config.games}局`);
  console.log(`${'═'.repeat(62)}`);

  let gameOverData: any = null;
  let lastResolution: RoundResolution | null = null;

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

  const engine = new GameEngine(mockIo);
  const room = new GameRoom('SIM', 'duo');
  room.initialLevel = config.level;

  const bot1 = room.addBot(botName(config.bot1), config.bot1);
  const bot2 = room.addBot(botName(config.bot2), config.bot2);
  bot1.level = config.level;
  bot2.level = config.level;

  const history: SessionEntry[] = [];
  let wins1 = 0, wins2 = 0;
  const startTime = Date.now();

  for (let g = 1; g <= config.games; g++) {
    // Reset tracking state for this game
    gameOverData = null;
    lastResolution = null;

    // Reset room (revive, clear energy, keep levels + botMemories)
    if (g > 1) {
      room.resetForNewGame();
    }

    engine.startGame(room);

    // Advance through rounds until game ends
    while (room.phase !== 'finished' && room.round < MAX_ROUNDS) {
      room.clearTimer();
      const aliveAfter = room.getAlivePlayers();
      const upgradeSlots = Math.floor(room.initialPlayerCount / 2);
      if (aliveAfter.length <= upgradeSlots) {
        engine.endGame(room);
        break;
      }
      const res = lastResolution;
      const hadDeaths = ((res as RoundResolution | null)?.deaths?.length ?? 0) > 0;
      if (hadDeaths) {
        for (const p of aliveAfter) p.energy = 0;
      }
      room.round++;
      engine.startThinkingPhase(room);
    }

    // Determine winner
    let winnerName: string;
    if (gameOverData?.rankings?.[0]) {
      if (gameOverData.rankings[0].playerId === bot1.id) {
        winnerName = botName(config.bot1); wins1++;
      } else if (gameOverData.rankings[0].playerId === bot2.id) {
        winnerName = botName(config.bot2); wins2++;
      } else {
        winnerName = '?';
      }
    } else {
      // Fallback: check alive state
      if (bot1.alive && !bot2.alive) { winnerName = botName(config.bot1); wins1++; }
      else if (!bot1.alive && bot2.alive) { winnerName = botName(config.bot2); wins2++; }
      else winnerName = '平局';
    }

    history.push({
      game: g,
      winner: winnerName,
      rounds: room.round,
      bot1Level: bot1.level,
      bot2Level: bot2.level,
    });

    if (config.verbose || g % 5 === 0 || g === config.games) {
      const e = ((Date.now() - startTime) / 1000).toFixed(0);
      console.log(`  G${String(g).padStart(2)}  ${winnerName.padEnd(8)} 胜  ${String(room.round).padStart(2)}回合  Lv.${String(bot1.level).padStart(2)} vs ${String(bot2.level).padStart(2)}  (${e}s)`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n  ┌${'─'.repeat(58)}┐`);
  console.log(`  │ ${botName(config.bot1).padEnd(8)} 胜: ${String(wins1).padStart(3)} (${String(Math.round(wins1/config.games*100)).padStart(3)}%)  最终 Lv.${String(bot1.level).padStart(2)}          │`);
  console.log(`  │ ${botName(config.bot2).padEnd(8)} 胜: ${String(wins2).padStart(3)} (${String(Math.round(wins2/config.games*100)).padStart(3)}%)  最终 Lv.${String(bot2.level).padStart(2)}          │`);
  console.log(`  │ 耗时: ${elapsed.padStart(5)}s                              │`);
  console.log(`  └${'─'.repeat(58)}┘`);

  return { wins1, wins2, history, finalLevel1: bot1.level, finalLevel2: bot2.level };
}

// ================================================================
// Multiplayer runner — N bots, one game, fixed level
// ================================================================

interface MultiConfig {
  bots: BotLevel[];  // one entry per player
  level: number;
  games: number;
  verbose: boolean;
}

function parseMultiArgs(): MultiConfig {
  const args = process.argv.slice(2);
  const get = (key: string) => {
    const i = args.indexOf(key);
    return i >= 0 ? args[i + 1] : null;
  };
  const has = (key: string) => args.includes(key);

  // --bots trivial,trivial,normal,normal  (comma-separated per player)
  const botsStr = get('--bots');
  let bots: BotLevel[];
  if (botsStr) {
    bots = botsStr.split(',').map(s => s.trim()) as BotLevel[];
  } else {
    // Fallback to --bot: all same type
    const n = parseInt(get('--players') || '4', 10);
    const bt = (get('--bot') || 'trivial') as BotLevel;
    bots = Array(n).fill(bt);
  }

  return {
    bots,
    level: parseInt(get('--level') || '1', 10),
    games: parseInt(get('--games') || '5', 10),
    verbose: has('--verbose') || has('-v'),
  };
}

function runMultiplayer(config: MultiConfig) {
  const label = config.bots.map(b => botName(b).charAt(0)).join(',');
  console.log(`\n${'═'.repeat(62)}`);
  console.log(`  多人混战  ${config.bots.map((b,i) => `${botName(b)}${i+1}`).join(' vs ')}  Lv.${config.level}  ×${config.games}局`);
  console.log(`${'═'.repeat(62)}`);

  for (let g = 1; g <= config.games; g++) {
    let gameOverData: any = null;
    let lastResolution: RoundResolution | null = null;

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

    const engine = new GameEngine(mockIo);
    const room = new GameRoom('SIM', 'multi');
    room.initialLevel = config.level;

    const bots: ReturnType<typeof room.addBot>[] = [];
    for (let i = 0; i < config.bots.length; i++) {
      const b = room.addBot(`${botName(config.bots[i])}${i + 1}`, config.bots[i]);
      b.level = config.level;
      bots.push(b);
    }

    // Collect per-round resolutions for verbose output
    const allRounds: { round: number; res: RoundResolution }[] = [];

    const startTime = Date.now();
    engine.startGame(room);
    // Capture first round's resolution
    if (lastResolution) {
      allRounds.push({ round: room.round, res: lastResolution as RoundResolution });
    }

    // Advance game loop
    while (room.phase !== 'finished' && room.round < MAX_ROUNDS) {
      room.clearTimer();
      const aliveAfter = room.getAlivePlayers();
      const upgradeSlots = Math.floor(room.initialPlayerCount / 2);
      if (aliveAfter.length <= upgradeSlots) {
        engine.endGame(room);
        break;
      }
      const res = lastResolution as RoundResolution | null;
      const hadDeaths = (res?.deaths?.length ?? 0) > 0;
      if (hadDeaths) {
        for (const p of aliveAfter) p.energy = 0;
      }
      room.round++;
      engine.startThinkingPhase(room);
      if (lastResolution) {
        allRounds.push({ round: room.round, res: lastResolution as RoundResolution });
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    // Print game summary
    if (gameOverData) {
      const rankings = gameOverData.rankings;
      const winner = rankings?.[0]?.nickname || '?';
      console.log(`\n  ── 第 ${g} 局 ──  胜者: ${winner}  (${room.round}回合, ${elapsed}s)`);
      if (rankings) {
        for (const r of rankings) {
          const stats = gameOverData.fairStats?.[r.playerId];
          const kills = stats ? `  击杀:${stats.kills}` : '';
          console.log(`    ${r.rank}. ${r.nickname}${kills}`);
        }
      }
    } else {
      const alive = room.getAlivePlayers();
      console.log(`\n  ── 第 ${g} 局 ──  平局(超时${MAX_ROUNDS}回合)  存活: ${alive.map(p => p.nickname).join(', ')}  (${elapsed}s)`);
    }

    // Show all rounds if verbose
    if (config.verbose && allRounds.length > 0) {
      for (const { round: rnd, res: rd } of allRounds) {
        console.log(`\n    R${rnd}:`);
        const moves = rd.moves;
        for (const b of bots) {
          const m = moves[b.id];
          const mn = m ? (getMoveById(m.moveId)?.name || m.moveId) : '—';
          console.log(`      ${b.nickname.padEnd(12)} ${mn.padEnd(8)}`);
        }
        if (rd.deaths.length > 0) {
          for (const d of rd.deaths) {
            const detail = rd.deathDetails[d];
            if (detail) console.log(`      → ${detail}`);
          }
        }
      }
    }
  }

  console.log(`\n  完成 ${config.games} 局多人混战`);
}

// ================================================================
// Main
// ================================================================

function main() {
  if (process.argv.includes('--players') || process.argv.includes('--bots')) {
    runMultiplayer(parseMultiArgs());
    return;
  }

  const config = parseArgs();

  if (config === 'all') {
    runAllMatchups(20);
  } else if (config.session) {
    runSession(config);
  } else {
    runBatch(config);
  }
}

main();
