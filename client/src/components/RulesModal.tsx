interface Props {
  show: boolean;
  onClose: () => void;
}

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
          <li>一方攻击且 ATK &gt; 对方 DEF → 对方死亡</li>
          <li>对攻差 ≥ 9 → 低攻方死；差 &lt; 9 → 平手都活</li>
          <li>被别人攻击的同时打别人，你的攻击<strong>仍然结算</strong></li>
        </ul>

        <h3>气</h3>
        <ul>
          <li>用「运」攒 1 气，出招扣对应气数</li>
          <li>气数公开可见，无上限</li>
          <li>有人出局后，幸存者气数归零</li>
        </ul>

        <h3>升级</h3>
        <ul>
          <li>赢一局升 1 级，解锁新招式</li>
          <li>每局限 ⌊人数÷2⌋ 人升级，从高排名分配</li>
          <li>场上最高最低级差 &gt; 5 → 最低者自动追上</li>
          <li><strong>过半死亡</strong>：一回合内 ≥ 半数人死 → 幸存者直接升级结束</li>
        </ul>

        <h3>全局招式</h3>
        <ul>
          <li>龙盾（Lv.4）、跺（Lv.7）、毒盾（Lv.12）</li>
          <li>任何人达到等级 → <strong>全员解锁</strong></li>
        </ul>

        <button className="btn btn-primary" onClick={onClose}>知道了</button>
      </div>
    </div>
  );
}
