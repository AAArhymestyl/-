/* 神降计划·塔 · 全局 PVP 邀请接收器
 *
 * 登录后常驻订阅 user-<username> 频道，无论用户当前在哪个页面，
 * 都能收到裁判 / 队友 / 对手邀请，并弹出 60 秒倒计时弹窗。
 * 同意后按角色与人数上限校验，写入本机大厅快照并广播给所有在线训练场页面。
 */
(function (global) {
  "use strict";

  const LOBBY_KEY = "sdj_pvp_lobby_v1";
  const OPEN_KEY = "sdj_pvp_open_match_v1";
  const MODE_LABEL = { ranked: "排位赛", casual: "娱乐赛" };
  const TEAM = global.SDJPvpTeam;
  const AUTH = global.SDJPvpAuthority;

  let session = null;
  let link = null;
  let cloudLink = null;
  let cloudTimer = null;
  let modal = null;
  let countdown = null;
  let startToken = 0;
  let seenRows = {};
  let shownCloudIds = {};

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function toast(text) {
    const d = document.createElement("div");
    d.className = "tp-toast";
    d.textContent = text;
    document.body.appendChild(d);
    setTimeout(function () { d.classList.add("show"); }, 10);
    setTimeout(function () {
      d.classList.remove("show");
      setTimeout(function () { d.remove(); }, 250);
    }, 2400);
  }
  function loadLobby() {
    try {
      const raw = JSON.parse(localStorage.getItem(LOBBY_KEY) || "{}");
      return { matches: raw.matches && typeof raw.matches === "object" ? raw.matches : {} };
    } catch (e) { return { matches: {} }; }
  }
  function saveLobby(data) {
    try { localStorage.setItem(LOBBY_KEY, JSON.stringify(data)); } catch (e) { /* ignore */ }
  }
  function totalMembers(m) {
    return ((m.teams && m.teams.A) || []).length + ((m.teams && m.teams.B) || []).length;
  }
  function roleComplete(team) {
    return (team || []).some(function (p) { return p.role === "player"; }) &&
      (team || []).some(function (p) { return p.role === "contractor"; });
  }
  function broadcastMatch(m) {
    if (!TEAM || !m) return;
    const data = loadLobby();
    data.matches[m.id] = clone(m);
    saveLobby(data);
    TEAM.connect("lobby-main", function () {}).then(function (channel) {
      try { channel.send({ type: "match_update", match: clone(m), at: Date.now() }); } catch (e) { /* ignore */ }
      setTimeout(function () { try { channel.close(); } catch (e) {} }, 800);
    }).catch(function () { /* ignore */ });
  }
  function respond(invite, accepted, match) {
    if (!TEAM || !invite || !invite.from) return;
    const payload = { type: "invite_response", accepted: !!accepted, match: match || invite.match, inviteId: invite.id };
    TEAM.connect("user-" + invite.from, function () {}).then(function (channel) {
      try { channel.send(payload); } catch (e) { /* ignore */ }
      setTimeout(function () { try { channel.close(); } catch (e) {} }, 800);
    }).catch(function () { /* ignore */ });
  }
  function openTraining(match) {
    try { localStorage.setItem(OPEN_KEY, JSON.stringify({ id: match.id, mode: match.mode, at: Date.now() })); } catch (e) { /* ignore */ }
    if (location.hash.indexOf("#/training-pvp") === 0 && global.SDJPvpTraining && global.SDJPvpTraining.openMatch) {
      localStorage.removeItem(OPEN_KEY);
      if (global.SDJPvpTraining.openMatch(match.id)) return;
    }
    location.hash = "#/training-pvp";
  }

  function stop() {
    startToken++;
    if (link) {
      try { link.close(); } catch (e) { /* ignore */ }
      link = null;
    }
    if (cloudLink) {
      try { cloudLink.close(); } catch (e) { /* ignore */ }
      cloudLink = null;
    }
    if (cloudTimer) { clearTimeout(cloudTimer); cloudTimer = null; }
    if (countdown) { clearInterval(countdown); countdown = null; }
    if (modal) { modal.remove(); modal = null; }
    seenRows = {};
    shownCloudIds = {};
    session = null;
  }

  async function startCloudInvites(token) {
    if (!AUTH || !AUTH.available) return;
    const ok = await AUTH.available();
    if (!ok || token !== startToken || !session) return;
    refreshCloudInvites();
    try {
      const handle = await AUTH.watchInvites(session.username, function () {
        if (cloudTimer) clearTimeout(cloudTimer);
        cloudTimer = setTimeout(refreshCloudInvites, 300);
      });
      if (token !== startToken) {
        try { handle.close(); } catch (e) { /* ignore */ }
        return;
      }
      cloudLink = handle;
    } catch (e) { /* ignore */ }
  }

  async function refreshCloudInvites() {
    if (!AUTH || !session) return;
    const r = await AUTH.pendingInvites(session.username);
    if (!r.ok) return;
    const rows = r.data || [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (seenRows[row.id]) continue;
      seenRows[row.id] = true;
      const mr = await AUTH.get(row.match_id);
      if (!mr.ok) continue;
      const m = AUTH.toLocal(mr.match);
      showInvite({
        id: "cloud_" + row.id,
        cloudId: row.id,
        authority: "cloud",
        from: row.from_user,
        fromName: row.from_name || row.from_user,
        to: row.to_user,
        kind: row.kind,
        team: row.team,
        role: row.role,
        mode: m.mode,
        match: m,
        at: Date.parse(row.created_at) || Date.now(),
        expiresAt: Date.parse(row.expires_at) || (Date.now() + 60000)
      });
    }
  }

  async function start(nextSession) {
    if (!nextSession || !nextSession.username) return stop();
    if (link && session && session.username === nextSession.username) {
      session = Object.assign({}, nextSession);
      return;
    }
    stop();
    const token = startToken;
    session = Object.assign({}, nextSession);
    if (!TEAM) return;
    try {
      const channel = await TEAM.connect("user-" + session.username, onMessage);
      if (token !== startToken || !session) {
        try { channel.close(); } catch (e) { /* ignore */ }
        return;
      }
      link = channel;
    } catch (e) {
      link = null;
    }
    startCloudInvites(token);
  }

  function onMessage(msg) {
    if (!msg || msg.type !== "invite" || !msg.invite) return;
    showInvite(msg.invite);
  }

  function showInvite(invite) {
    if (!invite || !invite.match || !session) return;
    if (invite.cloudId) {
      if (shownCloudIds[invite.cloudId]) return;
      shownCloudIds[invite.cloudId] = true;
    }
    if (Number(invite.expiresAt) && Number(invite.expiresAt) < Date.now()) return;
    if (modal) { modal.remove(); modal = null; }
    if (countdown) { clearInterval(countdown); countdown = null; }

    const label = MODE_LABEL[invite.mode] || "排位赛";
    const title = invite.kind === "referee"
      ? invite.fromName + "邀请您担任pvp" + label + "裁判"
      : invite.kind === "opponent"
        ? invite.fromName + "向你发起pvp" + label + "决斗"
        : invite.fromName + "邀请您成为队友进行pvp" + label;

    const box = document.createElement("div");
    box.className = "tp-invite";
    box.innerHTML = '<div class="tp-invite-box"><div class="tp-modal-title">' + esc(title) + "</div>" +
      '<div class="tp-invite-time">剩余 <b>60</b> 秒</div>' +
      '<div class="tp-modal-actions"><button class="tp-btn ghost" data-no>拒绝</button>' +
      '<button class="tp-btn primary" data-yes>同意</button></div></div>';
    document.body.appendChild(box);
    modal = box;

    const leftEl = box.querySelector(".tp-invite-time b");
    const tick = function () {
      const left = Math.max(0, Math.ceil((Number(invite.expiresAt) - Date.now()) / 1000));
      if (leftEl) leftEl.textContent = String(left);
      if (left <= 0) {
        clearInterval(countdown);
        countdown = null;
        box.remove();
        if (modal === box) modal = null;
        toast("邀请已超时");
      }
    };
    tick();
    countdown = setInterval(tick, 1000);

    const close = function () {
      if (countdown) { clearInterval(countdown); countdown = null; }
      box.remove();
      if (modal === box) modal = null;
    };
    box.querySelector("[data-no]").onclick = async function () {
      if (invite.cloudId && AUTH) {
        try { await AUTH.respond(invite.cloudId, false); } catch (e) { /* ignore */ }
      }
      respond(invite, false);
      close();
    };
    box.querySelector("[data-yes]").onclick = async function () {
      const ok = await acceptInvite(invite);
      if (ok) close();
    };
  }

  async function acceptInvite(invite) {
    if (!invite || !invite.match) return false;
    if (Number(invite.expiresAt) && Number(invite.expiresAt) < Date.now()) {
      toast("邀请已超时");
      return false;
    }
    if (invite.cloudId && AUTH) {
      const r = await AUTH.respond(invite.cloudId, true);
      if (!r.ok) {
        toast("加入失败：" + (r.error || "云端不可用"));
        return false;
      }
      if (!r.accepted || !r.match) {
        toast("邀请已失效");
        return false;
      }
      const m = AUTH.toLocal(r.match);
      broadcastMatch(m);
      respond(invite, true, m);
      toast("已加入对局");
      openTraining(m);
      return true;
    }
    const stored = loadLobby().matches[invite.match.id];
    const m = clone(stored || invite.match);
    m.teams = m.teams || { A: [], B: [] };

    if (invite.kind === "referee") {
      if (session.role !== "admin") {
        toast("只有管理者可以担任裁判");
        return false;
      }
      m.referee = session.displayName || session.username;
      m.phase = "partner";
    } else {
      if (!m.referee) {
        toast("请等待裁判确认后再加入");
        return false;
      }
      if (totalMembers(m) >= 4) {
        toast("哎呀，来晚一步，对局已经满员啦");
        return false;
      }
      const role = invite.role || session.role;
      if (role !== "player" && role !== "contractor") {
        toast("当前身份不能加入对局");
        return false;
      }
      if (session.role !== role) {
        toast("角色不匹配：该位置需要" + (role === "player" ? "玩家" : "契约者"));
        return false;
      }
      const team = m.teams[invite.team] || (m.teams[invite.team] = []);
      if (team.length >= 2) {
        toast("哎呀，来晚一步，对局已经满员啦");
        return false;
      }
      if (team.some(function (p) { return p.role === role; })) {
        toast("该位置已有同角色成员");
        return false;
      }
      team.push({ username: session.username, name: session.displayName || session.username, role: role });
      if (roleComplete(m.teams.A) && roleComplete(m.teams.B)) m.phase = "opponent";
    }

    broadcastMatch(m);
    respond(invite, true, m);
    toast("已加入对局");
    openTraining(m);
    return true;
  }

  global.SDJPvpInvites = { start: start, stop: stop };
})(window);
