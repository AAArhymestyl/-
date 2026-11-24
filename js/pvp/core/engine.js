/* 神降计划·塔 · 2v2 PVP 引擎（纯状态机，无 DOM）
 *
 * 设计口径见《PVP 现有规则梳理与重构方案 v2.6》：
 * - 2v2 = 每队 1 玩家 + 1 契约者；玩家场外，契约者 10 HP 承伤
 * - d6 小者先手；先 ban（4 个）后编成（5+3）
 * - 一回合最多 1 张玩家卡 + 1 张契约者卡；每卡整场 1 次
 * - 平a = 1 真伤，占用整回合
 * - 伤害 N/R=1，SR/SSR=2，SP 纯攻=3；增益最多 1 张，加值=基础伤害/2
 * - 沉默禁止出卡/技能/暗放/平a；控制不递减
 * - 契约者 1 个被动栏；新被动覆盖来源，不打断已触发的持续效果
 *
 * 所有随机走 match.rngState，可用 seed 复现。
 */
(function (global) {
  "use strict";

  const VERSION = 1;

  const RULES = {
    hp: 10,
    playerSlots: 5,
    contractorSlots: 3,
    bans: 4,
    bansPerSide: 2,
    normalAttackDamage: 1,
    normalAttackTrueDamage: true,
    buffMaxPerHit: 1,
    buffRatio: 0.5,
    buffMaxRarityGap: 1,
    buffZeroCards: ["虫族•幼崽", "塞壬"],
    silenceBlocksNormalAttack: true,
    controlDecay: false,
    passiveSlots: 1,
    damage: { N: 1, R: 1, SR: 2, SSR: 2, SP_PURE: 3 }
  };

  const RARITY_RANK = { N: 0, R: 1, SR: 2, SSR: 3, SP: 4 };

  function fail(message, code) {
    const err = new Error(message);
    err.code = code || "PVP_RULE";
    throw err;
  }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function round1(v) {
    return Math.round((Number(v) || 0) * 2) / 2;
  }

  function opponent(side) {
    return side === "A" ? "B" : "A";
  }

  function rarityRank(rarity) {
    return RARITY_RANK[String(rarity || "").toUpperCase()] != null
      ? RARITY_RANK[String(rarity || "").toUpperCase()]
      : -1;
  }

  function makeTeam(side, data) {
    data = data || {};
    return {
      side: side,
      label: data.label || ("队伍 " + side),
      player: { name: data.player || ("玩家" + side) },
      contractor: { name: data.contractor || ("契约者" + side) },
      hp: RULES.hp,
      maxHp: RULES.hp,
      shield: 0,
      passive: null,
      ongoing: [],
      statuses: {
        silence: 0,
        untargetable: 0,
        damageImmune: 0,
        ghostInfant: false,
        bodyTarget: true,
        bodyBuff: true
      },
      flags: {},
      loadout: { player: [], contractor: [] },
      used: [],
      banned: [],
      summons: []
    };
  }

  function log(match, text, meta) {
    match.seq = (match.seq || 0) + 1;
    const item = {
      seq: match.seq,
      round: match.round || 0,
      at: Date.now(),
      text: String(text)
    };
    if (meta) Object.assign(item, meta);
    match.log.push(item);
    if (match.log.length > 500) match.log.shift();
    return item;
  }

  function createMatch(opts) {
    opts = opts || {};
    const seed = Number(opts.seed) || ((Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0);
    const match = {
      version: VERSION,
      id: "pvp_" + seed.toString(36),
      createdAt: Date.now(),
      mode: opts.mode === "casual" ? "casual" : "ranked",
      format: "2v2",
      seed: seed >>> 0,
      rngState: seed >>> 0,
      phase: "roll",
      teams: {
        A: makeTeam("A", opts.teams && opts.teams.A),
        B: makeTeam("B", opts.teams && opts.teams.B)
      },
      order: { first: null, second: null, rolls: { A: null, B: null } },
      bans: [],
      turn: null,
      round: 0,
      pending: { A: 0, B: 0 },
      hidden: [],
      log: [],
      winner: null,
      seq: 0,
      rules: clone(RULES)
    };
    log(match, "对局创建：" + match.teams.A.label + " vs " + match.teams.B.label);
    return match;
  }

  /* ---------------- 确定性随机 ---------------- */
  function nextRandom(match) {
    let t = match.rngState = (match.rngState + 0x6D2B79F5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function d6(match) {
    return 1 + Math.floor(nextRandom(match) * 6);
  }

  function rollInitiative(match) {
    if (!match || match.phase !== "roll") fail("当前阶段不能掷先手");
    let a, b, tries = 0;
    do {
      a = d6(match);
      b = d6(match);
      tries++;
    } while (a === b && tries < 20);
    if (a === b) { a = 1; b = 2; }
    match.order.rolls = { A: a, B: b };
    match.order.first = a < b ? "A" : "B";
    match.order.second = opponent(match.order.first);
    match.phase = "ban";
    log(match, "d6：A=" + a + "，B=" + b + "；" + match.order.first + " 先手，" + match.order.second + " 后手", { kind: "roll" });
    return clone(match.order);
  }

  function submitBans(match, bans) {
    if (!match || match.phase !== "ban") fail("当前阶段不能提交 ban");
    if (!Array.isArray(bans)) fail("ban 必须是数组");
    if (bans.length !== RULES.bans) fail("2v2 必须提交 " + RULES.bans + " 个 ban");
    const count = { A: 0, B: 0 };
    const cleaned = bans.map(function (b) {
      const side = b && (b.side || b.bySide);
      if (side !== "A" && side !== "B") fail("ban 缺少合法阵营");
      count[side]++;
      return {
        side: side,
        uid: String(b.uid || ""),
        name: String(b.name || ""),
        by: String(b.by || "")
      };
    });
    if (count.A !== RULES.bansPerSide || count.B !== RULES.bansPerSide) {
      fail("每个阵营必须各提交 " + RULES.bansPerSide + " 个 ban");
    }
    match.bans = cleaned;
    match.phase = "loadout";
    cleaned.forEach(function (b) {
      log(match, b.side + " 阵营 ban：" + (b.name || b.uid), { kind: "ban", side: b.side, uid: b.uid });
    });
    return clone(match.bans);
  }

  function normalizeCard(card, role) {
    const tags = card.tags || card.pvpTags || {};
    return {
      uid: String(card.uid || ((card.poolId || "") + "::" + (card.id || card.name))),
      id: String(card.id || ""),
      poolId: String(card.poolId || ""),
      poolName: String(card.poolName || ""),
      name: String(card.name || ""),
      rarity: String(card.rarity || "").toUpperCase(),
      side: card.side || (role === "player" ? "player" : "contractor"),
      desc: String(card.desc || ""),
      tags: clone(tags),
      ir: card.ir || card.pvpIR || null
    };
  }

  function isBanned(match, card) {
    return (match.bans || []).some(function (b) {
      if (b.uid && card.uid) return b.uid === card.uid;
      return b.name && card.name && b.name === card.name;
    });
  }

  function submitLoadouts(match, loadouts) {
    if (!match || match.phase !== "loadout") fail("当前阶段不能提交编成");
    if (!loadouts || !loadouts.A || !loadouts.B) fail("缺少双方编成");
    ["A", "B"].forEach(function (side) {
      const teamData = loadouts[side];
      const playerCards = Array.isArray(teamData.player) ? teamData.player : [];
      const contractorCards = Array.isArray(teamData.contractor) ? teamData.contractor : [];
      if (playerCards.length !== RULES.playerSlots) {
        fail(side + " 玩家必须携带 " + RULES.playerSlots + " 张身份卡");
      }
      if (contractorCards.length !== RULES.contractorSlots) {
        fail(side + " 契约者必须携带 " + RULES.contractorSlots + " 张契约者卡");
      }
      match.teams[side].loadout.player = playerCards.map(function (c) { return normalizeCard(c, "player"); });
      match.teams[side].loadout.contractor = contractorCards.map(function (c) { return normalizeCard(c, "contractor"); });
      match.teams[side].banned = [];
      match.teams[side].loadout.player.concat(match.teams[side].loadout.contractor).forEach(function (c) {
        if (isBanned(match, c)) match.teams[side].banned.push(c.uid);
      });
      log(match, side + " 编成完成：玩家 " + playerCards.length + " 张，契约者 " + contractorCards.length + " 张", {
        kind: "loadout",
        side: side
      });
    });
    match.phase = "battle";
    match.round = 1;
    match.pending = { A: 0, B: 0 };
    startTurn(match, match.order.first);
    log(match, "对战开始：" + match.order.first + " 先手", { kind: "battle_start" });
    return clone(match.teams);
  }

  /* ---------------- 回合与合法性 ---------------- */
  function team(match, side) {
    return match.teams[side];
  }

  function assertBattle(match) {
    if (!match || match.phase !== "battle") fail("对局不在战斗阶段");
    if (match.winner) fail("对局已结束");
  }

  function assertTurn(match, side) {
    assertBattle(match);
    if (!match.turn || match.turn.side !== side) fail("当前不是 " + side + " 的行动回合");
  }

  function isSilenced(match, side) {
    return team(match, side).statuses.silence > 0;
  }

  function startTurn(match, side) {
    match.turn = {
      side: side,
      actions: { player: false, contractor: false, normalAttack: false, pass: false },
      buff: null
    };
    if (isSilenced(match, side)) {
      log(match, side + " 处于沉默，只能空过", { kind: "silence" });
    }
  }

  function legalActions(match) {
    if (!match || match.phase !== "battle" || !match.turn) return [];
    const side = match.turn.side;
    const actions = match.turn.actions;
    if (isSilenced(match, side)) return ["pass"];
    const out = [];
    if (!actions.normalAttack && !actions.pass) {
      if (!actions.player) out.push("playerCard");
      if (!actions.contractor) out.push("contractorCard");
      if (!actions.player && !actions.contractor) out.push("normalAttack");
      out.push("pass");
    }
    return out;
  }

  function playableCards(match, side, role) {
    assertTurn(match, side);
    if (isSilenced(match, side)) return [];
    const t = team(match, side);
    const actionKey = role === "player" ? "player" : "contractor";
    if (match.turn.actions[actionKey]) return [];
    if (match.turn.actions.normalAttack || match.turn.actions.pass) return [];
    return t.loadout[actionKey].filter(function (c) {
      return t.used.indexOf(c.uid) < 0 && !isBanned(match, c);
    }).map(clone);
  }

  function cardBaseDamage(card) {
    if (card && card.pvpBaseDamage != null) return round1(card.pvpBaseDamage);
    const tags = (card && card.tags) || {};
    const rarity = String((card && card.rarity) || "").toUpperCase();
    if (rarity === "N" || rarity === "R") return RULES.damage.N;
    if (rarity === "SR" || rarity === "SSR") return RULES.damage.SR;
    if (rarity === "SP") {
      if (tags.shelterType || tags.buff || tags.summon) return 0;
      return RULES.damage.SP_PURE;
    }
    return 1;
  }

  function addOngoing(match, side, card, opts) {
    opts = opts || {};
    const rounds = Math.max(1, Number(opts.duration || opts.rounds || (card.tags && card.tags.durationRounds) || 1));
    const effect = {
      id: card.uid + ":ongoing:" + Date.now().toString(36) + ":" + match.seq,
      source: card.name,
      kind: opts.kind || "dot",
      amount: round1(opts.amount != null ? opts.amount : 1),
      target: opts.target || "enemy",
      remaining: rounds,
      owner: side
    };
    team(match, side).ongoing.push(effect);
    log(match, "持续效果入列：" + card.name + "（" + effect.kind + " " + effect.amount + "，剩余 " + rounds + " 回合）", {
      kind: "ongoing",
      side: side
    });
    return effect;
  }

  function equipPassive(match, side, card, opts) {
    opts = opts || {};
    const t = team(match, side);
    const old = t.passive;
    const tags = card.tags || {};
    const irPassive = (card.ir && card.ir.pvp && card.ir.pvp.passive) || {};
    const passiveAbility = ((card.ir && card.ir.abilities) || []).find(function (a) { return a.trigger === "PASSIVE"; });
    t.passive = {
      uid: card.uid,
      name: passiveAbility ? passiveAbility.name : card.name,
      source: card.name,
      abilityId: passiveAbility ? passiveAbility.id : null,
      desc: passiveAbility ? abilityDescription(passiveAbility) : "",
      persistent: irPassive.persistent != null ? !!irPassive.persistent : !!(tags.passivePersistent),
      durationRounds: tags.durationRounds,
      uses: irPassive.uses != null ? irPassive.uses : (tags.passiveUses != null ? tags.passiveUses : null)
    };
    log(match, "被动入栏：" + card.name + (old ? "（覆盖 " + old.name + "，旧持续效果保留）" : ""), {
      kind: "passive",
      side: side
    });
    if (t.passive.persistent && opts.ongoing !== false) {
      addOngoing(match, side, card, opts.ongoing || {
        kind: "dot",
        amount: 0,
        duration: t.passive.durationRounds || 1,
        target: "enemy"
      });
    }
  }

  function applyShelter(match, side, card, opts) {
    const t = team(match, side);
    const tags = card.tags || {};
    const ir = (card.ir && card.ir.pvp) || {};
    const type = opts.shelterType || (ir.shelter && ir.shelter.type) || tags.shelterType;
    const rounds = Math.max(1, Number(opts.duration || (ir.shelter && ir.shelter.rounds) || tags.durationRounds || 1));
    if (type === "cleanse") {
      const had = t.statuses.silence > 0;
      t.statuses.silence = 0;
      log(match, "解控：" + t.label + (had ? " 的沉默被清除" : " 当前无控制"), { kind: "shelter", side: side });
    } else if (type === "untargetable") {
      t.statuses.untargetable = Math.max(t.statuses.untargetable, rounds);
      log(match, "无法选中：" + t.label + "（" + rounds + " 回合）", { kind: "shelter", side: side });
    } else if (type === "damage_immune") {
      t.statuses.damageImmune = Math.max(t.statuses.damageImmune, rounds);
      log(match, "免伤：" + t.label + "（" + rounds + " 回合）", { kind: "shelter", side: side });
    }
  }

  function applyControl(match, targetSide, control, rounds) {
    if (!control || control === "none") return false;
    const t = team(match, targetSide);
    if (t.statuses.untargetable > 0) {
      log(match, "控制被「无法选中」抵消：" + t.label, { kind: "control_blocked" });
      return false;
    }
    if (control === "silence") {
      const n = Math.max(1, Number(rounds) || 1);
      t.statuses.silence = Math.max(t.statuses.silence, n);
      log(match, "沉默：" + t.label + "（" + n + " 回合）", { kind: "control", side: targetSide });
      return true;
    }
    log(match, "未知控制类型：" + control);
    return false;
  }

  function queueDamage(match, targetSide, amount, meta) {
    meta = meta || {};
    const t = team(match, targetSide);
    let dmg = round1(amount);
    if (!dmg || dmg <= 0) return 0;
    if (meta.card) {
      const tags = meta.card.tags || {};
      if (t.statuses.ghostInfant && tags.bodyTarget) {
        log(match, "鬼婴无肉体标签，肉体技能无效：" + meta.card.name, { kind: "target_blocked" });
        return 0;
      }
    }
    if (t.statuses.untargetable > 0 && !meta.ignoreUntargetable) {
      log(match, "伤害被「无法选中」抵消：" + t.label, { kind: "damage_blocked" });
      return 0;
    }
    if (t.statuses.damageImmune > 0 && !meta.ignoreImmune) {
      log(match, "伤害被「免伤」抵消：" + t.label, { kind: "damage_blocked" });
      return 0;
    }
    if (t.shield > 0 && !meta.ignoreShield) {
      const absorbed = Math.min(t.shield, dmg);
      t.shield = round1(t.shield - absorbed);
      dmg = round1(dmg - absorbed);
      log(match, "护盾吸收 " + absorbed + " 点：" + t.label + "（剩余护盾 " + t.shield + "）", { kind: "shield" });
    }
    if (dmg <= 0) return 0;
    match.pending[targetSide] = round1((match.pending[targetSide] || 0) + dmg);
    log(match, t.label + " 承受 " + dmg + " 点待结算伤害" + (meta.source ? "（" + meta.source + "）" : ""), {
      kind: "damage_pending",
      side: targetSide,
      amount: dmg
    });
    return dmg;
  }

  function resolveDamageWithBuff(match, side, card, base, opts) {
    let dmg = round1(base);
    const turn = match.turn;
    if (turn && turn.buff && opts.useBuff !== false) {
      const diff = rarityRank(card.rarity) - rarityRank(turn.buff.rarity);
      const zero = RULES.buffZeroCards.indexOf(turn.buff.name) >= 0;
      if (!zero && diff <= RULES.buffMaxRarityGap) {
        dmg = round1(dmg + turn.buff.value);
        log(match, "增益生效：" + turn.buff.name + " +" + turn.buff.value, { kind: "buff_apply" });
        turn.buff = null;
      } else {
        log(match, "增益不生效：" + turn.buff.name + "（稀有度差 " + diff + "）", { kind: "buff_skip" });
      }
    }
    return dmg;
  }

  function synthesizeSteps(card) {
    const p = (card.ir && card.ir.pvp) || {};
    const tags = card.tags || {};
    const steps = [];
    const damage = p.damage != null
      ? Number(p.damage)
      : ((tags.buff || tags.shelterType || tags.summon || tags.passive) ? 0 : cardBaseDamage(card));
    if (damage > 0) steps.push({ op: "DEAL_DAMAGE", amount: damage, trueDamage: !!p.trueDamage });
    if (p.control) steps.push({
      op: "APPLY_CONTROL", control: p.control.type || "silence",
      label: p.control.label || "控制", rounds: p.control.rounds || 1,
      chance: p.control.chance != null ? p.control.chance : 1
    });
    if (p.shelter) steps.push({ op: "APPLY_SHELTER", shelterType: p.shelter.type, rounds: p.shelter.rounds || 1 });
    else if (tags.shelterType) steps.push({ op: "APPLY_SHELTER", shelterType: tags.shelterType, rounds: tags.durationRounds || 1 });
    if (p.buff) steps.push({ op: "GRANT_BUFF", value: p.buff.value || 0 });
    else if (tags.buff) steps.push({ op: "GRANT_BUFF", value: round1(cardBaseDamage(card) * RULES.buffRatio) });
    if (p.ongoing) steps.push({
      op: "ADD_ONGOING", kind: p.ongoing.kind || "dot",
      amount: p.ongoing.amount || 0, rounds: p.ongoing.rounds || 1,
      target: p.ongoing.target || "enemy"
    });
    else if (tags.ongoingEffect) steps.push({
      op: "ADD_ONGOING", kind: "dot", amount: 1,
      rounds: tags.durationRounds || 1, target: "enemy"
    });
    if (p.summon) steps.push({ op: "SUMMON", count: p.summon.count || 1, hp: p.summon.hp || 1 });
    else if (tags.summon) steps.push({ op: "SUMMON", count: 1, hp: 1 });
    if (p.heal) steps.push({ op: "HEAL", amount: p.heal });
    if (p.shield) steps.push({ op: "GRANT_SHIELD", amount: p.shield.amount || 0, rounds: p.shield.rounds || 2 });
    if (p.selfDamage) steps.push({ op: "SELF_DAMAGE", amount: p.selfDamage });
    if (p.special) steps.push({ op: "SET_SPECIAL", special: p.special });
    if (p.narrative) steps.push({ op: "NARRATIVE", text: card.desc ? String(card.desc).slice(0, 120) : "叙事效果" });
    return steps;
  }

  function cardAbilities(card) {
    const real = card.ir && card.ir.abilities;
    if (Array.isArray(real) && real.length) return real;
    const p = (card.ir && card.ir.pvp) || {};
    const out = [{
      id: "default",
      name: "卡牌效果",
      trigger: "ACTIVE",
      target: "enemy",
      narrative: !!p.narrative,
      conditions: [],
      steps: synthesizeSteps(card)
    }];
    if ((card.tags && card.tags.passive) || p.passive) {
      out.push({ id: "passive", name: "被动效果", trigger: "PASSIVE", steps: [], conditions: [] });
    }
    return out;
  }

  function abilityDescription(ability) {
    if (ability && ability.description) return String(ability.description);
    const parts = [];
    (ability.steps || []).forEach(function (s) {
      if (s.op === "DEAL_DAMAGE") parts.push("造成 " + (s.amount == null ? 1 : s.amount) + " 点伤害" + (s.trueDamage ? "（真伤）" : ""));
      else if (s.op === "APPLY_CONTROL") parts.push((s.label || "控制") + " " + (s.rounds || 1) + " 回合");
      else if (s.op === "APPLY_SHELTER") {
        const label = { cleanse: "解控", untargetable: "无法选中", damage_immune: "免伤" }[s.shelterType] || s.shelterType;
        parts.push(label + " " + (s.rounds || 1) + " 回合");
      } else if (s.op === "GRANT_BUFF") parts.push("增益 +" + (s.value || 0));
      else if (s.op === "ADD_ONGOING") parts.push((s.kind === "heal" ? "持续治疗" : "持续伤害") + " " + (s.amount || 0) + "×" + (s.rounds || 1));
      else if (s.op === "SUMMON") parts.push("召唤 " + (s.count || 1) + " 个");
      else if (s.op === "HEAL") parts.push("治疗 " + (s.amount || 0));
      else if (s.op === "GRANT_SHIELD") parts.push("护盾 " + (s.amount || 0));
      else if (s.op === "SELF_DAMAGE") parts.push("自伤 " + (s.amount || 0));
      else if (s.op === "SET_SPECIAL") parts.push("特殊状态 " + s.special);
      else if (s.op === "CLEANSE") parts.push("解控");
      else if (s.op === "NARRATIVE") parts.push("裁判裁定：" + String(s.text || "按卡面处理").slice(0, 80));
    });
    return parts.join("；") || (ability && ability.trigger === "PASSIVE" ? "被动效果：持续生效，详见卡面" : "按卡面效果处理");
  }

  function abilityCategories(ability) {
    const cats = [];
    const add = function (c) { if (cats.indexOf(c) < 0) cats.push(c); };
    if (ability && ability.trigger === "PASSIVE") add("被动");
    (ability && ability.steps || []).forEach(function (s) {
      if (s.op === "DEAL_DAMAGE") add("伤害");
      else if (s.op === "APPLY_CONTROL") add("控制");
      else if (s.op === "GRANT_BUFF") add("增益");
      else if (s.op === "APPLY_SHELTER") add("庇护");
      else if (s.op === "ADD_ONGOING") add(s.kind === "heal" ? "治疗" : "持续");
      else if (s.op === "SUMMON") add("召唤");
      else if (s.op === "HEAL" || s.op === "GRANT_SHIELD") add("治疗/护盾");
      else if (s.op === "SELF_DAMAGE" || s.op === "SET_SPECIAL") add("特殊");
      else if (s.op === "CLEANSE") add("解控");
      else if (s.op === "NARRATIVE") add("叙事");
    });
    return cats.length ? cats : ["其他"];
  }

  function conditionStatus(match, side, card, ability) {
    const t = team(match, side);
    const e = team(match, opponent(side));
    const pct = function (x) { return x.maxHp ? (x.hp / x.maxHp) * 100 : 0; };
    const conditions = ((ability && ability.conditions) || []).map(function (c) {
      let met = false;
      const v = c.value;
      switch (c.type) {
        case "hp_below": met = pct(t) <= Number(v); break;
        case "hp_above": met = pct(t) >= Number(v); break;
        case "enemy_hp_below": met = pct(e) <= Number(v); break;
        case "enemy_hp_above": met = pct(e) >= Number(v); break;
        case "round_min": met = (match.round || 0) >= Number(v); break;
        case "round_max": met = (match.round || 0) <= Number(v); break;
        case "has_status": met = !!t.statuses[v] && Number(t.statuses[v]) !== 0; break;
        case "enemy_status": met = !!e.statuses[v] && Number(e.statuses[v]) !== 0; break;
        case "flag": met = !!(t.flags && t.flags[v]); break;
        case "enemy_flag": met = !!(e.flags && e.flags[v]); break;
        case "loadout_name_contains":
          met = ["player", "contractor"].some(function (role) {
            return (t.loadout[role] || []).some(function (x) { return String(x.name || "").indexOf(v) >= 0; });
          });
          break;
        case "loadout_tag":
          met = ["player", "contractor"].some(function (role) {
            return (t.loadout[role] || []).some(function (x) { return x.tags && x.tags[v]; });
          });
          break;
        case "passive_name": met = !!(t.passive && String(t.passive.name || "").indexOf(v) >= 0); break;
        case "enemy_count_min": met = 2 >= Number(v); break;
        case "enemy_count_max": met = 2 <= Number(v); break;
        case "chance": met = true; break;
        default: met = false;
      }
      return {
        type: c.type || "unknown",
        value: v,
        label: c.label || (c.type || "未知条件") + " " + (v == null ? "" : v),
        met: met
      };
    });
    return { met: conditions.every(function (c) { return c.met; }), conditions: conditions };
  }

  function legalAbilities(match, side, card) {
    return cardAbilities(card).filter(function (a) { return a.trigger === "ACTIVE"; }).map(function (a) {
      const cs = conditionStatus(match, side, card, a);
      return Object.assign({}, a, { conditionStatus: cs, legal: cs.met });
    });
  }

  function executeAbility(match, side, card, ability, opts) {
    const t = team(match, side);
    const steps = ability.steps || [];
    let enemyDamage = 0, selfDamage = 0, heal = 0, shield = 0;
    let control = null, shelter = null, ongoing = null, summon = null, buff = null, special = null;
    let narrative = false;

    steps.forEach(function (step) {
      switch (step.op) {
        case "DEAL_DAMAGE":
          if (step.target === "self") selfDamage += Number(step.amount) || 0;
          else enemyDamage += Number(step.amount) || 0;
          break;
        case "APPLY_CONTROL": control = control || step; break;
        case "APPLY_SHELTER": shelter = shelter || step; break;
        case "GRANT_BUFF": buff = buff || step; break;
        case "ADD_ONGOING": ongoing = ongoing || step; break;
        case "SUMMON": summon = summon || step; break;
        case "HEAL": heal += Number(step.amount) || 0; break;
        case "GRANT_SHIELD": shield += Number(step.amount) || 0; break;
        case "SELF_DAMAGE": selfDamage += Number(step.amount) || 0; break;
        case "SET_SPECIAL": special = step.special; break;
        case "CLEANSE":
          t.statuses.silence = 0;
          log(match, "解控：" + t.label, { kind: "shelter", side: side });
          break;
        case "NARRATIVE":
          narrative = true;
          log(match, "裁判裁定（" + card.name + "）：" + (step.text || ""), { kind: "narrative", side: side });
          break;
      }
    });

    if (opts.damage != null) enemyDamage = Number(opts.damage) || 0;
    if (opts.selfDamage != null) selfDamage = Number(opts.selfDamage) || 0;
    if (opts.heal != null) heal = Number(opts.heal) || 0;
    if (opts.shield != null) shield = Number(opts.shield) || 0;
    if (opts.control && opts.control !== "none") {
      control = { control: opts.control, label: "控制", rounds: Number(opts.controlRounds) || 1, chance: 1 };
    }
    const hasOngoingStep = steps.some(function (s) { return s.op === "ADD_ONGOING"; });
    if (opts.ongoing && hasOngoingStep) {
      ongoing = {
        kind: opts.ongoing.kind || "dot",
        amount: opts.ongoing.amount,
        rounds: opts.ongoing.duration || opts.ongoing.rounds || 1,
        target: opts.ongoing.target || "enemy"
      };
    }

    if (buff) {
      const value = round1(opts.buffValue != null ? Number(opts.buffValue) : Number(buff.value) || 0);
      match.turn.buff = { uid: card.uid, name: card.name, rarity: card.rarity, value: value };
      log(match, "增益就绪：" + card.name + "（+" + value + "）", { kind: "buff_ready", side: side });
    }

    if (shelter) {
      applyShelter(match, side, card, { shelterType: shelter.shelterType, duration: shelter.rounds });
    }

    if (summon) {
      const count = Math.max(1, Number(summon.count) || 1);
      const hp = Math.max(1, Number(summon.hp) || 1);
      for (let i = 0; i < count; i++) {
        t.summons.push({ uid: card.uid + ":a" + i, name: card.name, hp: hp, maxHp: hp, round: match.round });
      }
      log(match, "召唤物入场：" + card.name + " ×" + count + "（" + hp + " HP）", { kind: "summon", side: side });
    }

    if (ongoing) {
      addOngoing(match, side, card, {
        kind: ongoing.kind || "dot",
        amount: ongoing.amount != null ? ongoing.amount : 1,
        duration: ongoing.rounds || 1,
        target: ongoing.target || "enemy"
      });
    }

    const trueDamage = opts.trueDamage != null
      ? !!opts.trueDamage
      : steps.some(function (s) { return s.op === "DEAL_DAMAGE" && s.trueDamage; });
    let dmg = round1(enemyDamage);
    if (!buff && dmg > 0) dmg = resolveDamageWithBuff(match, side, card, dmg, opts);
    if (dmg > 0) {
      queueDamage(match, opponent(side), dmg, {
        card: card,
        source: card.name + (ability.name ? "·" + ability.name : ""),
        trueDamage: trueDamage,
        ignoreUntargetable: !!opts.ignoreUntargetable,
        ignoreImmune: !!opts.ignoreImmune,
        ignoreShield: !!opts.ignoreShield
      });
    }

    if (control) {
      const chance = opts.controlChance != null ? Number(opts.controlChance) : Number(control.chance != null ? control.chance : 1);
      if (chance < 1 && nextRandom(match) > chance) {
        log(match, "控制未命中：" + card.name + "（概率 " + Math.round(chance * 100) + "%）", { kind: "control_miss", side: side });
      } else {
        applyControl(match, opponent(side), control.control || "silence", control.rounds || 1);
      }
    }

    if (heal > 0) {
      t.hp = Math.min(t.maxHp, round1(t.hp + heal));
      log(match, "治疗：" + t.label + " +" + round1(heal) + " HP（剩余 " + t.hp + "）", { kind: "heal", side: side });
    }

    if (shield > 0) {
      t.shield = round1(t.shield + shield);
      log(match, "护盾：" + t.label + " +" + round1(shield) + "（当前 " + t.shield + "）", { kind: "shield", side: side });
    }

    if (special === "GHOST_INFANT") {
      t.statuses.ghostInfant = true;
      t.statuses.bodyTarget = false;
      t.statuses.bodyBuff = false;
      t.hp = 1;
      log(match, "转化为鬼婴：" + t.label + "（HP 锁定 1）", { kind: "special", side: side });
    }

    if (selfDamage > 0) {
      t.hp = round1(t.hp - selfDamage);
      log(match, "自伤：" + t.label + " -" + selfDamage + " HP（剩余 " + t.hp + "）", { kind: "self_damage", side: side });
      if (t.hp <= 0) checkWinner(match);
    }

    return {
      ability: ability.name,
      damage: dmg,
      heal: heal,
      shield: shield,
      control: control ? (control.control || "silence") : "none",
      narrative: narrative
    };
  }

  function playCard(match, side, role, uid, opts) {
    opts = opts || {};
    assertTurn(match, side);
    if (isSilenced(match, side)) fail("沉默状态下不能出卡");
    const actionKey = role === "player" ? "player" : "contractor";
    if (match.turn.actions[actionKey]) fail("本回合已经使用过" + (role === "player" ? "玩家卡" : "契约者卡"));
    if (match.turn.actions.normalAttack || match.turn.actions.pass) fail("本回合已选择普攻或空过");
    const t = team(match, side);
    const card = t.loadout[actionKey].find(function (c) { return c.uid === uid; });
    if (!card) fail("卡牌不在编成中");
    if (t.used.indexOf(uid) >= 0) fail("该卡整场已经使用过");
    if (isBanned(match, card)) fail("该卡已被 ban，不能使用");
    const tags = card.tags || {};
    const ir = (card.ir && card.ir.pvp) || {};
    const abilities = cardAbilities(card);
    const activeAbilities = abilities.filter(function (a) { return a.trigger === "ACTIVE"; });
    let selected = [];
    if (Array.isArray(opts.abilityIds) && opts.abilityIds.length) {
      const seen = {};
      selected = opts.abilityIds.map(function (id) {
        if (seen[id]) fail("技能重复选择");
        seen[id] = true;
        const a = activeAbilities.find(function (x) { return x.id === id; });
        if (!a) fail("技能不存在或不是主动技能：" + id);
        return a;
      });
    } else if (opts.abilityId) {
      const a = activeAbilities.find(function (x) { return x.id === opts.abilityId; });
      if (!a) fail("技能不存在或不是主动技能");
      selected = [a];
    } else if (activeAbilities.length) {
      selected = [activeAbilities[0]];
    }
    selected.forEach(function (a) {
      const cs = conditionStatus(match, side, card, a);
      if (!cs.met) {
        const unmet = cs.conditions.filter(function (c) { return !c.met; }).map(function (c) { return c.label; }).join("、");
        fail("技能「" + a.name + "」未满足触发条件：" + unmet);
      }
    });
    const abilityNarrative = selected.some(function (a) {
      return a.narrative || (a.steps || []).some(function (s) { return s.op === "NARRATIVE"; });
    }) || (!activeAbilities.length && ir.narrative);
    if (opts.hidden && ir.hidden === false) fail("该卡不允许暗放");
    if (abilityNarrative && opts.confirmNarrative !== true) {
      fail("叙事卡需裁判确认后才能出卡");
    }

    t.used.push(uid);
    match.turn.actions[actionKey] = true;

    log(match, side + " 使用" + (role === "player" ? "玩家卡" : "契约者卡") + "：" + card.name, {
      kind: "play",
      side: side,
      role: role,
      uid: uid
    });

    if (opts.hidden) {
      match.hidden.push({ side: side, uid: uid, name: card.name, round: match.round, revealed: false });
      log(match, "暗放：" + card.name + "（裁判可见，等待触发）", { kind: "hidden", side: side, uid: uid });
    }

    if (tags.passive || ir.passive || abilities.some(function (a) { return a.trigger === "PASSIVE"; })) {
      const passiveOpts = Object.assign({}, opts);
      if (tags.ongoingEffect || (ir && ir.ongoing)) passiveOpts.ongoing = false;
      equipPassive(match, side, card, passiveOpts);
    }

    const runOpts = selected.length === 1 ? opts : Object.assign({}, opts, {
      damage: null, control: null, controlRounds: null, ongoing: null,
      buffValue: null, heal: null, shield: null, selfDamage: null, trueDamage: null
    });
    const results = selected.map(function (a) {
      log(match, "技能触发：" + a.name + "（" + abilityDescription(a) + "）", {
        kind: "ability", side: side, abilityId: a.id
      });
      return executeAbility(match, side, card, a, runOpts);
    });
    const sum = function (key) {
      return round1(results.reduce(function (n, r) { return n + (Number(r[key]) || 0); }, 0));
    };
    return {
      card: clone(card),
      abilities: selected.map(function (a) { return a.name; }),
      abilityIds: selected.map(function (a) { return a.id; }),
      results: results,
      damage: sum("damage"),
      heal: sum("heal"),
      shield: sum("shield"),
      passive: t.passive ? clone(t.passive) : null,
      buff: match.turn && match.turn.buff ? clone(match.turn.buff) : null
    };
  }

  function normalAttack(match, side) {
    assertTurn(match, side);
    if (isSilenced(match, side)) fail("沉默状态下不能平a");
    if (match.turn.actions.player || match.turn.actions.contractor) fail("普攻占用整回合，不能与卡牌同用");
    if (match.turn.actions.normalAttack || match.turn.actions.pass) fail("本回合已经行动");
    match.turn.actions.normalAttack = true;
    log(match, side + " 使用平a（1 点真实伤害）", { kind: "normal_attack", side: side });
    const dmg = RULES.normalAttackDamage;
    queueDamage(match, opponent(side), dmg, {
      source: "平a",
      trueDamage: true,
      ignoreShield: false
    });
    endTurn(match);
    return dmg;
  }

  function passTurn(match, side) {
    assertTurn(match, side);
    if (match.turn.actions.pass) fail("本回合已经空过");
    match.turn.actions.pass = true;
    log(match, side + " 空过", { kind: "pass", side: side });
    endTurn(match);
    return true;
  }

  function endTurn(match) {
    assertBattle(match);
    if (!match.turn) fail("当前没有行动回合");
    const side = match.turn.side;
    const t = team(match, side);
    if (t.statuses.silence > 0) {
      t.statuses.silence = Math.max(0, t.statuses.silence - 1);
      log(match, side + " 沉默回合结束（剩余 " + t.statuses.silence + "）", { kind: "silence_tick" });
    }
    if (side === match.order.second) {
      resolveRound(match);
    } else {
      startTurn(match, match.order.second);
      log(match, "轮到 " + match.order.second + " 行动（第 " + match.round + " 回合）", { kind: "turn" });
    }
    return clone(match.turn);
  }

  function tickOngoing(match, side) {
    const t = team(match, side);
    if (!t.ongoing.length) return;
    const keep = [];
    t.ongoing.forEach(function (effect) {
      let targetSide = effect.target === "self" ? side : opponent(side);
      if (effect.kind === "dot") {
        const dmg = round1(effect.amount);
        if (dmg > 0) {
          const target = team(match, targetSide);
          target.hp = round1(target.hp - dmg);
          log(match, "持续伤害：" + effect.source + " → " + target.label + " -" + dmg, {
            kind: "ongoing_tick",
            side: targetSide,
            amount: dmg
          });
        }
      } else if (effect.kind === "heal") {
        const target = team(match, targetSide);
        const heal = round1(effect.amount);
        target.hp = Math.min(target.maxHp, round1(target.hp + heal));
        log(match, "持续治疗：" + effect.source + " → " + target.label + " +" + heal, {
          kind: "ongoing_tick",
          side: targetSide,
          amount: heal
        });
      }
      effect.remaining = (Number(effect.remaining) || 0) - 1;
      if (effect.remaining > 0) keep.push(effect);
      else log(match, "持续效果结束：" + effect.source, { kind: "ongoing_expire", side: side });
    });
    t.ongoing = keep;
  }

  function tickStatuses(match, side) {
    const s = team(match, side).statuses;
    ["untargetable", "damageImmune"].forEach(function (k) {
      if (s[k] > 0) s[k] = Math.max(0, s[k] - 1);
    });
  }

  function checkWinner(match) {
    const A = team(match, "A"), B = team(match, "B");
    if (A.hp <= 0 && B.hp <= 0) {
      match.phase = "ended";
      match.winner = "draw";
      match.turn = null;
      log(match, "双方契约者同时归零：平局", { kind: "end", winner: "draw" });
      return true;
    }
    if (A.hp <= 0 || B.hp <= 0) {
      match.phase = "ended";
      match.winner = A.hp <= 0 ? "B" : "A";
      match.turn = null;
      log(match, (match.winner === "A" ? A.label : B.label) + " 获胜", { kind: "end", winner: match.winner });
      return true;
    }
    return false;
  }

  function resolveRound(match) {
    const A = team(match, "A"), B = team(match, "B");
    const dmgA = round1(match.pending.A || 0);
    const dmgB = round1(match.pending.B || 0);
    match.pending = { A: 0, B: 0 };
    if (dmgA > 0) {
      A.hp = round1(A.hp - dmgA);
      log(match, "回合结算：" + A.label + " -" + dmgA + " HP（剩余 " + A.hp + "）", { kind: "round_damage", side: "A", amount: dmgA });
    }
    if (dmgB > 0) {
      B.hp = round1(B.hp - dmgB);
      log(match, "回合结算：" + B.label + " -" + dmgB + " HP（剩余 " + B.hp + "）", { kind: "round_damage", side: "B", amount: dmgB });
    }
    tickOngoing(match, "A");
    tickOngoing(match, "B");
    tickStatuses(match, "A");
    tickStatuses(match, "B");
    if (checkWinner(match)) return clone(match);
    match.round++;
    startTurn(match, match.order.first);
    log(match, "第 " + match.round + " 回合开始，先手 " + match.order.first, { kind: "round" });
    return clone(match);
  }

  /* ---------------- 裁判操作 ---------------- */
  function refereeAdjustHp(match, side, delta, reason) {
    const t = team(match, side);
    const before = t.hp;
    t.hp = Math.max(0, Math.min(t.maxHp, round1(t.hp + (Number(delta) || 0))));
    log(match, "裁判调整 HP：" + t.label + " " + (t.hp >= before ? "+" : "") + round1(t.hp - before) + " → " + t.hp + (reason ? "（" + reason + "）" : ""), {
      kind: "referee_hp",
      side: side
    });
    if (t.hp <= 0) checkWinner(match);
    return t.hp;
  }

  function refereeSetStatus(match, side, status, rounds, reason) {
    const t = team(match, side);
    const n = Math.max(1, Number(rounds) || 1);
    if (status === "silence") t.statuses.silence = n;
    else if (status === "untargetable") t.statuses.untargetable = n;
    else if (status === "damage_immune") t.statuses.damageImmune = n;
    else if (status === "ghost_infant") {
      t.statuses.ghostInfant = true;
      t.statuses.bodyTarget = false;
      t.statuses.bodyBuff = false;
      t.hp = 1;
    } else fail("未知裁判状态：" + status);
    log(match, "裁判设置状态：" + t.label + " → " + status + "（" + n + " 回合）" + (reason ? "（" + reason + "）" : ""), {
      kind: "referee_status",
      side: side
    });
    return clone(t.statuses);
  }

  function refereeClearGhostInfant(match, side) {
    const t = team(match, side);
    t.statuses.ghostInfant = false;
    t.statuses.bodyTarget = true;
    t.statuses.bodyBuff = true;
    log(match, "裁判解除鬼婴状态：" + t.label, { kind: "referee_status", side: side });
    return clone(t.statuses);
  }

  function revealHidden(match) {
    let n = 0;
    (match.hidden || []).forEach(function (h) {
      if (!h.revealed) { h.revealed = true; n++; }
    });
    if (n) log(match, "裁判揭示暗放 " + n + " 条", { kind: "reveal" });
    return n;
  }

  function refereeLog(match, text) {
    log(match, "裁判记录：" + text, { kind: "referee_note" });
    return true;
  }

  function snapshot(match) {
    const snap = clone(match);
    snap.currentSide = match.turn ? match.turn.side : null;
    snap.legalActions = match.phase === "battle" ? legalActions(match) : [];
    return snap;
  }

  function serialize(match) {
    return JSON.stringify(match);
  }

  function deserialize(text) {
    let match;
    try { match = typeof text === "string" ? JSON.parse(text) : text; }
    catch (e) { fail("对局存档解析失败", "PVP_PARSE"); }
    if (!match || match.version !== VERSION) fail("对局存档版本不兼容", "PVP_VERSION");
    return match;
  }

  global.SDJPvpEngine = {
    VERSION: VERSION,
    RULES: RULES,
    createMatch: createMatch,
    rollInitiative: rollInitiative,
    submitBans: submitBans,
    submitLoadouts: submitLoadouts,
    legalActions: legalActions,
    playableCards: playableCards,
    cardAbilities: cardAbilities,
    legalAbilities: legalAbilities,
    conditionStatus: conditionStatus,
    abilityDescription: abilityDescription,
    abilityCategories: abilityCategories,
    playCard: playCard,
    normalAttack: normalAttack,
    passTurn: passTurn,
    endTurn: endTurn,
    cardBaseDamage: cardBaseDamage,
    rarityRank: rarityRank,
    refereeAdjustHp: refereeAdjustHp,
    refereeSetStatus: refereeSetStatus,
    refereeClearGhostInfant: refereeClearGhostInfant,
    revealHidden: revealHidden,
    refereeLog: refereeLog,
    snapshot: snapshot,
    serialize: serialize,
    deserialize: deserialize,
    clone: clone
  };
})(window);
