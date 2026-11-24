# PVP 模块目录

```
js/pvp/
├── core/
│   ├── engine.js      # 2v2 状态机：编成、ban、回合、技能条件、被动、伤害、结算
│   └── rank.js        # 段位、胜点、晋升献祭、计划点、碎卡、回滚、赛季统计
├── channels/
│   └── team.js        # A/B 队内频道：Supabase Broadcast / BroadcastChannel / localStorage
├── config/
│   └── training-config.js  # 本月公告、规则表、当天对局规则（本机 + 云端 settings.pvpConfig）
├── ui/
│   ├── training.js    # 训练场入口、大厅、等待、邀请、投骰/编成/ban 前置阶段
│   ├── invite-bus.js  # 登录后常驻接收裁判/队友/对手邀请，60 秒倒计时弹窗
│   └── referee.js     # 裁判控制台、结算、段位/保护、队伍频道与聊天、训练场对局接管
└── README.md
```

## 入口

- 地图 → 训练场 → 「进入训练场 PVP」→ `#/training-pvp`
- 训练场三个入口：排位对局、娱乐对局、裁判控制台（仅管理者）
- 裁判控制台也可从左侧「卡牌对战」菜单进入

## 数据与存储

- 对局大厅：`localStorage.sdj_pvp_lobby_v1`，通过 `lobby-main` 频道实时广播。
- 当前裁判对局：`localStorage.sdj_pvp_match_v1`，由 `referee.js` 读取。
- 训练场完成前置阶段后，会把引擎快照写入大厅对局的 `engine` 字段；裁判台可跨设备「接管对局」。
- 段位/锁/保护/审计：`state.pvp`（本地），计划点进入 `state.wallets`，碎卡/献祭扣减 `state.cards.holdings`。
- 公告/规则：本机 `localStorage.sdj_pvp_config_v1` + 云端 `world_state.settings.pvpConfig`，读取时按 `updatedAt` 取较新的一份。
- 邀请接收：`user-<username>` 频道；接受后写 `sdj_pvp_open_match_v1` 并跳转训练场对应对局。
- 队伍频道码：`sessionStorage.sdj_pvp_team_room`（训练场「进入本队频道」→ 卡牌对战页自动带入）。

## 权限与流程

- 裁判控制台仅 `role === "admin"`；其他角色点击提示「暂只有管理者可进入」。
- 邀请顺序：裁判确认 → 邀请搭档/对手；未确认裁判时前端不展示后续邀请按钮。
- 角色校验：玩家只能邀请契约者，契约者只能邀请玩家；接受邀请时再次校验身份与队伍空位。
- 开始条件：裁判已确认 + A/B 各 1 玩家 + 1 契约者（共 4 人）；未满足时「开始」置灰。
- 前置阶段：投骰 3 分钟 → 编成 10 分钟 → 禁牌 5 分钟 → 正式对局；双方提前完成即直接进入下一阶段。

## 样式

- `css/pvp/referee.css`：裁判台、技能选择、段位/保护。
- `css/pvp/training.css`：训练场入口、大厅、等待、邀请、前置阶段。

## 测试

- `tests/pvp/engine-regression.js`：引擎 P1–P51
- `tests/pvp/rank-regression.js`：段位/经济 K1–K39
- `tests/run.html`：完整回归 + PVP/TP 界面烟测（TP1–TP16：入口、权限、大厅、创建、裁判前置、配置云字段、邀请总线、裁判台接管）

## 边界

- 大厅/邀请为实时广播 + 本地快照，未建服务端权威表；离线或跨设备需要 Supabase Realtime Broadcast。
- 编成/ban 在 UI 层暗牌，前端数据仍可被同浏览器调试读取；服务端权威隐藏留待后端迁移。
- 观战为训练场内的状态页；队伍频道码是入场凭证，不要公开分享。
