import { PlayerInfo, RoundResolution } from '../../../shared/types';

interface Props {
  resolution: RoundResolution;
  players: PlayerInfo[];
}

export default function PhaseResult({ resolution, players }: Props) {
  const getName = (id: string) => players.find(p => p.id === id)?.nickname || '?';

  return (
    <div className="phase-result">
      <h3 className="result-title">结算</h3>

      {/* Attacks */}
      {resolution.attacks.length > 0 && (
        <div className="result-section">
          <h4>战斗</h4>
          {resolution.attacks.map((a, i) => (
            <div key={i} className={`result-line ${a.landing ? 'hit' : 'blocked'}`}>
              <span className="rl-attacker">{getName(a.attacker)}</span>
              {' → '}
              <span className="rl-target">{getName(a.target)}</span>
              <span className="rl-desc">：{a.description}</span>
            </div>
          ))}
        </div>
      )}

      {/* Deaths */}
      {resolution.deaths.length > 0 && (
        <div className="result-section deaths">
          <h4>💀 出局</h4>
          {resolution.deaths.map((pid) => (
            <div key={pid} className="death-line">
              <strong>{getName(pid)}</strong>
              {resolution.deathDetails[pid] && (
                <span> — {resolution.deathDetails[pid]}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Energy changes */}
      <div className="result-section">
        <h4>气数变化</h4>
        {Object.entries(resolution.energyChanges).map(([pid, delta]) => {
          const sign = delta >= 0 ? '+' : '';
          return (
            <div key={pid} className="result-line">
              <span>{getName(pid)}</span>：
              <span className={delta >= 0 ? 'energy-positive' : 'energy-negative'}>
                {sign}{delta.toFixed(1)} 气
              </span>
            </div>
          );
        })}
      </div>

      {/* No action */}
      {resolution.attacks.length === 0 && resolution.deaths.length === 0 && (
        <div className="result-peace">本回合无事发生</div>
      )}
    </div>
  );
}
