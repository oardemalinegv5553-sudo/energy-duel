import { useState, useEffect, useRef } from 'react';
import { GamePhase, GameState, PlayerInfo, RoundResolution, Ranking, LevelUp, RoomType } from '../../shared/types';
import { socket, connectSocket } from './socket';
import { getAuth, clearAuth, saveRoomState, getSavedRoom, clearRoomState } from './auth';
import AuthPanel from './components/AuthPanel';
import Lobby from './components/Lobby';
import WaitingRoom from './components/WaitingRoom';
import GameScreen from './components/GameScreen';
import GameOver from './components/GameOver';

type View = 'auth' | 'lobby' | 'waiting' | 'playing' | 'finished';

export default function App() {
  const [view, setView] = useState<View>(() => {
    // If we have a saved token, start at lobby (server will validate via auth_info)
    const saved = getAuth();
    return saved ? 'lobby' : 'auth';
  });
  const [roomCode, setRoomCode] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [hostId, setHostId] = useState('');
  const [roomType, setRoomType] = useState<RoomType>('duo');
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [round, setRound] = useState(0);
  const [phase, setPhase] = useState<GamePhase>('waiting');
  const [resolution, setResolution] = useState<RoundResolution | null>(null);
  const [deadline, setDeadline] = useState<number>(0);
  const [gameOverData, setGameOverData] = useState<{
    rankings: Ranking[];
    levelUps: LevelUp[];
    players: PlayerInfo[];
  } | null>(null);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);

  // Auth state
  const [authAccountId, setAuthAccountId] = useState<string | null>(
    () => getAuth()?.accountId || null
  );
  const [authUsername, setAuthUsername] = useState<string | null>(
    () => getAuth()?.username || null
  );

  const setupDone = useRef(false);

  // ---- Socket connection + event handlers ----
  useEffect(() => {
    if (setupDone.current) return;
    setupDone.current = true;

    connectSocket();

    socket.on('connect', () => {
      console.log('[socket] connected:', socket.id);
      setConnected(true);

      // Try to rejoin room after refresh
      const saved = getSavedRoom();
      if (saved && !roomCode) {
        socket.emit('rejoin_room', { roomCode: saved.roomCode, playerId: saved.playerId }, (res) => {
          if (res.success) {
            console.log('[rejoin] restored to room', saved.roomCode);
            setRoomCode(saved.roomCode);
            setPlayerId(res.playerId!);
            setRoomType(res.roomType || 'duo');
            setView('waiting');
          } else {
            console.log('[rejoin] failed:', res.error);
            clearRoomState();
          }
        });
      }
    });

    socket.on('disconnect', () => {
      console.log('[socket] disconnected');
      setConnected(false);
    });

    socket.on('auth_info', (data) => {
      if (data.accountId) {
        // Server confirmed our token is valid
        setAuthAccountId(data.accountId);
      } else {
        // Token invalid or expired — clear auth state
        clearAuth();
        setAuthAccountId(null);
        setAuthUsername(null);
        if (view !== 'auth') setView('auth');
      }
    });

    socket.on('room_created', (data) => {
      console.log('[socket] room_created:', data);
      setRoomCode(data.roomCode);
      setPlayerId(data.playerId);
      saveRoomState({ roomCode: data.roomCode, playerId: data.playerId, roomType: roomType || 'duo' });
      setView('waiting');
    });

    socket.on('player_list', (data) => {
      setPlayers(data.players);
      setHostId(data.hostId);
      // If returning from game over (play again), go back to waiting
      setView(prev => prev === 'finished' ? 'waiting' : prev);
    });

    socket.on('game_started', (data) => {
      setGameState(data.state);
      setRound(data.state.round);
      setPhase(data.state.phase);
      setPlayers(data.state.players);
      setDeadline(data.state.deadline || 0);
      setView('playing');
    });

    socket.on('phase_change', (data) => {
      setPhase(data.phase);
      if (data.state) {
        setGameState(data.state);
        setRound(data.state.round);
        setPlayers(data.state.players);
        setDeadline(data.state.deadline || 0);
      }
      if (data.resolution) {
        setResolution(data.resolution);
      }
      // If game is active, switch to playing view (handles rejoin during game)
      if (data.phase === 'thinking' || data.phase === 'result') {
        setView('playing');
      }
    });

    socket.on('game_over', (data) => {
      setGameOverData(data);
      setView('finished');
    });

    socket.on('error', (data) => {
      setError(data.message);
      setTimeout(() => setError(''), 3000);
    });

    socket.on('room_closed', () => {
      clearRoomState();
      setView('lobby');
      setError('房间已关闭');
    });

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('auth_info');
      socket.off('room_created');
      socket.off('player_list');
      socket.off('game_started');
      socket.off('phase_change');
      socket.off('game_over');
      socket.off('error');
      socket.off('room_closed');
    };
  }, []);

  // ---- Auth handlers ----

  const handleAuthSuccess = (accountId: string, username: string) => {
    setAuthAccountId(accountId);
    setAuthUsername(username);
    setView('lobby');
  };

  const handleGuest = () => {
    setAuthAccountId(null);
    setAuthUsername(null);
    setView('lobby');
  };

  const handleLogout = () => {
    clearAuth();
    setAuthAccountId(null);
    setAuthUsername(null);
    setView('auth');
  };

  const handleGoToAuth = () => {
    setView('auth');
  };

  // ----

  const handleLeave = () => {
    socket.emit('leave_room');
    clearRoomState();
    setView('lobby');
    setRoomCode('');
    setPlayerId('');
    setPlayers([]);
    setGameState(null);
    setResolution(null);
    setGameOverData(null);
  };

  const isHost = playerId === hostId;

  return (
    <div className="app">
      {!connected && <div className="error-toast">连接服务器中…</div>}
      {error && <div className="error-toast">{error}</div>}

      {view === 'auth' && (
        <AuthPanel
          onAuthSuccess={handleAuthSuccess}
          onGuest={handleGuest}
        />
      )}

      {view === 'lobby' && (
        <Lobby
          socket={socket}
          onError={setError}
          onRoomCreated={(code, pid, rtype) => {
            setRoomCode(code);
            setPlayerId(pid);
            setRoomType(rtype);
            saveRoomState({ roomCode: code, playerId: pid, roomType: rtype });
            setView('waiting');
          }}
          isLoggedIn={!!authAccountId}
          username={authUsername}
          onLogout={handleLogout}
          onGoToAuth={handleGoToAuth}
        />
      )}

      {view === 'waiting' && (
        <WaitingRoom
          roomCode={roomCode}
          players={players}
          isHost={isHost}
          playerId={playerId}
          roomType={roomType}
          socket={socket}
          onLeave={handleLeave}
        />
      )}

      {view === 'playing' && gameState && (
        <GameScreen
          phase={phase}
          round={round}
          players={players}
          playerId={playerId}
          deadline={deadline}
          resolution={resolution}
          roomCode={roomCode}
          socket={socket}
        />
      )}

      {view === 'finished' && gameOverData && (
        <GameOver
          rankings={gameOverData.rankings}
          levelUps={gameOverData.levelUps}
          players={gameOverData.players}
          isHost={isHost}
          playerId={playerId}
          socket={socket}
          onLeave={handleLeave}
        />
      )}
    </div>
  );
}
