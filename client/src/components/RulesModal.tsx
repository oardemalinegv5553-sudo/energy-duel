import { ALL_MOVES } from '../moves';

interface Props {
  show: boolean;
  onClose: () => void;
}

// Simplified: level, name, cost, ATK, DEF only
const movesSummary = ALL_MOVES.map(m => ({
  level: m.level,
  name: m.name,
  cost: m.cost === 1/3 ? '⅓' : m.cost === 0.5 ? '½' : String(m.cost),
  atk: m.atk || '—',
  def: m.def || '—',
}));

export default function RulesModal({ show, onClose }: Props) {
  if (!show) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <h2>游戏规则</h2>

        <h3>回合流程</h3>
        <p>每回合所有人同步选招 → 同时揭示 → 结算伤害 → 下一回合</p>

        <h3>死亡判定</h3>
        <ul>
          <li>攻 &gt; 防 → 防守方死亡</li>
          <li>对攻差 ≥ 9 → 低攻方死；差 &lt; 9 → 平手</li>
        </ul>

        <h3>气</h3>
        <ul>
          <li>用「运」攒 1 气，出招扣对应气数</li>
          <li>气数公开可见，有人出局后，幸存者气数归零</li>
        </ul>

        <h3>升级</h3>
        <ul>
          <li>赢一局升 1 级，解锁新招式</li>
          <li>每局 ⌊人数÷2⌋ 以下的人升级，从高排名分配</li>
          <li>场上最高最低级差 &gt; 5 → 弱者等级补足</li>
        </ul>

        <h3>全局招式</h3>
        <ul>
          <li>龙盾（Lv.4）、跺（Lv.7）、毒盾（Lv.12）</li>
          <li>任何人达到等级 → <strong>全员解锁</strong></li>
        </ul>

        <h3>击碎（§3.6）</h3>
        <ul>
          <li>毒→莲花，七彩拉面→园丁，金牛漩涡顶→金牛/园丁，海王震天→园丁/金牛</li>
          <li>不致死，但被击碎的技能<strong>本局禁用</strong></li>
          <li>有人死亡后 / 下一局重置</li>
        </ul>

        <h3>累计触发（§3.7）</h3>
        <ul>
          <li>莲花宝座（3次莲花）、金牛漩涡顶（3次金牛）、海王震天（3次海王）</li>
          <li>使用基础招式 3 次后才能发动一次，发动后计数归零</li>
          <li>有人死亡后 / 下一局重置</li>
        </ul>

        <h3>跺（全场反制）</h3>
        <ul>
          <li>只要有人使用「跺」，场上<strong>所有</strong>欧使用者均被跺使用者击杀</li>
        </ul>

        <h3>招式总览</h3>
        <div className="moves-table-wrap">
          <table className="moves-table">
            <thead>
              <tr>
                <th>Lv</th>
                <th>招式</th>
                <th>气</th>
                <th>攻</th>
                <th>防</th>
              </tr>
            </thead>
            <tbody>
              {movesSummary.map((m, i) => (
                <tr key={i}>
                  <td>{m.level}</td>
                  <td>{m.name}</td>
                  <td>{m.cost}</td>
                  <td>{m.atk}</td>
                  <td>{m.def}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button className="btn btn-primary" onClick={onClose}>阅</button>
      </div>
    </div>
  );
}
