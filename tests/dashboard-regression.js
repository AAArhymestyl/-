/* 主控台重构回归测试
 * 用法：控制台注入本文件后执行 `await SDJDashboardTest.run()`
 * 说明：测试会临时写入动态/广播/告警数据，结束后还原 sdj_state_v1。
 */
(function () {
  const KEY = "sdj_state_v1";
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  async function run() {
    const api = window.SDJDashboard;
    const results = [];
    const ok = (name, pass, extra) => results.push({ name, pass: !!pass, extra: extra == null ? "" : String(extra) });
    const backup = localStorage.getItem(KEY);
    if (!api) return { passed: 0, total: 0, results: [{ name: "主控台接口未加载", pass: false, extra: "" }] };

    try {
      // D1 真实日期时间
      const now = new Date();
      const txt = api.dateTimeText();
      const m = txt.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日 星期[日一二三四五六] (\d{2}):(\d{2}):(\d{2})$/);
      ok("D1 日期时间格式与真实时间一致", !!m && Number(m[1]) === now.getFullYear() && Number(m[2]) === now.getMonth() + 1 && Number(m[3]) === now.getDate(), txt);

      // D2 演示数据已清理
      const st = api.state();
      const demoLeft = [].concat(
        (st.missions || []).filter(x => ["m1", "m2", "m3", "m4"].includes(x.id)),
        (st.items || []).filter(x => String(x.id).indexOf("it_seed_") === 0),
        (st.forum || []).filter(x => ["f1", "f2", "f3"].includes(x.id)),
        (st.friends || []).filter(x => ["u1", "u2", "u3"].includes(x.id)),
        (st.council || []).filter(x => ["c1", "c2"].includes(x.id)),
        (st.codex || []).filter(x => String(x.id).indexOf("x") === 0),
        (st.members || []).filter(x => ["a1", "a2", "a3"].includes(x.id))
      );
      ok("D2 内置演示数据无残留", demoLeft.length === 0, demoLeft.length);

      // D3 动态日志按身份过滤
      const u1 = "__dash_u1";
      const u2 = "__dash_u2";
      api.pushActivity(u1, "测试动态A", "mission");
      api.pushActivity(u2, "测试动态B", "mission");
      api.pushSystemActivity("系统测试动态", "system");
      const a1 = api.activities(u1, false, 50).map(x => x.text).join("|");
      const a2 = api.activities(u2, false, 50).map(x => x.text).join("|");
      const aAdmin = api.activities(u1, true, 50).map(x => x.text).join("|");
      ok("D3 玩家只看到自己与系统动态", a1.indexOf("测试动态A") >= 0 && a1.indexOf("系统测试动态") >= 0 && a1.indexOf("测试动态B") < 0, a1.slice(0, 80));
      ok("D4 另一玩家看到自己的动态", a2.indexOf("测试动态B") >= 0 && a2.indexOf("测试动态A") < 0, a2.slice(0, 80));
      ok("D5 管理员看到全服动态", aAdmin.indexOf("测试动态A") >= 0 && aAdmin.indexOf("测试动态B") >= 0 && aAdmin.indexOf("系统测试动态") >= 0, aAdmin.slice(0, 80));

      // D6 全服广播读取
      api.state().broadcasts = [{ id: "broadcast-test", text: "测试广播内容", at: Date.now(), by: "沙利叶", minutes: 60, expiresAt: Date.now() + 3600000 }];
      api.save();
      ok("D6 主控台读取全服广播", api.broadcastText().indexOf("测试广播内容") >= 0, api.broadcastText().slice(0, 40));

      // D7 注册绕过累计 3 次触发告警
      const st2 = api.state();
      st2.registerBypass = { count: 0, users: [] };
      st2.systemAlerts = [];
      api.save();
      api.bypass("__dash_bypass");
      api.bypass("__dash_bypass");
      const before3 = api.alerts().length;
      api.bypass("__dash_bypass");
      ok("D7 未发请求直接注册累计 3 次才告警", before3 === 0 && api.alerts().length === 1 && api.alerts()[0].count === 3, "before=" + before3 + " alerts=" + api.alerts().length);
      ok("D8 告警产生未读标记", api.unreadAlerts() >= 1, api.unreadAlerts());

      // 回到主控台后再做 DOM 检查
      const dashMenu = document.querySelector('.menu-item[data-id="dashboard"]');
      if (dashMenu) dashMenu.click();
      await sleep(300);
      api.refresh();
      await sleep(300);

      const session = window.SDJSession ? window.SDJSession.current() : null;
      const isAdmin = session && session.role === "admin";
      const labels = Array.prototype.map.call(document.querySelectorAll(".data-card .card-header span"), x => x.textContent.trim());
      const cardCount = document.querySelectorAll(".data-card").length;
      ok("D9 主控台卡片数量与身份匹配", isAdmin ? cardCount === 3 : cardCount === 4, isAdmin + "/" + cardCount);
      ok("D10 管理员无塔能核心负载", isAdmin ? labels.indexOf("塔能核心负载") < 0 : true, labels.join("/"));
      ok("D11 玩家卡牌名称正确", isAdmin ? true : labels.indexOf("地图快捷入口") >= 0 && labels.indexOf("在线委托") >= 0 && labels.some(x => x.indexOf("待解锁探索") >= 0), labels.join("/"));
      ok("D12 进度环已替换为塔图", !document.querySelector(".status-ring") && !!document.querySelector(".tower-emblem img") && (document.querySelector(".tower-emblem img").naturalWidth > 0 || document.querySelector(".tower-emblem img").complete), document.querySelector(".tower-emblem img") ? document.querySelector(".tower-emblem img").naturalWidth : 0);
      ok("D13 广播滚动条已渲染", !!document.querySelector(".broadcast-marquee") && document.querySelector(".bm-track").textContent.indexOf("测试广播内容") >= 0, !!document.querySelector(".broadcast-marquee"));

      const t1 = document.querySelector("#dashClock") ? document.querySelector("#dashClock").textContent : "";
      await sleep(1100);
      const t2 = document.querySelector("#dashClock") ? document.querySelector("#dashClock").textContent : "";
      ok("D14 主控台时间每秒流动", !!t1 && !!t2 && t1 !== t2, t1 + " -> " + t2);

      const allBtn = document.querySelector("[data-activity]");
      if (allBtn) allBtn.click();
      await sleep(200);
      const logModal = document.querySelector(".activity-log-list");
      ok("D15 最近动态可查看全部", !!logModal && logModal.textContent.indexOf("系统测试动态") >= 0, !!logModal);
      const closeBtn = document.querySelector(".modal-panel [data-close]");
      if (closeBtn) closeBtn.click();

      // D16 收集图鉴占位（管理员菜单无图鉴入口，跳过）
      const codexMenu = document.querySelector('.menu-item[data-id="codex"]');
      if (codexMenu) {
        codexMenu.click();
        await sleep(250);
        const ph = document.querySelector(".placeholder-panel");
        ok("D16 收集图鉴显示等待探索开启", !!ph && ph.textContent.indexOf("等待探索开启") >= 0, ph ? ph.textContent.trim().slice(0, 20) : "missing");
        if (dashMenu) dashMenu.click();
        await sleep(250);
      } else {
        ok("D16 收集图鉴（管理员无入口，跳过）", true, "skip");
      }

      /* —— D17–D26 地图快捷入口 / 委托接取 · 提交 / 主控台计数 —— */
      if (dashMenu) { dashMenu.click(); await sleep(350); api.refresh(); await sleep(250); }
      const mapCard = document.querySelector(".map-shortcut");
      ok("D17 地图快捷入口不含接取/提交按钮", !!mapCard && !mapCard.querySelector("[data-accept]") && !mapCard.querySelector("[data-submit]"), !!mapCard);
      if (mapCard) mapCard.click();
      await sleep(700);
      const mapMenu = document.querySelector('.menu-item[data-id="map"]');
      ok("D18 地图快捷入口点击后跳转地图页", !!mapMenu && mapMenu.classList.contains("active"), mapMenu ? mapMenu.className : "missing");

      const me = session ? (session.username || session.displayName) : "";
      const mid = "test_dash_flow_" + Date.now();
      const st3 = api.state();
      st3.missions.push({
        id: mid, title: "主控台联调委托", level: "D", locationId: "area_a", loc: "A区",
        desc: "用于验证接取、提交与主控台计数的临时委托。",
        reward: { type: "points", points: 10 },
        slots: 2, acceptors: [], status: "available", deadline: null, createdAt: Date.now()
      });
      api.save();
      const missionMenu = document.querySelector('.menu-item[data-id="mission"]');
      if (missionMenu) missionMenu.click();
      await sleep(600);
      const acceptBtn = document.querySelector(`[data-accept="${mid}"]`);
      ok("D19 可接取委托显示接取按钮", !!acceptBtn, acceptBtn ? acceptBtn.textContent.trim() : "missing");
      if (acceptBtn) acceptBtn.click();
      await sleep(700);
      const mAccept = api.state().missions.find(x => x.id === mid);
      ok("D20 接取后成为接取人且未满员仍开放",
        !!mAccept && mAccept.status === "available" && (mAccept.acceptors || []).length === 1 && (mAccept.acceptors || []).some(a => a.username === me),
        mAccept ? mAccept.status + "/" + (mAccept.acceptors || []).length : "missing");
      const activeTabNow = Array.prototype.find.call(document.querySelectorAll("[data-tab]"), b => b.dataset.tab === "active");
      ok("D20b 接取后委托移入本人进行中视图",
        !!activeTabNow && activeTabNow.classList.contains("active") && !!document.querySelector(`[data-submit="${mid}"]`),
        activeTabNow ? activeTabNow.textContent.trim() : "missing");

      if (dashMenu) dashMenu.click();
      await sleep(400);
      api.refresh();
      await sleep(350);
      const online1 = Array.prototype.find.call(document.querySelectorAll(".data-card"), c => c.textContent.indexOf("在线委托") >= 0);
      ok("D21 主控台在线委托计数为 1", !!online1 && online1.querySelector(".card-value").textContent.trim() === "1", online1 ? online1.querySelector(".card-value").textContent.trim() : "missing");
      const tl1 = document.querySelector(".timeline");
      ok("D22 最近动态出现接取记录", !!tl1 && tl1.textContent.indexOf("接取委托") >= 0, tl1 ? tl1.textContent.trim().slice(0, 60) : "missing");

      if (missionMenu) missionMenu.click();
      await sleep(600);
      const activeTab = Array.prototype.find.call(document.querySelectorAll("[data-tab]"), b => b.dataset.tab === "active");
      if (activeTab) { activeTab.click(); await sleep(400); }
      const submitBtn = document.querySelector(`[data-submit="${mid}"]`);
      ok("D23 进行中委托显示提交按钮", !!submitBtn, submitBtn ? submitBtn.textContent.trim() : "missing");
      if (submitBtn) {
        submitBtn.click();
        await sleep(400);
        // 与 run.html 中的同名辅助函数保持一致（该文件作用域里拿不到，单独实现一份）
        let ta = null;
        for (let i = 0; i < 20 && !ta; i++) { ta = document.querySelector("#submitContent"); if (!ta) await sleep(100); }
        if (ta) {
          ta.value = "已完成（回归测试）";
          ta.dispatchEvent(new Event("input", { bubbles: true }));
          const cbtn = document.querySelector("#submitConfirm");
          if (cbtn) cbtn.click();
          await sleep(600);
        }
      }
      await sleep(700);
      const mSubmit = api.state().missions.find(x => x.id === mid);
      const pendingRep = (api.state().missionReports || []).find(r => r.missionId === mid && r.status === "pending");
      ok("D24 提交后委托进入待审批并生成申请", !!mSubmit && mSubmit.status === "review" && !!pendingRep, mSubmit ? mSubmit.status + "/" + !!pendingRep : "missing");

      if (dashMenu) dashMenu.click();
      await sleep(400);
      api.refresh();
      await sleep(350);
      const online2 = Array.prototype.find.call(document.querySelectorAll(".data-card"), c => c.textContent.indexOf("在线委托") >= 0);
      ok("D25 待审批委托仍计入在线委托",
        !!online2 && online2.querySelector(".card-value").textContent.trim() === "1" && online2.textContent.indexOf("待审批 1") >= 0,
        online2 ? online2.textContent.trim().replace(/\s+/g, " ").slice(0, 60) : "missing");

      const moreBtn = document.querySelector("[data-activity]");
      if (moreBtn) moreBtn.click();
      await sleep(250);
      const modalText = document.querySelector(".activity-log-list") ? document.querySelector(".activity-log-list").textContent : "";
      ok("D26 查看全部包含接取与提交记录", modalText.indexOf("接取委托") >= 0 && modalText.indexOf("提交完成申请") >= 0, modalText.replace(/\s+/g, " ").slice(0, 80));
      const close2 = document.querySelector(".modal-panel [data-close]");
      if (close2) close2.click();
    } catch (err) {
      ok("测试执行异常", false, err && err.stack ? err.stack.slice(0, 300) : String(err));
    } finally {
      if (backup !== null) localStorage.setItem(KEY, backup);
      else localStorage.removeItem(KEY);
      const dashMenu = document.querySelector('.menu-item[data-id="dashboard"]');
      if (dashMenu) dashMenu.click();
      try { api.refresh(); } catch (e) { /* ignore */ }
    }

    const passed = results.filter(r => r.pass).length;
    return { passed, total: results.length, results };
  }

  window.SDJDashboardTest = { run };
})();
