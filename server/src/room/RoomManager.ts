import { GameRoom } from './GameRoom';
import { RoomType } from '../../shared/types';

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

  createRoom(roomType: RoomType = 'duo', initialLevel: number = 1): GameRoom {
    let code: string;
    do {
      code = generateRoomCode();
    } while (this.rooms.has(code));
    const room = new GameRoom(code, roomType);
    room.initialLevel = Math.max(1, Math.min(13, initialLevel));
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
      this.rooms.delete(code);
    }
  }

  // Cleanup empty rooms after 5 minutes
  scheduleCleanup(code: string): void {
    setTimeout(() => {
      const room = this.rooms.get(code);
      if (room && room.players.size === 0) {
        this.deleteRoom(code);
      }
    }, 5 * 60 * 1000);
  }
}
