/* 神降计划·塔 · PVP 队内频道（独立模块）
 * 优先 Supabase Realtime Broadcast；无云端时自动降级为同浏览器 BroadcastChannel / localStorage。
 */
(function (global) {
  "use strict";

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function makeRoom(matchId, side) {
    const base = String(matchId || "match").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 26);
    return base + "-" + side + "-" + Math.random().toString(36).slice(2, 8);
  }

  function parseSide(room) {
    const parts = String(room || "").split("-");
    return parts.indexOf("A") >= 0 ? "A" : (parts.indexOf("B") >= 0 ? "B" : "");
  }

  function publicSnapshot(match, side) {
    const opp = side === "A" ? "B" : "A";
    const pack = function (t, full) {
      const out = {
        label: t.label,
        player: { name: t.player && t.player.name },
        contractor: { name: t.contractor && t.contractor.name },
        hp: t.hp,
        maxHp: t.maxHp,
        shield: t.shield,
        statuses: clone(t.statuses || {}),
        flags: clone(t.flags || {}),
        passive: t.passive ? clone(t.passive) : null,
        ongoing: clone(t.ongoing || []),
        summons: clone(t.summons || [])
      };
      if (full) out.loadout = { player: clone(t.loadout.player || []), contractor: clone(t.loadout.contractor || []) };
      return out;
    };
    return {
      room: (match.teamRooms && match.teamRooms[side]) || "",
      side: side,
      phase: match.phase,
      winner: match.winner,
      round: match.round,
      turnSide: match.turn ? match.turn.side : null,
      order: clone(match.order || {}),
      own: pack(match.teams[side], true),
      enemy: pack(match.teams[opp], false)
    };
  }

  async function connect(room, onMessage) {
    const name = "sdj-pvp-" + String(room || "").replace(/[^a-zA-Z0-9_-]/g, "");
    if (global.SDJCloud && typeof global.SDJCloud.broadcastChannel === "function") {
      const cloud = await global.SDJCloud.broadcastChannel(name, onMessage);
      if (cloud) {
        cloud.mode = "cloud";
        return cloud;
      }
    }
    if (typeof BroadcastChannel !== "undefined") {
      const bc = new BroadcastChannel(name);
      bc.onmessage = function (e) { if (e.data) onMessage(e.data); };
      return {
        mode: "tab",
        send: function (p) { bc.postMessage(p); },
        close: function () { bc.close(); }
      };
    }
    const key = "sdj_pvp_team_msg_" + String(room || "");
    const onStorage = function (e) {
      if (e.key !== key || !e.newValue) return;
      try { onMessage(JSON.parse(e.newValue).payload); } catch (err) { /* ignore */ }
    };
    global.addEventListener("storage", onStorage);
    return {
      mode: "local",
      send: function (p) {
        try { localStorage.setItem(key, JSON.stringify({ payload: p, ts: Date.now(), nonce: Math.random() })); } catch (e) { /* ignore */ }
      },
      close: function () { global.removeEventListener("storage", onStorage); }
    };
  }

  global.SDJPvpTeam = {
    makeRoom: makeRoom,
    parseSide: parseSide,
    publicSnapshot: publicSnapshot,
    connect: connect
  };
})(window);
