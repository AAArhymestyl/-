/* 神降计划·塔 · 云端同步层（Supabase）
 *
 * 用法：在 js/config.js 填入 supabaseUrl / supabaseAnonKey 即自动启用；
 *       留空则本文件整层休眠，站点仍以纯本地模式运行。
 */
(function () {
  const cfg = window.SDJ_CONFIG || {};
  const URL_BASE = String(cfg.supabaseUrl || "").replace(/\/+$/, "");
  const ANON_KEY = String(cfg.supabaseAnonKey || "");
  const SDK_CDNS = [
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm",
    "https://esm.sh/@supabase/supabase-js@2",
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm"
  ];

  let client = null;
  let profile = null;

  // ?local=1 强制本地模式：回归测试台用它避免读写线上库
  const FORCE_LOCAL = /[?&]local=1/.test(location.search);
  const enabled = () => !FORCE_LOCAL && !!(URL_BASE && ANON_KEY);
  const emailFor = (username) => `${String(username || "").toLowerCase()}@sdj.local`;

  // 多 CDN 回退：部分网络下 jsDelivr 不可达时自动切换 esm.sh
  async function loadSdk() {
    let lastErr = null;
    for (const url of SDK_CDNS) {
      try { return await import(url); } catch (e) {
        lastErr = e;
        console.warn("[云端] Supabase SDK 加载失败，尝试下一个源：", url);
      }
    }
    throw lastErr || new Error("Supabase SDK 加载失败");
  }

  async function ensureClient() {
    if (client) return client;
    const mod = await loadSdk();
    client = mod.createClient(URL_BASE, ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
    return client;
  }

  async function getSession() {
    try {
      const c = await ensureClient();
      const { data } = await c.auth.getSession();
      return data.session || null;
    } catch (e) { return null; }
  }

  async function fetchProfile(uid) {
    const c = await ensureClient();
    const { data, error } = await c.from("profiles").select("*").eq("id", uid).maybeSingle();
    if (error) throw error;
    return data || null;
  }

  async function signIn(username, password) {
    if (!enabled()) return { ok: false, error: "云端未配置" };
    try {
      const c = await ensureClient();
      const { data, error } = await c.auth.signInWithPassword({
        email: emailFor(username),
        password
      });
      if (error) return { ok: false, error: translate(error.message) };
      const p = await fetchProfile(data.user.id);
      if (!p) return { ok: false, error: "账号存在但缺少档案，请重新注册或联系管理者。" };
      profile = p;
      return { ok: true, profile: p };
    } catch (e) {
      return { ok: false, error: translate(e.message || String(e)) };
    }
  }

  async function signUp(username, displayName, password, role) {
    if (!enabled()) return { ok: false, error: "云端未配置" };
    try {
      const c = await ensureClient();
      const { data, error } = await c.auth.signUp({
        email: emailFor(username),
        password,
        options: { data: { username, display_name: displayName, role } }
      });
      if (error) return { ok: false, error: translate(error.message) };
      if (!data.session) {
        return { ok: false, error: "注册成功但需邮箱确认：请在 Supabase 后台关闭 Email Confirm，或改用真实邮箱流程。" };
      }
      const uid = data.user.id;
      const { error: pErr } = await c.from("profiles").insert({
        id: uid, username, display_name: displayName, role
      });
      if (pErr) return { ok: false, error: translate(pErr.message) };
      profile = { id: uid, username, display_name: displayName, role };
      return { ok: true, profile };
    } catch (e) {
      return { ok: false, error: translate(e.message || String(e)) };
    }
  }

  async function signOut() {
    try {
      if (!client) return;
      await client.auth.signOut();
    } catch (e) {}
    profile = null;
  }

  async function loadWorld() {
    if (!enabled()) return null;
    try {
      const c = await ensureClient();
      const { data, error } = await c.from("world_state").select("*").eq("id", 1).maybeSingle();
      if (error || !data) return null;
      return data;
    } catch (e) { return null; }
  }

  async function saveWorld(patch) {
    if (!enabled()) return;
    const c = await ensureClient();
    const { error } = await c.from("world_state").upsert(Object.assign({ id: 1, updated_at: new Date().toISOString() }, patch));
    // 以前这里忽略 error，导致列缺失/权限被拒时“看起来保存成功”，实际全服没有任何变化
    if (error) throw error;
  }

  async function loadMap() {
    const world = await loadWorld();
    if (!world || !world.map_locations) return null;
    const raw = world.map_locations;
    return typeof raw === "string" ? safeParse(raw) : raw;
  }

  async function saveMap(payload) {
    if (!enabled()) return;
    const c = await ensureClient();
    await c.from("world_state").upsert({
      id: 1,
      map_locations: payload,
      updated_at: new Date().toISOString()
    });
  }

  // 启动时恢复登录态与全服数据
  // 返回 { profile, world } 正常；{ noSession: true } 会话已失效；{ error } 网络异常
  async function boot() {
    if (!enabled()) return null;
    try {
      const session = await getSession();
      if (!session) return { noSession: true };
      let p = null;
      try { p = await fetchProfile(session.user.id); } catch (e) { p = null; }
      if (!p) return { noSession: true };
      profile = p;
      const world = await loadWorld();
      return { profile: p, world };
    } catch (e) {
      console.warn("[云端] 启动失败：", e);
      return { error: String(e.message || e) };
    }
  }

  // 会话是否仍然有效（用于长时间挂机后检测 JWT 过期/被撤销）
  async function hasSession() {
    if (!enabled()) return true;
    try {
      const c = await ensureClient();
      const { data } = await c.auth.getSession();
      if (!data || !data.session) return false;
      const { data: u, error } = await c.auth.getUser();
      if (error) {
        const msg = String(error.message || "");
        if (/fetch|network|timeout|abort/i.test(msg)) return true;  // 网络问题不算掉线
        return false;
      }
      if (!u || !u.user) return false;
      // 被移出系统的账号：即使令牌还在也立刻失权
      const p = await fetchProfile(u.user.id);
      if (p) profile = p;
      return !(p && p.banned);
    } catch (e) {
      const msg = String(e.message || e);
      return /fetch|network|timeout|abort/i.test(msg);
    }
  }

  function safeParse(text) { try { return JSON.parse(text); } catch (e) { return null; } }

  function translate(msg) {
    const m = String(msg || "");
    if (/Invalid login credentials/i.test(m)) return "账号或密码错误。";
    if (/User already registered/i.test(m)) return "该账号已注册。";
    if (/Email not confirmed/i.test(m)) return "邮箱尚未确认：请在 Supabase 关闭 Email Confirm。";
    if (/Failed to fetch|Load failed|NetworkError|net::|ERR_/i.test(m)) {
      return "无法连接云端服务（网络被屏蔽 / 代理未开启 / Supabase 项目休眠）。请切换网络后重试。";
    }
    if (/请求超时/.test(m)) {
      return "云端请求超时：可能是网络不稳定或 Supabase 项目已休眠，请稍后重试。";
    }
    if (/Could not find the function|schema cache/i.test(m)) {
      return "云端数据库缺少最新函数：请在 Supabase SQL Editor 重新执行 supabase/schema.sql。";
    }
    if (/permission denied|JWT|not authorized/i.test(m)) return "没有云端权限，请重新登录后再试。";
    return m || "云端请求失败。";
  }

  function relTime(iso) {
    if (!iso) return "刚刚";
    const sec = (Date.now() - new Date(iso).getTime()) / 1000;
    if (sec < 60) return "刚刚";
    if (sec < 3600) return Math.floor(sec / 60) + " 分钟前";
    if (sec < 86400) return Math.floor(sec / 3600) + " 小时前";
    if (sec < 172800) return "昨天";
    return Math.floor(sec / 86400) + " 天前";
  }

  const postRow = (r) => ({
    id: r.id, author: r.author, title: r.title, body: r.body,
    time: relTime(r.created_at), likes: r.likes || 0, liked: false, pinned: !!r.pinned,
    // section / author_role / views / essence 是跨设备保留版块与加精状态的关键字段
    section: r.section || "", authorRole: r.author_role || "",
    views: Number(r.views) || 0, essence: !!r.essence,
    createdAt: r.created_at ? new Date(r.created_at).getTime() : 0,
    comments: Array.isArray(r.comments) ? r.comments : [],
    likedBy: Array.isArray(r.liked_by) ? r.liked_by.map(x => x && x.username).filter(Boolean) : []
  });
  const approvalRow = (r) => ({
    id: r.id, name: r.name, role: r.role, type: r.type,
    reason: r.reason || "", time: relTime(r.created_at), status: r.status
  });

  async function listForum() {
    if (!enabled()) return null;
    try {
      const c = await ensureClient();
      const { data, error } = await c.from("forum_posts").select("*")
        .order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return (data || []).map(postRow);
    } catch (e) { console.warn("[云端] 读取论坛失败：", e); return null; }
  }

  async function addForumPost({ author, title, body, section, authorRole }) {
    if (!enabled()) return null;
    try {
      const c = await ensureClient();
      const { data: sess } = await c.auth.getSession();
      const uid = sess && sess.session ? sess.session.user.id : null;
      const payload = { author, title, body, author_id: uid };
      // 新库带 section / author_role 列；老库未执行最新 schema 时自动退回基础字段
      const extended = Object.assign({}, payload);
      if (section) extended.section = section;
      if (authorRole) extended.author_role = authorRole;
      let res = await c.from("forum_posts").insert(extended).select().single();
      if (res.error && /column .* does not exist/i.test(res.error.message || "")) {
        res = await c.from("forum_posts").insert(payload).select().single();
      }
      if (res.error) throw res.error;
      return postRow(res.data);
    } catch (e) { console.warn("[云端] 发帖失败：", e); return null; }
  }

  // 加精 / 取消加精：此前只改本地，刷新后丢失
  async function setForumEssence(id, essence) {
    if (!enabled()) return false;
    try {
      const c = await ensureClient();
      const { error } = await c.from("forum_posts").update({ essence: !!essence }).eq("id", id);
      if (error) throw error;
      return true;
    } catch (e) { console.warn("[云端] 加精失败：", e); return false; }
  }

  async function setForumLikes(id, likes) {
    if (!enabled()) return false;
    try {
      const c = await ensureClient();
      const { error } = await c.from("forum_posts").update({ likes }).eq("id", id);
      if (error) throw error;
      return true;
    } catch (e) { console.warn("[云端] 点赞失败：", e); return false; }
  }

  async function removeForumPost(id) {
    if (!enabled()) return false;
    try {
      const c = await ensureClient();
      const { error } = await c.from("forum_posts").delete().eq("id", id);
      if (error) throw error;
      return true;
    } catch (e) { console.warn("[云端] 删帖失败：", e); return false; }
  }

  // 社交快照（好友 / 群聊 / 消息）：单行 world 级快照，便于跨设备同步
  async function loadSocialSnapshot() {
    if (!enabled()) return null;
    try {
      const c = await ensureClient();
      const { data, error } = await c.from("social_state").select("*").eq("id", 1).maybeSingle();
      if (error || !data) return null;
      const raw = data.data;
      return typeof raw === "string" ? safeParse(raw) : raw;
    } catch (e) { return null; }
  }

  // 服务端合并：消息按 id 取并集，避免两台设备各自整份覆盖对方的消息
  async function saveSocialSnapshot(payload) {
    if (!enabled()) return false;
    const r = await rpc("social_merge", { p_data: payload });
    if (!r.ok) {
      console.warn("[云端] 社交合并失败：", r.error);
      return false;
    }
    // 用服务端时间戳回写，避免本机时钟偏快导致后续 pull 永远认为「没有新数据」
    return { ok: true, updatedAt: Number(r.updatedAt) || Number(payload.updatedAt) || Date.now() };
  }

  // 成员列表（含封禁 / 最高管理者标记），成员管理页使用
  async function listProfiles() {
    if (!enabled()) return null;
    try {
      const c = await ensureClient();
      const { data, error } = await c.from("profiles")
        .select("id,username,display_name,role,banned,owner,created_at")
        .order("created_at", { ascending: true });
      if (error) return null;
      return data || [];
    } catch (e) { return null; }
  }

  async function listApprovals() {
    if (!enabled()) return null;
    try {
      const c = await ensureClient();
      const { data, error } = await c.from("approvals").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []).map(approvalRow);
    } catch (e) { console.warn("[云端] 读取审批失败：", e); return null; }
  }

  async function setApprovalStatus(id, status) {
    if (!enabled()) return false;
    try {
      const c = await ensureClient();
      const { error } = await c.from("approvals").update({ status }).eq("id", id);
      if (error) throw error;
      return true;
    } catch (e) { console.warn("[云端] 更新审批失败：", e); return false; }
  }

  // 订阅某张表的变更，返回 Promise<handle>
  // 断线/心跳超时/JWT 过期时自动退避重连，避免长时间挂着页面后彻底收不到推送
  function watch(table, onChange) {
    if (!enabled()) return Promise.resolve(null);
    let closed = false;
    let attempt = 0;
    let channel = null;
    let retryTimer = null;
    let debounce = null;

    const handle = {
      async close() {
        closed = true;
        clearTimeout(retryTimer);
        clearTimeout(debounce);
        const old = channel;
        channel = null;
        if (old && client) { try { await client.removeChannel(old); } catch (e) {} }
      }
    };

    const fire = () => {
      clearTimeout(debounce);
      debounce = setTimeout(onChange, 300);
    };

    return ensureClient().then(c => {
      const connect = () => {
        if (closed) return;
        attempt += 1;
        channel = c.channel(`sdj-${table}-${Date.now()}-${attempt}`)
          .on("postgres_changes", { event: "*", schema: "public", table }, fire)
          .subscribe((status) => {
            if (closed) return;
            if (status === "SUBSCRIBED") { attempt = 0; return; }
            if (status !== "CHANNEL_ERROR" && status !== "TIMED_OUT" && status !== "CLOSED") return;
            clearTimeout(retryTimer);
            const delay = Math.min(30000, 1000 * Math.pow(2, Math.max(1, attempt)));
            retryTimer = setTimeout(() => {
              if (closed) return;
              const old = channel;
              channel = null;
              if (old) { try { c.removeChannel(old); } catch (e) {} }
              connect();
            }, delay);
          });
      };
      connect();
      return handle;
    }).catch(() => null);
  }

  async function unsubscribe(channel) {
    try {
      if (!channel) return;
      if (typeof channel.close === "function") { await channel.close(); return; }
      if (client) await client.removeChannel(channel);
    } catch (e) {}
  }

  // ---------------- 玩家动作 RPC（跨设备写入 world_state） ----------------
  const RPC_TIMEOUT_MS = 15000;
  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("请求超时（" + Math.round(ms / 1000) + " 秒）")), ms))
    ]);
  }

  async function rpc(name, params) {
    if (!enabled()) return { ok: false, error: "云端未配置" };
    try {
      const c = await ensureClient();
      const { data, error } = await withTimeout(c.rpc(name, params || {}), RPC_TIMEOUT_MS);
      if (error) return { ok: false, error: translate(error.message) };
      return Object.assign({ ok: true }, data || {});
    } catch (e) {
      return { ok: false, error: translate(e.message || String(e)) };
    }
  }

  const acceptMission = (missionId) => rpc("mission_accept", { p_mission_id: missionId });
  const submitMission = (missionId, content) =>
    rpc("mission_submit", { p_mission_id: missionId, p_content: content || "" });
  const reviewMission = (reportId, action, note) =>
    rpc("mission_review", { p_report_id: reportId, p_action: action, p_note: note || "" });
  const saveMission = (mission) => rpc("mission_save", { p_mission: mission });
  const deleteMission = (missionId) => rpc("mission_delete", { p_id: missionId });
  const worldSweep = () => rpc("world_sweep", {});
  const publishBroadcast = (text, minutes) =>
    rpc("broadcast_publish", { p_text: text, p_minutes: Number(minutes) || 60 });
  const addForumComment = (postId, text, parentId) =>
    rpc("forum_comment_add", { p_post_id: postId, p_text: text, p_parent_id: parentId || "" });
  const toggleForumLike = (postId) =>
    rpc("forum_toggle_like", { p_post_id: postId });
  const friendRequest = (to, message) =>
    rpc("social_friend_request", { p_to: to, p_message: message || "" });
  const friendRespond = (id, accept, reason) =>
    rpc("social_friend_respond", { p_id: id, p_accept: !!accept, p_reason: reason || "" });
  const groupCreate = (name, targets) =>
    rpc("social_group_create", { p_name: name || "", p_targets: targets || [] });
  const groupInvite = (groupId, targets) =>
    rpc("social_group_invite", { p_group_id: groupId, p_targets: targets || [] });
  const groupApply = (groupId, message) =>
    rpc("social_group_apply", { p_group_id: groupId, p_message: message || "" });
  const groupRespond = (id, accept, reason) =>
    rpc("social_group_respond", { p_id: id, p_accept: !!accept, p_reason: reason || "" });
  const groupQuit = (groupId) => rpc("social_group_quit", { p_group_id: groupId });
  // 群设置类操作：服务端行锁内改单个字段，避免整份快照合并互相覆盖（最后写入者生效）
  const groupUpdate = (groupId, field, value) =>
    rpc("social_group_update", { p_group_id: groupId, p_field: field, p_value: value });
  const groupPolicy = (groupId, key, value) =>
    rpc("social_group_policy", { p_group_id: groupId, p_key: key, p_value: value });
  const groupAdmin = (groupId, target, on) =>
    rpc("social_group_admin", { p_group_id: groupId, p_target: target, p_on: !!on });
  const groupRemoveMember = (groupId, target) =>
    rpc("social_group_remove_member", { p_group_id: groupId, p_target: target });
  const groupDissolve = (groupId) =>
    rpc("social_group_dissolve", { p_group_id: groupId });
  const friendRemove = (friend) =>
    rpc("social_friend_remove", { p_friend: friend });
  const banMember = (username, banned, note) =>
    rpc("member_ban", { p_username: username, p_banned: !!banned, p_note: note || "" });
  const isOwner = () => !!(profile && profile.owner);
  const submitRegistration = (username, displayName, role) =>
    rpc("registration_submit", { p_username: username, p_display_name: displayName, p_role: role });
  const registrationStatus = (username) =>
    rpc("registration_status", { p_username: username });
  const reportRegisterBypass = (username) =>
    rpc("register_bypass_report", { p_username: username || "" });
  // 管理者邀请码（审批制）：申请由服务端校验邀请码，前端拿不到码
  const adminRequest = (username, displayName, invite) =>
    rpc("admin_request_submit", { p_username: username, p_display_name: displayName, p_invite: invite });
  const adminClaim = () => rpc("admin_claim");

  // 只建 Auth 账号、不写 profiles：管理员申请获批后，档案由 admin_claim 在服务端建档
  async function signUpNoProfile(username, displayName, password) {
    if (!enabled()) return { ok: false, error: "云端未配置" };
    try {
      const c = await ensureClient();
      const { data, error } = await c.auth.signUp({
        email: emailFor(username),
        password,
        options: { data: { username, display_name: displayName, role: "admin" } }
      });
      if (error) return { ok: false, error: translate(error.message) };
      if (!data.session) {
        return { ok: false, error: "注册成功但需邮箱确认：请在 Supabase 后台关闭 Email Confirm，或改用真实邮箱流程。" };
      }
      return { ok: true, uid: data.user.id };
    } catch (e) {
      return { ok: false, error: translate(e.message || String(e)) };
    }
  }

  window.SDJCloud = {
    enabled,
    boot,
    signIn,
    signUp,
    signOut,
    loadWorld,
    saveWorld,
    loadMap,
    saveMap,
    listForum,
    addForumPost,
    setForumEssence,
    setForumLikes,
    removeForumPost,
    listProfiles,
    listApprovals,
    setApprovalStatus,
    loadSocialSnapshot,
    saveSocialSnapshot,
    acceptMission,
    submitMission,
    reviewMission,
    saveMission,
    deleteMission,
    worldSweep,
    publishBroadcast,
    addForumComment,
    toggleForumLike,
    friendRequest,
    friendRespond,
    groupCreate,
    groupInvite,
    groupApply,
    groupRespond,
    groupQuit,
    groupUpdate,
    groupPolicy,
    groupAdmin,
    groupRemoveMember,
    groupDissolve,
    friendRemove,
    banMember,
    isOwner,
    submitRegistration,
    registrationStatus,
    reportRegisterBypass,
    adminRequest,
    adminClaim,
    signUpNoProfile,
    rpc,
    watch,
    unsubscribe,
    hasSession,
    getProfile: () => profile
  };
})();
