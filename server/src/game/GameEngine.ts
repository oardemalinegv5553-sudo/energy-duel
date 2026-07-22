import { Server as SocketIOServer } from 'socket.io';
import { GameRoom } from '../room/GameRoom';
import { resolveEnergy } from './EnergyResolver';
import { resolveAttacks } from './MoveResolver';
import { computeRankings, computeLevelUps, applyLevelUps } from './LevelResolver';
import { getMoveById, MOVES } from '../data/moves';
import { chooseBotMove, chooseHardBotMove, createBotMemory, recordOpponentMove } from './BotEngine';
import { RoundResolution, GameState, PlayerInfo } from '../../../shared/types';

const THINKING_TIME = 15_000;  // 15 seconds
const RESULT_TIME = 5_000;     // 5 seconds combined reveal+result

/**
 * GameEngine orchestrates round-by-round gameplay.
 */
export class GameEngine {
  private io: SocketIOServer;

  constructor(io: SocketIOServer) {
    this.io = io;
  }

  /** Build a GameState snapshot for clients */
  buildState(room: GameRoom): GameState {
    return {
      phase: room.phase === 'waiting' ? 'waiting' :
             room.phase === 'finished' ? 'finished' :
             'thinking', // default, will be overridden per-phase
      round: room.round,
      players: room.getPlayerInfos(),
      roomCode: room.roomCode,
      roomType: room.roomType,
      eliminationOrder: room.eliminationOrder,
      deadline: room.thinkingDeadline || undefined,
    };
  }

  /** Start the game */
  startGame(room: GameRoom): void {
    room.phase = 'playing';
    room.round = 1;
    room.initialPlayerCount = room.players.size;
    room.eliminationOrder = [];
    room.pendingMoves.clear();

    // Apply level catch-up (§3.4)
    this.applyLevelCatchUp(room);

    const state = this.buildState(room);
    this.io.to(room.roomCode).emit('game_started', { state });

    // Begin first thinking phase
    this.startThinkingPhase(room);
  }

  /** Apply §3.4 level catch-up: if max - min > 5, lowest levels up */
  applyLevelCatchUp(room: GameRoom): void {
    const alive = room.getAlivePlayers();
    if (alive.length < 2) return;

    const maxLevel = Math.max(...alive.map(p => p.level));
    const minLevel = Math.min(...alive.map(p => p.level));

    if (maxLevel - minLevel > 5) {
      const lowest = alive.filter(p => p.level === minLevel);
      for (const p of lowest) {
        const newLevel = maxLevel - 5;
        p.level = newLevel;
      }
    }
  }

  /** Start the thinking phase (players choose moves) */
  startThinkingPhase(room: GameRoom): void {
    room.phase = 'playing';
    room.gamePhase = 'thinking';
    room.pendingMoves.clear();
    room.thinkingDeadline = Date.now() + THINKING_TIME;

    const state: GameState = {
      phase: 'thinking',
      round: room.round,
      players: room.getPlayerInfos(),
      roomCode: room.roomCode,
      roomType: room.roomType,
      eliminationOrder: room.eliminationOrder,
      deadline: room.thinkingDeadline,
    };

    this.io.to(room.roomCode).emit('phase_change', { phase: 'thinking', state });

    // Run bot moves (easy/normal first, hard ones wait for checkAllSubmitted)
    this.runBotMoves(room);

    // If everyone already submitted (e.g. all-bot game), go straight to reveal
    // Only set the thinking timer if the round didn't already advance
    const advanced = this.checkAllSubmitted(room);
    if (!advanced) {
      room.timer = setTimeout(() => {
        this.onThinkingTimeout(room);
      }, THINKING_TIME);
    }
  }

  /** Run easy/normal bot moves at the beginning of thinking phase (hard bots wait) */
  private runBotMoves(room: GameRoom): void {
    const alive = room.getAlivePlayers();
    for (const bot of alive) {
      if (!bot.isBot) continue;
      if (bot.botLevel === 'hard') continue; // hard bot waits for everyone else
      if (room.pendingMoves.has(bot.id)) continue;

      const memory = room.botMemories.get(bot.id) || createBotMemory();
      const { moveId, targets } = chooseBotMove(
        bot.botLevel || 'easy', bot, room.getAllPlayers(), room.round, memory, room.shatteredSkills
      );
      // Validate & submit
      const moveDef = getMoveById(moveId);
      if (moveDef && bot.energy >= moveDef.cost) {
        room.pendingMoves.set(bot.id, { moveId, targets });
      } else {
        room.pendingMoves.set(bot.id, { moveId: 'yun', targets: [] });
      }
    }
  }

  /** Called when a player submits a move */
  submitMove(room: GameRoom, playerId: string, moveId: string, targets: string[]): boolean {
    if (room.phase !== 'playing') return false;

    const player = room.players.get(playerId);
    if (!player || !player.alive || player.spectator) return false;

    // Don't allow re-submission in same round
    if (room.pendingMoves.has(playerId)) return false;

    // Validate move exists and player has enough energy and level
    const moveDef = getMoveById(moveId);
    if (!moveDef) return false;
    // Check level: global moves check all players' levels
    if (moveDef.globalUnlock) {
      const allLevels = room.getAllPlayers().map(p => p.level);
      if (!allLevels.some(l => l >= moveDef.level)) return false;
    } else if (moveDef.level > player.level) {
      return false;
    }
    if (player.energy < moveDef.cost) return false;

    // Check shattered skills (§3.6)
    if (room.shatteredSkills.has(moveId)) return false;

    // Check cumulative trigger (§3.7)
    if (moveDef.cumulativeTrigger) {
      const counters = room.cumulativeCounters[playerId] || {};
      const required = moveDef.cumulativeCount || 3;
      if ((counters[moveDef.cumulativeTrigger] || 0) < required) return false;
      // Will deduct after resolution (in startResultPhase)
    }

    // Validate targets
    if (moveDef.targetType === 'single' && targets.length !== 1) return false;
    if (moveDef.targetType === 'dual' && (targets.length < 1 || targets.length > 2)) return false;
    if (moveDef.targetType === 'all') {
      // Target all OTHER alive players (exclude self)
      targets = room.getAlivePlayers().filter(p => p.id !== playerId).map(p => p.id);
    }

    // Validate targets are alive, not self, not teammates (team mode), and not duplicates
    if (moveDef.atk > 0 || moveDef.specialEffect === 'ou_steal') {
      for (const tid of targets) {
        const target = room.players.get(tid);
        if (!target || !target.alive) return false;
        if (tid === playerId) return false; // cannot target self
        // Team mode: single/dual attacks and 欧 cannot target teammates
        if (room.roomType === 'team' && moveDef.targetType !== 'all' && target.team === player.team) return false;
      }
      // Check for duplicate targets
      if (new Set(targets).size !== targets.length) return false;
    }
    if (moveDef.targetType === 'none' && targets.length > 0) return false;

    room.pendingMoves.set(playerId, { moveId, targets });

    this.checkAllSubmitted(room);
    return true;
  }

  /** Check if all players submitted, then reveal. Returns true if round advanced. */
  checkAllSubmitted(room: GameRoom): boolean {
    const alive = room.getAlivePlayers();
    const hardBots = alive.filter(p => p.isBot && p.botLevel === 'hard');

    // All non-hard players must have submitted first
    const nonHardDone = alive.every(p => p.botLevel === 'hard' || room.pendingMoves.has(p.id));
    if (!nonHardDone) return false;

    // Run hard bots now that everyone else's moves are known
    for (const hardBot of hardBots) {
      if (!room.pendingMoves.has(hardBot.id)) {
        const { moveId, targets } = chooseHardBotMove(
          hardBot, room.getAllPlayers(), room.pendingMoves, room.shatteredSkills
        );
        const moveDef = getMoveById(moveId);
        if (moveDef && hardBot.energy >= moveDef.cost) {
          room.pendingMoves.set(hardBot.id, { moveId, targets });
        } else {
          room.pendingMoves.set(hardBot.id, { moveId: 'yun', targets: [] });
        }
      }
    }

    // Now everyone (including hard bots) has submitted
    room.clearTimer();
    this.startRevealPhase(room);
    return true;
  }

  /** Timeout: auto-submit 运 for missing humans (bots already submitted at round start) */
  onThinkingTimeout(room: GameRoom): void {
    if (room.phase !== 'playing') return;

    const alive = room.getAlivePlayers();
    for (const p of alive) {
      if (!room.pendingMoves.has(p.id) && !p.isBot) {
        room.pendingMoves.set(p.id, { moveId: 'yun', targets: [] });
      }
    }

    this.checkAllSubmitted(room);
  }

  /** Reveal & Result combined into one phase */
  startRevealPhase(room: GameRoom): void {
    room.phase = 'playing';
    const resolution = this.resolveFullRound(room);
    // Apply everything and go straight to result
    this.startResultPhase(room, resolution);
  }

  /** Result phase: apply deaths and energy changes */
  startResultPhase(room: GameRoom, resolution: RoundResolution): void {
    room.gamePhase = 'result';
    // Apply energy changes
    for (const [pid, delta] of Object.entries(resolution.energyChanges)) {
      const player = room.players.get(pid);
      if (player) {
        player.energy += delta;
        // Clamp to >= 0
        if (player.energy < 0) player.energy = 0;
      }
    }

    // Apply 观音坐莲 buffs (before death check!)
    this.applyGuanyinBuff(room, resolution);

    // Apply 击碎 (before death check — shatter removes victims from deaths)
    this.applyShatter(room, resolution);

    // Apply deaths
    for (const pid of resolution.deaths) {
      const player = room.players.get(pid);
      if (player && player.alive) {
        player.hp = 0;
        player.alive = false;
        room.eliminationOrder.push(pid);
      }
    }

    // Reset shatter state + cumulative counters when someone dies (§3.6, §3.7)
    if (resolution.deaths.length > 0) {
      room.shatteredSkills.clear();
      room.cumulativeCounters = {};
    }

    // Record opponent moves for bots (learning)
    for (const p of room.getAllPlayers()) {
      if (p.isBot) {
        const mem = room.botMemories.get(p.id);
        if (mem) {
          for (const other of room.getAllPlayers()) {
            if (!other.isBot && other.alive) {
              const sub = room.pendingMoves.get(other.id);
              if (sub) recordOpponentMove(mem, other.id, sub.moveId);
            }
          }
        }
      }
    }

    // Tick down buffs for surviving players
    for (const p of room.getAlivePlayers()) {
      p.buffs = p.buffs
        .map(b => ({ ...b, remainingRounds: b.remainingRounds - 1 }))
        .filter(b => b.remainingRounds > 0);
    }

    // Fair mode: record kills for end-game level-up calculation
    this.recordFairKills(room, resolution);

    const aliveAfter = room.getAlivePlayers();
    const hadDeaths = resolution.deaths.length > 0;
    const upgradeSlots = Math.floor(room.initialPlayerCount / 2);

    const state: GameState = {
      phase: 'result',
      round: room.round,
      players: room.getPlayerInfos(),
      roomCode: room.roomCode,
      roomType: room.roomType,
      eliminationOrder: room.eliminationOrder,
    };

    this.io.to(room.roomCode).emit('phase_change', { phase: 'result', state, resolution });

    room.timer = setTimeout(() => {
      if (room.roomType === 'team') {
        // Team mode: game ends when one team is wiped out
        const teamsAlive = new Set(aliveAfter.map(p => p.team));
        if (teamsAlive.size <= 1) {
          // One team eliminated → winning team (including dead) all level up
          // Both teams dead → no one levels up
          if (aliveAfter.length > 0) {
            const winTeam = aliveAfter[0].team!;
            room.massDeathLevelUps = [];
            const winners = room.getAllPlayers().filter(p => p.team === winTeam);
            for (const p of winners) {
              room.massDeathLevelUps.push({
                playerId: p.id, nickname: p.nickname,
                oldLevel: p.level, newLevel: p.level + 1,
              });
              p.level += 1;
            }
          } else {
            room.massDeathLevelUps = [];
          }
          room.massDeathTriggered = true;
          this.endGame(room);
        } else {
          if (hadDeaths) {
            for (const p of aliveAfter) { p.energy = 0; }
          }
          room.round++;
          this.startThinkingPhase(room);
        }
      } else if (room.roomType === 'fair') {
        // Fair mode: per-round level-ups already applied, just check end condition
        if (aliveAfter.length <= upgradeSlots) {
          room.massDeathLevelUps = []; // no extra level-ups
          room.massDeathTriggered = true;
          this.endGame(room);
        } else {
          if (hadDeaths) {
            for (const p of aliveAfter) { p.energy = 0; }
          }
          room.round++;
          this.startThinkingPhase(room);
        }
      } else if (aliveAfter.length <= upgradeSlots) {
        // 剩余人数 ≤ 升级名额 → 游戏结束，幸存者直接升级
        if (aliveAfter.length > 0) {
          room.massDeathLevelUps = [];
          for (const p of aliveAfter) {
            room.massDeathLevelUps.push({
              playerId: p.id, nickname: p.nickname,
              oldLevel: p.level, newLevel: p.level + 1,
            });
            p.level += 1;
          }
          room.massDeathTriggered = true;
        }
        this.endGame(room);
      } else {
        if (hadDeaths) {
          for (const p of aliveAfter) {
            p.energy = 0;
          }
        }
        room.round++;
        this.startThinkingPhase(room);
      }
    }, RESULT_TIME);
  }

  /** End the game: compute rankings and level-ups */
  endGame(room: GameRoom): void {
    room.phase = 'finished';
    room.gamePhase = 'finished';
    room.clearTimer();

    let rankings;
    let levelUps: import('../../../shared/types').LevelUp[];
    let fairLevelUps: { playerId: string; nickname: string; oldLevel: number; newLevel: number; kills: number }[] | undefined;
    let fairStats: Record<string, { m: number; kills: number }> | undefined;

    // Fair mode: compute level-ups from all recorded kills, rank by m
    if (room.roomType === 'fair') {
      console.log(`[fair] endGame: fairKills has ${room.fairKills.length} entries`);
      // Compute m and kills per player from all recorded kills
      const killMap: Record<string, { gains: number; count: number }> = {};
      for (const k of room.fairKills) {
        const n = k.killerLevel - k.victimLevel;
        const gain = n > 0 ? 1 / n : n < 0 ? -n : 1;
        if (!killMap[k.killerId]) killMap[k.killerId] = { gains: 0, count: 0 };
        killMap[k.killerId].gains += gain;
        killMap[k.killerId].count += 1;
      }

      // Include all players (even those with 0 kills) in fairStats
      fairStats = {};
      for (const p of room.getAllPlayers()) {
        const k = killMap[p.id];
        fairStats[p.id] = { m: k ? k.gains : 0, kills: k ? k.count : 0 };
      }

      // Rank by m descending (ties: kills descending → elimination order)
      const all = room.getAllPlayers();
      const eliminated = room.eliminationOrder;
      all.sort((a, b) => {
        const mA = fairStats![a.id]?.m ?? 0;
        const mB = fairStats![b.id]?.m ?? 0;
        if (mB !== mA) return mB - mA;
        const kA = fairStats![a.id]?.kills ?? 0;
        const kB = fairStats![b.id]?.kills ?? 0;
        if (kB !== kA) return kB - kA;
        // Later eliminated = better rank
        const eA = eliminated.indexOf(a.id);
        const eB = eliminated.indexOf(b.id);
        if (eA !== -1 && eB !== -1) return eB - eA;
        return eA === -1 ? -1 : eB === -1 ? 1 : 0;
      });
      rankings = all.map((p, i) => ({
        rank: i + 1,
        playerId: p.id,
        nickname: p.nickname,
      }));

      fairLevelUps = this.computeFairLevelUps(room);
      levelUps = fairLevelUps.map(lu => ({
        playerId: lu.playerId, nickname: lu.nickname,
        oldLevel: lu.oldLevel, newLevel: lu.newLevel,
      }));
      applyLevelUps(levelUps, room.players);
      room.massDeathTriggered = false;
      room.massDeathLevelUps = [];
    } else {
      rankings = computeRankings(room.getAllPlayers(), room.eliminationOrder);
      // 过半死亡 → survivors already leveled up, use recorded levelUps
      levelUps = room.massDeathTriggered
        ? room.massDeathLevelUps
        : computeLevelUps(rankings, room.getAllPlayers(), room.initialPlayerCount);
      applyLevelUps(levelUps, room.players);
      room.massDeathTriggered = false;
      room.massDeathLevelUps = [];
    }

    const state: GameState = {
      phase: 'finished',
      round: room.round,
      players: room.getPlayerInfos(),
      roomCode: room.roomCode,
      roomType: room.roomType,
      eliminationOrder: room.eliminationOrder,
    };

    this.io.to(room.roomCode).emit('game_over', {
      rankings,
      levelUps,
      players: room.getPlayerInfos(),
      fairLevelUps,
      fairStats,
    });
  }

  /** Shatter chain: when a skill is shattered, also shatter linked skills */
  static readonly SHATTER_CHAIN: Record<string, string[]> = {
    'jinniu': ['haiwang'],  // 金牛被击碎时，海王也一同被击碎
  };

  /** Apply shattered skill effects: disable skills without killing the target */
  applyShatter(room: GameRoom, resolution: RoundResolution): void {
    const moves = room.pendingMoves;
    for (const [pid, sub] of moves) {
      const moveDef = getMoveById(sub.moveId);
      if (!moveDef || moveDef.specialEffect !== 'shatter') continue;

      for (const targetId of sub.targets) {
        // Find the corresponding attack record
        const attack = resolution.attacks.find(a => a.attacker === pid && a.target === targetId && a.landing);
        if (!attack) continue;

        // Shatter the target skills
        const targetsToShatter = moveDef.shatterTargets || (moveDef.shatterTarget ? [moveDef.shatterTarget] : []);
        for (const skillId of targetsToShatter) {
          room.shatteredSkills.add(skillId);
          // Chain shatter
          const chain = GameEngine.SHATTER_CHAIN[skillId];
          if (chain) {
            for (const chained of chain) {
              room.shatteredSkills.add(chained);
            }
          }
        }

        // Remove victim from deaths (shatter doesn't kill)
        resolution.deaths = resolution.deaths.filter(d => d !== targetId);
        delete resolution.deathDetails[targetId];

        // Update attack description
        const victimName = room.players.get(targetId)?.nickname || '?';
        const shatteredNames = targetsToShatter
          .map(s => getMoveById(s)?.name || s)
          .join('、');
        attack.description = `击碎！${victimName} 的「${shatteredNames}」被禁用`;
      }
    }
  }

  /** Full round resolution pipeline */
  resolveFullRound(room: GameRoom): RoundResolution {
    const players = room.getAllPlayers();
    const moves = new Map(room.pendingMoves);

    // Step 1: Energy resolution
    const { energyChanges, ouChain } = resolveEnergy(players, moves);

    // Step 2: 跺 counter-kill — global: ALL 欧 users killed by 跺 user
    const duoKills = new Set<string>();
    const duoKillers: Record<string, string> = {};  // victimId → killerId
    const duoUsers: string[] = [];
    for (const p of players) {
      if (!p.alive) continue;
      const sub = moves.get(p.id);
      if (!sub) continue;
      const moveDef = getMoveById(sub.moveId);
      if (moveDef?.specialEffect === 'duo_counter') {
        duoUsers.push(p.id);
      }
    }
    if (duoUsers.length > 0) {
      const killer = duoUsers[0]; // first 跺 user kills all 欧 users
      for (const other of players) {
        if (!other.alive) continue;
        const otherSub = moves.get(other.id);
        if (!otherSub) continue;
        const otherMove = getMoveById(otherSub.moveId);
        if (otherMove?.specialEffect === 'ou_steal') {
          duoKills.add(other.id);
          duoKillers[other.id] = killer;
        }
      }
    }

    // Step 3: Attack resolution
    const { attacks, deaths, deathDetails } = resolveAttacks(players, moves, duoKills);

    // Track cumulative counters: increment base skills, reset triggered moves
    for (const [pid, sub] of moves) {
      const moveDef = getMoveById(sub.moveId);
      if (!moveDef) continue;
      const player = room.players.get(pid);
      // Increment base skill counters for cumulative triggers
      for (const otherMove of MOVES) {
        if (otherMove.cumulativeTrigger === moveDef.id && moveDef.id !== otherMove.id) {
          // This move IS a base skill for some cumulative trigger
          if (!room.cumulativeCounters[pid]) room.cumulativeCounters[pid] = {};
          room.cumulativeCounters[pid][moveDef.id] = (room.cumulativeCounters[pid][moveDef.id] || 0) + 1;
          if (player) {
            if (!player.cumulativeProgress) player.cumulativeProgress = {};
            player.cumulativeProgress[moveDef.id] = room.cumulativeCounters[pid][moveDef.id];
          }
        }
      }
      // Reset counter when cumulative-triggered move is used
      if (moveDef.cumulativeTrigger) {
        if (!room.cumulativeCounters[pid]) room.cumulativeCounters[pid] = {};
        room.cumulativeCounters[pid][moveDef.cumulativeTrigger] = 0;
        if (player) {
          if (!player.cumulativeProgress) player.cumulativeProgress = {};
          player.cumulativeProgress[moveDef.cumulativeTrigger] = 0;
        }
      }
    }

    const playerMap = new Map(players.map(p => [p.id, p]));

    // Team-kill flavor text (independent messages for prominent display)
    const TEAM_KILL_FLAVOR = ['我们中出了一个叛徒！', '关键牺牲', '干得漂亮！！', '下一战：真人快打'];
    const teamKillMessages: string[] = [];
    for (const a of attacks) {
      if (!a.landing) continue;
      const atkPlayer = playerMap.get(a.attacker);
      const tgtPlayer = playerMap.get(a.target);
      const sameTeam = atkPlayer?.team !== undefined && atkPlayer.team === tgtPlayer?.team;
      if (sameTeam) {
        const msg = `${atkPlayer!.nickname} 击杀队友 ${tgtPlayer!.nickname} — ${TEAM_KILL_FLAVOR[Math.floor(Math.random() * TEAM_KILL_FLAVOR.length)]}`;
        teamKillMessages.push(msg);
      }
    }

    // Add 跺 kills to deaths
    for (const pid of duoKills) {
      if (!deaths.includes(pid)) {
        deaths.push(pid);
        const name = playerMap.get(pid)?.nickname || pid;
        deathDetails[pid] = `${name} 被「跺」反制击杀`;
      }
    }

    // Build move display
    const moveDisplay: Record<string, { moveId: string; moveName: string; targets: string[] }> = {};
    for (const [pid, sub] of moves) {
      const moveDef = getMoveById(sub.moveId);
      moveDisplay[pid] = {
        moveId: sub.moveId,
        moveName: moveDef?.name || '?',
        targets: sub.targets,
      };
    }

    return {
      moves: moveDisplay,
      energyChanges,
      ouChain,
      attacks,
      deaths,
      deathDetails,
      teamKillMessages: teamKillMessages.length > 0 ? teamKillMessages : undefined,
      duoKillers: Object.keys(duoKillers).length > 0 ? duoKillers : undefined,
    };
  }

  /** Apply 观音坐莲 buffs: check before applying deaths */
  applyGuanyinBuff(room: GameRoom, resolution: RoundResolution): void {
    for (const p of room.getAlivePlayers()) {
      const sub = room.pendingMoves.get(p.id);
      if (!sub) continue;
      const moveDef = getMoveById(sub.moveId);
      if (moveDef?.specialEffect === 'guanyin_buff') {
        // Add invincible buff for 2 rounds
        p.buffs.push({ type: 'invincible', remainingRounds: 2 });
      }

      // Check if player has active invincible buff
      const invincible = p.buffs.find(b => b.type === 'invincible');
      if (invincible && resolution.deaths.includes(p.id)) {
        // Cancel death & consume the invincible buff
        resolution.deaths = resolution.deaths.filter(d => d !== p.id);
        delete resolution.deathDetails[p.id];
        p.buffs = p.buffs.filter(b => b.type !== 'invincible');
      }
    }
  }

  /** Fair mode: record kills per round for end-game calculation */
  recordFairKills(room: GameRoom, resolution: RoundResolution): void {
    if (room.roomType !== 'fair') return;

    for (const deathId of resolution.deaths) {
      // Skip deaths where victim is the killer themselves (shouldn't happen)
      const victim = room.players.get(deathId);
      if (!victim) continue;

      let killerId: string | undefined;

      // 1. Check 跺 counter-kill
      if (resolution.duoKillers?.[deathId]) {
        killerId = resolution.duoKillers[deathId];
      } else {
        // 2. Find landing attack (last one on this target)
        const killAttack = [...resolution.attacks].reverse()
          .find(a => a.landing && a.target === deathId);
        if (killAttack) killerId = killAttack.attacker;
      }

      if (!killerId) continue;
      const killer = room.players.get(killerId);
      if (!killer || killer.id === deathId) continue;

      room.fairKills.push({
        killerId: killer.id,
        killerLevel: killer.level,
        victimLevel: victim.level,
      });
      console.log(`[fair] Round ${room.round}: ${killer.nickname}(Lv.${killer.level}) killed ${victim.nickname}(Lv.${victim.level}) — total kills recorded: ${room.fairKills.length}`);
    }
    if (resolution.deaths.length > 0) {
      const recordedThisRound = room.fairKills.length; // approximate
      console.log(`[fair] Round ${room.round}: ${resolution.deaths.length} deaths, recorded kills so far`);
    }
  }

  /** Fair mode: compute end-game level-ups from all recorded kills */
  computeFairLevelUps(room: GameRoom): { playerId: string; nickname: string; oldLevel: number; newLevel: number; kills: number }[] {
    const killMap: Record<string, { count: number; gains: number }> = {};

    for (const k of room.fairKills) {
      const n = k.killerLevel - k.victimLevel;
      const gain = n > 0 ? 1 / n : n < 0 ? -n : 1;

      if (!killMap[k.killerId]) killMap[k.killerId] = { count: 0, gains: 0 };
      killMap[k.killerId].count += 1;
      killMap[k.killerId].gains += gain;
    }

    const entries = Object.entries(killMap);
    if (entries.length === 0) return [];

    const totalM = entries.reduce((sum, [, v]) => sum + v.gains, 0);
    if (totalM === 0) return [];

    const totalPlayers = room.getAllPlayers().length;
    const target = totalPlayers / 2;

    const result: { playerId: string; nickname: string; oldLevel: number; newLevel: number; kills: number }[] = [];

    for (const [pid, { gains, count }] of entries) {
      const normalized = (gains * target) / totalM;
      const rounded = Math.round(normalized);
      if (rounded <= 0) continue;

      const player = room.players.get(pid);
      if (!player) continue;

      const oldLevel = player.level;
      player.level += rounded;
      result.push({
        playerId: pid,
        nickname: player.nickname,
        oldLevel,
        newLevel: player.level,
        kills: count,
      });
    }

    return result;
  }
}
