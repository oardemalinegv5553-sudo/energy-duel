import { PlayerInfo, RoundResolution } from '../../../shared/types';

interface Props {
  resolution: RoundResolution;
  players: PlayerInfo[];
}

export default function PhaseResolution({ resolution, players }: Props) {
  const getName = (id: string) => players.find(p => p.id === id)?.nickname || '?';
  const isTeamMode = players.some(p => p.team !== undefined);

  const revealCard = (p: PlayerInfo, m: any) => (
    <div key={p.id} className="reveal-card">
      <span className="reveal-player">{p.nickname}</span>
      <span className="reveal-move">{m.moveName}</span>
      {m.targets.length > 0 && (
        <span className="reveal-targets">
          → {m.targets.map((t: string) => getName(t)).join(', ')}
        </span>
      )}
    </div>
  );

  return (
    <div className="phase-resolution">
      {/* === 亮招 === */}
      <div className="section-label">亮招</div>
      {isTeamMode ? (
        <div className="reveal-team-grid">
          <div className="reveal-team-col">
            <div className="team-label-sm">🔴 红队</div>
            {players.filter(p => p.team === 0 && resolution.moves[p.id]).map(p => {
              const m = resolution.moves[p.id];
              return revealCard(p, m);
            })}
          </div>
          <div className="reveal-team-col">
            <div className="team-label-sm">🔵 蓝队</div>
            {players.filter(p => p.team === 1 && resolution.moves[p.id]).map(p => {
              const m = resolution.moves[p.id];
              return revealCard(p, m);
            })}
          </div>
        </div>
      ) : (
        <div className="reveal-grid">
          {players.filter(p => resolution.moves[p.id]).map(p => {
            const m = resolution.moves[p.id];
            return revealCard(p, m);
          })}
        </div>
      )}

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

      {/* === 队杀彩蛋 === */}
      {resolution.teamKillMessages && resolution.teamKillMessages.length > 0 && (
        <div className="result-section team-kill">
          <h4>🔥 队杀</h4>
          {resolution.teamKillMessages.map((msg, i) => (
            <div key={i} className="team-kill-line">{msg}</div>
          ))}
        </div>
      )}

      {/* === 公平混战：回合升级 === */}
      {resolution.fairLevelUps && resolution.fairLevelUps.length > 0 && (
        <div className="result-section fair-levelups">
          <h4>⬆ 本回合升级（击杀加权）</h4>
          {resolution.fairLevelUps.map((lu) => (
            <div key={lu.playerId} className="fair-lu-row">
              <span className="fair-lu-name">{lu.nickname}</span>
              <span className="fair-lu-kills">击杀 {lu.kills}人</span>
              <span className="fair-lu-change">
                Lv.{lu.oldLevel} → <strong>Lv.{lu.newLevel}</strong>
                <span className="fair-lu-delta">(+{lu.newLevel - lu.oldLevel})</span>
              </span>
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
