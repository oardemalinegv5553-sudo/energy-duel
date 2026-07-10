// ============================================================
// 蓄气对决 — Shared Types (client & server)
// ============================================================

// ---- Enums ----
export type GamePhase = 'waiting' | 'thinking' | 'reveal' | 'result' | 'finished';
export type MoveType = 'charge' | 'defense' | 'attack' | 'special' | 'special_defense';
export type TargetType = 'none' | 'single' | 'dual' | 'all';
export type RoomType = 'duo' | 'multi';

// ---- Move Definition ----
export interface MoveDef {
  id: string;
  name: string;
  level: number;
  cost: number;        // float, supports fractional (1/3, 1/2)
  type: MoveType;
  atk: number;
  def: number;
  targetType: TargetType;
  description: string;
  specialEffect?: 'ou_steal' | 'duo_counter' | 'guanyin_buff' | 'longdun_block' | 'dudun_block';
  globalUnlock?: boolean;   // if true, unlocks for all players when any one player reaches the level
}

// ---- Buff ----
export interface Buff {
  type: 'invincible';  // 观音坐莲
  remainingRounds: number;
}

// ---- Bot ----
export type BotLevel = 'easy' | 'normal' | 'hard';

// ---- Player State ----
export interface PlayerState {
  id: string;
  nickname: string;
  level: number;
  hp: number;
  energy: number;
  alive: boolean;
  buffs: Buff[];
  isBot: boolean;
  botLevel?: BotLevel;
  strategyName?: string;
}

// ---- Player Info (sent to clients) ----
export interface PlayerInfo {
  id: string;
  nickname: string;
  level: number;
  alive: boolean;
  energy: number;
  hp: number;
  buffs: Buff[];
  isBot: boolean;
  botLevel?: BotLevel;
  strategyName?: string;
}

// ---- Move Submission ----
export interface MoveSubmission {
  playerId: string;
  moveId: string;
  targets: string[];
}

// ---- Round Resolution ----
export interface RoundResolution {
  moves: Record<string, { moveId: string; moveName: string; targets: string[] }>;
  energyChanges: Record<string, number>;
  ouChain: { stealer: string; target: string; amount: number }[];
  attacks: {
    attacker: string;
    target: string;
    atk: number;
    def: number;
    landing: boolean;
    description: string;
  }[];
  deaths: string[];
  deathDetails: Record<string, string>; // playerId -> cause of death
}

// ---- Ranking ----
export interface Ranking {
  rank: number;
  playerId: string;
  nickname: string;
}

// ---- Level Up ----
export interface LevelUp {
  playerId: string;
  nickname: string;
  oldLevel: number;
  newLevel: number;
}

// ---- Game State (sent to clients) ----
export interface GameState {
  phase: GamePhase;
  round: number;
  players: PlayerInfo[];
  roomCode: string;
  roomType: RoomType;
  eliminationOrder: string[];
  deadline?: number;    // timestamp ms for thinking phase deadline
}

// ---- Socket Events ----
export interface ClientToServerEvents {
  create_room: (data: { nickname: string; roomType: RoomType; initialLevel?: number }, ack: (res: { roomCode: string; playerId: string }) => void) => void;
  join_room: (data: { nickname: string; roomCode: string }, ack: (res: { success: boolean; error?: string; playerId?: string; roomType?: RoomType }) => void) => void;
  leave_room: () => void;
  start_game: () => void;
  add_bot: (data: { level: BotLevel }) => void;
  remove_bot: (data: { botId: string }) => void;
  submit_move: (data: { moveId: string; targets: string[] }) => void;
  play_again: () => void;
}

export interface ServerToClientEvents {
  room_created: (data: { roomCode: string; playerId: string }) => void;
  player_list: (data: { players: PlayerInfo[]; hostId: string }) => void;
  game_started: (data: { state: GameState }) => void;
  phase_change: (data: { phase: GamePhase; state: GameState; resolution?: RoundResolution }) => void;
  game_over: (data: { rankings: Ranking[]; levelUps: LevelUp[]; players: PlayerInfo[] }) => void;
  error: (data: { message: string }) => void;
  room_closed: () => void;
  auth_info: (data: { accountId: string | null }) => void;
}
