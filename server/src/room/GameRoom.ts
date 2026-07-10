import { PlayerState, PlayerInfo, Buff, RoomType } from '../../../shared/types';
import { BotMemory, createBotMemory } from '../game/BotEngine';

function generateId(): string {
  return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

export type RoomPhase = 'waiting' | 'playing' | 'finished';

export class GameRoom {
  roomCode: string;
  roomType: RoomType = 'duo';
  phase: RoomPhase = 'waiting';
  round: number = 0;
  players: Map<string, PlayerState> = new Map();
  hostId: string = '';
  eliminationOrder: string[] = [];
  pendingMoves: Map<string, { moveId: string; targets: string[] }> = new Map();
  initialLevel: number = 1;
  initialPlayerCount: number = 0;
  thinkingDeadline: number = 0;
  massDeathTriggered: boolean = false;
  massDeathLevelUps: import('../../../shared/types').LevelUp[] = [];
  botMemories: Map<string, BotMemory> = new Map();
  timer: ReturnType<typeof setTimeout> | null = null;
  disconnectedPlayers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  previousLevels: Map<string, number> = new Map();  // accountId → level for rejoiners

  constructor(roomCode: string, roomType: RoomType = 'duo') {
    this.roomCode = roomCode;
    this.roomType = roomType;
  }

  get maxPlayers(): number {
    return this.roomType === 'duo' ? 2 : 8;
  }

  addPlayer(nickname: string): PlayerState {
    const id = generateId();
    const player: PlayerState = {
      id, nickname,
      level: this.initialLevel, hp: 1, energy: 0,
      alive: true, buffs: [], isBot: false,
    };
    this.players.set(id, player);
    if (!this.hostId) this.hostId = id;
    return player;
  }

  addBot(nickname: string, botLevel: import('../../../shared/types').BotLevel): PlayerState {
    const id = 'bot_' + generateId();
    const mem = createBotMemory();
    const player: PlayerState = {
      id, nickname,
      level: this.initialLevel, hp: 1, energy: 0,
      alive: true, buffs: [], isBot: true, botLevel,
    };
    this.players.set(id, player);
    this.botMemories.set(id, mem);
    if (!this.hostId) this.hostId = id;
    return player;
  }

  removePlayer(playerId: string): boolean {
    this.players.delete(playerId);
    this.pendingMoves.delete(playerId);
    if (playerId === this.hostId) {
      const first = this.players.keys().next().value;
      this.hostId = first || '';
    }
    return this.players.size === 0;
  }

  getAlivePlayers(): PlayerState[] {
    return Array.from(this.players.values()).filter(p => p.alive);
  }

  getAllPlayers(): PlayerState[] {
    return Array.from(this.players.values());
  }

  getPlayerInfos(): PlayerInfo[] {
    return this.getAllPlayers().map(p => ({
      id: p.id, nickname: p.nickname, level: p.level,
      alive: p.alive, energy: p.energy, hp: p.hp, buffs: p.buffs,
      isBot: p.isBot, botLevel: p.botLevel, strategyName: p.strategyName,
    }));
  }

  resetForNextRound(): void {
    for (const p of this.getAlivePlayers()) {
      p.energy = 0;
      p.buffs = p.buffs
        .map(b => ({ ...b, remainingRounds: b.remainingRounds - 1 }))
        .filter(b => b.remainingRounds > 0);
    }
    this.pendingMoves.clear();
    this.round++;
  }

  clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  resetForNewGame(): void {
    this.phase = 'waiting';
    this.round = 0;
    this.eliminationOrder = [];
    this.pendingMoves.clear();
    this.clearTimer();
    for (const p of this.players.values()) {
      p.hp = 1;
      p.alive = true;
      p.energy = 0;
      p.buffs = [];
    }
  }
}
