import { GameRoom } from './GameRoom';
import { RoomType, RoomSummary } from '../../../shared/types';

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 for clarity

function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return code;
}

export class RoomManager {
  private rooms: Map<string, GameRoom> = new Map();
  private cleanupTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  createRoom(roomType: RoomType = 'duo', initialLevel: number = 1): GameRoom {
    let code: string;
    do {
      code = generateRoomCode();
    } while (this.rooms.has(code));
    const room = new GameRoom(code, roomType);
    room.initialLevel = Math.max(1, Math.min(17, initialLevel));
    this.rooms.set(code, room);
    return room;
  }

  getRoom(code: string): GameRoom | undefined {
    return this.rooms.get(code);
  }

  deleteRoom(code: string): void {
    const room = this.rooms.get(code);
    if (room) {
      room.clearTimer();
      for (const t of room.disconnectedPlayers.values()) clearTimeout(t);
      room.disconnectedPlayers.clear();
      room.llmConfig = undefined;  // don't hold API keys longer than needed
      room.llmConfigFrom = undefined;
      this.rooms.delete(code);
    }
    const pending = this.cleanupTimers.get(code);
    if (pending) {
      clearTimeout(pending);
      this.cleanupTimers.delete(code);
    }
  }

  // Cleanup rooms with no humans after 5 minutes
  scheduleCleanup(code: string): void {
    if (this.cleanupTimers.has(code)) return;  // already scheduled
    const timer = setTimeout(() => {
      this.cleanupTimers.delete(code);
      const room = this.rooms.get(code);
      if (room && (room.players.size === 0 || !room.hasHumanPlayers())) {
        this.deleteRoom(code);
      }
    }, 5 * 60 * 1000);
    this.cleanupTimers.set(code, timer);
  }

  getRoomSummaries(): RoomSummary[] {
    const summaries: RoomSummary[] = [];
    for (const room of this.rooms.values()) {
      if (room.players.size === 0) continue;
      if (!room.hasHumanPlayers()) continue;  // skip bot-only rooms
      summaries.push({
        roomCode: room.roomCode,
        roomType: room.roomType,
        phase: room.phase,
        gamePhase: room.gamePhase,
        playerCount: room.players.size,
        maxPlayers: room.maxPlayers,
        initialLevel: room.initialLevel,
      });
    }
    return summaries;
  }
}
