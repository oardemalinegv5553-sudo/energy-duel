import { useState } from 'react';
import { Socket } from 'socket.io-client';
import { PlayerInfo, RoomType, BotLevel } from '../../../shared/types';
import { ClientToServerEvents, ServerToClientEvents } from '../../../shared/types';

interface Props {
  roomCode: string;
  players: PlayerInfo[];
  isHost: boolean;
  playerId: string;
  roomType: RoomType;
  socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  onLeave: () => void;
}

export default function WaitingRoom({ roomCode, players, isHost, playerId, roomType, socket, onLeave }: Props) {
  const maxPlayers = roomType === 'duo' ? 2 : 8;
  const isTeamMode = roomType === 'team';
  const [showBotMenu, setShowBotMenu] = useState(false);
  const hasHardBot = players.some(p => p.isBot && p.botLevel === 'hard');
  const canAddBot = isHost && players.length < maxPlayers;

  const handleStart = () => {
    socket.emit('start_game');
  };

  const addBot = (level: BotLevel) => {
    socket.emit('add_bot', { level });
    setShowBotMenu(false);
  };

  const removeBot = (botId: string) => {
    socket.emit('remove_bot', { botId });
  };

  return (
    <div className="waiting-room">
      <div className="room-header">
        <h2>房间号</h2>
        <div className="room-code-big">{roomCode}</div>
        <p className="room-hint">
          {roomType === 'duo' ? '双人对战' : roomType === 'team' ? '组队对战' : roomType === 'fair' ? '公平混战' : '多人混战'} · 发给朋友加入
        </p>
      </div>

      {isTeamMode ? (
        <>
          <div className="player-list team-red">
            <h3>🔴 红队 ({players.filter(p => p.team === 0).length})</h3>
            {players.filter(p => p.team === 0).map((p) => (
              <div key={p.id} className={`player-row ${p.id === playerId ? 'is-me' : ''}`}>
                <span className="player-name">
                  {p.nickname}{p.id === playerId && ' (你)'}
                </span>
                <span className="player-level">Lv.{p.level}</span>
                {(p.id === playerId || isHost) && (
                  <button className="btn-xs" onClick={() => socket.emit('switch_team', { playerId: p.id })}>⇄ 换队</button>
                )}
                {isHost && p.isBot && (
                  <button className="btn-xs" onClick={() => removeBot(p.id)}>✕</button>
                )}
              </div>
            ))}
          </div>
          <div className="player-list team-blue">
            <h3>🔵 蓝队 ({players.filter(p => p.team === 1).length})</h3>
            {players.filter(p => p.team === 1).map((p) => (
              <div key={p.id} className={`player-row ${p.id === playerId ? 'is-me' : ''}`}>
                <span className="player-name">
                  {p.nickname}{p.id === playerId && ' (你)'}
                </span>
                <span className="player-level">Lv.{p.level}</span>
                {(p.id === playerId || isHost) && (
                  <button className="btn-xs" onClick={() => socket.emit('switch_team', { playerId: p.id })}>⇄ 换队</button>
                )}
                {isHost && p.isBot && (
                  <button className="btn-xs" onClick={() => removeBot(p.id)}>✕</button>
                )}
              </div>
            ))}
          </div>
          <p className="room-hint">玩家 ({players.length}/{maxPlayers}) · 组队对战</p>
        </>
      ) : (
        <div className="player-list">
          <h3>玩家 ({players.length}/{maxPlayers})</h3>
          {players.map((p) => (
            <div key={p.id} className={`player-row ${p.id === playerId ? 'is-me' : ''}`}>
              <span className="player-name">
                {p.isBot && (p.botLevel === 'hard' ? '💀' : p.botLevel === 'easy' ? '🤖' : '🧠')} {p.nickname}
                {p.id === playerId && ' (你)'}
              </span>
              <span className="player-level">Lv.{p.level}</span>
              {isHost && p.isBot && (
                <button className="btn-xs" onClick={() => removeBot(p.id)}>✕</button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="waiting-actions">
        {canAddBot && (
          <div className="bot-controls">
            {showBotMenu ? (
              <div className="bot-menu">
                {isTeamMode ? (
                  <>
                    <button className="btn btn-sm" onClick={() => addBot('normal')}>
                      🧠 普通人机
                    </button>
                    {!hasHardBot && (
                      <button className="btn btn-sm" onClick={() => addBot('hard')}>
                        💀 困难人机
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <button className="btn btn-sm" onClick={() => addBot('easy')}>
                      🤖 简单人机
                    </button>
                    <button className="btn btn-sm" onClick={() => addBot('normal')}>
                      🧠 普通人机
                    </button>
                    {!hasHardBot && (
                      <button className="btn btn-sm" onClick={() => addBot('hard')}>
                        💀 困难人机
                      </button>
                    )}
                  </>
                )}
                <button className="btn btn-ghost btn-sm" onClick={() => setShowBotMenu(false)}>
                  取消
                </button>
              </div>
            ) : (
              <button className="btn btn-secondary" onClick={() => setShowBotMenu(true)}>
                + 添加人机
              </button>
            )}
          </div>
        )}

        {isHost ? (
          <button
            className="btn btn-primary"
            onClick={handleStart}
            disabled={players.length < 2}
          >
            {players.length < 2 ? '至少需要 2 名玩家' : '开始游戏'}
          </button>
        ) : (
          <p className="waiting-text">等待房主开始游戏…</p>
        )}
        <button className="btn btn-ghost" onClick={onLeave}>
          离开房间
        </button>
      </div>
    </div>
  );
}
