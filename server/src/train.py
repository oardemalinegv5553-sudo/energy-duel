"""
蓄气对决 — PPO 训练脚本
纯 Python 游戏引擎 + Gymnasium 环境 + stable-baselines3 PPO 训练 → ONNX 导出

Usage:
  python3 train.py                     # 默认训练 1M 步
  python3 train.py --steps 2000000     # 自定义步数
  python3 train.py --eval              # 仅评估已保存模型
"""

import random
import math
import argparse
from typing import Optional
import numpy as np
import gymnasium as gym
from gymnasium import spaces
from stable_baselines3 import PPO
from stable_baselines3.common.vec_env import DummyVecEnv
from stable_baselines3.common.callbacks import BaseCallback

class ProgressCallback(BaseCallback):
    def __init__(self):
        super().__init__()
        self.steps_done = 0
    def _on_step(self):
        self.steps_done += 1
        if self.steps_done % 20000 == 0:
            print(f'  ... {self.num_timesteps:,} steps', flush=True)
        return True
# ================================================================
# Game Engine (Lv.1–10 moves)
# ================================================================
# Format: (id, name, level, cost, type, atk, def, targetType)

MOVES = [
    ('yun',       '运',     1, 0,    'charge',   0,   0, 'none'),
    ('fang',      '防',     1, 0,    'defense',  0,  30, 'none'),
    ('bo',        '波',     1, 1,    'attack',  10,   0, 'single'),
    ('guaji',     '挂机',   1, 3,    'attack',  50,   0, 'single'),
    ('chaofang',  '超防',   1, 1,    'defense',  0,  50, 'none'),
    ('tianma',    '天马',   2, 1,    'attack',  15,   0, 'single'),
    ('tianma_meteor', '天马流星拳', 2, 5, 'attack', 60, 0, 'single'),
    ('bingjian',  '冰箭',   3, 1/3,  'attack', 0.1,  0, 'all'),
    ('bingtian',  '冰天雪地', 3, 5,  'attack',  50,   0, 'all'),
    ('longzhua',  '龙爪',   4, 1,    'attack',  20,   0, 'single'),
    ('longdun',   '龙盾',   4, 0,    'defense',  0,   0, 'none'),
    ('haitian',   '骇天',   4, 3,    'attack',  55,   0, 'single'),
    ('min',       '抿',     5, 0.5,  'attack',  15,   0, 'all'),
    ('xiaomao',   '小毛',   6, 1,    'attack',  25,   0, 'single'),
    # Lv.7: 欧/跺
    ('ou',        '欧',     7, 0,    'special',  0,   0, 'single'),
    ('duo',       '跺',     7, 0,    'special',  0,   0, 'single'),
    # Lv.8-10: bigger moves
    ('damao',     '大毛',   8, 1,    'attack',  25,   0, 'single'),
    ('gangcha',   '钢叉',   8, 1,    'attack',  50,   0, 'single'),
    ('damao_combo','大小毛结合', 9, 3, 'attack', 50,   0, 'single'),
    ('niu',       '牛',    10, 1,    'attack',  30,   0, 'single'),
    ('niu_charge','牛气冲天',10, 3,   'attack',  55,   0, 'single'),
]

def get_moves(level):
    return [m for m in MOVES if m[2] <= level]

def get_move(move_id):
    for m in MOVES:
        if m[0] == move_id:
            return m
    return None

# ================================================================
# 1v1 battle simulation
# ================================================================

def eval_exchange(my_move_id, opp_move_id):
    """Simulate one exchange. Returns (my_death, opp_death, my_energy_delta, opp_energy_delta)."""
    my = get_move(my_move_id)
    opp = get_move(opp_move_id)
    if not my or not opp:
        return (False, False, 0, 0)

    my_death, opp_death = False, False
    my_ed, opp_ed = 0, 0

    # Charge
    if my[0] == 'yun': my_ed += 1
    if opp[0] == 'yun': opp_ed += 1

    # Attack resolution
    i_atk = my[5] > 0  # atk
    o_atk = opp[5] > 0
    i_def = my[6] if not i_atk else 0
    o_def = opp[6] if not o_atk else 0

    if i_atk and o_atk:
        diff = abs(my[5] - opp[5])
        if diff >= 9:
            if my[5] < opp[5]:
                my_death = True
            else:
                opp_death = True
    elif i_atk and (o_def > 0 or opp[3] == 'defense'):
        if my[5] > o_def:
            opp_death = True
    elif i_atk:
        opp_death = True
    elif o_atk and (i_def > 0 or my[3] == 'defense'):
        if opp[5] > i_def:
            my_death = True
    elif o_atk:
        my_death = True

    return (my_death, opp_death, my_ed, opp_ed)


# ================================================================
# Normal Bot — minimax with checkmate detection (Python port)
# ================================================================

RECURSE_DEPTH = 3       # minimax depth (3 = balanced speed/quality for Python)
CANDIDATE_COUNT = 5

def base_score(move, player, opponent):
    """Static move scoring (matches BotEngine.ts)."""
    s = 0.0
    atk, def_, cost, mtype = move[5], move[6], move[3], move[4]
    if atk > 0: s += atk * 1.5
    if def_ > 0: s += def_ * 0.8
    if mtype == 'charge': s += 12
    s -= cost * 4
    if atk >= 50: s += 18
    if move[0] == 'ou': s += 15
    if move[0] == 'duo': s += 5
    return s + random.uniform(-4, 4)

def rank_candidates(moves, player, opponent):
    scored = [(m, base_score(m, player, opponent)) for m in moves]
    scored.sort(key=lambda x: -x[1])
    return [m for m, _ in scored[:CANDIDATE_COUNT]]

def leaf_eval(my_energy, opp_energy, my_level, opp_level):
    score = (my_energy - opp_energy) * 10
    my_moves = get_moves(my_level)
    opp_moves = get_moves(opp_level)
    my_max_atk = max([m[5] for m in my_moves if m[5] > 0 and my_energy >= m[3]] + [0])
    opp_max_atk = max([m[5] for m in opp_moves if m[5] > 0 and opp_energy >= m[3]] + [0])
    my_max_def = max([m[6] for m in my_moves if m[6] > 0 and my_energy >= m[3]] + [0])
    opp_max_def = max([m[6] for m in opp_moves if m[6] > 0 and opp_energy >= m[3]] + [0])
    if my_max_atk > opp_max_def and my_max_atk >= 30: score += 60
    if opp_max_atk > my_max_def and opp_max_atk >= 30: score -= 60
    if my_max_atk >= 50 and opp_max_def < 50: score += 40
    if opp_max_atk >= 50 and my_max_def < 50: score -= 40
    gap = my_energy - opp_energy
    if gap >= 3: score += 50
    elif gap >= 2: score += 25
    elif gap <= -3: score -= 50
    elif gap <= -2: score -= 25
    return score

def minimax_eval(my_move, opp_candidates, my_energy, opp_energy, my_level, opp_level, depth):
    scores = []
    for opp_move in opp_candidates:
        my_d, opp_d, my_ed, opp_ed = eval_exchange(my_move[0], opp_move[0])
        if my_d: scores.append(-2000); continue
        if opp_d: scores.append(2000); continue
        new_me = my_energy - my_move[3] + my_ed
        new_oe = opp_energy - opp_move[3] + opp_ed
        if depth <= 0:
            scores.append(leaf_eval(new_me, new_oe, my_level, opp_level))
            continue
        my_opts = get_moves(my_level)
        my_aff = [m for m in my_opts if new_me >= m[3] - 0.001]
        opp_opts = get_moves(opp_level)
        opp_aff = [m for m in opp_opts if new_oe >= m[3] - 0.001]
        if not my_aff or not opp_aff:
            scores.append(leaf_eval(new_me, new_oe, my_level, opp_level))
            continue
        top_my = rank_candidates(my_aff,
            (None, None, my_level, new_me, None, 0, 0, None),
            (None, None, opp_level, new_oe, None, 0, 0, None))[:3]
        future = max(minimax_eval(m, opp_aff[:CANDIDATE_COUNT], new_me, new_oe, my_level, opp_level, depth-1)
                     for m in top_my)
        scores.append(future)
    scores.sort()
    return sum(scores[:3]) / len(scores[:3])

def normal_bot_move(my_energy, opp_energy, my_level, opp_level, rnd):
    """Python port of normalBot's decision logic."""
    all_my = get_moves(my_level)
    affordable = [m for m in all_my if my_energy >= m[3] - 0.001]
    opp_all = get_moves(opp_level)
    opp_affordable = [m for m in opp_all if opp_energy >= m[3] - 0.001]

    if not affordable:
        return get_move('yun')
    if not opp_affordable:
        return random.choice([m for m in affordable if m[5] > 0] or [get_move('yun')])

    # Both at 0, no 欧 → only 运
    if my_energy < 0.01 and opp_energy < 0.01 and rnd > 1:
        return get_move('yun')

    # Checkmate detection
    has_guaji = any(m[0] == 'guaji' for m in affordable)
    has_haitian = any(m[0] == 'haitian' for m in affordable)
    has_gangcha = any(m[0] == 'gangcha' for m in affordable)
    opp_can_block50 = any(m[0] in ('chaofang', 'yuanding') and opp_energy >= m[3] for m in opp_affordable)

    if has_guaji and my_energy >= 3 and not opp_can_block50:
        return get_move('guaji')
    if has_haitian and my_energy >= 3:
        return get_move('haitian')
    if has_gangcha and my_energy >= 1 and not opp_can_block50:
        return get_move('gangcha')

    # R1 probe
    if rnd == 1:
        r1_opts = [m for m in affordable if m[0] in ('yun', 'ou', 'duo')]
        return random.choice(r1_opts or [get_move('yun')])

    # Strategic filter
    reasonable = list(affordable)
    if opp_energy < 3:
        reasonable = [m for m in reasonable if m[0] != 'chaofang']
    opp_has_haitian = opp_level >= 4 and opp_energy >= 3
    if not opp_has_haitian:
        reasonable = [m for m in reasonable if m[0] != 'longdun']
    opp_has_ou = opp_level >= 7
    if not opp_has_ou:
        reasonable = [m for m in reasonable if m[0] != 'duo']
    opp_can_attack = any(m[5] > 0 for m in opp_affordable)
    if not opp_can_attack:
        reasonable = [m for m in reasonable if not (m[6] > 0 or m[4] in ('defense', 'special_defense'))]
    if not reasonable:
        return get_move('yun')

    # Minimax scoring
    opp_candidates = rank_candidates(opp_affordable,
        (None, None, opp_level, opp_energy, None, 0, 0, None),
        (None, None, my_level, my_energy, None, 0, 0, None))
    scored = [(m, minimax_eval(m, opp_candidates, my_energy, opp_energy, my_level, opp_level, RECURSE_DEPTH))
              for m in reasonable]
    scored.sort(key=lambda x: -x[1])

    # Top-N pool
    n = min(4 if my_level <= 5 else 5, len(scored))
    pool = [m for m, _ in scored[:n]]
    singles = [m for m in pool if m[5] > 0]
    if len(singles) > 1:
        best_atk = max(m[5] for m in singles)
        pool = [m for m in pool if not (m[5] > 0 and m[5] != best_atk)]
    return random.choice(pool or [get_move('yun')])


# ================================================================
# Gym Environment
# ================================================================

ALL_MOVES = get_moves(5)  # fixed 13-action space (Lv.5 max), model sees all
NUM_ACTIONS = len(ALL_MOVES)

class EnergyDuelEnv(gym.Env):
    """1v1 duel with random level 1-5 per episode, fixed 13-action space."""

    def __init__(self, max_rounds=60):
        super().__init__()
        self.max_rounds = max_rounds
        self.my_level = 5
        self.opp_level = 5

        self.action_space = spaces.Discrete(NUM_ACTIONS)

        # Observation: [my_energy, opp_energy, my_level, opp_level, round/max, opp_atk_freq, opp_def_freq]
        self.observation_space = spaces.Box(
            low=0, high=1, shape=(7,), dtype=np.float32
        )

        # Per-step tracking
        self.rounds_no_dmg = 0
        self.opp_history = []

    def _get_affordable(self, energy):
        return [m for m in self.moves if energy >= m[3] - 0.001]

    def _get_obs(self):
        opp_atk_freq = 0.3
        opp_def_freq = 0.2
        if self.opp_history:
            n = len(self.opp_history)
            opp_atk_freq = sum(1 for mid in self.opp_history if get_move(mid) and get_move(mid)[5] > 0) / n
            opp_def_freq = sum(1 for mid in self.opp_history if get_move(mid) and get_move(mid)[6] > 0) / n

        return np.array([
            self.my_energy / 5.0,
            self.opp_energy / 5.0,
            self.my_level / 17.0,
            self.opp_level / 17.0,
            self.round / self.max_rounds,
            opp_atk_freq,
            opp_def_freq,
        ], dtype=np.float32)

    def reset(self, seed=None, options=None):
        super().reset(seed=seed)
        self.my_level = random.randint(1, 5)
        self.opp_level = random.randint(1, 5)
        self.my_energy = 0.0
        self.opp_energy = 0.0
        self.round = 0
        self.rounds_no_dmg = 0
        self.my_dead = False
        self.opp_dead = False
        self.opp_history = []
        return self._get_obs(), {}

    def step(self, action):
        my_move = ALL_MOVES[action]

        # Illegal: above level or can't afford → forced 运
        if my_move[2] > self.my_level or self.my_energy < my_move[3] - 0.001:
            my_move = get_move('yun')

        # Opponent: normal bot (minimax + checkmate + strategic filter)
        opp_move = normal_bot_move(self.opp_energy, self.my_energy, self.opp_level, self.my_level, self.round)

        # Record opponent move
        self.opp_history.append(opp_move[0])
        if len(self.opp_history) > 8:
            self.opp_history.pop(0)

        # Simulate exchange
        my_death, opp_death, my_ed, opp_ed = eval_exchange(my_move[0], opp_move[0])

        # Apply energy
        self.my_energy = max(0, self.my_energy - my_move[3] + my_ed)
        self.opp_energy = max(0, self.opp_energy - opp_move[3] + opp_ed)

        # Death
        self.my_dead = my_death
        self.opp_dead = opp_death

        # Round tracking
        self.round += 1
        any_dmg = my_death or opp_death
        if any_dmg:
            self.rounds_no_dmg = 0
        else:
            self.rounds_no_dmg += 1

        # Reward
        reward = 0.0
        if opp_death:
            reward += 2.0  # kill
        if my_death:
            reward -= 2.0  # died
        if not any_dmg:
            reward -= 0.05  # stale round penalty (turtle prevention)
        if self.rounds_no_dmg >= 3:
            reward -= 0.15  # continuous stalemate penalty

        # Terminal
        terminated = self.my_dead or self.opp_dead or self.round >= self.max_rounds
        truncated = False

        # Win/loss bonus on termination
        if terminated:
            if self.opp_dead and not self.my_dead:
                reward += 10.0
            elif self.my_dead and not self.opp_dead:
                reward -= 10.0
            # Both dead or max rounds → no bonus

        info = {'my_move': my_move[1], 'opp_move': opp_move[1], 'round': self.round}

        return self._get_obs(), reward, terminated, truncated, info


# ================================================================
# Training
# ================================================================

def make_env():
    return EnergyDuelEnv(max_rounds=60)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--steps', type=int, default=2_000_000, help='Total timesteps')
    parser.add_argument('--eval', action='store_true', help='Evaluate only')
    parser.add_argument('--export', action='store_true', help='Export existing model to ONNX')
    args = parser.parse_args()

    if args.eval:
        from stable_baselines3.common.evaluation import evaluate_policy
        env = DummyVecEnv([make_env])
        model = PPO.load('energy_duel_model')
        mean_reward, std_reward = evaluate_policy(model, env, n_eval_episodes=100)
        print(f'Mean reward: {mean_reward:.2f} ± {std_reward:.2f}')
        return

    if args.export:
        export_onnx()
        return

    print(f'Training PPO for {args.steps:,} steps...')
    print('  Opponent: normal bot (minimax depth=4, checkmate, strategic filter)')
    print('  Environment: 4 parallel Lv.5 1v1 duels')
    print('  Press Ctrl+C to stop early (model will still be saved)')
    import sys; sys.stdout.flush()

    # Create vectorized environment
    env = DummyVecEnv([make_env for _ in range(4)])

    # PPO model
    model = PPO(
        'MlpPolicy',
        env,
        learning_rate=3e-4,
        n_steps=512,
        batch_size=64,
        n_epochs=10,
        gamma=0.95,
        gae_lambda=0.95,
        clip_range=0.2,
        ent_coef=0.01,  # encourage exploration (counter turtle)
        verbose=1,
    )

    try:
        model.learn(total_timesteps=args.steps, callback=ProgressCallback())
    except KeyboardInterrupt:
        print('\nTraining interrupted, saving model...')
    model.save('energy_duel_model')
    print('Model saved: energy_duel_model.zip')


def export_onnx():
    """Export trained PPO weights as JSON for Node.js inference.

    The policy network is: obs(7) → shared_net → latent(64) → action_net → logits(N).
    We extract all Linear layer weights/biases as JSON arrays.
    Node.js does: x = relu(W1·obs + b1); x = relu(W2·x + b2); logits = W3·x + b3; softmax(logits/T).
    """
    import json
    import torch

    model = PPO.load('energy_duel_model')
    state = model.policy.state_dict()

    weights = {}
    for k, v in state.items():
        if hasattr(v, 'numpy'):
            weights[k] = v.numpy().tolist()

    with open('energy_duel_model.json', 'w') as f:
        json.dump(weights, f)
    print(f'Weights exported: energy_duel_model.json ({len(weights)} tensors)')
    for k, v in weights.items():
        if isinstance(v, list):
            shape = [len(v)] if not isinstance(v[0], list) else [len(v), len(v[0])] if v[0] and isinstance(v[0], list) else [len(v)]
            print(f'  {k}: {shape}')

    # Also save action mapping
    mapping = {str(i): {'moveId': m[0], 'cost': m[3]} for i, m in enumerate(ALL_MOVES)}
    with open('energy_duel_action_map.json', 'w') as f:
        json.dump(mapping, f)
    print(f'Action map: energy_duel_action_map.json ({len(mapping)} actions)')


if __name__ == '__main__':
    main()
