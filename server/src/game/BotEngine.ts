import { PlayerState, BotLevel, MoveDef } from '../../shared/types';
import { getMovesByLevel, getMoveById } from '../data/moves';

// ---- Types ----
export interface BotMemory {
  consecutiveDefenses: number;
  opponentHistory: Map<string, string[]>;
  strategy: StrategyProfile;       // current active strategy (may change mid-game)
  baseStrategy: StrategyProfile;   // original strategy at creation
  isTrickster: boolean;            // 诡诈 modifier
  roundsSinceAdapt: number;        // rounds since last strategy check
}

// ---- Utils ----
function randInt(max: number): number { return Math.floor(Math.random() * max); }
function randPick<T>(arr: T[]): T { return arr[randInt(arr.length)]; }
function noise(scale: number) { return (Math.random() - 0.5) * 2 * scale; }
function sum(arr: number[]) { return arr.reduce((a, b) => a + b, 0); }

// ================================================================
// Strategy system — 4 base strategies + 诡诈 modifier + adaptation
// ================================================================

interface StrategyProfile {
  name: string;
  attackBias: number;
  defenseBias: number;
  chargeBias: number;
  specialBias: number;
  riskTolerance: number;
  energyThreshold: number;
  aggressionOnLead: number;
}

const BASE_STRATEGIES: StrategyProfile[] = [
  {
    name: '猛攻', attackBias: 1.5, defenseBias: 0.5, chargeBias: 0.8, specialBias: 0.7,
    riskTolerance: 0.8, energyThreshold: 2, aggressionOnLead: 1.8,
  },
  {
    name: '稳健', attackBias: 0.7, defenseBias: 1.8, chargeBias: 1.5, specialBias: 0.9,
    riskTolerance: 0.2, energyThreshold: 5, aggressionOnLead: 0.5,
  },
  {
    name: '均衡', attackBias: 1.0, defenseBias: 1.0, chargeBias: 1.0, specialBias: 1.0,
    riskTolerance: 0.5, energyThreshold: 3, aggressionOnLead: 1.0,
  },
  {
    name: '赌徒', attackBias: 1.3, defenseBias: 0.2, chargeBias: 1.2, specialBias: 0.5,
    riskTolerance: 0.95, energyThreshold: 1, aggressionOnLead: 2.0,
  },
];

// 诡诈 is a modifier applied on top of any base strategy
// Only meaningful when the bot has 欧/跺 unlocked
const TRICKSTER_MULTIPLIER = 2.5;

// Counter relationships (rock-paper-scissors style)
// 猛攻 → 被稳健克制（防住攻击后攒气反杀）
// 稳健 → 被赌徒克制（趁稳健攒气时突然攻击）
// 均衡 → 被猛攻克制（高压打破均衡节奏）
// 赌徒 → 被稳健克制（不防→容易被防住后反杀）
const COUNTER: Record<string, string> = {
  '猛攻': '稳健',
  '稳健': '赌徒',
  '均衡': '猛攻',
  '赌徒': '稳健',
};

// ================================================================
// Memory
// ================================================================

export function createBotMemory(): BotMemory {
  const base = randPick(BASE_STRATEGIES);
  const isTrickster = Math.random() < 0.3; // 30% chance
  return {
    consecutiveDefenses: 0,
    opponentHistory: new Map(),
    strategy: { ...base },
    baseStrategy: { ...base },
    isTrickster,
    roundsSinceAdapt: 0,
  };
}

// ================================================================
// Main entry
// ================================================================

const RECURSE_DEPTH = 5;
const CANDIDATE_COUNT = 6;

export function chooseBotMove(
  level: BotLevel, bot: PlayerState, allPlayers: PlayerState[],
  round: number, memory: BotMemory
): { moveId: string; targets: string[] } {
  const available = getMovesByLevel(bot.level);
  const others = allPlayers.filter(p => p.alive && p.id !== bot.id);
  if (others.length === 0) return { moveId: 'yun', targets: [] };

  // === EASY BOT: complex strategy system (minimax + adaptation + stuck detection) ===
  if (level === 'easy') {
    // Stuck detection
    const stuck = detectStuck(memory, others);
    if (stuck) {
      memory.strategy = {
        name: '破局', attackBias: 0.05, defenseBias: 0.5, chargeBias: 4.0, specialBias: 0.3,
        riskTolerance: 0.95, energyThreshold: 0, aggressionOnLead: 0.1,
      };
    } else {
      memory.roundsSinceAdapt++;
      if (memory.roundsSinceAdapt >= 3) {
        memory.roundsSinceAdapt = 0;
        adaptStrategy(memory, others);
      }
    }
    // Trickster modifier
    const hasOu = available.some(m => m.specialEffect === 'ou_steal');
    const hasDuo = available.some(m => m.specialEffect === 'duo_counter');
    if (memory.isTrickster && (hasOu || hasDuo)) {
      memory.strategy.specialBias = TRICKSTER_MULTIPLIER;
    } else {
      memory.strategy.specialBias = memory.baseStrategy.specialBias;
    }
    return easyBot(bot, available, others, round, memory);
  }

  // === NORMAL BOT: score all → top-N random (unpredictable within reason) ===
  return normalBot(bot, available, others, round, memory);
}

/** Detect if we're stuck in a draw/block loop */
function detectStuck(memory: BotMemory, others: PlayerState[]): boolean {
  if (others.length === 0) return false;
  const opp = others[0];
  const hist = memory.opponentHistory.get(opp.id) || [];
  if (hist.length < 3) return false;

  // Last 3 rounds: all among {yun, 1-cost attacks} and at least 2 were draws?
  const last3 = hist.slice(-3);
  const unique = new Set(last3);
  // All in a very small pool → likely cycling
  if (unique.size <= 2) return true;
  // Check alternating pattern (yun, attack, yun, attack...)
  const types = last3.map(id => {
    const m = getMoveById(id);
    if (!m) return '?';
    if (m.type === 'charge') return 'C';
    if (m.atk > 0) return 'A';
    return 'X';
  });
  // Patterns: CAC, ACA → alternating charge/attack
  if (types.join('') === 'CAC' || types.join('') === 'ACA') return true;

  return false;
}

// ================================================================
// Adaptive switching: detect opponent style → switch to counter
// ================================================================

function adaptStrategy(memory: BotMemory, others: PlayerState[]): void {
  if (others.length === 0) return;
  const opp = others[0]; // primary opponent
  const hist = memory.opponentHistory.get(opp.id) || [];
  if (hist.length < 3) return; // not enough data

  // Classify opponent's recent style
  const recent = hist.slice(-3);
  let atkCount = 0, defCount = 0, chCount = 0;
  for (const mid of recent) {
    const m = getMoveById(mid);
    if (!m) continue;
    if (m.atk > 0) atkCount++;
    else if (m.def > 0 || m.type === 'special_defense') defCount++;
    else if (m.type === 'charge') chCount++;
  }

  let oppStyle: string;
  if (atkCount >= 2) oppStyle = '猛攻';
  else if (defCount >= 2) oppStyle = '稳健';
  else if (chCount >= 2) oppStyle = '稳健'; // heavy charging = conservative
  else oppStyle = '均衡';

  // Switch to counter-strategy (only if different from current)
  const counterName = COUNTER[oppStyle];
  const counterStrat = BASE_STRATEGIES.find(s => s.name === counterName);
  if (counterStrat && counterStrat.name !== memory.strategy.name) {
    // Copy counter strategy as current active strategy
    Object.assign(memory.strategy, counterStrat);
  }
}

// ================================================================
// EASY — tendency-based random
// ================================================================
// ================================================================
// EASY — complex strategy (minimax + adaptation + stuck detection + exploration)
// ================================================================
function easyBot(
  bot: PlayerState, available: MoveDef[], others: PlayerState[],
  round: number, memory: BotMemory
): { moveId: string; targets: string[] } {
  const affordable = available.filter(m => bot.energy >= m.cost);
  if (affordable.length === 0) return { moveId: 'yun', targets: [] };

  if (round === 1) {
    const r1 = affordable.filter(m => ['yun', 'ou', 'duo'].includes(m.id));
    return makeTargets(r1.length > 0 ? randPick(r1) : getMoveById('yun')!, bot, others);
  }

  const opp = pickPrimaryTarget(bot, others, memory);
  const oppAvailable = getMovesByLevel(opp.level).filter(m => opp.energy >= m.cost);
  if (oppAvailable.length === 0) {
    const atks = affordable.filter(m => m.atk > 0);
    if (atks.length > 0) return makeTargets(randPick(atks), bot, others);
    return makeTargets(getMoveById('yun')!, bot, others);
  }

  const myCandidates = rankCandidates(affordable, bot, opp, memory);
  const oppCandidates = rankCandidates(oppAvailable, opp, bot, memory);

  const scored = myCandidates.map(m => ({
    move: m,
    score: minimaxEval(m, oppCandidates, bot, opp, RECURSE_DEPTH, memory),
  }));
  scored.sort((a, b) => b.score - a.score);

  // 12% exploration
  const explore = Math.random();
  if (explore < 0.12) {
    if (explore < 0.04 && scored.length >= 2) return makeTargets(scored[scored.length - 1].move, bot, others);
    if (explore < 0.08) {
      const recentIds = new Set((memory.opponentHistory.get(opp.id) || []).slice(-3));
      const novel = affordable.filter(m => !recentIds.has(m.id));
      if (novel.length > 0) return makeTargets(randPick(novel), bot, others);
    }
    return makeTargets(randPick(affordable), bot, others);
  }

  return makeTargets(scored[0].move, bot, others);
}

// ================================================================
// NORMAL — score all → top-N equally random (genuinely unpredictable)
// ================================================================

function topNForLevel(level: number): number {
  if (level <= 2) return 3;
  if (level <= 5) return 4;
  if (level <= 10) return 5;
  return 6;
}

function normalBot(
  bot: PlayerState, available: MoveDef[], others: PlayerState[],
  round: number, memory: BotMemory
): { moveId: string; targets: string[] } {
  const affordable = available.filter(m => bot.energy >= m.cost);
  if (affordable.length === 0) return { moveId: 'yun', targets: [] };

  if (round === 1) {
    const r1 = affordable.filter(m => ['yun', 'ou', 'duo'].includes(m.id));
    return makeTargets(r1.length > 0 ? randPick(r1) : getMoveById('yun')!, bot, others);
  }

  const opp = pickPrimaryTarget(bot, others, memory);
  const oppAvailable = getMovesByLevel(opp.level).filter(m => opp.energy >= m.cost);
  const oppCandidates = oppAvailable.length > 0
    ? rankCandidates(oppAvailable, opp, bot, memory).slice(0, CANDIDATE_COUNT)
    : [getMoveById('yun')!];

  // Score every affordable move
  const scored = affordable.map(m => ({
    move: m,
    score: minimaxEval(m, oppCandidates, bot, opp, RECURSE_DEPTH, memory),
  }));
  scored.sort((a, b) => b.score - a.score);

  // Top-N equally random — not picking the "best", just among reasonable options
  const N = Math.min(topNForLevel(bot.level), scored.length);
  const pool = scored.slice(0, N);
  return makeTargets(randPick(pool).move, bot, others);
}

// ================================================================
// Recursive minimax
// ================================================================

function minimaxEval(
  myMove: MoveDef, oppCandidates: MoveDef[],
  me: PlayerState, opp: PlayerState,
  depth: number, memory: BotMemory
): number {
  const oppScores = oppCandidates.map(oppMove => {
    const outcome = evalExchange(myMove, oppMove, me, opp);

    if (outcome.myDeath) return -2000;
    if (outcome.oppDeath) return 2000;

    const newMeEnergy = me.energy - myMove.cost + outcome.myEnergyDelta;
    const newOppEnergy = opp.energy - oppMove.cost + outcome.oppEnergyDelta;

    if (depth <= 0) {
      return leafEval(newMeEnergy, newOppEnergy, me.level, opp.level, memory.strategy);
    }

    const myNewOptions = getMovesByLevel(me.level).filter(m => newMeEnergy >= m.cost);
    const oppNewOptions = getMovesByLevel(opp.level).filter(m => newOppEnergy >= m.cost);

    let futureScore = 0;
    if (myNewOptions.length > 0 && oppNewOptions.length > 0) {
      const topMyNext = rankCandidates(myNewOptions,
        { ...me, energy: newMeEnergy }, { ...opp, energy: newOppEnergy }, memory
      ).slice(0, 3);

      futureScore = Math.max(...topMyNext.map(m =>
        minimaxEval(m, oppNewOptions.slice(0, CANDIDATE_COUNT),
          { ...me, energy: newMeEnergy }, { ...opp, energy: newOppEnergy },
          depth - 1, memory)
      ));
    }

    return futureScore;
  });

  oppScores.sort((a, b) => a - b);
  const topK = oppScores.slice(0, 3);
  return sum(topK) / topK.length;
}

// ================================================================
// Exchange simulation
// ================================================================

interface ExchangeOutcome { myDeath: boolean; oppDeath: boolean; myEnergyDelta: number; oppEnergyDelta: number; }

function evalExchange(myMove: MoveDef, oppMove: MoveDef, me: PlayerState, opp: PlayerState): ExchangeOutcome {
  let myDeath = false, oppDeath = false;
  let myEnergyDelta = 0, oppEnergyDelta = 0;

  if (myMove.id === 'yun') myEnergyDelta += 1;
  if (oppMove.id === 'yun') oppEnergyDelta += 1;

  if (myMove.specialEffect === 'ou_steal') {
    if (oppMove.id === 'yun') { myEnergyDelta += 2; oppEnergyDelta -= 1; }
  }
  if (oppMove.specialEffect === 'ou_steal') {
    if (myMove.id === 'yun') { oppEnergyDelta += 2; myEnergyDelta -= 1; }
  }

  if (myMove.specialEffect === 'duo_counter' && oppMove.specialEffect === 'ou_steal') oppDeath = true;
  if (oppMove.specialEffect === 'duo_counter' && myMove.specialEffect === 'ou_steal') myDeath = true;

  if (!myDeath && !oppDeath) {
    const iAttack = myMove.atk > 0;
    const oppAttack = oppMove.atk > 0;

    if (iAttack && oppAttack) {
      const diff = Math.abs(myMove.atk - oppMove.atk);
      if (diff >= 9) {
        if (myMove.atk < oppMove.atk) myDeath = true;
        else oppDeath = true;
      }
    } else if (iAttack && (oppMove.def > 0 || oppMove.type === 'special_defense')) {
      if (oppMove.specialEffect === 'longdun_block' && ['longzhua', 'xianglong'].includes(myMove.id)) {}
      else if (oppMove.specialEffect === 'dudun_block' && myMove.id === 'du') {}
      else if (myMove.atk > oppMove.def) oppDeath = true;
    } else if (iAttack) {
      oppDeath = true;
    } else if (oppAttack && (myMove.def > 0 || myMove.type === 'special_defense')) {
      if (myMove.specialEffect === 'longdun_block' && ['longzhua', 'xianglong'].includes(oppMove.id)) {}
      else if (myMove.specialEffect === 'dudun_block' && oppMove.id === 'du') {}
      else if (oppMove.atk > myMove.def) myDeath = true;
    } else if (oppAttack) {
      myDeath = true;
    }
  }

  return { myDeath, oppDeath, myEnergyDelta, oppEnergyDelta };
}

// ================================================================
// Strategic position evaluation (leaf nodes)
// ================================================================

function leafEval(myEnergy: number, oppEnergy: number, myLevel: number, oppLevel: number, strategy: StrategyProfile): number {
  let score = (myEnergy - oppEnergy) * 10;

  const myMoves = getMovesByLevel(myLevel);
  const oppMoves = getMovesByLevel(oppLevel);

  const myMaxATK = Math.max(...myMoves.filter(m => myEnergy >= m.cost && m.atk > 0).map(m => m.atk), 0);
  const oppMaxATK = Math.max(...oppMoves.filter(m => oppEnergy >= m.cost && m.atk > 0).map(m => m.atk), 0);
  const myMaxDEF = Math.max(...myMoves.filter(m => myEnergy >= m.cost && m.def > 0).map(m => m.def), 0);
  const oppMaxDEF = Math.max(...oppMoves.filter(m => oppEnergy >= m.cost && m.def > 0).map(m => m.def), 0);

  if (myMaxATK > oppMaxDEF && myMaxATK >= 30) score += 60;
  if (oppMaxATK > myMaxDEF && oppMaxATK >= 30) score -= 60;
  if (myMaxATK >= 50 && oppMaxDEF < 50) score += 40;
  if (oppMaxATK >= 50 && myMaxDEF < 50) score -= 40;

  const gap = myEnergy - oppEnergy;
  if (gap >= 3) score += 50;
  if (gap >= 2) score += 25;
  if (gap <= -3) score -= 50;
  if (gap <= -2) score -= 25;
  if (oppMaxATK >= 50 && myMaxDEF < 50 && gap < 0) score -= 30;
  if (gap < 0) score = score * (1 - strategy.riskTolerance * 0.6);

  return score;
}

// ================================================================
// Candidate ranking
// ================================================================

function rankCandidates(moves: MoveDef[], player: PlayerState, opponent: PlayerState, memory: BotMemory): MoveDef[] {
  const hist = memory.opponentHistory.get(opponent.id) || [];
  const oppAtkFreq = hist.filter(mid => { const m = getMoveById(mid); return m && m.atk > 0; }).length / Math.max(hist.length, 1);

  const scored = moves.map(m => {
    let s = baseScore(m, player, opponent);
    if (m.atk > 0) s *= memory.strategy.attackBias;
    if (m.def > 0 || m.type === 'special_defense') s *= memory.strategy.defenseBias;
    if (m.type === 'charge') s *= memory.strategy.chargeBias;
    if (m.type === 'special') s *= memory.strategy.specialBias;
    if (m.def > 0 && oppAtkFreq > 0.4) s += m.def * 0.5;
    if (m.atk >= 50 && player.energy < memory.strategy.energyThreshold) s -= 25;
    if (m.atk > 0 && player.energy > opponent.energy) s *= memory.strategy.aggressionOnLead;
    s += noise(8);
    return { move: m, score: s };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, CANDIDATE_COUNT).map(s => s.move);
}

function baseScore(move: MoveDef, _me: PlayerState, _opp: PlayerState): number {
  let s = 0;
  if (move.atk > 0) s += move.atk * 1.5;
  if (move.def > 0) s += move.def * 0.8;
  if (move.type === 'charge') s += 12;
  s -= move.cost * 4;
  if (move.atk >= 50) s += 18;
  if (move.specialEffect === 'ou_steal') s += 15;
  if (move.specialEffect === 'duo_counter') s += 5;
  if (move.specialEffect === 'guanyin_buff') s += 30;
  return s;
}

// ================================================================
// Opponent analysis
// ================================================================

interface Tendencies { attack: number; defense: number; charge: number; special: number; }

function getOpponentTendencies(memory: BotMemory, others: PlayerState[]): Tendencies {
  let atk = 0, def = 0, ch = 0, sp = 0, total = 0;
  for (const opp of others) {
    const hist = memory.opponentHistory.get(opp.id) || [];
    for (const mid of hist) {
      const m = getMoveById(mid);
      if (!m) continue;
      if (m.atk > 0) atk++;
      else if (m.def > 0 || m.type === 'special_defense') def++;
      else if (m.type === 'charge') ch++;
      else sp++;
      total++;
    }
  }
  if (total === 0) return { attack: 0.4, defense: 0.2, charge: 0.3, special: 0.1 };
  return { attack: atk / total, defense: def / total, charge: ch / total, special: sp / total };
}

function pickPrimaryTarget(_bot: PlayerState, others: PlayerState[], memory: BotMemory): PlayerState {
  let best = others[0], bestHist = 0;
  for (const o of others) {
    const h = (memory.opponentHistory.get(o.id) || []).length;
    if (h > bestHist) { bestHist = h; best = o; }
  }
  return best;
}

// ================================================================
// History recording
// ================================================================

export function recordOpponentMove(memory: BotMemory, opponentId: string, moveId: string): void {
  if (!memory.opponentHistory.has(opponentId)) {
    memory.opponentHistory.set(opponentId, []);
  }
  const hist = memory.opponentHistory.get(opponentId)!;
  hist.push(moveId);
  if (hist.length > 5) hist.shift();
}

// ================================================================
// Target selection
// ================================================================

function makeTargets(move: MoveDef, _bot: PlayerState, others: PlayerState[]): { moveId: string; targets: string[] } {
  if (move.targetType === 'none') {
    return { moveId: move.id, targets: [] };
  }
  if (move.targetType === 'all') {
    return { moveId: move.id, targets: others.map(o => o.id) };
  }
  if (move.targetType === 'single') {
    return { moveId: move.id, targets: [randPick(others).id] };
  }
  const shuffled = [...others].sort(() => Math.random() - 0.5);
  const count = others.length >= 2 ? (Math.random() < 0.5 ? 1 : 2) : 1;
  return { moveId: move.id, targets: shuffled.slice(0, count).map(p => p.id) };
}
