import { PlayerInfo } from '../../../shared/types';

interface Props {
  players: PlayerInfo[];
  playerId: string;
}

function formatEnergy(n: number): string {
  if (n === 0) return '0';
  // Check for fractional patterns
  const EPSILON = 0.001;
  // 1/3 ≈ 0.333
  const remainder = n % 1;
  if (Math.abs(remainder) < EPSILON) return String(Math.round(n));
  if (Math.abs(remainder - 1/3) < EPSILON) return `${Math.floor(n)} ⅓`;
  if (Math.abs(remainder - 2/3) < EPSILON) return `${Math.floor(n)} ⅔`;
  if (Math.abs(remainder - 0.5) < EPSILON) return `${Math.floor(n)} ½`;
  return n.toFixed(1);
}

export default function PlayerStatusBar({ players, playerId }: Props) {
  return (
    <div className="player-status-bar">
      {players.map((p) => (
        <div
          key={p.id}
          className={`player-status ${p.id === playerId ? 'is-me' : ''} ${!p.alive ? 'is-dead' : ''}`}
        >
          <div className="ps-name">
            {p.nickname}
            {p.id === playerId && ' (你)'}
          </div>
          <div className="ps-info">
            <span className="ps-level">Lv.{p.level}</span>
            <span className="ps-hp">{p.alive ? '♥' : '✝'}</span>
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
      ))}
    </div>
  );
}
