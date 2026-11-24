/* 神降计划·塔 · 训练场 PVP 专属界面（独立 UI 模块）
 * 入口：地图 · 训练场 · 进入
 * 依赖：pvp/core/engine.js、pvp/channels/team.js、pvp/config/training-config.js
 */
(function (global) {
  "use strict";

  const LOBBY_KEY = "sdj_pvp_lobby_v1";
  const E = global.SDJPvpEngine;
  const TEAM = global.SDJPvpTeam;
  const CFG = global.SDJPvpConfig;
  const MODE_LABEL = { ranked: "排位赛", casual: "娱乐赛" };
  const PHASE_LABEL = {
    referee: "等待裁判", partner: "邀请搭档", opponent: "邀请对手",
    dice: "投骰子", loadout: "卡牌道具选择", ban: "禁牌", battle: "正式对局", done: "已结束"
  };

  let ctx = null;
  let rootEl = null;
  let lobbyLink = null;
  let userLink = null;
  let view = { name: "home", mode: "ranked", matchId: "" };
  let timer = null;
  let inviteTimers = {};

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function cardUid(c) { return c && (c.uid || ((c.poolId || "") + "::" + (c.id || c.name))); }
  function withUid(c) { return Object.assign({}, c || {}, { uid: cardUid(c) }); }
  function uid(prefix) { return String(prefix || "") + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function toast(text) {
    const d = document.createElement("div");
    d.className = "tp-toast";
    d.textContent = text;
    document.body.appendChild(d);
    setTimeout(function () { d.classList.add("show"); }, 10);
    setTimeout(function () { d.classList.remove("show"); setTimeout(function () { d.remove(); }, 250); }, 2200);
  }
  function getMatch(id) { return loadLobby().matches[id] || null; }
  function takePendingMatch() {
    try {
      const raw = JSON.parse(localStorage.getItem("sdj_pvp_open_match_v1") || "null");
      localStorage.removeItem("sdj_pvp_open_match_v1");
      return raw && raw.id ? raw : null;
    } catch (e) { return null; }
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
  function publishMatch(m) {
    const data = loadLobby();
    data.matches[m.id] = clone(m);
    saveLobby(data);
    if (lobbyLink) {
      try { lobbyLink.send({ type: "match_update", match: clone(m), at: Date.now() }); } catch (e) { /* ignore */ }
    }
  }
  function mergeMatch(m) {
    if (!m || !m.id) return;
    const data = loadLobby();
    data.matches[m.id] = clone(m);
    saveLobby(data);
  }
  function currentSession() { return ctx || {}; }
  function memberOf(m, username) {
    const out = { team: "", role: "" };
    ["A", "B"].forEach(function (team) {
      (m.teams[team] || []).forEach(function (p) {
        if (p.username === username) { out.team = team; out.role = p.role; }
      });
    });
    return out;
  }
  function totalMembers(m) {
    return (m.teams.A || []).length + (m.teams.B || []).length;
  }
  function roleComplete(team) {
    return (team || []).some(function (p) { return p.role === "player"; }) &&
      (team || []).some(function (p) { return p.role === "contractor"; });
  }
  function canStart(m) {
    return !!m.referee && totalMembers(m) === 4 && roleComplete(m.teams.A) && roleComplete(m.teams.B);
  }

  async function startLinks() {
    if (!TEAM) return;
    try {
      lobbyLink = await TEAM.connect("lobby-main", onLobbyMessage);
      lobbyLink.send({ type: "lobby_sync_request", at: Date.now() });
      userLink = await TEAM.connect("user-" + currentSession().username, onUserMessage);
    } catch (e) { /* ignore */ }
  }
  function destroy() {
    if (lobbyLink) { try { lobbyLink.close(); } catch (e) {} lobbyLink = null; }
    if (userLink) { try { userLink.close(); } catch (e) {} userLink = null; }
    if (timer) { clearInterval(timer); timer = null; }
    Object.keys(inviteTimers).forEach(function (k) { clearTimeout(inviteTimers[k]); });
    inviteTimers = {};
    rootEl = null;
  }

  function onLobbyMessage(msg) {
    if (!msg || !msg.type) return;
    if (msg.type === "match_update") {
      mergeMatch(msg.match);
      if (view.name === "lobby") renderLobby();
      else if ((view.name === "waiting" || view.name === "pregame") && msg.match.id === view.matchId) render();
      return;
    }
    if (msg.type === "match_remove") {
      const data = loadLobby();
      delete data.matches[msg.id];
      saveLobby(data);
      if (view.matchId === msg.id) { view = { name: "lobby", mode: view.mode, matchId: "" }; renderLobby(); }
      return;
    }
    if (msg.type === "lobby_sync_request") {
      const data = loadLobby();
      if (lobbyLink) {
        Object.keys(data.matches).forEach(function (id) {
          try { lobbyLink.send({ type: "match_update", match: data.matches[id], at: Date.now() }); } catch (e) { /* ignore */ }
        });
      }
    }
  }

  function onUserMessage(msg) {
    if (!msg || !msg.type) return;
    // 邀请弹窗统一由 pvp/ui/invite-bus.js 处理，这里只处理“我发出的邀请”的回执
    if (msg.type === "invite_response") {
      if (msg.inviteId && inviteTimers[msg.inviteId]) {
        clearTimeout(inviteTimers[msg.inviteId]);
        delete inviteTimers[msg.inviteId];
      }
      if (msg.accepted) {
        if (msg.match) mergeMatch(msg.match);
        toast("对方已接受邀请");
        if (view.name === "waiting" || view.name === "pregame") render();
      } else {
        toast("对方拒绝了邀请");
      }
    }
  }

  function init(root, options) {
    ctx = options || {};
    rootEl = root;
    startLinks();
    if (!timer) timer = setInterval(tick, 1000);
    const pending = takePendingMatch();
    if (pending && openMatch(pending.id)) {
      /* 从邀请弹窗跳转过来，直接进入对应对局 */
    } else {
      renderHome();
    }
    global._cleanupTrainingPvp = destroy;
  }

  function tick() {
    if (view.name !== "pregame") return;
    const m = getMatch(view.matchId);
    if (!m || !m.deadline) return;
    const el = document.getElementById("tpTimer");
    if (el) {
      const left = Math.max(0, m.deadline - Date.now());
      const mm = String(Math.floor(left / 60000)).padStart(2, "0");
      const ss = String(Math.floor(left % 60000 / 1000)).padStart(2, "0");
      el.textContent = mm + ":" + ss;
    }
    if (Date.now() >= m.deadline) autoAdvance(m);
  }

  function page(inner) {
    if (!rootEl) return;
    rootEl.innerHTML = '<div class="tp-page">' + inner + "</div>";
  }
  function head(title, sub, actions) {
    return '<div class="tp-head"><div>' +
      '<button class="tp-btn ghost tp-back" data-act="back-main">← 返回主页面</button>' +
      '<div class="tp-kicker">TRAINING GROUND · PVP</div><h2>' +
      esc(title) + '</h2><div class="tp-sub">' + esc(sub || "") + '</div></div>' +
      '<div class="tp-top-actions">' + (actions || "") + "</div></div>";
  }

  function topInfoButtons() {
    return '<button class="tp-btn ghost" data-act="info" data-kind="month">本月公告</button>' +
      '<button class="tp-btn ghost" data-act="info" data-kind="rules">规则表</button>' +
      '<button class="tp-btn ghost" data-act="info" data-kind="today">当天对局规则</button>' +
      (ctx.role === "admin" ? '<button class="tp-btn ghost" data-act="config">配置</button>' : "");
  }

  function renderHome() {
    page(head("训练场 · PVP", "排位 / 娱乐 / 裁判控制台", topInfoButtons()) +
      '<div class="tp-entries">' +
      '<button class="tp-entry" data-act="entry" data-mode="ranked"><b>排位对局</b><span>计入段位 · 钻石+碎卡</span><em>RANKED</em></button>' +
      '<button class="tp-entry" data-act="entry" data-mode="casual"><b>娱乐对局</b><span>不计段位 · 只发计划点</span><em>CASUAL</em></button>' +
      '<button class="tp-entry ' + (ctx.role === "admin" ? "" : "locked") + '" data-act="referee"><b>裁判控制台</b><span>管理者专用</span><em>REFEREE</em></button>' +
      "</div>" +
      '<div class="tp-note">进入对局后默认展示大厅：等待对手的已创建对局、进行中的可观战对局。</div>');
  }

  function renderLobby() {
    const data = loadLobby();
    const list = Object.values(data.matches).filter(function (m) { return m.mode === view.mode; });
    const waiting = list.filter(function (m) { return m.status === "waiting"; });
    const playing = list.filter(function (m) { return m.status === "playing"; });
    const row = function (m) {
      return '<div class="tp-row"><div><b>' + esc(m.name) + '</b><span>' + MODE_LABEL[m.mode] +
        ' · ' + esc(m.creator.username) + ' · ' + totalMembers(m) + '/4</span></div>' +
        '<button class="tp-btn" data-act="open" data-id="' + esc(m.id) + '">' +
        (m.status === "playing" ? "观战" : "进入等待") + "</button></div>";
    };
    page(head(MODE_LABEL[view.mode] + " · 对局大厅", "实时同步等待中与进行中的对局", topInfoButtons()) +
      '<div class="tp-tabs"><button class="tp-btn ghost" data-act="back-home">返回</button><span class="tp-badge">' + MODE_LABEL[view.mode] + '</span></div>' +
      '<div class="tp-section"><div class="tp-section-title">等待对手 <em>' + waiting.length + '</em></div>' +
      (waiting.length ? waiting.map(row).join("") : '<div class="tp-empty">暂无等待中的对局</div>') + "</div>" +
      '<div class="tp-section"><div class="tp-section-title">进行中 / 可观战 <em>' + playing.length + '</em></div>' +
      (playing.length ? playing.map(row).join("") : '<div class="tp-empty">暂无进行中的对局</div>') + "</div>" +
      '<button class="tp-fab" data-act="create">＋ 创建对局</button>');
  }

  function renderWaiting() {
    const m = getMatch(view.matchId);
    if (!m) { view = { name: "lobby", mode: view.mode, matchId: "" }; return renderLobby(); }
    const member = memberOf(m, ctx.username);
    const full = totalMembers(m) >= 4;
    const canInvite = !!member.team || ctx.role === "admin";
    const roster = function (team) {
      const list = m.teams[team] || [];
      return '<div class="tp-team"><div class="tp-team-title">' + team + " 队</div>" +
        (list.length ? list.map(function (p) {
          return '<div class="tp-person"><b>' + esc(p.name || p.username) + '</b><span>' + (p.role === "player" ? "玩家" : "契约者") + "</span></div>";
        }).join("") : '<div class="tp-empty">等待加入</div>') + "</div>";
    };
    page(head("对局等待 · " + m.name, MODE_LABEL[m.mode] + " · " + (PHASE_LABEL[m.phase] || m.phase), topInfoButtons()) +
      '<div class="tp-tabs"><button class="tp-btn ghost" data-act="back-lobby">返回大厅</button><span class="tp-badge">' + totalMembers(m) + '/4</span></div>' +
      '<div class="tp-teams">' + roster("A") + roster("B") + "</div>" +
      '<div class="tp-card"><div class="tp-section-title">邀请流程</div>' +
      '<div class="tp-steps">' +
      '<div class="tp-step ' + (m.referee ? "done" : "active") + '">1 · 邀请裁判' + (m.referee ? "（" + esc(m.referee) + "）" : "") + "</div>" +
      '<div class="tp-step ' + (m.referee && totalMembers(m) >= 2 ? "done" : "") + '">2 · 邀请搭档</div>' +
      '<div class="tp-step ' + (full ? "done" : "") + '">3 · 邀请对手 / 补满队伍</div>' +
      "</div>" +
      '<div class="tp-actions">' +
      (!m.referee && (m.creator.username === ctx.username || ctx.role === "admin") ? '<button class="tp-btn primary" data-act="invite" data-kind="referee">邀请裁判</button>' : "") +
      (m.referee && canInvite && !full ? '<button class="tp-btn" data-act="invite" data-kind="partner">邀请搭档</button>' : "") +
      (m.referee && canInvite && !full ? '<button class="tp-btn" data-act="invite" data-kind="opponent">邀请对手</button>' : "") +
      (m.referee && canInvite && !full ? '<button class="tp-btn ghost" data-act="invite" data-kind="ally">邀请队友</button>' : "") +
      '<button class="tp-btn primary" data-act="start" ' + (canStart(m) ? "" : "disabled") + '>开始</button>' +
      "</div>" +
      '<div class="tp-note">' + (canStart(m)
        ? "裁判已确认、4 人满员，可以开始。"
        : (m.referee
          ? "需要双方各 1 玩家 + 1 契约者后才能开始。"
          : "请先邀请裁判并等待同意，裁判确认后才能邀请搭档与对手。")) + "</div>" +
      "</div>");
  }

  function renderPregame() {
    const m = getMatch(view.matchId);
    if (!m) { view = { name: "lobby", mode: view.mode, matchId: "" }; return renderLobby(); }
    const member = memberOf(m, ctx.username);
    const phase = m.phase;
    let body = "";
    if (phase === "dice") {
      body = '<div class="tp-card"><div class="tp-section-title">投骰子 · 每队一名代表</div><div class="tp-note">小者先手；双方完成或 3 分钟到自动投掷。</div>' +
        '<div class="tp-dice"><div><b>A 队</b><span>' + (m.dice.A || "—") + '</span><button class="tp-btn" data-act="roll" data-team="A" ' + (m.dice.A ? "disabled" : "") + '>投骰</button></div>' +
        '<div><b>B 队</b><span>' + (m.dice.B || "—") + '</span><button class="tp-btn" data-act="roll" data-team="B" ' + (m.dice.B ? "disabled" : "") + '>投骰</button></div></div></div>';
    } else if (phase === "loadout") {
      body = '<div class="tp-card"><div class="tp-section-title">卡牌 / 道具选择 · 10 分钟</div>' +
        '<div class="tp-note">双方独立暗牌选择 5 张玩家卡 + 3 张契约者卡；对手只能看到「已提交」。</div>' +
        '<div class="tp-teams">' + ["A", "B"].map(function (team) {
          const own = member.team === team || ctx.role === "admin";
          return '<div class="tp-team"><div class="tp-team-title">' + team + " 队</div>" +
            '<div class="tp-person"><b>' + (m.loadouts[team] ? "已提交" : "未提交") + "</b></div>" +
            (own && !m.loadouts[team] ? '<button class="tp-btn" data-act="loadout" data-team="' + team + '">选择编成</button>' : "") + "</div>";
        }).join("") + "</div></div>";
    } else if (phase === "ban") {
      body = '<div class="tp-card"><div class="tp-section-title">禁牌 · 5 分钟</div>' +
        '<div class="tp-note">每方禁 2 张；对局开始前不公开。</div>' +
        '<div class="tp-teams">' + ["A", "B"].map(function (team) {
          const own = member.team === team || ctx.role === "admin";
          return '<div class="tp-team"><div class="tp-team-title">' + team + " 队</div>" +
            '<div class="tp-person"><b>' + (m.bans[team] ? "已提交" : "未提交") + "</b></div>" +
            (own && !m.bans[team] ? '<button class="tp-btn" data-act="ban" data-team="' + team + '">选择 ban</button>' : "") + "</div>";
        }).join("") + "</div></div>";
    } else {
      body = '<div class="tp-card"><div class="tp-section-title">正式对局已开始</div>' +
        '<div class="tp-note">裁判控制台已接续本局。双方可通过队伍频道查看彼此选牌；裁判按先手→后手循环推进。</div>' +
        '<div class="tp-rooms">A 队频道：<code>' + esc(m.teamRooms.A) + '</code><br>B 队频道：<code>' + esc(m.teamRooms.B) + '</code></div>' +
        '<div class="tp-actions">' +
        (member.team ? '<button class="tp-btn primary" data-act="join-team" data-team="' + member.team + '" data-room="' + esc(m.teamRooms[member.team]) + '">进入本队频道</button>' : "") +
        (ctx.role === "admin" ? '<button class="tp-btn primary" data-act="referee-console">进入裁判控制台</button>' : "") + "</div></div>";
    }
    page(head("对局进行 · " + m.name, PHASE_LABEL[phase] || phase, topInfoButtons()) +
      '<div class="tp-tabs"><span class="tp-badge">剩余 <b id="tpTimer">--:--</b></span><span class="tp-badge">' + MODE_LABEL[m.mode] + '</span></div>' +
      body +
      '<div class="tp-teams">' + ["A", "B"].map(function (team) {
        return '<div class="tp-team"><div class="tp-team-title">' + team + " 队</div>" +
          (m.teams[team] || []).map(function (p) { return '<div class="tp-person"><b>' + esc(p.name || p.username) + '</b><span>' + (p.role === "player" ? "玩家" : "契约者") + "</span></div>"; }).join("") + "</div>";
      }).join("") + "</div>");
  }

  function render() {
    if (view.name === "home") return renderHome();
    if (view.name === "lobby") return renderLobby();
    if (view.name === "waiting") return renderWaiting();
    if (view.name === "pregame") return renderPregame();
    return renderHome();
  }

  /* ---------------- 创建 / 邀请 ---------------- */
  function openCreate() {
    showModal('<div class="tp-modal-title">创建对局</div>' +
      '<label class="tp-field">对局名称<input id="tpName" class="tp-input" maxlength="24" placeholder="例如：今晚训练赛"></label>' +
      '<div class="tp-note">当前模式：' + MODE_LABEL[view.mode] + '</div>' +
      '<div class="tp-modal-actions"><button class="tp-btn ghost" data-close>取消</button><button class="tp-btn primary" id="tpCreateOk">创建</button></div>',
      function (modal) {
        modal.querySelector("#tpCreateOk").onclick = function () {
          const name = String(modal.querySelector("#tpName").value || "").trim();
          if (!name) return toast("请输入对局名称");
          const m = {
            id: uid("match_"), name: name, mode: view.mode, status: "waiting", phase: "referee",
            creator: { username: ctx.username, name: ctx.displayName || ctx.username, role: ctx.role },
            referee: null,
            teams: { A: [{ username: ctx.username, name: ctx.displayName || ctx.username, role: ctx.role }], B: [] },
            maxPlayers: 4, dice: { A: null, B: null }, first: null,
            loadouts: { A: null, B: null }, bans: { A: null, B: null },
            teamRooms: { A: TEAM.makeRoom(uid("room_"), "A"), B: TEAM.makeRoom(uid("room_"), "B") },
            createdAt: Date.now(), deadline: null
          };
          publishMatch(m);
          view = { name: "waiting", mode: view.mode, matchId: m.id };
          modal.remove();
          renderWaiting();
        };
      });
  }

  function candidatesFor(kind) {
    const m = getMatch(view.matchId);
    if (!m) return [];
    const me = memberOf(m, ctx.username);
    const friendNames = (global.SDJPvpState && global.SDJPvpState.friends) ? global.SDJPvpState.friends(ctx.username) : [];
    const users = friendNames.map(function (name) {
      return global.SDJPvpState.user ? global.SDJPvpState.user(name) : { username: name, name: name, role: "player" };
    }).filter(function (u) { return u && u.username && u.username !== ctx.username; });
    if (kind === "referee") {
      const seen = {};
      const out = [];
      const add = function (a) {
        if (!a || !a.username || a.username === ctx.username || seen[a.username]) return;
        seen[a.username] = true;
        out.push({ username: a.username, name: a.displayName || a.username, role: "admin" });
      };
      if (global.SDJPvpState && global.SDJPvpState.admins) global.SDJPvpState.admins().forEach(add);
      const accounts = global.SDJPvpState && global.SDJPvpState.accounts ? global.SDJPvpState.accounts() : [];
      accounts.filter(function (a) { return a.role === "admin"; }).forEach(add);
      return out;
    }
    const used = {};
    ["A", "B"].forEach(function (t) { (m.teams[t] || []).forEach(function (p) { used[p.username] = true; }); });
    return users.filter(function (u) { return !used[u.username]; });
  }

  function openInvitePicker(kind) {
    const m = getMatch(view.matchId);
    if (!m) return;
    if (kind !== "referee" && !m.referee) return toast("请先邀请裁判并等待确认");
    const me = memberOf(m, ctx.username);
    let team = "A", role = "";
    if (kind === "partner") {
      team = me.team || "A";
      role = me.role === "player" ? "contractor" : "player";
    } else if (kind === "opponent") {
      team = "B";
    } else if (kind === "ally") {
      team = me.team || "B";
      role = me.role === "player" ? "contractor" : "player";
    }
    const list = candidatesFor(kind).filter(function (u) {
      if (kind === "referee") return true;
      if (!role) return true;
      return !u.role || u.role === role;
    });
    showModal('<div class="tp-modal-title">' + (kind === "referee" ? "邀请裁判" : kind === "opponent" ? "邀请对手" : "邀请队友") + '</div>' +
      '<div class="tp-note">' + (kind === "referee" ? "仅管理者可作为裁判。" : "从好友列表选择；对方会在 60 秒内收到邀请。") + '</div>' +
      '<div class="tp-cand">' + (list.length ? list.map(function (u) {
        return '<button class="tp-btn" data-invite="' + esc(u.username) + '" data-kind="' + kind + '" data-team="' + team + '" data-role="' + esc(role || u.role || "") + '"><b>' + esc(u.name) + '</b><span>' + esc(u.role || "") + "</span></button>";
      }).join("") : '<div class="tp-empty">没有可邀请的好友</div>') + "</div>",
      function (modal) {
        modal.querySelectorAll("[data-invite]").forEach(function (btn) {
          btn.onclick = function () {
            sendInvite(btn.dataset.invite, btn.dataset.kind, btn.dataset.team, btn.dataset.role || "");
            modal.remove();
          };
        });
      });
  }

  async function sendInvite(target, kind, team, role) {
    const m = getMatch(view.matchId);
    if (!m || !target) return;
    if (target === ctx.username) return toast("不能邀请自己");
    if (kind !== "referee" && !m.referee) return toast("请先邀请裁判并等待确认");
    if (kind !== "referee" && totalMembers(m) >= 4) return toast("对局已满员");
    const invite = {
      id: uid("inv_"), from: ctx.username, fromName: ctx.displayName || ctx.username,
      to: target, kind: kind, team: team, role: role, mode: m.mode,
      match: clone(m), at: Date.now(), expiresAt: Date.now() + 60000
    };
    try {
      const link = await TEAM.connect("user-" + target, function () {});
      link.send({ type: "invite", invite: invite });
      setTimeout(function () { try { link.close(); } catch (e) {} }, 800);
      // 60 秒内没有回执就提示重新发起；收到 invite_response 时会取消
      if (inviteTimers[invite.id]) clearTimeout(inviteTimers[invite.id]);
      inviteTimers[invite.id] = setTimeout(function () {
        delete inviteTimers[invite.id];
        toast("邀请已超过 60 秒未响应，请重新发起");
      }, 60000);
      if (link.mode && link.mode !== "cloud") {
        toast("邀请已通过本机通道发送（跨设备需双方在线云端）");
      } else {
        toast("邀请已发送，等待对方响应");
      }
    } catch (e) { toast("邀请发送失败：" + (e.message || e)); }
  }

  function openMatch(id) {
    const m = getMatch(id);
    if (!m) return false;
    view = { name: m.status === "playing" ? "pregame" : "waiting", mode: m.mode, matchId: m.id };
    render();
    return true;
  }

  /* ---------------- 前置阶段 ---------------- */
  function startMatch() {
    const m = getMatch(view.matchId);
    if (!m) return toast("对局不存在");
    if (m.status !== "waiting" || (m.phase !== "referee" && m.phase !== "partner" && m.phase !== "opponent")) {
      return toast("对局已经开始");
    }
    if (!canStart(m)) return toast("尚未满足开始条件");
    m.status = "playing";
    m.phase = "dice";
    m.dice = { A: null, B: null };
    m.deadline = Date.now() + 3 * 60 * 1000;
    publishMatch(m);
    view.name = "pregame";
    renderPregame();
  }

  function rollDice(team) {
    const m = getMatch(view.matchId);
    if (!m || m.phase !== "dice") return;
    const member = memberOf(m, ctx.username);
    if (ctx.role !== "admin" && member.team !== team) return toast("只能代表本队投骰");
    if (m.dice[team]) return;
    m.dice[team] = Math.floor(Math.random() * 6) + 1;
    publishMatch(m);
    if (m.dice.A && m.dice.B) finishDice(m);
    else renderPregame();
  }
  function finishDice(m) {
    m.first = m.dice.A < m.dice.B ? "A" : "B";
    m.phase = "loadout";
    m.deadline = Date.now() + 10 * 60 * 1000;
    publishMatch(m);
    renderPregame();
  }

  function openLoadout(team) {
    const m = getMatch(view.matchId);
    if (!m || m.phase !== "loadout") return;
    const member = memberOf(m, ctx.username);
    if (ctx.role !== "admin" && member.team !== team) return toast("只能选择本队编成");
    const playerCards = (global.SDJCards && global.SDJCards.pvpCards) ? global.SDJCards.pvpCards("player") : [];
    const contractorCards = (global.SDJCards && global.SDJCards.pvpCards) ? global.SDJCards.pvpCards("contractor") : [];
    const options = function (cards, selected) {
      return cards.map(function (c) {
        const id = cardUid(c);
        return '<option value="' + esc(id) + '" ' + (selected.indexOf(id) >= 0 ? "selected" : "") + '>' + esc(c.name) + "（" + esc(c.rarity) + "）</option>";
      }).join("");
    };
    const selects = function (role, count, cards) {
      let html = "";
      for (let i = 0; i < count; i++) {
        html += '<label class="tp-field">' + (role === "player" ? "玩家卡 " : "契约者卡 ") + (i + 1) +
          '<select class="tp-input" data-role="' + role + '" data-i="' + i + '">' + options(cards, []) + "</select></label>";
      }
      return html;
    };
    showModal('<div class="tp-modal-title">' + team + ' 队编成 · 暗牌</div>' +
      '<div class="tp-note">选择 5 张玩家卡 + 3 张契约者卡；对手只能看到已提交。</div>' +
      '<div class="tp-form-2">' + selects("player", 5, playerCards) + selects("contractor", 3, contractorCards) + "</div>" +
      '<div class="tp-modal-actions"><button class="tp-btn ghost" data-close>取消</button><button class="tp-btn primary" id="tpLoadoutOk">提交编成</button></div>',
      function (modal) {
        modal.querySelector("#tpLoadoutOk").onclick = function () {
          const pick = function (role) {
            return Array.prototype.map.call(modal.querySelectorAll('select[data-role="' + role + '"]'), function (s) { return s.value; });
          };
          const p = pick("player"), c = pick("contractor");
          if (new Set(p).size !== 5 || new Set(c).size !== 3) return toast("同一张卡不能重复占多个槽位");
          const byUid = {};
          playerCards.concat(contractorCards).forEach(function (card) { byUid[cardUid(card)] = withUid(card); });
          m.loadouts[team] = {
            player: p.map(function (id) { return byUid[id]; }).filter(Boolean),
            contractor: c.map(function (id) { return byUid[id]; }).filter(Boolean)
          };
          publishMatch(m);
          modal.remove();
          if (m.loadouts.A && m.loadouts.B) {
            m.phase = "ban"; m.deadline = Date.now() + 5 * 60 * 1000; publishMatch(m);
          }
          renderPregame();
        };
      });
  }

  function openBan(team) {
    const m = getMatch(view.matchId);
    if (!m || m.phase !== "ban") return;
    const member = memberOf(m, ctx.username);
    if (ctx.role !== "admin" && member.team !== team) return toast("只能选择本队 ban");
    const all = [];
    if (global.SDJCards && global.SDJCards.pvpCards) all.push.apply(all, global.SDJCards.pvpCards("player").concat(global.SDJCards.pvpCards("contractor")));
    const opts = all.map(function (c) { return '<option value="' + esc(cardUid(c)) + '">' + esc(c.name) + "（" + esc(c.rarity) + "）</option>"; }).join("");
    showModal('<div class="tp-modal-title">' + team + ' 队禁牌 · 2 张</div>' +
      '<div class="tp-note">对局开始前不公开。</div>' +
      '<div class="tp-form-2"><label class="tp-field">ban 1<select class="tp-input" id="tpBan1">' + opts + '</select></label>' +
      '<label class="tp-field">ban 2<select class="tp-input" id="tpBan2">' + opts + '</select></label></div>' +
      '<div class="tp-modal-actions"><button class="tp-btn ghost" data-close>取消</button><button class="tp-btn primary" id="tpBanOk">提交 ban</button></div>',
      function (modal) {
        modal.querySelector("#tpBanOk").onclick = function () {
          const a = modal.querySelector("#tpBan1").value;
          const b = modal.querySelector("#tpBan2").value;
          if (!a || !b || a === b) return toast("请选择 2 张不同的卡");
          const byUid = {};
          all.forEach(function (c) { byUid[cardUid(c)] = withUid(c); });
          m.bans[team] = [byUid[a], byUid[b]].filter(Boolean);
          publishMatch(m);
          modal.remove();
          if (m.bans.A && m.bans.B) startBattle(m);
          else renderPregame();
        };
      });
  }

  function startBattle(m) {
    if (!E || !m.loadouts.A || !m.loadouts.B) return toast("双方编成尚未完成");
    try {
      const nameOf = function (side, role) {
        const p = (m.teams[side] || []).find(function (x) { return x.role === role; });
        return p ? (p.name || p.username) : (role === "player" ? "玩家" : "契约者");
      };
      const em = E.createMatch({
        mode: m.mode,
        teams: {
          A: { label: "A 队", player: nameOf("A", "player"), contractor: nameOf("A", "contractor") },
          B: { label: "B 队", player: nameOf("B", "player"), contractor: nameOf("B", "contractor") }
        }
      });
      em.phase = "ban";
      em.order.first = m.first || "A";
      em.order.second = em.order.first === "A" ? "B" : "A";
      const bans = [];
      ["A", "B"].forEach(function (side) {
        (m.bans[side] || []).forEach(function (c) {
          bans.push({ side: side, uid: cardUid(c), name: c.name, by: side });
        });
      });
      E.submitBans(em, bans);
      E.submitLoadouts(em, {
        A: { player: m.loadouts.A.player.map(withUid), contractor: m.loadouts.A.contractor.map(withUid) },
        B: { player: m.loadouts.B.player.map(withUid), contractor: m.loadouts.B.contractor.map(withUid) }
      });
      em.teamRooms = clone(m.teamRooms);
      em.teamSelections = { A: { player: null, contractor: null }, B: { player: null, contractor: null } };
      em.teamChat = { A: [], B: [] };
      em.name = m.name;
      localStorage.setItem("sdj_pvp_match_v1", JSON.stringify(em));
      m.phase = "battle";
      m.engineId = em.id;
      m.engine = clone(em);
      m.deadline = null;
      publishMatch(m);
      renderPregame();
    } catch (e) { toast("创建对局失败：" + (e.message || e)); }
  }

  function autoAdvance(m) {
    if (m.phase === "dice") {
      if (!m.dice.A) m.dice.A = Math.floor(Math.random() * 6) + 1;
      if (!m.dice.B) m.dice.B = Math.floor(Math.random() * 6) + 1;
      finishDice(m);
    } else if (m.phase === "loadout") {
      ["A", "B"].forEach(function (team) {
        if (m.loadouts[team]) return;
        const p = global.SDJCards.pvpCards("player").slice(0, 5).map(withUid);
        const c = global.SDJCards.pvpCards("contractor").slice(0, 3).map(withUid);
        m.loadouts[team] = { player: p, contractor: c };
      });
      m.phase = "ban"; m.deadline = Date.now() + 5 * 60 * 1000; publishMatch(m); renderPregame();
    } else if (m.phase === "ban") {
      const all = global.SDJCards.pvpCards("player").concat(global.SDJCards.pvpCards("contractor"));
      ["A", "B"].forEach(function (team) {
        if (!m.bans[team]) m.bans[team] = all.slice(0, 2).map(withUid);
      });
      startBattle(m);
    }
  }

  /* ---------------- 弹窗 / 事件 ---------------- */
  function showModal(inner, onMount) {
    const modal = document.createElement("div");
    modal.className = "tp-modal";
    modal.innerHTML = '<div class="tp-modal-box">' + inner + "</div>";
    document.body.appendChild(modal);
    modal.addEventListener("click", function (e) {
      if (e.target === modal || e.target.hasAttribute("data-close")) modal.remove();
    });
    if (onMount) onMount(modal);
    return modal;
  }

  function showInfo(kind) {
    const cfg = CFG ? CFG.get() : {};
    const title = kind === "month" ? "本月公告" : kind === "rules" ? "规则表" : "当天对局规则";
    const body = kind === "month" ? cfg.monthNotice : kind === "rules" ? cfg.rulesTable : cfg.todayRules;
    showModal('<div class="tp-modal-title">' + title + '</div><pre class="tp-pre">' + esc(body || "暂无配置") + "</pre>" +
      '<div class="tp-modal-actions"><button class="tp-btn ghost" data-close>关闭</button></div>');
  }

  function showConfig() {
    if (ctx.role !== "admin") return toast("暂只有管理者可配置");
    const cfg = CFG ? CFG.get() : {};
    showModal('<div class="tp-modal-title">训练场配置</div>' +
      '<label class="tp-field">本月公告<textarea class="tp-input" id="tpCfgMonth">' + esc(cfg.monthNotice) + "</textarea></label>" +
      '<label class="tp-field">规则表<textarea class="tp-input" id="tpCfgRules">' + esc(cfg.rulesTable) + "</textarea></label>" +
      '<label class="tp-field">当天对局规则<textarea class="tp-input" id="tpCfgToday">' + esc(cfg.todayRules) + "</textarea></label>" +
      '<div class="tp-modal-actions"><button class="tp-btn ghost" data-close>取消</button><button class="tp-btn primary" id="tpCfgSave">保存</button></div>',
      function (modal) {
        modal.querySelector("#tpCfgSave").onclick = function () {
          CFG.save({
            monthNotice: modal.querySelector("#tpCfgMonth").value,
            rulesTable: modal.querySelector("#tpCfgRules").value,
            todayRules: modal.querySelector("#tpCfgToday").value
          });
          modal.remove();
          // 配置直接影响全服玩家，必须立即写云端，不能等 800ms 防抖（刷新会丢）
          if (global.SDJPvpState && global.SDJPvpState.saveNow) {
            global.SDJPvpState.saveNow().then(function (ok) {
              toast(ok === false ? "已保存到本机，云端同步失败，请重试" : "配置已保存并同步到云端");
            }).catch(function () { toast("已保存到本机，云端同步失败，请重试"); });
          } else {
            toast("配置已保存");
          }
        };
      });
  }

  function openRefereeConsole() {
    try {
      const item = document.querySelector('.menu-item[data-id="pvp"]');
      if (item) { item.click(); return; }
    } catch (e) { /* ignore */ }
    location.hash = "#/app";
    setTimeout(function () {
      const item = document.querySelector('.menu-item[data-id="pvp"]');
      if (item) item.click();
    }, 350);
  }

  function bind() {
    if (!rootEl) return;
    rootEl.addEventListener("click", function (e) {
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === "back-main") { location.hash = "#/app"; return; }
      if (act === "info") return showInfo(btn.dataset.kind);
      if (act === "config") return showConfig();
      if (act === "entry") {
        view = { name: "lobby", mode: btn.dataset.mode, matchId: "" };
        return renderLobby();
      }
      if (act === "referee") {
        if (ctx.role !== "admin") return toast("暂只有管理者可进入");
        return openRefereeConsole();
      }
      if (act === "back-home") { view = { name: "home", mode: view.mode, matchId: "" }; return renderHome(); }
      if (act === "back-lobby") { view = { name: "lobby", mode: view.mode, matchId: "" }; return renderLobby(); }
      if (act === "create") return openCreate();
      if (act === "open") {
        const m = getMatch(btn.dataset.id);
        if (!m) return toast("对局不存在");
        view = { name: m.status === "playing" ? "pregame" : "waiting", mode: m.mode, matchId: m.id };
        return render();
      }
      if (act === "invite") return openInvitePicker(btn.dataset.kind);
      if (act === "start") return startMatch();
      if (act === "roll") return rollDice(btn.dataset.team);
      if (act === "loadout") return openLoadout(btn.dataset.team);
      if (act === "ban") return openBan(btn.dataset.team);
      if (act === "referee-console") return openRefereeConsole();
      if (act === "join-team") {
        try { sessionStorage.setItem("sdj_pvp_team_room", btn.dataset.room || ""); } catch (err) { /* ignore */ }
        return openRefereeConsole();
      }
    });
  }

  global.SDJPvpTraining = {
    render: function (root, options) {
      init(root, options);
      bind();
    },
    openMatch: openMatch,
    destroy: destroy
  };
})(window);
