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
# ================================================================
# Game Engine (Lv.1–5 moves for now)
# ================================================================

MOVES = [
    # id, name, level, cost, type, atk, def, targetType
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
# Gym Environment
# ================================================================

class EnergyDuelEnv(gym.Env):
    """1v1 duel environment for RL training."""

    def __init__(self, max_rounds=60, level=5):
        super().__init__()
        self.max_rounds = max_rounds
        self.level = level
        self.moves = get_moves(level)

        # Action: pick one move (index into available moves at current state)
        self.action_space = spaces.Discrete(len(self.moves))

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
        self.my_energy = 0.0
        self.opp_energy = 0.0
        self.my_level = self.level
        self.opp_level = self.level
        self.round = 0
        self.rounds_no_dmg = 0
        self.my_dead = False
        self.opp_dead = False
        self.opp_history = []
        return self._get_obs(), {}

    def step(self, action):
        my_move = self.moves[action]
        my_cost = my_move[3]

        # Can't afford → forced 运 (action 0)
        if self.my_energy < my_cost - 0.001:
            my_move = get_move('yun')

        # Opponent: heuristic policy (混合 运/防/波/天马)
        opp_affordable = self._get_affordable(self.opp_energy)
        if not opp_affordable:
            opp_move = get_move('yun')
        else:
            # Simple heuristic: prefer attacks when safe, defend when threatened
            my_affordable = self._get_affordable(self.my_energy)
            my_atks = [m for m in my_affordable if m[5] > 0]
            if my_atks and random.random() < 0.4:
                # Defend against my possible attack
                defs = [m for m in opp_affordable if m[6] > 0 or m[3] == 'defense']
                if defs:
                    opp_move = random.choice(defs)
                else:
                    opp_move = random.choice(opp_affordable)
            else:
                # Attack or charge
                atks = [m for m in opp_affordable if m[5] > 0]
                if atks and random.random() < 0.5:
                    opp_move = random.choice(atks)
                else:
                    chgs = [m for m in opp_affordable if m[3] == 'charge']
                    opp_move = random.choice(chgs) if chgs else random.choice(opp_affordable)

        # Record opponent move
        self.opp_history.append(opp_move[0])
        if len(self.opp_history) > 8:
            self.opp_history.pop(0)

        # Simulate exchange
        my_death, opp_death, my_ed, opp_ed = eval_exchange(my_move[0], opp_move[0])

        # Apply energy
        self.my_energy = max(0, self.my_energy - (my_move[3] if my_move[0] != 'yun' or self.my_energy < my_cost else 0) + my_ed)
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
    return EnergyDuelEnv(max_rounds=60, level=5)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--steps', type=int, default=1_000_000, help='Total timesteps')
    parser.add_argument('--eval', action='store_true', help='Evaluate only')
    args = parser.parse_args()

    if args.eval:
        from stable_baselines3.common.evaluation import evaluate_policy
        env = DummyVecEnv([make_env])
        model = PPO.load('energy_duel_model')
        mean_reward, std_reward = evaluate_policy(model, env, n_eval_episodes=100)
        print(f'Mean reward: {mean_reward:.2f} ± {std_reward:.2f}')
        return

    print(f'Training PPO for {args.steps:,} steps...')

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

    model.learn(total_timesteps=args.steps)
    model.save('energy_duel_model')
    print('Model saved: energy_duel_model.zip')

    # Export to ONNX
    import onnx
    import onnxruntime as ort
    from stable_baselines3.common.onnx_utils import export_to_onnx

    # SB3 built-in ONNX export
    dummy_obs = np.zeros((1, 7), dtype=np.float32)
    try:
        export_to_onnx(model.policy, dummy_obs, 'energy_duel_model.onnx')
        print('ONNX model exported: energy_duel_model.onnx')
    except Exception as e:
        print(f'ONNX export via SB3 util failed: {e}')
        # Manual export fallback
        import torch
        torch.onnx.export(
            model.policy,
            (torch.zeros(1, 7),),
            'energy_duel_model.onnx',
            input_names=['observation'],
            output_names=['action_probs'],
            dynamic_axes={'observation': {0: 'batch'}},
        )
        print('ONNX model exported (manual): energy_duel_model.onnx')

    # Quick verify ONNX
    session = ort.InferenceSession('energy_duel_model.onnx')
    test_out = session.run(None, {'observation': dummy_obs})
    print(f'ONNX verification OK, output shape: {test_out[0].shape}')


if __name__ == '__main__':
    main()
