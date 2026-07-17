import { PlayerInfo } from '../../../shared/types';

interface Props {
  players: PlayerInfo[];
  playerId: string;
}

function formatEnergy(n: number): string {
  if (n === 0) return '0';
  const EPSILON = 0.001;
  const remainder = n % 1;
  if (Math.abs(remainder) < EPSILON) return String(Math.round(n));
  if (Math.abs(remainder - 1/3) < EPSILON) return `${Math.floor(n)} ⅓`;
  if (Math.abs(remainder - 2/3) < EPSILON) return `${Math.floor(n)} ⅔`;
  if (Math.abs(remainder - 0.5) < EPSILON) return `${Math.floor(n)} ½`;
  return n.toFixed(1);
}

function PlayerRow({ p, playerId }: { p: PlayerInfo; playerId: string }) {
  return (
    <div
      className={`player-status ${p.id === playerId ? 'is-me' : ''} ${!p.alive && !p.spectator ? 'is-dead' : ''} ${p.spectator ? 'is-spectator' : ''}`}
    >
      <div className="ps-name">
        {p.isBot && (p.botLevel === 'hard' ? '💀' : p.botLevel === 'easy' ? '🤖' : '🧠')} {p.nickname}
        {p.id === playerId && ' (你)'}
        {p.spectator && <span className="spectator-tag">👁 观战</span>}
      </div>
      <div className="ps-info">
        <span className="ps-level">Lv.{p.level}</span>
        <span className="ps-hp">{p.spectator ? '👁' : p.alive ? '♥' : '✝'}</span>
        <span className="ps-energy">气 {formatEnergy(p.energy)}</span>
      </div>
      {p.buffs.length > 0 && (
        <div className="ps-buffs">
          {p.buffs.map((b, i) => (
            <span key={i} className="buff-tag">
              {b.type === 'invincible' && `🛡霸体(${b.remainingRounds})`}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PlayerStatusBar({ players, playerId }: Props) {
  const isTeamMode = players.some(p => p.team !== undefined);

  if (!isTeamMode) {
    return (
      <div className="player-status-bar">
        {players.map((p) => (
          <PlayerRow key={p.id} p={p} playerId={playerId} />
        ))}
      </div>
    );
  }

  const red = players.filter(p => p.team === 0);
  const blue = players.filter(p => p.team === 1);

  return (
    <div className="player-status-bar team-mode">
      <div className="team-group team-red">
        <div className="team-label">🔴 红队</div>
        {red.map((p) => (
          <PlayerRow key={p.id} p={p} playerId={playerId} />
        ))}
      </div>
      <div className="team-group team-blue">
        <div className="team-label">🔵 蓝队</div>
        {blue.map((p) => (
          <PlayerRow key={p.id} p={p} playerId={playerId} />
        ))}
      </div>
    </div>
  );
}
