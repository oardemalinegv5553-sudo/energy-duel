import { PlayerInfo, RoundResolution } from '../../../shared/types';

interface Props {
  resolution: RoundResolution;
  players: PlayerInfo[];
}

export default function PhaseResolution({ resolution, players }: Props) {
  const getName = (id: string) => players.find(p => p.id === id)?.nickname || '?';

  return (
    <div className="phase-resolution">
      {/* === 亮招 === */}
      <div className="section-label">亮招</div>
      <div className="reveal-grid">
        {players.filter(p => resolution.moves[p.id]).map(p => {
          const m = resolution.moves[p.id];
          return (
            <div key={p.id} className="reveal-card">
              <span className="reveal-player">{p.nickname}</span>
              <span className="reveal-move">{m.moveName}</span>
              {m.targets.length > 0 && (
                <span className="reveal-targets">
                  → {m.targets.map(t => getName(t)).join(', ')}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* 欧链 */}
      {resolution.ouChain.length > 0 && (
        <div className="result-section">
          <h4>🔗 窃取链</h4>
          {resolution.ouChain.map((c, i) => (
            <div key={i} className="chain-line">
              {getName(c.stealer)} 窃取 {getName(c.target)} → +{c.amount} 气
            </div>
          ))}
        </div>
      )}

      {/* === 战斗 === */}
      {resolution.attacks.length > 0 && (
        <div className="result-section">
          <h4>战斗</h4>
          {resolution.attacks.map((a, i) => (
            <div key={i} className={`result-line ${a.landing ? 'hit' : 'blocked'}`}>
              {getName(a.attacker)} → {getName(a.target)}：{a.description}
            </div>
          ))}
        </div>
      )}

      {/* === 出局 === */}
      {resolution.deaths.length > 0 && (
        <div className="result-section deaths">
          <h4>💀 出局</h4>
          {resolution.deaths.map((pid) => (
            <div key={pid} className="death-line">
              {getName(pid)} — {resolution.deathDetails[pid] || '死亡'}
            </div>
          ))}
        </div>
      )}

      {/* === 气数变化 === */}
      <div className="result-section">
        <h4>气数</h4>
        {Object.entries(resolution.energyChanges).map(([pid, delta]) => {
          const sign = delta >= 0 ? '+' : '';
          return (
            <span key={pid} className="energy-chip">
              {getName(pid)} {sign}{delta.toFixed(1)}
            </span>
          );
        })}
      </div>

      {resolution.attacks.length === 0 && resolution.deaths.length === 0 && (
        <div className="result-peace">无事发生</div>
      )}
    </div>
  );
}
