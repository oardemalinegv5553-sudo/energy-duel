/**
 * ML model inference for 蓄气对决.
 * Loads PPO-trained weights (JSON) and runs forward pass: obs → policy_net → action_net → logits.
 * The model was trained at Lv.5 with 13 actions; action_map maps index → moveId+cost.
 */

import * as fs from 'fs';
import * as path from 'path';

interface ActionEntry {
  moveId: string;
  cost: number;
}

let modelWeights: Record<string, number[][]> | null = null;
let actionMap: Record<string, ActionEntry> | null = null;

// Network architecture from SB3 PPO MlpPolicy
// obs(7) → Linear(W1:64×7, b1:64) → ReLU → Linear(W2:64×64, b2:64) → ReLU → Linear(Wa:13×64, ba:13) → logits

export function loadModel(modelDir: string): boolean {
  try {
    const wPath = path.join(modelDir, 'energy_duel_model.json');
    const aPath = path.join(modelDir, 'energy_duel_action_map.json');

    if (!fs.existsSync(wPath) || !fs.existsSync(aPath)) {
      console.log('[mlInference] Model files not found, skipping ML bot');
      return false;
    }

    modelWeights = JSON.parse(fs.readFileSync(wPath, 'utf-8'));
    actionMap = JSON.parse(fs.readFileSync(aPath, 'utf-8'));
    console.log('[mlInference] Model loaded OK');
    return true;
  } catch (e) {
    console.error('[mlInference] Failed to load model:', e);
    return false;
  }
}

function matMul(x: number[], W: number[][], b: number[]): number[] {
  const out = new Array(W.length).fill(0);
  for (let i = 0; i < W.length; i++) {
    let s = 0;
    const row = W[i];
    for (let j = 0; j < x.length; j++) {
      s += x[j] * row[j];
    }
    out[i] = s + b[i];
  }
  return out;
}

function relu(x: number[]): number[] {
  return x.map(v => (v > 0 ? v : 0));
}

function softmax(logits: number[], temperature: number): number[] {
  const maxLogit = Math.max(...logits);
  const exps = logits.map(l => Math.exp((l - maxLogit) / temperature));
  const total = exps.reduce((a, b) => a + b, 0);
  return exps.map(e => e / total);
}

/**
 * Build observation features matching the training environment.
 * All values normalized to [0, 1] range.
 */
function buildFeatures(
  myEnergy: number,
  oppEnergy: number,
  myLevel: number,
  oppLevel: number,
  round: number,
  maxRounds: number,
  oppAtkFreq: number,
  oppDefFreq: number,
): number[] {
  return [
    myEnergy / 5,
    oppEnergy / 5,
    myLevel / 17,
    oppLevel / 17,
    round / maxRounds,
    oppAtkFreq,
    oppDefFreq,
  ];
}

export interface MLMoveChoice {
  moveId: string;
  prob: number;
}

/**
 * Run inference and return probability distribution over available moves.
 * Only includes moves the bot can afford (energy >= cost).
 */
export function inferMove(
  myEnergy: number,
  oppEnergy: number,
  myLevel: number,
  oppLevel: number,
  round: number,
  oppAtkFreq: number,
  oppDefFreq: number,
  temperature: number,
): MLMoveChoice[] | null {
  if (!modelWeights || !actionMap) return null;

  const obs = buildFeatures(myEnergy, oppEnergy, myLevel, oppLevel, round, 60, oppAtkFreq, oppDefFreq);

  // Forward pass
  const w1: number[][] | undefined = modelWeights['mlp_extractor.policy_net.0.weight'];
  const b1: number[] | undefined = modelWeights['mlp_extractor.policy_net.0.bias'] as any;
  const w2: number[][] | undefined = modelWeights['mlp_extractor.policy_net.2.weight'];
  const b2: number[] | undefined = modelWeights['mlp_extractor.policy_net.2.bias'] as any;
  const wa: number[][] | undefined = modelWeights['action_net.weight'];
  const ba: number[] | undefined = modelWeights['action_net.bias'] as any;

  if (!w1 || !b1 || !w2 || !b2 || !wa || !ba) return null;

  let x = matMul(obs, w1, b1);
  x = relu(x);
  x = matMul(x, w2, b2);
  x = relu(x);
  x = matMul(x, wa, ba); // logits

  const probs = softmax(x, temperature);

  // Map to move IDs, filter by affordability
  const results: MLMoveChoice[] = [];
  for (let i = 0; i < probs.length; i++) {
    const entry = actionMap[String(i)];
    if (entry && myEnergy >= entry.cost - 0.001) {
      results.push({ moveId: entry.moveId, prob: probs[i] });
    }
  }

  // Re-normalize probabilities after filtering
  const total = results.reduce((a, b) => a + b.prob, 0);
  if (total > 0) {
    for (const r of results) r.prob /= total;
  }

  return results.length > 0 ? results : null;
}
