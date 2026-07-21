import { useState, useEffect } from 'react';
import { Socket } from 'socket.io-client';
import { ClientToServerEvents, ServerToClientEvents, RoomType, RoomSummary } from '../../../shared/types';
import RulesModal from './RulesModal';

interface Props {
  socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  onError: (msg: string) => void;
  onRoomCreated: (roomCode: string, playerId: string, roomType: RoomType) => void;
  isLoggedIn: boolean;
  username: string | null;
  onLogout: () => void;
  onGoToAuth: () => void;
  uiMode: 'normal' | 'compact';
  onToggleUiMode: () => void;
}

export default function Lobby({ socket, onError, onRoomCreated, isLoggedIn, username, onLogout, onGoToAuth, uiMode, onToggleUiMode }: Props) {
  const [nickname, setNickname] = useState(() =>
    // Auto-fill from account username if logged in
    username || localStorage.getItem('energy-duel-nickname') || ''
  );
  const [joinCode, setJoinCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [roomType, setRoomType] = useState<RoomType>('duo');
  const [team, setTeam] = useState<number>(0);
  const [initialLevel, setInitialLevel] = useState(1);
  const [showRules, setShowRules] = useState(false);
  const [showRoomBrowser, setShowRoomBrowser] = useState(false);
  const [roomList, setRoomList] = useState<RoomSummary[]>([]);

  // Fetch room list
  const fetchRooms = () => {
    socket.emit('list_rooms', (rooms) => {
      setRoomList(rooms);
    });
  };

  useEffect(() => {
    if (!socket.connected) return;
    // Listen for updates
    const onUpdate = (rooms: RoomSummary[]) => setRoomList(rooms);
    socket.on('room_list_update', onUpdate);
    // Initial fetch when browser opens
    if (showRoomBrowser) fetchRooms();
    return () => { socket.off('room_list_update', onUpdate); };
  }, [socket, showRoomBrowser]);

  // Save initialLevel per room type
  const [duoLevel, setDuoLevel] = useState(() =>
    Number(localStorage.getItem('energy-duel-duo-level')) || 1
  );
  const [multiLevel, setMultiLevel] = useState(() =>
    Number(localStorage.getItem('energy-duel-multi-level')) || 1
  );

  const handleRoomType = (type: RoomType) => {
    setRoomType(type);
    setInitialLevel(type === 'duo' ? duoLevel : multiLevel);
  };

  const handleLevelChange = (val: number) => {
    const clamped = Math.max(1, Math.min(17, val));
    setInitialLevel(clamped);
    if (roomType === 'duo') {
      setDuoLevel(clamped);
      localStorage.setItem('energy-duel-duo-level', String(clamped));
    } else {
      setMultiLevel(clamped);
      localStorage.setItem('energy-duel-multi-level', String(clamped));
    }
  };

  const handleCreate = () => {
    if (!nickname.trim()) { onError('请输入昵称'); return; }
    if (!socket.connected) { onError('未连接到服务器，请刷新页面'); return; }
    setLoading(true);
    localStorage.setItem('energy-duel-nickname', nickname.trim());
    socket.emit('create_room', {
      nickname: nickname.trim(),
      roomType,
      initialLevel,
    }, (res) => {
      setLoading(false);
      onRoomCreated(res.roomCode, res.playerId, roomType);
    });
  };

  const handleJoin = (code?: string) => {
    const targetCode = (code || joinCode).trim().toUpperCase();
    if (!nickname.trim()) { onError('请输入昵称'); return; }
    if (!targetCode) { onError('请输入房间号'); return; }
    if (!socket.connected) { onError('未连接到服务器，请刷新页面'); return; }
    setLoading(true);
    localStorage.setItem('energy-duel-nickname', nickname.trim());
    const teamData = roomType === 'team' ? { team } : {};
    socket.emit('join_room', {
      nickname: nickname.trim(),
      roomCode: targetCode,
      ...teamData,
    }, (res) => {
      setLoading(false);
      if (!res.success) {
        onError(res.error || '加入失败');
      } else {
        onRoomCreated(targetCode, res.playerId!, res.roomType || 'duo');
      }
    });
  };

  return (
    <div className="lobby">
      <RulesModal show={showRules} onClose={() => setShowRules(false)} />

      <h1 className="lobby-title">蓄气对决</h1>
      <p className="lobby-subtitle">在线拍手对战</p>

      <div className="ui-mode-toggle">
        <button
          className={`mode-btn ${uiMode === 'normal' ? 'active' : ''}`}
          onClick={() => uiMode === 'compact' && onToggleUiMode()}
        >
          📋 规则模式
        </button>
        <button
          className={`mode-btn ${uiMode === 'compact' ? 'active' : ''}`}
          onClick={() => uiMode === 'normal' && onToggleUiMode()}
        >
          📱 简洁模式
        </button>
      </div>

      {isLoggedIn && username && (
        <div className="auth-status">
          <span>👤 {username}</span>
          <button className="btn-ghost btn-xs" onClick={onLogout}>退出</button>
        </div>
      )}
      {!isLoggedIn && (
        <div className="auth-status guest">
          <span>🎭 游客模式</span>
          <button className="btn-ghost btn-xs" onClick={onGoToAuth}>登录/注册</button>
        </div>
      )}

      <div className="lobby-form">
        <label className="lobby-label">昵称</label>
        <input
          className="lobby-input"
          type="text"
          placeholder="输入你的昵称"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          maxLength={8}
          disabled={loading}
        />

        <label className="lobby-label">房间类型</label>
        <div className="room-type-toggle">
          <button
            className={`toggle-btn ${roomType === 'duo' ? 'active' : ''}`}
            onClick={() => handleRoomType('duo')}
            disabled={loading}
          >
            ⚔ 双人对战
          </button>
          <button
            className={`toggle-btn ${roomType === 'multi' ? 'active' : ''}`}
            onClick={() => handleRoomType('multi')}
            disabled={loading}
          >
            👥 多人混战
          </button>
          <button
            className={`toggle-btn ${roomType === 'team' ? 'active' : ''}`}
            onClick={() => handleRoomType('team')}
            disabled={loading}
          >
            🛡 组队对战
          </button>
          <button
            className={`toggle-btn ${roomType === 'fair' ? 'active' : ''}`}
            onClick={() => handleRoomType('fair')}
            disabled={loading}
          >
            ⚖ 公平混战
          </button>
        </div>

        {roomType === 'team' && (
          <div className="team-select">
            <label className="lobby-label">选择队伍</label>
            <div className="room-type-toggle">
              <button
                className={`toggle-btn ${team === 0 ? 'active team-red' : ''}`}
                onClick={() => setTeam(0)}
                disabled={loading}
              >
                🔴 红队
              </button>
              <button
                className={`toggle-btn ${team === 1 ? 'active team-blue' : ''}`}
                onClick={() => setTeam(1)}
                disabled={loading}
              >
                🔵 蓝队
              </button>
            </div>
          </div>
        )}

        <label className="lobby-label">
          初始等级：<strong>{initialLevel}</strong>
        </label>
        <input
          className="lobby-input"
          type="range"
          min="1" max="17"
          value={initialLevel}
          onChange={(e) => handleLevelChange(Number(e.target.value))}
          disabled={loading}
        />
        <div className="level-labels">
          <span>Lv.1 基础</span>
          <span>Lv.17 全招</span>
        </div>

        <button
          className="btn btn-primary"
          onClick={handleCreate}
          disabled={loading}
        >
          {loading ? '创建中…' : '创建房间'}
        </button>

        <div className="lobby-divider"><span>或</span></div>

        <label className="lobby-label">加入房间</label>
        <input
          className="lobby-input"
          type="text"
          placeholder="输入 4 位房间号"
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
          maxLength={4}
          disabled={loading}
        />
        <button
          className="btn btn-secondary"
          onClick={() => handleJoin()}
          disabled={loading}
        >
          {loading ? '加入中…' : '加入房间'}
        </button>

        {/* Room Browser */}
        <div className="room-browser">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => { setShowRoomBrowser(!showRoomBrowser); if (!showRoomBrowser) fetchRooms(); }}
            type="button"
          >
            {showRoomBrowser ? '▾ 隐藏' : '▸ 浏览'}开放房间 {roomList.length > 0 && `(${roomList.length})`}
          </button>
          {showRoomBrowser && (
            <div className="room-browser-list">
              {roomList.length === 0 ? (
                <p className="room-browser-empty">暂无开放房间，创建一个吧！</p>
              ) : (
                roomList.map((r) => (
                  <div
                    key={r.roomCode}
                    className={`room-browser-card ${(r.phase !== 'waiting' && r.gamePhase !== 'thinking') ? 'is-playing' : ''}`}
                  >
                    <div className="rb-left">
                      <span className="rb-code">{r.roomCode}</span>
                      <span className="rb-type">
                        {r.roomType === 'duo' ? '⚔ 双人' : r.roomType === 'team' ? '🛡 组队' : '👥 多人'}
                      </span>
                      <span className="rb-level">Lv.{r.initialLevel}</span>
                    </div>
                    <div className="rb-right">
                      <span className="rb-players">{r.playerCount}/{r.maxPlayers}人</span>
                      <span className={`rb-status ${(r.phase === 'waiting' || r.gamePhase === 'thinking') ? 'status-waiting' : 'status-playing'}`}>
                        {r.phase === 'waiting' ? '等待中' : r.gamePhase === 'thinking' ? '选招中' : r.gamePhase === 'result' ? '战斗中' : '已结束'}
                      </span>
                      {(r.phase === 'waiting' || r.gamePhase === 'thinking') ? (
                        <button
                          className="btn btn-xs rb-join"
                          onClick={() => handleJoin(r.roomCode)}
                          disabled={loading}
                        >
                          加入
                        </button>
                      ) : (
                        <span className="rb-locked">🔒</span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <button
          className="btn btn-ghost"
          onClick={() => setShowRules(true)}
          type="button"
        >
          查看规则
        </button>
      </div>
    </div>
  );
}
