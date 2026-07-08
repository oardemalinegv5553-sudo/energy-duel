import { useState, useEffect } from 'react';
import { Socket } from 'socket.io-client';
import { PlayerInfo, ClientToServerEvents, ServerToClientEvents } from '../../../shared/types';
import { getMovesForLevel, ClientMoveDef } from '../moves';

interface Props {
  players: PlayerInfo[];
  playerId: string;
  level: number;
  energy: number;
  socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  deadline: number;
}

function formatCost(c: number): string {
  if (c === 0) return '0';
  if (c === 1/3) return '⅓';
  if (c === 0.5) return '½';
  return String(c);
}

export default function MoveSelector({ players, playerId, level, energy, socket, deadline }: Props) {
  const [selectedMove, setSelectedMove] = useState<ClientMoveDef | null>(null);
  const [targets, setTargets] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [timeLeft, setTimeLeft] = useState(30);

  const allLevels = players.map(p => p.level);
  const availableMoves = getMovesForLevel(level, allLevels);
  const alivePlayers = players.filter(p => p.alive && p.id !== playerId);

  // Timer
  useEffect(() => {
    if (!deadline || submitted) return;
    const interval = setInterval(() => {
      const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      setTimeLeft(left);
    }, 200);
    return () => clearInterval(interval);
  }, [deadline, submitted]);

  const canAfford = (move: ClientMoveDef) => energy >= move.cost;

  const isDuo = alivePlayers.length === 1;

  const handleSelectMove = (move: ClientMoveDef) => {
    if (submitted) return;
    if (!canAfford(move)) return;

    if (move.targetType === 'all') {
      setSelectedMove(move);
      setTargets(alivePlayers.map(p => p.id));
    } else if (move.targetType === 'single' && isDuo) {
      // Duo mode: auto-select the only opponent
      setSelectedMove(move);
      setTargets([alivePlayers[0].id]);
    } else if (move.targetType === 'none') {
      setSelectedMove(move);
      setTargets([]);
    } else {
      setSelectedMove(move);
      setTargets([]);
    }
  };

  const handleToggleTarget = (targetId: string) => {
    if (!selectedMove || submitted) return;

    if (selectedMove.targetType === 'single') {
      setTargets([targetId]);
    } else if (selectedMove.targetType === 'dual') {
      if (targets.includes(targetId)) {
        setTargets(targets.filter(t => t !== targetId));
      } else if (targets.length < 2) {
        setTargets([...targets, targetId]);
      }
    }
  };

  const handleSubmit = () => {
    if (!selectedMove || submitted) return;
    if (selectedMove.targetType === 'single' && targets.length !== 1) return;
    if (selectedMove.targetType === 'dual' && targets.length !== 2) return;

    socket.emit('submit_move', {
      moveId: selectedMove.id,
      targets,
    });
    setSubmitted(true);
  };

  const canSubmit = selectedMove && (
    selectedMove.targetType === 'none' ||
    selectedMove.targetType === 'all' ||
    (selectedMove.targetType === 'single' && targets.length === 1) ||
    (selectedMove.targetType === 'dual' && targets.length >= 1)
  );

  // Categorize moves
  const chargeMoves = availableMoves.filter(m => m.type === 'charge');
  const attackMoves = availableMoves.filter(m => m.type === 'attack');
  const defenseMoves = availableMoves.filter(m => m.type === 'defense');
  const specialMoves = availableMoves.filter(m => ['special', 'special_defense'].includes(m.type));

  if (submitted) {
    return (
      <div className="move-selector">
        <div className="submitted-notice">
          <p>已出招：<strong>{selectedMove?.name}</strong></p>
          <p className="sub-waiting">等待其他玩家…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="move-selector">
      <div className="move-timer">
        <div className="timer-bar">
          <div
            className="timer-fill"
            style={{ width: `${(timeLeft / 30) * 100}%` }}
          />
        </div>
        <span className="timer-text">{timeLeft}s</span>
      </div>

      <div className="move-grid">
        <div className="move-category">
          <h4>⚡ 蓄气</h4>
          <div className="move-row">
            {chargeMoves.map(m => (
              <button
                key={m.id}
                className={`move-card ${selectedMove?.id === m.id ? 'selected' : ''} ${!canAfford(m) ? 'disabled' : ''}`}
                onClick={() => handleSelectMove(m)}
                disabled={!canAfford(m)}
              >
                <span className="move-name">{m.name}</span>
                <span className="move-cost">气 {formatCost(m.cost)}</span>
                <span className="move-desc">{m.description}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="move-category">
          <h4>🗡 攻击</h4>
          <div className="move-row">
            {attackMoves.map(m => (
              <button
                key={m.id}
                className={`move-card atk ${selectedMove?.id === m.id ? 'selected' : ''} ${!canAfford(m) ? 'disabled' : ''}`}
                onClick={() => handleSelectMove(m)}
                disabled={!canAfford(m)}
              >
                <span className="move-name">{m.name}</span>
                <span className="move-cost">气 {formatCost(m.cost)}</span>
                <span className="move-stat">攻 {m.atk}</span>
                <span className="move-desc">{m.description}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="move-category">
          <h4>🛡 防御</h4>
          <div className="move-row">
            {defenseMoves.map(m => (
              <button
                key={m.id}
                className={`move-card def ${selectedMove?.id === m.id ? 'selected' : ''} ${!canAfford(m) ? 'disabled' : ''}`}
                onClick={() => handleSelectMove(m)}
                disabled={!canAfford(m)}
              >
                <span className="move-name">{m.name}</span>
                <span className="move-cost">气 {formatCost(m.cost)}</span>
                <span className="move-stat">防 {m.def}</span>
                <span className="move-desc">{m.description}</span>
              </button>
            ))}
          </div>
        </div>

        {specialMoves.length > 0 && (
          <div className="move-category">
            <h4>✨ 特殊</h4>
            <div className="move-row">
              {specialMoves.map(m => (
                <button
                  key={m.id}
                  className={`move-card sp ${selectedMove?.id === m.id ? 'selected' : ''} ${!canAfford(m) ? 'disabled' : ''}`}
                  onClick={() => handleSelectMove(m)}
                  disabled={!canAfford(m)}
                >
                  <span className="move-name">{m.name}</span>
                  <span className="move-cost">气 {formatCost(m.cost)}</span>
                  <span className="move-desc">{m.description}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Target Selection — only show when there are multiple choices */}
      {selectedMove && (selectedMove.targetType === 'single' || selectedMove.targetType === 'dual') && !(selectedMove.targetType === 'single' && isDuo) && (
        <div className="target-selector">
          <h4>
            {selectedMove.targetType === 'single' ? '选择目标（1人）' : '选择目标（1-2人）'}
          </h4>
          <div className="target-row">
            {alivePlayers.map(p => (
              <button
                key={p.id}
                className={`target-btn ${targets.includes(p.id) ? 'selected' : ''}`}
                onClick={() => handleToggleTarget(p.id)}
              >
                {p.nickname} Lv.{p.level}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Submit */}
      <div className="submit-area">
        <button
          className="btn btn-primary btn-large"
          onClick={handleSubmit}
          disabled={!canSubmit}
        >
          {selectedMove
            ? `确认出招：${selectedMove.name}`
            : '请选择招式'}
        </button>
      </div>
    </div>
  );
}
