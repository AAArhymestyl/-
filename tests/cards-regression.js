/* 卡牌系统回归测试
 * 用法：控制台注入本文件后执行 `await SDJCardsTest.run()`
 * 说明：测试会临时重置 sdj_state_v1 中的 cards 字段，结束后原样还原。
 */
(function () {
  const KEY = "sdj_state_v1";

  async function run() {
    const results = [];
    const ok = (name, pass, extra) => results.push({ name, pass: !!pass, extra: extra == null ? "" : String(extra) });
    const api = window.SDJCards;
    const backup = localStorage.getItem(KEY);

    if (!api) return { passed: 0, total: 0, results: [{ name: "卡牌数据未加载", pass: false, extra: "window.SDJCards 不存在" }] };

    api.reset();
    try {
      const pt = api.roleTree("player");
      const ct = api.roleTree("contractor");

      ok("C1 玩家顶级分类为 3 组", pt.length === 3, pt.map(n => api.name(n.id)).join("/"));
      ok("C2 契约者顶级分类为 3 组", ct.length === 3, ct.map(n => api.name(n.id)).join("/"));

      const playerCounts = {
        p_normal: 32, p_special: 7, p_l1: 6, p_l2: 9, p_l3: 8, p_l4: 8,
        p_l5: 8, p_l6: 10, p_l7: 8, x_affinity: 0, x_item_limit: 0,
        p_act_reverse: 4, x_act_snow: 1, x_act_echo: 0, x_act_yb: 1
      };
      let bad = [];
      Object.keys(playerCounts).forEach(k => { if (api.count(k) !== playerCounts[k]) bad.push(k + "=" + api.count(k) + "/" + playerCounts[k]); });
      ok("C3 玩家卡池数量与清单一致", bad.length === 0, bad.join(" "));

      const contractorCounts = {
        c_normal: 16, c_special: 19, c_l1: 13, c_l2: 8, c_l3: 8,
        c_l4: 7, c_l5: 11, x_affinity: 0, x_item_limit: 0,
        c_act_reverse: 4, x_act_snow: 1, x_act_echo: 0, x_act_yb: 1
      };
      bad = [];
      Object.keys(contractorCounts).forEach(k => { if (api.count(k) !== contractorCounts[k]) bad.push(k + "=" + api.count(k) + "/" + contractorCounts[k]); });
      ok("C4 契约者卡池数量与清单一致", bad.length === 0, bad.join(" "));

      const all = [];
      pt.concat(ct).forEach(root => {
        (function walk(n) {
          if (n.type === "pool") api.cards(n.id).forEach(c => all.push(Object.assign({ pool: n.id }, c)));
          (n.children || []).forEach(walk);
        })(root);
      });
      const allowed = ["N", "R", "SR", "SSR", "SP", ""];
      ok("C5 稀有度只允许 N/R/SR/SSR/SP/待定", all.every(c => allowed.indexOf(c.rarity) >= 0),
        all.filter(c => allowed.indexOf(c.rarity) < 0).map(c => c.name + ":" + c.rarity).join(","));
      ok("C6 未定稀有度仅纪念卡 4 张", all.filter(c => !c.rarity).length === 4,
        all.filter(c => !c.rarity).map(c => c.name).join("/"));

      const dupPools = [];
      Object.keys(playerCounts).concat(Object.keys(contractorCounts)).forEach(pid => {
        const list = api.cards(pid);
        if (!list.length) return;
        const names = list.map(c => c.name);
        if (new Set(names).size !== names.length) dupPools.push(pid);
      });
      ok("C7 同一卡池内卡名唯一", dupPools.length === 0, dupPools.join(","));

      ok("C8 普通常驻卡池缺失介绍 6 张", api.pending("p_normal") === 6, api.pending("p_normal"));
      ok("C9 光明之主池缺失介绍 8 张", api.pending("p_l4") === 8, api.pending("p_l4"));
      ok("C10 往生极乐缺失介绍 1 张", api.pending("p_l1") === 1, api.pending("p_l1"));

      const first = api.cards("p_normal")[0];
      ok("C11 初始持有数量为 0", api.held("AAAwe", "p_normal", first.id) === 0, api.held("AAAwe", "p_normal", first.id));
      api.setHeld("AAAwe", "p_normal", first.id, 3);
      ok("C12 重复抽取累加持有数量", api.held("AAAwe", "p_normal", first.id) === 3, api.held("AAAwe", "p_normal", first.id));
      api.setHeld("AAAwe", "p_normal", first.id, 0);

      api.rename("p_l7", "暮山晚紫·测试名");
      ok("C13 卡池改名生效", api.name("p_l7") === "暮山晚紫·测试名", api.name("p_l7"));
      api.reset();

      const l7 = api.cards("p_l7")[0];
      api.applyEdit("p_l7", l7.id, { rarity: "N", desc: "测试介绍文本" });
      const edited = api.cards("p_l7")[0];
      ok("C14 卡牌状态与介绍可编辑", edited.rarity === "N" && edited.desc === "测试介绍文本", edited.rarity + "|" + edited.desc);
      api.reset();

      api.addCard("p_normal", { id: "test-card-1", name: "测试卡", rarity: "R", category: "身份卡", desc: "" });
      ok("C15 管理者可新增卡牌", api.count("p_normal") === 33 && api.cards("p_normal").some(c => c.name === "测试卡"), api.count("p_normal"));
      api.removeCard("p_normal", "test-card-1");
      ok("C16 管理者可删除新增卡牌", api.count("p_normal") === 32, api.count("p_normal"));

      api.removeCard("p_normal", first.id);
      ok("C17 管理者可删除原始卡牌", api.count("p_normal") === 31, api.count("p_normal"));
      api.reset();

      // 旧版占位道具迁移
      try {
        const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
        raw.bag = [{ id: "i1", name: "断裂的契约匕首" }, { id: "rw1", name: "委托奖励", owner: "AAAwe" }];
        localStorage.setItem(KEY, JSON.stringify(raw));
        api.reload();
        const bag = api.bag();
        ok("C18 旧占位道具被清理", !bag.some(x => x.id === "i1"), bag.map(x => x.id).join(","));
        ok("C19 委托奖励道具保留", bag.some(x => x.id === "rw1"), bag.map(x => x.id).join(","));
      } catch (err) {
        ok("C18 旧占位道具被清理", false, err.message);
      }

      // DOM 集成检查（背包 / 议会）
      const bagMenu = document.querySelector('.menu-item[data-id="bag"]');
      if (bagMenu) bagMenu.click();
      const bagTabs = document.querySelectorAll(".bag-tab");
      ok("C20 背包显示卡牌/道具双分类", bagTabs.length === 2 && bagTabs[0].textContent.indexOf("卡牌") >= 0 && bagTabs[1].textContent.indexOf("道具") >= 0, bagTabs.length);
      const toolsText = document.querySelector(".module-tools") ? document.querySelector(".module-tools").textContent : "";
      ok("C21 已装备标识已移除", toolsText.indexOf("已装备") < 0, toolsText);

      if (bagTabs[1]) bagTabs[1].click();
      ok("C22 道具页为只读奖励展示", !!document.querySelector(".bag-note") && !document.querySelector("[data-equip]"),
        document.querySelector(".bag-note") ? "note" : "no note");

      const cardsTab = document.querySelector('.bag-tab[data-bagtab="cards"]');
      if (cardsTab) cardsTab.click();
      const allCrumb = document.querySelector('[data-crumb="-1"]');
      if (allCrumb) allCrumb.click();
      const sess = window.SDJSession.current();
      const isAdmin = sess && sess.role === "admin";
      ok("C23 卡牌页三类顶级分类渲染", document.querySelectorAll(".card-node").length >= 3, document.querySelectorAll(".card-node").length);
      ok("C24 管理者显示玩家/契约者页签", isAdmin ? document.querySelectorAll(".card-role-tab").length === 2 : document.querySelectorAll(".card-role-tab").length === 0,
        isAdmin + "/" + document.querySelectorAll(".card-role-tab").length);

      const roleTab = document.querySelector('.card-role-tab[data-cardrole="player"]');
      if (roleTab) roleTab.click();
      const firstNode = document.querySelector('.card-node[data-open="p_series"]');
      if (firstNode) firstNode.click();
      const normalNode = document.querySelector('.card-node[data-open="p_normal"]');
      if (normalNode) normalNode.click();
      const rows = document.querySelectorAll(".card-row");
      ok("C25 进入普通常驻卡池显示 32 张", rows.length === 32, rows.length);
      ok("C26 每条卡牌显示已拥有数量", document.querySelectorAll(".card-owned").length >= 32, document.querySelectorAll(".card-owned").length);
      ok("C27 管理者卡牌行有编辑入口", isAdmin ? document.querySelectorAll("[data-editcard]").length === 32 : document.querySelectorAll("[data-editcard]").length === 0,
        isAdmin + "/" + document.querySelectorAll("[data-editcard]").length);

      const councilMenu = document.querySelector('.menu-item[data-id="council"]');
      if (councilMenu) councilMenu.click();
      const ph = document.querySelector(".placeholder-panel");
      ok("C28 议会显示等待探索开启", !!ph && ph.textContent.indexOf("等待探索开启") >= 0, ph ? ph.textContent.trim().slice(0, 30) : "missing");
    } catch (err) {
      ok("测试执行异常", false, err && err.stack ? err.stack.slice(0, 300) : String(err));
    } finally {
      if (backup !== null) localStorage.setItem(KEY, backup);
      else localStorage.removeItem(KEY);
      try { api.reload(); } catch (e) { /* ignore */ }
    }

    const passed = results.filter(r => r.pass).length;
    return { passed, total: results.length, results };
  }

  window.SDJCardsTest = { run };
})();
