# ⚔ 蓄气对决 (Energy Duel)

小学的回忆！在线多人拍手对战游戏。攒气、出招、升级。

## 核心机制

- **26 种招式** × **13 个等级**，从基础的「运」「防」「波」到终极「降龙十八掌」「毒」
- **能量经济**：出招消耗气，运攒气，欧偷气，跺反制
- **一击必杀**：HP=1，对攻差 ≥9 定生死，否则平局
- **同时回合制**：每回合所有人暗中选招，同时揭晓
- **升级系统**：每局 Top N 升级，解锁更强招式

## 游戏模式

| 模式 | 人数 | 说明 |
|------|------|------|
| ⚔ 双人对战 | 2人 | 1v1 对决 |
| 👥 多人混战 | 2-8人 | 自由混战，存活者为王 |
| 🛡 组队对战 | 2-8人 | 红蓝两队对抗，一方全灭即结束，胜方全员升级 |

## 账号系统

- 注册/登录（pbkdf2 密码哈希），支持游客模式
- 登录后可跨设备保留等级进度
- 断线重连：刷新页面自动回到房间，保留聊天记录和等级

## 房间系统

- **房间列表**：大厅可浏览所有开放房间，显示状态（等待中/选招中/战斗中）和初始等级
- **中途加入**：选招阶段（非战斗中）可随时加入，等级自动匹配当前存活者
- **人机**：简单/普通/困难三档，组队模式支持普通和困难
- **房主权限**：踢人、调整队伍、开始游戏
- 空房间/纯人机房间自动清理

## 聊天系统

- 游戏中右下角 💬 按钮打开聊天面板
- 组队模式支持**队内聊天**（仅队友可见）和**全场聊天**
- 新玩家/重连自动加载历史消息（最多 200 条）

## UI 特性

- 🌙 暗色主题 + 武侠东方气韵，渐变背景 + 点阵纹理
- 📱 **简洁模式**：移动端友好，招式卡片紧凑排列，双击展开详情
- 📋 **规则模式**：完整招式信息（攻/防/描述）
- 招式卡片按类型分色：蓄气金、攻击红、防御青、特殊紫
- 计时器最后 5 秒变红闪烁
- 组队模式红蓝分队展示 + 队杀彩蛋

## 快速开始

### 服务端

```bash
cd server
npm install
npx tsx src/index.ts   # 开发模式，端口 3000
```

### 客户端（本地开发）

```bash
cd client
npm install
npm run dev             # Vite dev server，端口 5173
```

打开 `http://localhost:5173` 即可游玩。

### 外网联机

```bash
ngrok http 3000          # 把服务端暴露到公网
cd client && npm run build   # 构建生产版客户端
```

修改 `client/src/socket.ts` 的 `SERVER_URL` 为 ngrok 地址后重新构建。

## 技术栈

| 层 | 技术 |
|----|------|
| 客户端 | React 18 + TypeScript + Vite |
| 服务端 | Node.js + Express + Socket.IO |
| AI | 自研 minimax 博弈树 + 策略自适应 + 后手反制 |
| 身份验证 | pbkdf2 (SHA-512, 100k 迭代) + JSON 文件持久化 |
| 部署 | GitHub Pages (客户端) + ngrok/Render (服务端) |

## 人机 AI

| 难度 | 策略 |
|------|------|
| 🤖 简单 | minimax 递归评估 + 策略自适应 + 防卡死检测 |
| 🧠 普通 | 上下文过滤 + Top-N 随机选择（不可预测） |
| 💀 困难 | 后手反制：等所有人出招后选择最优解，含反杀判断和防御突破 |

## 项目结构

```
energy-duel/
├── client/                # React 前端
│   └── src/
│       ├── App.tsx        # 主状态机
│       ├── socket.ts      # Socket.IO 客户端
│       ├── auth.ts        # 本地认证存储
│       ├── moves.ts       # 招式定义
│       └── components/    # 游戏 UI 组件
│           ├── AuthPanel.tsx       # 登录/注册
│           ├── Lobby.tsx          # 大厅 + 房间列表
│           ├── WaitingRoom.tsx    # 等待室
│           ├── PlayerStatusBar.tsx # 玩家状态栏
│           ├── MoveSelector.tsx   # 招式选择
│           ├── PhaseResolution.tsx # 回合结算展示
│           ├── GameScreen.tsx     # 游戏主界面
│           ├── GameOver.tsx       # 结算画面
│           ├── ChatPanel.tsx      # 聊天面板
│           └── RulesModal.tsx     # 规则弹窗
├── server/                # Node.js 后端
│   └── src/
│       ├── index.ts       # Express 入口 + REST API
│       ├── socket.ts      # Socket.IO 事件
│       ├── game/          # 游戏引擎
│       │   ├── GameEngine.ts    # 回合调度
│       │   ├── BotEngine.ts     # 人机 AI
│       │   ├── MoveResolver.ts  # 战斗结算
│       │   ├── EnergyResolver.ts # 能量/欧链
│       │   └── LevelResolver.ts # 排名/升级
│       ├── room/          # 房间管理
│       │   ├── GameRoom.ts      # 房间状态
│       │   └── RoomManager.ts   # 全局房间池
│       ├── auth/          # 账号系统
│       │   └── AuthManager.ts   # 注册/登录/会话
│       └── data/
│           └── moves.ts   # 服务端招式定义
└── shared/                # 共享类型定义
    └── types.ts
```

## 许可

MIT
