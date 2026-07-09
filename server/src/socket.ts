import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { RoomManager } from './room/RoomManager';
import { GameEngine } from './game/GameEngine';
import { ClientToServerEvents, ServerToClientEvents } from '../../shared/types';

export function createSocketServer(httpServer: HTTPServer) {
  const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  const roomManager = new RoomManager();
  const gameEngine = new GameEngine(io);

  // Track which socket is in which room and which player
  const socketRooms = new Map<string, { roomCode: string; playerId: string }>();

  io.on('connection', (socket) => {
    console.log(`[socket] connected: ${socket.id}`);

    // ---- Room Creation ----
    socket.on('create_room', (data, ack) => {
      const room = roomManager.createRoom(data.roomType || 'duo', data.initialLevel || 1);
      const player = room.addPlayer(data.nickname);

      socket.join(room.roomCode);
      socketRooms.set(socket.id, { roomCode: room.roomCode, playerId: player.id });

      ack({ roomCode: room.roomCode, playerId: player.id });

      io.to(room.roomCode).emit('player_list', {
        players: room.getPlayerInfos(),
        hostId: room.hostId,
      });

      console.log(`[room] ${data.nickname} created ${room.roomType} room ${room.roomCode} (initial Lv.${room.initialLevel})`);
    });

    // ---- Join Room ----
    socket.on('join_room', (data, ack) => {
      const room = roomManager.getRoom(data.roomCode);
      if (!room) {
        ack({ success: false, error: '房间不存在' });
        return;
      }
      if (room.phase !== 'waiting') {
        ack({ success: false, error: '游戏已开始，无法加入' });
        return;
      }
      if (room.players.size >= room.maxPlayers) {
        ack({ success: false, error: `房间已满（最多 ${room.maxPlayers} 人）` });
        return;
      }
      // Check duplicate nickname
      const exists = room.getAllPlayers().some(p => p.nickname === data.nickname);
      if (exists) {
        ack({ success: false, error: '昵称已被使用' });
        return;
      }

      const player = room.addPlayer(data.nickname);
      socket.join(room.roomCode);
      socketRooms.set(socket.id, { roomCode: room.roomCode, playerId: player.id });

      ack({ success: true, playerId: player.id, roomType: room.roomType });

      io.to(room.roomCode).emit('player_list', {
        players: room.getPlayerInfos(),
        hostId: room.hostId,
      });

      console.log(`[room] ${data.nickname} joined room ${room.roomCode}`);
    });

    // ---- Start Game (host only) ----
    socket.on('start_game', () => {
      const info = socketRooms.get(socket.id);
      if (!info) return;
      const room = roomManager.getRoom(info.roomCode);
      if (!room) return;
      if (room.hostId !== info.playerId) {
        socket.emit('error', { message: '只有房主可以开始游戏' });
        return;
      }
      if (room.getAlivePlayers().length < 2) {
        socket.emit('error', { message: '至少需要 2 名玩家' });
        return;
      }

      gameEngine.startGame(room);
      console.log(`[game] Room ${room.roomCode} started with ${room.players.size} players`);
    });

    // ---- Add Bot (host only) ----
    socket.on('add_bot', (data) => {
      const info = socketRooms.get(socket.id);
      if (!info) return;
      const room = roomManager.getRoom(info.roomCode);
      if (!room) return;
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
      const levelLabel = data.level === 'easy' ? '简单人机' : '普通人机';
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

    // ---- Leave Room ----
    socket.on('leave_room', () => {
      handleLeave(socket);
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

    // ---- Disconnect ----
    socket.on('disconnect', () => {
      console.log(`[socket] disconnected: ${socket.id}`);
      handleLeave(socket);
      // Note: during game, we could add a grace period
      // For MVP, just remove immediately
    });

    function handleLeave(s: typeof socket) {
      const info = socketRooms.get(s.id);
      if (!info) return;
      const room = roomManager.getRoom(info.roomCode);
      if (!room) return;

      const isHost = room.hostId === info.playerId;
      const isEmpty = room.removePlayer(info.playerId);
      s.leave(info.roomCode);
      socketRooms.delete(s.id);

      if (isEmpty) {
        roomManager.scheduleCleanup(info.roomCode);
        return;
      }

      io.to(info.roomCode).emit('player_list', {
        players: room.getPlayerInfos(),
        hostId: room.hostId,
      });

      // If game is in progress and only 1 player left, end game
      if (room.phase === 'playing' && room.getAlivePlayers().length <= 1) {
        gameEngine.endGame(room);
      }
    }
  });

  return io;
}
