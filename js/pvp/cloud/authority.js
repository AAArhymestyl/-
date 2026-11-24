/* 神降计划·塔 · PVP 云端权威适配层
 *
 * 数据源：Supabase pvp_matches / pvp_invites / pvp_match_secrets
 * 设计：
 * - 前端只读公开表，所有写入走 RPC；
 * - 本地仍保留 sdj_pvp_lobby_v1 作为渲染缓存与离线降级；
 * - 云端不可用（旧版本/未迁移/未登录）时自动退回纯本地模式。
 */
(function (global) {
  "use strict";

  const C = global.SDJCloud;
  const TEAM = global.SDJPvpTeam;
  let ready = null;

  function cloudEnabled() { return !!(C && typeof C.enabled === "function" && C.enabled()); }

  async function available() {
    if (ready !== null) return ready;
    if (!cloudEnabled() || !C.selectRows) { ready = false; return ready; }
    const r = await C.selectRows("pvp_matches", function (q) { return q.limit(1); });
    ready = !!r.ok;
    return ready;
  }

  function resetAvailability() { ready = null; }

  function clean(r) {
    const out = Object.assign({}, r || {});
    delete out.ok;
    return out;
  }

  async function list(mode) {
    const r = await C.selectRows("pvp_matches", function (q) {
      let out = q.in("status", ["waiting", "playing"])
        .order("created_at", { ascending: false })
        .limit(50);
      if (mode) out = out.eq("mode", mode);
      return out;
    });
    return r;
  }

  async function get(id) {
    const r = await C.selectRows("pvp_matches", function (q) { return q.eq("id", id).limit(1); });
    if (!r.ok) return r;
    return r.data && r.data[0] ? { ok: true, match: r.data[0] } : { ok: false, error: "对局不存在" };
  }

  async function create(name, mode) {
    const r = await C.rpc("pvp_match_create", { p_name: name, p_mode: mode });
    if (!r.ok) return r;
    return { ok: true, match: r.match || clean(r) };
  }

  async function invite(matchId, to, kind, team, role) {
    return C.rpc("pvp_invite_create", {
      p_match: matchId,
      p_to: to,
      p_kind: kind,
      p_team: team || null,
      p_role: role || null
    });
  }

  async function respond(inviteId, accept) {
    const r = await C.rpc("pvp_invite_respond", { p_invite: inviteId, p_accept: !!accept });
    if (!r.ok) return r;
    return { ok: true, accepted: !!r.accepted, match: r.match || null, invite: r.invite || null };
  }

  async function start(matchId) {
    const r = await C.rpc("pvp_match_start", { p_match: matchId });
    if (!r.ok) return r;
    return { ok: true, match: r.match || clean(r) };
  }

  async function phase(matchId, team, kind, payload) {
    const r = await C.rpc("pvp_phase_submit", {
      p_match: matchId,
      p_team: team,
      p_kind: kind,
      p_payload: payload || {}
    });
    if (!r.ok) return r;
    return {
      ok: true,
      match: r.match || null,
      team: r.team,
      kind: r.kind,
      value: r.value,
      first: r.first
    };
  }

  async function publish(matchId, publicState) {
    const r = await C.rpc("pvp_referee_publish", { p_match: matchId, p_public: publicState || {} });
    if (!r.ok) return r;
    return { ok: true, match: r.match || clean(r) };
  }

  async function enginePut(matchId, engine) {
    return C.rpc("pvp_engine_publish", { p_match: matchId, p_engine: engine });
  }

  async function engineGet(matchId) {
    const r = await C.rpc("pvp_engine_get", { p_match: matchId });
    if (!r.ok) return r;
    return { ok: true, engine: r.engine || clean(r) };
  }

  async function engineData(matchId) {
    const r = await C.rpc("pvp_engine_data", { p_match: matchId });
    if (!r.ok) return r;
    return { ok: true, data: r.data || clean(r) };
  }

  async function finish(matchId, winner) {
    const r = await C.rpc("pvp_match_finish", { p_match: matchId, p_winner: winner });
    if (!r.ok) return r;
    return { ok: true, match: r.match || clean(r) };
  }

  async function snapshot(matchId) {
    const r = await C.rpc("pvp_spectator_snapshot", { p_match: matchId });
    if (!r.ok) return r;
    return { ok: true, match: r.match || clean(r) };
  }

  async function pendingInvites(username) {
    const r = await C.selectRows("pvp_invites", function (q) {
      return q.eq("to_user", username)
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(10);
    });
    return r;
  }

  function watchLobby(onChange) {
    return C.watch("pvp_matches", onChange);
  }

  function watchMatch(id, onChange) {
    return C.watch("pvp_matches", onChange, "id=eq." + id);
  }

  function watchInvites(username, onChange) {
    return C.watch("pvp_invites", onChange, "to_user=eq." + username);
  }

  function normalizeTeams(teams) {
    const src = teams && typeof teams === "object" ? teams : {};
    const arr = function (side) {
      return Array.isArray(src[side]) ? src[side].filter(function (p) { return p && p.username; }) : [];
    };
    return { A: arr("A"), B: arr("B") };
  }

  function toLocal(server, prev) {
    if (!server || !server.id) return null;
    const pub = server.public_state && typeof server.public_state === "object" ? server.public_state : {};
    const old = prev || {};
    const rooms = old.teamRooms && old.teamRooms.A && old.teamRooms.B
      ? old.teamRooms
      : { A: TEAM.makeRoom(server.id, "A"), B: TEAM.makeRoom(server.id, "B") };
    return {
      id: server.id,
      name: server.name || old.name || "对局",
      mode: server.mode === "casual" ? "casual" : "ranked",
      status: server.status || "waiting",
      phase: server.phase || "referee",
      creator: {
        username: server.creator,
        name: (old.creator && old.creator.name) || server.creator,
        role: (old.creator && old.creator.role) || "player"
      },
      referee: server.referee || null,
      teams: normalizeTeams(server.teams),
      maxPlayers: 4,
      dice: pub.dice || (old.dice || { A: null, B: null }),
      first: pub.first || old.first || null,
      loadouts: old.loadouts || { A: null, B: null },
      bans: old.bans || { A: null, B: null },
      teamRooms: rooms,
      createdAt: Date.parse(server.created_at) || old.createdAt || Date.now(),
      deadline: server.deadline ? Date.parse(server.deadline) : null,
      engineId: server.engine_id || old.engineId || "",
      engine: old.engine || null,
      authority: "cloud",
      cloudVersion: Number(server.version) || 1,
      publicState: pub
    };
  }

  global.SDJPvpAuthority = {
    available: available,
    resetAvailability: resetAvailability,
    list: list,
    get: get,
    create: create,
    invite: invite,
    respond: respond,
    start: start,
    phase: phase,
    publish: publish,
    enginePut: enginePut,
    engineGet: engineGet,
    engineData: engineData,
    finish: finish,
    snapshot: snapshot,
    pendingInvites: pendingInvites,
    watchLobby: watchLobby,
    watchMatch: watchMatch,
    watchInvites: watchInvites,
    toLocal: toLocal
  };
})(window);
