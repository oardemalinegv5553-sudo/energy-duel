import { PlayerInfo, RoundResolution } from '../../../shared/types';

interface Props {
  resolution: RoundResolution;
  players: PlayerInfo[];
}

export default function PhaseReveal({ resolution, players }: Props) {
  const getName = (id: string) => players.find(p => p.id === id)?.nickname || '?';

  return (
    <div className="phase-reveal">
      <h3 className="reveal-title">⚔ 亮招 ⚔</h3>

      <div className="reveal-grid">
        {Object.entries(resolution.moves).map(([pid, m]) => (
          <div key={pid} className="reveal-card">
            <span className="reveal-player">{getName(pid)}</span>
            <span className="reveal-move">{m.moveName}</span>
            {m.targets.length > 0 && (
              <span className="reveal-targets">
                → {m.targets.map(t => getName(t)).join(', ')}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* 欧 chain display */}
      {resolution.ouChain.length > 0 && (
        <div className="reveal-chain">
          <h4>🔗 欧窃取链</h4>
          {resolution.ouChain.map((c, i) => (
            <div key={i} className="chain-line">
              {getName(c.stealer)} 窃取 {getName(c.target)} → +{c.amount} 气
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
