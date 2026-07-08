import { useState } from 'react';
import { Socket } from 'socket.io-client';
import { ClientToServerEvents, ServerToClientEvents, RoomType } from '../../../shared/types';

interface Props {
  socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  onError: (msg: string) => void;
  onRoomCreated: (roomCode: string, playerId: string) => void;
}

export default function Lobby({ socket, onError, onRoomCreated }: Props) {
  const [nickname, setNickname] = useState(() =>
    localStorage.getItem('energy-duel-nickname') || ''
  );
  const [joinCode, setJoinCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [roomType, setRoomType] = useState<RoomType>('duo');

  const handleCreate = () => {
    if (!nickname.trim()) {
      onError('请输入昵称');
      return;
    }
    if (!socket.connected) {
      onError('未连接到服务器，请刷新页面');
      return;
    }
    setLoading(true);
    localStorage.setItem('energy-duel-nickname', nickname.trim());
    socket.emit('create_room', { nickname: nickname.trim(), roomType }, (res) => {
      setLoading(false);
      onRoomCreated(res.roomCode, res.playerId);
    });
  };

  const handleJoin = () => {
    if (!nickname.trim()) {
      onError('请输入昵称');
      return;
    }
    if (!joinCode.trim()) {
      onError('请输入房间号');
      return;
    }
    if (!socket.connected) {
      onError('未连接到服务器，请刷新页面');
      return;
    }
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
        onRoomCreated(joinCode.trim().toUpperCase(), res.playerId!);
      }
    });
  };

  return (
    <div className="lobby">
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
            onClick={() => setRoomType('duo')}
            disabled={loading}
          >
            ⚔ 双人对战
          </button>
          <button
            className={`toggle-btn ${roomType === 'multi' ? 'active' : ''}`}
            onClick={() => setRoomType('multi')}
            disabled={loading}
          >
            👥 多人混战
          </button>
        </div>

        <button
          className="btn btn-primary"
          onClick={handleCreate}
          disabled={loading}
        >
          {loading ? '创建中…' : '创建房间'}
        </button>

        <div className="lobby-divider">
          <span>或</span>
        </div>

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
      </div>
    </div>
  );
}
