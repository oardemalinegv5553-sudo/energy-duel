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
  onPlayAgain: () => void;
  fairLevelUps?: { playerId: string; nickname: string; oldLevel: number; newLevel: number; kills: number }[];
  fairStats?: Record<string, { m: number; kills: number }>;
}

function rankEmoji(rank: number): string {
  switch (rank) {
    case 1: return '🥇';
    case 2: return '🥈';
    case 3: return '🥉';
    default: return `#${rank}`;
  }
}

export default function GameOver({ rankings, levelUps, players, isHost, playerId, socket, onLeave, onPlayAgain, fairLevelUps, fairStats }: Props) {
  const getName = (id: string) => players.find(p => p.id === id)?.nickname || '?';

  const handlePlayAgain = () => {
    socket.emit('play_again');
    onPlayAgain();
  };

  return (
    <div className="game-over">
      <h2 className="go-title">游戏结束</h2>

      <div className="go-rankings">
        <h3>排名</h3>
        {rankings.map((r) => {
          const stat = fairStats?.[r.playerId];
          return (
            <div
              key={r.playerId}
              className={`go-rank-row ${r.playerId === playerId ? 'is-me' : ''} ${r.rank === 1 ? 'rank-gold' : r.rank === 2 ? 'rank-silver' : r.rank === 3 ? 'rank-bronze' : ''}`}
            >
              <span className="go-rank-icon">{rankEmoji(r.rank)}</span>
              <span className="go-rank-name">
                {r.nickname}
                {r.playerId === playerId && ' (你)'}
              </span>
              {stat && (
                <span className="go-rank-kills">
                  {stat.kills > 0 ? (
                    <>⚔ {stat.kills}杀 <span className="go-rank-m">m={stat.m.toFixed(1)}</span></>
                  ) : (
                    <span className="go-rank-zero">无击杀</span>
                  )}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {levelUps.length > 0 && (
        <div className="go-levelups">
          <h3>⬆ 升级{!!fairLevelUps && '（击杀加权）'}</h3>
          {levelUps.map((lu) => {
            const fair = fairLevelUps?.find(f => f.playerId === lu.playerId);
            return (
              <div key={lu.playerId} className="go-lu-row">
                <span>{lu.nickname}</span>
                {fair && (
                  <span className="fair-lu-kills-inline">击杀 {fair.kills}人</span>
                )}
                <span className="lu-change">
                  Lv.{lu.oldLevel} → <strong>Lv.{lu.newLevel}</strong>
                </span>
              </div>
            );
          })}
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
