import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { RoomManager } from './room/RoomManager';
import { GameEngine } from './game/GameEngine';
import { GameRoom } from './room/GameRoom';
import { ClientToServerEvents, ServerToClientEvents } from '../../shared/types';
import { AuthManager } from './auth/AuthManager';

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

  // Track which socket is in which room and which player
  const socketRooms = new Map<string, { roomCode: string; playerId: string; accountId?: string; nickname: string }>();

  io.on('connection', (socket) => {
    const accountId: string | undefined = (socket as any).accountId;
    console.log(`[socket] connected: ${socket.id}${accountId ? ` [auth:${accountId}]` : ' [guest]'}`);

    // Send auth status to client
    socket.emit('auth_info', { accountId: accountId || null });

    // ---- Room Creation ----
    socket.on('create_room', (data, ack) => {
      const room = roomManager.createRoom(data.roomType || 'duo', data.initialLevel || 1);
      const playerTeam = data.roomType === 'team' ? 0 : undefined;
      const player = room.addPlayer(data.nickname, playerTeam);

      socket.join(room.roomCode);
      socketRooms.set(socket.id, {
        roomCode: room.roomCode, playerId: player.id,
        accountId: (socket as any).accountId, nickname: data.nickname,
      });

      ack({ roomCode: room.roomCode, playerId: player.id });

      io.to(room.roomCode).emit('player_list', {
        players: room.getPlayerInfos(),
        hostId: room.hostId,
      });

      console.log(`[room] ${data.nickname}${(socket as any).accountId ? ` [${(socket as any).accountId}]` : ''} created ${room.roomType} room ${room.roomCode} (initial Lv.${room.initialLevel})`);
    });

    // ---- Join Room ----
    socket.on('join_room', (data, ack) => {
      const room = roomManager.getRoom(data.roomCode);
      if (!room) {
        ack({ success: false, error: '房间不存在' });
        return;
      }
      if (room.phase !== 'waiting') {
        // Allow previous members to rejoin anytime
        const acctId = (socket as any).accountId;
        const wasMember = acctId && room.previousLevels.has(acctId);
        if (!wasMember) {
          ack({ success: false, error: '游戏已开始，无法加入' });
          return;
        }
      }
      if (room.players.size >= room.maxPlayers) {
        ack({ success: false, error: `房间已满（最多 ${room.maxPlayers} 人）` });
        return;
      }
      // Team mode: auto-assign to smaller team if not specified
      let joinTeam: number | undefined;
      if (room.roomType === 'team') {
        if (data.team !== undefined) {
          joinTeam = data.team;
        } else {
          const red = room.getAllPlayers().filter(p => p.team === 0).length;
          const blue = room.getAllPlayers().filter(p => p.team === 1).length;
          joinTeam = red <= blue ? 0 : 1;
        }
      }
      // Check duplicate nickname
      const exists = room.getAllPlayers().some(p => p.nickname === data.nickname);
      if (exists) {
        ack({ success: false, error: '昵称已被使用' });
        return;
      }

      const player = room.addPlayer(data.nickname, joinTeam);

      // Restore previous level for logged-in players rejoining same room
      const acctId: string | undefined = (socket as any).accountId;
      if (acctId && room.previousLevels.has(acctId)) {
        player.level = room.previousLevels.get(acctId)!;
        room.previousLevels.delete(acctId);
      }

      socket.join(room.roomCode);
      socketRooms.set(socket.id, {
        roomCode: room.roomCode, playerId: player.id,
        accountId: acctId, nickname: data.nickname,
      });

      ack({ success: true, playerId: player.id, roomType: room.roomType });

      io.to(room.roomCode).emit('player_list', {
        players: room.getPlayerInfos(),
        hostId: room.hostId,
      });

      console.log(`[room] ${data.nickname} joined room ${room.roomCode}`);
    });

    // ---- Rejoin Room (after refresh/disconnect) ----
    socket.on('rejoin_room', (data, ack) => {
      const { roomCode, playerId } = data;
      const room = roomManager.getRoom(roomCode);
      if (!room) {
        ack({ success: false, error: '房间不存在' });
        return;
      }

      // Check if player is still in the room (game disconnect) or in grace period
      const playerExists = room.players.has(playerId);
      const timer = room.disconnectedPlayers.get(playerId);
      if (!playerExists && !timer) {
        ack({ success: false, error: '已退出房间，请重新加入' });
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

      ack({ success: true, playerId, roomType: room.roomType });

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
    });

    // ---- Start Game (host only) ----
    socket.on('start_game', () => {
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
      console.log(`[game] Room ${room.roomCode} started with ${room.players.size} players`);
    });

    // ---- Switch Team (team mode only, before game starts) ----
    socket.on('switch_team', () => {
      const info = socketRooms.get(socket.id);
      if (!info) return;
      const room = roomManager.getRoom(info.roomCode);
      if (!room || room.roomType !== 'team') return;
      if (room.phase !== 'waiting') return;
      const player = room.players.get(info.playerId);
      if (!player || player.isBot) return;

      player.team = player.team === 0 ? 1 : 0;

      io.to(room.roomCode).emit('player_list', {
        players: room.getPlayerInfos(),
        hostId: room.hostId,
      });
    });

    // ---- Add Bot (host only) ----
    socket.on('add_bot', (data) => {
      const info = socketRooms.get(socket.id);
      if (!info) return;
      const room = roomManager.getRoom(info.roomCode);
      if (!room) return;
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
      const levelLabel = data.level === 'easy' ? '简单人机' : data.level === 'hard' ? '困难人机' : '普通人机';
      const sameLevel = room.getAllPlayers().filter(p => p.isBot && p.botLevel === data.level).length;
      const bot = room.addBot(`${levelLabel}${sameLevel + 1}`, data.level);
      socket.join(room.roomCode);
      console.log(`[room] Bot ${bot.nickname} (${data.level}) added to ${room.roomCode}`);

      io.to(room.roomCode).emit('player_list', {
        players: room.getPlayerInfos(),
        hostId: room.hostId,
      });
    });

    // ---- Remove Bot (host only) ----
    socket.on('remove_bot', (data) => {
      const info = socketRooms.get(socket.id);
      if (!info) return;
      const room = roomManager.getRoom(info.roomCode);
      if (!room) return;
      if (room.hostId !== info.playerId) return;
      if (room.phase !== 'waiting') return;
      const bot = room.players.get(data.botId);
      if (!bot || !bot.isBot) return;
      room.players.delete(data.botId);
      io.to(room.roomCode).emit('player_list', {
        players: room.getPlayerInfos(),
        hostId: room.hostId,
      });
    });

    // ---- Submit Move ----
    socket.on('submit_move', (data) => {
      const info = socketRooms.get(socket.id);
      if (!info) return;
      const room = roomManager.getRoom(info.roomCode);
      if (!room) return;

      const ok = gameEngine.submitMove(room, info.playerId, data.moveId, data.targets);
      if (!ok) {
        socket.emit('error', { message: '出招无效（气不足/等级不够/已出招/目标无效）' });
      }
    });

    // ---- Leave Room (intentional) ----
    socket.on('leave_room', () => {
      handleLeave(socket, true);
    });

    // ---- Play Again ----
    socket.on('play_again', () => {
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
    });

    // ---- Disconnect (accidental — grace period) ----
    socket.on('disconnect', () => {
      console.log(`[socket] disconnected: ${socket.id}`);
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

      // Accidental disconnect during game → stay in room, auto-接管
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

        // Clear any previous grace timer, but DON'T set a new one
        const existing = room.disconnectedPlayers.get(info.playerId);
        if (existing) clearTimeout(existing);
        room.disconnectedPlayers.delete(info.playerId);

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

      if (isEmpty) {
        roomManager.scheduleCleanup(room.roomCode);
        return;
      }

      io.to(room.roomCode).emit('player_list', {
        players: room.getPlayerInfos(),
        hostId: room.hostId,
      });

      // If game in progress and only 1 player left, end game
      if (room.phase === 'playing' && room.getAlivePlayers().length <= 1) {
        gameEngine.endGame(room);
      }
    }
  });

  return io;
}
