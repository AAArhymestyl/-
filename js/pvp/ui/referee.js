/* 神降计划·塔 · PVP 裁判控制台 UI（2v2）
 * 依赖：window.SDJPvpEngine、window.SDJCards
 * 仅管理者可开局；玩家/契约者端显示等待提示。
 */
(function (global) {
  "use strict";

  const E = global.SDJPvpEngine;
  const R = global.SDJPvpRank;
  const AUTH = global.SDJPvpAuthority;
  const STORE_KEY = "sdj_pvp_match_v1";
  const DRAFT_KEY = "sdj_pvp_draft_v1";
  const TEAM_ROOM_KEY = "sdj_pvp_team_room";
  let rootEl = null;
  let ctx = {};
  let match = null;
  let draft = null;
  const teamLinks = { A: null, B: null };
  const teamConnected = { A: "", B: "" };
  let teamSession = null;
  let teamSnapshot = null;
  let teamMessages = [];
  let teamPartnerSelection = null;
  let teamSelection = { uid: "", abilityIds: [], hidden: false, confirmNarrative: false };
  let lobbyLink = null;
  let cloudLobbyLink = null;
  let cloudRefreshTimer = null;
  let cloudPublishTimer = null;
  let cloudFinished = false;
  const lobbyMatches = {};

  /* ---------------- DOM 工具 ---------------- */
  function h(tag, attrs) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (k === "class") node.className = attrs[k];
        else if (k === "text") node.textContent = attrs[k];
        else if (k === "html") node.innerHTML = attrs[k];
        else if (k.indexOf("on") === 0 && typeof attrs[k] === "function") node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] != null) node.setAttribute(k, attrs[k]);
      }
    }
    for (let i = 2; i < arguments.length; i++) append(node, arguments[i]);
    return node;
  }

  function append(node, child) {
    if (child == null) return;
    if (Array.isArray(child)) { child.forEach(function (c) { append(node, c); }); return; }
    if (typeof child === "string" || typeof child === "number") {
      node.appendChild(document.createTextNode(String(child)));
    } else {
      node.appendChild(child);
    }
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function flash(msg, type) {
    if (!rootEl) return;
    const old = rootEl.querySelector(".pvp-flash");
    if (old) old.remove();
    const b = h("div", { class: "pvp-flash " + (type || "error"), text: msg });
    rootEl.insertBefore(b, rootEl.firstChild);
    setTimeout(function () { if (b.isConnected) b.remove(); }, 4200);
  }

  /* ---------------- 数据 ---------------- */
  function cardUid(c) {
    return c.uid || ((c.poolId || "") + "::" + (c.id || c.name));
  }

  function pvpCards(role) {
    if (!global.SDJCards || typeof global.SDJCards.pvpCards !== "function") return [];
    return global.SDJCards.pvpCards(role) || [];
  }

  function allPvpCards() {
    return pvpCards("player").concat(pvpCards("contractor"));
  }

  function toEngineCard(c) {
    return {
      uid: cardUid(c),
      id: c.id,
      poolId: c.poolId,
      poolName: c.poolName,
      name: c.name,
      rarity: c.rarity,
      side: c.role,
      desc: c.desc,
      tags: c.pvpTags || {},
      ir: c.pvpIR || null
    };
  }

  function tagSummary(c) {
    const t = c.pvpTags || c.tags || {};
    const out = [];
    if (t.buff) out.push("增益");
    if (t.shelterType) out.push({ cleanse: "解控", untargetable: "无法选中", damage_immune: "免伤" }[t.shelterType] || t.shelterType);
    if (t.passive) out.push("被动");
    if (t.summon) out.push("召唤");
    if (t.ongoingEffect) out.push("持续");
    if (t.trueDamage) out.push("真伤");
    if (t.bodyTarget) out.push("肉体");
    if (t.bodyBuff) out.push("身体强化");
    return out.join(" / ") || "—";
  }

  function irOf(c) {
    return (c && c.ir && c.ir.pvp) ? c.ir.pvp : null;
  }

  function irSummary(c) {
    const ir = irOf(c);
    if (!ir) return "";
    const out = [];
    if (ir.damage) out.push("伤害 " + ir.damage);
    if (ir.trueDamage) out.push("真伤");
    if (ir.buff) out.push("增益 +" + ir.buff.value);
    if (ir.control) out.push((ir.control.label || "控制") + " " + ir.control.rounds + "R");
    if (ir.shelter) {
      const label = { cleanse: "解控", untargetable: "无法选中", damage_immune: "免伤" }[ir.shelter.type] || ir.shelter.type;
      out.push(label + " " + ir.shelter.rounds + "R");
    }
    if (ir.ongoing) out.push((ir.ongoing.kind === "heal" ? "持续治疗" : "持续伤害") + " " + ir.ongoing.amount + "×" + ir.ongoing.rounds);
    if (ir.summon) out.push("召唤 " + ir.summon.count);
    if (ir.heal) out.push("治疗 " + ir.heal);
    if (ir.shield) out.push("护盾 " + ir.shield.amount);
    if (ir.selfDamage) out.push("自伤 " + ir.selfDamage);
    if (ir.narrative) out.push("叙事");
    return out.join(" · ");
  }

  function abilityFields(ability) {
    const out = {
      damage: 0, trueDamage: false, control: null, controlRounds: 1,
      ongoing: null, heal: 0, shield: 0, selfDamage: 0, narrative: !!ability.narrative
    };
    (ability.steps || []).forEach(function (s) {
      if (s.op === "DEAL_DAMAGE") { out.damage += Number(s.amount) || 0; if (s.trueDamage) out.trueDamage = true; }
      else if (s.op === "APPLY_CONTROL") { out.control = s; out.controlRounds = s.rounds || 1; }
      else if (s.op === "ADD_ONGOING") { out.ongoing = s; }
      else if (s.op === "HEAL") { out.heal += Number(s.amount) || 0; }
      else if (s.op === "GRANT_SHIELD") { out.shield += Number(s.amount) || 0; }
      else if (s.op === "SELF_DAMAGE") { out.selfDamage += Number(s.amount) || 0; }
      else if (s.op === "NARRATIVE") { out.narrative = true; }
    });
    return out;
  }

  /* ---------------- 持久化 ---------------- */
  function loadMatch() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? E.deserialize(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveMatch() {
    if (!match) return;
    try { localStorage.setItem(STORE_KEY, E.serialize(match)); } catch (e) { /* ignore */ }
    scheduleCloudPublish();
  }

  function publicStateOf(m) {
    const bans = { A: [], B: [] };
    (m.bans || []).forEach(function (b) {
      if (b && bans[b.side]) bans[b.side].push({ uid: b.uid, name: b.name });
    });
    return {
      phase: m.phase,
      round: Number(m.round) || 0,
      turnSide: m.turn ? m.turn.side : null,
      hp: { A: m.teams.A.hp, B: m.teams.B.hp },
      statuses: { A: m.teams.A.statuses, B: m.teams.B.statuses },
      log: (m.log || []).slice(-20).map(function (l) { return l.text; }),
      winner: m.winner || null,
      revealBans: true,
      bans: bans
    };
  }

  function scheduleCloudPublish() {
    if (!AUTH || !match || match.authority !== "cloud") return;
    if (match.phase !== "battle" && !match.winner) return;
    if (cloudPublishTimer) clearTimeout(cloudPublishTimer);
    cloudPublishTimer = setTimeout(function () {
      cloudPublishTimer = null;
      if (!match || match.authority !== "cloud") return;
      if (match.winner && !cloudFinished) {
        cloudFinished = true;
        AUTH.finish(match.id, match.winner).catch(function () { cloudFinished = false; });
      }
      if (match.phase !== "battle") return;
      AUTH.publish(match.id, publicStateOf(match)).catch(function () { /* ignore */ });
    }, 400);
  }

  function emptyDraft() {
    return { A: { player: [], contractor: [] }, B: { player: [], contractor: [] } };
  }

  function loadDraft() {
    if (draft) return draft;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      draft = raw ? JSON.parse(raw) : emptyDraft();
    } catch (e) { draft = emptyDraft(); }
    draft.A = draft.A || { player: [], contractor: [] };
    draft.B = draft.B || { player: [], contractor: [] };
    return draft;
  }

  function saveDraft() {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft || emptyDraft())); } catch (e) { /* ignore */ }
  }

  function clearAll() {
    match = null;
    draft = null;
    try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ }
  }

  /* ---------------- 队内频道 / 裁判侧 ---------------- */
  function ensureTeamRooms() {
    if (!match || !global.SDJPvpTeam) return;
    let changed = false;
    if (!match.teamRooms || typeof match.teamRooms !== "object") { match.teamRooms = {}; changed = true; }
    ["A", "B"].forEach(function (side) {
      if (!match.teamRooms[side]) {
        match.teamRooms[side] = global.SDJPvpTeam.makeRoom(match.id, side);
        changed = true;
      }
    });
    if (!match.teamSelections || typeof match.teamSelections !== "object") {
      match.teamSelections = { A: { player: null, contractor: null }, B: { player: null, contractor: null } };
      changed = true;
    }
    if (!match.teamChat || typeof match.teamChat !== "object") {
      match.teamChat = { A: [], B: [] };
      changed = true;
    }
    if (changed) saveMatch();
  }

  function connectRefTeams() {
    if (!match || !global.SDJPvpTeam) return;
    ensureTeamRooms();
    ["A", "B"].forEach(function (side) {
      const room = match.teamRooms[side];
      if (teamLinks[side] && teamConnected[side] === room) return;
      if (teamLinks[side]) {
        try { teamLinks[side].close(); } catch (e) { /* ignore */ }
        teamLinks[side] = null;
      }
      teamConnected[side] = room;
      global.SDJPvpTeam.connect(room, function (msg) { handleRefMessage(side, msg); }).then(function (link) {
        teamLinks[side] = link;
        publishTeamSnapshot(side);
      }).catch(function () { /* ignore */ });
    });
  }

  function handleRefMessage(side, msg) {
    if (!msg || !msg.type) return;
    if (msg.type === "hello" || msg.type === "sync_request") {
      publishTeamSnapshot(side);
      return;
    }
    if (msg.type === "selection") {
      if (msg.role !== "player" && msg.role !== "contractor") return;
      match.teamSelections[side][msg.role] = msg;
      saveMatch();
      render(rootEl, ctx);
      return;
    }
    if (msg.type === "chat") {
      match.teamChat[side].push(msg);
      if (match.teamChat[side].length > 200) match.teamChat[side].shift();
      saveMatch();
      render(rootEl, ctx);
    }
  }

  function publishTeamSnapshot(side) {
    const link = teamLinks[side];
    if (!link || !match) return;
    try {
      link.send({
        type: "snapshot",
        snapshot: global.SDJPvpTeam.publicSnapshot(match, side),
        chat: (match.teamChat[side] || []).slice(-50),
        selections: clone(match.teamSelections[side] || {}),
        at: Date.now()
      });
    } catch (e) { /* ignore */ }
  }

  function publishAllTeamSnapshots() {
    ["A", "B"].forEach(publishTeamSnapshot);
  }

  function applyTeamSelection(side, role) {
    const sel = match.teamSelections[side] && match.teamSelections[side][role];
    if (!sel) return flash("该位置暂无队内选择", "info");
    const team = match.teams[side];
    const card = (team.loadout[role] || []).find(function (c) { return c.uid === sel.uid; });
    if (!card) return flash("队内选择的卡牌不在编成中");
    const active = E.cardAbilities(card).filter(function (a) { return a.trigger === "ACTIVE"; });
    if (active.length && (!sel.abilityIds || !sel.abilityIds.length)) return flash("该队内选择未勾选任何技能");
    try {
      E.playCard(match, side, role, sel.uid, {
        abilityIds: sel.abilityIds,
        hidden: !!sel.hidden,
        confirmNarrative: !!sel.confirmNarrative
      });
      match.teamSelections[side][role] = null;
      saveMatch();
      publishTeamSnapshot(side);
      render(rootEl, ctx);
    } catch (e) { flash(e.message || String(e)); }
  }

  /* ---------------- 页面入口 ---------------- */
  function render(container, opts) {
    rootEl = container;
    ctx = opts || {};
    container.innerHTML = "";
    if (!E) {
      container.appendChild(h("div", { class: "pvp-page" },
        h("div", { class: "pvp-card" }, h("div", { class: "pvp-card-title" }, "对战引擎未加载"))));
      return;
    }
    if (ctx.role !== "admin") {
      renderPlayerNotice();
      return;
    }
    connectLobby();
    match = loadMatch();
    if (!match) { renderSetup(); return; }
    if (match.phase === "roll") { renderSetup(); return; }
    ensureTeamRooms();
    if (match.phase === "ban") { renderBan(); return; }
    if (match.phase === "loadout") { renderLoadout(); return; }
    if (match.phase === "battle") { renderBattle(); return; }
    renderEnd();
  }

  function pageHead(title, sub) {
    return h("div", { class: "pvp-head" },
      h("div", null,
        h("div", { class: "pvp-title" }, title),
        h("div", { class: "pvp-sub" }, sub || "")
      ),
      h("div", { class: "pvp-head-actions" },
        R ? h("button", { class: "pvp-btn ghost", onclick: function () { openRankModal(ctx.username || ""); } }, "段位与保护") : null,
        h("button", { class: "pvp-btn ghost", onclick: exportMatch }, "导出对局"),
        h("button", { class: "pvp-btn danger", onclick: function () {
          if (confirm("确定清空当前对局？此操作不可撤销。")) { clearAll(); render(rootEl, ctx); }
        } }, "清空对局")
      )
    );
  }

  function renderPlayerNotice() {
    if (!global.SDJPvpTeam) {
      rootEl.appendChild(h("div", { class: "pvp-page" },
        h("div", { class: "pvp-card" },
          h("div", { class: "pvp-card-title" }, "队伍频道未加载"),
          h("div", { class: "pvp-note" }, "请确认 js/pvp/channels/team.js 已加载。"))
      ));
      return;
    }
    const saved = sessionStorage.getItem(TEAM_ROOM_KEY);
    if (saved && !teamSession) {
      renderTeamWaiting("正在连接队伍频道…");
      joinTeam(saved, true);
      return;
    }
    if (teamSession && teamSnapshot) { renderTeamView(); return; }
    if (teamSession) { renderTeamWaiting("已连接，等待裁判同步对局…"); return; }
    renderTeamJoin();
  }

  function renderTeamJoin() {
    rootEl.appendChild(h("div", { class: "pvp-page" },
      h("div", { class: "pvp-head" }, h("div", null,
        h("div", { class: "pvp-title" }, "卡牌对战 · 队伍频道"),
        h("div", { class: "pvp-sub" }, "同队玩家与契约者共用一个频道；裁判可见聊天，敌对方不可见")
      )),
      h("div", { class: "pvp-card" },
        h("div", { class: "pvp-card-title" }, "加入队伍"),
        h("div", { class: "pvp-note" }, "向裁判获取你所在队伍的频道码（A 队或 B 队）。加入后可看到队友的实时选牌与队内聊天。"),
        h("div", { class: "pvp-inline" },
          h("input", { class: "pvp-input", id: "teamRoomCode", placeholder: "输入 A/B 队频道码" }),
          h("button", { class: "pvp-btn primary", id: "joinTeamBtn", onclick: function () {
            joinTeam(document.getElementById("teamRoomCode").value);
          } }, "加入频道")
        )
      ),
      playerRankCard()
    ));
    const saved = sessionStorage.getItem(TEAM_ROOM_KEY);
    if (saved) document.getElementById("teamRoomCode").value = saved;
  }

  function renderTeamWaiting(text) {
    rootEl.appendChild(h("div", { class: "pvp-page" },
      h("div", { class: "pvp-head" }, h("div", null,
        h("div", { class: "pvp-title" }, "队伍频道"),
        h("div", { class: "pvp-sub" }, teamSession ? (teamSession.room + " · " + teamSession.side + " 队") : "")
      )),
      h("div", { class: "pvp-card" },
        h("div", { class: "pvp-card-title" }, "等待同步"),
        h("div", { class: "pvp-note" }, text),
        h("div", { class: "pvp-actions" },
          h("button", { class: "pvp-btn ghost", onclick: leaveTeam }, "离开频道")
        )
      )
    ));
  }

  async function joinTeam(code, silent) {
    code = String(code || "").trim();
    if (!code) return flash("请输入队伍频道码");
    const side = global.SDJPvpTeam.parseSide(code);
    if (!side) return flash("频道码无效：缺少 A/B 队标识");
    if (!silent) flash("正在连接…", "info");
    if (teamSession) {
      try { teamSession.link.close(); } catch (e) { /* ignore */ }
    }
    teamSession = null;
    teamSnapshot = null;
    teamMessages = [];
    teamPartnerSelection = null;
    teamSelection = { uid: "", abilityIds: [], hidden: false, confirmNarrative: false };
    try {
      const link = await global.SDJPvpTeam.connect(code, handleTeamMessage);
      teamSession = { link: link, room: code, side: side, role: ctx.role };
      sessionStorage.setItem(TEAM_ROOM_KEY, code);
      link.send({ type: "hello", from: ctx.username, displayName: ctx.displayName || ctx.username, role: ctx.role, side: side, at: Date.now() });
      link.send({ type: "sync_request", at: Date.now() });
      renderTeamWaiting("已连接，等待裁判同步对局…");
    } catch (e) {
      flash("连接失败：" + (e.message || e));
    }
  }

  function handleTeamMessage(msg) {
    if (!msg || !msg.type) return;
    if (msg.type === "snapshot") {
      teamSnapshot = msg.snapshot;
      if (Array.isArray(msg.chat)) teamMessages = msg.chat.slice();
      if (msg.selections) {
        const partnerRole = ctx.role === "player" ? "contractor" : "player";
        teamPartnerSelection = msg.selections[partnerRole] || null;
      }
      const own = teamSnapshot && teamSnapshot.own;
      if (own && teamSelection.uid) {
        const cards = (own.loadout && own.loadout[ctx.role]) || [];
        if (!cards.some(function (c) { return c.uid === teamSelection.uid; })) {
          teamSelection = { uid: "", abilityIds: [], hidden: false, confirmNarrative: false };
        }
      }
      if (rootEl && rootEl.isConnected) renderTeamView();
      return;
    }
    if (msg.type === "chat") {
      teamMessages.push(msg);
      if (teamMessages.length > 200) teamMessages.shift();
      if (rootEl && rootEl.isConnected) renderTeamView();
      return;
    }
    if (msg.type === "selection" && msg.role !== ctx.role) {
      teamPartnerSelection = msg;
      if (rootEl && rootEl.isConnected) renderTeamView();
    }
  }

  function teamStatusCard(title, t) {
    return h("div", { class: "pvp-team" },
      h("div", { class: "pvp-team-name" }, title),
      h("div", { class: "pvp-hp-row" },
        h("span", { class: "pvp-hp-num" }, t.hp + " / " + t.maxHp),
        h("div", { class: "pvp-hpbar" }, h("div", { class: "pvp-hpfill", style: "width:" + Math.max(0, Math.min(100, t.hp / t.maxHp * 100)) + "%" }))
      ),
      h("div", { class: "pvp-badges" },
        t.statuses && t.statuses.silence ? h("span", { class: "pvp-badge danger" }, "沉默 " + t.statuses.silence) : null,
        t.statuses && t.statuses.ghostInfant ? h("span", { class: "pvp-badge danger" }, "鬼婴") : null,
        t.passive ? h("span", { class: "pvp-badge" }, "被动：" + t.passive.name) : null
      ),
      t.ongoing && t.ongoing.length ? h("div", { class: "pvp-ongoing" },
        t.ongoing.map(function (e) {
          return h("div", { class: "pvp-ongoing-item" }, e.source + " · " + e.kind + " " + e.amount + " · " + e.remaining + "R");
        })
      ) : null
    );
  }

  function renderTeamView() {
    if (!teamSnapshot || !teamSession) return;
    const snap = teamSnapshot;
    const side = snap.side;
    const role = ctx.role;
    const own = snap.own;
    const enemy = snap.enemy;
    const cards = (own.loadout && own.loadout[role]) || [];
    let card = cards.find(function (c) { return c.uid === teamSelection.uid; }) || cards[0] || null;
    if (card && teamSelection.uid !== card.uid) {
      teamSelection.uid = card.uid;
      teamSelection.abilityIds = [];
      teamSelection.hidden = false;
      teamSelection.confirmNarrative = false;
    }
    const pseudo = {
      phase: snap.phase,
      winner: snap.winner,
      round: snap.round,
      turn: { side: snap.turnSide },
      teams: {}
    };
    pseudo.teams[side] = own;
    pseudo.teams[side === "A" ? "B" : "A"] = enemy;

    const active = card ? E.cardAbilities(card).filter(function (a) { return a.trigger === "ACTIVE"; }).map(function (a) {
      return Object.assign({}, a, { conditionStatus: E.conditionStatus(pseudo, side, card, a) });
    }) : [];
    const passive = card ? E.cardAbilities(card).find(function (a) { return a.trigger === "PASSIVE"; }) : null;
    teamSelection.abilityIds = teamSelection.abilityIds.filter(function (id) {
      return active.some(function (a) { return a.id === id && a.conditionStatus.met; });
    });

    const cardSel = h("select", { class: "pvp-select" },
      cards.map(function (c) { return h("option", { value: c.uid }, c.name + "（" + (c.rarity || "?") + "）"); })
    );
    if (card) cardSel.value = card.uid;
    cardSel.onchange = function () {
      teamSelection = { uid: cardSel.value, abilityIds: [], hidden: false, confirmNarrative: false };
      sendTeamSelection();
      renderTeamView();
    };

    const skillList = h("div", { class: "pvp-skill-list" });
    const groups = {};
    active.forEach(function (a) {
      const cat = E.abilityCategories(a)[0] || "其他";
      (groups[cat] = groups[cat] || []).push(a);
    });
    Object.keys(groups).forEach(function (cat) {
      skillList.appendChild(h("div", { class: "pvp-skill-cat" }, cat));
      groups[cat].forEach(function (a) {
        const cb = h("input", { type: "checkbox" });
        cb.checked = teamSelection.abilityIds.indexOf(a.id) >= 0;
        if (!a.conditionStatus.met) cb.setAttribute("disabled", "disabled");
        cb.onchange = function () {
          const next = teamSelection.abilityIds.slice();
          if (cb.checked) next.push(a.id);
          else {
            const i = next.indexOf(a.id);
            if (i >= 0) next.splice(i, 1);
          }
          teamSelection.abilityIds = next;
          sendTeamSelection();
          renderTeamView();
        };
        const conds = a.conditionStatus.conditions.length
          ? a.conditionStatus.conditions.map(function (c) {
            return h("span", { class: "pvp-badge " + (c.met ? "" : "danger") }, (c.met ? "满足：" : "未满足：") + c.label);
          })
          : [h("span", { class: "pvp-badge" }, "始终满足")];
        const row = h("label", { class: "pvp-skill" + (a.conditionStatus.met ? "" : " disabled") },
          cb,
          h("div", { class: "pvp-skill-main" },
            h("div", { class: "pvp-skill-name" }, a.name,
              h("span", { class: "pvp-skill-cats" }, E.abilityCategories(a).map(function (c) { return h("span", { class: "pvp-badge" }, c); }))),
            h("div", { class: "pvp-skill-desc" }, E.abilityDescription(a)),
            h("div", { class: "pvp-skill-conds" }, conds)
          )
        );
        if (!a.conditionStatus.met) {
          row.addEventListener("click", function (e) {
            e.preventDefault();
            e.stopPropagation();
            flash("此技能暂不满足释放条件");
          });
        }
        skillList.appendChild(row);
      });
    });

    const hiddenCb = h("input", { type: "checkbox" });
    hiddenCb.checked = !!teamSelection.hidden;
    if (card && card.ir && card.ir.pvp && card.ir.pvp.hidden === false) hiddenCb.setAttribute("disabled", "disabled");
    hiddenCb.onchange = function () { teamSelection.hidden = !!hiddenCb.checked; sendTeamSelection(); };
    const narrCb = h("input", { type: "checkbox" });
    narrCb.checked = !!teamSelection.confirmNarrative;
    narrCb.onchange = function () { teamSelection.confirmNarrative = !!narrCb.checked; sendTeamSelection(); };

    const partner = teamPartnerSelection;
    const partnerCard = partner ? (own.loadout[partner.role] || []).find(function (c) { return c.uid === partner.uid; }) : null;

    const chatLog = h("div", { class: "pvp-log-list", style: "max-height:220px" });
    teamMessages.slice(-80).forEach(function (m) {
      chatLog.appendChild(h("div", { class: "pvp-log-item" },
        h("span", { class: "pvp-log-round" }, m.role === "referee" ? "裁" : (m.role === "player" ? "玩" : "契")),
        h("span", { class: "pvp-log-text" }, (m.from || "?") + "：" + m.text)
      ));
    });
    const chatInput = h("input", { class: "pvp-input", id: "teamChatInput", placeholder: "发送给同队与裁判…" });
    chatInput.onkeydown = function (e) { if (e.key === "Enter") sendTeamChat(); };

    rootEl.appendChild(h("div", { class: "pvp-page" },
      h("div", { class: "pvp-head" },
        h("div", null,
          h("div", { class: "pvp-title" }, "队伍频道 · " + side + " 队"),
          h("div", { class: "pvp-sub" }, (role === "player" ? "玩家" : "契约者") + " · " + (ctx.displayName || ctx.username || "") + " · 房间 " + teamSession.room)
        ),
        h("div", { class: "pvp-head-actions" },
          h("button", { class: "pvp-btn ghost", onclick: leaveTeam }, "离开频道")
        )
      ),
      h("div", { class: "pvp-note" }, "队友的选牌与你自己的选牌会实时同步；裁判可查看并应用。敌方频道独立，无法看到本频道聊天。"),
      h("div", { class: "pvp-two-col" },
        teamStatusCard("我方", own),
        teamStatusCard("敌方", enemy)
      ),
      h("div", { class: "pvp-card" },
        h("div", { class: "pvp-card-title" }, "我的出牌选择"),
        h("div", { class: "pvp-inline" },
          h("span", { class: "pvp-loadout-label" }, "选择我的卡牌"),
          cardSel
        ),
        card && active.length ? h("div", { class: "pvp-skill-head" },
          h("span", { class: "pvp-loadout-label" }, "技能分类与条件"),
          h("span", { class: "pvp-badge" }, teamSelection.abilityIds.length + "/" + active.length)
        ) : null,
        skillList,
        passive ? h("div", { class: "pvp-note pvp-passive" }, "被动「" + passive.name + "」将自动进入被动栏：" + E.abilityDescription(passive)) : null,
        card && card.desc ? h("div", { class: "pvp-note pvp-desc" }, card.desc) : null,
        h("div", { class: "pvp-checks" },
          h("label", { class: "pvp-check" }, hiddenCb, "暗放"),
          h("label", { class: "pvp-check" }, narrCb, "叙事确认")
        ),
        h("div", { class: "pvp-actions" },
          h("button", { class: "pvp-btn ghost", onclick: function () {
            teamSelection.abilityIds = active.filter(function (a) { return a.conditionStatus.met; }).map(function (a) { return a.id; });
            sendTeamSelection();
            renderTeamView();
          } }, "全选满足条件"),
          h("button", { class: "pvp-btn ghost", onclick: function () {
            teamSelection.abilityIds = [];
            sendTeamSelection();
            renderTeamView();
          } }, "清空"),
          h("button", { class: "pvp-btn primary", onclick: function () {
            sendTeamSelection();
            flash("已同步给裁判与队友", "info");
          } }, "提交选择"),
          h("span", { class: "pvp-note", id: "teamSelStatus" }, teamSelection.abilityIds.length ? "已选择 " + teamSelection.abilityIds.length + " 个技能" : "尚未选择技能")
        )
      ),
      h("div", { class: "pvp-card" },
        h("div", { class: "pvp-card-title" }, "队友选择"),
        partner ? h("div", { class: "pvp-note" },
          (partner.role === "player" ? "玩家" : "契约者") + "：" +
          (partnerCard ? partnerCard.name : partner.uid) + " · " +
          ((partner.abilityIds || []).join("、") || "无主动技能")) : h("div", { class: "pvp-note" }, "队友尚未提交选择")
      ),
      h("div", { class: "pvp-card" },
        h("div", { class: "pvp-card-title" }, "队内聊天"),
        chatLog,
        h("div", { class: "pvp-inline" }, chatInput,
          h("button", { class: "pvp-btn small", onclick: sendTeamChat }, "发送")
        )
      )
    ));
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function sendTeamSelection() {
    if (!teamSession || !teamSnapshot || !teamSelection.uid) return;
    const msg = {
      type: "selection",
      side: teamSnapshot.side,
      role: ctx.role,
      from: ctx.username,
      uid: teamSelection.uid,
      abilityIds: teamSelection.abilityIds.slice(),
      hidden: !!teamSelection.hidden,
      confirmNarrative: !!teamSelection.confirmNarrative,
      at: Date.now()
    };
    try { teamSession.link.send(msg); } catch (e) { /* ignore */ }
  }

  function sendTeamChat() {
    if (!teamSession || !teamSnapshot) return;
    const input = document.getElementById("teamChatInput");
    const text = String(input && input.value || "").trim();
    if (!text) return;
    const msg = {
      type: "chat", side: teamSnapshot.side,
      from: ctx.displayName || ctx.username || "?",
      role: ctx.role, text: text, at: Date.now()
    };
    teamMessages.push(msg);
    try { teamSession.link.send(msg); } catch (e) { /* ignore */ }
    renderTeamView();
  }

  function leaveTeam() {
    if (teamSession) {
      try { teamSession.link.close(); } catch (e) { /* ignore */ }
    }
    teamSession = null;
    teamSnapshot = null;
    teamMessages = [];
    teamPartnerSelection = null;
    teamSelection = { uid: "", abilityIds: [], hidden: false, confirmNarrative: false };
    sessionStorage.removeItem(TEAM_ROOM_KEY);
    render(rootEl, ctx);
  }

  function playerRankCard() {
    if (!R || !global.SDJPvpState) return null;
    const st = global.SDJPvpState.get();
    const prof = R.profileSummary(st, ctx.username || "");
    const recent = R.recentMatches(st, ctx.username || "", 5);
    return h("div", { class: "pvp-card" },
      h("div", { class: "pvp-card-title" }, "我的段位"),
      h("div", { class: "pvp-badges" },
        h("span", { class: "pvp-badge" }, prof.tierLabel),
        h("span", { class: "pvp-badge" }, prof.points + " 胜点"),
        h("span", { class: "pvp-badge" }, "胜 " + prof.wins + " / 负 " + prof.losses),
        h("span", { class: "pvp-badge" }, "计划点 " + prof.planPoints),
        h("span", { class: "pvp-badge" }, "今日 " + prof.dailyUsed + "/10")
      ),
      prof.pendingPromotion ? h("div", { class: "pvp-note" },
        "待晋升：" + (R.TIER_LABEL[prof.pendingPromotion.toTier] || prof.pendingPromotion.toTier) +
        "，需要献祭 " + prof.pendingPromotion.required.count + " 张" +
        (prof.pendingPromotion.required.rarity || "") + "身份卡") : null,
      prof.pendingPromotion ? promotionBlock(ctx.username, prof.pendingPromotion) : null,
      h("div", { class: "pvp-actions" },
        h("button", { class: "pvp-btn", onclick: function () { openRankModal(ctx.username || ""); } }, "查看 / 管理保护")
      ),
      recent.length ? h("div", { class: "pvp-log-list", style: "max-height:180px" },
        recent.map(function (m) {
          const side = (m.participants.A || []).indexOf(ctx.username) >= 0 ? "A" : "B";
          const win = m.winner === side;
          return h("div", { class: "pvp-log-item" },
            h("span", { class: "pvp-log-round" }, m.mode === "casual" ? "娱乐" : "排位"),
            h("span", { class: "pvp-log-text" },
              (m.winner === "draw" ? "平局" : (win ? "胜" : "负")) +
              " · 胜点 " + (m.rankDelta[side] >= 0 ? "+" : "") + m.rankDelta[side] +
              " · 计划点 " + (m.planPoints[side] || 0))
          );
        })
      ) : h("div", { class: "pvp-note" }, "暂无对局记录")
    );
  }

  /* ---------------- 训练场对局接管 ---------------- */
  function seedLobbyFromLocal() {
    try {
      const raw = JSON.parse(localStorage.getItem("sdj_pvp_lobby_v1") || "{}");
      Object.keys(raw.matches || {}).forEach(function (id) {
        const m = raw.matches[id];
        if (m && m.status === "playing" && m.engine) lobbyMatches[id] = m;
      });
    } catch (e) { /* ignore */ }
  }

  async function connectLobby() {
    if (!global.SDJPvpTeam || lobbyLink) return;
    seedLobbyFromLocal();
    try {
      lobbyLink = await global.SDJPvpTeam.connect("lobby-main", function (msg) {
        if (!msg || msg.type !== "match_update" || !msg.match) return;
        if (msg.match.status !== "playing") return;
        lobbyMatches[msg.match.id] = Object.assign({}, lobbyMatches[msg.match.id] || {}, msg.match);
        if (rootEl && rootEl.isConnected && !match) renderSetup();
      });
      lobbyLink.send({ type: "lobby_sync_request", at: Date.now() });
    } catch (e) { /* ignore */ }
    if (AUTH && AUTH.available) {
      AUTH.available().then(function (ok) {
        if (!ok) return;
        AUTH.watchLobby(function () {
          if (cloudRefreshTimer) clearTimeout(cloudRefreshTimer);
          cloudRefreshTimer = setTimeout(refreshCloudLobby, 300);
        }).then(function (handle) { cloudLobbyLink = handle; }).catch(function () { /* ignore */ });
        refreshCloudLobby();
      });
    }
  }

  async function refreshCloudLobby() {
    if (!AUTH) return;
    const r = await AUTH.list(null);
    if (!r.ok) return;
    (r.data || []).forEach(function (server) {
      if (server.status !== "playing" || server.phase !== "battle") return;
      const prev = lobbyMatches[server.id] || {};
      lobbyMatches[server.id] = {
        id: server.id,
        name: server.name,
        mode: server.mode,
        status: server.status,
        phase: server.phase,
        teams: server.teams,
        engine: prev.engine || null,
        teamRooms: prev.teamRooms || null,
        authority: "cloud"
      };
    });
    if (rootEl && rootEl.isConnected && !match) renderSetup();
  }

  function requestLobbySync() {
    if (!lobbyLink) { connectLobby(); return; }
    try { lobbyLink.send({ type: "lobby_sync_request", at: Date.now() }); } catch (e) { /* ignore */ }
  }

  function playerName(data, side, role) {
    const list = (data && data.match && data.match.teams && data.match.teams[side]) || [];
    const p = list.find(function (x) { return x.role === role; });
    return p ? (p.name || p.username) : (role === "player" ? "玩家" : "契约者");
  }

  function buildEngineFromCloud(data, matchData) {
    const md = data.match || {};
    const em = E.createMatch({
      mode: md.mode || matchData.mode,
      teams: {
        A: { label: "A 队", player: playerName(data, "A", "player"), contractor: playerName(data, "A", "contractor") },
        B: { label: "B 队", player: playerName(data, "B", "player"), contractor: playerName(data, "B", "contractor") }
      }
    });
    em.phase = "ban";
    em.order.first = data.first === "B" ? "B" : "A";
    em.order.second = em.order.first === "A" ? "B" : "A";
    const bans = [];
    ["A", "B"].forEach(function (side) {
      const list = (data.bans && data.bans[side]) || [];
      list.forEach(function (c) {
        bans.push({ side: side, uid: cardUid(c), name: c.name || "", by: side });
      });
    });
    E.submitBans(em, bans);
    const loadout = function (side) {
      const l = (data.loadouts && data.loadouts[side]) || {};
      return {
        player: (l.player || []).map(toEngineCard),
        contractor: (l.contractor || []).map(toEngineCard)
      };
    };
    E.submitLoadouts(em, { A: loadout("A"), B: loadout("B") });
    const room = function (side) {
      if (matchData.teamRooms && matchData.teamRooms[side]) return matchData.teamRooms[side];
      return global.SDJPvpTeam ? global.SDJPvpTeam.makeRoom(em.id, side) : (em.id + "-" + side);
    };
    em.teamRooms = { A: room("A"), B: room("B") };
    em.teamSelections = { A: { player: null, contractor: null }, B: { player: null, contractor: null } };
    em.teamChat = { A: [], B: [] };
    em.name = matchData.name || md.name || "";
    return em;
  }

  async function takeoverMatch(matchData) {
    if (!matchData) return flash("对局不存在");
    try {
      let engine = matchData.engine || null;
      if (!engine && AUTH) {
        const got = await AUTH.engineGet(matchData.id);
        if (got.ok) engine = got.engine;
      }
      if (!engine && AUTH) {
        const data = await AUTH.engineData(matchData.id);
        if (!data.ok) return flash("接管失败：" + (data.error || "引擎快照尚未生成"));
        engine = buildEngineFromCloud(data.data, matchData);
        await AUTH.enginePut(matchData.id, engine);
      }
      if (!engine) return flash("该对局没有可接管的引擎快照");
      match = E.deserialize(engine);
      match.authority = "cloud";
      cloudFinished = false;
      if (matchData.name && !match.name) match.name = matchData.name;
      if (matchData.teamRooms && (!match.teamRooms || !match.teamRooms.A)) match.teamRooms = matchData.teamRooms;
      if (lobbyLink && match.teamRooms) {
        try {
          lobbyLink.send({ type: "rooms_update", id: match.id, teamRooms: match.teamRooms, at: Date.now() });
        } catch (e) { /* ignore */ }
      }
      draft = emptyDraft();
      saveDraft();
      saveMatch();
      ensureTeamRooms();
      connectRefTeams();
      flash("已接管训练场对局：" + (matchData.name || match.id), "info");
      render(rootEl, ctx);
    } catch (e) {
      flash("接管失败：" + (e.message || e));
    }
  }

  function renderLobbyTakeover() {
    const list = Object.keys(lobbyMatches).map(function (id) { return lobbyMatches[id]; })
      .filter(function (m) { return m && m.phase === "battle" && (m.engine || m.authority === "cloud"); });
    if (!list.length) return null;
    return h("div", { class: "pvp-card" },
      h("div", { class: "pvp-card-title" }, "训练场待接管对局"),
      h("div", { class: "pvp-note" }, "训练场已完成投骰/编成/禁牌并开始的对局会出现在这里；云端对局会在接管时自动生成引擎。"),
      list.map(function (m) {
        return h("div", { class: "pvp-inline", style: "justify-content:space-between;margin-top:8px" },
          h("span", null, (m.name || m.id) + " · " + (m.mode === "casual" ? "娱乐赛" : "排位赛") + " · " + ((m.teams.A || []).length + (m.teams.B || []).length) + "/4"),
          h("button", { class: "pvp-btn primary", onclick: function () { takeoverMatch(m); } }, m.engine ? "接管对局" : "接管并生成引擎")
        );
      })
    );
  }

  /* ---------------- 创建对局 ---------------- */
  function field(label, id, value, placeholder) {
    return h("label", { class: "pvp-field" },
      h("span", { class: "pvp-field-label" }, label),
      h("input", { class: "pvp-input", id: id, value: value || "", placeholder: placeholder || "" })
    );
  }

  function renderSetup() {
    const page = h("div", { class: "pvp-page" },
      pageHead("对战裁判台", "2v2 · d6 小者先手 · 4 ban · 5+3 编成"),
      h("div", { class: "pvp-card" },
        h("div", { class: "pvp-card-title" }, "创建对局"),
        h("div", { class: "pvp-form-grid" },
          field("A 队名", "pvpTeamALabel", "A队"),
          field("A 玩家", "pvpTeamAPlayer", "玩家甲"),
          field("A 契约者", "pvpTeamAContractor", "契约者甲"),
          field("B 队名", "pvpTeamBLabel", "B队"),
          field("B 玩家", "pvpTeamBPlayer", "玩家乙"),
          field("B 契约者", "pvpTeamBContractor", "契约者乙"),
          h("label", { class: "pvp-field" },
            h("span", { class: "pvp-field-label" }, "模式"),
            h("select", { class: "pvp-select", id: "pvpMode" },
              h("option", { value: "ranked" }, "排位"),
              h("option", { value: "casual" }, "娱乐赛")
            )
          ),
          field("随机种子（可留空）", "pvpSeed", "", "例：20261118")
        ),
        h("div", { class: "pvp-actions" },
          h("button", { class: "pvp-btn primary", onclick: createFromForm }, "创建并掷 d6"),
          h("span", { class: "pvp-note" }, "创建后进入 ban 阶段；d6 结果自动记录。")
        )
      )
    );
    const takeoverCard = renderLobbyTakeover();
    if (takeoverCard) page.appendChild(takeoverCard);
    rootEl.appendChild(page);
  }

  function val(id) {
    const el = document.getElementById(id);
    return el ? String(el.value || "").trim() : "";
  }

  function createFromForm() {
    try {
      const seedText = val("pvpSeed");
      const seed = seedText ? Number(seedText) : undefined;
      if (seedText && (!Number.isFinite(seed) || seed <= 0)) throw new Error("种子必须是正整数");
      match = E.createMatch({
        mode: val("pvpMode") || "ranked",
        seed: seed,
        teams: {
          A: { label: val("pvpTeamALabel") || "A队", player: val("pvpTeamAPlayer") || "玩家甲", contractor: val("pvpTeamAContractor") || "契约者甲" },
          B: { label: val("pvpTeamBLabel") || "B队", player: val("pvpTeamBPlayer") || "玩家乙", contractor: val("pvpTeamBContractor") || "契约者乙" }
        }
      });
      E.rollInitiative(match);
      draft = emptyDraft();
      saveDraft();
      saveMatch();
      render(rootEl, ctx);
    } catch (e) {
      flash(e.message || String(e));
    }
  }

  /* ---------------- Ban 阶段 ---------------- */
  function cardOptionLabel(c) {
    return (c.role === "player" ? "玩家" : "契约者") + " · " + (c.poolName || c.poolId) + " · " + c.name + "（" + (c.rarity || "?") + "）";
  }

  function banSelect(id) {
    const sel = h("select", { class: "pvp-select", id: id });
    sel.appendChild(h("option", { value: "" }, "— 选择要 ban 的卡 —"));
    const groups = {};
    allPvpCards().forEach(function (c) {
      const key = (c.role === "player" ? "玩家卡" : "契约者卡") + " / " + (c.poolName || c.poolId);
      groups[key] = groups[key] || [];
      groups[key].push(c);
    });
    Object.keys(groups).sort().forEach(function (key) {
      const og = document.createElement("optgroup");
      og.label = key;
      groups[key].sort(function (a, b) { return String(a.name).localeCompare(String(b.name), "zh"); })
        .forEach(function (c) {
          og.appendChild(h("option", { value: cardUid(c) }, cardOptionLabel(c)));
        });
      sel.appendChild(og);
    });
    return sel;
  }

  function renderBan() {
    const order = match.order || { first: "?", rolls: { A: "?", B: "?" } };
    const page = h("div", { class: "pvp-page" },
      pageHead("ban 阶段", "先手 " + order.first + " · d6 A=" + order.rolls.A + " / B=" + order.rolls.B),
      h("div", { class: "pvp-card" },
        h("div", { class: "pvp-card-title" }, "4 个盲 ban（每方 2 个）"),
        h("div", { class: "pvp-ban-grid" },
          h("div", { class: "pvp-ban-col" },
            h("div", { class: "pvp-ban-title" }, match.teams.A.label + " 的 ban"),
            banSelect("pvpBanA1"), banSelect("pvpBanA2")
          ),
          h("div", { class: "pvp-ban-col" },
            h("div", { class: "pvp-ban-title" }, match.teams.B.label + " 的 ban"),
            banSelect("pvpBanB1"), banSelect("pvpBanB2")
          )
        ),
        h("div", { class: "pvp-actions" },
          h("button", { class: "pvp-btn primary", onclick: submitBansFromForm }, "提交 ban，进入编成"),
          h("button", { class: "pvp-btn ghost", onclick: function () { autoDemo(); } }, "快速填充（测试）"),
          h("span", { class: "pvp-note" }, "ban 只影响对方携带的卡；被 ban 卡仍占卡位但整场不可用。")
        )
      )
    );
    rootEl.appendChild(page);
  }

  function submitBansFromForm() {
    try {
      const pairs = [
        ["A", "pvpBanA1"], ["A", "pvpBanA2"],
        ["B", "pvpBanB1"], ["B", "pvpBanB2"]
      ];
      const map = {};
      allPvpCards().forEach(function (c) { map[cardUid(c)] = c; });
      const bans = pairs.map(function (p) {
        const uid = val(p[1]);
        if (!uid) throw new Error("请完成 4 个 ban");
        return { side: p[0], uid: uid, name: map[uid] ? map[uid].name : uid };
      });
      E.submitBans(match, bans);
      draft = emptyDraft();
      saveDraft();
      saveMatch();
      render(rootEl, ctx);
    } catch (e) { flash(e.message || String(e)); }
  }

  /* ---------------- 编成阶段 ---------------- */
  function selectedNames(list) {
    return list.length ? list.map(function (c) { return c.name; }).join("、") : "未选择";
  }

  function loadoutRow(side, role, need, list) {
    const label = role === "player" ? "玩家身份卡" : "契约者卡";
    return h("div", { class: "pvp-loadout-row" },
      h("div", { class: "pvp-loadout-main" },
        h("div", { class: "pvp-loadout-label" }, label + " · " + list.length + "/" + need),
        h("div", { class: "pvp-loadout-names" }, selectedNames(list))
      ),
      h("button", { class: "pvp-btn", onclick: function () {
        const cards = role === "player" ? pvpCards("player") : pvpCards("contractor");
        openCardPicker(cards, need, list, function (picked) {
          draft[side][role] = picked.map(toEngineCard);
          saveDraft();
          render(rootEl, ctx);
        }, "选择" + label + "（" + need + " 张）");
      } }, "选择")
    );
  }

  function renderLoadout() {
    const d = loadDraft();
    const page = h("div", { class: "pvp-page" },
      pageHead("编成阶段", "每队 5 张玩家身份卡 + 3 张契约者卡；被 ban 卡仍可编入，但整场不可用"),
      h("div", { class: "pvp-two-col" },
        h("div", { class: "pvp-card" },
          h("div", { class: "pvp-card-title" }, match.teams.A.label),
          loadoutRow("A", "player", 5, d.A.player),
          loadoutRow("A", "contractor", 3, d.A.contractor)
        ),
        h("div", { class: "pvp-card" },
          h("div", { class: "pvp-card-title" }, match.teams.B.label),
          loadoutRow("B", "player", 5, d.B.player),
          loadoutRow("B", "contractor", 3, d.B.contractor)
        )
      ),
      h("div", { class: "pvp-actions" },
        h("button", { class: "pvp-btn primary", onclick: submitLoadoutsFromDraft }, "开始对战"),
        h("button", { class: "pvp-btn ghost", onclick: function () { autoDemo(); } }, "快速填充（测试）"),
        h("span", { class: "pvp-note" }, "双方各 5+3 完成后才能开始。")
      )
    );
    rootEl.appendChild(page);
  }

  function submitLoadoutsFromDraft() {
    try {
      const d = loadDraft();
      ["A", "B"].forEach(function (side) {
        if (d[side].player.length !== 5) throw new Error(side + " 队玩家卡需要 5 张");
        if (d[side].contractor.length !== 3) throw new Error(side + " 队契约者卡需要 3 张");
      });
      E.submitLoadouts(match, {
        A: { player: d.A.player, contractor: d.A.contractor },
        B: { player: d.B.player, contractor: d.B.contractor }
      });
      draft = null;
      try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ }
      saveMatch();
      render(rootEl, ctx);
    } catch (e) { flash(e.message || String(e)); }
  }

  /* ---------------- 卡牌选择器 ---------------- */
  function openCardPicker(cards, need, selected, onDone, title) {
    const chosen = {};
    (selected || []).forEach(function (c) { chosen[cardUid(c)] = true; });
    const modal = h("div", { class: "pvp-modal" });
    const box = h("div", { class: "pvp-modal-box" });
    const countEl = h("span", { class: "pvp-pick-count" }, Object.keys(chosen).length + "/" + need);
    const search = h("input", { class: "pvp-input", placeholder: "搜索卡名 / 卡池 / 稀有度 / 标签" });
    const list = h("div", { class: "pvp-pick-list" });
    const confirmBtn = h("button", { class: "pvp-btn primary", disabled: "disabled" }, "确认选择");

    function refreshCount() {
      const n = Object.keys(chosen).length;
      countEl.textContent = n + "/" + need;
      if (n === need) confirmBtn.removeAttribute("disabled");
      else confirmBtn.setAttribute("disabled", "disabled");
    }

    function renderList() {
      const q = String(search.value || "").trim().toLowerCase();
      list.innerHTML = "";
      cards.filter(function (c) {
        if (!q) return true;
        return [c.name, c.poolName, c.poolId, c.rarity, tagSummary(c)].join(" ").toLowerCase().indexOf(q) >= 0;
      }).sort(function (a, b) {
        return String(a.poolName || "").localeCompare(String(b.poolName || ""), "zh") ||
          String(a.name).localeCompare(String(b.name), "zh");
      }).forEach(function (c) {
        const uid = cardUid(c);
        const checked = !!chosen[uid];
        const cb = h("input", { type: "checkbox" });
        cb.checked = checked;
        cb.onchange = function () {
          if (cb.checked) {
            if (Object.keys(chosen).length >= need && !chosen[uid]) {
              cb.checked = false;
              flash("最多选择 " + need + " 张");
              return;
            }
            chosen[uid] = true;
          } else {
            delete chosen[uid];
          }
          refreshCount();
        };
        const banned = (match && match.bans || []).some(function (b) { return b.uid === uid; });
        list.appendChild(h("label", { class: "pvp-pick-item" },
          cb,
          h("span", { class: "pvp-pick-name" }, c.name),
          h("span", { class: "pvp-badge" }, c.rarity || "?"),
          h("span", { class: "pvp-pick-meta" }, (c.poolName || c.poolId) + " · " + tagSummary(c) +
            (irSummary(c) ? " · IR: " + irSummary(c) : "")),
          banned ? h("span", { class: "pvp-badge danger" }, "已 ban") : null
        ));
      });
    }

    search.oninput = renderList;
    confirmBtn.onclick = function () {
      const picked = cards.filter(function (c) { return chosen[cardUid(c)]; });
      if (picked.length !== need) return;
      modal.remove();
      onDone(picked);
    };
    const cancel = h("button", { class: "pvp-btn ghost", onclick: function () { modal.remove(); } }, "取消");

    box.appendChild(h("div", { class: "pvp-modal-head" },
      h("div", { class: "pvp-card-title" }, title || "选择卡牌"),
      countEl
    ));
    box.appendChild(search);
    box.appendChild(list);
    box.appendChild(h("div", { class: "pvp-modal-actions" }, cancel, confirmBtn));
    modal.appendChild(box);
    modal.addEventListener("click", function (e) { if (e.target === modal) modal.remove(); });
    rootEl.appendChild(modal);
    renderList();
    refreshCount();
    setTimeout(function () { search.focus(); }, 30);
  }

  /* ---------------- 战斗阶段 ---------------- */
  function statusBadges(t) {
    const out = [];
    if (t.statuses.silence > 0) out.push(["沉默 " + t.statuses.silence, "danger"]);
    if (t.statuses.untargetable > 0) out.push(["无法选中 " + t.statuses.untargetable, ""]);
    if (t.statuses.damageImmune > 0) out.push(["免伤 " + t.statuses.damageImmune, ""]);
    if (t.statuses.ghostInfant) out.push(["鬼婴", "danger"]);
    return out;
  }

  function teamPanel(side) {
    const t = match.teams[side];
    const pct = Math.max(0, Math.min(100, (t.hp / t.maxHp) * 100));
    const isTurn = match.turn && match.turn.side === side;
    const banned = t.banned || [];
    const cardRows = function (role, title) {
      return h("div", { class: "pvp-loadout-block" },
        h("div", { class: "pvp-loadout-label" }, title),
        h("div", { class: "pvp-mini-list" },
          t.loadout[role].map(function (c) {
            const used = t.used.indexOf(c.uid) >= 0;
            const ban = banned.indexOf(c.uid) >= 0;
            return h("span", { class: "pvp-mini-card " + (used ? "used" : "") + (ban ? " banned" : "") },
              c.name,
              h("em", null, ban ? "ban" : (used ? "已用" : (c.rarity || "")))
            );
          })
        )
      );
    };
    return h("div", { class: "pvp-team " + (isTurn ? "active" : "") },
      h("div", { class: "pvp-team-head" },
        h("div", { class: "pvp-team-name" }, t.label + (isTurn ? " · 行动中" : "")),
        h("div", { class: "pvp-team-players" }, t.player.name + " / " + t.contractor.name)
      ),
      h("div", { class: "pvp-hp-row" },
        h("span", { class: "pvp-hp-num" }, t.hp + " / " + t.maxHp),
        h("div", { class: "pvp-hpbar" }, h("div", { class: "pvp-hpfill", style: "width:" + pct + "%" })),
        t.shield > 0 ? h("span", { class: "pvp-badge" }, "护盾 " + t.shield) : null
      ),
      h("div", { class: "pvp-badges" }, statusBadges(t).map(function (b) {
        return h("span", { class: "pvp-badge " + b[1] }, b[0]);
      })),
      t.passive ? h("div", { class: "pvp-ongoing-item" },
        "被动栏：" + t.passive.name + (t.passive.desc ? " · " + t.passive.desc : "")) : null,
      t.ongoing.length ? h("div", { class: "pvp-ongoing" },
        t.ongoing.map(function (e) {
          return h("div", { class: "pvp-ongoing-item" }, e.source + " · " + e.kind + " " + e.amount + " · 剩余 " + e.remaining + " 回合");
        })
      ) : null,
      t.summons.length ? h("div", { class: "pvp-ongoing" },
        t.summons.map(function (s) { return h("div", { class: "pvp-ongoing-item" }, "召唤物：" + s.name + "（" + s.hp + " HP）"); })
      ) : null,
      cardRows("player", "玩家卡 5"),
      cardRows("contractor", "契约者卡 3")
    );
  }

  function actionButton(label, enabled, fn, cls) {
    return h("button", {
      class: "pvp-btn " + (cls || "") + (enabled ? "" : " disabled"),
      disabled: enabled ? null : "disabled",
      onclick: enabled ? fn : null
    }, label);
  }

  function renderBattle() {
    const side = match.turn.side;
    const legal = E.legalActions(match);
    const can = function (x) { return legal.indexOf(x) >= 0; };
    const page = h("div", { class: "pvp-page" },
      pageHead("第 " + match.round + " 回合", (match.mode === "casual" ? "娱乐赛" : "排位") + " · 当前行动 " + side + " · 先手 " + match.order.first),
      h("div", { class: "pvp-two-col" }, teamPanel("A"), teamPanel("B")),
      h("div", { class: "pvp-card" },
        h("div", { class: "pvp-card-title" }, "行动"),
        h("div", { class: "pvp-actions" },
          actionButton("玩家卡", can("playerCard"), function () {
            const cards = E.playableCards(match, side, "player");
            if (!cards.length) return flash("没有可用的玩家卡");
            openCardPicker(cards, 1, [], function (picked) { openActionModal(side, "player", picked[0]); }, "选择玩家卡");
          }, "primary"),
          actionButton("契约者卡", can("contractorCard"), function () {
            const cards = E.playableCards(match, side, "contractor");
            if (!cards.length) return flash("没有可用的契约者卡");
            openCardPicker(cards, 1, [], function (picked) { openActionModal(side, "contractor", picked[0]); }, "选择契约者卡");
          }, "primary"),
          actionButton("平a（1 真伤）", can("normalAttack"), function () {
            if (!confirm("确认使用平a？本回合不能再用任何卡。")) return;
            try { E.normalAttack(match, side); saveMatch(); render(rootEl, ctx); } catch (e) { flash(e.message); }
          }, "danger"),
          actionButton("空过", can("pass"), function () {
            try { E.passTurn(match, side); saveMatch(); render(rootEl, ctx); } catch (e) { flash(e.message); }
          }, "ghost"),
          actionButton("结束回合", match.phase === "battle", function () {
            try { E.endTurn(match); saveMatch(); render(rootEl, ctx); } catch (e) { flash(e.message); }
          }, "ghost")
        ),
        h("div", { class: "pvp-note" }, "一回合最多 1 张玩家卡 + 1 张契约者卡；平a/空过会立即结束本方回合。")
      ),
      refereePanel(),
      teamRoomPanel(),
      logPanel()
    );
    rootEl.appendChild(page);
    connectRefTeams();
    publishAllTeamSnapshots();
    setTimeout(function () {
      const logs = rootEl.querySelector(".pvp-log-list");
      if (logs) logs.scrollTop = logs.scrollHeight;
    }, 20);
  }

  function openActionModal(side, role, card, selectedIds) {
    const ir = irOf(card);
    const tags = card.tags || {};
    const abilities = E.cardAbilities(card);
    const active = abilities.filter(function (a) { return a.trigger === "ACTIVE"; }).map(function (a) {
      return Object.assign({}, a, { conditionStatus: E.conditionStatus(match, side, card, a) });
    });
    const passive = abilities.find(function (a) { return a.trigger === "PASSIVE"; });
    let selected = Array.isArray(selectedIds) && selectedIds.length
      ? selectedIds.slice()
      : active.filter(function (a) { return a.conditionStatus.met; }).slice(0, 1).map(function (a) { return a.id; });
    selected = selected.filter(function (id) {
      return active.some(function (a) { return a.id === id && a.conditionStatus.met; });
    });
    const selectedAbilities = active.filter(function (a) { return selected.indexOf(a.id) >= 0; });
    const single = selectedAbilities.length === 1 ? selectedAbilities[0] : null;
    const af = single ? abilityFields(single) : null;
    const modal = h("div", { class: "pvp-modal" });
    const box = h("div", { class: "pvp-modal-box" });

    const dmg = h("input", {
      class: "pvp-input", type: "number", step: "0.5", min: "0",
      value: String(af ? af.damage : 0)
    });
    const control = h("select", { class: "pvp-select" },
      h("option", { value: "none" }, "不施加减益"),
      h("option", { value: "silence" }, "沉默 / 控制（按 IR）")
    );
    if (af && af.control) control.value = "silence";
    const controlRounds = h("input", {
      class: "pvp-input", type: "number", min: "1",
      value: String((af && af.controlRounds) || 1)
    });
    const hidden = h("input", { type: "checkbox" });
    const hiddenBlocked = !!(ir && ir.hidden === false);
    if (hiddenBlocked) hidden.setAttribute("disabled", "disabled");
    const ongoingSrc = (af && af.ongoing) || null;
    const ongoingAmount = h("input", {
      class: "pvp-input", type: "number", step: "0.5", min: "0",
      value: String(ongoingSrc && ongoingSrc.amount != null ? ongoingSrc.amount : 1)
    });
    const ongoingDuration = h("input", {
      class: "pvp-input", type: "number", min: "1",
      value: String((ongoingSrc && (ongoingSrc.rounds || ongoingSrc.duration)) || tags.durationRounds || 1)
    });
    const narrative = selectedAbilities.some(function (a) {
      return a.narrative || (a.steps || []).some(function (s) { return s.op === "NARRATIVE"; });
    }) || (!active.length && !!(ir && ir.narrative));
    const narrConfirm = h("input", { type: "checkbox" });
    const confirmBtn = h("button", { class: "pvp-btn primary" }, "确认出卡");

    function refreshConfirm() {
      const hasSelection = active.length === 0 || selectedAbilities.length > 0;
      const ok = hasSelection && (!narrative || narrConfirm.checked);
      if (ok) confirmBtn.removeAttribute("disabled");
      else confirmBtn.setAttribute("disabled", "disabled");
    }
    narrConfirm.onchange = refreshConfirm;

    confirmBtn.onclick = function () {
      try {
        const opts = {
          hidden: !hiddenBlocked && !!hidden.checked,
          confirmNarrative: !narrative || !!narrConfirm.checked
        };
        if (selectedAbilities.length) opts.abilityIds = selectedAbilities.map(function (a) { return a.id; });
        if (single) {
          opts.damage = Number(dmg.value) || 0;
          opts.control = control.value;
          opts.controlRounds = Number(controlRounds.value) || 1;
          if (ongoingSrc) {
            opts.ongoing = {
              kind: ongoingSrc.kind || "dot",
              amount: Number(ongoingAmount.value) || 0,
              duration: Number(ongoingDuration.value) || 1,
              target: ongoingSrc.target || "enemy"
            };
          }
        }
        E.playCard(match, side, role, card.uid, opts);
        modal.remove();
        saveMatch();
        render(rootEl, ctx);
      } catch (e) { flash(e.message || String(e)); }
    };

    box.appendChild(h("div", { class: "pvp-modal-head" },
      h("div", { class: "pvp-card-title" }, card.name),
      h("span", { class: "pvp-badge" }, card.rarity || "?")
    ));
    box.appendChild(h("div", { class: "pvp-note" }, "标签：" + tagSummary(card)));
    if (irSummary(card)) box.appendChild(h("div", { class: "pvp-note pvp-ir" }, "IR：" + irSummary(card)));

    if (active.length) {
      box.appendChild(h("div", { class: "pvp-skill-head" },
        h("span", { class: "pvp-loadout-label" }, "选择技能（可多选，仅满足条件的技能可选）"),
        h("span", { class: "pvp-badge" }, selectedAbilities.length + "/" + active.length)
      ));
      const list = h("div", { class: "pvp-skill-list" });
      const groups = {};
      active.forEach(function (a) {
        const cats = E.abilityCategories(a);
        const key = cats[0] || "其他";
        (groups[key] = groups[key] || []).push(a);
      });
      Object.keys(groups).forEach(function (cat) {
        list.appendChild(h("div", { class: "pvp-skill-cat" }, cat));
        groups[cat].forEach(function (a) {
          const cb = h("input", { type: "checkbox" });
          cb.checked = selected.indexOf(a.id) >= 0;
          if (!a.conditionStatus.met) cb.setAttribute("disabled", "disabled");
          cb.onchange = function () {
            const next = selected.slice();
            if (cb.checked) next.push(a.id);
            else {
              const i = next.indexOf(a.id);
              if (i >= 0) next.splice(i, 1);
            }
            modal.remove();
            openActionModal(side, role, card, next);
          };
          const conds = a.conditionStatus.conditions.length
            ? a.conditionStatus.conditions.map(function (c) {
              return h("span", { class: "pvp-badge " + (c.met ? "" : "danger") }, (c.met ? "满足：" : "未满足：") + c.label);
            })
            : [h("span", { class: "pvp-badge" }, "始终满足")];
          const row = h("label", { class: "pvp-skill" + (a.conditionStatus.met ? "" : " disabled") },
            cb,
            h("div", { class: "pvp-skill-main" },
              h("div", { class: "pvp-skill-name" }, a.name,
                h("span", { class: "pvp-skill-cats" }, E.abilityCategories(a).map(function (c) {
                  return h("span", { class: "pvp-badge" }, c);
                }))),
              h("div", { class: "pvp-skill-desc" }, E.abilityDescription(a)),
              h("div", { class: "pvp-skill-conds" }, conds)
            )
          );
          if (!a.conditionStatus.met) {
            row.addEventListener("click", function (e) {
              e.preventDefault();
              e.stopPropagation();
              flash("此技能暂不满足释放条件");
            });
          }
          list.appendChild(row);
        });
      });
      box.appendChild(list);
      box.appendChild(h("div", { class: "pvp-actions" },
        h("button", { class: "pvp-btn ghost", onclick: function () {
          modal.remove();
          openActionModal(side, role, card, active.filter(function (a) { return a.conditionStatus.met; }).map(function (a) { return a.id; }));
        } }, "全选满足条件"),
        h("button", { class: "pvp-btn ghost", onclick: function () {
          modal.remove();
          openActionModal(side, role, card, []);
        } }, "清空")
      ));
    } else {
      box.appendChild(h("div", { class: "pvp-note pvp-ir" }, "该卡没有主动技能；打出后仅激活被动。"));
    }

    if (passive) {
      box.appendChild(h("div", { class: "pvp-note pvp-passive" },
        "被动「" + passive.name + "」将自动进入被动栏：" + E.abilityDescription(passive)));
    }

    if (narrative) {
      box.appendChild(h("div", { class: "pvp-flash error", style: "margin:0" },
        "所选技能含叙事/裁判裁定，必须由裁判确认。"));
    }
    if (card.desc) box.appendChild(h("div", { class: "pvp-note pvp-desc" }, card.desc));

    if (single) {
      box.appendChild(h("div", { class: "pvp-form-grid" },
        h("label", { class: "pvp-field" }, h("span", { class: "pvp-field-label" }, "造成伤害"), dmg),
        h("label", { class: "pvp-field" }, h("span", { class: "pvp-field-label" }, "附加控制"), control),
        h("label", { class: "pvp-field" }, h("span", { class: "pvp-field-label" }, "控制回合"), controlRounds)
      ));
      if (ongoingSrc) {
        box.appendChild(h("div", { class: "pvp-form-grid" },
          h("label", { class: "pvp-field" }, h("span", { class: "pvp-field-label" }, (ongoingSrc.kind === "heal") ? "持续治疗/回合" : "持续伤害/回合"), ongoingAmount),
          h("label", { class: "pvp-field" }, h("span", { class: "pvp-field-label" }, "持续回合"), ongoingDuration)
        ));
      }
    } else if (selectedAbilities.length > 1) {
      box.appendChild(h("div", { class: "pvp-note pvp-ir" },
        "已选 " + selectedAbilities.length + " 个技能，将按 IR 依次结算；多技能时不再套用单技能数值覆盖。"));
    }

    box.appendChild(h("label", { class: "pvp-check" + (hiddenBlocked ? " disabled" : "") },
      hidden, "暗放（裁判可见，不公开）" + (hiddenBlocked ? " · 该卡 IR 不允许" : "")));
    if (narrative) {
      box.appendChild(h("label", { class: "pvp-check" }, narrConfirm, "已按卡面 / 裁判裁定确认"));
    }
    box.appendChild(h("div", { class: "pvp-modal-actions" },
      h("button", { class: "pvp-btn ghost", onclick: function () { modal.remove(); } }, "取消"),
      confirmBtn
    ));
    modal.appendChild(box);
    modal.addEventListener("click", function (e) { if (e.target === modal) modal.remove(); });
    rootEl.appendChild(modal);
    refreshConfirm();
  }

  /* ---------------- 裁判工具 ---------------- */
  function refereePanel() {
    const sideSel = h("select", { class: "pvp-select", id: "pvpRefSide" },
      h("option", { value: "A" }, "A 队"),
      h("option", { value: "B" }, "B 队")
    );
    const delta = h("input", { class: "pvp-input", id: "pvpRefDelta", type: "number", step: "0.5", value: "-1" });
    const reason = h("input", { class: "pvp-input", id: "pvpRefReason", placeholder: "原因（可选）" });
    const status = h("select", { class: "pvp-select", id: "pvpRefStatus" },
      h("option", { value: "silence" }, "沉默"),
      h("option", { value: "untargetable" }, "无法选中"),
      h("option", { value: "damage_immune" }, "免伤"),
      h("option", { value: "ghost_infant" }, "鬼婴")
    );
    const rounds = h("input", { class: "pvp-input", id: "pvpRefRounds", type: "number", min: "1", value: "1" });
    const note = h("input", { class: "pvp-input", id: "pvpRefNote", placeholder: "裁判记录 / 违规说明" });
    const flags = h("input", { class: "pvp-input", id: "pvpRefFlags", placeholder: "sleep_full,three_masks" });
    const flagSide = sideSel.cloneNode(true);
    flagSide.removeAttribute("id");

    return h("div", { class: "pvp-card" },
      h("div", { class: "pvp-card-title" }, "裁判工具"),
      h("div", { class: "pvp-ref-grid" },
        h("div", { class: "pvp-ref-block" },
          h("div", { class: "pvp-loadout-label" }, "HP 调整"),
          h("div", { class: "pvp-inline" }, sideSel, delta, reason,
            h("button", { class: "pvp-btn", onclick: function () {
              try {
                E.refereeAdjustHp(match, sideSel.value, Number(delta.value) || 0, reason.value);
                saveMatch(); render(rootEl, ctx);
              } catch (e) { flash(e.message); }
            } }, "应用"))
        ),
        h("div", { class: "pvp-ref-block" },
          h("div", { class: "pvp-loadout-label" }, "状态 / 控制"),
          h("div", { class: "pvp-inline" }, (function () {
            const clone = sideSel.cloneNode(true);
            clone.removeAttribute("id");
            return clone;
          })(), status, rounds,
            h("button", { class: "pvp-btn", onclick: function (ev) {
              try {
                const sel = ev.target.parentNode.querySelector("select");
                E.refereeSetStatus(match, sel.value, status.value, Number(rounds.value) || 1, "裁判手动");
                saveMatch(); render(rootEl, ctx);
              } catch (e) { flash(e.message); }
            } }, "施加")),
          h("div", { class: "pvp-inline" },
            h("button", { class: "pvp-btn ghost", onclick: function () {
              E.refereeClearGhostInfant(match, sideSel.value); saveMatch(); render(rootEl, ctx);
            } }, "解除鬼婴"),
            h("button", { class: "pvp-btn ghost", onclick: function () {
              const n = E.revealHidden(match); saveMatch(); render(rootEl, ctx);
              if (!n) flash("没有未揭示的暗放", "info");
            } }, "揭示暗放")
          ),
          h("div", { class: "pvp-inline" }, flagSide, flags,
            h("button", { class: "pvp-btn ghost", onclick: function () {
              const t = match.teams[flagSide.value];
              t.flags = {};
              String(flags.value || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (k) {
                t.flags[k] = true;
              });
              E.refereeLog(match, "裁判设置 flags：" + (Object.keys(t.flags).join(",") || "空"));
              saveMatch(); render(rootEl, ctx);
            } }, "设置条件 flags")
          )
        )
      ),
      h("div", { class: "pvp-inline" }, note,
        h("button", { class: "pvp-btn ghost", onclick: function () {
          if (!note.value.trim()) return;
          E.refereeLog(match, note.value.trim()); saveMatch(); render(rootEl, ctx);
        } }, "写入记录")
      )
    );
  }

  function teamRoomPanel() {
    if (!match || !global.SDJPvpTeam) return null;
    ensureTeamRooms();
    const codeRows = ["A", "B"].map(function (side) {
      return h("div", { class: "pvp-inline" },
        h("span", { class: "pvp-badge" }, side + " 队频道"),
        h("code", { class: "pvp-room-code" }, match.teamRooms[side]),
        h("button", { class: "pvp-btn ghost small", onclick: function () {
          const text = match.teamRooms[side];
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () { flash("频道码已复制", "info"); }).catch(function () { flash("复制失败", "info"); });
          } else flash("复制失败：浏览器不支持剪贴板", "info");
        } }, "复制")
      );
    });

    const selectionRows = [];
    ["A", "B"].forEach(function (side) {
      ["player", "contractor"].forEach(function (role) {
        const sel = match.teamSelections[side] && match.teamSelections[side][role];
        const team = match.teams[side];
        const card = sel && (team.loadout[role] || []).find(function (c) { return c.uid === sel.uid; });
        selectionRows.push(h("div", { class: "pvp-inline" },
          h("span", { class: "pvp-badge" }, side + " " + (role === "player" ? "玩家" : "契约者")),
          h("span", { class: "pvp-note" }, sel ? (card ? card.name : sel.uid) + " · " + ((sel.abilityIds || []).join("、") || "无主动技能") : "等待队内选择"),
          sel && match.phase === "battle" ? h("button", { class: "pvp-btn small", onclick: function () {
            applyTeamSelection(side, role);
          } }, "应用") : null
        ));
      });
    });

    const chatSide = h("select", { class: "pvp-select" },
      h("option", { value: "A" }, "A 队频道"),
      h("option", { value: "B" }, "B 队频道")
    );
    const chatLog = h("div", { class: "pvp-log-list", style: "max-height:180px" });
    const chatInput = h("input", { class: "pvp-input", placeholder: "发送给同队与裁判…" });
    const renderChat = function () {
      chatLog.innerHTML = "";
      const side = chatSide.value;
      (match.teamChat[side] || []).slice(-60).forEach(function (m) {
        chatLog.appendChild(h("div", { class: "pvp-log-item" },
          h("span", { class: "pvp-log-round" }, m.role === "referee" ? "裁" : (m.role === "player" ? "玩" : "契")),
          h("span", { class: "pvp-log-text" }, (m.from || "?") + "：" + m.text)
        ));
      });
      chatLog.scrollTop = chatLog.scrollHeight;
    };
    chatSide.onchange = renderChat;
    const sendChat = function () {
      const text = String(chatInput.value || "").trim();
      if (!text) return;
      const side = chatSide.value;
      const msg = { type: "chat", side: side, from: ctx.displayName || ctx.username || "裁判", role: "referee", text: text, at: Date.now() };
      match.teamChat[side].push(msg);
      if (teamLinks[side]) {
        try { teamLinks[side].send(msg); } catch (e) { /* ignore */ }
      }
      saveMatch();
      render(rootEl, ctx);
    };
    chatInput.onkeydown = function (e) { if (e.key === "Enter") sendChat(); };
    setTimeout(renderChat, 0);

    return h("div", { class: "pvp-card" },
      h("div", { class: "pvp-card-title" }, "队伍频道"),
      h("div", { class: "pvp-note" }, "把对应频道码发给同队玩家/契约者；敌方使用另一频道，无法看到本频道聊天。"),
      h("div", { class: "pvp-team-codes" }, codeRows),
      h("div", { class: "pvp-loadout-label", style: "margin-top:10px" }, "队内选择（实时）"),
      h("div", { class: "pvp-team-selections" }, selectionRows),
      h("div", { class: "pvp-loadout-label", style: "margin-top:12px" }, "队内聊天（裁判可见/可发）"),
      h("div", { class: "pvp-inline" }, chatSide),
      chatLog,
      h("div", { class: "pvp-inline" }, chatInput,
        h("button", { class: "pvp-btn small", onclick: sendChat }, "发送")
      )
    );
  }

  function logPanel() {
    const list = h("div", { class: "pvp-log-list" });
    match.log.slice(-120).forEach(function (e) {
      list.appendChild(h("div", { class: "pvp-log-item " + (e.kind || "") },
        h("span", { class: "pvp-log-round" }, "R" + e.round),
        h("span", { class: "pvp-log-text" }, e.text)
      ));
    });
    return h("div", { class: "pvp-card" },
      h("div", { class: "pvp-card-title" }, "对战日志"),
      list
    );
  }

  /* ---------------- 结束页 · 段位与经济结算 ---------------- */
  function renderEnd() {
    const winner = match.winner === "draw" ? "平局" : (match.winner === "A" ? match.teams.A.label + " 获胜" : match.teams.B.label + " 获胜");
    rootEl.appendChild(h("div", { class: "pvp-page" },
      pageHead("对局结束", winner),
      h("div", { class: "pvp-two-col" }, teamPanel("A"), teamPanel("B")),
      match.settlement ? settlementResult(match.settlement) : settlementForm(),
      teamRoomPanel(),
      logPanel(),
      h("div", { class: "pvp-actions" },
        h("button", { class: "pvp-btn primary", onclick: function () { clearAll(); render(rootEl, ctx); } }, "新对局"),
        h("button", { class: "pvp-btn", onclick: exportMatch }, "导出对局 JSON")
      )
    ));
    connectRefTeams();
    publishAllTeamSnapshots();
  }

  function settlementForm() {
    if (!R || !global.SDJPvpState) {
      return h("div", { class: "pvp-card" },
        h("div", { class: "pvp-card-title" }, "结算不可用"),
        h("div", { class: "pvp-note" }, "段位模块或状态桥接未加载。"));
    }
    const perfA = h("input", { class: "pvp-input", type: "number", min: "0", max: "10", value: "5" });
    const perfB = h("input", { class: "pvp-input", type: "number", min: "0", max: "10", value: "5" });
    const casualA = h("input", { class: "pvp-input", type: "number", min: "40", max: "100", value: "60" });
    const casualB = h("input", { class: "pvp-input", type: "number", min: "40", max: "100", value: "60" });
    const btn = h("button", { class: "pvp-btn primary" }, "结算对局");
    btn.onclick = function () {
      try {
        const st = global.SDJPvpState.get();
        const result = R.settleMatch(st, match, {
          performanceA: Number(perfA.value) || 0,
          performanceB: Number(perfB.value) || 0,
          casualPointsA: Number(casualA.value) || 60,
          casualPointsB: Number(casualB.value) || 60,
          rng: Math.random
        });
        global.SDJPvpState.save();
        match.settlement = result.already ? result.record : result;
        saveMatch();
        render(rootEl, ctx);
      } catch (e) { flash(e.message || String(e)); }
    };
    return h("div", { class: "pvp-card" },
      h("div", { class: "pvp-card-title" }, "结算"),
      h("div", { class: "pvp-note" }, "排位：胜方 +10~20 胜点并按段位发计划点；败方同档扣分；钻石+ 败方随机碎 1 张携带卡。娱乐赛：只发 40–100 计划点。"),
      h("div", { class: "pvp-form-grid" },
        h("label", { class: "pvp-field" }, h("span", { class: "pvp-field-label" }, "A 方表现 0–10"), perfA),
        h("label", { class: "pvp-field" }, h("span", { class: "pvp-field-label" }, "B 方表现 0–10"), perfB),
        match.mode === "casual" ? h("label", { class: "pvp-field" }, h("span", { class: "pvp-field-label" }, "A 方娱乐计划点 40–100"), casualA) : null,
        match.mode === "casual" ? h("label", { class: "pvp-field" }, h("span", { class: "pvp-field-label" }, "B 方娱乐计划点 40–100"), casualB) : null
      ),
      h("div", { class: "pvp-actions" }, btn,
        h("span", { class: "pvp-note" }, "同一对局只结算一次；结算后写入段位、钱包与碎卡审计。"))
    );
  }

  function settlementResult(record) {
    const st = global.SDJPvpState ? global.SDJPvpState.get() : null;
    const participants = (record.participants && record.participants.A || []).concat((record.participants && record.participants.B) || []);
    const pending = [];
    if (st && R) {
      participants.forEach(function (name) {
        const prof = R.profileOf(st, name);
        if (prof.pendingPromotion) pending.push({ username: name, pending: prof.pendingPromotion });
      });
    }
    return h("div", { class: "pvp-card" },
      h("div", { class: "pvp-card-title" }, "结算结果"),
      h("div", { class: "pvp-badges" },
        h("span", { class: "pvp-badge" }, record.mode === "casual" ? "娱乐赛" : "排位"),
        h("span", { class: "pvp-badge" }, record.winner === "draw" ? "平局" : record.winner + " 方胜"),
        h("span", { class: "pvp-badge" }, "A 胜点 " + (record.rankDelta.A >= 0 ? "+" : "") + record.rankDelta.A),
        h("span", { class: "pvp-badge" }, "B 胜点 " + (record.rankDelta.B >= 0 ? "+" : "") + record.rankDelta.B),
        h("span", { class: "pvp-badge" }, "A 计划点 " + record.planPoints.A),
        h("span", { class: "pvp-badge" }, "B 计划点 " + record.planPoints.B)
      ),
      record.shatter ? h("div", { class: "pvp-flash error", style: "margin:0" },
        "碎卡：" + record.shatter.username + " 的「" + record.shatter.name + "」已永久移除。") : null,
      record.protectedCards && record.protectedCards.length
        ? h("div", { class: "pvp-note" }, "保护触发：" + record.protectedCards.map(function (c) { return c.name; }).join("、"))
        : null,
      R && st && R.canRollback(st, record.id) ? h("div", { class: "pvp-actions" },
        h("button", { class: "pvp-btn danger", onclick: function () {
          if (!confirm("回滚本次结算？钱包、段位、碎卡与献祭都会恢复到结算前。")) return;
          try {
            R.rollbackMatch(st, record.id);
            global.SDJPvpState.save();
            delete match.settlement;
            saveMatch();
            render(rootEl, ctx);
          } catch (e) { flash(e.message || String(e)); }
        } }, "回滚本次结算"),
        h("span", { class: "pvp-note" }, "仅最近一场可回滚；已写入的审计会保留回滚记录。")
      ) : null,
      h("div", { class: "pvp-two-col" },
        ["A", "B"].map(function (side) {
          return h("div", { class: "pvp-card" },
            h("div", { class: "pvp-loadout-label" }, side + " 方"),
            (record.participants[side] || []).map(function (name) {
              const prof = R ? R.profileSummary(st, name) : null;
              return h("div", { class: "pvp-loadout-row" },
                h("div", { class: "pvp-loadout-main" },
                  h("div", { class: "pvp-loadout-names" }, name),
                  h("div", { class: "pvp-note" },
                    prof ? (prof.tierLabel + " · " + prof.points + " 胜点 · 计划点 " + prof.planPoints + " · 今日 " + prof.dailyUsed + "/10") : "")
                )
              );
            })
          );
        })
      ),
      pending.length ? h("div", null,
        h("div", { class: "pvp-card-title" }, "待晋升"),
        pending.map(function (p) { return promotionBlock(p.username, p.pending); })
      ) : null
    );
  }

  function promotionBlock(username, pending) {
    const st = global.SDJPvpState.get();
    const req = pending.required || {};
    const held = global.SDJPvpState.heldCards(username).filter(function (c) {
      if (req.rarity && String(c.rarity || "").toUpperCase() !== req.rarity) return false;
      if (R.isLocked(st, username, c.uid)) return false;
      if (R.protectionOf(st, username, c.uid)) return false;
      return c.count > 0;
    });
    const chosen = {};
    const countEl = h("span", { class: "pvp-badge" }, "0/" + (req.count || 0));
    const list = h("div", { class: "pvp-pick-list", style: "max-height:220px" });
    held.slice(0, 120).forEach(function (c) {
      const cb = h("input", { type: "checkbox" });
      cb.onchange = function () {
        if (cb.checked) {
          if (Object.keys(chosen).length >= (req.count || 0)) { cb.checked = false; return; }
          chosen[c.uid] = c;
        } else delete chosen[c.uid];
        countEl.textContent = Object.keys(chosen).length + "/" + (req.count || 0);
      };
      list.appendChild(h("label", { class: "pvp-pick-item" },
        cb,
        h("span", { class: "pvp-pick-name" }, c.name + " ×" + c.count),
        h("span", { class: "pvp-badge" }, c.rarity || "?"),
        h("span", { class: "pvp-pick-meta" }, c.poolName || c.poolId)
      ));
    });
    const btn = h("button", { class: "pvp-btn primary" }, "完成晋升");
    btn.onclick = function () {
      try {
        const picks = Object.keys(chosen).map(function (uid) { return chosen[uid]; });
        R.promote(st, username, picks.map(function (c) {
          return { uid: c.uid, name: c.name, rarity: c.rarity };
        }));
        global.SDJPvpState.save();
        render(rootEl, ctx);
      } catch (e) { flash(e.message || String(e)); }
    };
    return h("div", { class: "pvp-card", style: "margin-top:10px" },
      h("div", { class: "pvp-card-title" }, username + " 晋升 · 需献祭 " + (req.count || 0) + " 张" + (req.rarity || "") + "身份卡"),
      h("div", { class: "pvp-inline" }, countEl, btn),
      list,
      h("div", { class: "pvp-note" }, "上锁/保护中的卡不可献祭；献祭后永久移除。")
    );
  }

  function openRankModal(initial) {
    if (!R || !global.SDJPvpState) return flash("段位模块未加载");
    const modal = h("div", { class: "pvp-modal" });
    const box = h("div", { class: "pvp-modal-box" });
    const input = h("input", { class: "pvp-input", value: initial || ctx.username || "", placeholder: "输入用户名" });
    const body = h("div");
    function refresh() {
      body.innerHTML = "";
      const name = String(input.value || "").trim();
      if (!name) return;
      const st = global.SDJPvpState.get();
      const prof = R.profileSummary(st, name);
      body.appendChild(h("div", { class: "pvp-badges" },
        h("span", { class: "pvp-badge" }, prof.tierLabel),
        h("span", { class: "pvp-badge" }, prof.points + " 胜点"),
        h("span", { class: "pvp-badge" }, "胜 " + prof.wins + " / 负 " + prof.losses),
        h("span", { class: "pvp-badge" }, "计划点 " + prof.planPoints),
        h("span", { class: "pvp-badge" }, "今日 " + prof.dailyUsed + "/10")
      ));
      const season = R.stats(st);
      body.appendChild(h("div", { class: "pvp-note" }, "赛季概览"));
      body.appendChild(h("div", { class: "pvp-badges" },
        h("span", { class: "pvp-badge" }, "对局 " + season.total),
        h("span", { class: "pvp-badge" }, "排位 " + season.ranked + " / 娱乐 " + season.casual),
        h("span", { class: "pvp-badge" }, "平局 " + season.draws),
        h("span", { class: "pvp-badge" }, "先手胜率 " + season.firstWinRate + "%"),
        h("span", { class: "pvp-badge" }, "平均 " + season.avgRounds + " 回合"),
        h("span", { class: "pvp-badge" }, "碎卡率 " + season.shatterRate + "%")
      ));
      if (season.topBans.length) {
        body.appendChild(h("div", { class: "pvp-note" },
          "高频 ban：" + season.topBans.map(function (b) { return b.name + "×" + b.count; }).join("、")));
      }
      if (prof.pendingPromotion) {
        body.appendChild(h("div", { class: "pvp-note" },
          "待晋升：" + (R.TIER_LABEL[prof.pendingPromotion.toTier] || prof.pendingPromotion.toTier) +
          "，需献祭 " + prof.pendingPromotion.required.count + " 张" +
          (prof.pendingPromotion.required.rarity || "") + "身份卡"));
      }
      const held = global.SDJPvpState.heldCards(name);
      body.appendChild(h("div", { class: "pvp-loadout-label" }, "持有卡牌（" + held.length + "）"));
      if (!held.length) {
        body.appendChild(h("div", { class: "pvp-note" }, "没有持有卡牌。"));
        return;
      }
      const list = h("div", { class: "pvp-pick-list", style: "max-height:340px" });
      held.forEach(function (c) {
        const locked = R.isLocked(st, name, c.uid);
        const prot = R.protectionOf(st, name, c.uid);
        list.appendChild(h("div", { class: "pvp-pick-item" },
          h("span", { class: "pvp-pick-name" }, c.name + " ×" + c.count),
          h("span", { class: "pvp-badge" }, c.rarity || "?"),
          h("span", { class: "pvp-pick-meta" }, (c.poolName || c.poolId) + " · " + (locked ? "已上锁" : "未上锁") + (prot ? " · 保护 " + prot.remaining : "")),
          h("button", { class: "pvp-btn ghost", onclick: function () {
            R.setLocked(st, name, c.uid, !locked);
            global.SDJPvpState.save();
            refresh();
          } }, locked ? "解锁" : "上锁"),
          h("button", { class: "pvp-btn ghost", onclick: function () {
            R.addProtection(st, name, c.uid, 1, "manual");
            global.SDJPvpState.save();
            refresh();
          } }, "保护+1"),
          prot ? h("button", { class: "pvp-btn ghost", onclick: function () {
            R.removeProtection(st, name, c.uid);
            global.SDJPvpState.save();
            refresh();
          } }, "清除保护") : null
        ));
      });
      body.appendChild(list);
    }
    const query = h("button", { class: "pvp-btn primary", onclick: refresh }, "查询");
    input.onkeydown = function (e) { if (e.key === "Enter") refresh(); };
    box.appendChild(h("div", { class: "pvp-modal-head" },
      h("div", { class: "pvp-card-title" }, "段位与卡牌保护"),
      h("button", { class: "pvp-btn ghost", onclick: function () { modal.remove(); } }, "关闭")
    ));
    box.appendChild(h("div", { class: "pvp-inline" }, input, query));
    box.appendChild(body);
    modal.appendChild(box);
    modal.addEventListener("click", function (e) { if (e.target === modal) modal.remove(); });
    rootEl.appendChild(modal);
    refresh();
  }

  /* ---------------- 导出 / 生命周期 ---------------- */
  function autoDemo() {
    try {
      if (!match) return false;
      if (match.phase === "ban") {
        const cards = allPvpCards();
        if (cards.length < 4) throw new Error("PVP 卡池不足，无法快速填充");
        const pick = cards.slice(0, 4);
        E.submitBans(match, [
          { side: "A", uid: cardUid(pick[0]), name: pick[0].name },
          { side: "A", uid: cardUid(pick[1]), name: pick[1].name },
          { side: "B", uid: cardUid(pick[2]), name: pick[2].name },
          { side: "B", uid: cardUid(pick[3]), name: pick[3].name }
        ]);
        draft = emptyDraft();
        saveDraft();
        saveMatch();
      }
      if (match.phase === "loadout") {
        const pp = pvpCards("player"), cc = pvpCards("contractor");
        if (pp.length < 10 || cc.length < 6) throw new Error("PVP 卡池不足，无法快速填充");
        const mk = function (list) { return list.map(toEngineCard); };
        E.submitLoadouts(match, {
          A: { player: mk(pp.slice(0, 5)), contractor: mk(cc.slice(0, 3)) },
          B: { player: mk(pp.slice(5, 10)), contractor: mk(cc.slice(3, 6)) }
        });
        draft = null;
        try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ }
        saveMatch();
      }
      render(rootEl, ctx);
      return true;
    } catch (e) {
      flash(e.message || String(e));
      return false;
    }
  }

  function exportMatch() {
    if (!match) return flash("当前没有对局", "info");
    const blob = new Blob([JSON.stringify(E.snapshot(match), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "sdj-pvp-" + match.id + ".json";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function destroy() {
    if (lobbyLink) {
      try { lobbyLink.close(); } catch (e) { /* ignore */ }
      lobbyLink = null;
    }
    if (cloudLobbyLink) {
      try { cloudLobbyLink.close(); } catch (e) { /* ignore */ }
      cloudLobbyLink = null;
    }
    if (cloudRefreshTimer) { clearTimeout(cloudRefreshTimer); cloudRefreshTimer = null; }
    if (cloudPublishTimer) { clearTimeout(cloudPublishTimer); cloudPublishTimer = null; }
    ["A", "B"].forEach(function (side) {
      if (teamLinks[side]) {
        try { teamLinks[side].close(); } catch (e) { /* ignore */ }
        teamLinks[side] = null;
      }
      teamConnected[side] = "";
    });
    if (teamSession) {
      try { teamSession.link.close(); } catch (e) { /* ignore */ }
      teamSession = null;
    }
    teamSnapshot = null;
    teamMessages = [];
    teamPartnerSelection = null;
    if (!rootEl) return;
    rootEl.querySelectorAll(".pvp-modal").forEach(function (m) { m.remove(); });
  }

  function reset() {
    clearAll();
    if (rootEl) render(rootEl, ctx);
  }

  function state() {
    return match ? E.snapshot(match) : null;
  }

  global.SDJPvpUI = {
    render: render,
    destroy: destroy,
    reset: reset,
    state: state,
    load: loadMatch,
    autoDemo: autoDemo
  };
})(window);
