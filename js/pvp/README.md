# PVP 模块目录

```
js/pvp/
├── core/
│   ├── engine.js      # 2v2 状态机：编成、ban、回合、技能条件、被动、伤害、结算
│   └── rank.js        # 段位、胜点、晋升献祭、计划点、碎卡、回滚、赛季统计
├── channels/
│   └── team.js        # A/B 队内频道：Supabase Broadcast / BroadcastChannel / localStorage
├── config/
│   └── training-config.js  # 本月公告、规则表、当天对局规则（管理者可改）
├── ui/
│   ├── training.js    # 训练场入口、大厅、等待、邀请、投骰/编成/ban 前置阶段
│   └── referee.js     # 裁判控制台、结算、段位/保护、队伍频道与聊天
└── README.md
```

## 入口

- 地图 → 训练场 → 「进入训练场 PVP」→ `#/training-pvp`
- 训练场三个入口：排位对局、娱乐对局、裁判控制台（仅管理者）
- 裁判控制台也可从左侧「卡牌对战」菜单进入

## 数据与存储

- 对局大厅：`localStorage.sdj_pvp_lobby_v1`，通过 `lobby-main` 频道实时广播。
- 当前裁判对局：`localStorage.sdj_pvp_match_v1`，由 `referee.js` 读取。
- 段位/锁/保护/审计：`state.pvp`（本地），计划点进入 `state.wallets`，碎卡/献祭扣减 `state.cards.holdings`。
- 公告/规则：`localStorage.sdj_pvp_config_v1`。

## 样式

- `css/pvp/referee.css`：裁判台、技能选择、段位/保护。
- `css/pvp/training.css`：训练场入口、大厅、等待、邀请、前置阶段。

## 测试

- `tests/pvp/engine-regression.js`：引擎 P1–P51
- `tests/pvp/rank-regression.js`：段位/经济 K1–K39
- `tests/run.html`：完整回归 + PVP/TP 界面烟测

## 边界

- 大厅/邀请为实时广播 + 本地快照，未建服务端权威表；离线或跨设备需要 Supabase Realtime Broadcast。
- 编成/ban 在 UI 层暗牌，前端数据仍可被同浏览器调试读取；服务端权威隐藏留待后端迁移。
