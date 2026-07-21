// Client-side move definitions (display + validation only)
// Server is authoritative for game logic

export interface ClientMoveDef {
  id: string;
  name: string;
  level: number;
  cost: number;
  type: 'charge' | 'defense' | 'attack' | 'special' | 'special_defense';
  atk: number;
  def: number;
  targetType: 'none' | 'single' | 'dual' | 'all';
  description: string;
  globalUnlock?: boolean;
}

export const ALL_MOVES: ClientMoveDef[] = [
  // Level 1
  { id: 'yun',    name: '运',   level: 1, cost: 0,   type: 'charge',  atk: 0,  def: 0,   targetType: 'none',   description: '积攒 1 气' },
  { id: 'fang',   name: '防',   level: 1, cost: 0,   type: 'defense', atk: 0,  def: 10,  targetType: 'none',   description: '防 10，挡「波」' },
  { id: 'bo',     name: '波',   level: 1, cost: 1,   type: 'attack',  atk: 10, def: 0,   targetType: 'single', description: '攻 10' },
  { id: 'guaji',  name: '挂机', level: 1, cost: 3,   type: 'attack',  atk: 50, def: 0,   targetType: 'single', description: '攻 50，破「防」「波」' },
  { id: 'chaofang', name: '超防', level: 1, cost: 1, type: 'defense', atk: 0,  def: 50,  targetType: 'none',   description: '防 50，挡「挂机」' },
  // Level 2
  { id: 'tianma',        name: '天马',       level: 2, cost: 1, type: 'attack', atk: 15, def: 0, targetType: 'single', description: '攻 15，与「波」平手' },
  { id: 'tianma_meteor', name: '天马流星拳', level: 2, cost: 5, type: 'attack', atk: 60, def: 0, targetType: 'single', description: '攻 60，破「超防」' },
  // Level 3
  { id: 'bingjian',  name: '冰箭',     level: 3, cost: 1/3, type: 'attack', atk: 0.1, def: 0, targetType: 'all', description: '全场 0.1 攻' },
  { id: 'bingtian',  name: '冰天雪地', level: 3, cost: 5,   type: 'attack', atk: 50,  def: 0, targetType: 'all', description: '全场 50 攻' },
  // Level 4
  { id: 'longzhua',  name: '龙爪', level: 4, cost: 1, type: 'attack',  atk: 20, def: 0, targetType: 'single', description: '攻 20，破「冰箭」「波」' },
  { id: 'longdun',   name: '龙盾', level: 4, cost: 0, type: 'defense', atk: 0,  def: 0, targetType: 'none',   description: '仅挡「龙爪」「骇天」', globalUnlock: true },
  { id: 'haitian',   name: '骇天', level: 4, cost: 3, type: 'attack',  atk: 55, def: 0, targetType: 'single', description: '攻 55，破「超防」' },
  // Level 5
  { id: 'min', name: '抿', level: 5, cost: 0.5, type: 'attack', atk: 15, def: 0, targetType: 'all', description: '全场 15 攻，与「波」平手' },
  // Level 6
  { id: 'xiaomao', name: '小毛', level: 6, cost: 1, type: 'attack', atk: 25, def: 0, targetType: 'single', description: '攻 25，破「抿」；与「龙爪」平手' },
  // Level 7
  { id: 'ou',  name: '欧',  level: 7, cost: 0, type: 'special',  atk: 0, def: 0, targetType: 'single', description: '二倍窃取目标本回合气数' },
  { id: 'duo', name: '跺',  level: 7, cost: 0, type: 'special',  atk: 0, def: 0, targetType: 'none',   description: '全场反制欧：所有欧使用者被杀', globalUnlock: true },
  // Level 8
  { id: 'damao',     name: '大毛',       level: 8, cost: 1, type: 'attack', atk: 25, def: 0, targetType: 'dual', description: '双目标各 25 攻' },
  { id: 'daxiaomao', name: '大小毛结合', level: 8, cost: 3, type: 'attack', atk: 50, def: 0, targetType: 'dual', description: '双目标各 50 攻' },
  // Level 9
  { id: 'niu',        name: '牛',       level: 9, cost: 1, type: 'attack', atk: 30, def: 0, targetType: 'single', description: '攻 30，破「波」「冰箭」「天马」「抿」' },
  { id: 'niu_chong',  name: '牛气冲天', level: 9, cost: 3, type: 'attack', atk: 75, def: 0, targetType: 'single', description: '攻 75，破「超防」' },
  // Level 10
  { id: 'yuanding', name: '园丁', level: 10, cost: 1, type: 'defense', atk: 0, def: 75, targetType: 'none', description: '防 75，挡「牛气冲天」「天马流星拳」' },
  // Level 11
  { id: 'lianhua',   name: '莲花',   level: 11, cost: 0, type: 'defense', atk: 0, def: 50, targetType: 'none', description: '防 50，0气超防' },
  { id: 'lianhua_throne', name: '莲花宝座', level: 11, cost: 0, type: 'defense', atk: 0, def: 300, targetType: 'none', description: '3次莲花后发动，霸体两回合' },
  // Level 12
  { id: 'du',    name: '毒',   level: 12, cost: 1, type: 'attack',  atk: 30, def: 0, targetType: 'single', description: '攻 30，击碎「莲花」' },
  { id: 'dudun', name: '毒盾', level: 12, cost: 0, type: 'defense', atk: 0,  def: 10, targetType: 'none',   description: '防 10，挡「毒」', globalUnlock: true },
  // Level 13
  { id: 'deng',      name: '蹬',     level: 13, cost: 1, type: 'attack', atk: 40, def: 0, targetType: 'single', description: '攻 40' },
  { id: 'chaodeng',  name: '超蹬',   level: 13, cost: 2, type: 'attack', atk: 60, def: 0, targetType: 'single', description: '攻 60' },
  { id: 'luandeng',  name: '乱蹬',   level: 13, cost: 3, type: 'attack', atk: 80, def: 0, targetType: 'single', description: '攻 80' },
  // Level 14
  { id: 'lamian',       name: '拉面',     level: 14, cost: 1, type: 'attack', atk: 50, def: 0, targetType: 'single', description: '攻 50' },
  { id: 'qicailamian',  name: '七彩拉面', level: 14, cost: 2, type: 'attack', atk: 75, def: 0, targetType: 'single', description: '攻 75，击碎「园丁」' },
  // Level 15
  { id: 'jinniu',       name: '金牛',       level: 15, cost: 0, type: 'defense', atk: 0, def: 75, targetType: 'none',   description: '防 75' },
  { id: 'jinniu_top',   name: '金牛漩涡顶', level: 15, cost: 0, type: 'attack',  atk: 75, def: 0, targetType: 'single', description: '3次金牛发动，击碎金牛园丁' },
  // Level 16
  { id: 'haiwang',       name: '海王',     level: 16, cost: 0, type: 'defense', atk: 0, def: 75, targetType: 'none', description: '防 75' },
  { id: 'haiwang_quake', name: '海王震天', level: 16, cost: 0, type: 'attack',  atk: 75, def: 0, targetType: 'all',  description: '3次海王发动，全体击碎园丁金牛' },
  // Level 17
  { id: 'gangcha',    name: '钢叉',     level: 17, cost: 1, type: 'attack', atk: 60, def: 0, targetType: 'single', description: '攻 60' },
  { id: 'shuangguan', name: '双管齐下', level: 17, cost: 3, type: 'attack', atk: 80, def: 0, targetType: 'single', description: '攻 80' },
];

export function getMovesForLevel(level: number, allLevels: number[]): ClientMoveDef[] {
  return ALL_MOVES.filter(m => {
    if (m.globalUnlock) {
      return allLevels.some(l => l >= m.level);
    }
    return m.level <= level;
  });
}
