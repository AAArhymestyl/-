/* 神降计划·塔 · P2 段位与经济（纯逻辑，无 DOM）
 *
 * 口径见《PVP 现有规则梳理与重构方案 v2.6》3.9–3.11：
 * - 青铜→王者，每段 100 胜点；胜方 +10~20，败方同档扣分；0 分保护不掉段
 * - 晋升需献祭：青铜 1、白银 3、黄金 5、钻石 5 张 R、宗师 5 张 SR 身份卡
 * - 排位胜局计划点：80/100/120/150/175/200；败方 0
 * - 娱乐赛不计段位、不碎卡，双方各 40–100 计划点
 * - 每日 10 场计奖励，超出不发计划点
 * - 钻石及以上败方从本局携带 8 张中随机碎 1 张；上锁/保护免疫
 * - 平局：双方 +15 胜点，发该段位胜局计划点，不碎卡、不计胜负场
 */
(function (global) {
  "use strict";

  const VERSION = 1;
  const TIERS = ["bronze", "silver", "gold", "diamond", "master", "king"];
  const TIER_LABEL = {
    bronze: "青铜", silver: "白银", gold: "黄金",
    diamond: "钻石", master: "宗师", king: "王者"
  };
  const PLAN_POINTS = {
    bronze: 80, silver: 100, gold: 120,
    diamond: 150, master: 175, king: 200
  };
  const PROMOTION = {
    bronze: { to: "silver", count: 1, rarity: null },
    silver: { to: "gold", count: 3, rarity: null },
    gold: { to: "diamond", count: 5, rarity: null },
    diamond: { to: "master", count: 5, rarity: "R" },
    master: { to: "king", count: 5, rarity: "SR" }
  };

  function round1(v) {
    return Math.round((Number(v) || 0) * 2) / 2;
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, Number(v) || 0));
  }

  function defaultState() {
    return {
      version: VERSION,
      season: 1,
      profiles: {},
      locks: {},
      protections: {},
      matches: [],
      sacrifices: [],
      destructions: [],
      daily: {},
      snapshots: {},
      rollbacks: []
    };
  }

  function ensure(state) {
    if (!state) throw new Error("缺少应用状态");
    if (!state.pvp || typeof state.pvp !== "object") state.pvp = defaultState();
    const p = state.pvp;
    p.version = VERSION;
    p.season = Number(p.season) || 1;
    ["profiles", "locks", "protections", "daily", "snapshots"].forEach(function (k) {
      if (!p[k] || typeof p[k] !== "object") p[k] = {};
    });
    ["matches", "sacrifices", "destructions", "rollbacks"].forEach(function (k) {
      if (!Array.isArray(p[k])) p[k] = [];
    });
    if (!state.wallets || typeof state.wallets !== "object") state.wallets = {};
    return p;
  }

  function tierIndex(tier) {
    const i = TIERS.indexOf(String(tier || ""));
    return i < 0 ? 0 : i;
  }

  function tierLabel(tier) {
    return TIER_LABEL[tier] || "青铜";
  }

  function profileOf(state, username) {
    const p = ensure(state);
    const key = String(username || "").trim();
    if (!key) throw new Error("缺少用户名");
    if (!p.profiles[key]) {
      p.profiles[key] = {
        username: key,
        tier: "bronze",
        points: 0,
        wins: 0,
        losses: 0,
        pendingPromotion: null,
        updatedAt: Date.now()
      };
    }
    const prof = p.profiles[key];
    prof.tier = TIERS.indexOf(prof.tier) >= 0 ? prof.tier : "bronze";
    prof.points = round1(prof.points || 0);
    prof.wins = Number(prof.wins) || 0;
    prof.losses = Number(prof.losses) || 0;
    return prof;
  }

  function winPoints(performance) {
    return round1(10 + clamp(performance, 0, 10));
  }

  function lossPoints(performance) {
    return winPoints(performance);
  }

  function applyWin(profile, performance) {
    const delta = winPoints(performance);
    profile.points = round1(profile.points + delta);
    profile.wins += 1;
    profile.updatedAt = Date.now();
    if (profile.tier !== "king" && profile.points >= 100 && !profile.pendingPromotion) {
      const cfg = PROMOTION[profile.tier];
      if (cfg) {
        profile.pendingPromotion = {
          toTier: cfg.to,
          required: { count: cfg.count, rarity: cfg.rarity },
          overflow: Math.min(round1(profile.points - 100), 10)
        };
      }
    } else if (profile.pendingPromotion) {
      profile.pendingPromotion.overflow = Math.min(round1(profile.points - 100), 10);
    }
    return delta;
  }

  function applyLoss(profile, performance) {
    const delta = lossPoints(performance);
    profile.points = Math.max(0, round1(profile.points - delta));
    profile.losses += 1;
    profile.updatedAt = Date.now();
    if (profile.points < 100 && profile.pendingPromotion) profile.pendingPromotion = null;
    return -delta;
  }

  function applyDraw(profile) {
    profile.points = round1(profile.points + 15);
    profile.updatedAt = Date.now();
    return 15;
  }

  function todayKey(date) {
    if (date) return String(date);
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  function lockKey(username, uid) {
    return String(username || "") + "::" + String(uid || "");
  }

  function isLocked(state, username, uid) {
    return !!ensure(state).locks[lockKey(username, uid)];
  }

  function setLocked(state, username, uid, locked) {
    const p = ensure(state);
    const key = lockKey(username, uid);
    if (locked) p.locks[key] = true;
    else delete p.locks[key];
    return locked;
  }

  function protectionOf(state, username, uid) {
    const p = ensure(state);
    return p.protections[lockKey(username, uid)] || null;
  }

  function addProtection(state, username, uid, count, source) {
    const p = ensure(state);
    const key = lockKey(username, uid);
    const cur = p.protections[key] || { remaining: 0, source: source || "manual", updatedAt: Date.now() };
    cur.remaining = Math.max(0, (Number(cur.remaining) || 0) + (Number(count) || 1));
    cur.source = source || cur.source || "manual";
    cur.updatedAt = Date.now();
    if (cur.remaining > 0) p.protections[key] = cur;
    else delete p.protections[key];
    return cur.remaining;
  }

  function removeProtection(state, username, uid) {
    const p = ensure(state);
    delete p.protections[lockKey(username, uid)];
  }

  function consumeProtection(state, username, uid) {
    const p = ensure(state);
    const key = lockKey(username, uid);
    const cur = p.protections[key];
    if (!cur) return false;
    cur.remaining = Math.max(0, (Number(cur.remaining) || 0) - 1);
    if (cur.remaining <= 0) delete p.protections[key];
    else p.protections[key] = cur;
    return true;
  }

  function dailyUsed(state, username, date) {
    const p = ensure(state);
    const day = p.daily[todayKey(date)] || {};
    return Number(day[username]) || 0;
  }

  function grantPlanPoints(state, username, points, date) {
    const p = ensure(state);
    const dayKey = todayKey(date);
    p.daily[dayKey] = p.daily[dayKey] || {};
    const used = Number(p.daily[dayKey][username]) || 0;
    if (used >= 10) return 0;
    p.daily[dayKey][username] = used + 1;
    const w = state.wallets[username] || { points: 0 };
    w.points = (Number(w.points) || 0) + (Number(points) || 0);
    state.wallets[username] = w;
    return Number(points) || 0;
  }

  function heldCount(state, username, uid) {
    const h = (state.cards && state.cards.holdings && state.cards.holdings[username]) || {};
    return Number(h[uid]) || 0;
  }

  function takeHeldCard(state, username, uid) {
    const h = state.cards && state.cards.holdings && state.cards.holdings[username];
    if (!h) return false;
    const n = Number(h[uid]) || 0;
    if (n <= 0) return false;
    if (n === 1) delete h[uid];
    else h[uid] = n - 1;
    return true;
  }

  function shuffle(list, rng) {
    const arr = list.slice();
    const rand = typeof rng === "function" ? rng : Math.random;
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function participantsOf(team) {
    return [team && team.player && team.player.name, team && team.contractor && team.contractor.name]
      .filter(Boolean).map(String);
  }

  function carriedOf(team) {
    const out = [];
    if (!team) return out;
    ["player", "contractor"].forEach(function (role) {
      const owner = team[role] && team[role].name;
      const cards = (team.loadout && team.loadout[role]) || [];
      if (!owner) return;
      cards.forEach(function (c) {
        out.push({ username: String(owner), role: role, card: c });
      });
    });
    return out;
  }

  function shatterLoser(state, loserTeam, matchId, rng) {
    const p = ensure(state);
    const carried = shuffle(carriedOf(loserTeam), rng);
    const protectedCards = [];
    for (let i = 0; i < carried.length; i++) {
      const entry = carried[i];
      const uid = entry.card && (entry.card.uid || ((entry.card.poolId || "") + "::" + (entry.card.id || "")));
      if (!uid) continue;
      if (isLocked(state, entry.username, uid)) continue;
      if (consumeProtection(state, entry.username, uid)) {
        protectedCards.push({ username: entry.username, uid: uid, name: entry.card.name || "" });
        continue;
      }
      if (heldCount(state, entry.username, uid) <= 0) continue;
      if (!takeHeldCard(state, entry.username, uid)) continue;
      const record = {
        username: entry.username,
        uid: uid,
        name: entry.card.name || "",
        poolId: entry.card.poolId || "",
        role: entry.role,
        at: Date.now()
      };
      p.destructions.push(Object.assign({ matchId: matchId, reason: "ranked_loss" }, record));
      return { destroyed: record, protectedCards: protectedCards };
    }
    return { destroyed: null, protectedCards: protectedCards };
  }

  function settleMatch(state, match, opts) {
    opts = opts || {};
    if (!match || match.phase !== "ended") throw new Error("对局尚未结束");
    const p = ensure(state);
    const existing = p.matches.find(function (m) { return m.id === match.id; });
    if (existing) return { already: true, record: existing };

    // 版本化回滚：结算前快照；只保留最近 20 场
    p.snapshots[match.id] = {
      at: Date.now(),
      wallets: JSON.parse(JSON.stringify(state.wallets || {})),
      holdings: JSON.parse(JSON.stringify((state.cards && state.cards.holdings) || {})),
      profiles: JSON.parse(JSON.stringify(p.profiles)),
      locks: JSON.parse(JSON.stringify(p.locks)),
      protections: JSON.parse(JSON.stringify(p.protections)),
      daily: JSON.parse(JSON.stringify(p.daily)),
      matches: JSON.parse(JSON.stringify(p.matches)),
      sacrifices: JSON.parse(JSON.stringify(p.sacrifices)),
      destructions: JSON.parse(JSON.stringify(p.destructions))
    };
    const snapIds = Object.keys(p.snapshots).sort(function (a, b) {
      return (p.snapshots[a].at || 0) - (p.snapshots[b].at || 0);
    });
    while (snapIds.length > 20) delete p.snapshots[snapIds.shift()];

    const mode = match.mode === "casual" ? "casual" : "ranked";
    const date = todayKey(opts.date);
    const perfA = clamp(opts.performanceA, 0, 10);
    const perfB = clamp(opts.performanceB, 0, 10);
    const winner = match.winner;
    const result = {
      id: match.id,
      mode: mode,
      format: match.format || "2v2",
      winner: winner,
      at: Date.now(),
      date: date,
      rounds: Number(match.round) || 0,
      firstSide: (match.order && match.order.first) || null,
      bans: (match.bans || []).map(function (b) { return { side: b.side, uid: b.uid, name: b.name }; }),
      performance: { A: perfA, B: perfB },
      rankDelta: { A: 0, B: 0 },
      planPoints: { A: 0, B: 0 },
      promotions: [],
      shatter: null,
      protectedCards: [],
      participants: {
        A: participantsOf(match.teams.A),
        B: participantsOf(match.teams.B)
      }
    };

    const sides = ["A", "B"];
    const planForSide = { A: 0, B: 0 };

    if (winner === "draw") {
      sides.forEach(function (side) {
        const team = match.teams[side];
        const tier = profileOf(state, team.player.name).tier;
        planForSide[side] = PLAN_POINTS[tier] || PLAN_POINTS.bronze;
        participantsOf(team).forEach(function (username) {
          applyDraw(profileOf(state, username));
          result.rankDelta[side] = 15;
        });
      });
    } else if (mode === "ranked") {
      const loser = winner === "A" ? "B" : "A";
      const winnerTeam = match.teams[winner];
      const loserTeam = match.teams[loser];
      const winnerTier = profileOf(state, winnerTeam.player.name).tier;
      planForSide[winner] = PLAN_POINTS[winnerTier] || PLAN_POINTS.bronze;
      participantsOf(winnerTeam).forEach(function (username) {
        const prof = profileOf(state, username);
        result.rankDelta[winner] = applyWin(prof, winner === "A" ? perfA : perfB);
        if (prof.pendingPromotion) result.promotions.push({ username: username, pending: JSON.parse(JSON.stringify(prof.pendingPromotion)) });
      });
      participantsOf(loserTeam).forEach(function (username) {
        const prof = profileOf(state, username);
        result.rankDelta[loser] = applyLoss(prof, loser === "A" ? perfA : perfB);
      });
      const loserTier = profileOf(state, loserTeam.player.name).tier;
      if (tierIndex(loserTier) >= tierIndex("diamond")) {
        const sh = shatterLoser(state, loserTeam, match.id, opts.rng);
        result.shatter = sh.destroyed;
        result.protectedCards = sh.protectedCards;
      }
    } else {
      // 娱乐赛：双方都发计划点，不计段位、不碎卡
      const casualA = clamp(opts.casualPointsA != null ? opts.casualPointsA : 60, 40, 100);
      const casualB = clamp(opts.casualPointsB != null ? opts.casualPointsB : 60, 40, 100);
      planForSide.A = casualA;
      planForSide.B = casualB;
    }

    sides.forEach(function (side) {
      const team = match.teams[side];
      participantsOf(team).forEach(function (username) {
        const pts = grantPlanPoints(state, username, planForSide[side], date);
        result.planPoints[side] += pts;
      });
    });

    result.planPointsPerPlayer = planForSide;
    p.matches.push(result);
    return result;
  }

  function promote(state, username, sacrifices) {
    const p = ensure(state);
    const prof = profileOf(state, username);
    const pending = prof.pendingPromotion;
    if (!pending) throw new Error("当前没有待晋升");
    if (!Array.isArray(sacrifices) || sacrifices.length !== pending.required.count) {
      throw new Error("需要献祭 " + pending.required.count + " 张卡");
    }
    const seen = {};
    const cards = sacrifices.map(function (s) {
      const uid = String(s.uid || "");
      if (!uid || seen[uid]) throw new Error("献祭卡重复");
      seen[uid] = true;
      if (pending.required.rarity && String(s.rarity || "").toUpperCase() !== pending.required.rarity) {
        throw new Error("献祭卡稀有度必须为 " + pending.required.rarity);
      }
      if (isLocked(state, username, uid)) throw new Error("上锁卡不能献祭");
      if (protectionOf(state, username, uid)) throw new Error("保护中的卡不能献祭");
      if (heldCount(state, username, uid) <= 0) throw new Error("持有数量不足：" + (s.name || uid));
      return { uid: uid, name: s.name || "", rarity: s.rarity || "" };
    });
    cards.forEach(function (c) { takeHeldCard(state, username, c.uid); });
    const fromTier = prof.tier;
    prof.tier = pending.toTier;
    prof.points = Math.min(10, Number(pending.overflow) || 0);
    prof.pendingPromotion = null;
    prof.updatedAt = Date.now();
    p.sacrifices.push({
      username: username,
      fromTier: fromTier,
      toTier: prof.tier,
      cards: cards,
      at: Date.now()
    });
    return { tier: prof.tier, points: prof.points, tierLabel: tierLabel(prof.tier) };
  }

  function profileSummary(state, username) {
    const prof = profileOf(state, username);
    return {
      username: prof.username,
      tier: prof.tier,
      tierLabel: tierLabel(prof.tier),
      points: prof.points,
      wins: prof.wins,
      losses: prof.losses,
      pendingPromotion: prof.pendingPromotion,
      planPoints: ((state.wallets && state.wallets[username]) || {}).points || 0,
      dailyUsed: dailyUsed(state, username)
    };
  }

  function recentMatches(state, username, limit) {
    const p = ensure(state);
    const name = String(username || "");
    return p.matches.filter(function (m) {
      return (m.participants.A || []).indexOf(name) >= 0 || (m.participants.B || []).indexOf(name) >= 0;
    }).slice(-(limit || 5)).reverse();
  }

  function canRollback(state, matchId) {
    const p = ensure(state);
    const latest = p.matches[p.matches.length - 1];
    return !!(p.snapshots[matchId] && latest && latest.id === matchId);
  }

  function rollbackMatch(state, matchId) {
    const p = ensure(state);
    if (!canRollback(state, matchId)) throw new Error("只能回滚最近一场已结算对局");
    const snap = p.snapshots[matchId];
    state.wallets = snap.wallets;
    if (state.cards) state.cards.holdings = snap.holdings;
    p.profiles = snap.profiles;
    p.locks = snap.locks;
    p.protections = snap.protections;
    p.daily = snap.daily;
    p.matches = snap.matches;
    p.sacrifices = snap.sacrifices;
    p.destructions = snap.destructions;
    delete p.snapshots[matchId];
    p.rollbacks.push({ matchId: matchId, at: Date.now() });
    return { ok: true };
  }

  function stats(state) {
    const p = ensure(state);
    const ms = p.matches;
    const decided = ms.filter(function (m) { return m.winner === "A" || m.winner === "B"; });
    const first = decided.filter(function (m) { return m.firstSide === "A" || m.firstSide === "B"; });
    const firstWins = first.filter(function (m) { return m.winner === m.firstSide; }).length;
    const shatterCount = ms.filter(function (m) { return !!m.shatter; }).length;
    const banCounts = {};
    ms.forEach(function (m) {
      (m.bans || []).forEach(function (b) {
        const key = b.name || b.uid;
        if (key) banCounts[key] = (banCounts[key] || 0) + 1;
      });
    });
    const topBans = Object.keys(banCounts).sort(function (a, b) {
      return banCounts[b] - banCounts[a];
    }).slice(0, 8).map(function (name) { return { name: name, count: banCounts[name] }; });
    const rounds = ms.reduce(function (sum, m) { return sum + (Number(m.rounds) || 0); }, 0);
    return {
      total: ms.length,
      ranked: ms.filter(function (m) { return m.mode === "ranked"; }).length,
      casual: ms.filter(function (m) { return m.mode === "casual"; }).length,
      draws: ms.filter(function (m) { return m.winner === "draw"; }).length,
      firstWinRate: first.length ? round1(firstWins / first.length * 100) : 0,
      avgRounds: ms.length ? round1(rounds / ms.length) : 0,
      shatterCount: shatterCount,
      shatterRate: ms.length ? round1(shatterCount / ms.length * 100) : 0,
      topBans: topBans
    };
  }

  global.SDJPvpRank = {
    VERSION: VERSION,
    TIERS: TIERS,
    TIER_LABEL: TIER_LABEL,
    PLAN_POINTS: PLAN_POINTS,
    PROMOTION: PROMOTION,
    defaultState: defaultState,
    ensure: ensure,
    profileOf: profileOf,
    profileSummary: profileSummary,
    tierIndex: tierIndex,
    tierLabel: tierLabel,
    winPoints: winPoints,
    lossPoints: lossPoints,
    settleMatch: settleMatch,
    promote: promote,
    isLocked: isLocked,
    setLocked: setLocked,
    protectionOf: protectionOf,
    addProtection: addProtection,
    removeProtection: removeProtection,
    consumeProtection: consumeProtection,
    dailyUsed: dailyUsed,
    recentMatches: recentMatches,
    canRollback: canRollback,
    rollbackMatch: rollbackMatch,
    stats: stats,
    heldCount: heldCount,
    lockKey: lockKey
  };
})(window);
