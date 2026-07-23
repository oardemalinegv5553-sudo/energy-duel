import { MoveDef } from '../../../shared/types';

export const MOVES: MoveDef[] = [
  // ===== Level 1 =====
  { id: 'yun',    name: '运',   level: 1, cost: 0, type: 'charge',  atk: 0,  def: 0,   targetType: 'none',   description: '积攒 1 气' },
  { id: 'fang',   name: '防',   level: 1, cost: 0, type: 'defense', atk: 0,  def: 30,  targetType: 'none',   description: '防御 30，抵挡「波」' },
  { id: 'bo',     name: '波',   level: 1, cost: 1, type: 'attack',  atk: 10, def: 0,   targetType: 'single', description: '基础攻击 10' },
  { id: 'guaji',  name: '挂机', level: 1, cost: 3, type: 'attack',  atk: 50, def: 0,   targetType: 'single', description: '重击 50，破「防」「波」' },
  { id: 'chaofang', name: '超防', level: 1, cost: 1, type: 'defense', atk: 0, def: 50, targetType: 'none',  description: '防御 50，抵挡「挂机」' },

  // ===== Level 2 =====
  { id: 'tianma',        name: '天马',       level: 2, cost: 1, type: 'attack', atk: 15, def: 0, targetType: 'single', description: '15 攻，与「波」平手' },
  { id: 'tianma_meteor', name: '天马流星拳', level: 2, cost: 5, type: 'attack', atk: 60, def: 0, targetType: 'single', description: '60 攻，破「超防」' },

  // ===== Level 3 =====
  { id: 'bingjian',   name: '冰箭',     level: 3, cost: 1/3, type: 'attack', atk: 0.1, def: 0, targetType: 'all', description: '全场 0.1 攻，被「波」「天马」击破' },
  { id: 'bingtian',   name: '冰天雪地', level: 3, cost: 5,   type: 'attack', atk: 50,  def: 0, targetType: 'all', description: '全场 50 攻' },

  // ===== Level 4 =====
  { id: 'longzhua',  name: '龙爪', level: 4, cost: 1, type: 'attack',  atk: 20, def: 0,  targetType: 'single', description: '20 攻，破「冰箭」「波」' },
  { id: 'longdun',   name: '龙盾', level: 4, cost: 0, type: 'defense', atk: 0,  def: 0,  targetType: 'none',   description: '仅抵挡「龙爪」「骇天」', specialEffect: 'longdun_block', globalUnlock: true },
  { id: 'haitian',   name: '骇天', level: 4, cost: 3, type: 'attack',  atk: 55, def: 0,  targetType: 'single', description: '55 攻，破「超防」' },

  // ===== Level 5 =====
  { id: 'min', name: '抿', level: 5, cost: 0.5, type: 'attack', atk: 15, def: 0, targetType: 'all', description: '全场 15 攻，与「波」平手' },

  // ===== Level 6 =====
  { id: 'xiaomao', name: '小毛', level: 6, cost: 1, type: 'attack', atk: 25, def: 0, targetType: 'single', description: '25 攻，破「抿」；与「龙爪」平手' },

  // ===== Level 7 =====
  { id: 'ou',  name: '欧',  level: 7, cost: 0, type: 'special',  atk: 0, def: 0, targetType: 'single', description: '二倍窃取目标本回合获得的气数', specialEffect: 'ou_steal' },
  { id: 'duo', name: '跺',  level: 7, cost: 0, type: 'special',  atk: 0, def: 0, targetType: 'none',   description: '反制「欧」，击杀以自己为目标的欧使用者', specialEffect: 'duo_counter', globalUnlock: true },

  // ===== Level 8 =====
  { id: 'damao',     name: '大毛',       level: 8, cost: 1, type: 'attack', atk: 25, def: 0, targetType: 'dual', description: '双目标各 25 攻' },
  { id: 'daxiaomao', name: '大小毛结合', level: 8, cost: 3, type: 'attack', atk: 50, def: 0, targetType: 'dual', description: '双目标各 50 攻' },

  // ===== Level 9 =====
  { id: 'niu',        name: '牛',       level: 9, cost: 1, type: 'attack', atk: 30, def: 0, targetType: 'single', description: '30 攻，破「波」「冰箭」「天马」「抿」' },
  { id: 'niu_chong',  name: '牛气冲天', level: 9, cost: 3, type: 'attack', atk: 75, def: 0, targetType: 'single', description: '75 攻，破「超防」' },

  // ===== Level 10 =====
  { id: 'yuanding', name: '园丁', level: 10, cost: 1, type: 'defense', atk: 0, def: 75, targetType: 'none', description: '防御 75，抵挡「牛气冲天」「天马流星拳」' },

  // ===== Level 11 =====
  { id: 'lianhua',     name: '莲花',     level: 11, cost: 0, type: 'defense', atk: 0, def: 50,  targetType: 'none', description: '0 气防御 50，相当于「超防」' },
  { id: 'lianhua_throne', name: '莲花宝座', level: 11, cost: 0, type: 'defense', atk: 0, def: 300, targetType: 'none', description: '需使用三次莲花；霸体两回合', specialEffect: 'guanyin_buff', cumulativeTrigger: 'lianhua', cumulativeCount: 3 },

  // ===== Level 12 =====
  { id: 'du',    name: '毒',   level: 12, cost: 1, type: 'attack',  atk: 30, def: 0,  targetType: 'single', description: '30 攻，击碎「莲花」', specialEffect: 'shatter', shatterTarget: 'lianhua' },
  { id: 'dudun', name: '毒盾', level: 12, cost: 0, type: 'defense', atk: 0,  def: 10, targetType: 'none',   description: '防御 10，规则抵挡「毒」', specialEffect: 'dudun_block', globalUnlock: true },

  // ===== Level 13 =====
  { id: 'deng',      name: '蹬',     level: 13, cost: 1, type: 'attack', atk: 40, def: 0, targetType: 'single', description: '40 攻，单体攻击' },
  { id: 'chaodeng',  name: '超蹬',   level: 13, cost: 2, type: 'attack', atk: 60, def: 0, targetType: 'single', description: '60 攻，蹬的强化技' },
  { id: 'luandeng',  name: '乱蹬',   level: 13, cost: 3, type: 'attack', atk: 80, def: 0, targetType: 'single', description: '80 攻，蹬的终极强化技' },

  // ===== Level 14 =====
  { id: 'lamian',       name: '拉面',     level: 14, cost: 1, type: 'attack', atk: 50, def: 0, targetType: 'single', description: '50 攻，单体攻击' },
  { id: 'qicailamian',  name: '七彩拉面', level: 14, cost: 2, type: 'attack', atk: 75, def: 0, targetType: 'single', description: '75 攻，击碎「园丁」「金牛」「海王」', specialEffect: 'shatter', shatterTargets: ['yuanding', 'jinniu', 'haiwang'] },

  // ===== Level 15 =====
  { id: 'jinniu',         name: '金牛',         level: 15, cost: 0, type: 'defense', atk: 0,  def: 75, targetType: 'none',   description: '防御 75' },
  { id: 'jinniu_top',     name: '金牛漩涡顶',   level: 15, cost: 0, type: 'attack',  atk: 75, def: 0,  targetType: 'single', description: '需使用三次金牛；击碎园丁、金牛、海王', specialEffect: 'shatter', shatterTargets: ['yuanding', 'jinniu', 'haiwang'], cumulativeTrigger: 'jinniu', cumulativeCount: 3 },

  // ===== Level 16 =====
  { id: 'haiwang',       name: '海王',     level: 16, cost: 0, type: 'defense', atk: 0,  def: 75, targetType: 'none', description: '防御 75' },
  { id: 'haiwang_quake', name: '海王震天', level: 16, cost: 0, type: 'attack',  atk: 75, def: 0,  targetType: 'all',  description: '需使用三次海王；全体攻击，击碎园丁、金牛、海王', specialEffect: 'shatter', shatterTargets: ['yuanding', 'jinniu', 'haiwang'], cumulativeTrigger: 'haiwang', cumulativeCount: 3 },

  // ===== Level 17 =====
  { id: 'gangcha',    name: '钢叉',     level: 17, cost: 1, type: 'attack', atk: 60, def: 0, targetType: 'single', description: '60 攻，单体攻击' },
  { id: 'shuangguan', name: '双管齐下', level: 17, cost: 3, type: 'attack', atk: 80, def: 0, targetType: 'single', description: '80 攻，单体攻击' },
];

export function getMoveById(id: string): MoveDef | undefined {
  return MOVES.find(m => m.id === id);
}

export function getMovesByLevel(level: number): MoveDef[] {
  return MOVES.filter(m => m.level <= level);
}

/** Check if a move is available to a player, considering global unlocks */
export function isMoveAvailable(moveDef: MoveDef, playerLevel: number, allLevels: number[]): boolean {
  if (moveDef.globalUnlock) {
    // Global unlock: available if ANY player has reached this level
    return allLevels.some(l => l >= moveDef.level);
  }
  return playerLevel >= moveDef.level;
}

/** Get all moves available to a player, considering global unlocks */
export function getAvailableMoves(playerLevel: number, allLevels: number[]): MoveDef[] {
  return MOVES.filter(m => isMoveAvailable(m, playerLevel, allLevels));
}
