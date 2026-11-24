/* 训练场 PVP · 公告 / 规则配置（管理者可改，前端动态渲染） */
(function (global) {
  "use strict";
  const KEY = "sdj_pvp_config_v1";
  const DEFAULTS = {
    monthNotice: "本月训练场开放 2v2 排位与娱乐赛。排位计入段位；娱乐赛不计段位、不碎卡。",
    rulesTable: [
      "每队 1 名玩家 + 1 名契约者；契约者唯一承载体。",
      "每回合每方最多 1 张玩家卡 + 1 张契约者卡。",
      "平a 为 1 点真实伤害，占用整回合。",
      "沉默状态只能空过。",
      "每张卡整场只能使用一次；同名卡可重复，受持有数量限制。",
      "钻石及以上排位败方随机碎 1 张携带卡；上锁/保护免疫。"
    ].join("\n"),
    todayRules: "今日默认：10 血、每队 5 玩家卡 + 3 契约者卡、4 个 ban（每方 2 个）、d6 小者先手。"
  };

  function get() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
      return Object.assign({}, DEFAULTS, raw && typeof raw === "object" ? raw : {});
    } catch (e) { return Object.assign({}, DEFAULTS); }
  }

  function save(cfg) {
    const next = Object.assign({}, get(), cfg || {});
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch (e) { /* ignore */ }
    return next;
  }

  global.SDJPvpConfig = { KEY: KEY, defaults: DEFAULTS, get: get, save: save };
})(window);
