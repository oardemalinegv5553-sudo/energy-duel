import { PlayerState, BotLevel, MoveDef } from '../../../shared/types';
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
  const allAvailable = getMovesByLevel(bot.level);
  const others = allPlayers.filter(p => p.alive && p.id !== bot.id);
  if (others.length === 0) return { moveId: 'yun', targets: [] };

  // Team mode: filter out AOE attacks (would hit teammates)
  const isTeamMode = bot.team !== undefined;
  const available = isTeamMode
    ? allAvailable.filter(m => m.targetType !== 'all')
    : allAvailable;

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

  const opp = others[0];
  const oppAllAvailable = getMovesByLevel(opp.level).filter(m => opp.energy >= m.cost);

  // ============================================================
  // === STRATEGIC PRE-CHECKS (before scoring) ===
  // ============================================================

  // Both at 0, no 欧 → only 运
  const hasOu = available.some(m => m.specialEffect === 'ou_steal');
  if (bot.energy < 0.01 && opp.energy < 0.01 && !hasOu && round > 1) {
    return { moveId: 'yun', targets: [] };
  }

  // === CHECKMATE: 绝杀检测 ===
  // 挂机(50ATK) or 降龙十八掌(55ATK) when opponent can't超防(50DEF, costs 1气)
  const hasGuaji = affordable.some(m => m.id === 'guaji');
  const hasXianglong = affordable.some(m => m.id === 'xianglong');
  const oppCanChaofang = opp.energy >= 1 && oppAllAvailable.some(m => m.id === 'chaofang');
  const oppCanYuanding = opp.energy >= 1 && oppAllAvailable.some(m => m.id === 'yuanding');
  const oppCanBlock50 = oppCanChaofang || oppCanYuanding;

  if (hasGuaji && bot.energy >= 3 && !oppCanBlock50) {
    // 绝杀：对面防不住挂机
    return makeTargets(getMoveById('guaji')!, bot, others);
  }
  if (hasXianglong && bot.energy >= 3) {
    // 降龙十八掌 55攻，连超防也破 → 只要对面不是观音坐莲就杀
    const oppHasGuanyin = oppAllAvailable.some(m => m.specialEffect === 'guanyin_buff') && opp.energy >= 2;
    if (!oppHasGuanyin) {
      return makeTargets(getMoveById('xianglong')!, bot, others);
    }
  }

  // 钢叉(50ATK, 1气) 绝杀 — same power as挂机, lower cost
  const hasGangcha = affordable.some(m => m.id === 'gangcha');
  if (hasGangcha && bot.energy >= 1 && !oppCanBlock50) {
    return makeTargets(getMoveById('gangcha')!, bot, others);
  }

  // Round 1 probe
  if (round === 1) {
    const r1 = affordable.filter(m => ['yun', 'ou', 'duo'].includes(m.id));
    return makeTargets(r1.length > 0 ? randPick(r1) : getMoveById('yun')!, bot, others);
  }

  // ============================================================
  // === STRATEGIC FILTER: remove contextually useless moves ===
  // ============================================================

  // Filter BEFORE scoring — no point evaluating useless moves
  let reasonable = [...affordable];

  // 超防: ONLY when opponent ≥3 energy (挂机 threat is real)
  // Otherwise 普通防(30) is enough, 超防 wastes 1 energy
  if (opp.energy < 3) {
    reasonable = reasonable.filter(m => m.id !== 'chaofang');
  }

  // 龙盾(0 DEF): ONLY vs降龙十八掌(55ATK, beats防30)
  // Against龙爪(20ATK), 防(30DEF) is better. 龙盾 is a降龙十八掌 specialist.
  const oppHasXianglong = opp.level >= 4 && opp.energy >= 3;
  if (!oppHasXianglong) {
    reasonable = reasonable.filter(m => m.id !== 'longdun');
  }

  // 毒盾: ONLY useful vs毒
  const oppHasDu = opp.level >= 12;
  if (!oppHasDu) {
    reasonable = reasonable.filter(m => m.id !== 'dudun');
  }

  // 跺: ONLY useful if opponent has欧 unlocked
  const oppHasOuAccess = opp.level >= 7;
  if (!oppHasOuAccess) {
    reasonable = reasonable.filter(m => m.id !== 'duo');
  }

  // 防御: pointless if opponent can't attack at all
  const oppCanAttack = oppAllAvailable.some(m => m.atk > 0);
  if (!oppCanAttack) {
    reasonable = reasonable.filter(m => !(m.def > 0 || m.type === 'special_defense'));
  }

  // If filtered to nothing → 运
  if (reasonable.length === 0) {
    return { moveId: 'yun', targets: [] };
  }

  // ============================================================
  // === Score + Random (only among reasonable moves) ===
  // ============================================================

  const oppCandidates = oppAllAvailable.length > 0
    ? rankCandidates(oppAllAvailable, opp, bot, memory).slice(0, CANDIDATE_COUNT)
    : [getMoveById('yun')!];

  const scored = reasonable.map(m => ({
    move: m,
    score: minimaxEval(m, oppCandidates, bot, opp, RECURSE_DEPTH, memory),
  }));
  scored.sort((a, b) => b.score - a.score);

  // Top N
  const N = Math.min(topNForLevel(bot.level), scored.length);
  let pool = scored.slice(0, N).map(s => s.move);

  // Single-target attacks: only keep highest-ATK
  const singles = pool.filter(m => m.targetType === 'single' && m.atk > 0);
  if (singles.length > 1) {
    singles.sort((a, b) => b.atk - a.atk);
    const bestATK = singles[0].atk;
    pool = pool.filter(m => m.targetType !== 'single' || m.atk <= 0 || m.atk === bestATK);
  }

  if (pool.length === 0) return { moveId: 'yun', targets: [] };
  if (pool.length === 1) return makeTargets(pool[0], bot, others);
  return makeTargets(randPick(pool), bot, others);
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
// HARD BOT — reactive counter-pick (runs AFTER everyone else submitted)
// ================================================================

export function chooseHardBotMove(
  bot: PlayerState,
  allPlayers: PlayerState[],
  pendingMoves: Map<string, { moveId: string; targets: string[] }>
): { moveId: string; targets: string[] } {
  const allAvailable = getMovesByLevel(bot.level);
  // Team mode: filter out AOE attacks (would hit teammates)
  const isTeamMode = bot.team !== undefined;
  const available = isTeamMode
    ? allAvailable.filter(m => m.targetType !== 'all')
    : allAvailable;
  const affordable = available.filter(m => bot.energy >= m.cost);
  const others = allPlayers.filter(p => p.alive && p.id !== bot.id);
  // Team mode: only consider opponents for targeting
  const opponents = isTeamMode ? others.filter(o => o.team !== bot.team) : others;
  if (opponents.length === 0 && isTeamMode) return { moveId: 'yun', targets: [] };
  if (others.length === 0) return { moveId: 'yun', targets: [] };

  // ---- Analyze what everyone else is doing ----
  const incomingAttacks: { attacker: PlayerState; move: MoveDef }[] = [];
  const incomingOus: string[] = [];  // player IDs using 欧 on us
  const chargers: PlayerState[] = [];
  const vulnerable: PlayerState[] = [];  // not defending, can be attacked

  for (const other of others) {
    const sub = pendingMoves.get(other.id);
    if (!sub) continue;
    const move = getMoveById(sub.moveId);
    if (!move) continue;

    // Attacks targeting us
    if (sub.targets.includes(bot.id)) {
      if (move.atk > 0) incomingAttacks.push({ attacker: other, move });
      if (move.specialEffect === 'ou_steal') incomingOus.push(other.id);
    }

    if (move.type === 'charge') chargers.push(other);

    // Vulnerable: not defending, not using 观音坐莲
    const isDefending = move.def > 0 || move.type === 'special_defense';
    const isGuanyin = move.specialEffect === 'guanyin_buff';
    if (!isDefending && !isGuanyin) {
      vulnerable.push(other);
    }
  }

  // Team mode: filter out teammates from offensive targeting lists
  if (isTeamMode) {
    for (let i = chargers.length - 1; i >= 0; i--) {
      if (chargers[i].team === bot.team) chargers.splice(i, 1);
    }
    for (let i = vulnerable.length - 1; i >= 0; i--) {
      if (vulnerable[i].team === bot.team) vulnerable.splice(i, 1);
    }
  }

  // ============================================================
  // Rule: Being attacked → counter-attack if we can win, else defend
  // ============================================================
  if (incomingAttacks.length > 0) {
    const maxATK = Math.max(...incomingAttacks.map(a => a.move.atk));
    const strongest = incomingAttacks.sort((a, b) => b.move.atk - a.move.atk)[0];

    // Check if we can counter-attack instead of defending
    // Only safe when: (1) exactly one attacker, (2) we can kill (ATK diff ≥ 9)
    const myAttacks = affordable.filter(m => m.atk > 0).sort((a, b) => b.atk - a.atk);
    if (incomingAttacks.length === 1 && myAttacks.length > 0) {
      const myBest = myAttacks[0];
      // 对攻规则: |ATK差|≥9 → 低的一方死; <9 → 平局(双方存活)
      // 要求 ATK 比对方高 ≥9 才反杀，确保击杀不平局
      if (myBest.atk >= maxATK + 9) {
        return { moveId: myBest.id, targets: [strongest.attacker.id] };
      }
    }

    // Can't safely counter-attack → defend
    const hasXianglong = incomingAttacks.some(a => a.move.id === 'xianglong');
    const hasLongzhua = incomingAttacks.some(a => a.move.id === 'longzhua');
    const hasDu = incomingAttacks.some(a => a.move.id === 'du');

    if (hasXianglong) {
      const longdun = affordable.find(m => m.id === 'longdun');
      if (longdun) return makeTargets(longdun, bot, others);
    }
    if (hasDu) {
      const dudun = affordable.find(m => m.id === 'dudun');
      if (dudun) return makeTargets(dudun, bot, others);
    }
    if (hasLongzhua) {
      const longdun2 = affordable.find(m => m.id === 'longdun');
      if (longdun2) return makeTargets(longdun2, bot, others);
    }
    // 超防: blocks up to 50, only beaten by 降龙十八掌(55)
    if (maxATK > 30 && !hasXianglong) {
      const chaofang = affordable.find(m => m.id === 'chaofang');
      if (chaofang) return makeTargets(chaofang, bot, others);
    }
    // 防(30): blocks ≤30 ATK
    if (maxATK <= 30) {
      const fang = affordable.find(m => m.id === 'fang');
      if (fang) return makeTargets(fang, bot, others);
    }
    // Fallback: any defense
    const anyDef = affordable.filter(m => m.def > 0).sort((a, b) => b.def - a.def);
    if (anyDef.length > 0) return makeTargets(anyDef[0], bot, others);
  }

  // ============================================================
  // Rule: Someone 欧 on us → 跺 counter-kill
  // ============================================================
  if (incomingOus.length > 0) {
    const duo = affordable.find(m => m.id === 'duo');
    if (duo) return makeTargets(duo, bot, others);
  }

  // ============================================================
  // Rule: Low energy + someone charging → 欧 to steal
  // (only use 欧 when desperate — otherwise attack the exposed target)
  // ============================================================
  if (bot.energy < 1 && chargers.length > 0) {
    const ou = affordable.find(m => m.specialEffect === 'ou_steal');
    if (ou) return { moveId: ou.id, targets: [chargers[0].id] };
  }

  // ============================================================
  // Rule: Someone exposed (not defending, using 欧/vulnerable) → attack
  // ============================================================
  if (vulnerable.length > 0) {
    // Choose best attack: highest ATK that we can afford
    const attacks = affordable.filter(m => m.atk > 0).sort((a, b) => b.atk - a.atk);
    if (attacks.length > 0) {
      // Target: most dangerous vulnerable player (highest level, then energy)
      const target = vulnerable.sort((a, b) => b.level - a.level || b.energy - a.energy)[0];

      // Smart attack selection: don't waste 挂机(3气) on a 0-energy weakling
      for (const atk of attacks) {
        // If opponent can still 防 or 超防, need to overpower
        const tSub = pendingMoves.get(target.id);
        const tMove = tSub ? getMoveById(tSub.moveId) : null;
        // They already exposed themselves (not defending), so just use enough ATK
        if (atk.atk > 0 && bot.energy >= atk.cost) {
          return { moveId: atk.id, targets: [target.id] };
        }
      }
      return { moveId: attacks[0].id, targets: [target.id] };
    }
  }

  // ============================================================
  // Rule: Everyone defending → try to break the weakest defense
  // ============================================================
  // At this point: no one is attacking us, no chargers, no vulnerable targets.
  // Everyone is using some form of defense. Check if we can punch through.

  const defenders = (isTeamMode ? opponents : others).filter(o => {
    const sub = pendingMoves.get(o.id);
    if (!sub) return false;
    const m = getMoveById(sub.moveId);
    if (!m) return false;
    // Skip 观音坐莲 users (invincible for 2 rounds)
    if (m.specialEffect === 'guanyin_buff') return false;
    return (m.def > 0 || m.type === 'special_defense');
  });

  if (defenders.length > 0) {
    const attacks = affordable.filter(m => m.atk > 0).sort((a, b) => a.atk - b.atk);

    // For each defender, find the cheapest attack that can break their defense
    const breakable: { target: PlayerState; move: MoveDef }[] = [];

    for (const def of defenders) {
      const sub = pendingMoves.get(def.id)!;
      const defMove = getMoveById(sub.moveId)!;

      for (const atk of attacks) {
        // 龙盾: only blocks 龙爪/降龙, everything else passes (DEF=0)
        if (defMove.specialEffect === 'longdun_block') {
          if (atk.id !== 'longzhua' && atk.id !== 'xianglong') {
            breakable.push({ target: def, move: atk });
            break; // any non-龙 attack works
          }
          continue; // 龙系 attack blocked by 龙盾 rule
        }
        // 毒盾: only blocks 毒, everything else tests against DEF=10
        if (defMove.specialEffect === 'dudun_block') {
          if (atk.id === 'du') continue; // 毒 blocked by rule
          if (atk.atk > defMove.def) {
            breakable.push({ target: def, move: atk });
            break;
          }
          continue;
        }
        // Normal defense: ATK > DEF → break through
        if (atk.atk > defMove.def) {
          breakable.push({ target: def, move: atk });
          break;
        }
      }
    }

    if (breakable.length > 0) {
      // Prefer: can kill (ATK > DEF) → cheapest attack on most dangerous target
      // Sort by target danger (high level first), then by attack cost (cheapest first)
      breakable.sort((a, b) =>
        b.target.level - a.target.level ||
        a.move.cost - b.move.cost
      );
      const pick = breakable[0];
      return { moveId: pick.move.id, targets: [pick.target.id] };
    }
  }

  // No defense breakable → charge
  return { moveId: 'yun', targets: [] };
}

// ================================================================
// Target selection
// ================================================================

function makeTargets(move: MoveDef, bot: PlayerState, others: PlayerState[]): { moveId: string; targets: string[] } {
  // Team mode: only target opponents (not teammates)
  const targets = bot.team !== undefined
    ? others.filter(o => o.team !== bot.team)
    : others;

  if (move.targetType === 'none') {
    return { moveId: move.id, targets: [] };
  }
  if (move.targetType === 'all') {
    return { moveId: move.id, targets: targets.map(o => o.id) };
  }
  if (move.targetType === 'single') {
    if (targets.length === 0) return { moveId: 'yun', targets: [] };
    return { moveId: move.id, targets: [randPick(targets).id] };
  }
  const shuffled = [...targets].sort(() => Math.random() - 0.5);
  const count = targets.length >= 2 ? (Math.random() < 0.5 ? 1 : 2) : 1;
  return { moveId: move.id, targets: shuffled.slice(0, count).map(p => p.id) };
}
