/**
 * LLM AI Bot — 接入大语言模型（DeepSeek/豆包/GLM/Kimi 等 OpenAI 兼容 API）
 * System prompt（规则+招式表）只构建一次，每回合只发短 user message。
 */

import { PlayerState, MoveDef, LLMConfig } from '../../shared/types';
import { getMovesByLevel, getMoveById } from './data/moves';

// ================================================================
// System Prompt（固定，含全部规则 + 37 招完整表）
// ================================================================

const SYSTEM_PROMPT = `你是"蓄气对决"（Energy Duel）的AI玩家。你的目标是在对战中获胜。

## 游戏规则

### 基本机制
- 每回合所有玩家同时选择招式，一起结算
- 初始0气，通过"运"（+1气）或其他方式获取能量
- 每招消耗不同的气（cost），气不够不能用
- 每回合只能出一招
- HP为1（即死制），死亡后不能行动

### 攻防结算（按优先级）
1. **双方都出攻击（ATK>0）→ 对攻**：|ATK差| ≥ 9 → 低ATK方死亡；差 < 9 → 平手（双方存活）
2. **攻击 vs 防御**：ATK > DEF → 防御方死亡（破防）；ATK ≤ DEF → 防住
3. **攻击 vs 无防御招式（如运、欧、跺等）** → 无防御方死亡
4. **窃取方被跺反制** → 攻击失效（跺 counter-kill 对自己用欧的人）

### 特殊招式
- **欧**(Lv.7,0费)：偷目标本回合的能量收益（2倍）。但如果目标出跺→欧方即死
- **跺**(Lv.7,0费)：counter-kill任何对自己用欧的人。对其他人无效
- **龙盾**(Lv.4,0费)：仅免疫龙爪和骇天，对其他攻击DEF=0（等于无防）
- **毒盾**(Lv.12,0费)：仅免疫毒，对其他攻击DEF=10
- **莲花宝座**(Lv.11,0费)：霸体2回合（无视死亡）。需要先用3次莲花
- **击碎(七彩拉面等)**：命中后禁用目标的特定技能，不击杀

### 累计触发（§3.7）
- 莲花宝座→需使用莲花3次
- 金牛漩涡顶→需使用金牛3次
- 海王震天→需使用海王3次

### 多人对战
- 全体攻击（all类）会打到除自己外的所有活着的玩家
- 双目标攻击（dual类）可选择1-2个目标

## 决策原则
1. **优先击杀**：如果出某招能确保杀死一个对手且自己不死→优先选
2. **危险优先防御**：如果对手很可能攻击你且你不能反杀→防御
3. **僵局蓄气破防**：如果攻不穿对手防御→蓄气攒大招（挂机50ATK/骇天55ATK等）
4. **注意能量差**：对手气多时他能出更强招式；你气多时有先手优势
5. **注意等级差**：高等级有更强招式，低等级需保守
6. **注意链式推理**：不要只看眼前，要做“预判别人的预判”，甚至“预判别人预判我的预判”

## 全部招式表

### Lv.1
- 运(cost0,charge): 蓄1气
- 防(cost0,defense): DEF=30，抵挡波/龙爪/抿等≤30ATK的攻击
- 波(cost1,attack,ATK=10,single): 基础攻击
- 挂机(cost3,attack,ATK=50,single): 重击，破防/超防外的所有防御
- 超防(cost1,defense,DEF=50): 高级防御，挡挂机等≤50ATK攻击

### Lv.2
- 天马(cost1,attack,ATK=15,single): 与波对攻平手
- 天马流星拳(cost5,attack,ATK=60,single): 破超防

### Lv.3
- 冰箭(cost1/3,attack,ATK=0.1,all): 全场微量攻击，被波/天马对攻击败
- 冰天雪地(cost5,attack,ATK=50,all): 全场50攻

### Lv.4
- 龙爪(cost1,attack,ATK=20,single): 破冰箭/波
- 龙盾(cost0,defense,DEF=0): 仅免疫龙爪和骇天！对其他攻击DEF=0=无防！
- 骇天(cost3,attack,ATK=55,single): 破超防

### Lv.5
- 抿(cost0.5,attack,ATK=15,all): 全场15攻，与波/天马对攻平手

### Lv.6
- 小毛(cost1,attack,ATK=25,single): 破抿，与龙爪对攻平手

### Lv.7
- 欧(cost0,special,single): 偷目标能量（若目标出运则偷2气），被跺counter-kill
- 跺(cost0,special,none): counter-kill任何对自己用欧的人

### Lv.8
- 大毛(cost1,attack,ATK=25,dual): 可打1-2人
- 大小毛结合(cost3,attack,ATK=50,dual): 可打1-2人，50攻

### Lv.9
- 牛(cost1,attack,ATK=30,single): 破波/冰箭/天马/抿
- 牛气冲天(cost3,attack,ATK=75,single): 破超防

### Lv.10
- 园丁(cost1,defense,DEF=75): 挡牛气冲天/天马流星拳等≤75ATK

### Lv.11
- 莲花(cost0,defense,DEF=50): 免费超防
- 莲花宝座(cost0,defense,DEF=300,霸体2回合): 需先用莲花3次

### Lv.12
- 毒(cost1,attack,ATK=30,single): 击碎莲花
- 毒盾(cost0,defense,DEF=10): 仅免疫毒，对其他攻击DEF=10

### Lv.13
- 蹬(cost1,attack,ATK=40,single)
- 超蹬(cost2,attack,ATK=60,single)
- 乱蹬(cost3,attack,ATK=80,single)

### Lv.14
- 拉面(cost1,attack,ATK=50,single)
- 七彩拉面(cost2,attack,ATK=75,single): 击碎园丁/金牛/海王

### Lv.15
- 金牛(cost0,defense,DEF=75)
- 金牛漩涡顶(cost0,attack,ATK=75,single): 需先用金牛3次，击碎园丁/金牛/海王

### Lv.16
- 海王(cost0,defense,DEF=75)
- 海王震天(cost0,attack,ATK=75,all): 需先用海王3次，击碎园丁/金牛/海王

### Lv.17
- 钢叉(cost1,attack,ATK=60,single)
- 双管齐下(cost3,attack,ATK=80,single)
`;

// ================================================================
// Per-round user message
// ================================================================

function buildUserMessage(
  bot: PlayerState,
  others: PlayerState[],
  available: MoveDef[],
  round: number,
): string {
  const lines: string[] = [];

  lines.push(`回合 ${round}`);
  lines.push('');
  lines.push(`你的状态：Lv.${bot.level}，能量 ${bot.energy.toFixed(1)}`);
  lines.push('');

  if (others.length === 1) {
    const o = others[0];
    lines.push(`对手状态：Lv.${o.level}，能量 ${o.energy.toFixed(1)}`);
  } else {
    lines.push(`对手（共${others.length}人）：`);
    for (let i = 0; i < others.length; i++) {
      const o = others[i];
      lines.push(`  对手${i + 1}：Lv.${o.level}，能量 ${o.energy.toFixed(1)}`);
    }
  }

  lines.push('');
  lines.push('你当前可用的招式（已过滤等级/能量/击碎限制）：');
  for (const m of available) {
    const atkStr = m.atk > 0 ? ` ATK=${m.atk}` : '';
    const defStr = m.def > 0 ? ` DEF=${m.def}` : '';
    const targetStr = m.targetType !== 'none' ? ` [目标:${m.targetType}]` : '';
    lines.push(`  ${m.name}(${m.id}, cost=${m.cost}${atkStr}${defStr}${targetStr}): ${m.description}`);
  }

  lines.push('');
  lines.push('请只回复一个招式名称（从上面列表中选），不要解释。');

  return lines.join('\n');
}

// ================================================================
// API call + response parsing
// ================================================================

async function callLLM(config: LLMConfig, systemPrompt: string, userMessage: string): Promise<string> {
  const url = config.endpoint.replace(/\/+$/, '') + '/chat/completions';

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.3,
      max_tokens: 20,
    }),
  });

  if (!response.ok) {
    throw new Error(`LLM API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as any;
  const content = data?.choices?.[0]?.message?.content || '';
  return content.trim();
}

function parseMoveName(raw: string, available: MoveDef[]): MoveDef | null {
  // Try exact id match first
  const idMatch = available.find(m => raw.includes(m.id) || raw === m.id);
  if (idMatch) return idMatch;

  // Try name match (case-insensitive, exact or substring)
  const lower = raw.toLowerCase();
  const nameMatch = available.find(m => lower.includes(m.name.toLowerCase()));
  if (nameMatch) return nameMatch;

  // Try first word of raw response against all move names
  const firstWord = raw.split(/[\s,，。]/)[0].toLowerCase();
  const wordMatch = available.find(m => m.name.toLowerCase() === firstWord);
  if (wordMatch) return wordMatch;

  return null;
}

// ================================================================
// Main export
// ================================================================

export interface LLMBotResult {
  moveId: string;
  targets: string[];
}

export async function getLLMBotMove(
  config: LLMConfig,
  bot: PlayerState,
  allPlayers: PlayerState[],
  available: MoveDef[],
  round: number,
): Promise<LLMBotResult | null> {
  const others = allPlayers.filter(p => p.alive && p.id !== bot.id);
  const affordable = available.filter(m => bot.energy >= m.cost);
  if (affordable.length === 0) return { moveId: 'yun', targets: [] };

  const userMessage = buildUserMessage(bot, others, affordable, round);

  try {
    const raw = await Promise.race([
      callLLM(config, SYSTEM_PROMPT, userMessage),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('LLM timeout')), 8000)
      ),
    ]);

    const move = parseMoveName(raw, affordable);
    if (move) {
      return { moveId: move.id, targets: [] }; // targets filled by makeTargets in BotEngine
    }

    console.log(`[llmBot] Could not parse move from: "${raw}"`);
    return null;
  } catch (err) {
    console.log(`[llmBot] LLM call failed: ${err}`);
    return null;
  }
}
