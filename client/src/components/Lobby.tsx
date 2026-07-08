import { useState } from 'react';
import { Socket } from 'socket.io-client';
import { ClientToServerEvents, ServerToClientEvents, RoomType } from '../../../shared/types';
import RulesModal from './RulesModal';

interface Props {
  socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  onError: (msg: string) => void;
  onRoomCreated: (roomCode: string, playerId: string, roomType: RoomType) => void;
}

export default function Lobby({ socket, onError, onRoomCreated }: Props) {
  const [nickname, setNickname] = useState(() =>
    localStorage.getItem('energy-duel-nickname') || ''
  );
  const [joinCode, setJoinCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [roomType, setRoomType] = useState<RoomType>('duo');
  const [initialLevel, setInitialLevel] = useState(1);
  const [showRules, setShowRules] = useState(false);

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
    const clamped = Math.max(1, Math.min(13, val));
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

  const handleJoin = () => {
    if (!nickname.trim()) { onError('请输入昵称'); return; }
    if (!joinCode.trim()) { onError('请输入房间号'); return; }
    if (!socket.connected) { onError('未连接到服务器，请刷新页面'); return; }
    setLoading(true);
    localStorage.setItem('energy-duel-nickname', nickname.trim());
    socket.emit('join_room', {
      nickname: nickname.trim(),
      roomCode: joinCode.trim().toUpperCase(),
    }, (res) => {
      setLoading(false);
      if (!res.success) {
        onError(res.error || '加入失败');
      } else {
        onRoomCreated(joinCode.trim().toUpperCase(), res.playerId!, res.roomType || 'duo');
      }
    });
  };

  return (
    <div className="lobby">
      <RulesModal show={showRules} onClose={() => setShowRules(false)} />

      <h1 className="lobby-title">蓄气对决</h1>
      <p className="lobby-subtitle">在线拍手对战</p>

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
        </div>

        <label className="lobby-label">
          初始等级：<strong>{initialLevel}</strong>
        </label>
        <input
          className="lobby-input"
          type="range"
          min="1" max="13"
          value={initialLevel}
          onChange={(e) => handleLevelChange(Number(e.target.value))}
          disabled={loading}
        />
        <div className="level-labels">
          <span>Lv.1 基础</span>
          <span>Lv.13 全招</span>
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
          onClick={handleJoin}
          disabled={loading}
        >
          {loading ? '加入中…' : '加入房间'}
        </button>

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
