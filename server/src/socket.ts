import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { randomBytes } from 'crypto';
import { RoomManager } from './room/RoomManager';
import { GameEngine } from './game/GameEngine';
import { GameRoom } from './room/GameRoom';
import { ClientToServerEvents, ServerToClientEvents, LLMConfig, BotLevel } from '../../shared/types';
import { AuthManager } from './auth/AuthManager';
import { validateLLMEndpoint } from './llmBot';

// ---- Input validation helpers ----

function str(v: unknown, maxLen = 100): string | null {
  return typeof v === 'string' && v.length > 0 && v.length <= maxLen ? v : null;
}

function sanitizeNickname(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const n = v.trim().replace(/[\x00-\x1f\x7f]/g, '');
  return n.length >= 1 && n.length <= 16 ? n : null;
}

function strArray(v: unknown, maxLen: number): string[] | null {
  if (!Array.isArray(v) || v.length > maxLen) return null;
  if (!v.every(x => typeof x === 'string' && x.length <= 64)) return null;
  return v as string[];
}

const BOT_LEVELS: BotLevel[] = ['easy', 'normal', 'hard', 'trivial', 'llm'];
const ROOM_TYPES = ['duo', 'multi', 'team', 'fair'];

/** Wrap a socket handler so bad payloads / bugs can't crash the process */
function guarded<T extends (...args: any[]) => any>(name: string, fn: T): T {
  return ((...args: any[]) => {
    try {
      const result = fn(...args);
      if (result instanceof Promise) {
        result.catch(err => console.error(`[socket] handler "${name}" rejected:`, err));
      }
    } catch (err) {
      console.error(`[socket] handler "${name}" threw:`, err);
    }
  }) as T;
}

/** Simple per-socket sliding-window rate limiter */
class RateLimiter {
  private buckets = new Map<string, number[]>();

  allow(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const arr = (this.buckets.get(key) || []).filter(t => now - t < windowMs);
    if (arr.length >= limit) {
      this.buckets.set(key, arr);
      return false;
    }
    arr.push(now);
    this.buckets.set(key, arr);
    return true;
  }

  clear(key: string): void {
    this.buckets.delete(key);
  }
}

const DISCONNECT_GRACE_MS = 10 * 60 * 1000;  // mid-game rejoin window

export function createSocketServer(httpServer: HTTPServer, authManager: AuthManager) {
  const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  // ---- Auth middleware ----
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (token && typeof token === 'string') {
      const session = authManager.validateSession(token);
      if (session) {
        (socket as any).accountId = session.accountId;
        (socket as any).accountUsername = session.username;
      }
    }
    next(); // Always allow — invalid/missing token = guest
  });

  const roomManager = new RoomManager();
  const gameEngine = new GameEngine(io);
  const rateLimiter = new RateLimiter();

  // Track which socket is in which room and which player
  const socketRooms = new Map<string, { roomCode: string; playerId: string; accountId?: string; nickname: string }>();

  // Broadcast room list to all connected clients (for lobby)
  function broadcastRoomList(): void {
    io.emit('room_list_update', roomManager.getRoomSummaries());
  }

  io.on('connection', (socket) => {
    const accountId: string | undefined = (socket as any).accountId;
    console.log(`[socket] connected: ${socket.id}${accountId ? ` [auth:${accountId}]` : ' [guest]'}`);

    // Send auth status to client
    socket.emit('auth_info', { accountId: accountId || null });

    // ---- List Rooms ----
    socket.on('list_rooms', guarded('list_rooms', (ack) => {
      if (typeof ack === 'function') ack(roomManager.getRoomSummaries());
    }));

    // ---- Room Creation ----
    socket.on('create_room', guarded('create_room', (data, ack) => {
      if (!data || typeof data !== 'object') return;
      if (!rateLimiter.allow(socket.id, 5, 60_000)) {
        if (typeof ack === 'function') ack({ roomCode: '', playerId: '', reconnectToken: '' });
        socket.emit('error', { message: '操作过于频繁，请稍后再试' });
        return;
      }
      const nickname = sanitizeNickname(data.nickname);
      if (!nickname) {
        socket.emit('error', { message: '昵称需为 1-16 个字符' });
        return;
      }
      const roomType = ROOM_TYPES.includes(data.roomType) ? data.roomType : 'duo';
      const initialLevel = typeof data.initialLevel === 'number' && Number.isFinite(data.initialLevel)
        ? data.initialLevel : 1;

      const room = roomManager.createRoom(roomType, initialLevel);
      const playerTeam = roomType === 'team' ? 0 : undefined;
      const player = room.addPlayer(nickname, playerTeam);
      const reconnectToken = randomBytes(16).toString('hex');
      room.reconnectTokens.set(player.id, reconnectToken);

      socket.join(room.roomCode);
      socketRooms.set(socket.id, {
        roomCode: room.roomCode, playerId: player.id,
        accountId: (socket as any).accountId, nickname,
      });

      if (typeof ack === 'function') ack({ roomCode: room.roomCode, playerId: player.id, reconnectToken });

      io.to(room.roomCode).emit('player_list', {
        players: room.getPlayerInfos(),
        hostId: room.hostId,
      });
      broadcastRoomList();

      console.log(`[room] ${nickname}${(socket as any).accountId ? ` [${(socket as any).accountId}]` : ''} created ${room.roomType} room ${room.roomCode} (initial Lv.${room.initialLevel})`);
    }));

    // ---- Join Room ----
    socket.on('join_room', guarded('join_room', (data, ack) => {
      if (!data || typeof data !== 'object') return;
      const fail = (error: string) => { if (typeof ack === 'function') ack({ success: false, error }); };

      const roomCode = str(data.roomCode, 8);
      const nickname = sanitizeNickname(data.nickname);
      if (!roomCode || !nickname) {
        fail(!nickname ? '昵称需为 1-16 个字符' : '房间号无效');
        return;
      }
      const room = roomManager.getRoom(roomCode.toUpperCase());
      if (!room) {
        fail('房间不存在');
        return;
      }
      // Always allow join unless full
      const isGameInProgress = room.phase !== 'waiting';
      if (room.players.size >= room.maxPlayers) {
        fail(`房间已满（最多 ${room.maxPlayers} 人）`);
        return;
      }
      // Team mode: auto-assign to smaller team if not specified
      let joinTeam: number | undefined;
      if (room.roomType === 'team') {
        if (data.team === 0 || data.team === 1) {
          joinTeam = data.team;
        } else {
          const red = room.getAllPlayers().filter(p => p.team === 0).length;
          const blue = room.getAllPlayers().filter(p => p.team === 1).length;
          joinTeam = red <= blue ? 0 : 1;
        }
      }
      // Check duplicate nickname
      const exists = room.getAllPlayers().some(p => p.nickname === nickname);
      if (exists) {
        fail('昵称已被使用');
        return;
      }

      const player = room.addPlayer(nickname, joinTeam);
      const reconnectToken = randomBytes(16).toString('hex');
      room.reconnectTokens.set(player.id, reconnectToken);

      // If joining mid-game, enter as spectator (can't play until next game)
      if (isGameInProgress) {
        player.spectator = true;
        player.alive = false;
      }

      // If joining mid-game (during thinking), match the lowest alive player's level
      if (room.gamePhase === 'thinking') {
        const aliveLevels = room.getAlivePlayers().map(p => p.level);
        if (aliveLevels.length > 0) {
          const minAlive = Math.min(...aliveLevels);
          player.level = Math.max(player.level, minAlive);
        }
      }

      // Restore previous level for logged-in players rejoining same room
      const acctId: string | undefined = (socket as any).accountId;
      if (acctId && room.previousLevels.has(acctId)) {
        player.level = room.previousLevels.get(acctId)!;
        room.previousLevels.delete(acctId);
      }

      socket.join(room.roomCode);
      socketRooms.set(socket.id, {
        roomCode: room.roomCode, playerId: player.id,
        accountId: acctId, nickname,
      });

      if (typeof ack === 'function') ack({ success: true, playerId: player.id, roomType: room.roomType, reconnectToken });

      // Send chat history to the new player
      if (room.chatMessages.length > 0) {
        socket.emit('chat_history', room.chatMessages);
      }

      io.to(room.roomCode).emit('player_list', {
        players: room.getPlayerInfos(),
        hostId: room.hostId,
      });

      // If game is in progress, send current game state so spectator sees the game screen
      if (isGameInProgress && room.gamePhase !== 'waiting') {
        const state = gameEngine.buildState(room);
        socket.emit('phase_change', { phase: room.gamePhase, state });
      }

      broadcastRoomList();

      console.log(`[room] ${nickname} joined room ${room.roomCode}`);
    }));

    // ---- Rejoin Room (after refresh/disconnect) ----
    socket.on('rejoin_room', guarded('rejoin_room', (data, ack) => {
      if (!data || typeof data !== 'object') return;
      const fail = (error: string) => { if (typeof ack === 'function') ack({ success: false, error }); };

      const roomCode = str(data.roomCode, 8);
      const playerId = str(data.playerId, 64);
      if (!roomCode || !playerId) {
        fail('参数无效');
        return;
      }
      const room = roomManager.getRoom(roomCode);
      if (!room) {
        fail('房间不存在');
        return;
      }

      // Check if player is still in the room (game disconnect) or in grace period
      const playerExists = room.players.has(playerId);
      const timer = room.disconnectedPlayers.get(playerId);
      if (!playerExists && !timer) {
        fail('已退出房间，请重新加入');
        return;
      }

      // Verify rejoin credential — playerId alone is broadcast to the whole room
      const expectedToken = room.reconnectTokens.get(playerId);
      if (!expectedToken || expectedToken !== data.reconnectToken) {
        fail('重连凭证无效，请重新加入');
        return;
      }

      // Clean up timer if any
      if (timer) {
        clearTimeout(timer);
        room.disconnectedPlayers.delete(playerId);
      }

      // Reconnect new socket to existing player
      socket.join(roomCode);
      const p = room.players.get(playerId);
      socketRooms.set(socket.id, {
        roomCode, playerId,
        accountId: (socket as any).accountId,
        nickname: p?.nickname || '',
      });

      if (typeof ack === 'function') ack({ success: true, playerId, roomType: room.roomType, reconnectToken: expectedToken });

      // Send chat history to rejoining player
      if (room.chatMessages.length > 0) {
        socket.emit('chat_history', room.chatMessages);
      }

      io.to(roomCode).emit('player_list', {
        players: room.getPlayerInfos(),
        hostId: room.hostId,
      });

      // Send current game state if game in progress
      if (room.phase === 'playing') {
        const state = gameEngine.buildState(room);
        socket.emit('phase_change', { phase: state.phase, state });
      }

      console.log(`[room] ${p?.nickname || playerId} rejoined room ${roomCode}`);
    }));

    // ---- Start Game (host only) ----
    socket.on('start_game', guarded('start_game', () => {
      const info = socketRooms.get(socket.id);
      if (!info) return;
      const room = roomManager.getRoom(info.roomCode);
      if (!room) return;
      if (room.phase !== 'waiting') {
        socket.emit('error', { message: room.phase === 'playing' ? '游戏正在进行中' : '游戏已结束，请点再来一局' });
        return;
      }
      if (room.hostId !== info.playerId) {
        socket.emit('error', { message: '只有房主可以开始游戏' });
        return;
      }
      if (room.roomType === 'team') {
        const team0 = room.getAlivePlayers().filter(p => p.team === 0).length;
        const team1 = room.getAlivePlayers().filter(p => p.team === 1).length;
        if (team0 < 1 || team1 < 1) {
          socket.emit('error', { message: '每队至少需要 1 名玩家' });
          return;
        }
      } else if (room.getAlivePlayers().length < 2) {
        socket.emit('error', { message: '至少需要 2 名玩家' });
        return;
      }

      gameEngine.startGame(room);
      broadcastRoomList();
      console.log(`[game] Room ${room.roomCode} started with ${room.players.size} players`);
    }));

    // ---- Switch Team (team mode only, before game starts) ----
    socket.on('switch_team', guarded('switch_team', (data) => {
      const info = socketRooms.get(socket.id);
      if (!info) return;
      const room = roomManager.getRoom(info.roomCode);
      if (!room || room.roomType !== 'team') return;
      if (room.phase !== 'waiting') return;

      // Host can switch anyone (including bots); players can only switch themselves
      const targetId = (data && typeof data.playerId === 'string' && info.playerId === room.hostId) ? data.playerId : info.playerId;
      const player = room.players.get(targetId);
      if (!player) return;

      player.team = player.team === 0 ? 1 : 0;

      io.to(room.roomCode).emit('player_list', {
        players: room.getPlayerInfos(),
        hostId: room.hostId,
      });
    }));

    // ---- Add Bot (host only) ----
    socket.on('add_bot', guarded('add_bot', (data) => {
      if (!data || typeof data !== 'object') return;
      if (!rateLimiter.allow(socket.id, 12, 60_000)) return;
      const info = socketRooms.get(socket.id);
      if (!info) return;
      const room = roomManager.getRoom(info.roomCode);
      if (!room) return;
      if (!BOT_LEVELS.includes(data.level)) return;
      if (room.roomType === 'team' && data.level === 'easy') {
        socket.emit('error', { message: '组队模式不支持简单人机' });
        return;
      }
      if (room.hostId !== info.playerId) {
        socket.emit('error', { message: '只有房主可以添加人机' });
        return;
      }
      if (room.phase !== 'waiting') {
        socket.emit('error', { message: '游戏开始后不能添加人机' });
        return;
      }
      if (room.players.size >= room.maxPlayers) {
        socket.emit('error', { message: '房间已满' });
        return;
      }
      if (data.level === 'hard' && room.getAllPlayers().some(p => p.isBot && p.botLevel === 'hard')) {
        socket.emit('error', { message: '每个房间只能添加一个困难人机' });
        return;
      }
      const levelLabel = data.level === 'easy' ? '简单人机' : data.level === 'hard' ? '困难人机' : data.level === 'trivial' ? '一般人机' : data.level === 'llm' ? 'LLM人机' : '普通人机';
      const sameLevel = room.getAllPlayers().filter(p => p.isBot && p.botLevel === data.level).length;
      const bot = room.addBot(`${levelLabel}${sameLevel + 1}`, data.level);
      // Sync LLM config from socket to room (for LLM bots)
      if (data.level === 'llm' && socketLLMConfigs.has(socket.id)) {
        room.llmConfig = socketLLMConfigs.get(socket.id);
        room.llmConfigFrom = socket.id;
      }
      socket.join(room.roomCode);
      console.log(`[room] Bot ${bot.nickname} (${data.level}) added to ${room.roomCode}`);

      io.to(room.roomCode).emit('player_list', {
        players: room.getPlayerInfos(),
        hostId: room.hostId,
      });
    }));

    // ---- Remove Bot (host only) ----
    socket.on('remove_bot', guarded('remove_bot', (data) => {
      if (!data || typeof data !== 'object') return;
      const botId = str(data.botId, 64);
      if (!botId) return;
      const info = socketRooms.get(socket.id);
      if (!info) return;
      const room = roomManager.getRoom(info.roomCode);
      if (!room) return;
      if (room.hostId !== info.playerId) return;
      if (room.phase !== 'waiting') return;
      const bot = room.players.get(botId);
      if (!bot || !bot.isBot) return;
      room.players.delete(botId);
      io.to(room.roomCode).emit('player_list', {
        players: room.getPlayerInfos(),
        hostId: room.hostId,
      });
    }));

    // ---- Submit Move ----
    socket.on('submit_move', guarded('submit_move', (data) => {
      if (!data || typeof data !== 'object') return;
      const moveId = str(data.moveId, 32);
      const targets = strArray(data.targets, 8);
      if (!moveId || !targets) return;
      const info = socketRooms.get(socket.id);
      if (!info) return;
      const room = roomManager.getRoom(info.roomCode);
      if (!room) return;

      const ok = gameEngine.submitMove(room, info.playerId, moveId, targets);
      if (!ok) {
        socket.emit('error', { message: '出招无效（气不足/等级不够/已出招/目标无效）' });
      }
    }));

    // ---- Chat Message ----
    socket.on('chat_message', guarded('chat_message', (data) => {
      if (!data || typeof data !== 'object') return;
      const content = str(data.content, 500);
      if (!content) return;
      if (!rateLimiter.allow(socket.id, 8, 5_000)) return;
      const info = socketRooms.get(socket.id);
      if (!info) return;
      const room = roomManager.getRoom(info.roomCode);
      if (!room) return;
      const player = room.players.get(info.playerId);
      if (!player) return;

      // Non-team modes: force scope to 'all'
      const scope: 'all' | 'team' = room.roomType === 'team' && data.scope === 'team' ? 'team' : 'all';

      const msg = {
        id: Math.random().toString(36).substring(2, 10),
        playerId: info.playerId,
        nickname: player.nickname,
        content: content.slice(0, 200), // max 200 chars
        scope,
        timestamp: Date.now(),
      };

      room.addChatMessage(msg);

      if (scope === 'team') {
        // Only send to teammates
        const team = player.team;
        for (const [sockId, sockInfo] of socketRooms.entries()) {
          if (sockInfo.roomCode !== room.roomCode) continue;
          const p = room.players.get(sockInfo.playerId);
          if (p && p.team === team) {
            io.to(sockId).emit('chat_broadcast', msg);
          }
        }
      } else {
        // Broadcast to entire room
        io.to(room.roomCode).emit('chat_broadcast', msg);
      }
    }));

    // ---- LLM Config (per-socket, no room needed) ----
    const socketLLMConfigs = new Map<string, LLMConfig>();

    socket.on('set_llm_config', guarded('set_llm_config', async (data, ack) => {
      if (!data || typeof data !== 'object') return;
      const endpoint = str(data.endpoint, 300);
      const apiKey = str(data.apiKey, 300);
      const model = str(data.model, 100);
      if (!endpoint || !apiKey || !model) {
        if (typeof ack === 'function') ack({ success: false, error: 'endpoint / apiKey / model 不能为空' });
        return;
      }
      const endpointError = await validateLLMEndpoint(endpoint);
      if (endpointError) {
        if (typeof ack === 'function') ack({ success: false, error: endpointError });
        return;
      }
      socketLLMConfigs.set(socket.id, { endpoint, apiKey, model });
      if (typeof ack === 'function') ack({ success: true });
    }));

    socket.on('get_llm_config', guarded('get_llm_config', (ack) => {
      if (typeof ack === 'function') ack({ hasConfig: socketLLMConfigs.has(socket.id) });
    }));

    // ---- Leave Room (intentional) ----
    socket.on('leave_room', guarded('leave_room', () => {
      handleLeave(socket, true);
    }));

    // ---- Play Again ----
    socket.on('play_again', guarded('play_again', () => {
      const info = socketRooms.get(socket.id);
      if (!info) return;
      const room = roomManager.getRoom(info.roomCode);
      if (!room) return;
      if (room.hostId !== info.playerId) {
        socket.emit('error', { message: '只有房主可以开始新一局' });
        return;
      }

      room.resetForNewGame();
      io.to(room.roomCode).emit('player_list', {
        players: room.getPlayerInfos(),
        hostId: room.hostId,
      });

      console.log(`[room] Room ${room.roomCode} reset for new game`);
    }));

    // ---- Disconnect (accidental — grace period) ----
    socket.on('disconnect', () => {
      socketLLMConfigs.delete(socket.id); // clean up API key
      rateLimiter.clear(socket.id);
      console.log(`[socket] disconnected: ${socket.id}`);
      // If this socket provided the room's LLM key and the game hasn't started, drop it
      const leaveInfo = socketRooms.get(socket.id);
      if (leaveInfo) {
        const room = roomManager.getRoom(leaveInfo.roomCode);
        if (room && room.llmConfigFrom === socket.id && room.phase === 'waiting') {
          room.llmConfig = undefined;
          room.llmConfigFrom = undefined;
        }
      }
      handleLeave(socket, false);
    });

    // ================================================================
    // Helpers
    // ================================================================

    function handleLeave(s: typeof socket, intentional: boolean) {
      const info = socketRooms.get(s.id);
      if (!info) return;
      const room = roomManager.getRoom(info.roomCode);
      if (!room) return;

      s.leave(info.roomCode);
      socketRooms.delete(s.id);

      const player = room.players.get(info.playerId);
      const acctId = info.accountId;

      if (intentional) {
        // Save level for logged-in players (can restore on rejoin)
        if (acctId && player && room.phase === 'waiting') {
          room.previousLevels.set(acctId, player.level);
        }
        removePlayerFromRoom(room, info.playerId);
        return;
      }

      // Accidental disconnect during game → stay in room, auto-接管, with a rejoin deadline
      if (room.phase === 'playing') {
        // Host transfer: pass to next alive human
        if (info.playerId === room.hostId) {
          const nextHuman = room.getAlivePlayers().find(p => !p.isBot && p.id !== info.playerId);
          if (nextHuman) {
            room.hostId = nextHuman.id;
            console.log(`[room] host transferred to ${nextHuman.nickname}`);
          }
          // If no other human alive, host stays with disconnected player
        }

        // Grace timer: if the player never rejoins, remove them so the room can't leak
        const existing = room.disconnectedPlayers.get(info.playerId);
        if (existing) clearTimeout(existing);
        const playerId = info.playerId;
        const timer = setTimeout(() => {
          room.disconnectedPlayers.delete(playerId);
          const r = roomManager.getRoom(info.roomCode);
          if (r) {
            console.log(`[room] ${info.nickname} 重连超时，移出房间 ${info.roomCode}`);
            removePlayerFromRoom(r, playerId);
          }
        }, DISCONNECT_GRACE_MS);
        room.disconnectedPlayers.set(playerId, timer);

        io.to(info.roomCode).emit('player_list', {
          players: room.getPlayerInfos(),
          hostId: room.hostId,
        });
        console.log(`[room] ${info.nickname} disconnected during game — auto-接管`);
        return;
      }

      // Not playing → remove immediately
      removePlayerFromRoom(room, info.playerId);
    }

    function removePlayerFromRoom(room: GameRoom, playerId: string) {
      const isEmpty = room.removePlayer(playerId);
      // Clean up grace timer if any
      const t = room.disconnectedPlayers.get(playerId);
      if (t) { clearTimeout(t); room.disconnectedPlayers.delete(playerId); }

      // Clean up if room is empty or only bots remain
      if (isEmpty || !room.hasHumanPlayers()) {
        roomManager.scheduleCleanup(room.roomCode);
        broadcastRoomList();
        return;
      }

      io.to(room.roomCode).emit('player_list', {
        players: room.getPlayerInfos(),
        hostId: room.hostId,
      });
      broadcastRoomList();

      // If game in progress and only 1 player left, end game
      if (room.phase === 'playing' && room.getAlivePlayers().length <= 1) {
        gameEngine.endGame(room);
      }
    }
  });

  return io;
}
