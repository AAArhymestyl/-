/* 训练场 PVP · 公告 / 规则配置（管理者可改，前端动态渲染）
 *
 * 存储双层：
 * - 本机 localStorage：离线可用、刷新不丢；
 * - 云端 world_state.settings.pvpConfig：管理者保存后全服玩家都能读到最新公告/规则。
 * 读取时按 updatedAt 取较新的一份，避免旧缓存覆盖后台新配置。
 */
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
    todayRules: "今日默认：10 血、每队 5 玩家卡 + 3 契约者卡、4 个 ban（每方 2 个）、d6 小者先手。",
    updatedAt: 0
  };

  function localConfig() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
      return raw && typeof raw === "object" ? raw : null;
    } catch (e) { return null; }
  }

  function cloudConfig() {
    try {
      const state = global.SDJPvpState && global.SDJPvpState.get ? global.SDJPvpState.get() : null;
      const cfg = state && state.settings && state.settings.pvpConfig;
      return cfg && typeof cfg === "object" ? cfg : null;
    } catch (e) { return null; }
  }

  function get() {
    const local = localConfig();
    const cloud = cloudConfig();
    if (!cloud) return Object.assign({}, DEFAULTS, local || {});
    const localAt = Number(local && local.updatedAt) || 0;
    const cloudAt = Number(cloud.updatedAt) || 0;
    return Object.assign({}, DEFAULTS, cloudAt >= localAt ? cloud : local);
  }

  function save(cfg) {
    const next = Object.assign({}, get(), cfg || {}, { updatedAt: Date.now() });
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch (e) { /* ignore */ }
    // 写入 appState.settings 后由 app 层负责落库；非管理者只保留本机配置
    try {
      const state = global.SDJPvpState && global.SDJPvpState.get ? global.SDJPvpState.get() : null;
      if (state) {
        state.settings = Object.assign({}, state.settings || {}, { pvpConfig: next });
        if (global.SDJPvpState.save) global.SDJPvpState.save();
      }
    } catch (e) { /* ignore */ }
    return next;
  }

  global.SDJPvpConfig = { KEY: KEY, defaults: DEFAULTS, get: get, save: save };
})(window);
