import { Server as SocketIOServer } from 'socket.io';
import { GameRoom } from '../room/GameRoom';
import { resolveEnergy } from './EnergyResolver';
import { resolveAttacks } from './MoveResolver';
import { computeRankings, computeLevelUps, applyLevelUps } from './LevelResolver';
import { getMoveById } from '../data/moves';
import { RoundResolution, GameState, PlayerInfo } from '../../shared/types';

const THINKING_TIME = 30_000;  // 30 seconds
const REVEAL_TIME = 2_000;     // 2 seconds
const RESULT_TIME = 3_000;     // 3 seconds

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
    room.pendingMoves.clear();
    room.thinkingDeadline = Date.now() + THINKING_TIME;

    const state: GameState = {
      phase: 'thinking',
      round: room.round,
      players: room.getPlayerInfos(),
      roomCode: room.roomCode,
      eliminationOrder: room.eliminationOrder,
      deadline: room.thinkingDeadline,
    };

    this.io.to(room.roomCode).emit('phase_change', { phase: 'thinking', state });

    // Set timer for auto-advance
    room.clearTimer();
    room.timer = setTimeout(() => {
      this.onThinkingTimeout(room);
    }, THINKING_TIME);
  }

  /** Called when a player submits a move */
  submitMove(room: GameRoom, playerId: string, moveId: string, targets: string[]): boolean {
    if (room.phase !== 'playing') return false;

    const player = room.players.get(playerId);
    if (!player || !player.alive) return false;

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

    // Validate targets
    if (moveDef.targetType === 'single' && targets.length !== 1) return false;
    if (moveDef.targetType === 'dual' && (targets.length < 1 || targets.length > 2)) return false;
    if (moveDef.targetType === 'all') {
      // Target all OTHER alive players (exclude self)
      targets = room.getAlivePlayers().filter(p => p.id !== playerId).map(p => p.id);
    }

    // Validate targets are alive
    for (const tid of targets) {
      const target = room.players.get(tid);
      if (!target || !target.alive) return false;
    }

    room.pendingMoves.set(playerId, { moveId, targets });

    // Check if all alive players submitted
    const aliveCount = room.getAlivePlayers().length;
    if (room.pendingMoves.size >= aliveCount) {
      room.clearTimer();
      this.startRevealPhase(room);
    }

    return true;
  }

  /** Timeout: auto-submit 运 for missing players */
  onThinkingTimeout(room: GameRoom): void {
    if (room.phase !== 'playing') return;

    const alive = room.getAlivePlayers();
    for (const p of alive) {
      if (!room.pendingMoves.has(p.id)) {
        room.pendingMoves.set(p.id, { moveId: 'yun', targets: [] });
      }
    }

    this.startRevealPhase(room);
  }

  /** Reveal phase: resolve and display all moves */
  startRevealPhase(room: GameRoom): void {
    room.phase = 'playing';

    const resolution = this.resolveFullRound(room);

    const state: GameState = {
      phase: 'reveal',
      round: room.round,
      players: room.getPlayerInfos(),
      roomCode: room.roomCode,
      eliminationOrder: room.eliminationOrder,
    };

    this.io.to(room.roomCode).emit('phase_change', { phase: 'reveal', state, resolution });

    // Advance to result phase after display time
    room.timer = setTimeout(() => {
      this.startResultPhase(room, resolution);
    }, REVEAL_TIME);
  }

  /** Result phase: apply deaths and energy changes */
  startResultPhase(room: GameRoom, resolution: RoundResolution): void {
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

    // Apply deaths
    for (const pid of resolution.deaths) {
      const player = room.players.get(pid);
      if (player && player.alive) {
        player.hp = 0;
        player.alive = false;
        room.eliminationOrder.push(pid);
      }
    }

    // Tick down buffs for surviving players
    for (const p of room.getAlivePlayers()) {
      p.buffs = p.buffs
        .map(b => ({ ...b, remainingRounds: b.remainingRounds - 1 }))
        .filter(b => b.remainingRounds > 0);
    }

    const aliveAfter = room.getAlivePlayers();

    const state: GameState = {
      phase: 'result',
      round: room.round,
      players: room.getPlayerInfos(),
      roomCode: room.roomCode,
      eliminationOrder: room.eliminationOrder,
    };

    this.io.to(room.roomCode).emit('phase_change', { phase: 'result', state, resolution });

    const hadDeaths = resolution.deaths.length > 0;

    room.timer = setTimeout(() => {
      if (aliveAfter.length <= 1) {
        this.endGame(room);
      } else {
        // Only reset energy when someone died this round (§3.5)
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
    room.clearTimer();

    const rankings = computeRankings(room.getAllPlayers(), room.eliminationOrder);
    const levelUps = computeLevelUps(rankings, room.getAllPlayers());
    applyLevelUps(levelUps, room.players);

    const state: GameState = {
      phase: 'finished',
      round: room.round,
      players: room.getPlayerInfos(),
      roomCode: room.roomCode,
      eliminationOrder: room.eliminationOrder,
    };

    this.io.to(room.roomCode).emit('game_over', {
      rankings,
      levelUps,
      players: room.getPlayerInfos(),
    });
  }

  /** Full round resolution pipeline */
  resolveFullRound(room: GameRoom): RoundResolution {
    const players = room.getAllPlayers();
    const moves = new Map(room.pendingMoves);

    // Step 1: Energy resolution
    const { energyChanges, ouChain } = resolveEnergy(players, moves);

    // Step 2: 跺 counter-kill (before attack resolution)
    const duoKills = new Set<string>();
    for (const p of players) {
      if (!p.alive) continue;
      const sub = moves.get(p.id);
      if (!sub) continue;
      const moveDef = getMoveById(sub.moveId);
      if (!moveDef || moveDef.specialEffect !== 'duo_counter') continue;

      // Check who is using 欧 on this player
      for (const other of players) {
        if (!other.alive || other.id === p.id) continue;
        const otherSub = moves.get(other.id);
        if (!otherSub) continue;
        const otherMove = getMoveById(otherSub.moveId);
        if (otherMove?.specialEffect === 'ou_steal' && otherSub.targets.includes(p.id)) {
          duoKills.add(other.id);
        }
      }
    }

    // Step 3: Attack resolution
    const { attacks, deaths, deathDetails } = resolveAttacks(players, moves, duoKills);

    // Add 跺 kills to deaths
    const playerMap = new Map(players.map(p => [p.id, p]));
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
        // Cancel death
        resolution.deaths = resolution.deaths.filter(d => d !== p.id);
        delete resolution.deathDetails[p.id];
      }
    }
  }
}
