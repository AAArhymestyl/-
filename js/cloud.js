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

  const enabled = () => !!(URL_BASE && ANON_KEY);
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
    await c.from("world_state").upsert(Object.assign({ id: 1, updated_at: new Date().toISOString() }, patch));
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
  async function boot() {
    if (!enabled()) return null;
    try {
      const session = await getSession();
      if (!session) return null;
      let p = null;
      try { p = await fetchProfile(session.user.id); } catch (e) { p = null; }
      if (!p) return null;
      profile = p;
      const world = await loadWorld();
      return { profile: p, world };
    } catch (e) {
      console.warn("[云端] 启动失败：", e);
      return null;
    }
  }

  function safeParse(text) { try { return JSON.parse(text); } catch (e) { return null; } }

  function translate(msg) {
    const m = String(msg || "");
    if (/Invalid login credentials/i.test(m)) return "账号或密码错误。";
    if (/User already registered/i.test(m)) return "该账号已注册。";
    if (/Email not confirmed/i.test(m)) return "邮箱尚未确认：请在 Supabase 关闭 Email Confirm。";
    if (/Failed to fetch/i.test(m)) return "无法连接云端，请检查网络或 Supabase 配置。";
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
    time: relTime(r.created_at), likes: r.likes || 0, liked: false, pinned: !!r.pinned
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

  async function addForumPost({ author, title, body }) {
    if (!enabled()) return null;
    try {
      const c = await ensureClient();
      const { data: sess } = await c.auth.getSession();
      const uid = sess && sess.session ? sess.session.user.id : null;
      const { data, error } = await c.from("forum_posts")
        .insert({ author, title, body, author_id: uid })
        .select().single();
      if (error) throw error;
      return postRow(data);
    } catch (e) { console.warn("[云端] 发帖失败：", e); return null; }
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

  async function saveSocialSnapshot(payload) {
    if (!enabled()) return false;
    try {
      const c = await ensureClient();
      const { error } = await c.from("social_state").upsert({
        id: 1,
        data: payload,
        updated_at: new Date().toISOString()
      });
      if (error) throw error;
      return true;
    } catch (e) { console.warn("[云端] 社交快照保存失败：", e); return false; }
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

  // 订阅某张表的变更，返回 Promise<channel>
  function watch(table, onChange) {
    if (!enabled()) return Promise.resolve(null);
    let timer = null;
    return ensureClient().then(c => {
      const channel = c.channel(`sdj-${table}-${Date.now()}`)
        .on("postgres_changes", { event: "*", schema: "public", table }, () => {
          clearTimeout(timer);
          timer = setTimeout(onChange, 300);
        })
        .subscribe();
      return channel;
    }).catch(() => null);
  }

  async function unsubscribe(channel) {
    if (!channel || !client) return;
    try { await client.removeChannel(channel); } catch (e) {}
  }

  // ---------------- 玩家动作 RPC（跨设备写入 world_state） ----------------
  async function rpc(name, params) {
    if (!enabled()) return { ok: false, error: "云端未配置" };
    try {
      const c = await ensureClient();
      const { data, error } = await c.rpc(name, params || {});
      if (error) return { ok: false, error: translate(error.message) };
      return Object.assign({ ok: true }, data || {});
    } catch (e) {
      return { ok: false, error: translate(e.message || String(e)) };
    }
  }

  const acceptMission = (missionId) => rpc("mission_accept", { p_mission_id: missionId });
  const submitMission = (missionId) => rpc("mission_submit", { p_mission_id: missionId });
  const submitRegistration = (username, displayName, role) =>
    rpc("registration_submit", { p_username: username, p_display_name: displayName, p_role: role });
  const registrationStatus = (username) =>
    rpc("registration_status", { p_username: username });

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
    setForumLikes,
    removeForumPost,
    listApprovals,
    setApprovalStatus,
    loadSocialSnapshot,
    saveSocialSnapshot,
    acceptMission,
    submitMission,
    submitRegistration,
    registrationStatus,
    rpc,
    watch,
    unsubscribe,
    getProfile: () => profile
  };
})();
