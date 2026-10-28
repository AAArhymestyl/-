/* 神降计划·塔 · 好友栏（密语 / 通讯录 / 群聊）回归测试
 *
 * 用法：控制台执行 `await SDJFriendsTest.run()`
 * 说明：测试前备份 sdj_social_v1 / sdj_social_msgs_v1 与双端会话，结束后原样还原。
 */
(function () {
  const A = "AAArhymestyl";   // 沙利叶（群主）
  const B = "AAAwe";          // 月影
  const C = "AAAwer";         // 血月
  const N1 = "npc_baiya";
  const N2 = "npc_moyu";
  const N3 = "npc_huijin";
  const N4 = "npc_yeying";

  const api = () => window.SDJSocial;

  async function run() {
    if (!window.SDJSocial) {
      console.warn("[好友模块回归] 未找到 SDJSocial，请确认已加载新版 app.js");
      return { passed: 0, total: 0, results: [] };
    }
    const bak1 = localStorage.getItem("sdj_social_v1");
    const bak2 = localStorage.getItem("sdj_social_msgs_v1");
    const bakSessLocal = localStorage.getItem("sdj_session");
    const bakSessTab = sessionStorage.getItem("sdj_session");
    localStorage.removeItem("sdj_social_v1");
    localStorage.removeItem("sdj_social_msgs_v1");
    // 本套用例以沙利叶（A）为当前操作者；固定身份避免在不同登录态下误判“只能移动自己的好友”
    if (window.SDJSession) window.SDJSession.set({ username: A, displayName: "沙利叶", role: "admin" });
    api().reload();

    const R = [];
    const ok = (name, cond, extra) => R.push({ name, pass: !!cond, extra: extra || "" });

    try {
      /* 预置：A 的好友 = B + 4 个 NPC（双向），避免等待 NPC 自动同意 */
      const seed = api().load();
      seed.friends[A] = [B, N1, N2, N3, N4];
      [B, N1, N2, N3, N4].forEach(u => { seed.friends[u] = [A]; });
      seed.friendSince["AAAwe|AAArhymestyl"] = Date.now();
      api().save();

      /* F1 拼音首字母 / # 回落 */
      ok("F1 拼音首字母 A-Z 与 # 回落",
        api().socialInitial("沙利叶") === "S" &&
        api().socialInitial("墨羽") === "M" &&
        api().socialInitial("夜莺") === "Y" &&
        api().socialInitial("123") === "#");

      /* F2 群号唯一 + 9 位 */
      const g1 = await api().createGroup(A, [N1, N2], "测试群一");
      const g2 = await api().createGroup(A, [N3, N4], "测试群二");
      ok("F2 群号唯一且为 9 位数字",
        g1.ok && g2.ok && g1.group.no !== g2.group.no && /^\d{9}$/.test(g1.group.no),
        g1.group.no + " / " + g2.group.no);

      /* F3 少于 2 位邀请被拒 */
      ok("F3 少于 2 位好友时拒绝创建", (await api().createGroup(A, [N1], "单人群")).ok === false);

      /* F4 组建中状态与人数 */
      ok("F4 创建后为组建中（1 人）",
        api().groupById(g1.group.id).status === "inviting" &&
        api().groupById(g1.group.id).members.length === 1);

      /* F5 全部受邀同意 → 成立（3 人） */
      api().load().groupRequests
        .filter(r => r.groupId === g1.group.id && r.status === "pending")
        .forEach(r => api().respondGroupRequest(r.id, true, r.to));
      const g1b = api().groupById(g1.group.id);
      ok("F5 全部同意后群聊成立（3 人）",
        g1b.status === "active" && g1b.members.length === 3 && g1b.activatedAt > 0);

      /* F6 拒绝导致人数不足 → 创建失败 */
      const t6 = await api().createGroup(A, [N3, N1], "会被拒绝");
      const r6 = api().load().groupRequests.filter(r => r.groupId === t6.group.id);
      api().respondGroupRequest(r6[0].id, false, r6[0].to);
      api().respondGroupRequest(r6[1].id, false, r6[1].to);
      ok("F6 拒绝后创建失败", api().groupById(t6.group.id).status === "failed");

      /* F7 邀请 24h 超时 */
      const t7 = await api().createGroup(A, [N2, N4], "超时群");
      const s7 = api().load();
      s7.groupRequests.forEach(r => {
        if (r.groupId === t7.group.id) r.createdAt = Date.now() - 25 * 3600 * 1000;
      });
      api().save();
      api().sweep();
      ok("F7 邀请 24h 未响应自动超时并失败",
        api().groupById(t7.group.id).status === "failed");

      /* F8 群搜索权限 */
      await api().setGroupPolicy(g1b.id, A, "searchable", false);
      ok("F8 不允许被搜索时无法申请", (await api().applyToGroup(g1b.id, B)).ok === false);
      await api().setGroupPolicy(g1b.id, A, "searchable", true);

      /* F9 直接加入 / 验证入群 */
      await api().setGroupPolicy(g1b.id, A, "joinMode", "direct");
      ok("F9 直接加入立即成为成员", (await api().applyToGroup(g1b.id, B)).direct === true);
      await api().setGroupPolicy(g1b.id, A, "joinMode", "verify");
      const r9 = await api().applyToGroup(g1b.id, C, "想加入");
      ok("F9b 需验证时生成待审批申请",
        r9.ok === true && r9.request && r9.request.status === "pending");

      /* F10 管理员上限 5 / 群主唯一 */
      const t10 = await api().createGroup(A, [N1, N2], "管理员上限");
      const gg = api().groupById(t10.group.id);
      gg.status = "active";
      gg.members = [A, B, C, N1, N2, N3, N4];
      api().save();
      let made = 0;
      for (const u of [B, C, N1, N2, N3, N4]) {
        const rr = await api().setGroupAdmin(gg.id, A, u, true);
        if (rr.ok) made++;
      }
      ok("F10 管理员最多 5 名", made === 5 && api().groupById(gg.id).admins.length === 5, "任命 " + made + " 名");
      ok("F10b 群主不可被设为管理员", (await api().setGroupAdmin(gg.id, A, A, true)).ok === false);

      /* F11 移除权限 */
      await api().setGroupAdmin(gg.id, A, C, false); // 卸任 C 便于验证普通成员
      ok("F11 管理员不能移除管理员", (await api().removeGroupMember(gg.id, B, N1)).ok === false);
      ok("F11b 管理员可移除普通成员", (await api().removeGroupMember(gg.id, B, N4)).ok === true);
      ok("F11c 不能移除群主", (await api().removeGroupMember(gg.id, A, A)).ok === false);

      /* F12 好友申请规则 */
      ok("F12 不能添加自己", (await api().sendFriendRequest(A, A)).ok === false);
      ok("F12b 已是好友不可重复申请", (await api().sendFriendRequest(A, B)).ok === false);
      const r12 = await api().sendFriendRequest(C, A, "我是血月");
      ok("F12c 正常好友申请可发送", r12.ok === true && r12.request.status === "pending");
      ok("F12d 重复申请被拦截", (await api().sendFriendRequest(C, A)).ok === false);

      /* F13 同意后双向 */
      const req13 = api().load().friendRequests.find(r => r.from === C && r.to === A && r.status === "pending");
      await api().respondFriendRequest(req13.id, true);
      ok("F13 同意后双方互为好友",
        api().load().friends[A].includes(C) && api().load().friends[C].includes(A));

      /* F14 分组增删与移动 */
      const tag = api().addFriendTag("回归分组");
      ok("F14 新建分组", tag.ok === true);
      api().moveFriendToTag(C, tag.tag.id);
      ok("F14b 好友移动到分组", api().load().friendTagOf[C] === tag.tag.id);
      const del = api().removeFriendTag(tag.tag.id);
      ok("F14c 删除分组后回落默认分组",
        del.ok === true && (api().load().friendTagOf[C] || "t_default") === "t_default");
      ok("F14d 默认分组不可删除", api().removeFriendTag("t_default").ok === false);

      /* F15 消息校验与落库 */
      const conv = "f:AAAwe|npc_baiya";
      ok("F15 空消息被拒", api().sendMessage(conv, A, "   ").ok === false);
      ok("F15b 超过 500 字被拒", api().sendMessage(conv, A, "字".repeat(501)).ok === false);
      ok("F15c 正常消息写入会话",
        api().sendMessage(conv, A, "回归测试").ok === true &&
        api().messages()[conv].length > 0);

      /* F16 解散与越权 */
      await api().dissolveGroup(g1b.id, A);
      ok("F16 解散后状态为 dissolved", api().groupById(g1b.id).status === "dissolved");
      ok("F16b 解散后无法申请加入", (await api().applyToGroup(g1b.id, B)).ok === false);
      ok("F16c 非群主不可解散", (await api().dissolveGroup(gg.id, B)).ok === false);

      /* F17 四分类 */
      const lists = api().groupLists(A);
      ok("F17 群聊四分类结构存在",
        ["all", "created", "managed", "joined"].every(k => Array.isArray(lists[k])));

      /* F18 权限矩阵抽样 */
      const sample = api().groupById(gg.id);
      ok("F18 权限矩阵抽样",
        api().can("invite", sample, B) === true &&
        api().can("policy", sample, B) === false &&
        api().can("dissolve", sample, A) === true &&
        api().can("quit", sample, A) === false);

      /* F19 消息归属：同一消息对不同查看者必须给出不同侧 */
      const conv19 = "f:AAArhymestyl|AAAwe";
      api().sendMessage(conv19, B, "归属测试");
      const list19 = api().messages()[conv19];
      const m19 = list19[list19.length - 1];
      ok("F19 同一消息按查看者区分归属",
        api().side(m19, B) === "me" && api().side(m19, A) === "them");
      ok("F19b 系统消息不属于任何一方",
        api().side({ type: "system", from: "sys" }, B) === "system");
      ok("F19c 未知发送者不得显示为自己",
        api().side({ from: "ghost" }, B) === "them");

      /* F20 标签页会话隔离：后登录账号不得污染当前标签页身份 */
      localStorage.setItem("sdj_session", JSON.stringify({ username: A, displayName: "沙利叶", role: "admin" }));
      sessionStorage.setItem("sdj_session", JSON.stringify({ username: B, displayName: "月影", role: "player" }));
      const curTab = window.SDJSession.current();
      ok("F20 标签页身份不被另一账号覆盖", !!curTab && curTab.username === B);
      sessionStorage.removeItem("sdj_session");
      const curFallback = window.SDJSession.current();
      ok("F20b 无标签页会话时回退最近登录", !!curFallback && curFallback.username === A);
      window.SDJSession.set({ username: C, displayName: "血月", role: "contractor" });
      ok("F20c setSession 同时写入标签页与最近登录",
        window.SDJSession.tab().username === C &&
        window.SDJSession.local().username === C &&
        window.SDJSession.current().username === C);

      /* F21 双账号并发发送：各自视角互不混淆 */
      api().sendMessage(conv19, A, "管理员消息");
      api().sendMessage(conv19, B, "玩家消息");
      const list21 = api().messages()[conv19];
      const lastAdmin = list21[list21.length - 2];
      const lastPlayer = list21[list21.length - 1];
      ok("F21 双账号并发发送互不混淆",
        api().side(lastAdmin, A) === "me" && api().side(lastAdmin, B) === "them" &&
        api().side(lastPlayer, B) === "me" && api().side(lastPlayer, A) === "them");

      /* F22 删除好友：双向解除，且不可重复删除 */
      // F20 把会话切到了血月，这里恢复为沙利叶（好友列表的实际持有者）
      window.SDJSession.set({ username: A, displayName: "沙利叶", role: "admin" });
      const r22 = await api().removeFriend(B);
      ok("F22 删除好友后双方列表同步移除",
        r22.ok === true &&
        !api().load().friends[A].includes(B) &&
        !api().load().friends[B].includes(A));
      ok("F22b 已不是好友时删除被拦截", (await api().removeFriend(B)).ok === false);

      /* F25 NPC 好友走独立存储，不再混在真实用户好友表里 */
      const s25 = api().load();
      s25.npcFriends[A] = [N1];
      api().save();
      ok("F25 NPC 好友计入好友列表", api().friendsOf(A).includes(N1));
      ok("F25b 删除 NPC 好友后从列表移除",
        (await api().removeFriend(N1)).ok === true && !api().friendsOf(A).includes(N1));

      /* F23 群设置逐字段原子更新（后写覆盖前写） */
      const r23a = await api().updateGroup(gg.id, A, "notice", "第一次公告");
      const r23b = await api().updateGroup(gg.id, A, "notice", "最后一次公告");
      ok("F23 群公告按最后写入生效",
        r23a.ok === true && r23b.ok === true &&
        api().groupById(gg.id).notice === "最后一次公告");

      /* F24 普通成员不可改群设置；管理员可改 */
      const r24 = await api().updateGroup(gg.id, C, "name", "越权改名");
      ok("F24 普通成员修改群名被拦截", r24.ok === false);
      const r24b = await api().updateGroup(gg.id, B, "name", "管理员改名成功");
      ok("F24b 群管理员可修改群名", r24b.ok === true && api().groupById(gg.id).name === "管理员改名成功");
    } catch (err) {
      ok("测试执行异常", false, err && err.message ? err.message : String(err));
    } finally {
      if (bak1 !== null) localStorage.setItem("sdj_social_v1", bak1);
      else localStorage.removeItem("sdj_social_v1");
      if (bak2 !== null) localStorage.setItem("sdj_social_msgs_v1", bak2);
      else localStorage.removeItem("sdj_social_msgs_v1");
      if (bakSessLocal !== null) localStorage.setItem("sdj_session", bakSessLocal);
      else localStorage.removeItem("sdj_session");
      if (bakSessTab !== null) sessionStorage.setItem("sdj_session", bakSessTab);
      else sessionStorage.removeItem("sdj_session");
      api().reload();
      if (window.SDJSocial && window.SDJSocial.refresh) window.SDJSocial.refresh();
    }

    const passed = R.filter(r => r.pass).length;
    console.log("[好友模块回归] " + passed + "/" + R.length + " 通过");
    R.forEach(r => console.log((r.pass ? "PASS " : "FAIL ") + r.name + (r.extra ? " | " + r.extra : "")));
    return { passed, total: R.length, results: R };
  }

  window.SDJFriendsTest = { run };
})();
