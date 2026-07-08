import { Socket } from 'socket.io-client';
import { PlayerInfo, Ranking, LevelUp, ClientToServerEvents, ServerToClientEvents } from '../../../shared/types';

interface Props {
  rankings: Ranking[];
  levelUps: LevelUp[];
  players: PlayerInfo[];
  isHost: boolean;
  playerId: string;
  socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  onLeave: () => void;
}

function rankEmoji(rank: number): string {
  switch (rank) {
    case 1: return '🥇';
    case 2: return '🥈';
    case 3: return '🥉';
    default: return `#${rank}`;
  }
}

export default function GameOver({ rankings, levelUps, players, isHost, playerId, socket, onLeave }: Props) {
  const getName = (id: string) => players.find(p => p.id === id)?.nickname || '?';

  const handlePlayAgain = () => {
    socket.emit('play_again');
  };

  return (
    <div className="game-over">
      <h2 className="go-title">游戏结束</h2>

      <div className="go-rankings">
        <h3>排名</h3>
        {rankings.map((r) => (
          <div
            key={r.playerId}
            className={`go-rank-row ${r.playerId === playerId ? 'is-me' : ''}`}
          >
            <span className="go-rank-icon">{rankEmoji(r.rank)}</span>
            <span className="go-rank-name">
              {r.nickname}
              {r.playerId === playerId && ' (你)'}
            </span>
          </div>
        ))}
      </div>

      {levelUps.length > 0 && (
        <div className="go-levelups">
          <h3>⬆ 升级</h3>
          {levelUps.map((lu) => (
            <div key={lu.playerId} className="go-lu-row">
              <span>{lu.nickname}</span>
              <span className="lu-change">
                Lv.{lu.oldLevel} → <strong>Lv.{lu.newLevel}</strong>
              </span>
            </div>
          ))}
        </div>
      )}

      {levelUps.length === 0 && (
        <p className="go-no-lu">本局无人升级</p>
      )}

      <div className="go-actions">
        {isHost && (
          <button className="btn btn-primary" onClick={handlePlayAgain}>
            再来一局
          </button>
        )}
        {!isHost && <p className="waiting-text">等待房主开始新一局…</p>}
        <button className="btn btn-ghost" onClick={onLeave}>
          离开房间
        </button>
      </div>
    </div>
  );
}
