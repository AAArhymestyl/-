# PVP 模块目录

```
js/pvp/
├── core/
│   ├── engine.js      # 2v2 状态机：编成、ban、回合、技能条件、被动、伤害、结算
│   └── rank.js        # 段位、胜点、晋升献祭、计划点、碎卡、回滚、赛季统计
├── channels/
│   └── team.js        # A/B 队内频道：Supabase Broadcast / BroadcastChannel / localStorage
├── cloud/
│   └── authority.js   # 云端权威适配：RPC、Realtime、观战快照、本地降级
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

- 云端权威：`pvp_matches`（公开状态）、`pvp_match_secrets`（编成/禁牌/引擎，RLS 限制）、`pvp_invites`（邀请）、`pvp_actions`（流水）；迁移见 `supabase/pvp_authority_v1.sql`。
- 所有写入走 `security definer` RPC；前端只读公开表，观战订阅 `pvp_matches` 的 Postgres Changes。
- 对局大厅：`localStorage.sdj_pvp_lobby_v1`，通过 `lobby-main` 频道实时广播；云端可用时自动合并 `pvp_matches`。
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
- `tests/run.html`：完整回归 + PVP/TP 界面烟测（TP1–TP20：入口、权限、大厅、创建、裁判前置、配置云字段、邀请总线、裁判台接管、云端适配层、本地降级）

## 边界

- `SDJPvpAuthority.available()` 会自动探测云端表：未迁移/未登录/`?local=1` 时退回纯本地模式。
- 云端对局由服务端校验成员、角色、人数、阶段与截止时间；编成/禁牌存在 secrets 表，敌方玩家读不到。
- 正式对局引擎仍由裁判浏览器构建（`pvp_engine_data` 提供双方暗牌），构建后通过 `pvp_engine_publish` 回存。
- 观战页订阅 `pvp_matches.public_state`，只显示血量、回合、状态、公开日志与已公开禁牌。
- 队伍频道码是入场凭证，不要公开分享。
