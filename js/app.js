/* 神降计划·塔 - 应用主逻辑（路由 / 登录 / 注册 / 找回密码 / 主控台） */
(function () {
  "use strict";

  const app = document.getElementById("app");

  /* =========================================================
   *  1. 核心状态与路由配置
   * ========================================================= */
  const SESSION_KEY = "sdj_session";
  // 公开部署时可通过 config.js 关闭管理者自助注册；adminInvite 为空字符串时不再回退到内置码
  const ADMIN_INVITE_CODE = (window.SDJ_CONFIG && typeof window.SDJ_CONFIG.adminInvite === "string")
    ? window.SDJ_CONFIG.adminInvite
    : "TOWER_ADMIN_2026";
  const ALLOW_ADMIN_REGISTER = !(window.SDJ_CONFIG && window.SDJ_CONFIG.allowAdminRegister === false);
  
  const routes = {
    "/login": renderLogin,
    "/register": renderRegister,
    "/forgot-password": renderForgotPassword,
    "/app": renderMainApp,
    "/forum/new": renderForumNewPage
  };

  function getPath() { return location.hash.replace(/^#/, "") || "/login"; }
  function navigate(path) { location.hash !== "#" + path ? location.hash = path : render(); }
  function render() {
    // 先清理上一个视图（时钟 / 地图引擎 / 全局监听），再渲染新视图，避免误清理新视图
    if (window._cleanupMainApp) {
      window._cleanupMainApp();
      window._cleanupMainApp = null;
    }
    const path = getPath();
    const postMatch = path.match(/^\/forum\/post\/([^/]+)$/);
    let fn;
    if (postMatch) fn = (root) => renderForumDetailPage(root, decodeURIComponent(postMatch[1]));
    else fn = routes[path] || renderLogin;
    app.innerHTML = "";
    fn(app);
    app.scrollTop = 0;
    // 回归测试台用它判断「新页面已经完成首帧渲染」，避免 iframe 在旧文档上跑用例
    window.SDJ_APP_READY = { path, at: Date.now() };
  }
  window.addEventListener("hashchange", render);

  // 会话按标签页隔离：sessionStorage 为当前标签页身份，localStorage 仅保存“最近登录”
  // 修复同一浏览器双账号并行时，后登录账号覆盖前者身份导致消息左右归属错乱
  const readTabSession = () => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  };
  const getSession = () => {
    const tab = readTabSession();
    if (tab) return tab;
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; } catch (e) { return null; }
  };
  const setSession = (s) => {
    const raw = JSON.stringify(s);
    try { localStorage.setItem(SESSION_KEY, raw); } catch (e) { /* ignore */ }
    try { sessionStorage.setItem(SESSION_KEY, raw); } catch (e) { /* ignore */ }
  };
  const clearSession = () => {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
  };

  /* =========================================================
   *  本地账号系统：口令加盐 SHA-256（不再明文落盘）
   *  说明：静态站点无法提供真正的服务端鉴权，跨设备/多人数据需接后端（见部署说明）
   * ========================================================= */
  const ACCOUNTS_KEY = "sdj_accounts";

  function getAccounts() {
    try { const arr = JSON.parse(localStorage.getItem(ACCOUNTS_KEY)); return Array.isArray(arr) ? arr : []; } catch (e) { return []; }
  }
  function saveAccounts(list) { try { localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(list)); } catch (e) {} }

  function fallbackHash(text) {
    let h1 = 0x811c9dc5, h2 = 0x1000193;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      h1 = (h1 ^ c) * 0x01000193 >>> 0;
      h2 = (h2 + c * (i + 7)) * 0x85ebca6b >>> 0;
    }
    return ("0000000" + h1.toString(16)).slice(-8) + ("0000000" + h2.toString(16)).slice(-8);
  }

  async function hashPassword(password, salt) {
    const text = salt + "::" + password;
    if (window.crypto && window.crypto.subtle) {
      try {
        const buf = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
      } catch (e) { /* 回退到弱哈希 */ }
    }
    return fallbackHash(text);
  }

  function makeSalt() {
    if (window.crypto && window.crypto.getRandomValues) {
      const arr = new Uint8Array(12);
      window.crypto.getRandomValues(arr);
      return Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
    }
    return String(Date.now()) + Math.random().toString(16).slice(2, 10);
  }

  /* =========================================================
   *  2. 通用 UI 工具
   * ========================================================= */
  const SVG_TAGS = new Set(["svg","path","circle","line","ellipse","rect","polygon","polyline","g","text","tspan","defs","use","symbol","marker","clipPath","mask","pattern","linearGradient","radialGradient","stop","image","foreignObject"]);
  const SVG_NS = "http://www.w3.org/2000/svg";

  function el(tag, attrs, ...children) {
    const isSvg = SVG_TAGS.has(tag);
    const node = isSvg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (k === "class") isSvg ? node.setAttribute("class", attrs[k]) : node.className = attrs[k];
        else if (k === "style") node.setAttribute("style", attrs[k]);
        else if (k === "innerHTML") node.innerHTML = attrs[k];
        else if (k === "textContent") node.textContent = attrs[k];
        else if (k.startsWith("@") && typeof attrs[k] === "function") node.addEventListener(k.slice(1), attrs[k]);
        else if (attrs[k] != null) node.setAttribute(k, attrs[k]);
      }
    }
    for (const c of children) {
      if (c == null) continue;
      if (typeof c === "string" || typeof c === "number") node.appendChild(document.createTextNode(String(c)));
      else if (Array.isArray(c)) c.forEach(x => x && node.appendChild(x));
      else node.appendChild(c);
    }
    return node;
  }

  // 图标库
  const icons = {
    person: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg>`,
    lock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`,
    mail: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M3 7l9 6 9-6"/></svg>`,
    check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l5 5L20 6"/></svg>`,
    key: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="14" r="4"/><path d="M10 12l10-7M16 8l3 3M14 10l2 2"/></svg>`,
    dashboard: `<svg viewBox="0 0 24 24"><path d="M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm10 0h8v8h-8v-8z"/></svg>`,
    map: `<svg viewBox="0 0 24 24"><path d="M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z"/></svg>`,
    bag: `<svg viewBox="0 0 24 24"><path d="M19 6h-2c0-2.76-2.24-5-5-5S7 3.24 7 6H5c-1.1 0-1.99.9-1.99 2L3 20c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-7-3c1.66 0 3 1.34 3 3H9c0-1.66 1.34-3 3-3zm0 10c-2.76 0-5-2.24-5-5h2c0 1.66 1.34 3 3 3s3-1.34 3-3h2c0 2.76-2.24 5-5 5z"/></svg>`,
    mission: `<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/></svg>`,
    forum: `<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/></svg>`,
    friend: `<svg viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>`,
    council: `<svg viewBox="0 0 24 24"><path d="M12 2l-5.5 9h11L12 2zm0 3.84L14.61 9H9.39L12 5.84zm-5 8.16c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm10 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-5 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zM2 20h20v2H2v-2z"/></svg>`,
    codex: `<svg viewBox="0 0 24 24"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 9h-4v4h-2v-4H9V9h4V5h2v4h4v2z"/></svg>`,
    member: `<svg viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>`,
    settings: `<svg viewBox="0 0 24 24"><path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.06-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.73,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.06,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.49-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/></svg>`,
    approval: `<svg viewBox="0 0 24 24"><path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1s-2.4.84-2.82 2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-7 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm-2 15l-4-4 1.41-1.41L10 15.17l6.59-6.59L18 10l-8 8z"/></svg>`
  };

  function iconPerson() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg>`; }
  function iconLock() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`; }
  function iconMail() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M3 7l9 6 9-6"/></svg>`; }
  function iconCheck() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l5 5L20 6"/></svg>`; }
  function iconKey() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="14" r="4"/><path d="M10 12l10-7M16 8l3 3M14 10l2 2"/></svg>`; }

  function emblem() { return el("img", { class: "emblem", src: "assets/tower.png", alt: "神降之塔" }); }
  function titleBlock() { 
    return el("div", { class: "title-block" }, 
      el("div", { class: "title-main", "data-text": "神降计划·塔" }, "神降计划·塔"), 
      el("div", { class: "title-sub" }, "DIVINE SURRENDER PLAN")
    ); 
  }
  function pageWrap(children) { 
    return el("div", { class: "page" }, 
      el("img", { class: "starburst-bg", src: "assets/star.png", alt: "starburst" }), 
      emblem(), titleBlock(), ...children
    ); 
  }

  function fieldWrap(labelText, iconSvgNode, opts) {
    const input = el("input", { class: "field-input", type: opts.type || "text", placeholder: opts.placeholder || "", value: opts.value || "", autocomplete: "off" });
    input.addEventListener("input", () => opts.onInput && opts.onInput(input.value));
    return el("div", { class: "field" },
      el("label", { class: "field-label" }, labelText),
      el("div", { class: "field-input-wrap" }, el("div", { class: "field-icon", innerHTML: iconSvgNode }), input),
      el("div", { class: "field-error" }, opts.errorText || "")
    );
  }

  /* =========================================================
   *  3. 加载页 (原封不动保留)
   * ========================================================= */
  function showLoadingScreen(options) {
    options = options || {};
    // 防止重复点击「载入 / 完成注册」叠加出多个加载遮罩
    if (document.querySelector(".loading-screen")) return;
    const duration = options.duration || 3000;
    const eggText = options.eggText || getDefaultEggText();
    const onComplete = options.onComplete || function () {};

    document.body.style.overflow = "hidden";
    const screen = el("div", { class: "loading-screen" });
    const starBg = el("img", { class: "loading-star-bg", src: "assets/star.png", alt: "" });
    const moonRing = el("div", { class: "moon-ring" });
    
    const PHASE_COUNT = 24, CENTER = 110, RADIUS = 88;
    const phaseEls = [];
    for (let i = 0; i < PHASE_COUNT; i++) {
      const angle = (i / PHASE_COUNT) * 2 * Math.PI - Math.PI / 2;
      const cx = CENTER + RADIUS * Math.cos(angle), cy = CENTER + RADIUS * Math.sin(angle);
      const phase = (1 - Math.cos((i / PHASE_COUNT) * 2 * Math.PI)) / 2;
      const offset = (1 - phase) * 12;
      const phaseEl = el("div", { class: "moon-phase", style: `left: ${cx}px; top: ${cy}px; --moon-offset: ${offset}px;` });
      phaseEls.push(phaseEl); moonRing.appendChild(phaseEl);
    }
    
    moonRing.appendChild(el("img", { class: "moon-ring-tower", src: "assets/tower.png", alt: "塔" }));
    const progressFill = el("div", { class: "loading-progress-fill" });
    const progressText = el("div", { class: "loading-progress-text" }, "0%");
    const progressWrap = el("div", { class: "loading-progress-wrap" }, el("div", { class: "loading-progress-bar" }, progressFill), progressText);
    const statusMain = el("div", { class: "loading-status-main" }, "正在建立连接…");
    const statusSub = el("div", { class: "loading-status-sub" }, "ESTABLISHING LINK");
    const statusWrap = el("div", { class: "loading-status" }, statusMain, statusSub);

    screen.appendChild(starBg);
    screen.appendChild(el("div", { class: "loading-content" }, moonRing, progressWrap, statusWrap));
    document.body.appendChild(screen);

    const phases = [
      { start: 0.00, end: 0.30, main: "正在建立连接…", sub: "ESTABLISHING LINK" },
      { start: 0.30, end: 0.65, main: "正在验证密钥…", sub: "VERIFYING CREDENTIALS" },
      { start: 0.65, end: 0.90, main: "正在唤醒塔…", sub: "AWAKENING THE TOWER" },
      { start: 0.90, end: 1.00, main: "系统就绪", sub: "SYSTEM READY" }
    ];

    const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
    const startTime = performance.now();
    let eggShown = false, currentMain = statusMain.textContent;

    function tick(now) {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      const progress = easeOutCubic(t);

      progressFill.style.width = `${progress * 100}%`;
      progressText.textContent = `${Math.round(progress * 100)}%`;

      const cycle = 3500, ct = (elapsed % cycle) / cycle;
      phaseEls.forEach((el, i) => {
        let dist = Math.abs((i / PHASE_COUNT) - ct);
        if (dist > 0.5) dist = 1 - dist;
        const brightness = Math.max(0, 1 - dist * 8);
        el.style.opacity = 0.3 + brightness * 0.7;
      });

      if (t < 1) {
        for (const p of phases) {
          if (t >= p.start && t < p.end) {
            if (currentMain !== p.main) {
              currentMain = p.main; statusMain.textContent = p.main; statusMain.classList.remove("egg");
              statusSub.textContent = p.sub; statusSub.style.opacity = 1;
            }
            break;
          }
        }
      }

      if (t >= 1 && !eggShown) {
        eggShown = true; statusMain.textContent = eggText; statusMain.classList.add("egg");
        statusSub.textContent = ""; statusSub.style.opacity = 0;
      }

      if (t < 1) requestAnimationFrame(tick);
      else {
        setTimeout(() => {
          screen.classList.add("fade-out");
          setTimeout(() => {
            if (screen.parentNode) screen.parentNode.removeChild(screen);
            document.body.style.overflow = "";
            onComplete();
          }, 600);
        }, 800);
      }
    }
    requestAnimationFrame(tick);
  }

  function getDefaultEggText() {
    const s = getSession();
    if (!s) return "欢迎来到神降计划。";
    if (s.role === "admin") return "欢迎回归神降计划隐秘系统，管理者。";
    if (s.role === "contractor") return "契约者，欢迎来到神降计划隐秘系统。";
    return "玩家，欢迎来到神降计划隐秘系统。";
  }

  /* =========================================================
   *  4. 登录与注册 (原封不动保留)
   * ========================================================= */
  function renderLogin(root) {
    let role = "player", name = "", pwd = "", auto = false;

    const page = el("div", { class: "panel" },
      el("div", { class: "panel-inner" },
        el("div", { class: "segmented" },
          el("div", { class: "seg-slider", style: "width: 0; transform: translateX(0);" }),
          el("button", { class: "seg-btn active", "data-role": "player" }, "玩家 / 契约者"),
          el("button", { class: "seg-btn", "data-role": "admin" }, "管理者")
        ),
        el("div", { class: "banner", hidden: true }),
        fieldWrap("姓名", iconPerson(), { placeholder: "请输入姓名", value: name, onInput: v => { name = v; } }),
        fieldWrap("密码", iconLock(), { type: "password", placeholder: "请输入密码", value: pwd, onInput: v => { pwd = v; } }),
        el("div", { class: "form-aux" },
          el("label", { class: "checkbox" }, 
            el("input", { type: "checkbox", "@change": e => auto = e.target.checked }), 
            el("span", { class: "box", innerHTML: iconCheck() }), 
            el("span", {}, "自动登录")
          ),
          el("a", { class: "link", href: "#/forgot-password", textContent: "忘记密码？" })
        ),
        el("button", { class: "btn-primary", "@click": submit }, "载入"),
        el("div", { class: "panel-footer" },
          "是否注册", el("a", { class: "link", href: "#/register", style: "margin: 0 4px;", id: "reg-link" }, "玩家/契约者"), "?"
        )
      )
    );

    const segBtns = page.querySelectorAll(".seg-btn");
    const slider = page.querySelector(".seg-slider");

    function refreshRoleUI() {
      segBtns.forEach(s => s.classList.toggle("active", s.dataset.role === role));
      const activeSeg = Array.from(segBtns).find(s => s.dataset.role === role);
      if (activeSeg && slider) {
        slider.style.width = `${activeSeg.offsetWidth}px`;
        slider.style.transform = `translateX(${activeSeg.offsetLeft}px)`;
      }
      const regLink = page.querySelector("#reg-link");
      if (regLink) regLink.textContent = role === "player" ? "玩家/契约者" : "管理者";
      const nameLabel = page.querySelectorAll(".field-label")[0];
      if (nameLabel) nameLabel.textContent = role === "player" ? "姓名" : "管理者 ID";
      const inputs = page.querySelectorAll(".field-input");
      if (inputs[0]) inputs[0].placeholder = role === "player" ? "请输入姓名" : "请输入管理者 ID";
    }

    segBtns.forEach(btn => btn.addEventListener("click", () => { role = btn.dataset.role; refreshRoleUI(); }));

    async function submit() {
      const banner = page.querySelector(".banner");
      if (!name.trim() || !pwd.trim()) {
        banner.hidden = false; banner.className = "banner"; banner.textContent = "姓名与密码不能为空。"; return;
      }
      banner.hidden = true;

      if (window.SDJCloud && window.SDJCloud.enabled()) {
        const res = await window.SDJCloud.signIn(name.trim(), pwd);
        if (!res.ok) {
          banner.hidden = false; banner.className = "banner"; banner.textContent = res.error; return;
        }
        if (res.profile.banned) {
          if (window.SDJCloud.signOut) window.SDJCloud.signOut();
          banner.hidden = false; banner.className = "banner";
          banner.textContent = "该账号已被移出系统，无法登录。如有疑问请联系管理者。";
          return;
        }
        const wantsAdmin = role === "admin";
        if (wantsAdmin !== (res.profile.role === "admin")) {
          banner.hidden = false; banner.className = "banner";
          banner.textContent = `该账号身份为「${res.profile.role === "admin" ? "管理者" : "玩家/契约者"}」，请切换登入方式。`; return;
        }
        setSession({ role: res.profile.role, displayName: res.profile.display_name, username: res.profile.username, ts: Date.now(), auto });
        ensureMemberRecord(res.profile.username, res.profile.display_name, res.profile.role);
        showLoadingScreen({ onComplete: () => navigate("/app") });
        return;
      }

      const accounts = getAccounts();
      if (accounts.length) {
        const acc = accounts.find(a => a.username.toLowerCase() === name.trim().toLowerCase());
        if (!acc) {
          banner.hidden = false; banner.className = "banner";
          banner.textContent = "该账号不存在，请先注册。"; return;
        }
        const wantsAdmin = role === "admin";
        if (wantsAdmin !== (acc.role === "admin")) {
          banner.hidden = false; banner.className = "banner";
          banner.textContent = `该账号身份为「${acc.role === "admin" ? "管理者" : "玩家/契约者"}」，请切换登入方式。`; return;
        }
        const hash = await hashPassword(pwd, acc.salt);
        if (hash !== acc.hash) {
          banner.hidden = false; banner.className = "banner";
          banner.textContent = "密码错误，请重试。"; return;
        }
        setSession({ role: acc.role, displayName: acc.displayName, username: acc.username, ts: Date.now(), auto });
        ensureMemberRecord(acc.username, acc.displayName, acc.role);
      } else {
        // 尚未建立任何本地账号时保留演示登入
        setSession({ role, displayName: name.trim(), ts: Date.now(), auto });
      }
      showLoadingScreen({ onComplete: () => navigate("/app") });
    }

    function onResize() { refreshRoleUI(); }
    window.addEventListener("resize", onResize);
    window.addEventListener("hashchange", function cleanup() { window.removeEventListener("resize", onResize); window.removeEventListener("hashchange", cleanup); });

    root.appendChild(pageWrap([page]));
    requestAnimationFrame(refreshRoleUI);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(refreshRoleUI);
  }

  function renderRegister(root) {
    const IS_CLOUD = !!(window.SDJCloud && window.SDJCloud.enabled());
    let isAdminReg = false; 
    let normalRole = "player"; 
    let form = { username: "", displayName: "", password: "", confirm: "", inviteCode: "" };
    let errors = { username: "", displayName: "", password: "", confirm: "", inviteCode: "" };

    // 云端模式下邀请码由服务端校验，前端只检查是否填写
    function inviteError(v) {
      if (!isAdminReg) return "";
      const code = String(v || "").trim();
      if (IS_CLOUD) return code ? "" : "请填写邀请码";
      if (!ADMIN_INVITE_CODE) return "本地模式未配置邀请码";
      return code === ADMIN_INVITE_CODE ? "" : "邀请码错误";
    }

    const page = el("div", { class: "panel" },
      el("div", { class: "panel-inner" },
        el("div", { class: "segmented" },
          el("div", { class: "seg-slider", style: "width: 0;" }),
          el("button", { class: "seg-btn active", "data-role": "normal" }, "普通注册"),
          ALLOW_ADMIN_REGISTER ? el("button", { class: "seg-btn", "data-role": "admin" }, "高级认证") : null
        ),
        el("div", { class: "field" }, el("label", { class: "field-label" }, "用户名"), inputWithIcon("username", iconPerson(), "3-16 位字母数字下划线", val => { form.username = val; errors.username = validateUsername(val); refreshErrors(); }), errBox("username")),
        el("div", { class: "field" }, el("label", { class: "field-label" }, "显示名"), inputWithIcon("displayName", iconPerson(), "1-20 位字符", val => { form.displayName = val; errors.displayName = val.length < 1 ? "不能为空" : ""; refreshErrors(); }), errBox("displayName")),
        el("div", { class: "field" }, el("label", { class: "field-label" }, "密码"), inputWithIcon("password", iconLock(), "至少 8 位，含字母与数字", val => { form.password = val; errors.password = validatePassword(val); if (form.confirm) errors.confirm = val !== form.confirm ? "两次密码不一致" : ""; refreshErrors(); }, "password"), errBox("password")),
        el("div", { class: "field" }, el("label", { class: "field-label" }, "确认密码"), inputWithIcon("confirm", iconLock(), "再次输入密码", val => { form.confirm = val; errors.confirm = val !== form.password ? "两次密码不一致" : ""; refreshErrors(); }, "password"), errBox("confirm")),
        
        el("div", { class: "field", id: "normalRoleField" },
          el("label", { class: "field-label" }, "注册身份"),
          el("div", { class: "segmented", style: "margin-bottom: 0; gap: 12px;" },
            el("button", { class: "seg-btn active", "data-nrole": "player", type: "button" }, "玩家"),
            el("button", { class: "seg-btn", "data-nrole": "contractor", type: "button" }, "契约者")
          )
        ),

        el("div", { class: "field invite-field", hidden: true },
          el("label", { class: "field-label" }, "内部邀请码"),
          inputWithIcon("inviteCode", iconKey(), "请输入管理者邀请码", val => { form.inviteCode = val; errors.inviteCode = inviteError(val); refreshErrors(); }),
          errBox("inviteCode")
        ),
        el("div", { class: "banner", hidden: true }),
        el("button", { class: "btn-primary", "@click": submitRegister }, "完成注册"),
        el("div", { class: "req-box", id: "regReqBox" },
          el("div", { class: "req-status", id: "regReqStatus" }, "尚未发送审批请求"),
          el("button", { class: "req-btn", id: "regReqBtn", type: "button" }, "向管理者发送请求")
        ),
        el("div", { class: "panel-footer" }, "已有身份？", el("a", { class: "link", href: "#/login", style: "margin-left:4px;" }, "返回登录"))
      )
    );

    const segBtns = page.querySelectorAll(".panel-inner > .segmented > .seg-btn");
    const slider = page.querySelector(".seg-slider");
    const inviteField = page.querySelector(".invite-field");
    const normalRoleField = page.querySelector("#normalRoleField");
    const normalRoleBtns = normalRoleField.querySelectorAll(".seg-btn");
    const reqBox = page.querySelector("#regReqBox");
    const reqStatusEl = page.querySelector("#regReqStatus");
    const reqBtn = page.querySelector("#regReqBtn");
    let myRequestId = null;
    let pollTimer = null;
    let reqPollBusy = false;

    function setReqStatus(text, cls) {
      reqStatusEl.textContent = text;
      reqStatusEl.className = "req-status" + (cls ? " " + cls : "");
    }

    function findMyRequest() {
      const s = loadState();
      const list = s.registrationRequests || [];
      if (myRequestId) {
        const byId = list.find(r => r.id === myRequestId);
        if (byId) return byId;
      }
      const name = String(form.username || "").trim().toLowerCase();
      if (!name) return null;
      return list
        .filter(r => String(r.username).toLowerCase() === name && r.role === normalRole)
        .sort((a, b) => b.createdAt - a.createdAt)[0] || null;
    }

    async function applyRequestState() {
      if (isAdminReg && !IS_CLOUD) return;
      if (IS_CLOUD) {
        const name = String(form.username || "").trim();
        if (!name) { setReqStatus("尚未发送审批请求"); return; }
        if (reqPollBusy) return;
        reqPollBusy = true;
        try {
          const r = await window.SDJCloud.registrationStatus(name);
          if (!r || !r.ok) {
            setReqStatus("云端状态读取失败：" + ((r && r.error) || "网络异常"), "err");
            return;
          }
          const wantRole = isAdminReg ? "admin" : normalRole;
          if (r.role && r.role !== wantRole) { setReqStatus("尚未发送审批请求"); return; }
          const st = r.status || "none";
          if (st === "none") setReqStatus("尚未发送审批请求");
          else if (st === "pending") setReqStatus("已提交，等待管理者审批…", "warn");
          else if (st === "approved") setReqStatus("管理者已审批，可以完成注册", "ok");
          else if (st === "rejected") setReqStatus("管理者已驳回" + (r.note ? "：" + r.note : ""), "err");
          else if (st === "expired") setReqStatus("审批超时，请重新发送请求", "err");
          else if (st === "completed") setReqStatus("该申请已完成注册", "ok");
        } catch (e) {
          setReqStatus("云端状态读取失败，请检查网络", "err");
        } finally {
          reqPollBusy = false;
        }
        return;
      }
      const r = findMyRequest();
      if (!r) { myRequestId = null; setReqStatus("尚未发送审批请求"); return; }
      myRequestId = r.id;
      if (r.status === "pending") setReqStatus("已提交，等待管理者审批…", "warn");
      else if (r.status === "approved") setReqStatus("管理者已审批，可以完成注册", "ok");
      else if (r.status === "rejected") setReqStatus("管理者已驳回" + (r.note ? "：" + r.note : ""), "err");
      else if (r.status === "expired") setReqStatus("审批超时，请重新发送请求", "err");
      else if (r.status === "completed") setReqStatus("该申请已完成注册", "ok");
    }

    async function sendRegisterRequest() {
      const banner = page.querySelector(".banner");
      errors.username = validateUsername(form.username);
      errors.displayName = !form.displayName ? "显示名不能为空" : "";
      errors.password = validatePassword(form.password);
      errors.confirm = form.password !== form.confirm ? "两次密码不一致" : "";
      errors.inviteCode = inviteError(form.inviteCode);
      refreshErrors();
      if (Object.values(errors).some(e => e)) {
        banner.hidden = false; banner.className = "banner"; banner.textContent = "请先修正表单错误。"; return;
      }
      if (getAccounts().some(a => a.username.toLowerCase() === form.username.toLowerCase())) {
        banner.hidden = false; banner.className = "banner"; banner.textContent = "该账号已注册，请直接登录。"; return;
      }
      reqBtn.disabled = true;
      if (IS_CLOUD) {
        try {
          const r = isAdminReg
            ? await window.SDJCloud.adminRequest(form.username, form.displayName, form.inviteCode)
            : await window.SDJCloud.submitRegistration(form.username, form.displayName, normalRole);
          if (!r || !r.ok) {
            banner.hidden = false; banner.className = "banner";
            banner.textContent = "请求发送失败：" + ((r && r.error) || "未知错误");
            return;
          }
          banner.hidden = false; banner.className = "banner success";
          banner.textContent = "审批请求已发送至管理者，请等待同意后再完成注册。";
          await applyRequestState();
          startRequestPolling();
        } catch (err) {
          banner.hidden = false; banner.className = "banner";
          banner.textContent = "请求发送失败：" + (err.message || "未知错误");
        } finally {
          reqBtn.disabled = false;
        }
        return;
      }
      try {
        const salt = makeSalt();
        const hash = await hashPassword(form.password, salt);
        const s = loadState();
        s.registrationRequests = s.registrationRequests || [];
        const mine = findMyRequest();
        if (mine && mine.status === "pending") {
          // 重复发送只刷新资料，保留创建时间以免被超时机制提前失效
          mine.username = form.username;
          mine.displayName = form.displayName;
          mine.role = normalRole;
          mine.salt = salt;
          mine.hash = hash;
        } else {
          const req = {
            id: "r" + Date.now(), username: form.username, displayName: form.displayName,
            role: normalRole, salt, hash, status: "pending", createdAt: Date.now(), note: ""
          };
          s.registrationRequests.unshift(req);
          myRequestId = req.id;
        }
        saveState();
        // 通知所有管理员：审批列表有新申请（修复新注册管理员收不到的问题）
        notifyAdmins(`新的${normalRole === "player" ? "玩家" : "契约者"}注册申请：${form.displayName}（${form.username}）`);
        saveState();
        banner.hidden = false; banner.className = "banner success";
        banner.textContent = "审批请求已发送至管理者，请等待同意后再完成注册。";
        applyRequestState();
      } catch (err) {
        banner.hidden = false; banner.className = "banner";
        banner.textContent = "请求发送失败：" + (err.message || "未知错误");
      } finally {
        reqBtn.disabled = false;
      }
    }

    reqBtn.onclick = sendRegisterRequest;

    function startRequestPolling() {
      if (pollTimer) return;
      pollTimer = setInterval(() => {
        if (!page.isConnected) { clearInterval(pollTimer); pollTimer = null; return; }
        applyRequestState();
      }, IS_CLOUD ? 3000 : 1500);
    }
    const onStorage = (e) => { if (!e.key || e.key === "sdj_state_v1") applyRequestState(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener("hashchange", function cleanupRequestWatch() {
      window.removeEventListener("storage", onStorage);
      clearInterval(pollTimer); pollTimer = null;
      window.removeEventListener("hashchange", cleanupRequestWatch);
    });

    function refreshModeUI() {
      segBtns.forEach(s => s.classList.toggle("active", s.dataset.role === (isAdminReg ? "admin" : "normal")));
      const activeSeg = Array.from(segBtns).find(s => s.dataset.role === (isAdminReg ? "admin" : "normal"));
      if (activeSeg && slider) {
        slider.style.width = `${activeSeg.offsetWidth}px`;
        slider.style.transform = `translateX(${activeSeg.offsetLeft}px)`;
      }
      inviteField.hidden = !isAdminReg;
      normalRoleField.hidden = isAdminReg; 
      // 本地模式的管理者注册不走审批；云端模式与普通注册一样需要管理员同意
      reqBox.hidden = isAdminReg && !IS_CLOUD;
      if (!isAdminReg || IS_CLOUD) { applyRequestState(); startRequestPolling(); }
    }

    segBtns.forEach(btn => btn.addEventListener("click", () => {
      isAdminReg = btn.dataset.role === "admin";
      refreshModeUI();
    }));

    normalRoleBtns.forEach(btn => btn.addEventListener("click", () => {
      normalRole = btn.dataset.nrole;
      normalRoleBtns.forEach(b => b.classList.toggle("active", b.dataset.nrole === normalRole));
    }));

    function refreshErrors() {
      // 按 data-key 精确匹配，避免字段顺序变化导致错误信息串位
      page.querySelectorAll(".field-error[data-key]").forEach(errEl => {
        const key = errEl.dataset.key;
        if (key === "inviteCode" && !isAdminReg) { errEl.textContent = ""; return; }
        errEl.textContent = errors[key] || "";
      });
    }

    async function submitRegister() {
      const banner = page.querySelector(".banner");
      if (isAdminReg && !ALLOW_ADMIN_REGISTER) {
        banner.hidden = false; banner.className = "banner";
        banner.textContent = "当前版本未开放管理者自助注册。";
        return;
      }
      if (!isAdminReg) {
        if (IS_CLOUD) {
          // 云端模式下本地没有申请表，必须查服务端状态；否则会把「已发送请求」误判成绕过
          const st0 = await window.SDJCloud.registrationStatus(String(form.username || "").trim());
          if (!st0 || !st0.ok || !st0.status || st0.status === "none") {
            recordRegisterBypass(form.username || form.displayName);
          }
        } else {
          applyRequestState();
          if (!findMyRequest()) recordRegisterBypass(form.username || form.displayName);
        }
      }
      errors.username = validateUsername(form.username);
      errors.displayName = !form.displayName ? "显示名不能为空" : "";
      errors.password = validatePassword(form.password);
      errors.confirm = form.password !== form.confirm ? "两次密码不一致" : "";
      errors.inviteCode = inviteError(form.inviteCode);
      refreshErrors();

      if (Object.values(errors).some(e => e)) {
        banner.hidden = false; banner.className = "banner"; banner.textContent = "请修正表单错误。"; return;
      }

      // 普通注册必须先通过管理者审批
      if (!isAdminReg) {
        if (IS_CLOUD) {
          const st = await window.SDJCloud.registrationStatus(form.username);
          if (!st || !st.ok) {
            banner.hidden = false; banner.className = "banner";
            banner.textContent = "无法读取审批状态：" + ((st && st.error) || "请检查网络后重试。");
            return;
          }
          if (st.status !== "approved") {
            banner.hidden = false; banner.className = "banner";
            banner.textContent = st.status === "pending"
              ? "管理者尚未审批，请收到「管理者已审批」后再完成注册。"
              : st.status === "rejected"
                ? "申请已被驳回" + (st.note ? "：" + st.note : "") + "，请重新发送请求。"
                : "请先点击「向管理者发送请求」并等待管理者同意。";
            return;
          }
        } else {
          applyRequestState();
          const req = findMyRequest();
          if (!req || req.status !== "approved") {
            banner.hidden = false; banner.className = "banner";
            banner.textContent = req && req.status === "pending"
              ? "管理者尚未审批，请收到「管理者已审批」后再完成注册。"
              : "请先点击「向管理者发送请求」并等待管理者同意。";
            return;
          }
          const checkHash = await hashPassword(form.password, req.salt);
          if (checkHash !== req.hash) {
            banner.hidden = false; banner.className = "banner";
            banner.textContent = "密码与申请时不一致，请重新发送审批请求。";
            return;
          }
        }
      }

      function markRequestCompleted() {
        if (isAdminReg) return;
        const req = findMyRequest();
        if (!req) return;
        req.status = "completed";
        saveState();
      }

      const finalRole = isAdminReg ? "admin" : normalRole;

      if (window.SDJCloud && window.SDJCloud.enabled()) {
        if (isAdminReg) {
          // 管理者：先确认申请已获批，再建 Auth 账号，最后让服务端建档
          const st = await window.SDJCloud.registrationStatus(form.username);
          if (!st || !st.ok) {
            banner.hidden = false; banner.className = "banner";
            banner.textContent = "无法读取审批状态：" + ((st && st.error) || "请检查网络后重试。"); return;
          }
          if (st.role !== "admin") {
            banner.hidden = false; banner.className = "banner";
            banner.textContent = "未找到你的管理者申请，请先点击「向管理者发送请求」。"; return;
          }
          if (st.status !== "approved") {
            banner.hidden = false; banner.className = "banner";
            banner.textContent = st.status === "pending"
              ? "管理者尚未审批，请收到「管理者已审批」后再完成注册。"
              : st.status === "completed"
                ? "该申请已完成注册，请直接登录。"
                : "管理者申请未通过，请重新发送请求。";
            return;
          }
          const reg = await window.SDJCloud.signUpNoProfile(form.username, form.displayName, form.password);
          if (!reg.ok) {
            banner.hidden = false; banner.className = "banner"; banner.textContent = reg.error; return;
          }
          const claim = await window.SDJCloud.adminClaim();
          if (!claim.ok) {
            banner.hidden = false; banner.className = "banner";
            banner.textContent = "建档失败：" + claim.error; return;
          }
          const p = claim.profile || {};
          setSession({
            role: p.role || "admin",
            displayName: p.display_name || form.displayName,
            username: p.username || form.username,
            ts: Date.now(), auto: false
          });
          ensureMemberRecord(p.username || form.username, p.display_name || form.displayName, "admin");
          showLoadingScreen({ onComplete: () => navigate("/app") });
          return;
        }
        const res = await window.SDJCloud.signUp(form.username, form.displayName, form.password, finalRole);
        if (!res.ok) {
          banner.hidden = false; banner.className = "banner"; banner.textContent = res.error; return;
        }
        setSession({
          role: res.profile.role,
          displayName: res.profile.display_name,
          username: res.profile.username,
          ts: Date.now(), auto: false
        });
        markRequestCompleted();
        ensureMemberRecord(res.profile.username, res.profile.display_name, res.profile.role);
        showLoadingScreen({ onComplete: () => navigate("/app") });
        return;
      }

      const accounts = getAccounts();
      if (accounts.some(a => a.username.toLowerCase() === form.username.toLowerCase())) {
        banner.hidden = false; banner.className = "banner"; banner.textContent = "该用户名已被占用。"; return;
      }

      const approvedReq = isAdminReg ? null : findMyRequest();
      const salt = approvedReq ? approvedReq.salt : makeSalt();
      const hash = approvedReq ? approvedReq.hash : await hashPassword(form.password, salt);
      accounts.push({
        username: form.username,
        displayName: form.displayName,
        role: finalRole,
        salt, hash,
        ts: Date.now()
      });
      saveAccounts(accounts);

      setSession({ 
        role: finalRole, 
        displayName: form.displayName, 
        username: form.username, 
        ts: Date.now(), auto: false 
      });
      markRequestCompleted();
      ensureMemberRecord(form.username, form.displayName, finalRole);
      showLoadingScreen({ onComplete: () => navigate("/app") });
    }

    function inputWithIcon(key, iconNode, placeholder, onInput, type) {
      const input = el("input", { class: "field-input", type: type || "text", placeholder, autocomplete: "off" });
      input.addEventListener("input", () => onInput(input.value));
      return el("div", { class: "field-input-wrap" }, el("div", { class: "field-icon", innerHTML: iconNode }), input);
    }
    function errBox(key) { return el("div", { class: "field-error", "data-key": key }); }

    root.appendChild(pageWrap([page]));
    requestAnimationFrame(refreshModeUI);
  }

  function validateUsername(v) { if (!v) return "不能为空"; if (v.length < 3 || v.length > 16) return "长度 3-16"; if (!/^[A-Za-z0-9_]+$/.test(v)) return "仅限字母数字"; return ""; }
  function validatePassword(v) { if (!v) return "密码不能为空"; if (v.length < 8) return "至少 8 位"; if (!/[A-Za-z]/.test(v) || !/[0-9]/.test(v)) return "须含字母与数字"; return ""; }

  /* =========================================================
   *  5. 找回密码 (原封不动保留)
   * ========================================================= */
  function renderForgotPassword(root) {
    let step = 1, email = "", code = "", newPwd = "", confirmPwd = "";
    const page = el("div", { class: "panel" },
      el("div", { class: "panel-inner" },
        stepperEl(), el("div", { class: "banner", hidden: true }), el("div", { id: "step-body" }),
        el("button", { class: "btn-primary", id: "step-btn", "@click": nextStep }, "发送重置链接"),
        el("div", { class: "panel-footer" }, el("a", { class: "link", href: "#/login" }, "返回登录"))
      )
    );

    function stepperEl() {
      const dots = [["1", "请求重置"], ["2", "验证身份"], ["3", "设置新密码"]];
      const parts = [];
      dots.forEach(([n, t], i) => {
        if (i > 0) parts.push(el("div", { class: "step-line" }));
        parts.push(el("div", { class: "step-dot" + (i + 1 === step ? " active" : "") }, el("span", { class: "num" }, n), el("span", {}, t)));
      });
      return el("div", { class: "stepper" }, ...parts);
    }

    function renderStep() {
      const body = page.querySelector("#step-body"), btn = page.querySelector("#step-btn");
      body.innerHTML = "";
      page.querySelector(".stepper").replaceWith(stepperEl());
      page.querySelector(".banner").hidden = true;

      if (step === 1) { 
        body.appendChild(el("div", { class: "field" }, el("label", { class: "field-label" }, "邮箱"), el("div", { class: "field-input-wrap" }, el("div", { class: "field-icon", innerHTML: iconMail() }), bindInput("email", "请输入注册邮箱", val => { email = val; })), el("div", { class: "field-error" }))); 
        btn.textContent = "发送重置链接"; 
      }
      else if (step === 2) { 
        body.appendChild(el("div", { class: "field" }, el("label", { class: "field-label" }, "验证码"), el("div", { class: "field-input-wrap" }, el("div", { class: "field-icon", innerHTML: iconKey() }), bindInput("code", "请输入邮件中的 6 位验证码", val => { code = val; })), el("div", { class: "field-error" }))); 
        btn.textContent = "验证身份"; 
      }
      else { 
        body.appendChild(el("div", { class: "field" }, el("label", { class: "field-label" }, "新密码"), el("div", { class: "field-input-wrap" }, el("div", { class: "field-icon", innerHTML: iconLock() }), bindInput("newPwd", "至少 8 位，含字母与数字", val => { newPwd = val; }, "password")), el("div", { class: "field-error" })));
        body.appendChild(el("div", { class: "field" }, el("label", { class: "field-label" }, "确认新密码"), el("div", { class: "field-input-wrap" }, el("div", { class: "field-icon", innerHTML: iconLock() }), bindInput("confirmPwd", "再次输入新密码", val => { confirmPwd = val; }, "password")), el("div", { class: "field-error" }))); 
        btn.textContent = "完成重置"; 
      }
    }

    function bindInput(name, placeholder, onInput, type) { const input = el("input", { class: "field-input", type: type || "text", placeholder, autocomplete: "off" }); input.addEventListener("input", () => onInput(input.value)); return input; }
    function showBanner(msg, ok) { const banner = page.querySelector(".banner"); banner.hidden = false; banner.className = "banner" + (ok ? " success" : ""); banner.textContent = msg; }

    function nextStep() {
      if (step === 1) {
        if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { showBanner("请输入合法邮箱地址。", false); return; }
        // 先切换步骤（renderStep 会重置 banner），再显示本步提示，保证提示可见
        step = 2; renderStep();
        showBanner("重置链接已发送至 " + email + "（演示：验证码 123456）", true);
      } else if (step === 2) {
        if (code.trim() !== "123456") { showBanner("验证码错误，演示中请输入 123456。", false); return; }
        step = 3; renderStep();
        showBanner("身份验证通过，请设置新密码。", true);
      } else {
        const e1 = validatePassword(newPwd), e2 = newPwd !== confirmPwd ? "两次密码不一致" : "";
        if (e1 || e2) { showBanner(e1 || e2, false); return; }
        showBanner("密码已重置，正在返回登录页…", true); setTimeout(() => navigate("/login"), 1200);
      }
    }

    renderStep();
    root.appendChild(pageWrap([page]));
  }

  /* =========================================================
   *  6. 主应用框架
   * ========================================================= */
  
  let viewRole = "player";
  let currentMenuId = "dashboard";
  let pendingMenu = null;   // 从独立页（帖子详情 / 发帖）返回主应用时要落到的菜单
  let globeEngine = null;
  let pendingMapLocation = null;

  const menuConfig = {
    player: [
      { id: 'dashboard', cn: '主控台', en: 'DASHBOARD' },
      { id: 'map', cn: '地图', en: 'MAP' },
      { id: 'bag', cn: '背包', en: 'INVENTORY' },
      { id: 'mission', cn: '委托任务', en: 'COMMISSIONS' },
      { id: 'forum', cn: '论坛', en: 'FORUM' },
      { id: 'friend', cn: '好友', en: 'FRIENDS' },
      { id: 'council', cn: '议会', en: 'COUNCIL' },
      { id: 'codex', cn: '收集图鉴', en: 'CODEX' },
      { id: 'settings', cn: '设置', en: 'SETTINGS' }
    ],
    admin: [
      { id: 'dashboard', cn: '主控台', en: 'DASHBOARD' },
      { id: 'approval', cn: '待审批', en: 'APPROVALS' },
      { id: 'map', cn: '地图管理', en: 'MAP MGMT' },
      { id: 'mission', cn: '任务管理', en: 'MISSION MGMT' },
      { id: 'forum', cn: '论坛管理', en: 'FORUM MGMT' },
      { id: 'friend', cn: '好友', en: 'FRIENDS' },
      { id: 'council', cn: '议会管理', en: 'COUNCIL MGMT' },
      { id: 'bag', cn: '背包管理', en: 'BAG MGMT' },
      { id: 'member', cn: '神降系统成员管理', en: 'MEMBER MGMT' },
      { id: 'settings', cn: '设置', en: 'SETTINGS' }
    ]
  };

  function renderMainApp(root) {
    const session = getSession();
    if (!session) { navigate("/login"); return; }

    if (session.role === "admin") { viewRole = "admin"; }
    else if (session.role === "contractor") { viewRole = "contractor"; }
    else { viewRole = "player"; }
    currentMenuId = pendingMenu || "dashboard";
    pendingMenu = null;

    const appLayout = el("div", { class: "app-layout" },
      el("div", { class: "sidebar-overlay", id: "sidebarOverlay" }),
      el("aside", { class: "sidebar", id: "sidebar" },
        el("div", { class: "sidebar-logo" },
          el("div", { style: "display:flex; align-items:center;" }, el("span", {}, "✦"), " 神降计划"),
          el("button", { class: "sidebar-close-btn", id: "closeSidebarBtn", style: "display:none; background:none; border:none; color:#aaa; font-size:24px; cursor:pointer;" }, "×")
        ),
        el("div", { class: "menu-list", id: "sidebarMenuList" }),
        el("div", { class: "sidebar-footer" }, "v.1.0.0 测试版")
      ),
      el("div", { class: "main-wrapper" },
        el("header", { class: "topbar" },
          el("div", { class: "topbar-left" },
            el("button", { class: "mobile-menu-btn", id: "menuBtn" }, "☰"),
            el("div", { class: "topbar-title", id: "topbarTitle" }, "主控台 / <span>DASHBOARD</span>")
          ),
          el("div", { class: "topbar-right" },
            el("div", { class: "clock", id: "clock" }, "00:00:00"),
            el("div", { class: "notify-wrap", id: "notifyWrap" },
              el("button", { class: "notify-btn", id: "notifyBtn" }, "通告",
                el("span", { class: "notify-badge", id: "notifyBadge", hidden: true }, "0")),
              el("div", { class: "notify-dropdown", id: "notifyDropdown" })
            ),
            session.role === "admin" 
              ? el("div", { class: "role-switch-wrap visible", id: "roleSwitchWrap" },
                  el("div", { class: "role-switch-btn", id: "roleSwitchBtn" }, "当前权限: 管理者 ▾"),
                  el("div", { class: "role-dropdown", id: "roleDropdown" },
                    el("div", { class: "role-dropdown-item active", "data-role": "admin" }, "管理者"),
                    el("div", { class: "role-dropdown-item", "data-role": "player" }, "玩家"),
                    el("div", { class: "role-dropdown-item", "data-role": "contractor" }, "契约者")
                  )
                )
              : el("div", { class: "fixed-role-badge" }, viewRole === "contractor" ? "当前权限：契约者" : "当前权限：玩家"),
            el("a", { class: "btn-logout", "@click": () => { clearSession(); if (window.SDJCloud) window.SDJCloud.signOut(); navigate("/login"); } }, "断开连接")
          )
        ),
        el("main", { class: "content-container", id: "mainContent" })
      )
    );

    root.appendChild(appLayout);

    function tickClock() { 
      const now = new Date(); 
      const h = String(now.getHours()).padStart(2, '0'), m = String(now.getMinutes()).padStart(2, '0'), s = String(now.getSeconds()).padStart(2, '0');
      const clockEl = document.getElementById("clock");
      if (clockEl) clockEl.textContent = `${h}:${m}:${s}`; 
    }
    const clockInterval = setInterval(tickClock, 1000); tickClock();

    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("sidebarOverlay");
    document.getElementById("menuBtn").onclick = () => { sidebar.classList.add("open"); overlay.classList.add("active"); };
    overlay.onclick = () => { sidebar.classList.remove("open"); overlay.classList.remove("active"); };
    document.getElementById("closeSidebarBtn").onclick = () => { sidebar.classList.remove("open"); overlay.classList.remove("active"); };

    let onDocClick = (e) => {
      const roleWrap = document.getElementById("roleSwitchWrap");
      const roleDrop = document.getElementById("roleDropdown");
      if (roleWrap && roleDrop && !roleWrap.contains(e.target)) roleDrop.classList.remove("show");
      const nWrap = document.getElementById("notifyWrap");
      const nDrop = document.getElementById("notifyDropdown");
      if (nWrap && nDrop && !nWrap.contains(e.target)) nDrop.classList.remove("show");
    };
    document.addEventListener("click", onDocClick);

    if (session.role === "admin") {
      const roleBtn = document.getElementById("roleSwitchBtn");
      const dropdown = document.getElementById("roleDropdown");
      roleBtn.onclick = () => dropdown.classList.toggle("show");
      dropdown.querySelectorAll(".role-dropdown-item").forEach(item => {
        item.onclick = () => {
          viewRole = item.dataset.role;
          dropdown.querySelectorAll(".role-dropdown-item").forEach(i => i.classList.toggle("active", i.dataset.role === viewRole));
          const label = viewRole === 'admin' ? '管理者' : (viewRole === 'player' ? '玩家' : '契约者');
          roleBtn.textContent = `当前权限: ${label} ▾`;
          
          const targetMenuConfig = viewRole === "admin" ? menuConfig.admin : menuConfig.player;
          if (!targetMenuConfig.find(m => m.id === currentMenuId)) currentMenuId = "dashboard";
          
          renderSidebar();
          renderContent();
          dropdown.classList.remove("show");
          toast(`已切换至${label}权限`);
        };
      });
    }

    /* ---- 通告中心 ---- */
    function myNotifications() {
      const names = new Set([session.username, session.displayName].filter(Boolean).map(String));
      return (loadState().notifications || []).filter(n => names.has(String(n.username)));
    }

    function renderNotify() {
      const list = myNotifications();
      const unread = list.filter(n => !n.read).length;
      const badge = document.getElementById("notifyBadge");
      const dd = document.getElementById("notifyDropdown");
      if (badge) {
        badge.hidden = unread === 0;
        badge.textContent = String(unread);
      }
      if (dd) {
        dd.innerHTML = list.length
          ? list.slice(0, 20).map(n => `
              <div class="notify-item ${n.read ? "" : "unread"}">
                <div class="notify-text">${escHTML(n.text)}</div>
                <div class="notify-time">${fmtTime(n.at)}</div>
              </div>`).join("")
          : `<div class="notify-empty">暂无通告</div>`;
      }
    }

    const notifyBtn = document.getElementById("notifyBtn");
    const notifyDropdown = document.getElementById("notifyDropdown");
    notifyBtn.onclick = () => {
      const opening = !notifyDropdown.classList.contains("show");
      if (opening) {
        // 展开即视为已读，红点与数字立刻消失
        let changed = false;
        myNotifications().forEach(n => { if (!n.read) { n.read = true; changed = true; } });
        if (changed) saveState();
        notifyDropdown.classList.add("show");
        renderNotify();
      } else {
        notifyDropdown.classList.remove("show");
        renderNotify();
      }
    };
    renderNotify();
    notifyRefreshHook = renderNotify;

    const unreadCount = myNotifications().filter(n => !n.read).length;
    if (unreadCount) setTimeout(() => toast(`你有 ${unreadCount} 条未读通告`), 800);

    const sweepInterval = setInterval(() => {
      if (sweepTimeouts(true)) renderNotify();
    }, 60000);

    // 其他标签页写入状态时，本页刷新通告与审批列表（修复管理员收不到申请）
    const onStorageState = (e) => {
      if (e.key === SOCIAL_KEY || e.key === SOCIAL_MSG_KEY) {
        const showBanner = currentMenuId !== "friend" && e.key === SOCIAL_MSG_KEY;
        onSocialExternal();
        if (showBanner) maybeShowUnreadBanner();
        return;
      }
      if (e.key && e.key !== STATE_KEY) return;
      reloadState();
      renderNotify();
      if (currentMenuId === "approval") {
        const host = document.getElementById("mainContent");
        if (host && approvalFingerprint() !== host._approvalFp) renderApprovalPage(host);
      } else if (currentMenuId === "member" && viewRole === "admin") {
        maybeRefreshMemberPage(document.getElementById("mainContent"));
      } else if (currentMenuId === "dashboard") {
        const host = document.getElementById("mainContent");
        if (host) renderDashboardPage(host, session.displayName);
      } else if (currentMenuId === "mission" || currentMenuId === "bag") {
        const host = document.getElementById("mainContent");
        if (!host) return;
        if (currentMenuId === "mission") renderMissionPage(host, viewRole === "admin");
        else renderBagPage(host);
      }
    };
    window.addEventListener("storage", onStorageState);

    function renderSidebar() {
      const config = viewRole === "admin" ? menuConfig.admin : menuConfig.player;
      const menuListEl = document.getElementById("sidebarMenuList");
      menuListEl.innerHTML = config.map(item => `
        <a class="menu-item ${item.id === currentMenuId ? 'active' : ''}" data-id="${item.id}" data-cn="${item.cn}" data-en="${item.en}">
          <div class="menu-icon">${icons[item.id] || icons.dashboard}</div>
          <div class="menu-text"><span class="menu-cn">${item.cn}</span><span class="menu-en">${item.en}</span></div>
          ${item.id === "friend" ? `<span class="menu-social-badge" id="socialMenuBadge" hidden></span>` : ""}
        </a>
      `).join('');

      menuListEl.querySelectorAll('.menu-item').forEach(item => {
        item.onclick = () => {
          currentMenuId = item.dataset.id;
          document.getElementById("topbarTitle").innerHTML = `${item.dataset.cn} / <span>${item.dataset.en}</span>`;
          menuListEl.querySelectorAll('.menu-item').forEach(i => i.classList.remove('active'));
          item.classList.add('active');
          renderContent();
          if (window.innerWidth <= 768) { sidebar.classList.remove("open"); overlay.classList.remove("active"); }
        };
      });

      const activeItem = config.find(m => m.id === currentMenuId);
      if (activeItem) document.getElementById("topbarTitle").innerHTML = `${activeItem.cn} / <span>${activeItem.en}</span>`;
      refreshSocialBadges();
    }

    function renderContent() {
      const contentEl = document.getElementById("mainContent");

      // 权限边界：非管理员权限下不允许进入管理/审批类页面
      const ADMIN_ONLY = ["approval", "member"];
      if (ADMIN_ONLY.includes(currentMenuId) && viewRole !== "admin") {
        currentMenuId = "dashboard";
        toast("该功能仅管理员权限可用");
      }

      contentEl.innerHTML = ""; 
      
      stopRealtime();
      stopApprovalPoll();
      stopMissionTick();
      stopForumTimers();
      stopSocial();
      stopDashboardClock();
      if (contentEl._cleanupPick) { contentEl._cleanupPick(); contentEl._cleanupPick = null; }
      if (globeEngine) {
        globeEngine.destroy();
        globeEngine = null;
        window.SDJMapEngine = null;
      }

      contentEl.classList.toggle("map-mode", currentMenuId === "map");

      if (currentMenuId === "dashboard") {
        renderDashboardPage(contentEl, session.displayName);
      } else if (currentMenuId === "map") {
        renderMapPage(contentEl, viewRole);
      } else if (currentMenuId === "approval") {
        renderApprovalPage(contentEl);
      } else if (currentMenuId === "bag") {
        renderBagPage(contentEl);
      } else if (currentMenuId === "mission") {
        renderMissionPage(contentEl, viewRole === "admin");
      } else if (currentMenuId === "forum") {
        renderForumPage(contentEl, viewRole === "admin");
      } else if (currentMenuId === "friend") {
        renderFriendPage(contentEl, viewRole === "admin");
      } else if (currentMenuId === "council") {
        renderCouncilPage(contentEl, viewRole === "admin");
      } else if (currentMenuId === "codex") {
        renderCodexPage(contentEl);
      } else if (currentMenuId === "settings") {
        renderSettingsPage(contentEl);
      } else if (currentMenuId === "member") {
        renderMemberPage(contentEl);
      } else {
        renderPlaceholderPage(contentEl);
      }
      renderBroadcastBanner();
    }

    renderSidebar();
    renderContent();
    startWorldCloudWatch();
    startSocialCloudWatch();
    // 广播横板独立刷新：不依赖页面重绘，切换菜单/实时推送后都能稳定出现
    const broadcastTick = setInterval(() => { if (!document.hidden) renderBroadcastBanner(); }, 5000);

    // 会话守护：长时间挂机后 JWT 可能过期，此时界面看起来还在线，写入却全部失败
    const sessionGuard = setInterval(async () => {
      if (!window.SDJCloud || !window.SDJCloud.enabled()) return;
      if (document.hidden) return;
      const ok = await window.SDJCloud.hasSession();
      if (ok) return;
      clearSession();
      toast("登录状态已失效或账号已被移出系统，请重新登录");
      navigate("/login");
    }, 60000);
    
    window._cleanupMainApp = () => { 
      clearInterval(clockInterval); 
      clearInterval(sweepInterval);
      clearInterval(sessionGuard);
      clearInterval(broadcastTick);
      stopDashboardClock();
      stopRealtime();
      stopWorldCloudWatch();
      stopSocialCloudWatch();
      notifyRefreshHook = null;
      stopForumTimers();
      stopSocial();
      if (onDocClick) { document.removeEventListener("click", onDocClick); onDocClick = null; }
      window.removeEventListener("storage", onStorageState);
      const contentEl = document.getElementById("mainContent");
      if (contentEl && contentEl._cleanupPick) { contentEl._cleanupPick(); contentEl._cleanupPick = null; }
      if (globeEngine) { globeEngine.destroy(); globeEngine = null; }
    };
  }

  let dashboardClockTimer = null;
  function stopDashboardClock() {
    if (dashboardClockTimer) { clearInterval(dashboardClockTimer); dashboardClockTimer = null; }
  }

  function dashboardAccountName(username) {
    try {
      const a = (getAccounts() || []).find(x => x.username === username || x.displayName === username);
      return a ? (a.displayName || a.username) : username;
    } catch (e) { return username; }
  }

  // 全服广播：字段来自 world_state.broadcasts（服务端写入），过期的自动隐藏
  function activeBroadcasts() {
    return (loadState().broadcasts || [])
      .filter(b => b && b.text && (!b.expiresAt || b.expiresAt > Date.now()))
      .slice()
      .sort((a, b) => (b.at || 0) - (a.at || 0));
  }

  function remainText(ts) {
    const ms = ts - Date.now();
    if (ms <= 0) return "已结束";
    const min = Math.floor(ms / 60000);
    if (min < 60) return min + " 分钟";
    const h = Math.floor(min / 60);
    if (h < 24) return h + " 小时 " + (min % 60) + " 分";
    return Math.floor(h / 24) + " 天 " + (h % 24) + " 小时";
  }

  function openBroadcastHistory(list) {
    const overlay = el("div", { class: "modal-overlay", id: "broadcastHistory" });
    const panel = el("div", { class: "modal-panel panel-cut" });
    overlay.appendChild(panel);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("show"));
    panel.innerHTML = `
      <div class="modal-title">全服广播 · 历史</div>
      <div class="modal-desc">当前有效 ${list.length} 条（服务端保留最近 50 条）</div>
      <div class="bs-list">
        ${list.map(b => `<div class="bs-row">
          <div class="bs-row-text">${escHTML(b.text)}</div>
          <div class="bs-row-meta">${fmtTime(b.at)} · ${escHTML(b.by || "管理者")}${b.minutes ? " · 持续 " + b.minutes + " 分钟" : ""}${b.expiresAt ? " · 剩余 " + remainText(b.expiresAt) : ""}</div>
        </div>`).join("") || `<div class="empty-state">暂无有效广播</div>`}
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="btn-sm ghost" id="bsClose">关闭</button></div>`;
    panel.querySelector("#bsClose").onclick = () => overlay.remove();
  }

  // 页面顶部横板：新广播覆盖显示，历史可点开查看每条发送时间
  function renderBroadcastBanner() {
    try {
      const host = document.getElementById("mainContent");
      if (!host || !host.isConnected) return;
      const list = activeBroadcasts();
      const old = host.querySelector(".broadcast-strip");
      if (!list.length) { if (old) old.remove(); return; }
      const top = list[0];
      // 内容没变时只更新剩余时间，不整块重建，避免每 5 秒闪一下
      const key = [top.id, top.text, top.expiresAt, list.length].join("|");
      if (old && old.dataset.key === key) {
        const timeEl = old.querySelector(".bs-time");
        if (timeEl) timeEl.textContent = `${fmtTime(top.at)}${top.expiresAt ? " · 剩余 " + remainText(top.expiresAt) : ""}`;
        return;
      }
      if (old) old.remove();
      const strip = el("div", { class: "broadcast-strip" });
      strip.dataset.key = key;
      strip.innerHTML = `
        <span class="bs-label">全服广播</span>
        <span class="bs-viewport"><span class="bs-track">${escHTML(top.text)}</span></span>
        <span class="bs-time">${fmtTime(top.at)}${top.expiresAt ? " · 剩余 " + remainText(top.expiresAt) : ""}</span>
        <button class="link-btn bs-history" id="bsHistory">历史 ${list.length}</button>`;
      host.insertBefore(strip, host.firstChild);
      const btn = strip.querySelector("#bsHistory");
      if (btn) btn.onclick = () => openBroadcastHistory(list);
    } catch (err) {
      console.warn("[广播] 横板渲染失败：", err);
    }
  }
  window.__sdjBroadcastBanner = renderBroadcastBanner;

  function dashboardBroadcastText() {
    const list = activeBroadcasts();
    return list.slice(0, 3).map(b => String(b.text || "").trim()).filter(Boolean).join("　✦　");
  }

  // 发布全服广播的唯一入口：成员页广播栏与主控台快捷操作共用同一条链路
  async function publishBroadcastText(text, minutes) {
    const t = String(text || "").trim();
    if (!t) return { ok: false, error: "广播内容不能为空" };
    if (t.length > 200) return { ok: false, error: "广播最多 200 字" };
    const sess = getSession();
    if (!sess || sess.role !== "admin") return { ok: false, error: "需要管理者权限" };
    const min = Math.max(1, Math.min(1440, Number(minutes) || 60));
    if (window.SDJCloud && window.SDJCloud.enabled()) {
      const r = await window.SDJCloud.publishBroadcast(t, min);
      if (!r.ok) return r;
      await syncWorldFromCloud(true);
      renderBroadcastBanner();
      pushSystemActivity(`管理者发布全服广播：${t}`, "broadcast");
      saveState();
      return { ok: true };
    }
    const s = loadState();
    s.broadcasts = s.broadcasts || [];
    s.broadcasts.unshift({
      id: "b" + Date.now(), text: t, at: Date.now(),
      by: sess.displayName || "管理者", minutes: min,
      expiresAt: Date.now() + min * 60000
    });
    saveState();
    renderBroadcastBanner();
    pushSystemActivity(`管理者发布全服广播：${t}`, "broadcast");
    saveState();
    return { ok: true };
  }

  // 主控台快捷「发布全服广播」：直接跳到成员管理页的广播栏并聚焦，保证只有一套发布入口
  function jumpToMemberBroadcast() {
    closeActionDialog();
    const menu = document.querySelector('.menu-item[data-id="member"]');
    if (!menu) { toast("未找到成员管理入口"); return; }
    menu.click();
    let tries = 0;
    const focusBar = () => {
      const input = document.getElementById("broadcastInput");
      if (!input) {
        if (tries++ < 50) setTimeout(focusBar, 100);
        return;
      }
      const bar = document.getElementById("memberBroadcastBar");
      if (bar) {
        bar.scrollIntoView({ behavior: "smooth", block: "center" });
        bar.classList.add("broadcast-focus");
        setTimeout(() => bar.classList.remove("broadcast-focus"), 2400);
      }
      input.focus();
      try { input.setSelectionRange(input.value.length, input.value.length); } catch (e) {}
    };
    setTimeout(focusBar, 60);
  }

  function loadExploreStats(container) {
    const apply = (items) => {
      if (!container.isConnected) return;
      const label = container.querySelector("[data-explore-label]");
      const value = container.querySelector("[data-explore-value]");
      const desc = container.querySelector("[data-explore-desc]");
      if (!label || !value || !desc) return;
      const counts = {};
      (items || []).forEach(it => {
        const d = it.district || "A区";
        counts[d] = (counts[d] || 0) + 1;
      });
      const keys = Object.keys(counts);
      if (!keys.length) {
        label.textContent = "A区待解锁探索";
        value.textContent = "0";
        desc.textContent = "暂无地点数据 · 进入地图查看";
        return;
      }
      const main = keys.includes("A区") ? "A区" : keys[0];
      const other = keys.filter(k => k !== main);
      label.textContent = `${main}待解锁探索`;
      value.textContent = String(counts[main]);
      desc.textContent = other.length
        ? `${other.map(k => `${k} ${counts[k]} 处`).join(" · ")} · 进入地图查看`
        : "进入地图查看未解锁区域";
    };
    try {
      const raw = localStorage.getItem("sdj_map_data_v2");
      if (raw) {
        const store = JSON.parse(raw);
        if (store && Array.isArray(store.items) && store.items.length) { apply(store.items); return; }
      }
    } catch (e) { /* 回退到内置地点 */ }
    import("./locations.js?v=2").then(mod => apply(mod.SEED_LOCATIONS || [])).catch(() => apply([]));
  }

  function openActivityLog(username, isAdmin) {
    const overlay = el("div", { class: "modal-overlay" });
    const panel = el("div", { class: "modal-panel panel-cut wide" });
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("show"));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    const list = recentActivities(username, isAdmin, 100);
    panel.innerHTML = `
      <div class="modal-title">最近动态</div>
      <div class="modal-desc">${isAdmin ? "全服委托进度与系统改动记录" : "你的委托进度与管理者系统通知"}</div>
      <div class="activity-log-list">${list.length ? list.map(a => `
        <div class="activity-log-row">
          <div class="activity-log-head"><span>${a.scope === "system" ? "系统" : escHTML(dashboardAccountName(a.username))}</span><em>${fmtTime(a.at)}</em></div>
          <div class="activity-log-text">${escHTML(a.text)}</div>
        </div>`).join("") : `<div class="timeline-empty">暂无动态记录</div>`}</div>
      <div class="modal-actions"><button class="btn-sm ghost" data-close>关闭</button></div>`;
    panel.querySelector("[data-close]").onclick = () => overlay.remove();
  }

  function openSystemAlerts(container, displayName) {
    const s = loadState();
    const list = s.systemAlerts || [];
    const overlay = el("div", { class: "modal-overlay" });
    const panel = el("div", { class: "modal-panel panel-cut wide" });
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("show"));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    panel.innerHTML = `
      <div class="modal-title">系统告警</div>
      <div class="modal-desc">注册违规尝试与系统异常记录</div>
      <div class="activity-log-list">${list.length ? list.map(a => `
        <div class="activity-log-row">
          <div class="activity-log-head"><span>${a.read ? "已读" : "未读"}</span><em>${fmtTime(a.at)}</em></div>
          <div class="activity-log-text">${escHTML(a.text)}</div>
        </div>`).join("") : `<div class="timeline-empty">暂无系统告警</div>`}</div>
      <div class="modal-actions"><button class="btn-sm ghost" data-close>关闭</button></div>`;
    panel.querySelector("[data-close]").onclick = () => {
      overlay.remove();
      renderDashboardPage(container, displayName);
    };
    list.forEach(a => { a.read = true; });
    saveState();
  }

  function renderDashboardPage(container, displayName) {
    stopDashboardClock();
    reloadState();
    const s = loadState();
    const session = getSession();
    const username = session ? (session.username || session.displayName) : "";
    const isAdmin = viewRole === "admin";
    const roleTitle = isAdmin ? "管理者" : (viewRole === "contractor" ? "契约者" : "玩家");
    const tagline = isAdmin ? "隐秘系统运行中。" : (viewRole === "contractor" ? "塔在等待你的指令。" : "探索未知的隐秘世界。");
    const broadcast = dashboardBroadcastText();
    const acts = recentActivities(username, isAdmin, 6);
    const wallet = myWallet(username);
    const missions = s.missions || [];
    const mine = missions.filter(m => (m.acceptors || []).some(a => a.username === username));
    // 未满员的委托保持 available；已接取者同样计入在线委托
    const ongoing = mine.filter(m => m.status === "available" || m.status === "active" || m.status === "review");
    const activeCount = ongoing.filter(m => m.status !== "review").length;
    const reviewCount = ongoing.filter(m => m.status === "review").length;
    const alerts = s.systemAlerts || [];
    const unreadAlerts = alerts.filter(a => !a.read).length;
    const latestAlert = alerts.length ? alerts.slice().sort((a, b) => b.at - a.at)[0] : null;

    let accounts = [];
    try { accounts = getAccounts() || []; } catch (e) { accounts = []; }
    const playerCount = accounts.filter(a => a.role === "player").length;
    const contractorCount = accounts.filter(a => a.role === "contractor").length;
    const pending = isAdmin ? pendingApprovalCount() : 0;

    const timelineHTML = acts.length ? acts.map(a => `
      <div class="tl-item">
        <div class="tl-time">${fmtTime(a.at)}${a.scope === "system" ? '<span class="tl-tag">系统</span>' : (isAdmin ? `<span class="tl-tag">${escHTML(dashboardAccountName(a.username))}</span>` : "")}</div>
        <div class="tl-content">${escHTML(a.text)}</div>
      </div>`).join("") : `<div class="timeline-empty">暂无动态。完成委托或等待管理者操作后，会在这里实时显示。</div>`;

    const playerCards = `
      <div class="data-card map-shortcut panel-cut" data-goto="map">
        <div class="map-shortcut-bg" style="background-image:url('assets/map-a.jpg')"></div>
        <div class="map-shortcut-inner">
          <div class="card-header"><span>地图快捷入口</span><div class="card-icon">${icons.map}</div></div>
          <div class="map-shortcut-title">A区 <i>/</i> B区</div>
          <div class="card-desc">仅作快捷跳转 · 接取委托请进入地图或委托任务</div>
        </div>
      </div>
      <div class="data-card data-card-link panel-cut" data-goto="mission">
        <div class="card-header"><span>在线委托</span><div class="card-icon">${icons.mission}</div></div>
        <div class="card-value">${ongoing.length}</div>
        <div class="card-desc">${ongoing.length ? `进行中 ${activeCount} · 待审批 ${reviewCount}` : "暂无进行中的委托 · 点击查看委托任务"}</div>
      </div>
      <div class="data-card data-card-link panel-cut" data-goto="map">
        <div class="card-header"><span data-explore-label>A区待解锁探索</span><div class="card-icon">${icons.map}</div></div>
        <div class="card-value" data-explore-value>—</div>
        <div class="card-desc" data-explore-desc>正在读取区域数据…</div>
      </div>
      <div class="data-card data-card-link panel-cut" data-goto="bag">
        <div class="card-header"><span>计划点余额</span><div class="card-icon">${icons.bag}</div></div>
        <div class="card-value">${wallet.points || 0}</div>
        <div class="card-desc">完成委托可获得计划点</div>
      </div>`;

    const adminCards = `
      <div class="data-card data-card-link panel-cut" data-goto="member">
        <div class="card-header"><span>全组织活跃成员</span><div class="card-icon">${icons.member}</div></div>
        <div class="card-value" data-member-total>${playerCount + contractorCount}</div>
        <div class="card-desc" data-member-desc>${accounts.length ? `玩家 ${playerCount} / 契约者 ${contractorCount}` : "暂无已注册玩家或契约者"}</div>
      </div>
      <div class="data-card data-card-link panel-cut" data-goto="approval">
        <div class="card-header"><span>待审批请求</span><div class="card-icon">${icons.mission}</div></div>
        <div class="card-value">${pending}</div>
        <div class="card-desc ${pending ? "alert" : ""}">${pending ? `${pending} 项等待处理 · 点击进入待审批` : "全部处理完毕"}</div>
      </div>
      <div class="data-card data-card-link panel-cut" data-alerts>
        <div class="card-header"><span>系统告警</span><div class="card-icon">${icons.forum}</div></div>
        <div class="card-value">${alerts.length}</div>
        <div class="card-desc ${unreadAlerts ? "alert" : ""}">${latestAlert ? `${unreadAlerts ? `未读 ${unreadAlerts} · ` : ""}${escHTML(latestAlert.text)}` : "暂无系统异常"}</div>
      </div>`;

    const actionsHTML = isAdmin ? `
      <button class="action-btn" data-action="0">发布全服广播<span>01 →</span></button>
      <button class="action-btn" data-action="1">发布委托任务<span>02 →</span></button>
      <button class="action-btn" data-action="2">成员权限管理<span>03 →</span></button>
      <button class="action-btn" data-action="3">系统核心维护<span>04 →</span></button>
      <button class="action-btn" data-profile>个人资料档案<span>05 →</span></button>`
      : `
      <button class="action-btn" data-goto="map">进入地图<span>01 →</span></button>
      <button class="action-btn" data-goto="mission">查看在线委托<span>02 →</span></button>
      <button class="action-btn" data-activity>查看最近动态<span>03 →</span></button>
      <button class="action-btn" data-goto="forum">前往论坛<span>04 →</span></button>
      <button class="action-btn" data-profile>个人资料档案<span>05 →</span></button>`;

    container.innerHTML = `
      ${broadcast ? `<div class="broadcast-marquee">
        <span class="bm-tag">全服广播</span>
        <div class="bm-viewport"><div class="bm-track"><span>${escHTML(broadcast)}</span><span aria-hidden="true">${escHTML(broadcast)}</span></div></div>
      </div>` : ""}
      <div class="welcome-banner panel-cut">
        <div class="welcome-text"><h1>${roleTitle}，${escHTML(displayName)}</h1><p id="dashClock">${escHTML(dateTimeText())}</p><p class="welcome-sub">${tagline}</p></div>
        <div class="tower-emblem"><img src="assets/tower.png" alt="塔"></div>
      </div>
      <div class="card-grid ${isAdmin ? "admin-grid" : ""}">${isAdmin ? adminCards : playerCards}</div>
      <div class="bottom-grid">
        <div class="timeline-panel panel-cut">
          <div class="panel-title">最近动态<button class="activity-more" data-activity>查看全部 →</button></div>
          <div class="timeline">${timelineHTML}</div>
        </div>
        <div class="action-panel panel-cut">
          <div class="panel-title">快速操作</div>
          <div class="action-list">${actionsHTML}</div>
        </div>
      </div>`;

    if (!isAdmin) loadExploreStats(container);

    const tick = () => {
      const host = document.getElementById("dashClock");
      if (!host || !container.isConnected) { stopDashboardClock(); return; }
      host.textContent = dateTimeText();
    };
    tick();
    dashboardClockTimer = setInterval(tick, 1000);

    container.querySelectorAll("[data-goto]").forEach(node => {
      node.onclick = () => {
        const item = document.querySelector(`.menu-item[data-id="${node.dataset.goto}"]`);
        if (item) item.click();
      };
    });
    container.querySelectorAll("[data-activity]").forEach(btn => {
      btn.onclick = () => openActivityLog(username, isAdmin);
    });
    const alertsCard = container.querySelector("[data-alerts]");
    if (alertsCard) alertsCard.onclick = () => openSystemAlerts(container, displayName);
    if (isAdmin) {
      container.querySelectorAll("[data-action]").forEach(btn => {
        btn.onclick = () => openAdminActionDialog(Number(btn.dataset.action));
      });
    }
    container.querySelectorAll("[data-profile]").forEach(btn => {
      btn.onclick = () => openProfileArchive();
    });
    if (isAdmin) refreshDashboardMembers(container);
  }

  // 主控台「全组织活跃成员」：云端模式读服务端 profiles，本机模式回退本地账号表
  async function refreshDashboardMembers(container) {
    if (!container || !container.isConnected) return;
    if (!window.SDJCloud || !window.SDJCloud.enabled()) return;
    const list = await window.SDJCloud.listProfiles();
    if (!list || !container.isConnected) return;
    const live = list.filter(p => !p.banned && p.role !== "admin");
    const players = live.filter(p => p.role === "player").length;
    const contractors = live.filter(p => p.role === "contractor").length;
    const totalEl = container.querySelector("[data-member-total]");
    const descEl = container.querySelector("[data-member-desc]");
    if (totalEl) totalEl.textContent = String(players + contractors);
    if (descEl) descEl.textContent = live.length ? `玩家 ${players} / 契约者 ${contractors}` : "暂无已注册玩家或契约者";
  }

  /* ---------------- 个人资料档案（全体成员共享，可自行编辑） ---------------- */
  function localProfileFallback() {
    const sess = getSession() || {};
    const username = sess.username || sess.displayName || "";
    const acc = getAccounts().find(a => a.username === username) || {};
    const cached = socialProfilesCache.find(p => p.username === username) || {};
    return {
      username,
      display_name: cached.name || acc.displayName || sess.displayName || username,
      gender: cached.gender || acc.gender || "",
      age: cached.age === undefined || cached.age === "" ? (acc.age == null ? "" : acc.age) : cached.age,
      avatar_url: cached.avatar || acc.avatar || "",
      sign: cached.sign || acc.sign || "",
      role: sess.role || acc.role || "player",
      created_at: cached.createdAt || acc.createdAt || ""
    };
  }

  async function openProfileArchive() {
    const cloud = !!(window.SDJCloud && window.SDJCloud.enabled());
    let p = localProfileFallback();
    if (cloud) {
      const r = await window.SDJCloud.myProfile();
      if (r.ok && r.profile) {
        p = Object.assign({}, p, {
          display_name: r.profile.display_name,
          gender: r.profile.gender || "",
          age: r.profile.age == null ? "" : r.profile.age,
          avatar_url: r.profile.avatar_url || "",
          sign: r.profile.sign || "",
          role: r.profile.role,
          created_at: r.profile.created_at
        });
      }
    }
    const days = p.created_at ? Math.max(0, Math.floor((Date.now() - new Date(p.created_at).getTime()) / 86400000)) : 0;
    let avatar = p.avatar_url || "";
    const genderOptions = ["", "男", "女", "其他"].map(g =>
      `<option value="${g}" ${p.gender === g ? "selected" : ""}>${g || "未填写"}</option>`).join("");
    const overlay = openSocialModal(`<div class="modal-title">个人资料档案</div>
      <div class="profile-head">
        <span class="avatar big has-photo profile-avatar" id="paAvatar" ${avatar ? `style="background-image:url('${escHTML(avatar)}')"` : ""}>${avatar ? "" : escHTML(socialInitial(p.display_name))}</span>
        <div class="profile-meta">
          <div class="profile-name">${escHTML(p.display_name)}</div>
          <div class="profile-sub">${roleLabelOf(p.role)} · 已进入系统 ${days} 天</div>
        </div>
      </div>
      <div class="profile-table">
        <div class="profile-row"><span>注册时间</span><em>${p.created_at ? escHTML(fmtTime(new Date(p.created_at).getTime())) : "未知"}</em></div>
        <div class="profile-row"><span>在线状态</span><em>在线</em></div>
      </div>
      <div class="profile-edit">
        <label class="modal-label">姓名<input class="input-line" id="paName" maxlength="20" value="${escHTML(p.display_name)}"></label>
        <div class="form-row-2">
          <label class="modal-label">性别<select class="input-line" id="paGender">${genderOptions}</select></label>
          <label class="modal-label">年龄<input class="input-line" id="paAge" type="number" min="0" max="150" value="${p.age === "" ? "" : escHTML(String(p.age))}"></label>
        </div>
        <label class="modal-label">头像（支持 png / jpg / webp，≤2MB）
          <input class="input-line" id="paFile" type="file" accept="image/png,image/jpeg,image/webp">
        </label>
        <label class="modal-label">签名<textarea class="input-line" id="paSign" maxlength="120" placeholder="留一句话给同路人">${escHTML(p.sign || "")}</textarea></label>
      </div>
      <div class="modal-actions">
        <button class="btn-sm" id="paSave">保存资料</button>
        <button class="btn-sm ghost" data-close>关闭</button>
      </div>`, (box) => {
      box.querySelector("[data-close]").onclick = () => box.remove();
      const fileInput = box.querySelector("#paFile");
      const avatarEl = box.querySelector("#paAvatar");
      fileInput.onchange = async () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        if (!/^image\//.test(file.type || "")) { toast("只能上传图片文件"); return; }
        if (file.size > 2 * 1024 * 1024) { toast("头像不能超过 2MB"); return; }
        if (!cloud) {
          const url = await new Promise((resolve) => {
            const fr = new FileReader();
            fr.onload = () => resolve(String(fr.result || ""));
            fr.onerror = () => resolve("");
            fr.readAsDataURL(file);
          });
          if (url) { avatar = url; avatarEl.style.backgroundImage = `url('${url}')`; avatarEl.textContent = ""; }
          return;
        }
        toast("正在上传头像…");
        const r = await window.SDJCloud.uploadAvatar(file);
        if (!r.ok) { toast(r.error || "头像上传失败"); return; }
        avatar = r.url;
        avatarEl.style.backgroundImage = `url('${avatar}')`;
        avatarEl.textContent = "";
        toast("头像已上传，点击保存资料生效");
      };
      box.querySelector("#paSave").onclick = async () => {
        const btn = box.querySelector("#paSave");
        const fields = {
          display_name: box.querySelector("#paName").value.trim(),
          gender: box.querySelector("#paGender").value,
          age: box.querySelector("#paAge").value.trim(),
          avatar_url: avatar,
          sign: box.querySelector("#paSign").value.trim()
        };
        if (!fields.display_name) { toast("姓名不能为空"); return; }
        if (fields.age !== "" && (Number(fields.age) < 0 || Number(fields.age) > 150)) {
          toast("年龄请填写 0 - 150 之间的数字"); return;
        }
        btn.disabled = true;
        if (cloud) {
          const r = await window.SDJCloud.saveMyProfile(fields);
          btn.disabled = false;
          if (!r.ok) { toast(r.error || "保存失败"); return; }
          const sess = getSession() || {};
          sess.displayName = fields.display_name;
          setSession(sess);
          const cached = socialProfilesCache.find(x => x.username === (sess.username || fields.display_name));
          if (cached) {
            cached.name = fields.display_name;
            cached.gender = fields.gender;
            cached.age = fields.age === "" ? "" : Number(fields.age);
            cached.avatar = fields.avatar_url;
            cached.sign = fields.sign;
          }
        } else {
          const accs = getAccounts();
          const sess = getSession() || {};
          const username = sess.username || sess.displayName;
          const acc = accs.find(a => a.username === username);
          if (acc) {
            acc.displayName = fields.display_name;
            acc.gender = fields.gender;
            acc.age = fields.age;
            acc.avatar = fields.avatar_url;
            acc.sign = fields.sign;
            saveAccounts(accs);
          }
          sess.displayName = fields.display_name;
          setSession(sess);
        }
        box.remove();
        toast("个人资料已保存，全体成员可见");
        emitSocial();
        const host = document.getElementById("mainContent");
        if (host && currentMenuId === "dashboard") renderDashboardPage(host, fields.display_name);
      };
    });
  }

  // 回归测试 / 外部调用接口
  window.SDJDashboard = {
    dateTimeText,
    activities: (username, isAdmin, limit) => recentActivities(username, isAdmin, limit),
    pushActivity: (username, text, kind) => { pushActivity(username, text, kind); saveState(); },
    pushSystemActivity: (text, kind) => { pushSystemActivity(text, kind); saveState(); },
    broadcastText: () => dashboardBroadcastText(),
    alerts: () => loadState().systemAlerts || [],
    unreadAlerts: unreadAlertCount,
    bypass: (username) => recordRegisterBypass(username),
    state: () => loadState(),
    save: () => saveState(),
    refresh: () => {
      const host = document.getElementById("mainContent");
      if (host && currentMenuId === "dashboard") renderDashboardPage(host, getSession().displayName);
    }
  };

  /* =========================================================
   *  管理者快速操作 · 对话框与业务链路
   * ========================================================= */
  // 发布委托时的地点候选：优先读管理员维护过的地图缓存，没有缓存则用内置数据
  async function getLocationChoices() {
    let items = [];
    try {
      const raw = localStorage.getItem("sdj_map_data_v2");
      if (raw) {
        const store = JSON.parse(raw);
        if (Array.isArray(store.items)) items = store.items;
      }
    } catch (e) { /* 缓存损坏时回退到内置数据 */ }
    if (!items.length) {
      try {
        const mod = await import("./locations.js?v=3");
        items = mod.DEFAULT_MAP_ITEMS || [];
      } catch (e) { console.warn("[委托] 地点数据载入失败：", e); }
    }
    return items.filter(it => Number(it.level) >= 2);
  }

  // 管理端可整列覆盖的字段白名单。
  // missions / mission_reports / registration_requests / wallets / notifications
  // 都是多人并发写入的字段，只能走服务端函数，这里绝不能带，否则会覆盖别人刚写入的数据。
  function worldPatchSnapshot() {
    return {
      items: appState.items,
      members: appState.members,
      council: appState.council,
      codex: appState.codex,
      bag: appState.bag,
      cards: appState.cards,
      activity_log: appState.activityLog,
      system_alerts: appState.systemAlerts,
      friends: appState.friends,
      settings: appState.settings
    };
  }

  // 立即写入云端并返回是否成功：审批这类关键动作必须知道结果，不能只依赖 800ms 防抖
  async function pushWorldNow() {
    const cloud = !!(window.SDJCloud && window.SDJCloud.enabled());
    const sess = getSession();
    const patch = worldPatchSnapshot();
    try { localStorage.setItem(STATE_KEY, JSON.stringify(appState)); } catch (e) {}
    if (!cloud || !sess || sess.role !== "admin") return true;
    try {
      await window.SDJCloud.saveWorld(patch);
      return true;
    } catch (err) {
      console.warn("[云端] 同步失败：", err);
      return false;
    }
  }

  // 注册审批落库：只提交「注册申请 + 通知 + 动态」三列，并基于云端最新数组改写
  // 避免整行 upsert 把别人刚提交、本机还没同步到的申请一起覆盖掉
  async function persistRegistrationReview(target, status, note) {
    const cloud = !!(window.SDJCloud && window.SDJCloud.enabled());
    const sess = getSession();
    if (!cloud || !sess || sess.role !== "admin") {
      saveState();
      return true;
    }
    try {
      const world = await window.SDJCloud.loadWorld();
      const list = (world && Array.isArray(world.registration_requests))
        ? world.registration_requests.slice()
        : (appState.registrationRequests || []).slice();
      const it = list.find(x => x.id === target.id) || list.find(x => x.username === target.username);
      if (it) {
        it.status = status;
        it.reviewedAt = Date.now();
        it.note = note || "";
      }
      await window.SDJCloud.saveWorld({
        registration_requests: list,
        notifications: appState.notifications,
        activity_log: appState.activityLog
      });
      appState.registrationRequests = list;
      try { localStorage.setItem(STATE_KEY, JSON.stringify(appState)); } catch (e) {}
      worldStamp = "";
      return true;
    } catch (err) {
      console.warn("[云端] 注册审批写入失败：", err);
      return false;
    }
  }

  // 提交任务内容：先让玩家写清完成情况，再进入管理者审批队列
  function openMissionSubmitDialog(m, onSubmit) {
    const overlay = el("div", { class: "modal-overlay", id: "submitModal" });
    const panel = el("div", { class: "modal-panel panel-cut" });
    overlay.appendChild(panel);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("show"));
    panel.innerHTML = `
      <div class="modal-title">提交任务内容</div>
      <div class="modal-desc">${escHTML(m.title)} · ${escHTML(m.loc)} · 奖励 ${escHTML(rewardText(m))}</div>
      <textarea id="submitContent" maxlength="800" style="width:100%;min-height:150px;margin-top:12px;padding:10px 12px;border-radius:10px;background:rgba(0,0,0,.35);color:#eee;border:1px solid rgba(255,255,255,.18);font-family:inherit;line-height:1.6;resize:vertical"
        placeholder="如已在群内完成委托，请直接输入已完成并提交，管理者会查阅之后在后台进行完成审批"></textarea>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px">
        <button class="btn-sm ghost" id="submitCancel">取消</button>
        <button class="btn-sm" id="submitConfirm">提交</button>
      </div>`;
    const ta = panel.querySelector("#submitContent");
    panel.querySelector("#submitCancel").onclick = () => overlay.remove();
    panel.querySelector("#submitConfirm").onclick = async () => {
      const content = ta.value.trim();
      if (!content) { toast("请填写任务情况，可直接输入「已完成」"); ta.focus(); return; }
      const btn = panel.querySelector("#submitConfirm");
      btn.disabled = true;
      let ok = false;
      try { ok = await onSubmit(content); } finally { btn.disabled = false; }
      if (ok) overlay.remove();
    };
    setTimeout(() => ta.focus(), 80);
  }

  function closeActionDialog() {
    const old = document.getElementById("actionModal");
    if (old) old.remove();
  }

  /* ---------------- 委托任务编辑器（主控台与任务管理共用） ---------------- */
  function itemOptionsHTML(selectedId) {
    const s = loadState();
    const items = s.items || [];
    if (!items.length) return `<option value="">暂无道具，请先编辑道具</option>`;
    const byCat = [
      ["normal", "普通道具"],
      ["affinity", "好感度道具"]
    ];
    return `<option value="">请选择道具</option>` + byCat.map(([cat, label]) => {
      const list = items.filter(i => i.category === cat);
      if (!list.length) return "";
      return `<optgroup label="${label}">` + list.map(i =>
        `<option value="${escHTML(i.id)}" ${i.id === selectedId ? "selected" : ""}>${escHTML(i.name)}（${i.rarity}）</option>`
      ).join("") + `</optgroup>`;
    }).join("");
  }

  function renderItemCatalogList(panel) {
    const s = loadState();
    const box = panel.querySelector("#ieList");
    if (!box) return;
    box.innerHTML = (s.items || []).map(i => `
      <div class="item-row" data-item="${escHTML(i.id)}">
        <span class="rarity-chip" style="color:${RARITY_META[i.rarity]?.color || "#fff"}">${escHTML(i.rarity)}</span>
        <span class="item-row-name">${escHTML(i.name)}</span>
        <span class="item-row-cat">${i.category === "affinity" ? "好感度道具" : "普通道具"}</span>
        <span class="item-row-maker">${escHTML(i.maker)}</span>
        <button class="link-btn" data-edit-item="${escHTML(i.id)}">编辑</button>
        <button class="link-btn warn" data-del-item="${escHTML(i.id)}">删除</button>
      </div>`).join("") || `<div class="empty-state">暂无道具，使用下方表单创建</div>`;
  }

  function openItemCatalog(afterChange) {
    const overlay = el("div", { class: "modal-overlay", id: "itemModal" });
    const panel = el("div", { class: "modal-panel panel-cut wide" });
    overlay.appendChild(panel);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("show"));

    let editingId = null;
    const rarityOps = Object.keys(RARITY_META).map(k =>
      `<option value="${k}">${k} · ${RARITY_META[k].label}</option>`).join("");

    panel.innerHTML = `
      <div class="modal-title">道具编辑</div>
      <div class="modal-desc">普通道具 / 好感度道具，各有 N、R、SR、SSR、SP 五个稀有度。所有字段必填。</div>
      <div class="item-catalog-list" id="ieList"></div>
      <div class="item-form">
        <div class="form-row-2">
          <label class="modal-label">道具类型
            <select class="input-line" id="ieCat">
              <option value="normal">普通道具</option><option value="affinity">好感度道具</option>
            </select>
          </label>
          <label class="modal-label">道具等级
            <select class="input-line" id="ieRarity">${rarityOps}</select>
          </label>
        </div>
        <label class="modal-label">道具名称<input class="input-line" id="ieName" maxlength="24" placeholder="如：旧日残页"></label>
        <label class="modal-label">道具介绍
          <textarea class="input-line" id="ieIntro" rows="3" maxlength="1000" placeholder="最多 1000 字"></textarea>
        </label>
        <div class="form-row-2">
          <label class="modal-label">道具作用<input class="input-line" id="ieEffect" maxlength="60"></label>
          <label class="modal-label">使用场景<input class="input-line" id="ieScene" maxlength="60"></label>
        </div>
        <label class="modal-label">制作者<input class="input-line" id="ieMaker" maxlength="24"></label>
        <div class="modal-actions">
          <button class="btn-sm" id="ieSave">保存道具</button>
          <button class="btn-sm ghost" id="ieReset">清空表单</button>
          <button class="btn-sm ghost" data-close>关闭</button>
        </div>
      </div>
    `;

    const $ = (sel) => panel.querySelector(sel);
    renderItemCatalogList(panel);
    $("[data-close]").onclick = () => { overlay.remove(); if (afterChange) afterChange(); };

    function resetForm() {
      editingId = null;
      $("#ieCat").value = "normal";
      $("#ieRarity").value = "N";
      $("#ieName").value = "";
      $("#ieIntro").value = "";
      $("#ieEffect").value = "";
      $("#ieScene").value = "";
      $("#ieMaker").value = "";
      $("#ieSave").textContent = "保存道具";
    }
    $("#ieReset").onclick = resetForm;

    function bindRows() {
      panel.querySelectorAll("[data-edit-item]").forEach(btn => {
        btn.onclick = () => {
          const item = loadState().items.find(i => i.id === btn.dataset.editItem);
          if (!item) return;
          editingId = item.id;
          $("#ieCat").value = item.category;
          $("#ieRarity").value = item.rarity;
          $("#ieName").value = item.name;
          $("#ieIntro").value = item.intro;
          $("#ieEffect").value = item.effect;
          $("#ieScene").value = item.scene;
          $("#ieMaker").value = item.maker;
          $("#ieSave").textContent = "保存修改";
        };
      });
      panel.querySelectorAll("[data-del-item]").forEach(btn => {
        btn.onclick = () => {
          const id = btn.dataset.delItem;
          const s = loadState();
          s.items = (s.items || []).filter(i => i.id !== id);
          saveState();
          renderItemCatalogList(panel);
          bindRows();
          toast("道具已删除");
        };
      });
    }
    bindRows();

    $("#ieSave").onclick = () => {
      const cat = $("#ieCat").value;
      const rarity = $("#ieRarity").value;
      const name = $("#ieName").value.trim();
      const intro = $("#ieIntro").value.trim();
      const effect = $("#ieEffect").value.trim();
      const scene = $("#ieScene").value.trim();
      const maker = $("#ieMaker").value.trim();
      if (!name || !intro || !effect || !scene || !maker) {
        toast("道具名称、介绍、作用、场景、制作者均为必填");
        return;
      }
      if (intro.length > 1000) { toast("道具介绍不能超过 1000 字"); return; }
      const s = loadState();
      s.items = s.items || [];
      if (editingId) {
        const item = s.items.find(i => i.id === editingId);
        if (item) Object.assign(item, { category: cat, rarity, name, intro, effect, scene, maker });
      } else {
        s.items.unshift({
          id: "it" + Date.now(), category: cat, rarity, name, intro, effect, scene, maker, createdAt: Date.now()
        });
      }
      saveState();
      renderItemCatalogList(panel);
      bindRows();
      resetForm();
      toast(editingId ? "道具已更新" : "道具已创建");
    };
  }

  /* ---------------- 新建 / 编辑委托（唯一入口） ---------------- */
  function openMissionEditor(missionId, preset) {
    closeActionDialog();
    const s = loadState();
    const cloud = !!(window.SDJCloud && window.SDJCloud.enabled());
    const presetLocId = preset && preset.locationId ? String(preset.locationId) : "";
    const editing = missionId ? (s.missions || []).find(m => m.id === missionId) : null;
    if (missionId && !editing) { toast("委托不存在"); return; }
    if (editing && (editing.acceptors || []).length > 0) {
      toast("该委托已有接取者，已锁定为仅可查看");
      return;
    }

    const overlay = el("div", { class: "modal-overlay", id: "actionModal" });
    const panel = el("div", { class: "modal-panel panel-cut wide" });
    overlay.appendChild(panel);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeActionDialog(); });
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("show"));

    const levelOps = ["D", "C", "B", "A"].map(lv =>
      `<option value="${lv}" ${editing && editing.level === lv ? "selected" : (!editing && lv === "C" ? "selected" : "")}>${lv} 级</option>`).join("");
    const dl = editing && editing.deadline ? editing.deadline : { mode: "days", amount: 7 };
    const rw = editing && editing.reward ? editing.reward : { type: "points", points: 80 };

    panel.innerHTML = `
      <div class="modal-title">${editing ? "编辑委托任务" : "新增委托任务"}</div>
      <div class="modal-desc">与主控台「发布委托任务」等价；发布后进入「当前存在委托」，被接取后自动锁定。</div>
      <div class="form-row-2">
        <label class="modal-label">任务名称<input class="input-line" id="meTitle" maxlength="40" placeholder="如：夜巡 K-7" value="${escHTML(editing ? editing.title : "")}"></label>
        <label class="modal-label">等级<select class="input-line" id="meLevel">${levelOps}</select></label>
      </div>
      <label class="modal-label">关联地点<select class="input-line" id="meLoc"><option value="">载入地点中…</option></select></label>
      <label class="modal-label">任务描述
        <textarea class="input-line" id="meDesc" rows="4" maxlength="600" placeholder="最多 600 字">${escHTML(editing ? editing.desc : "")}</textarea>
        <span class="field-hint">0 / 600</span>
      </label>
      <div class="form-row-2">
        <label class="modal-label">总可接取人数<input class="input-line" id="meSlots" type="number" min="1" max="99" value="${editing ? (editing.slots || 1) : 3}"></label>
        <label class="modal-label">任务时限
          <select class="input-line" id="meDlMode">
            <option value="range" ${dl.mode === "range" ? "selected" : ""}>指定时间段</option>
            <option value="days" ${!dl.mode || dl.mode === "days" ? "selected" : ""}>持续天数</option>
            <option value="months" ${dl.mode === "months" ? "selected" : ""}>持续月数</option>
          </select>
        </label>
      </div>
      <div class="deadline-box panel-cut">
        <div class="form-row-2" id="meDlRange">
          <label class="modal-label">开始（时）<input class="input-line" id="meStart" type="number" min="0" max="23" value="${dl.startHour != null ? dl.startHour : 20}"></label>
          <label class="modal-label">结束（时）<input class="input-line" id="meEnd" type="number" min="0" max="23" value="${dl.endHour != null ? dl.endHour : 23}"></label>
        </div>
        <label class="modal-label" id="meDlDaysWrap">持续天数<input class="input-line" id="meDays" type="number" min="1" max="365" value="${dl.mode === "days" ? (dl.amount || 7) : 7}"></label>
        <label class="modal-label" id="meDlMonthsWrap">持续月数<input class="input-line" id="meMonths" type="number" min="1" max="24" value="${dl.mode === "months" ? (dl.amount || 1) : 1}"></label>
      </div>
      <div class="form-row-2">
        <label class="modal-label">奖励类型
          <select class="input-line" id="meRtype">
            <option value="points" ${rw.type !== "item" ? "selected" : ""}>计划点</option>
            <option value="item" ${rw.type === "item" ? "selected" : ""}>道具</option>
          </select>
        </label>
        <label class="modal-label" id="mePointsWrap">计划点数量<input class="input-line" id="mePoints" type="number" min="1" max="99999" value="${rw.type !== "item" ? (rw.points || 80) : 80}"></label>
      </div>
      <div id="meItemWrap" class="item-pick">
        <label class="modal-label">奖励道具<select class="input-line" id="meItem">${itemOptionsHTML(rw.itemId)}</select></label>
        <button class="btn-sm ghost" id="meItemEdit" type="button">道具编辑</button>
      </div>
      <div class="modal-actions">
        <button class="btn-sm" id="meSend">${editing ? "保存修改" : "发布任务"}</button>
        <button class="btn-sm ghost" data-close>关闭</button>
      </div>
    `;

    const $ = (sel) => panel.querySelector(sel);
    const descEl = $("#meDesc");
    const hint = panel.querySelector(".field-hint");
    const syncHint = () => { if (hint) hint.textContent = `${descEl.value.length} / 600`; };
    descEl.addEventListener("input", syncHint);
    syncHint();

    function syncMode() {
      const mode = $("#meDlMode").value;
      $("#meDlRange").hidden = mode !== "range";
      $("#meDlDaysWrap").hidden = mode !== "days";
      $("#meDlMonthsWrap").hidden = mode !== "months";
    }
    function syncReward() {
      const isItem = $("#meRtype").value === "item";
      $("#mePointsWrap").hidden = isItem;
      $("#meItemWrap").hidden = !isItem;
    }
    $("#meDlMode").addEventListener("change", syncMode);
    $("#meRtype").addEventListener("change", syncReward);
    syncMode();
    syncReward();

    $("#meItemEdit").onclick = () => {
      openItemCatalog(() => { $("#meItem").innerHTML = itemOptionsHTML($("#meItem").value); });
    };

    getLocationChoices().then(items => {
      const sel = $("#meLoc");
      if (!sel) return;
      const groups = new Map();
      items.forEach(it => {
        const key = it.district || "其他地点";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(it);
      });
      let html = `<option value="">请选择地点</option>`;
      groups.forEach((list, district) => {
        html += `<optgroup label="${escHTML(district)}">` + list.map(it => {
          const selected = (editing && editing.locationId === it.id) || (!editing && presetLocId === String(it.id));
          return `<option value="${escHTML(it.id)}" data-name="${escHTML(it.name)}" ${selected ? "selected" : ""}>${escHTML(it.name)}（L${it.level}）</option>`;
        }).join("") + `</optgroup>`;
      });
      sel.innerHTML = html;
      if (!editing && presetLocId) sel.value = presetLocId;
    });

    $("[data-close]").onclick = closeActionDialog;
    $("#meTitle").focus();

    $("#meSend").onclick = async () => {
      const title = $("#meTitle").value.trim();
      const level = $("#meLevel").value;
      const sel = $("#meLoc");
      const locationId = sel.value;
      const locName = sel.selectedOptions[0] ? (sel.selectedOptions[0].dataset.name || "") : "";
      const desc = descEl.value.trim();
      const slots = Math.max(1, Math.min(99, Number($("#meSlots").value) || 1));
      const dlMode = $("#meDlMode").value;
      const deadline = buildDeadline(dlMode, {
        startHour: $("#meStart").value,
        endHour: $("#meEnd").value,
        amount: dlMode === "months" ? $("#meMonths").value : $("#meDays").value
      });
      const rtype = $("#meRtype").value;
      let reward;
      if (rtype === "item") {
        const itemId = $("#meItem").value;
        const item = (loadState().items || []).find(i => i.id === itemId);
        if (!item) { toast("请选择奖励道具，或先创建道具"); return; }
        reward = { type: "item", itemId: item.id, itemName: item.name, rarity: item.rarity, label: `${item.name}（${item.rarity}）` };
      } else {
        const pts = Math.max(1, Math.min(99999, Number($("#mePoints").value) || 1));
        reward = { type: "points", points: pts, label: `计划点 ×${pts}` };
      }
      if (!title) { toast("任务名称不能为空"); return; }
      if (!locationId) { toast("请选择关联地点"); return; }
      if (!desc) { toast("任务描述不能为空"); return; }

      const btn = $("#meSend");
      btn.disabled = true;
      try {
        const draft = editing
          ? Object.assign({}, editing, { title, level, locationId, loc: locName, desc, reward, slots, deadline })
          : {
              id: "m" + Date.now(),
              title, level, locationId, loc: locName, desc, reward, slots,
              acceptors: [], status: "available", deadline, createdAt: Date.now()
            };
        if (cloud) {
          // 走服务端函数：保留玩家已产生的接取人 / 状态，不整列覆盖
          const r = await window.SDJCloud.saveMission(draft);
          if (!r.ok) { toast(r.error || "云端保存失败"); btn.disabled = false; return; }
          await syncWorldFromCloud(true);
        } else {
          if (editing) Object.assign(editing, draft);
          else appState.missions.unshift(draft);
          saveState();
        }
        pushSystemActivity(`管理者${editing ? "更新" : "发布"}委托「${title}」（${level} 级 · ${locName}）`, "mission");
        saveState();
        if (globeEngine && typeof globeEngine.refreshMissions === "function") globeEngine.refreshMissions();
        toast(`委托「${title}」已${editing ? "更新" : "发布"}${cloud ? "并同步云端" : ""}`);
        closeActionDialog();
        const host = document.getElementById("mainContent");
        if (currentMenuId === "mission" && host) renderMissionPage(host, viewRole === "admin");
        if (currentMenuId === "dashboard" && viewRole === "admin" && host) renderDashboardPage(host, getSession().displayName);
      } catch (err) {
        console.error("[委托] 保存失败：", err);
        toast("保存失败：" + (err.message || "未知错误"));
        btn.disabled = false;
      }
    };
  }

  function openAdminActionDialog(actionId) {
    closeActionDialog();
    const s = loadState();
    const cloud = !!(window.SDJCloud && window.SDJCloud.enabled());

    const overlay = el("div", { class: "modal-overlay", id: "actionModal" });
    const panel = el("div", { class: "modal-panel panel-cut" });
    overlay.appendChild(panel);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeActionDialog(); });
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("show"));

    const closeBar = `<button class="btn-sm ghost" data-close>关闭</button>`;

    /* 0 · 发布全服广播 —— 直接跳到「神降系统成员管理」页的广播栏（图 1），
       与那里共用同一个输入框、同一个发布函数和同一份广播数据，不再维护重复弹窗。 */
    if (actionId === 0) {
      overlay.remove();
      jumpToMemberBroadcast();
      return;
    }

    /* 1 · 发布委托任务 —— 与「任务管理 › 新增委托任务」同一入口 */
    if (actionId === 1) {
      overlay.remove();
      openMissionEditor();
      return;
    }

    /* 2 · 成员权限管理 */
    if (actionId === 2) {
      const roleOptions = (cur) => ["玩家", "契约者", "管理者"]
        .map(r => `<option value="${r}" ${r === cur ? "selected" : ""}>${r}</option>`).join("");
      panel.innerHTML = `
        <div class="modal-title">成员权限管理</div>
        <div class="modal-desc">调整身份后立即生效；如需限制访问，请进入成员页操作。</div>
        <div class="member-quick">
          ${s.members.map(m => `
            <div class="member-quick-row">
              <span class="member-quick-name">${escHTML(m.name)}</span>
              <select class="input-line" data-mrole="${m.id}">${roleOptions(m.role)}</select>
            </div>`).join("") || `<div class="empty-state">暂无成员记录</div>`}
        </div>
        <div class="modal-actions">
          <button class="btn-sm" id="mbSave">保存变更</button>
          <button class="btn-sm ghost" id="mbOpen">打开成员页</button>
          ${closeBar}
        </div>
      `;
      panel.querySelector("[data-close]").onclick = closeActionDialog;
      panel.querySelector("#mbOpen").onclick = () => {
        closeActionDialog();
        const item = document.querySelector('.menu-item[data-id="member"]');
        if (item) item.click();
      };
      panel.querySelector("#mbSave").onclick = async () => {
        const btn = panel.querySelector("#mbSave");
        btn.disabled = true;
        try {
          let changed = 0;
          panel.querySelectorAll("[data-mrole]").forEach(sel => {
            const m = appState.members.find(x => x.id === sel.dataset.mrole);
            if (m && m.role !== sel.value) { m.role = sel.value; changed++; }
          });
          if (!changed) { toast("没有需要保存的变更"); btn.disabled = false; return; }
          const synced = await pushWorldNow();
          toast(synced
            ? (cloud ? `已更新 ${changed} 名成员身份并同步云端` : `已更新 ${changed} 名成员身份`)
            : `已保存本地，云端同步失败`);
          closeActionDialog();
        } catch (err) {
          console.error("[成员] 保存失败：", err);
          toast("保存失败：" + (err.message || "未知错误"));
          btn.disabled = false;
        }
      };
      return;
    }

    /* 3 · 系统核心维护 */
    panel.innerHTML = `
      <div class="modal-title">系统核心维护</div>
      <div class="modal-desc">以下操作会直接修改本地与云端数据，请谨慎执行。</div>
      <div class="maint-list">
        <button class="btn-sm" data-mt="archive">归档已完成委托</button>
        <button class="btn-sm ghost" data-mt="checkmap">校验地点坐标</button>
        <button class="btn-sm ghost" data-mt="integrity">数据完整性检查</button>
      </div>
      <div class="maint-result" id="mtResult">请选择一项维护操作…</div>
      <div class="modal-actions">${closeBar}</div>
    `;
    panel.querySelector("[data-close]").onclick = closeActionDialog;
    const resultEl = panel.querySelector("#mtResult");
    const setResult = (text) => { resultEl.textContent = text; };

    panel.querySelectorAll("[data-mt]").forEach(btn => {
      btn.onclick = async () => {
        const type = btn.dataset.mt;
        btn.disabled = true;
        try {
          if (type === "archive") {
            const done = appState.missions.filter(m => m.status === "done");
            if (!done.length) { setResult("没有已完成且待归档的委托。"); btn.disabled = false; return; }
            appState.missions = appState.missions.filter(m => m.status !== "done");
            const synced = await pushWorldNow();
            setResult(`已归档 ${done.length} 项委托${cloud ? (synced ? "，并同步云端" : "，云端同步失败（已存本地）") : ""}。`);
            toast(`已归档 ${done.length} 项委托`);
            if (currentMenuId === "mission") renderMissionPage(document.getElementById("mainContent"), true);
          } else if (type === "checkmap") {
            const raw = localStorage.getItem("sdj_map_data_v2");
            if (!raw) { setResult("本地暂无地点缓存（首次进入地图时会自动生成）。"); btn.disabled = false; return; }
            const store = JSON.parse(raw);
            const items = Array.isArray(store.items) ? store.items : [];
            const invalid = items.filter(it =>
              !Number.isFinite(Number(it.lat)) || !Number.isFinite(Number(it.lon)) ||
              Math.abs(Number(it.lat)) > 90 || Math.abs(Number(it.lon)) > 180 ||
              !it.name || !it.level
            );
            setResult(`地点总数 ${items.length}，坐标/字段异常 ${invalid.length} 项${invalid.length ? "：" + invalid.slice(0, 3).map(i => i.name || i.id).join("、") : "。"}`);
            toast(invalid.length ? "发现异常地点，详见结果" : "地点数据校验通过");
          } else if (type === "integrity") {
            const checks = [
              ["委托", appState.missions.length],
              ["成员", appState.members.length],
              ["注册申请", (appState.registrationRequests || []).length],
              ["完成申请", (appState.missionReports || []).length],
              ["论坛", appState.forum.length],
              ["议会", appState.council.length],
              ["图鉴", appState.codex.length],
              ["背包", appState.bag.length],
              ["好友", appState.friends.length]
            ];
            const missing = ["missions", "members", "registrationRequests", "missionReports", "forum", "council", "codex", "bag", "friends"]
              .filter(k => !Array.isArray(appState[k]));
            setResult(missing.length
              ? `发现缺失数据集：${missing.join("、")}`
              : `数据集完整：${checks.map(([n, c]) => `${n} ${c}`).join(" · ")}`);
            toast(missing.length ? "数据完整性存在问题" : "数据完整性检查通过");
          }
        } catch (err) {
          console.error("[维护] 执行失败：", err);
          setResult("执行失败：" + (err.message || "未知错误"));
          toast("维护操作失败");
        } finally {
          btn.disabled = false;
        }
      };
    });
  }

  // 3D 地图页面（引擎按需动态加载，避免首屏就拉取 Three.js）
  async function renderMapPage(container, userRole) {
    container.innerHTML = `
      <div id="globe-container"></div>
      
      <!-- 右侧信息面板 -->
      <div class="map-info-panel" id="infoPanel">
        <div class="info-header">
          <div class="info-title" id="infoTitle">地点名称</div>
          <div class="info-close" id="infoClose">×</div>
        </div>
        <div class="info-body">
          <div class="info-geo" id="infoGeo">L3 · 0.00, 0.00</div>
          <div class="info-desc" id="infoDesc">这里是地点的详细描述，包含当前状态、所属势力以及地形特征。</div>
          <div class="info-task">
            <div class="info-task-title">该地点的委托</div>
            <div class="info-task-desc" id="infoTaskDesc">等待管理者发布委托</div>
          </div>
          <button class="info-btn ghost" id="btnTrack">追踪该地点</button>
        </div>
      </div>

      <!-- 委托侧边栏（可收缩） -->
      <aside class="mission-dock" id="missionDock">
        <button class="dock-toggle" id="dockToggle" title="展开 / 收起委托列表">委托<br>列表</button>
        <div class="dock-inner">
          <div class="dock-head">
            <span>地图委托</span>
            <span class="dock-count" id="dockCount">0 项</span>
          </div>
          <div class="dock-list" id="dockList"></div>
          <div class="dock-legend" id="dockLegend"></div>
        </div>
      </aside>

      <!-- 地点管理抽屉（管理者） -->
      <div class="point-drawer" id="pointDrawer">
        <div class="drawer-head">
          <span>地点管理 · POINT CRUD</span>
          <span class="info-close" id="drawerClose">×</span>
        </div>
        <div class="drawer-body" id="drawerBody"></div>
      </div>

      <!-- 管理员工具栏 -->
      <div class="admin-toolbar" id="adminToolbar" style="display: none;">
        <button class="admin-btn" id="btnAddMode">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
          添加地点（点击球体）
        </button>
        <button class="admin-btn" id="btnManagePoints">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z"/></svg>
          地点管理
        </button>
      </div>

      <!-- 追踪提示 -->
      <div class="map-hint show" id="mapHint">点击图钉查看详情 · 滚轮缩放 · 拖拽旋转</div>
    `;

    const host = document.getElementById("globe-container");
    // 云端模式下先用全服地图覆盖本地缓存，再交给引擎渲染
    if (window.SDJMap) {
      const remote = await window.SDJMap.pull();
      if (remote && Array.isArray(remote.items) && remote.items.length) {
        try { localStorage.setItem("sdj_map_data_v2", JSON.stringify(remote)); } catch (e) {}
      }
      if (!host || !host.isConnected) return;
    }
    try {
      // 经典脚本中 import() 以脚本自身地址为基准，故这里相对 js/app.js 解析
      const { GlobeMapEngine } = await import("./map.js?v=5");
      if (!host || !host.isConnected) return;
      globeEngine = new GlobeMapEngine("globe-container", userRole);
      // 暴露给调试与后续扩展（只读使用），也便于控制台验证委托绑定
      window.SDJMapEngine = globeEngine;
      if (pendingMapLocation) {
        const target = pendingMapLocation;
        pendingMapLocation = null;
        let label = target.id ? globeEngine.labels.find(l => l.userData.id === target.id) : null;
        if (!label && Number.isFinite(Number(target.lat)) && Number.isFinite(Number(target.lon))) {
          let best = null, bestDist = Infinity;
          globeEngine.labels.forEach(l => {
            const d = Math.hypot(Number(l.userData.lat) - Number(target.lat), Number(l.userData.lon) - Number(target.lon));
            if (d < bestDist) { bestDist = d; best = l; }
          });
          if (best && bestDist < 2) label = best;
        }
        if (label) {
          globeEngine.onLabelClick(label);
          globeEngine.flyToTarget(label);
        } else if (target.lat != null && target.lon != null && typeof globeEngine.showTemporaryMarker === "function") {
          globeEngine.showTemporaryMarker(target);
        }
      }
    } catch (err) {
      console.error("[地图引擎加载失败]", err);
      if (host && host.isConnected) {
        host.innerHTML = `<div class="map-error"><strong>地图引擎加载失败</strong><span>无法载入 Three.js 模块。请确认页面是通过本地服务器打开（如 http://localhost:8765/），并保持网络可用。</span></div>`;
      }
      return;
    }

    // 管理面板是可选增强，初始化失败时不能连带把地图一起打掉
    if (userRole === "admin") {
      try { setupPointDrawer(container); }
      catch (err) { console.error("[地点管理面板初始化失败]", err); }
    }
  }

  /* ---------------- 地点 CRUD 抽屉（管理者） ---------------- */
  function setupPointDrawer(container) {
    const drawer = container.querySelector("#pointDrawer");
    const body = container.querySelector("#drawerBody");
    const manageBtn = container.querySelector("#btnManagePoints");
    if (!drawer || !body || !manageBtn) return;

    let editingId = null;
    let formOverlay = null;

    const closeForm = () => {
      editingId = null;
      if (formOverlay) { formOverlay.remove(); formOverlay = null; }
    };

    // 编辑/新增一律弹出居中浮窗，避免长列表里点击下方的 L 还要滚回顶部
    const openForm = (data) => {
      closeForm();
      const isNew = !data.id;
      editingId = data.id || null;
      formOverlay = document.createElement("div");
      formOverlay.className = "modal-overlay point-overlay";
      formOverlay.innerHTML = `
        <div class="modal-panel panel-cut point-modal">
        <div class="form-title">${isNew ? "新增地点" : "编辑地点"}</div>
        <label>名称<input class="input-line" data-f="name" maxlength="24" value="${escHTML(data.name || "")}"></label>
        <div class="form-row-2">
          <label>区域<input class="input-line" data-f="district" maxlength="8" value="${escHTML(data.district || "A区")}"></label>
          <label>等级
            <select class="input-line" data-f="level">
              ${[1, 2, 3, 4].map(l => `<option value="${l}" ${Number(data.level) === l ? "selected" : ""}>L${l}</option>`).join("")}
            </select>
          </label>
        </div>
        <div class="form-row-2">
          <label>纬度<input class="input-line" data-f="lat" type="number" step="0.01" value="${Number(data.lat ?? 0).toFixed(2)}"></label>
          <label>经度<input class="input-line" data-f="lon" type="number" step="0.01" value="${Number(data.lon ?? 0).toFixed(2)}"></label>
        </div>
        <label>描述<input class="input-line" data-f="desc" maxlength="120" value="${escHTML(data.desc || "")}"></label>
        <div class="form-actions">
          <button class="btn-sm" data-act="save">保存</button>
          <button class="btn-sm ghost" data-act="cancel">取消</button>
        </div>
        </div>`;
      document.body.appendChild(formOverlay);
      requestAnimationFrame(() => formOverlay.classList.add("show"));
      formOverlay.addEventListener("click", (e) => { if (e.target === formOverlay) closeForm(); });
      const form = formOverlay.querySelector(".point-modal");
      form.querySelector('[data-act="cancel"]').onclick = closeForm;
      form.querySelector('[data-act="save"]').onclick = () => {
        const get = k => form.querySelector(`[data-f="${k}"]`).value.trim();
        const name = get("name");
        if (!name) { toast("地点名称不能为空"); return; }
        const lat = parseFloat(get("lat"));
        const lon = parseFloat(get("lon"));
        if (Number.isNaN(lat) || Number.isNaN(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
          toast("经纬度不合法（纬度 ±90 / 经度 ±180）");
          return;
        }
        const payload = {
          id: editingId || "custom_" + Date.now(),
          name,
          district: get("district") || "A区",
          level: Number(form.querySelector('[data-f="level"]').value),
          lat, lon,
          desc: get("desc") || "管理者创建的地点。"
        };
        if (!globeEngine) { toast("地图尚未就绪"); return; }
        globeEngine.upsertLocation(payload);
        pushSystemActivity(`管理者${editingId ? "更新" : "新增"}地图地点「${name}」（${payload.district} · L${payload.level}）`, "map");
        saveState();
        toast(editingId ? `已更新「${name}」` : `已创建「${name}」`);
        closeForm();
        renderList();
      };
    };

    const renderList = () => {
      if (!globeEngine) return;
      const items = globeEngine.labelsData.slice().sort((a, b) => (a.level - b.level) || a.name.localeCompare(b.name));
      body.innerHTML = `
        <input class="input-line" id="pointSearch" placeholder="搜索地点名称 / 区域…">
        <div class="point-list" id="pointList">
          ${items.map(it => `
            <div class="point-row" data-row="${it.id}">
              <div class="point-main">
                <span class="level-chip">L${it.level}</span>
                <span class="point-name">${escHTML(it.name)}</span>
                <span class="point-sub">${escHTML(it.district || "—")} · ${Number(it.lat).toFixed(2)}, ${Number(it.lon).toFixed(2)}</span>
              </div>
              <div class="point-ops">
                <button class="link-btn" data-edit="${it.id}">编辑</button>
                <button class="link-btn danger" data-del="${it.id}">删除</button>
              </div>
            </div>`).join("")}
        </div>
        <button class="btn-sm" id="pointNew">+ 新增地点</button>
      `;
      body.querySelector("#pointNew").onclick = () => openForm({});
      body.querySelectorAll("[data-edit]").forEach(btn => {
        btn.onclick = () => {
          const item = globeEngine.labelsData.find(i => i.id === btn.dataset.edit);
          if (item) openForm(item);
        };
      });
      body.querySelectorAll("[data-del]").forEach(btn => {
        btn.onclick = () => {
          const item = globeEngine.labelsData.find(i => i.id === btn.dataset.del);
          if (!item) return;
          if (!confirm(`确认删除「${item.name}」？该操作不可撤销。`)) return;
          globeEngine.deleteLocation(item.id);
          pushSystemActivity(`管理者删除地图地点「${item.name}」（${item.district || "—"}）`, "map");
          saveState();
          toast(`已删除「${item.name}」`);
          renderList();
        };
      });
      const search = body.querySelector("#pointSearch");
      search.oninput = () => {
        const q = search.value.trim().toLowerCase();
        body.querySelectorAll(".point-row").forEach(row => {
          row.style.display = row.textContent.toLowerCase().includes(q) ? "" : "none";
        });
      };
    };

    manageBtn.onclick = () => {
      const opening = !drawer.classList.contains("show");
      drawer.classList.toggle("show", opening);
      if (opening) renderList();
    };
    container.querySelector("#drawerClose").onclick = () => drawer.classList.remove("show");

    const onPick = (e) => {
      if (!globeEngine) return;
      drawer.classList.add("show");
      renderList();
      openForm({ lat: e.detail.lat, lon: e.detail.lon, level: 4, district: "A区" });
      toast(`已选坐标 ${e.detail.lat.toFixed(2)}, ${e.detail.lon.toFixed(2)} · 请填写名称`);
    };
    document.addEventListener("sdj:map-pick", onPick);
    container._cleanupPick = () => document.removeEventListener("sdj:map-pick", onPick);
  }

  /* =========================================================
   *  B 组 · 数据层（所有模块共用一份本地持久化状态）
   * ========================================================= */
  const STATE_KEY = "sdj_state_v1";

  function defaultState() {
    return {
      missions: [],
      items: [],
      wallets: {},
      broadcasts: [],
      rosterVersion: 0,
      bag: [],
      cards: { version: 1, renames: {}, overrides: {}, added: {}, removed: {}, holdings: {} },
      forum: [],
      friends: [],
      council: [],
      codex: [],
      members: [],
      registrationRequests: [],
      missionReports: [],
      notifications: [],
      activityLog: [],
      systemAlerts: [],
      registerBypass: { count: 0, users: [] },
      demoScrubVersion: 0,
      settings: { sound: true, animation: true, autoLogin: false }
    };
  }

  let appState = null;

  // 卡牌状态与背包迁移：补齐卡牌容器、移除旧版占位道具（含已装备标记）
  function ensureCardsState(s) {
    if (!s.cards || typeof s.cards !== "object") {
      s.cards = { version: 1, renames: {}, overrides: {}, added: {}, removed: {}, holdings: {} };
    }
    const c = s.cards;
    c.version = 1;
    c.renames = c.renames || {};
    c.overrides = c.overrides || {};
    c.added = c.added || {};
    c.removed = c.removed || {};
    c.holdings = c.holdings || {};
    const legacyIds = ["i1", "i2", "i3", "i4", "i5", "i6"];
    const legacyNames = ["断裂的契约匕首", "暗红信标", "守夜人徽记", "残缺的塔图", "止血绷带 ×3", "旧式黄铜钥匙"];
    s.bag = (s.bag || []).filter(it => !legacyIds.includes(it.id) && !legacyNames.includes(it.name));
    return s;
  }

  // 旧版本内置的演示数据：首次加载时一次性清理，避免残留在任何账号的本地存档里
  function ensureDataState(s) {
    let changed = false;
    ["missions", "items", "forum", "friends", "council", "codex", "members",
      "registrationRequests", "missionReports", "notifications", "activityLog", "systemAlerts"].forEach(k => {
      if (!Array.isArray(s[k])) { s[k] = []; changed = true; }
    });
    if (!s.registerBypass || typeof s.registerBypass !== "object") {
      s.registerBypass = { count: 0, users: [] };
      changed = true;
    }
    if (s.demoScrubVersion !== 1) {
      const drop = (arr, ids, field) => (arr || []).filter(x => !ids.includes(x[field]));
      s.missions = drop(s.missions, ["m1", "m2", "m3", "m4"], "id");
      s.items = drop(s.items, ["it_seed_n", "it_seed_r", "it_seed_sr"], "id");
      s.forum = drop(s.forum, ["f1", "f2", "f3"], "id");
      s.friends = drop(s.friends, ["u1", "u2", "u3"], "id");
      s.council = drop(s.council, ["c1", "c2"], "id");
      s.codex = drop(s.codex, ["x1", "x2", "x3", "x4", "x5", "x6"], "id");
      s.members = drop(s.members, ["a1", "a2", "a3"], "id");
      s.demoScrubVersion = 1;
      changed = true;
    }
    if (changed) {
      try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
    }
    return s;
  }

  function loadState() {
    if (appState) return appState;
    try {
      const raw = localStorage.getItem(STATE_KEY);
      appState = raw ? Object.assign(defaultState(), JSON.parse(raw)) : defaultState();
    } catch (e) {
      appState = defaultState();
    }
    return ensureDataState(ensureCardsState(appState));
  }
  // 地图引擎通过该访问器读取委托数据，避免两边各自读一份导致数据孤岛
  window.SDJStore = {
    getMissions: () => loadState().missions,
    getMissionLevels: () => (window.SDJ_CONFIG && window.SDJ_CONFIG.missionLevels) || {}
  };

  /* ---------------- 审批链路公共能力 ---------------- */
  const REG_TIMEOUT_MS = 24 * 3600 * 1000;      // 注册申请 24 小时未处理自动失效
  const REPORT_TIMEOUT_MS = 48 * 3600 * 1000;   // 委托完成申请 48 小时未处理自动退回

  function pushNotification(username, text) {
    if (!username) return;
    loadState();
    appState.notifications.unshift({
      id: "n" + Date.now() + Math.random().toString(16).slice(2, 6),
      username: String(username),
      text,
      at: Date.now(),
      read: false
    });
    if (appState.notifications.length > 200) appState.notifications.length = 200;
  }

  /* ---------------- 动态日志 / 真实时间 / 系统告警 ---------------- */
  function dateTimeText(d) {
    const now = d || new Date();
    const week = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"][now.getDay()];
    const p = (n) => String(n).padStart(2, "0");
    return `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${week} ${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
  }

  function pushActivity(username, text, kind) {
    if (!username) return;
    const s = loadState();
    s.activityLog.unshift({
      id: "al" + Date.now() + Math.random().toString(16).slice(2, 5),
      username: String(username),
      scope: "self",
      kind: kind || "mission",
      text,
      at: Date.now()
    });
    if (s.activityLog.length > 300) s.activityLog.length = 300;
  }

  function pushSystemActivity(text, kind) {
    const s = loadState();
    s.activityLog.unshift({
      id: "al" + Date.now() + Math.random().toString(16).slice(2, 5),
      username: "*",
      scope: "system",
      kind: kind || "system",
      text,
      at: Date.now()
    });
    if (s.activityLog.length > 300) s.activityLog.length = 300;
  }

  function recentActivities(username, isAdmin, limit) {
    const s = loadState();
    const list = (s.activityLog || []).filter(e =>
      isAdmin || e.scope === "system" || e.username === username
    ).sort((a, b) => b.at - a.at);
    return list.slice(0, limit || 8);
  }

  // 未发送审批请求直接点注册：累计 3 次触发系统告警
  function recordRegisterBypass(username) {
    const cloud = !!(window.SDJCloud && window.SDJCloud.enabled());
    if (cloud) {
      // 跨设备告警：服务端累计并给所有管理者档案写未读通告
      window.SDJCloud.reportRegisterBypass(username || "").then(r => {
        if (r && r.ok && r.alerted && Number(r.count) === 3) toast("已通知管理者：检测到绕过审批注册");
      }).catch(() => {});
    }
    const s = loadState();
    const rb = s.registerBypass || (s.registerBypass = { count: 0, users: [] });
    rb.count = (Number(rb.count) || 0) + 1;
    rb.users = rb.users || [];
    rb.users.unshift({ username: username || "未知", at: Date.now() });
    if (rb.users.length > 50) rb.users.length = 50;

    const text = `未发送注册审批请求直接注册：${username || "未知"}（累计 ${rb.count} 次）`;
    if (rb.count >= 3) {
      let alert = (s.systemAlerts || []).find(a => a.kind === "register-bypass");
      if (alert) {
        alert.text = text;
        alert.count = rb.count;
        alert.at = Date.now();
        alert.read = false;
      } else {
        s.systemAlerts = s.systemAlerts || [];
        s.systemAlerts.unshift({
          id: "sa" + Date.now(), kind: "register-bypass",
          text, count: rb.count, at: Date.now(), read: false
        });
        if (s.systemAlerts.length > 50) s.systemAlerts.length = 50;
      }
      pushSystemActivity(text, "alert");
    }
    saveState();
    if (!cloud && rb.count >= 3 && (rb.count === 3 || rb.count % 3 === 0)) {
      notifyAdmins(`系统告警：${text}`);
      saveState();
    }
  }

  function unreadAlertCount() {
    return (loadState().systemAlerts || []).filter(a => !a.read).length;
  }

  /* ---------------- 委托数据模型：奖励 / 时限 / 倒计时 / 迁移 ---------------- */
  const RARITY_META = {
    N:  { label: "普通", cls: "普通", color: "#b9b9b9", weight: 1 },
    R:  { label: "精良", cls: "精良", color: "#6fbf73", weight: 2 },
    SR: { label: "稀有", cls: "稀有", color: "#5aa9ff", weight: 3 },
    SSR:{ label: "传说", cls: "传说", color: "#c77dff", weight: 4 },
    SP: { label: "神话", cls: "传说", color: "#ffb300", weight: 5 }
  };

  function rarityLabel(r) { return (RARITY_META[r] || RARITY_META.N).label; }
  function rarityClass(r) { return (RARITY_META[r] || RARITY_META.N).cls; }

  function rewardText(m) {
    const r = m && m.reward;
    if (!r) return "未设定";
    if (typeof r === "string") return r;
    if (r.type === "item") return `${r.itemName || "道具"}（${r.rarity || "N"}）`;
    return `计划点 ×${Number(r.points) || 0}`;
  }

  // 旧数据迁移：字符串奖励 → 结构化奖励；required → slots
  function migrateMissions() {
    const s = loadState();
    let changed = false;
    (s.missions || []).forEach(m => {
      if (typeof m.reward === "string") {
        const text = m.reward;
        const pts = text.match(/(\d+)/);
        m.reward = /点/.test(text)
          ? { type: "points", points: pts ? Number(pts[1]) : 50, label: `计划点 ×${pts ? Number(pts[1]) : 50}` }
          : { type: "item", itemName: text.replace(/[×x]\s*\d+/, "").trim() || text, rarity: "N", label: text };
        changed = true;
      }
      if (!m.reward) {
        m.reward = { type: "points", points: 50, label: "计划点 ×50" };
        changed = true;
      }
      if (m.slots == null) { m.slots = m.required || 1; changed = true; }
      if (!Array.isArray(m.acceptors)) { m.acceptors = []; changed = true; }
      if (m.deadline === undefined) { m.deadline = null; changed = true; }
      if (m.status === "done" && !m.completedAt) { m.completedAt = Date.now(); changed = true; }
    });
    if (!Array.isArray(s.items)) { s.items = defaultState().items; changed = true; }
    if (!s.wallets || typeof s.wallets !== "object") { s.wallets = {}; changed = true; }
    if (changed) saveState();
  }

  function fmtCountdown(endsAt) {
    if (!endsAt) return "无时限";
    const left = endsAt - Date.now();
    if (left <= 0) return "已截止";
    const d = Math.floor(left / 86400000);
    const h = Math.floor(left % 86400000 / 3600000);
    const mi = Math.floor(left % 3600000 / 60000);
    const se = Math.floor(left % 60000 / 1000);
    const p = (n) => String(n).padStart(2, "0");
    return d > 0 ? `${d} 天 ${p(h)}:${p(mi)}:${p(se)}` : `${p(h)}:${p(mi)}:${p(se)}`;
  }

  function deadlineLabel(dl) {
    if (!dl || !dl.mode) return "长期有效";
    if (dl.mode === "range") return `${dl.startLabel || "今日"} — ${dl.endLabel || ""}`;
    if (dl.mode === "days") return `持续 ${dl.amount} 天`;
    if (dl.mode === "months") return `持续 ${dl.amount} 个月`;
    return "长期有效";
  }

  // 生成时限对象；range 模式结束时间若已过则顺延到次日
  function buildDeadline(mode, opts) {
    const now = new Date();
    const p = (n) => String(n).padStart(2, "0");
    if (mode === "days") {
      const amount = Math.max(1, Math.min(365, Number(opts.amount) || 7));
      return { mode, amount, endsAt: now.getTime() + amount * 86400000 };
    }
    if (mode === "months") {
      const amount = Math.max(1, Math.min(24, Number(opts.amount) || 1));
      const end = new Date(now);
      end.setMonth(end.getMonth() + amount);
      return { mode, amount, endsAt: end.getTime() };
    }
    const startH = Math.max(0, Math.min(23, Number(opts.startHour) || 0));
    const endH = Math.max(0, Math.min(23, Number(opts.endHour) || 23));
    const start = new Date(now);
    start.setHours(startH, 0, 0, 0);
    const end = new Date(now);
    end.setHours(endH, 0, 0, 0);
    if (end.getTime() <= now.getTime()) end.setDate(end.getDate() + 1);
    if (start.getTime() > end.getTime()) start.setDate(start.getDate() - 1);
    return {
      mode, startHour: startH, endHour: endH,
      startsAt: start.getTime(), endsAt: end.getTime(),
      startLabel: `${p(startH)}:00`, endLabel: `${p(endH)}:00`
    };
  }

  // 云端模式下只允许管理员执行“过期/超时”结算，避免非管理员改本地副本造成分叉
  function canRunWorldSweeps() {
    if (!(window.SDJCloud && window.SDJCloud.enabled())) return true;
    const s = getSession();
    return !!(s && s.role === "admin");
  }

  // 云端模式下超时结算全部交给服务端函数，避免本地整列覆盖别人的接取/提交
  let cloudSweepBusy = false;
  let cloudSweepAt = 0;
  async function runCloudSweep(force) {
    if (!(window.SDJCloud && window.SDJCloud.enabled())) return false;
    if (cloudSweepBusy) return false;
    const sess = getSession();
    if (!sess || sess.role !== "admin") return false;
    if (!force && Date.now() - cloudSweepAt < 30000) return false;
    cloudSweepBusy = true;
    cloudSweepAt = Date.now();
    try {
      const r = await window.SDJCloud.worldSweep();
      if (!r.ok) return false;
      if (Number(r.changed) > 0) {
        await syncWorldFromCloud(true);
        refreshAfterWorldChange();
      }
      return true;
    } catch (e) {
      console.warn("[云端] 超时结算失败：", e);
      return false;
    } finally {
      cloudSweepBusy = false;
    }
  }

  // 时限判定：只卡“提交时刻”，审批可以晚于截止
  function sweepMissionDeadlines(silent) {
    if (!canRunWorldSweeps()) return false;
    if (window.SDJCloud && window.SDJCloud.enabled()) { runCloudSweep(); return false; }
    const s = loadState();
    const now = Date.now();
    let changed = false;
    (s.missions || []).forEach(m => {
      if (!m.deadline || !m.deadline.endsAt) return;
      if (now <= m.deadline.endsAt) return;
      if (m.status === "active") {
        const reports = (s.missionReports || []).filter(r => r.missionId === m.id);
        const approved = reports.filter(r => r.status === "approved");
        const names = (m.acceptors || []).map(a => a.username).filter(Boolean);
        if (approved.length) {
          // 已有人按时通过：按完成结算，其余接取人提示未完成
          m.status = "done";
          m.completedAt = m.completedAt || now;
          names.forEach(u => {
            if (!approved.some(r => r.applicant && r.applicant.username === u)) {
              pushNotification(u, `委托「${m.title}」已超过时限，未能完成`);
            }
          });
        } else {
          m.status = "failed";
          m.failedAt = now;
          names.forEach(u => pushNotification(u, `委托「${m.title}」已超过时限，判定为失败`));
        }
        changed = true;
      } else if (m.status === "available") {
        // 未满员但已有人接取：按失败结算；无人接取才算截止
        const acc = (m.acceptors || []).filter(a => a.username);
        if (acc.length) {
          m.status = "failed";
          m.failedAt = now;
          acc.forEach(a => pushNotification(a.username, `委托「${m.title}」已超过时限，判定为失败`));
        } else {
          m.status = "expired";
        }
        changed = true;
      }
    });
    if (changed) {
      saveState();
      if (!silent) toast("有委托超过时限，已自动结算");
    }
    return changed;
  }

  // 结算奖励：计划点进钱包，道具进背包（标记归属）
  function settleMissionReward(m, report) {
    const username = report && report.applicant ? report.applicant.username : null;
    if (!username || !m) return "未发放";
    const s = loadState();
    s.wallets = s.wallets || {};
    const reward = typeof m.reward === "string" ? { type: "points", points: 50 } : (m.reward || {});
    if (reward.type === "item") {
      const cat = s.items.find(i => i.id === reward.itemId);
      s.bag.push({
        id: "rw" + Date.now() + Math.random().toString(16).slice(2, 5),
        owner: username,
        name: (cat && cat.name) || reward.itemName || "未知道具",
        type: (cat && cat.category === "affinity") ? "好感道具" : "普通道具",
        rarity: rarityClass((cat && cat.rarity) || reward.rarity || "N"),
        desc: (cat && cat.intro) || "委托结算奖励",
        equipped: false
      });
      saveState();
      return `${(cat && cat.name) || reward.itemName}（${(cat && cat.rarity) || reward.rarity || "N"}）`;
    }
    const pts = Number(reward.points) || 0;
    const w = s.wallets[username] || { points: 0 };
    w.points = (Number(w.points) || 0) + pts;
    s.wallets[username] = w;
    saveState();
    return `计划点 ×${pts}`;
  }

  // 按接取人聚合委托状态：
  // 有人待审批 → review；全员已通过 → done；已有提交记录或已满员 → active；仍可接取 → available
  function recomputeMissionStatus(m) {
    if (!m || m.status === "failed" || m.status === "expired" || m.status === "done") return;
    const s = loadState();
    const acc = (m.acceptors || []).filter(a => a.username);
    const reports = (s.missionReports || []).filter(r => r.missionId === m.id);
    const pending = reports.filter(r => r.status === "pending");
    const approved = reports.filter(r => r.status === "approved");
    if (pending.length) { m.status = "review"; return; }
    const allApproved = acc.length > 0 && acc.every(a =>
      approved.some(r => r.applicant && r.applicant.username === a.username)
    );
    if (allApproved) {
      m.status = "done";
      m.completedAt = m.completedAt || Date.now();
      return;
    }
    const deadlinePassed = m.deadline && m.deadline.endsAt && Date.now() > m.deadline.endsAt;
    if (deadlinePassed) {
      // 截止后：有已通过的申请则视为完成，否则整单失败
      if (approved.length) {
        m.status = "done";
        m.completedAt = m.completedAt || Date.now();
      } else if (acc.length) {
        m.status = "failed";
        m.failedAt = m.failedAt || Date.now();
      }
      return;
    }
    m.status = (acc.length >= (m.slots || 1) || reports.length > 0) ? "active" : "available";
  }

  function myWallet(username) {
    const s = loadState();
    return (s.wallets && s.wallets[username]) || { points: 0 };
  }

  /* ---------------- 账号清理：仅保留三名指定测试账号 ---------------- */
  const ROSTER = [
    { username: "AAArhymestyl", name: "沙利叶", role: "admin", label: "管理者" },
    { username: "AAAwe", name: "月影", role: "player", label: "玩家" },
    { username: "AAAwer", name: "血月", role: "contractor", label: "契约者" }
  ];

  function normalizeRoster() {
    const accounts = getAccounts();
    const matched = accounts.filter(a => ROSTER.some(k => a.displayName === k.name || a.username === k.username));
    if (!matched.length) return false;
    const kept = matched.map(a => {
      const target = ROSTER.find(k => a.displayName === k.name || a.username === k.username);
      return Object.assign({}, a, { username: target.username, displayName: target.name, role: target.role });
    });
    saveAccounts(kept);

    const s = loadState();
    s.members = ROSTER.map((k, i) => {
      const old = (s.members || []).find(m => m.username === k.username || m.name === k.name);
      return {
        id: old && old.id ? old.id : "mem" + i,
        username: k.username,
        name: k.name,
        role: k.label,
        status: "正常",
        lastSeen: old && old.lastSeen ? old.lastSeen : "—"
      };
    });
    const names = new Set(ROSTER.map(k => k.username));
    s.notifications = (s.notifications || []).filter(n => names.has(String(n.username)));
    s.registrationRequests = (s.registrationRequests || []).filter(r => names.has(r.username) || r.status === "approved");
    s.missionReports = (s.missionReports || []).filter(r => !r.applicant || names.has(r.applicant.username));
    s.rosterVersion = 2;
    saveState();
    return true;
  }

  function sweepTimeouts(silent) {
    if (!canRunWorldSweeps()) return false;
    if (window.SDJCloud && window.SDJCloud.enabled()) { runCloudSweep(); return false; }
    const s = loadState();
    const now = Date.now();
    let changed = false;
    if (sweepMissionDeadlines(true)) changed = true;
    (s.registrationRequests || []).forEach(r => {
      if (r.status === "pending" && now - r.createdAt > REG_TIMEOUT_MS) {
        r.status = "expired";
        r.note = "超过 24 小时未处理，申请已自动失效";
        changed = true;
      }
    });
    (s.notifications || []).forEach(n => {
      const fixed = String(n.text).replace("，请返回注册页完成注册", "");
      if (fixed !== n.text) { n.text = fixed; changed = true; }
    });
    (s.missionReports || []).forEach(rep => {
      if (rep.status === "pending" && now - rep.submittedAt > REPORT_TIMEOUT_MS) {
        rep.status = "expired";
        rep.note = "超过 48 小时未处理，已自动退回";
        const m = s.missions.find(x => x.id === rep.missionId);
        recomputeMissionStatus(m);
        pushNotification(rep.applicant && rep.applicant.username,
          `委托「${rep.missionTitle}」审批超时，已退回接取状态`);
        changed = true;
      }
    });
    if (changed) {
      saveState();
      if (!silent) toast("有超时申请已自动处理");
    }
    return changed;
  }

  function pendingApprovalCount() {
    const s = loadState();
    const reg = (s.registrationRequests || []).filter(r => r.status === "pending").length;
    const rep = (s.missionReports || []).filter(r => r.status === "pending").length;
    return reg + rep;
  }

  let cloudSaveTimer = null;
  let rtChannelPromise = null;

  function stopRealtime() {
    if (!rtChannelPromise) return;
    const p = rtChannelPromise;
    rtChannelPromise = null;
    p.then(ch => { if (ch && window.SDJCloud) window.SDJCloud.unsubscribe(ch); }).catch(() => {});
  }

  function startRealtime(table, onChange) {
    if (rtChannelPromise) return;
    if (!(window.SDJCloud && window.SDJCloud.enabled())) return;
    rtChannelPromise = window.SDJCloud.watch(table, onChange);
  }

  // 全服数据（委托 / 卡牌 / 动态 / 审批等）跨设备实时同步
  let worldCloudChannel = null;
  let worldPollTimer = null;
  let worldSyncBusy = false;
  let worldStamp = "";
  let notifyRefreshHook = null;   // renderNotify 属于主界面闭包，这里用钩子跨作用域调用

  // 成员页刷新节流：正在输入广播/表单时绝不重绘，否则几秒一次的实时同步会打断输入
  let memberViewFingerprint = "";
  let memberCloudFp = "";
  let memberCloudAt = 0;
  let memberCloudBusy = false;
  function memberPageFingerprint() {
    const accs = (getAccounts() || []).map(a => [a.username, a.role, a.displayName].join("|")).join(",");
    const mem = (loadState().members || []).map(m => [m.username, m.role, m.status].join("|")).join(",");
    return accs + "#" + mem;
  }
  function profilesFingerprint(profiles) {
    return (profiles || []).map(p => [p.username, p.role, p.display_name, p.banned ? 1 : 0].join("|")).join(",");
  }
  function memberPageIsEditing() {
    if (document.querySelector(".modal-overlay")) return true;
    const host = document.getElementById("mainContent");
    const active = document.activeElement;
    if (!host || !active || !host.contains(active)) return false;
    return /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName);
  }
  async function maybeRefreshMemberPage(host) {
    if (!host || !host.isConnected) return;
    if (currentMenuId !== "member" || viewRole !== "admin") return;
    if (memberPageIsEditing()) return;

    // 云端档案变化（新成员登录/封禁）需要低频比对；只在真正变化时重绘，避免每 12 秒闪一次
    if (window.SDJCloud && window.SDJCloud.enabled() && Date.now() - memberCloudAt > 12000 && !memberCloudBusy) {
      memberCloudBusy = true;
      try {
        const profiles = await window.SDJCloud.listProfiles();
        memberCloudAt = Date.now();
        // 请求期间用户可能已经切走页面或开始输入，必须在落地前重新校验
        if (!host.isConnected || currentMenuId !== "member" || viewRole !== "admin" || memberPageIsEditing()) return;
        if (profiles) {
          const pfp = profilesFingerprint(profiles);
          if (pfp !== memberCloudFp) {
            memberCloudFp = pfp;
            renderMemberPage(host);
            return;
          }
        }
      } catch (e) {
        memberCloudAt = Date.now();
      } finally {
        memberCloudBusy = false;
      }
    }

    const fp = memberPageFingerprint();
    if (fp === memberViewFingerprint) return;
    memberViewFingerprint = fp;
    renderMemberPage(host);
  }

  // 云端有变化后，把「通知红点 + 当前页面」一起刷新
  function refreshAfterWorldChange() {
    if (notifyRefreshHook) notifyRefreshHook();
    const host = document.getElementById("mainContent");
    const sess = getSession();
    if (!host || !host.isConnected || !sess) return;
    if (currentMenuId === "dashboard") renderDashboardPage(host, sess.displayName);
    else if (currentMenuId === "mission") renderMissionPage(host, viewRole === "admin");
    else if (currentMenuId === "bag") renderBagPage(host);
    else if (currentMenuId === "approval" && viewRole === "admin") renderApprovalPage(host);
    else if (currentMenuId === "member" && viewRole === "admin") maybeRefreshMemberPage(host);
    else if (currentMenuId === "council") renderCouncilPage(host, viewRole === "admin");
    else if (currentMenuId === "codex") renderCodexPage(host);
    else if (currentMenuId === "map" && globeEngine && typeof globeEngine.refreshMissions === "function") {
      // 地图页不整页重绘，只刷新委托点位与侧边栏，保持镜头与选中状态
      globeEngine.refreshMissions();
    }
    renderBroadcastBanner();
  }

  async function onWorldCloudChange() {
    // 正在编辑弹窗时不打断输入，保存后自然刷新
    if (document.querySelector(".modal-overlay")) return;
    if (worldSyncBusy) return;
    worldSyncBusy = true;
    try {
      const changed = await syncWorldFromCloud();
      if (changed) refreshAfterWorldChange();
    } finally {
      worldSyncBusy = false;
    }
  }

  function onWorldVisibility() {
    // 手机切后台 / 电脑休眠回来时，实时连接可能已经静默断开，立刻补一次
    if (!document.hidden) onWorldCloudChange();
  }

  function startWorldCloudWatch() {
    if (!window.SDJCloud || !window.SDJCloud.enabled()) return;
    if (!worldCloudChannel) {
      window.SDJCloud.watch("world_state", onWorldCloudChange).then(ch => { worldCloudChannel = ch; });
    }
    // 兜底轮询：即使 WebSocket 被网络或长时间挂机掐断，也不会漏掉审批与委托变化
    if (!worldPollTimer) {
      worldPollTimer = setInterval(() => { if (!document.hidden) onWorldCloudChange(); }, 12000);
    }
    document.removeEventListener("visibilitychange", onWorldVisibility);
    document.addEventListener("visibilitychange", onWorldVisibility);
  }
  function stopWorldCloudWatch() {
    if (worldCloudChannel && window.SDJCloud) window.SDJCloud.unsubscribe(worldCloudChannel);
    worldCloudChannel = null;
    if (worldPollTimer) { clearInterval(worldPollTimer); worldPollTimer = null; }
    document.removeEventListener("visibilitychange", onWorldVisibility);
  }

  function mergeLiked(rows, prev) {
    const me = (getSession() || {}).username;
    const likedIds = new Set((prev || []).filter(p => p.liked).map(p => String(p.id)));
    return rows.map(r => Object.assign({}, r, {
      liked: me && Array.isArray(r.likedBy)
        ? r.likedBy.indexOf(me) >= 0
        : likedIds.has(String(r.id))
    }));
  }

  // 云端 world_state → 本地状态统一合并（含跨设备的审批/注册/钱包/通知）
  function applyCloudWorld(world, base) {
    const merged = base || defaultState();
    ["missions", "items", "members", "council", "codex", "bag", "cards", "friends", "settings"].forEach(k => {
      if (world[k]) merged[k] = world[k];
    });
    if (world.mission_reports) merged.missionReports = world.mission_reports;
    if (world.registration_requests) merged.registrationRequests = world.registration_requests;
    if (world.activity_log) merged.activityLog = world.activity_log;
    if (world.system_alerts) merged.systemAlerts = world.system_alerts;
    if (world.wallets) merged.wallets = world.wallets;
    if (world.register_bypass) merged.registerBypass = world.register_bypass;
    if (Array.isArray(world.broadcasts)) merged.broadcasts = world.broadcasts;
    else merged.broadcasts = merged.broadcasts || [];
    if (world.notifications) {
      // 通知正文以云端为准，已读状态保留本机（各设备各自已读）
      const readIds = new Set((merged.notifications || []).filter(n => n.read).map(n => String(n.id)));
      merged.notifications = (world.notifications || []).map(n =>
        readIds.has(String(n.id)) ? Object.assign({}, n, { read: true }) : n
      );
    }
    return ensureDataState(ensureCardsState(merged));
  }

  // 玩家动作/RPC 之后，立刻把云端最新状态合并回本地
  // force = true 时忽略版本戳强制合并（刚做完 RPC 必须立刻看到结果）
  async function syncWorldFromCloud(force) {
    if (!(window.SDJCloud && window.SDJCloud.enabled())) return false;
    const world = await window.SDJCloud.loadWorld();
    if (!world) return false;
    const stamp = String(world.updated_at || "");
    if (!force && stamp && stamp === worldStamp) return false;
    worldStamp = stamp;
    appState = applyCloudWorld(world, appState || defaultState());
    try { localStorage.setItem(STATE_KEY, JSON.stringify(appState)); } catch (e) { /* ignore */ }
    return true;
  }

  function saveState() {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(appState)); } catch (e) {}
    // 全服数据只有管理者能写（Supabase RLS 同样会拦截非管理员）
    const s = getSession();
    if (window.SDJCloud && window.SDJCloud.enabled() && s && s.role === "admin") {
      // 在排队时就冻结快照：否则等待的 800ms 内若收到远端推送覆盖了 appState，这次本地改动会被悄悄冲掉
      const patch = worldPatchSnapshot();
      clearTimeout(cloudSaveTimer);
      cloudSaveTimer = setTimeout(() => {
        window.SDJCloud.saveWorld(patch).catch(err => console.warn("[云端] 世界数据保存失败：", err));
      }, 800);
    }
  }

  /* 状态缓存失效：跨标签页写入时，本页必须重新读取 localStorage，
     否则审批队列会一直显示旧快照（玩家提交的申请永远不出现） */
  function reloadState() {
    appState = null;
    return loadState();
  }

  window.addEventListener("storage", (e) => {
    if (!e.key || e.key === STATE_KEY) appState = null;
  });

  let approvalPollTimer = null;
  function stopApprovalPoll() {
    if (approvalPollTimer) {
      clearInterval(approvalPollTimer);
      approvalPollTimer = null;
    }
  }

  function approvalFingerprint() {
    const s = loadState();
    const regs = (s.registrationRequests || []).map(r => r.id + ":" + r.status).join("|");
    const reps = (s.missionReports || []).map(r => r.id + ":" + r.status).join("|");
    return regs + "#" + reps;
  }

  // 向所有管理员账号广播通告（本地账号表中 role=admin + 当前管理员会话）
  function notifyAdmins(text) {
    const names = new Set();
    getAccounts().filter(a => a.role === "admin").forEach(a => names.add(a.username));
    const sess = getSession();
    if (sess && sess.role === "admin") names.add(sess.username || sess.displayName);
    // 本机还没有任何本地账号时，至少通知内置的最高管理者，避免注册页告警无人接收
    if (!names.size) ROSTER.filter(k => k.role === "admin").forEach(k => names.add(k.username));
    names.forEach(u => pushNotification(u, text));
    return names.size;
  }

  // 把本地账号表里的所有账号同步进成员表（修复历史账号在成员管理中身份错误/缺失）
  function syncAccountMembers() {
    const accounts = getAccounts();
    if (!accounts.length) return;
    const s = loadState();
    s.members = s.members || [];
    let changed = false;
    accounts.forEach(a => {
      const role = roleLabelOf(a.role);
      let m = s.members.find(x => x.username === a.username)
        || s.members.find(x => !x.username && x.name === a.displayName);
      if (!m) {
        s.members.push({
          id: "a" + Date.now() + Math.random().toString(16).slice(2, 5),
          username: a.username,
          name: a.displayName,
          role,
          status: "正常",
          lastSeen: "—"
        });
        changed = true;
      } else if (m.role !== role || m.username !== a.username || m.name !== a.displayName) {
        m.username = a.username;
        m.name = a.displayName;
        m.role = role;
        changed = true;
      }
    });
    if (changed) saveState();
  }

  // 注册完成或登录成功时，把真实身份写入成员表（供成员管理实时查看）
  function roleLabelOf(role) {
    if (role === "admin") return "管理者";
    if (role === "contractor") return "契约者";
    return "玩家";
  }

  function ensureMemberRecord(username, displayName, role) {
    if (!username || !displayName) return;
    const s = reloadState();
    s.members = s.members || [];
    let m = s.members.find(x => x.username === username)
      || s.members.find(x => !x.username && x.name === displayName);
    if (m) {
      m.username = username;
      m.name = displayName;
      m.role = roleLabelOf(role);
      m.lastSeen = "刚刚";
    } else {
      s.members.push({
        id: "a" + Date.now(),
        username,
        name: displayName,
        role: roleLabelOf(role),
        status: "正常",
        lastSeen: "刚刚"
      });
    }
    saveState();
  }

  // 地图数据同步：读写 world_state.map_locations
  window.SDJMap = {
    async pull() {
      if (!(window.SDJCloud && window.SDJCloud.enabled())) return null;
      try { return await window.SDJCloud.loadMap(); } catch (e) { return null; }
    },
    push(payload) {
      if (!(window.SDJCloud && window.SDJCloud.enabled())) return;
      const s = getSession();
      if (!s || s.role !== "admin") return;
      window.SDJCloud.saveMap(payload).catch(err => console.warn("[云端] 地图保存失败：", err));
    }
  };

  function escHTML(v) {
    return String(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function toast(message) {
    const node = el("div", { class: "toast" }, message);
    document.body.appendChild(node);
    requestAnimationFrame(() => node.classList.add("show"));
    setTimeout(() => {
      node.classList.remove("show");
      setTimeout(() => node.remove(), 300);
    }, 2200);
  }

  function pageShell(container, opts) {
    container.innerHTML = `
      <div class="module-head">
        <div>
          <div class="module-title">${opts.title}</div>
          <div class="module-en">${opts.en}</div>
        </div>
        <div class="module-tools">${opts.tools || ""}</div>
      </div>
      <div class="module-body">${opts.body || ""}</div>
    `;
  }

  /* =========================================================
   *  背包 · 卡牌系统（玩家 / 契约者 / 管理者）
   * ========================================================= */
  let bagTab = "cards";           // cards | items
  let cardRoleTab = "player";     // 管理者页签：player | contractor
  let cardPath = [];              // 当前下钻路径（节点 id）
  let cardPendingOnly = false;    // 只看介绍待补充

  const CARD_RARITIES = ["N", "R", "SR", "SSR", "SP"];

  function cardData() {
    return (window.SDJ_CARDS && window.SDJ_CARDS.trees) ? window.SDJ_CARDS : { trees: { player: [], contractor: [] } };
  }
  function cardRoleTree(role) {
    return cardData().trees[role === "contractor" ? "contractor" : "player"] || [];
  }
  function cardRoleOfView() {
    return viewRole === "contractor" ? "contractor" : "player";
  }
  function cardFindNode(nodes, id) {
    for (const n of (nodes || [])) {
      if (n.id === id) return n;
      if (n.children) {
        const hit = cardFindNode(n.children, id);
        if (hit) return hit;
      }
    }
    return null;
  }
  function cardNodeById(id) {
    return cardFindNode(cardRoleTree("player"), id) || cardFindNode(cardRoleTree("contractor"), id);
  }
  function cardNodeName(node) {
    const renames = loadState().cards.renames || {};
    return renames[node.id] || node.name;
  }
  function cardKey(poolId, cardId) { return poolId + "::" + cardId; }

  // 有效卡牌 = 原始清单 - 已删除 + 管理者新增，再叠加字段覆盖
  function cardEffective(pool) {
    const cs = loadState().cards;
    const list = [];
    (pool.cards || []).forEach(c => {
      const key = cardKey(pool.id, c.id);
      if (cs.removed[key]) return;
      list.push(Object.assign({}, c, cs.overrides[key] || {}));
    });
    (cs.added[pool.id] || []).forEach(c => {
      const key = cardKey(pool.id, c.id);
      if (cs.removed[key]) return;
      list.push(Object.assign({}, c, cs.overrides[key] || {}));
    });
    return list;
  }
  function cardNodeCount(node) {
    if (!node) return 0;
    if (node.type === "pool") return cardEffective(node).length;
    return (node.children || []).reduce((sum, ch) => sum + cardNodeCount(ch), 0);
  }
  function cardHeld(username, poolId, cardId) {
    const h = (loadState().cards.holdings || {})[username] || {};
    return Number(h[cardKey(poolId, cardId)]) || 0;
  }
  function cardSetHeld(username, poolId, cardId, n) {
    const cs = loadState().cards;
    cs.holdings[username] = cs.holdings[username] || {};
    cs.holdings[username][cardKey(poolId, cardId)] = Math.max(0, Math.floor(Number(n) || 0));
  }
  function cardAccounts() {
    const out = [];
    const seen = new Set();
    const push = (username, name, role) => {
      if (!username || seen.has(username) || role === "admin") return;
      seen.add(username);
      out.push({ username, name: name || username, role });
    };
    // 云端模式以服务端 profiles 为准，才能给其他设备注册的玩家分配持有数量
    if (window.SDJCloud && window.SDJCloud.enabled() && socialProfilesCache.length) {
      socialProfilesCache.forEach(p => push(p.username, p.name, p.role));
      return out;
    }
    try { (getAccounts() || []).forEach(a => push(a.username, a.displayName || a.username, a.role)); } catch (e) { /* ignore */ }
    const sess = getSession();
    if (sess && !out.length) push(sess.username || sess.displayName, sess.displayName, sess.role);
    return out;
  }

  // 卡牌配置属于全服数据：保存后必须立刻写云端，刷新/其他设备才能看到
  async function persistCardsNow() {
    saveState();
    const cloud = !!(window.SDJCloud && window.SDJCloud.enabled());
    const sess = getSession();
    if (!cloud || !sess || sess.role !== "admin") return true;
    const ok = await pushWorldNow();
    if (!ok) {
      toast("卡牌保存失败：云端写入未成功，请检查网络后重试");
      return false;
    }
    await syncWorldFromCloud(true);
    return true;
  }
  function cardRarityChip(r) {
    const key = CARD_RARITIES.includes(r) ? r : "none";
    return `<span class="card-rarity r-${key}">${escHTML(r || "待定")}</span>`;
  }
  function cardHeldLabel(pool, card, uname, isAdmin, role) {
    if (!isAdmin) return `已拥有 ${cardHeld(uname, pool.id, card.id)} 张`;
    const accs = cardAccounts().filter(a => a.role === role);
    if (!accs.length) return "已拥有 0 张";
    const total = accs.reduce((sum, a) => sum + cardHeld(a.username, pool.id, card.id), 0);
    const detail = accs.map(a => `${a.name} ${cardHeld(a.username, pool.id, card.id)} 张`).join(" / ");
    return `<span title="${escHTML(detail)}">已拥有 ${total} 张</span>`;
  }

  function renderBagPage(container) {
    reloadState();
    const session = getSession();
    const uname = session ? (session.username || session.displayName) : "";
    const wallet = myWallet(uname);
    const isAdmin = viewRole === "admin";

    pageShell(container, {
      title: isAdmin ? "背包管理" : "背包",
      en: "INVENTORY",
      tools: `<span class="count-chip">计划点 ${wallet.points || 0}</span>`,
      body: `<div class="bag-tabs">
          <button class="bag-tab ${bagTab === "cards" ? "active" : ""}" data-bagtab="cards">卡牌</button>
          <button class="bag-tab ${bagTab === "items" ? "active" : ""}" data-bagtab="items">道具</button>
        </div>
        <div id="bagBody"></div>`
    });

    container.querySelectorAll("[data-bagtab]").forEach(btn => {
      btn.onclick = () => {
        bagTab = btn.dataset.bagtab;
        renderBagPage(container);
      };
    });

    const body = container.querySelector("#bagBody");
    if (!body) return;
    if (bagTab === "items") renderBagItems(body, uname);
    else renderCardsView(body, container, uname, isAdmin);
  }

  /* ---------------- 道具页：只读展示委托奖励 ---------------- */
  function renderBagItems(host, uname) {
    const s = loadState();
    const own = (s.bag || []).filter(i => !i.owner || i.owner === uname);
    host.innerHTML = `
      <div class="bag-note">道具页后续独立开发，当前仅展示委托任务结算获得的道具奖励。</div>
      <div class="item-grid">${own.map(item => `
        <div class="item-card panel-cut rarity-${escHTML(item.rarity)}">
          <div class="item-top"><span class="item-type">${escHTML(item.type || "道具")}</span><span class="rarity-chip">${escHTML(item.rarity || "N")}</span></div>
          <div class="item-name">${escHTML(item.name)}</div>
          <div class="item-desc">${escHTML(item.desc || "委托结算奖励")}</div>
        </div>`).join("") || `<div class="empty-state">暂无道具。完成委托任务后，奖励道具会出现在这里。</div>`}</div>`;
  }

  /* ---------------- 卡牌视图 ---------------- */
  function renderCardsView(host, container, uname, isAdmin) {
    const role = isAdmin ? cardRoleTab : cardRoleOfView();
    host.innerHTML = `
      ${isAdmin ? `<div class="card-role-tabs">
        <button class="card-role-tab ${role === "player" ? "active" : ""}" data-cardrole="player">玩家卡池</button>
        <button class="card-role-tab ${role === "contractor" ? "active" : ""}" data-cardrole="contractor">契约者卡池</button>
        <span class="card-role-hint">管理者可改名、编辑卡牌、调整持有数量</span>
      </div>` : ""}
      <div id="cardsPanel"></div>`;
    host.querySelectorAll("[data-cardrole]").forEach(btn => {
      btn.onclick = () => {
        cardRoleTab = btn.dataset.cardrole;
        cardPath = [];
        cardPendingOnly = false;
        renderBagPage(container);
      };
    });
    renderCardPanel(host.querySelector("#cardsPanel"), role, uname, isAdmin, container);
  }

  function renderCardPanel(panel, role, uname, isAdmin, container) {
    if (!panel) return;
    const tree = cardRoleTree(role);
    const nodes = [];
    let list = tree;
    let current = null;
    for (const id of cardPath) {
      current = (list || []).find(n => n.id === id);
      if (!current) break;
      nodes.push(current);
      list = current.children || [];
    }
    if (cardPath.length && !current) cardPath = [];
    if (cardPath.length !== nodes.length) cardPath = nodes.map(n => n.id);

    const crumb = `<div class="card-crumb">
      <button data-crumb="-1">全部</button>
      ${nodes.map((n, i) => `<span class="crumb-sep">›</span><button data-crumb="${i}">${escHTML(cardNodeName(n))}</button>`).join("")}
    </div>`;

    if (!current) {
      panel.innerHTML = `
        <div class="card-view-head">
          <div class="card-view-title">${role === "contractor" ? "契约者卡池" : "玩家卡池"}</div>
          <div class="card-view-sub">共 ${cardNodeCount({ type: "group", children: tree })} 张卡牌 · 点击分类查看</div>
        </div>
        ${crumb}
        <div class="card-node-grid">${tree.map(n => cardFolderHTML(n, isAdmin)).join("")}</div>`;
      bindCardNodes(panel, tree, isAdmin, role, container);
      return;
    }

    if (current.type === "group") {
      const children = current.children || [];
      panel.innerHTML = `
        <div class="card-view-head">
          <div class="card-view-title">${escHTML(cardNodeName(current))}</div>
          <div class="card-view-sub">共 ${cardNodeCount(current)} 张卡牌</div>
        </div>
        ${crumb}
        <div class="card-node-grid">${children.map(n => cardFolderHTML(n, isAdmin)).join("")}</div>`;
      bindCardNodes(panel, children, isAdmin, role, container, current);
      return;
    }

    renderCardPool(panel, current, role, uname, isAdmin, container, crumb, nodes);
  }

  function cardFolderHTML(node, isAdmin) {
    const period = node.period ? `<span class="period-chip">${escHTML(node.period)}</span>` : "";
    const edit = isAdmin ? `<button class="node-edit" data-rename="${node.id}" title="重命名">✎</button>` : "";
    return `<div class="card-node panel-cut" data-open="${node.id}">
      <div class="node-top"><span class="node-icon">${node.type === "pool" ? "▤" : "▣"}</span>${edit}</div>
      <div class="node-title">${period}${escHTML(cardNodeName(node))}</div>
      <div class="node-meta">共 ${cardNodeCount(node)} 张</div>
    </div>`;
  }

  function bindCardNodes(panel, nodes, isAdmin, role, container, parent) {
    panel.querySelectorAll("[data-open]").forEach(el => {
      el.onclick = () => {
        cardPath = parent ? cardPath.concat(el.dataset.open) : [el.dataset.open];
        cardPendingOnly = false;
        renderCardPanel(panel, role, currentUserKey(), isAdmin, container);
      };
    });
    panel.querySelectorAll("[data-rename]").forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        openNodeRename(cardNodeById(btn.dataset.rename), container);
      };
    });
    panel.querySelectorAll("[data-crumb]").forEach(btn => {
      btn.onclick = () => {
        const idx = Number(btn.dataset.crumb);
        cardPath = idx < 0 ? [] : cardPath.slice(0, idx + 1);
        cardPendingOnly = false;
        renderCardPanel(panel, role, currentUserKey(), isAdmin, container);
      };
    });
  }
  function currentUserKey() {
    const sess = getSession();
    return sess ? (sess.username || sess.displayName) : "";
  }

  function renderCardPool(panel, pool, role, uname, isAdmin, container, crumb, nodes) {
    let cards = cardEffective(pool);
    const pendingCount = cards.filter(c => !c.desc).length;
    if (cardPendingOnly) cards = cards.filter(c => !c.desc);
    const ownedAccounts = isAdmin ? cardAccounts().filter(a => a.role === role) : [{ username: uname }];
    const ownedTotal = cardEffective(pool).reduce((sum, c) =>
      sum + ownedAccounts.reduce((n, a) => n + cardHeld(a.username, pool.id, c.id), 0), 0);

    panel.innerHTML = `
      ${crumb}
      <div class="card-pool-head panel-cut">
        <div>
          <div class="pool-title">${pool.period ? `<span class="period-chip">${escHTML(pool.period)}</span>` : ""}${escHTML(cardNodeName(pool))}</div>
          <div class="pool-meta">共 ${cardEffective(pool).length} 张 · 已拥有 ${ownedTotal} 张</div>
        </div>
        <div class="pool-tools">
          ${isAdmin ? `<button class="btn-sm" data-addcard>＋ 新增卡牌</button>` : ""}
          ${isAdmin && pendingCount ? `<button class="btn-sm ghost ${cardPendingOnly ? "on" : ""}" data-pending>待补充 ${pendingCount}</button>` : ""}
        </div>
      </div>
      <div class="card-search-wrap"><input class="card-search" id="cardSearch" placeholder="在当前卡池中搜索卡牌名称 / 分类 / 介绍"></div>
      <div class="card-list" id="cardList">
        ${cards.map(c => cardRowHTML(pool, c, uname, isAdmin, role)).join("") ||
          `<div class="card-empty">${cardPendingOnly ? "本池暂无待补充介绍的卡牌" : (isAdmin ? "该卡池暂无卡牌，点击「新增卡牌」开始配置" : "该卡池暂无卡牌")}</div>`}
      </div>`;

    const search = panel.querySelector("#cardSearch");
    if (search) {
      search.oninput = () => {
        const q = search.value.trim().toLowerCase();
        panel.querySelectorAll("#cardList .card-row").forEach(row => {
          row.style.display = !q || (row.dataset.search || "").includes(q) ? "" : "none";
        });
      };
    }

    panel.querySelectorAll(".card-row").forEach(row => {
      row.onclick = (e) => {
        if (e.target.closest("[data-editcard]") || e.target.closest("[data-delcard]")) return;
        const card = cards.find(c => c.id === row.dataset.card);
        if (!card) return;
        if (isAdmin) openCardEditor(pool, card, container);
        else openCardDetail(pool, card, uname);
      };
    });
    panel.querySelectorAll("[data-editcard]").forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const card = cards.find(c => c.id === btn.dataset.editcard);
        if (card) openCardEditor(pool, card, container);
      };
    });
    panel.querySelectorAll("[data-delcard]").forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const card = cards.find(c => c.id === btn.dataset.delcard);
        if (card) openCardDelete(pool, card, container);
      };
    });
    const addBtn = panel.querySelector("[data-addcard]");
    if (addBtn) addBtn.onclick = () => openCardEditor(pool, null, container);
    panel.querySelectorAll("[data-crumb]").forEach(btn => {
      btn.onclick = () => {
        const idx = Number(btn.dataset.crumb);
        cardPath = idx < 0 ? [] : cardPath.slice(0, idx + 1);
        cardPendingOnly = false;
        renderCardPanel(panel, role, uname, isAdmin, container);
      };
    });
    const pendingBtn = panel.querySelector("[data-pending]");
    if (pendingBtn) {
      pendingBtn.onclick = () => {
        cardPendingOnly = !cardPendingOnly;
        renderCardPool(panel, pool, role, uname, isAdmin, container, crumb, nodes);
      };
    }
  }

  function cardRowHTML(pool, c, uname, isAdmin, role) {
    const desc = c.desc ? c.desc.replace(/\s+/g, " ").slice(0, 60) : "【此卡牌介绍暂无】";
    const search = [c.name, c.rarity, c.category || "", (c.desc || "").slice(0, 200)].join(" ").toLowerCase();
    return `<div class="card-row panel-cut" data-card="${escHTML(c.id)}" data-search="${escHTML(search)}">
      ${cardRarityChip(c.rarity)}
      <div class="card-main">
        <div class="card-name">${escHTML(c.name)}</div>
        <div class="card-sub">${c.category ? `<span class="card-cat">${escHTML(c.category)}</span>` : ""}${escHTML(desc)}</div>
      </div>
      <div class="card-side">
        <span class="card-owned">${cardHeldLabel(pool, c, uname, isAdmin, role)}</span>
        ${isAdmin ? `<button class="btn-sm ghost" data-editcard="${escHTML(c.id)}">编辑</button><button class="btn-sm danger" data-delcard="${escHTML(c.id)}">删除</button>` : ""}
        ${isAdmin && !c.desc ? `<span class="card-missing">待补充</span>` : ""}
      </div>
    </div>`;
  }

  /* ---------------- 卡牌详情 ---------------- */
  function openCardDetail(pool, card, uname) {
    const overlay = el("div", { class: "modal-overlay" });
    const panel = el("div", { class: "modal-panel panel-cut wide" });
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("show"));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    panel.innerHTML = `
      <div class="modal-title">${escHTML(card.name)}</div>
      <div class="card-detail-meta">
        ${cardRarityChip(card.rarity)}
        ${card.category ? `<span class="card-cat">${escHTML(card.category)}</span>` : ""}
        <span class="card-owned">已拥有 ${cardHeld(uname, pool.id, card.id)} 张</span>
      </div>
      <div class="card-detail-desc">${card.desc ? escHTML(card.desc) : "<span class=\"card-desc-empty\">【此卡牌介绍暂无】</span>"}</div>
      <div class="modal-actions"><button class="btn-sm ghost" data-close>关闭</button></div>`;
    panel.querySelector("[data-close]").onclick = () => overlay.remove();
  }

  /* ---------------- 管理者：节点重命名 ---------------- */
  function openNodeRename(node, container) {
    if (!node) return;
    const overlay = el("div", { class: "modal-overlay" });
    const panel = el("div", { class: "modal-panel panel-cut" });
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("show"));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    panel.innerHTML = `
      <div class="modal-title">重命名卡池</div>
      <div class="modal-desc">修改后立即同步到玩家 / 契约者界面，只影响显示名称。</div>
      <label class="modal-label">名称<input class="input-line" id="rnName" maxlength="30" value="${escHTML(cardNodeName(node))}"></label>
      <div class="modal-actions">
        <button class="btn-sm" id="rnSave">保存</button>
        <button class="btn-sm ghost" data-close>取消</button>
      </div>`;
    panel.querySelector("[data-close]").onclick = () => overlay.remove();
    panel.querySelector("#rnSave").onclick = async () => {
      const name = panel.querySelector("#rnName").value.trim();
      if (!name) { toast("名称不能为空"); return; }
      const cs = loadState().cards;
      if (name === node.name) delete cs.renames[node.id];
      else cs.renames[node.id] = name;
      pushSystemActivity(`管理者将卡池「${node.name}」重命名为「${name}」`, "card");
      const ok = await persistCardsNow();
      if (!ok) return;
      overlay.remove();
      renderBagPage(container);
      toast(`已重命名为「${name}」`);
    };
  }

  /* ---------------- 管理者：卡牌编辑 / 新增 ---------------- */
  function openCardEditor(pool, card, container) {
    const isNew = !card;
    const draft = card || { id: "u" + Date.now().toString(36), name: "", rarity: "N", category: "", desc: "" };
    const key = cardKey(pool.id, draft.id);
    const accounts = cardAccounts();
    const overlay = el("div", { class: "modal-overlay" });
    const panel = el("div", { class: "modal-panel panel-cut wide" });
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("show"));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

    panel.innerHTML = `
      <div class="modal-title">${isNew ? "新增卡牌" : "编辑卡牌"}</div>
      <div class="modal-desc">${escHTML(cardNodeName(pool))} · 管理者编辑后实时同步到对应身份</div>
      <div class="editor-grid">
        <label class="modal-label">卡牌名称<input class="input-line" id="ceName" maxlength="40" value="${escHTML(draft.name)}" placeholder="例如：女娲"></label>
        <label class="modal-label">稀有度
          <select class="input-line" id="ceRarity">
            ${CARD_RARITIES.map(r => `<option value="${r}" ${draft.rarity === r ? "selected" : ""}>${r}</option>`).join("")}
            <option value="" ${!draft.rarity ? "selected" : ""}>待定</option>
          </select>
        </label>
        <label class="modal-label">分类<input class="input-line" id="ceCategory" maxlength="20" value="${escHTML(draft.category || "")}" placeholder="身份卡 / 技能卡 / 道具卡…"></label>
      </div>
      <label class="modal-label">卡牌介绍
        <textarea class="input-line card-desc-input" id="ceDesc" maxlength="4000" placeholder="留空时，玩家端显示【此卡牌介绍暂无】">${escHTML(draft.desc || "")}</textarea>
      </label>
      <div class="ce-holdings">
        <div class="ce-sub">持有数量（重复抽取会累加）</div>
        ${accounts.map(a => `<label class="ce-hold"><span>${escHTML(a.name)}<i>${a.role === "contractor" ? "契约者" : "玩家"}</i></span>
          <input type="number" min="0" step="1" data-hold="${escHTML(a.username)}" value="${cardHeld(a.username, pool.id, draft.id)}"></label>`).join("") || `<div class="ce-sub">暂无玩家 / 契约者账号</div>`}
      </div>
      <div class="modal-actions">
        ${isNew ? "" : `<button class="btn-sm danger" id="ceDelete">删除卡牌</button>`}
        <button class="btn-sm" id="ceSave">保存</button>
        <button class="btn-sm ghost" data-close>取消</button>
      </div>`;
    panel.querySelector("[data-close]").onclick = () => overlay.remove();

    panel.querySelector("#ceSave").onclick = async () => {
      const name = panel.querySelector("#ceName").value.trim();
      if (!name) { toast("卡牌名称不能为空"); return; }
      const rarity = panel.querySelector("#ceRarity").value;
      const category = panel.querySelector("#ceCategory").value.trim();
      const desc = panel.querySelector("#ceDesc").value.trim();
      const dup = cardEffective(pool).some(c => c.id !== draft.id && c.name.trim().toLowerCase() === name.toLowerCase());
      if (dup) { toast("同一卡池内已存在同名卡牌"); return; }
      const cs = loadState().cards;

      if (isNew) {
        cs.added[pool.id] = cs.added[pool.id] || [];
        cs.added[pool.id].push({ id: draft.id, name, rarity, category, desc });
      } else if ((cs.added[pool.id] || []).some(c => c.id === draft.id)) {
        Object.assign(cs.added[pool.id].find(c => c.id === draft.id), { name, rarity, category, desc });
      } else {
        cs.overrides[key] = Object.assign({}, cs.overrides[key] || {}, { name, rarity, category, desc });
      }
      panel.querySelectorAll("[data-hold]").forEach(input => {
        cardSetHeld(input.dataset.hold, pool.id, draft.id, input.value);
      });
      pushSystemActivity(`管理者${isNew ? "新增" : "更新"}卡牌「${name}」（${cardNodeName(pool)}）`, "card");
      const saveBtn = panel.querySelector("#ceSave");
      saveBtn.disabled = true;
      const ok = await persistCardsNow();
      saveBtn.disabled = false;
      if (!ok) return;
      overlay.remove();
      renderBagPage(container);
      toast(isNew ? `已新增卡牌「${name}」` : `已保存卡牌「${name}」`);
    };

    const delBtn = panel.querySelector("#ceDelete");
    if (delBtn) delBtn.onclick = () => {
      overlay.remove();
      openCardDelete(pool, draft, container);
    };
  }

  function openCardDelete(pool, card, container) {
    const overlay = el("div", { class: "modal-overlay" });
    const panel = el("div", { class: "modal-panel panel-cut" });
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("show"));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    panel.innerHTML = `
      <div class="modal-title">删除卡牌</div>
      <div class="modal-desc">确定删除「${escHTML(card.name)}」？该卡牌会从玩家 / 契约者界面同步移除。</div>
      <div class="modal-actions">
        <button class="btn-sm danger" id="cdConfirm">确认删除</button>
        <button class="btn-sm ghost" data-close>取消</button>
      </div>`;
    panel.querySelector("[data-close]").onclick = () => overlay.remove();
    panel.querySelector("#cdConfirm").onclick = async () => {
      const cs = loadState().cards;
      const key = cardKey(pool.id, card.id);
      const idx = (cs.added[pool.id] || []).findIndex(c => c.id === card.id);
      if (idx >= 0) cs.added[pool.id].splice(idx, 1);
      else cs.removed[key] = true;
      delete cs.overrides[key];
      Object.keys(cs.holdings || {}).forEach(u => { if (cs.holdings[u]) delete cs.holdings[u][key]; });
      pushSystemActivity(`管理者删除卡牌「${card.name}」（${cardNodeName(pool)}）`, "card");
      const ok = await persistCardsNow();
      if (!ok) return;
      overlay.remove();
      renderBagPage(container);
      toast(`已删除「${card.name}」`);
    };
  }

  // 回归测试 / 外部调用接口
  window.SDJCards = {
    trees: () => cardData().trees,
    roleTree: (role) => cardRoleTree(role),
    node: (id) => cardNodeById(id),
    name: (id) => { const n = cardNodeById(id); return n ? cardNodeName(n) : ""; },
    cards: (poolId) => { const p = cardNodeById(poolId); return p && p.type === "pool" ? cardEffective(p) : []; },
    count: (id) => { const n = cardNodeById(id); return n ? cardNodeCount(n) : 0; },
    held: (username, poolId, cardId) => cardHeld(username, poolId, cardId),
    setHeld: (username, poolId, cardId, n) => { cardSetHeld(username, poolId, cardId, n); saveState(); },
    applyEdit: (poolId, cardId, patch) => {
      const p = cardNodeById(poolId);
      if (!p) return false;
      const cs = loadState().cards;
      const key = cardKey(poolId, cardId);
      const added = (cs.added[poolId] || []).find(c => c.id === cardId);
      if (added) Object.assign(added, patch);
      else cs.overrides[key] = Object.assign({}, cs.overrides[key] || {}, patch);
      saveState();
      return true;
    },
    rename: (nodeId, name) => {
      const cs = loadState().cards;
      if (!name || name === (cardNodeById(nodeId) || {}).name) delete cs.renames[nodeId];
      else cs.renames[nodeId] = name;
      saveState();
    },
    addCard: (poolId, card) => {
      const cs = loadState().cards;
      cs.added[poolId] = cs.added[poolId] || [];
      cs.added[poolId].push(card);
      saveState();
    },
    removeCard: (poolId, cardId) => {
      const cs = loadState().cards;
      const key = cardKey(poolId, cardId);
      const idx = (cs.added[poolId] || []).findIndex(c => c.id === cardId);
      if (idx >= 0) cs.added[poolId].splice(idx, 1);
      else cs.removed[key] = true;
      delete cs.overrides[key];
      saveState();
    },
    pending: (poolId) => {
      const p = cardNodeById(poolId);
      return p && p.type === "pool" ? cardEffective(p).filter(c => !c.desc).length : 0;
    },
    reset: () => {
      const s = loadState();
      s.cards = { version: 1, renames: {}, overrides: {}, added: {}, removed: {}, holdings: {} };
      saveState();
    },
    refresh: () => {
      const host = document.getElementById("mainContent");
      if (host && currentMenuId === "bag") renderBagPage(host);
    },
    reload: () => {
      reloadState();
      const host = document.getElementById("mainContent");
      if (host && currentMenuId === "bag") renderBagPage(host);
    },
    bag: () => loadState().bag || []
  };


  /* ---------------- 委托任务 ---------------- */
  let missionTab = null;
  let missionTickTimer = null;

  function stopMissionTick() {
    if (missionTickTimer) { clearInterval(missionTickTimer); missionTickTimer = null; }
  }

  function openMissionDetail(missionId) {
    const m = (loadState().missions || []).find(x => x.id === missionId);
    if (!m) return;
    const overlay = el("div", { class: "modal-overlay", id: "missionDetailModal" });
    const panel = el("div", { class: "modal-panel panel-cut wide" });
    overlay.appendChild(panel);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("show"));

    const reports = (loadState().missionReports || []).filter(r => r.missionId === m.id);
    const statusText = ({ available: "待接取", active: "进行中", review: "待审批", done: "已完成", failed: "已失败", expired: "已截止" })[m.status] || m.status;
    panel.innerHTML = `
      <div class="modal-title">${escHTML(m.title)}</div>
      <div class="modal-desc">${escHTML(m.level)} 级 · ${statusText} · ${escHTML(m.loc)}</div>
      <div class="detail-grid">
        <div><span>任务描述</span><p>${escHTML(m.desc)}</p></div>
        <div><span>奖励</span><p>${escHTML(rewardText(m))}</p></div>
        <div><span>名额</span><p>${(m.acceptors || []).length} / ${m.slots || 1} 人</p></div>
        <div><span>时限</span><p>${escHTML(deadlineLabel(m.deadline))}${m.deadline && m.deadline.endsAt ? `（截止 ${new Date(m.deadline.endsAt).toLocaleString("zh-CN")}）` : ""}</p></div>
        <div><span>接取人</span><p>${(m.acceptors || []).length ? m.acceptors.map(a => `${escHTML(a.name)}（${roleLabelOf(a.role)}）`).join("、") : "暂无"}</p></div>
        <div><span>审批记录</span><p>${reports.length ? reports.map(r => `${escHTML(r.applicant ? r.applicant.name : "—")} · ${approvalStatusText(r.status)}`).join("<br>") : "暂无"}</p></div>
      </div>
      <div class="modal-actions"><button class="btn-sm ghost" data-close>关闭</button></div>
    `;
    panel.querySelector("[data-close]").onclick = () => overlay.remove();
  }

  function renderMissionPage(container, isAdmin) {
    reloadState();
    sweepMissionDeadlines(true);
    const s = loadState();
    const session = getSession();
    const adminView = !!isAdmin && session && session.role === "admin";
    const levelMeta = (window.SDJ_CONFIG && window.SDJ_CONFIG.missionLevels) || {};
    const levelChip = (lv) => {
      const meta = levelMeta[lv];
      return meta
        ? `<span class="level-chip" style="color:${meta.color};border-color:${meta.color}">${escHTML(lv)}</span>`
        : `<span class="level-chip">${escHTML(lv)}</span>`;
    };
    const tabs = adminView
      ? [["publish", "新增委托任务"], ["available", "当前存在委托"], ["active", "正在进行"], ["done", "已完成"]]
      : [["available", "可接取"], ["active", "进行中"], ["done", "已完成"], ["failed", "已失败"]];
    if (!tabs.some(t => t[0] === missionTab)) missionTab = "available";

    const missions = s.missions || [];
    const myName = session ? (session.username || session.displayName) : "";
    const acceptedByMe = (m) => (m.acceptors || []).some(a => a.username === myName);
    const inTab = (k) => {
      // 未满员保持 available：已接取者按自己的视角归入“进行中”，其他成员仍可在“可接取”看到
      if (k === "available") return missions.filter(m => (m.status === "available" || m.status === "expired") && !acceptedByMe(m));
      if (k === "active") return missions.filter(m => m.status === "active" || m.status === "review" || (m.status === "available" && acceptedByMe(m)));
      if (k === "done") return missions.filter(m => m.status === "done" || (adminView && m.status === "failed"));
      if (k === "failed") return missions.filter(m => m.status === "failed");
      return [];
    };
    const countOf = (k) => k === "publish" ? missions.filter(m => m.status === "available").length : inTab(k).length;

    const pendingReport = (mid) => (s.missionReports || []).find(r => r.missionId === mid && r.status === "pending");

    const card = (m) => {
      const acceptors = m.acceptors || [];
      const locked = acceptors.length > 0;
      const cdText = m.deadline && m.deadline.endsAt ? fmtCountdown(m.deadline.endsAt) : "无时限";
      const expired = m.deadline && m.deadline.endsAt && m.deadline.endsAt < Date.now();
      const rep = pendingReport(m.id);
      const myRep = (s.missionReports || []).find(r =>
        r.missionId === m.id && r.applicant && r.applicant.username === myName &&
        r.status !== "rejected" && r.status !== "expired"
      );
      const shownRep = adminView ? rep : myRep;
      const accepted = acceptors.some(a => a.username === myName);
      const full = acceptors.length >= (m.slots || 1);
      const canSubmit = !adminView && accepted && !myRep && (m.status === "available" || m.status === "active" || m.status === "review");
      return `
        <div class="mission-card panel-cut status-${m.status}">
          <div class="mission-left">
            <div class="mission-title">
              ${levelChip(m.level)}${escHTML(m.title)}
              ${adminView && locked ? `<span class="lock-chip">已锁定</span>` : ""}
              ${!adminView && myRep && myRep.status === "pending" ? `<span class="review-chip">待审批</span>` : ""}
              ${!adminView && myRep && myRep.status === "approved" ? `<span class="review-chip">已通过</span>` : ""}
              ${m.status === "failed" ? `<span class="fail-chip">已失败</span>` : ""}
              ${m.status === "expired" ? `<span class="fail-chip">已截止</span>` : ""}
            </div>
            <div class="mission-desc">${escHTML(m.desc)}</div>
            <div class="mission-meta">
              地点：${escHTML(m.loc)} · 奖励：${escHTML(rewardText(m))} · 名额：${acceptors.length} / ${m.slots || 1}
              · 时限：${escHTML(deadlineLabel(m.deadline))}
            </div>
            <div class="mission-countdown ${expired ? "expired" : ""}" data-cd="${m.deadline && m.deadline.endsAt ? m.deadline.endsAt : ""}">
              剩余：${cdText}
            </div>
            ${(adminView && acceptors.length) || m.status === "done" ? `
              <div class="acceptors">
                接取人：${acceptors.length ? acceptors.map(a => `<span class="acceptor">${escHTML(a.name)}（${roleLabelOf(a.role)}）</span>`).join("") : "<span class='muted'>暂无</span>"}
              </div>` : ""}
            ${shownRep ? `<div class="report-note">完成申请：${escHTML(shownRep.applicant ? shownRep.applicant.name : "—")} · ${fmtTime(shownRep.submittedAt)} · ${shownRep.status === "approved" ? "已通过" : "待审批"}</div>` : ""}
          </div>
          <div class="mission-right">
            ${adminView ? (m.status === "available"
              ? (locked
                  ? `<button class="btn-sm ghost" data-view="${m.id}">查看</button>`
                  : `<button class="btn-sm" data-edit="${m.id}">编辑</button><button class="btn-sm ghost" data-view="${m.id}">查看</button>`)
              : `<button class="btn-sm ghost" data-view="${m.id}">查看</button>`) : ""}
            ${!adminView && m.status === "available" && !accepted && !full && !expired ? `<button class="btn-sm" data-accept="${m.id}">接取</button>` : ""}
            ${!adminView && m.status === "available" && full ? `<span class="muted">名额已满</span>` : ""}
            ${canSubmit ? `<span class="muted">正在进行任务</span><button class="btn-sm" data-submit="${m.id}">提交任务内容</button>` : ""}
            ${!adminView && (m.status === "active" || m.status === "review") && !accepted
              ? `<span class="muted">${full ? "此委托接取人数已满" : "未参与"}</span>` : ""}
            ${adminView && rep ? `<button class="btn-sm" data-goto-approval="1">去审批</button>` : ""}
            ${m.status === "done" ? `<span class="done-mark">已完成</span>` : ""}
            ${adminView && m.status === "done" ? `<button class="btn-sm ghost" data-view="${m.id}">查看</button>` : ""}
          </div>
        </div>`;
    };

    let body = "";
    if (adminView && missionTab === "publish") {
      const recent = missions.slice(0, 3);
      body = `
        <div class="mission-cta panel-cut">
          <div>
            <div class="cta-title">新增委托任务</div>
            <div class="cta-desc">与主控台「发布委托任务」使用同一编辑器：选择地点、设置等级/名额/时限，并配置计划点或道具奖励。</div>
          </div>
          <div class="cta-actions">
            <button class="btn-sm" id="ctaNewMission">新增委托任务</button>
            <button class="btn-sm ghost" id="ctaItemCatalog">道具编辑</button>
          </div>
        </div>
        <div class="module-sub">最近发布</div>
        <div class="mission-list">
          ${recent.length ? recent.map(card).join("") : `<div class="empty-state">尚未发布任何委托</div>`}
        </div>`;
    } else {
      const list = inTab(missionTab);
      body = `<div class="mission-list">${list.length ? list.map(card).join("") : `<div class="empty-state">该分区下暂无委托</div>`}</div>`;
    }

    pageShell(container, {
      title: adminView ? "任务管理" : "委托任务",
      en: adminView ? "MISSION MGMT" : "COMMISSIONS",
      tools: `<div class="tabs">${tabs.map(([k, label]) => `<button class="tab-btn ${k === missionTab ? "active" : ""}" data-tab="${k}">${label} ${countOf(k)}</button>`).join("")}</div>`,
      body
    });

    // 分区切换
    container.querySelectorAll("[data-tab]").forEach(btn => {
      btn.onclick = () => { missionTab = btn.dataset.tab; renderMissionPage(container, isAdmin); };
    });

    const ctaNew = container.querySelector("#ctaNewMission");
    if (ctaNew) ctaNew.onclick = () => openMissionEditor();
    const ctaItems = container.querySelector("#ctaItemCatalog");
    if (ctaItems) ctaItems.onclick = () => openItemCatalog(() => renderMissionPage(container, isAdmin));

    container.querySelectorAll("[data-edit]").forEach(btn => {
      btn.onclick = () => openMissionEditor(btn.dataset.edit);
    });
    container.querySelectorAll("[data-view]").forEach(btn => {
      btn.onclick = () => openMissionDetail(btn.dataset.view);
    });
    const gotoApproval = container.querySelector("[data-goto-approval]");
    if (gotoApproval) gotoApproval.onclick = () => {
      approvalTab = "report";
      const item = document.querySelector('.menu-item[data-id="approval"]');
      if (item) item.click();
    };

    // 接取：管理者无接取权限；名额与时限双重校验
    container.querySelectorAll("[data-accept]").forEach(btn => {
      btn.onclick = async () => {
        const m = loadState().missions.find(x => x.id === btn.dataset.accept);
        if (!m) return;
        if (session && session.role === "admin") { toast("管理者不可接取委托"); return; }
        if (m.status !== "available") { toast("该委托当前不可接取"); return; }
        if (m.deadline && m.deadline.endsAt && Date.now() > m.deadline.endsAt) { toast("该委托已超过时限"); return; }
        m.acceptors = m.acceptors || [];
        if (m.acceptors.length >= (m.slots || 1)) { toast("名额已满"); return; }
        if (m.acceptors.some(a => a.username === myName)) { toast("你已接取该委托"); return; }
        if (window.SDJCloud && window.SDJCloud.enabled()) {
          btn.disabled = true;
          const r = await window.SDJCloud.acceptMission(m.id);
          btn.disabled = false;
          if (!r.ok) { toast(r.error || "接取失败"); return; }
          await syncWorldFromCloud(true);
          const host = document.getElementById("mainContent");
          missionTab = "active";
          if (host) renderMissionPage(host, false);
          toast(`已接取委托：${m.title}（${r.count || 0}/${r.slots || m.slots || 1}${r.status === "active" ? " · 已满员" : " · 仍可接取"}）`);
          return;
        }
        m.acceptors.push({
          username: myName,
          name: session ? session.displayName : "匿名",
          role: session ? session.role : "player",
          at: Date.now()
        });
        // 未满员保持 available，其他成员仍可接取；满员后自动转为进行中
        const fullNow = m.acceptors.length >= (m.slots || 1);
        if (fullNow) m.status = "active";
        pushActivity(myName, `接取委托「${m.title}」（${m.level} 级 · ${m.loc}）`, "mission");
        saveState();
        const host = document.getElementById("mainContent");
        missionTab = "active";
        if (host) renderMissionPage(host, false);
        toast(`已接取委托：${m.title}（${m.acceptors.length}/${m.slots || 1}${fullNow ? " · 已满员" : " · 仍可接取"}）`);
      };
    });

    // 提交完成：每位接取人独立提交，各自审批与结算
    container.querySelectorAll("[data-submit]").forEach(btn => {
      btn.onclick = async () => {
        const m = loadState().missions.find(x => x.id === btn.dataset.submit);
        if (!m) return;
        if (m.deadline && m.deadline.endsAt && Date.now() > m.deadline.endsAt) {
          toast("已超过任务时限，无法提交");
          renderMissionPage(container, isAdmin); // 渲染时统一结算超时委托
          return;
        }
        openMissionSubmitDialog(m, async (content) => {
          if (window.SDJCloud && window.SDJCloud.enabled()) {
            const r = await window.SDJCloud.submitMission(m.id, content);
            if (!r.ok) { toast(r.error || "提交失败"); return false; }
            await syncWorldFromCloud(true);
            toast("任务内容已提交，等待管理者审批");
            renderMissionPage(container, isAdmin);
            return true;
          }
          const s2 = loadState();
          s2.missionReports = s2.missionReports || [];
          const mineRep = s2.missionReports.find(r =>
            r.missionId === m.id && r.applicant && r.applicant.username === myName &&
            (r.status === "pending" || r.status === "approved")
          );
          if (mineRep) {
            toast(mineRep.status === "pending" ? "你的完成申请已在审批队列中" : "你的完成申请已通过");
            return true;
          }
          s2.missionReports.unshift({
            id: "mr" + Date.now(),
            missionId: m.id,
            missionTitle: m.title,
            level: m.level,
            loc: m.loc,
            reward: rewardText(m),
            desc: m.desc,
            content,
            applicant: {
              username: myName,
              name: session ? session.displayName : "匿名",
              role: session ? session.role : "player"
            },
            submittedAt: Date.now(),
            deadlineAt: m.deadline ? m.deadline.endsAt : null,
            status: "pending",
            note: ""
          });
          pushActivity(myName, `提交完成申请「${m.title}」`, "mission");
          recomputeMissionStatus(m);
          saveState();
          notifyAdmins(`新的委托完成申请：${m.title}（${session ? session.displayName : "匿名"}）`);
          saveState();
          toast("任务内容已提交，等待管理者审批");
          renderMissionPage(container, isAdmin);
          return true;
        });
      };
    });

    // 实时倒计时：每秒刷新，全部归零后重新结算一次
    stopMissionTick();
    missionTickTimer = setInterval(() => {
      if (!container.isConnected) { stopMissionTick(); return; }
      let expiredNow = false;
      container.querySelectorAll("[data-cd]").forEach(node => {
        const end = Number(node.dataset.cd);
        if (!end) { node.textContent = "剩余：无时限"; return; }
        const txt = fmtCountdown(end);
        node.textContent = `剩余：${txt}`;
        node.classList.toggle("expired", txt === "已截止");
        if (txt === "已截止") expiredNow = true;
      });
      if (expiredNow) {
        stopMissionTick();
        if (sweepMissionDeadlines(true) && container.isConnected) renderMissionPage(container, isAdmin);
      }
    }, 1000);
  }

  /* ---------------- 论坛：分区 / 数据 / 热门榜单 ---------------- */
  const FORUM_PAGE_SIZE = 15;

  const FORUM_SECTIONS = [
    { id: "all", name: "全部", aggregate: true },
    { id: "hot", name: "热门", aggregate: true },
    { id: "essence", name: "精华", aggregate: true },
    {
      id: "news", name: "实况新闻",
      intro: "此分区为神降官方发布在神降地图上发生的异常事件，有时是新副本即将开启的前兆，又或是一个新活动即将开启的前兆，每次实况新闻发布时，在【神降计划·世界频道】群内都会全体艾特，如果想要参与活动和新副本可以注意一下喔。\n注：（此类帖子皆可在底下评论，或许能获取到一些现场信息）"
    },
    {
      id: "qa", name: "问答帮助",
      intro: "此分区主要为玩家/契约者设置的帮帮乐区域，有任何游玩或是在进行中遇到的问题皆可在此提问，热情的老玩家/契约者将会回答你的问题。"
    },
    {
      id: "guide", name: "攻略分享",
      intro: "同样是由老玩家/契约者们经过了游玩之后得出的攻略分享，非常有用的一个专区，各方面皆有涉及，往下翻有老玩家/契约者专门写的新手保姆流程和怎样与NPC相处的攻略喔。"
    },
    {
      id: "daily", name: "日常记录",
      intro: "这里是专供玩家/契约者/NPC们发布日常生活的分区，你可以在这里分享你在游玩神降时遇到的事件或是进入神降后的感叹。有时在NPC发布的帖子下评论，得当的交流方式有可能增加NPC的好感度喔。\n注：新加入的玩家/契约者拥有七天新手保护期，在此【日常记录】分区内每天发【三条日常】，将以第一条100计划点，第二条80计划点，第三条60计划点结算；连续七天内每天发布三条日常可获得1680 计划点"
    },
    {
      id: "notice", name: "官方预告",
      intro: "作为神降官方开启副本或预备开启副本时的全体通知分区，一般会在当天/前几天预告参与时间与副本类型。\n注：（除去神降官方的副本，任何玩家/契约者若手中有可开启的副本则可以向神降官方进行投稿，官方会定下等级并给予开本kp奖励。）"
    },
    {
      id: "recruit", name: "招募频道",
      intro: "此处是在副本预备开启时或准备进行PVP时为没有玩家/契约者的人专门准备，如果你没有搭档，那么可以在此处招募暂时搭档进行组合。"
    },
    {
      id: "market", name: "交易市场",
      intro: "玩家/契约者之间也是可以私下进行交易的啦，只要确定好双方要交易的卡牌/物品/道具，就可以登记在此，当然有想要交易的物品也可发布在此等待是否有人会来交易喔。"
    },
    {
      id: "hall", name: "名人堂",
      intro: "专门用来记录玩家/契约者在神降当中发生的趣事，这里有不少老玩家/契约者曾经的神降笑话，可以来看看喔。"
    },
    {
      id: "fan", name: "同人圈",
      intro: "顾名思义，这里是神降的同人圈子，玩家/契约者可以在此发布在神降里的同人产品，现在占大比的是大家自制的一些神降梗图/自画同人图/自写同人文，欢迎大家来发表自己的创作喔。"
    },
    {
      id: "history", name: "历史活动",
      intro: "这已经是过去的25年的新年大活动啦，早已结束，作为纪念保留在此。每次此类大活动奖励都会非常丰富，同时也很危险，可以期待下一次的大活动。"
    }
  ];

  const FORUM_SECTION_MAP = FORUM_SECTIONS.reduce((m, s) => (m[s.id] = s, m), {});
  const FORUM_WRITABLE_SECTIONS = FORUM_SECTIONS.filter(s => !s.aggregate);
  const FORUM_LEGACY_SECTIONS = { f1: "news", f2: "guide", f3: "qa" };
  const FORUM_LEGACY_ROLES = { f1: "contractor", f2: "admin", f3: "player" };
  let forumState = { section: "all", page: 1, query: "" };
  let pendingForumSection = null;
  let forumHotTimer = null;
  let forumSearchTimer = null;
  let lastDetailView = null;
  let forumCloudFetchAt = 0;

  function forumRoleKey(role) {
    if (role === "admin" || role === "管理者") return "admin";
    if (role === "contractor" || role === "契约者") return "contractor";
    if (role === "player" || role === "玩家") return "player";
    return "";
  }

  function forumRoleTag(role) {
    const key = forumRoleKey(role);
    if (!key) return "";
    return `<span class="forum-role role-${key}">${roleLabelOf(key)}</span>`;
  }

  function guessForumSection(p) {
    if (/广播|预告|公告/.test(p.title || "")) return "notice";
    if (/攻略|教程|心得/.test(p.title || "")) return "guide";
    if (/新人|提问|怎么|为什么/.test(p.title || "")) return "qa";
    if (/同人|创作/.test(p.title || "")) return "fan";
    return "daily";
  }

  function guessForumRole(author) {
    const acc = getAccounts().find(a => a.displayName === author);
    if (acc) return acc.role;
    if (/沙利叶|白鸦/.test(author || "")) return "admin";
    if (/血月|墨羽/.test(author || "")) return "contractor";
    if (/月影|灰烬/.test(author || "")) return "player";
    return "";
  }

  // 旧数据迁移 + 字段补全（section / views / comments / essence / createdAt）
  function normalizeForumData() {
    const s = loadState();
    let changed = false;
    (s.forum || []).forEach((p, i) => {
      if (!p.section) { p.section = FORUM_LEGACY_SECTIONS[p.id] || guessForumSection(p); changed = true; }
      if (!p.authorRole) { p.authorRole = FORUM_LEGACY_ROLES[p.id] || guessForumRole(p.author); changed = true; }
      if (p.views == null) { p.views = 0; changed = true; }
      if (!Array.isArray(p.comments)) { p.comments = []; changed = true; }
      if (!Array.isArray(p.images)) { p.images = []; changed = true; }
      if (!Array.isArray(p.viewedBy)) { p.viewedBy = []; changed = true; }
      if (p.location === undefined) { p.location = null; changed = true; }
      if (p.essence == null) { p.essence = false; changed = true; }
      if (p.pinned == null) { p.pinned = false; changed = true; }
      if (!p.createdAt) { p.createdAt = Date.now() - i * 3600000; changed = true; }
      if (!p.time) { p.time = "刚刚"; changed = true; }
      if (!p.liked) p.liked = false;
    });
    if (!Array.isArray(s.forumHot)) { s.forumHot = []; changed = true; }
    if (changed) saveState();
    return s.forum || [];
  }

  // 热门：点赞数前 10；每天 05:00 后第一次访问（或每分钟检查）自动刷新
  function forumHotCycleKey() {
    const d = new Date();
    if (d.getHours() < 5) d.setDate(d.getDate() - 1);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function refreshHotIfDue(force) {
    const s = loadState();
    const key = forumHotCycleKey();
    if (!force && s.forumHotDate === key) return false;
    const top = (s.forum || []).slice()
      .sort((a, b) => (b.likes || 0) - (a.likes || 0) || (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, 10);
    s.forumHot = top.map(p => p.id);
    s.forumHotDate = key;
    saveState();
    return true;
  }

  function stopForumTimers() {
    if (forumHotTimer) { clearInterval(forumHotTimer); forumHotTimer = null; }
  }

  function forumPostsFor(section, query) {
    const all = normalizeForumData();
    const s = loadState();
    const byNew = (a, b) => (b.createdAt || 0) - (a.createdAt || 0);
    const q = String(query || "").trim().toLowerCase();
    if (q) {
      return all.filter(p => [p.title, p.body, p.author, p.authorUsername]
        .some(v => String(v || "").toLowerCase().includes(q))).sort(byNew);
    }
    const sec = FORUM_SECTION_MAP[section] || FORUM_SECTIONS[0];
    if (sec.id === "all") return all.slice().sort(byNew);
    if (sec.id === "hot") {
      return (s.forumHot || []).map(id => all.find(p => p.id === id)).filter(Boolean);
    }
    if (sec.id === "essence") return all.filter(p => p.essence).sort(byNew);
    return all.filter(p => p.section === sec.id).sort(byNew);
  }

  function forumPageNumbers(current, total) {
    const out = [];
    for (let i = 1; i <= total; i++) {
      if (i === 1 || i === total || Math.abs(i - current) <= 2) out.push(i);
      else if (out[out.length - 1] !== "…") out.push("…");
    }
    return out;
  }

  /* ---------------- 论坛 ---------------- */

  function renderForumPage(container, isAdmin) {
    normalizeForumData();
    refreshHotIfDue();
    const session = getSession();
    const cloud = !!(window.SDJCloud && window.SDJCloud.enabled());

    const sec = FORUM_SECTION_MAP[forumState.section] || FORUM_SECTIONS[0];
    const query = forumState.query;
    const all = forumPostsFor(sec.id, query);
    const totalPages = Math.max(1, Math.ceil(all.length / FORUM_PAGE_SIZE));
    if (forumState.page > totalPages) forumState.page = totalPages;
    const start = (forumState.page - 1) * FORUM_PAGE_SIZE;
    const pagePosts = all.slice(start, start + FORUM_PAGE_SIZE);

    const sectionNav = FORUM_SECTIONS.map(x => `
      <button class="forum-section-chip ${x.id === sec.id ? "active" : ""}" data-section="${x.id}">
        ${x.name}${x.id === "hot" ? `<i>TOP10</i>` : ""}${x.id === "essence" ? `<i>精选</i>` : ""}
      </button>`).join("");

    const intro = (!query && sec.intro)
      ? `<div class="forum-intro panel-cut">
           <div class="forum-intro-title">${sec.name}</div>
           <div class="forum-intro-body">${escHTML(sec.intro)}</div>
         </div>` : "";

    const searchNote = query
      ? `<div class="forum-search-note">全局搜索「${escHTML(query)}」 · 找到 ${all.length} 条帖子</div>` : "";

    const postCard = (p) => {
      const comments = p.comments || [];
      const images = Array.isArray(p.images) ? p.images.filter(Boolean) : [];
      const loc = p.location && p.location.name ? p.location : null;
      const preview = comments.length ? `
        <div class="forum-comment-preview">
          ${comments.slice(0, 2).map(c => `<div class="preview-line"><b>${escHTML(c.author)}：</b>${escHTML(c.text)}</div>`).join("")}
          ${comments.length > 2 ? `<div class="preview-more">共 ${comments.length} 条评论 ›</div>` : ""}
        </div>` : "";
      const sectionName = (FORUM_SECTION_MAP[p.section] || {}).name || "日常记录";
      return `
        <article class="forum-post panel-cut" data-open="${escHTML(p.id)}">
          <div class="post-head">
            <span class="avatar">${escHTML(String(p.author || "?").slice(0, 1))}</span>
            <div class="post-meta">
              <span class="post-author">${escHTML(p.author || "匿名")}${forumRoleTag(p.authorRole)}${p.essence ? `<span class="essence-chip">精华</span>` : ""}</span>
              <span class="post-time">${escHTML(p.time || "刚刚")}</span>
            </div>
            <span class="post-section">${escHTML(sectionName)}</span>
            ${isAdmin ? `
              <div class="post-admin">
                <button class="link-btn" data-essence="${escHTML(p.id)}">${p.essence ? "取消加精" : "加精"}</button>
                <button class="link-btn warn" data-del="${escHTML(p.id)}">删除</button>
              </div>` : ""}
          </div>
          <div class="post-title">${escHTML(p.title || "")}</div>
          <div class="post-body clamp">${escHTML(p.body || "")}</div>
          ${images.length ? `<div class="post-images">
            ${images.slice(0, 3).map(url => `<img class="post-image" src="${escHTML(url)}" alt="帖子配图" loading="lazy">`).join("")}
            ${images.length > 3 ? `<span class="post-image-more">+${images.length - 3}</span>` : ""}
          </div>` : ""}
          ${preview}
          <div class="post-foot">
            <span class="post-stat">浏览 ${p.views || 0}</span>
            <button class="like-btn ${p.liked ? "liked" : ""}" data-like="${escHTML(p.id)}">赞 ${p.likes || 0}</button>
            <span class="post-stat">评论 ${(p.comments || []).length}</span>
            ${loc ? `<button class="post-loc" data-goto-loc-post="${escHTML(p.id)}">⌖ ${escHTML(loc.name)}</button>` : `<span class="post-stat">分享</span>`}
          </div>
        </article>`;
    };

    const emptyState = `
      <div class="forum-empty">
        <svg class="forum-empty-svg" viewBox="0 0 200 150" aria-hidden="true">
          <rect x="52" y="28" width="96" height="112" rx="10" fill="#e8f0ff"/>
          <rect x="66" y="46" width="68" height="8" rx="4" fill="#bcd0f0"/>
          <rect x="66" y="64" width="68" height="8" rx="4" fill="#bcd0f0"/>
          <rect x="66" y="82" width="44" height="8" rx="4" fill="#bcd0f0"/>
          <rect x="56" y="104" width="88" height="28" rx="6" fill="#2f6bd8"/>
          <circle cx="150" cy="44" r="20" fill="#c9f5c2"/>
          <circle cx="150" cy="44" r="12" fill="#0f5132"/>
          <circle cx="42" cy="92" r="20" fill="#c9f5c2"/>
          <circle cx="42" cy="92" r="12" fill="#0f5132"/>
        </svg>
        <div class="forum-empty-title">暂无更多内容，快来发帖吧</div>
        <div class="forum-empty-sub">期待你的分享</div>
      </div>`;

    const pagination = all.length > FORUM_PAGE_SIZE ? `
      <div class="forum-pagination">
        <button class="page-btn" data-page="${forumState.page - 1}" ${forumState.page === 1 ? "disabled" : ""}>上一页</button>
        ${forumPageNumbers(forumState.page, totalPages).map(n => n === "…"
          ? `<span class="page-ellipsis">…</span>`
          : `<button class="page-btn ${n === forumState.page ? "active" : ""}" data-page="${n}">${n}</button>`).join("")}
        <button class="page-btn" data-page="${forumState.page + 1}" ${forumState.page === totalPages ? "disabled" : ""}>下一页</button>
      </div>` : "";

    pageShell(container, {
      title: isAdmin ? "论坛管理" : "论坛",
      en: isAdmin ? "FORUM MGMT" : "FORUM",
      tools: `
        <div class="forum-toolbar">
          <div class="forum-search">
            <span class="forum-search-icon">⌕</span>
            <input id="forumSearchInput" placeholder="搜索帖子或发帖人" value="${escHTML(query)}" maxlength="40">
            ${query ? `<button class="search-clear" id="forumSearchClear" title="清空">×</button>` : ""}
          </div>
          <span class="count-chip">${all.length} 条</span>
        </div>`,
      body: `
        <div class="forum-section-nav">${sectionNav}</div>
        ${intro}
        ${searchNote}
        ${pagePosts.length ? `<div class="forum-list">${pagePosts.map(postCard).join("")}</div>` : emptyState}
        ${pagination}
        <div class="forum-fab">
          <button class="fab-btn" id="forumTop" title="返回顶部">↑</button>
          <div class="fab-menu" id="forumFabMenu">
            <button class="fab-menu-item" id="fabNewPost">＋ 新增帖子</button>
          </div>
          <button class="fab-btn plus" id="forumPlus" title="新增帖子">+</button>
        </div>
      `
    });

    // 分区切换
    container.querySelectorAll("[data-section]").forEach(btn => {
      btn.onclick = () => {
        forumState.section = btn.dataset.section;
        forumState.page = 1;
        forumState.query = "";
        renderForumPage(container, isAdmin);
      };
    });

    // 全局搜索（标题 / 正文 / 发帖人）
    const searchInput = container.querySelector("#forumSearchInput");
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        clearTimeout(forumSearchTimer);
        const val = searchInput.value;
        forumSearchTimer = setTimeout(() => {
          forumState.query = val.trim();
          forumState.page = 1;
          renderForumPage(container, isAdmin);
          const again = container.querySelector("#forumSearchInput");
          if (again) {
            again.focus();
            again.setSelectionRange(again.value.length, again.value.length);
          }
        }, 250);
      });
      searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          clearTimeout(forumSearchTimer);
          forumState.query = searchInput.value.trim();
          forumState.page = 1;
          renderForumPage(container, isAdmin);
        }
      });
    }
    const clearBtn = container.querySelector("#forumSearchClear");
    if (clearBtn) {
      clearBtn.onclick = () => {
        forumState.query = "";
        forumState.page = 1;
        renderForumPage(container, isAdmin);
      };
    }

    // 打开帖子详情（独立路由）
    const openPost = (id) => {
      if (!id) return;
      lastDetailView = null;
      navigate(`/forum/post/${encodeURIComponent(id)}`);
    };
    container.querySelectorAll("[data-open]").forEach(card => {
      card.onclick = (e) => {
        if (e.target.closest("button")) return;
        openPost(card.dataset.open);
      };
    });
    container.querySelectorAll("[data-goto-loc-post]").forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        goToPostLocation(btn.dataset.gotoLocPost);
      };
    });

    // 点赞
    container.querySelectorAll("[data-like]").forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const p = loadState().forum.find(x => x.id === btn.dataset.like);
        if (!p) return;
        if (cloud && /^[0-9a-f-]{36}$/i.test(String(p.id))) {
          const r = await window.SDJCloud.toggleForumLike(p.id);
          if (!r.ok) { toast(r.error || "点赞失败"); return; }
          p.liked = !!r.liked;
          p.likes = r.likes || 0;
          saveState();
          renderForumPage(container, isAdmin);
          return;
        }
        const nextLiked = !p.liked;
        const nextLikes = Math.max(0, (p.likes || 0) + (nextLiked ? 1 : -1));
        p.liked = nextLiked;
        p.likes = nextLikes;
        saveState();
        if (cloud) {
          const ok = await window.SDJCloud.setForumLikes(p.id, nextLikes);
          if (!ok) {
            p.liked = !nextLiked;
            p.likes = Math.max(0, nextLikes + (nextLiked ? -1 : 1));
            saveState();
            toast("点赞失败");
          }
        }
        renderForumPage(container, isAdmin);
      };
    });

    // 管理者：加精 / 取消加精（云端帖同步写库，刷新后不丢失）
    container.querySelectorAll("[data-essence]").forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const p = loadState().forum.find(x => x.id === btn.dataset.essence);
        if (!p) return;
        const next = !p.essence;
        p.essence = next;
        saveState();
        if (cloud && /^[0-9a-f-]{36}$/i.test(String(p.id))) {
          const ok = await window.SDJCloud.setForumEssence(p.id, next);
          if (!ok) {
            p.essence = !next;
            saveState();
            toast("加精失败：请检查网络或加精字段是否已更新");
            renderForumPage(container, isAdmin);
            return;
          }
        }
        toast(next ? "已加精，帖子进入精华分区" : "已取消加精");
        renderForumPage(container, isAdmin);
      };
    });

    // 管理者：删除
    container.querySelectorAll("[data-del]").forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const id = btn.dataset.del;
        if (cloud) {
          const ok = await window.SDJCloud.removeForumPost(id);
          if (!ok) { toast("删除失败：仅作者或管理者可删除"); return; }
        }
        const st = loadState();
        st.forum = (st.forum || []).filter(x => x.id !== id);
        st.forumHot = (st.forumHot || []).filter(x => x !== id);
        saveState();
        toast("主题已删除");
        renderForumPage(container, isAdmin);
      };
    });

    // 分页
    container.querySelectorAll("[data-page]").forEach(btn => {
      btn.onclick = () => {
        const n = Number(btn.dataset.page);
        if (!n || n === forumState.page) return;
        forumState.page = n;
        renderForumPage(container, isAdmin);
        const host = document.getElementById("mainContent");
        if (host) host.scrollTo({ top: 0, behavior: "smooth" });
      };
    });

    // 右下角悬浮：返回顶部 + 新增帖子
    const fabMenu = container.querySelector("#forumFabMenu");
    const fabPlus = container.querySelector("#forumPlus");
    if (fabPlus) {
      fabPlus.onclick = (e) => {
        e.stopPropagation();
        fabMenu.classList.toggle("show");
      };
    }
    const newPostBtn = container.querySelector("#fabNewPost");
    if (newPostBtn) {
      newPostBtn.onclick = () => {
        pendingForumSection = FORUM_WRITABLE_SECTIONS.some(s => s.id === forumState.section)
          ? forumState.section : "daily";
        navigate("/forum/new");
      };
    }
    const topBtn = container.querySelector("#forumTop");
    if (topBtn) {
      topBtn.onclick = () => {
        const host = document.getElementById("mainContent") || document.scrollingElement;
        host.scrollTo({ top: 0, behavior: "smooth" });
      };
    }
    const closeFab = () => fabMenu && fabMenu.classList.remove("show");
    document.addEventListener("click", closeFab);
    container._cleanupPick = () => document.removeEventListener("click", closeFab);

    // 实时刷新：其他标签页写入 / 云端 Realtime
    const onStorageForum = (e) => {
      if (e.key && e.key !== STATE_KEY) return;
      if (currentMenuId !== "forum") return;
      reloadState();
      renderForumPage(container, isAdmin);
    };
    window.addEventListener("storage", onStorageForum);
    const prevCleanup = container._cleanupPick;
    container._cleanupPick = () => {
      if (prevCleanup) prevCleanup();
      window.removeEventListener("storage", onStorageForum);
    };

    if (cloud) {
      // 进入论坛时主动拉一次全量帖子。此前只靠 Realtime：刷新后本地没有论坛缓存，
      // 必须等别人再发一条消息才触发 listForum，表现为「帖子全部消失」。
      const fingerprint = (rows) => (rows || []).map(p =>
        [p.id, p.likes || 0, p.essence ? 1 : 0, (p.comments || []).length, p.section || ""].join(":")
      ).join("|");
      const now = Date.now();
      if (!container._forumFetching && now - forumCloudFetchAt > 3000) {
        container._forumFetching = true;
        forumCloudFetchAt = now;
        window.SDJCloud.listForum().then(rows => {
          container._forumFetching = false;
          if (!rows || !container.isConnected || currentMenuId !== "forum") return;
          const before = fingerprint(appState.forum);
          appState.forum = mergeLiked(rows, appState.forum);
          const after = fingerprint(appState.forum);
          try { localStorage.setItem(STATE_KEY, JSON.stringify(appState)); } catch (e) { /* ignore */ }
          if (after !== before) renderForumPage(container, isAdmin);
        }).catch(err => {
          container._forumFetching = false;
          console.warn("[论坛] 首次拉取失败：", err);
        });
      }

      startRealtime("forum_posts", async () => {
        if (currentMenuId !== "forum") return;
        const rows = await window.SDJCloud.listForum();
        if (!rows) return;
        appState.forum = mergeLiked(rows, appState.forum);
        normalizeForumData();
        try { localStorage.setItem(STATE_KEY, JSON.stringify(appState)); } catch (e) { /* ignore */ }
        renderForumPage(container, isAdmin);
      });
    }

    // 每 60 秒检查一次是否跨过 05:00，跨过则重算热门 TOP10
    stopForumTimers();
    forumHotTimer = setInterval(() => {
      if (!container.isConnected) { stopForumTimers(); return; }
      if (refreshHotIfDue()) {
        if (currentMenuId === "forum" && document.getElementById("mainContent")) {
          renderForumPage(document.getElementById("mainContent"), isAdmin);
        }
      }
    }, 60000);
  }


  /* ---------------- 论坛 · 独立页面（详情 / 发帖） ---------------- */
  function forumPageHead(backId, title, rightHtml) {
    return `
      <div class="forum-page-head">
        <button class="forum-back" id="${backId}" title="返回">‹</button>
        <div class="forum-page-title">${title}</div>
        <div class="forum-head-right">${rightHtml || ""}</div>
      </div>`;
  }

  function renderForumDetailPage(root, postId) {
    const session = getSession();
    if (!session) { navigate("/login"); return; }
    normalizeForumData();
    const wrap = el("div", { class: "forum-standalone" });
    root.appendChild(wrap);

    let replyTo = null;

    const initial = loadState().forum.find(x => x.id === postId);
    if (!initial) {
      wrap.innerHTML = `
        ${forumPageHead("forumBack", "神降计划◆论坛")}
        <div class="forum-empty">
          <div class="forum-empty-title">帖子不存在或已被删除</div>
          <div class="forum-empty-sub">返回论坛看看其他内容</div>
        </div>`;
      wrap.querySelector("#forumBack").onclick = () => { pendingMenu = "forum"; navigate("/app"); };
      return;
    }
    const isAdmin = session.role === "admin";
    const cloud = !!(window.SDJCloud && window.SDJCloud.enabled());
    let viewRecorded = false;

    function draw() {
      const p = loadState().forum.find(x => x.id === postId);
      if (!p) { pendingMenu = "forum"; navigate("/app"); return; }
      const comments = p.comments || [];
      const images = Array.isArray(p.images) ? p.images.filter(Boolean) : [];
      const loc = p.location && p.location.name ? p.location : null;
      const sectionName = (FORUM_SECTION_MAP[p.section] || {}).name || "日常记录";
      const commentHtml = comments.length ? comments.map(c => `
        <div class="comment-item">
          <span class="avatar">${escHTML(String(c.author || "?").slice(0, 1))}</span>
          <div class="comment-main">
            <div class="comment-head">
              <span class="comment-author">${escHTML(c.author || "匿名")}${forumRoleTag(c.authorRole)}</span>
              <span class="comment-time">${escHTML(c.time || "刚刚")}</span>
            </div>
            <div class="comment-text">${escHTML(c.text || "")}</div>
            <button class="comment-reply-btn" data-reply="${escHTML(c.id)}">回复</button>
            ${(c.replies || []).length ? `
              <div class="comment-replies">
                ${c.replies.map(r => `
                  <div class="comment-reply">
                    <b>${escHTML(r.author || "匿名")}</b>${forumRoleTag(r.authorRole)}：${escHTML(r.text || "")}
                    <span class="comment-time">${escHTML(r.time || "刚刚")}</span>
                  </div>`).join("")}
              </div>` : ""}
          </div>
        </div>`).join("") : `<div class="comment-empty">暂无评论，来说点什么吧</div>`;

      wrap.innerHTML = `
        ${forumPageHead("forumBack", "神降计划◆论坛", `
          ${isAdmin ? `
            <button class="head-btn" id="detailEssence">${p.essence ? "取消加精" : "加精"}</button>
            <button class="head-btn warn" id="detailDelete">删除</button>` : ""}
        `)}
        <div class="forum-detail">
          <div class="detail-author-row">
            <span class="avatar big">${escHTML(String(p.author || "?").slice(0, 1))}</span>
            <div class="detail-author-meta">
              <div class="detail-author">${escHTML(p.author || "匿名")}${forumRoleTag(p.authorRole)}</div>
              <div class="detail-sub">${escHTML(p.time || "刚刚")} · ${escHTML(sectionName)}${p.essence ? `<span class="essence-chip">精华</span>` : ""}</div>
            </div>
          </div>
          <h1 class="detail-title">${escHTML(p.title || "")}</h1>
          <div class="detail-body">${escHTML(p.body || "")}</div>
          ${images.length ? `<div class="detail-images">
            ${images.map(url => `<img class="detail-image" src="${escHTML(url)}" alt="帖子配图" loading="lazy">`).join("")}
          </div>` : ""}
          ${loc ? `<button class="detail-loc" data-goto-loc-post="${escHTML(postId)}">⌖ ${escHTML(loc.name)}</button>` : ""}
          <div class="detail-stats">
            <span>浏览 ${p.views || 0}</span>
            <span>赞 ${p.likes || 0}</span>
            <span>评论 ${comments.length}</span>
          </div>
          <div class="detail-actions">
            <button class="like-btn ${p.liked ? "liked" : ""}" id="detailLike">赞 ${p.likes || 0}</button>
            <button class="btn-sm ghost" id="detailFocusComment">写评论</button>
          </div>
          <div class="comment-section">
            <div class="comment-title">评论 ${comments.length}</div>
            ${commentHtml}
          </div>
        </div>
        <div class="comment-bar">
          <div class="reply-hint" id="replyHint" hidden></div>
          <div class="comment-bar-row">
            <input id="commentInput" class="comment-input" maxlength="300" placeholder="请友善发言，禁止发送不当言论喔~">
            <button class="btn-sm" id="commentSend">发送</button>
          </div>
        </div>`;

      wrap.querySelector("#forumBack").onclick = () => { pendingMenu = "forum"; navigate("/app"); };
      wrap.querySelectorAll("[data-goto-loc-post]").forEach(btn => {
        btn.onclick = () => goToPostLocation(btn.dataset.gotoLocPost);
      });

      wrap.querySelector("#detailLike").onclick = async () => {
        const cur = loadState().forum.find(x => x.id === postId);
        if (!cur) return;
        const nextLiked = !cur.liked;
        const nextLikes = Math.max(0, (cur.likes || 0) + (nextLiked ? 1 : -1));
        cur.liked = nextLiked;
        cur.likes = nextLikes;
        saveState();
        if (cloud) {
          const ok = await window.SDJCloud.setForumLikes(cur.id, nextLikes);
          if (!ok) {
            cur.liked = !nextLiked;
            cur.likes = Math.max(0, nextLikes + (nextLiked ? -1 : 1));
            saveState();
            toast("点赞失败");
          }
        }
        draw();
      };

      const essenceBtn = wrap.querySelector("#detailEssence");
      if (essenceBtn) {
        essenceBtn.onclick = async () => {
          const cur = loadState().forum.find(x => x.id === postId);
          if (!cur) return;
          const next = !cur.essence;
          cur.essence = next;
          saveState();
          if (cloud && /^[0-9a-f-]{36}$/i.test(String(postId))) {
            const ok = await window.SDJCloud.setForumEssence(postId, next);
            if (!ok) {
              cur.essence = !next;
              saveState();
              toast("加精失败：请检查网络");
              draw();
              return;
            }
          }
          toast(next ? "已加精，帖子进入精华分区" : "已取消加精");
          draw();
        };
      }
      const deleteBtn = wrap.querySelector("#detailDelete");
      if (deleteBtn) {
        deleteBtn.onclick = async () => {
          if (cloud) window.SDJCloud.removeForumPost(postId).catch(() => {});
          const st = loadState();
          st.forum = (st.forum || []).filter(x => x.id !== postId);
          st.forumHot = (st.forumHot || []).filter(x => x !== postId);
          saveState();
          toast("主题已删除");
          pendingMenu = "forum";
          navigate("/app");
        };
      }

      wrap.querySelectorAll("[data-reply]").forEach(btn => {
        btn.onclick = () => {
          const c = comments.find(x => x.id === btn.dataset.reply);
          replyTo = c ? c.id : null;
          const hint = wrap.querySelector("#replyHint");
          if (hint && c) {
            hint.hidden = false;
            hint.textContent = `回复 @${c.author}（点击取消）`;
            hint.onclick = () => { replyTo = null; hint.hidden = true; };
          }
          const input = wrap.querySelector("#commentInput");
          if (input) input.focus();
        };
      });

      const focusBtn = wrap.querySelector("#detailFocusComment");
      if (focusBtn) focusBtn.onclick = () => {
        const input = wrap.querySelector("#commentInput");
        if (input) input.focus();
      };

      wrap.querySelector("#commentInput").addEventListener("keydown", (e) => {
        if (e.key === "Enter") wrap.querySelector("#commentSend").click();
      });

      wrap.querySelector("#commentSend").onclick = async () => {
        const input = wrap.querySelector("#commentInput");
        const text = input.value.trim();
        if (!text) { toast("评论内容不能为空"); return; }
        if (cloud && /^[0-9a-f-]{36}$/i.test(String(postId))) {
          const r = await window.SDJCloud.addForumComment(postId, text, replyTo || "");
          if (!r.ok) { toast(r.error || "评论失败"); return; }
          const cur2 = loadState().forum.find(x => x.id === postId);
          if (cur2) { cur2.comments = r.comments || []; saveState(); }
          input.value = "";
          replyTo = null;
          const hint = wrap.querySelector("#replyHint");
          if (hint) hint.hidden = true;
          draw();
          return;
        }
        const cur = loadState().forum.find(x => x.id === postId);
        if (!cur) return;
        cur.comments = cur.comments || [];
        if (replyTo) {
          const target = cur.comments.find(x => x.id === replyTo);
          if (target) {
            target.replies = target.replies || [];
            target.replies.push({
              author: session.displayName,
              authorRole: session.role,
              text,
              time: "刚刚"
            });
          }
        } else {
          cur.comments.push({
            id: "c" + Date.now(),
            author: session.displayName,
            authorRole: session.role,
            text,
            time: "刚刚",
            replies: []
          });
        }
        saveState();
        replyTo = null;
        toast("评论已发布");
        draw();
      };
    }

    function canRedraw() {
      const active = document.activeElement;
      return !(active && wrap.contains(active) && /^(INPUT|TEXTAREA)$/.test(active.tagName));
    }

    // 浏览量：同一账号只计一次；云端用服务端原子函数，其他设备实时看到同一数字
    async function recordForumView() {
      if (viewRecorded) return;
      viewRecorded = true;
      const me = session.username || session.displayName;
      if (cloud && /^[0-9a-f-]{36}$/i.test(String(postId))) {
        const r = await window.SDJCloud.addForumView(postId);
        if (r.ok) {
          const cur = loadState().forum.find(x => x.id === postId);
          if (cur) { cur.views = Number(r.views) || cur.views || 0; saveState(); }
          if (canRedraw()) draw();
        } else {
          viewRecorded = false; // 网络失败时允许下次进入重试
        }
        return;
      }
      const cur = loadState().forum.find(x => x.id === postId);
      if (!cur) return;
      cur.viewedBy = Array.isArray(cur.viewedBy) ? cur.viewedBy : [];
      if (!cur.viewedBy.includes(me)) {
        cur.viewedBy.push(me);
        cur.views = cur.viewedBy.length;
        saveState();
        if (canRedraw()) draw();
      }
    }

    draw();
    recordForumView();

    const onStorage = (e) => {
      if (!e.key || e.key === STATE_KEY) { if (canRedraw()) draw(); }
    };
    window.addEventListener("storage", onStorage);

    // 详情页独立实时订阅：别人浏览/评论/加精/删帖后无需刷新即可更新
    let detailClosed = false;
    let detailChannel = null;
    let detailTimer = null;
    async function pullDetail() {
      if (detailClosed || !cloud) return;
      const res = await window.SDJCloud.getForumPost(postId);
      if (!res || !res.ok || detailClosed) return;
      if (!res.post) {
        detailClosed = true;
        toast("该帖子已被删除");
        pendingMenu = "forum";
        navigate("/app");
        return;
      }
      const row = res.post;
      const st = loadState();
      const prev = st.forum.find(x => x.id === postId);
      if (!prev) return;
      row.liked = !!prev.liked;
      Object.assign(prev, row);
      try { localStorage.setItem(STATE_KEY, JSON.stringify(st)); } catch (e) { /* ignore */ }
      if (canRedraw()) draw();
    }
    if (cloud) {
      window.SDJCloud.watch("forum_posts", pullDetail).then(ch => {
        if (detailClosed) { window.SDJCloud.unsubscribe(ch); return; }
        detailChannel = ch;
      });
      detailTimer = setInterval(pullDetail, 15000);
    }

    window.addEventListener("hashchange", function cleanupDetail() {
      detailClosed = true;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("hashchange", cleanupDetail);
      if (detailTimer) { clearInterval(detailTimer); detailTimer = null; }
      if (detailChannel) { window.SDJCloud.unsubscribe(detailChannel); detailChannel = null; }
    });
  }

  function renderForumNewPage(root) {
    const session = getSession();
    if (!session) { navigate("/login"); return; }

    const defaultSection = pendingForumSection
      || (FORUM_WRITABLE_SECTIONS.some(s => s.id === forumState.section) ? forumState.section : "daily");
    pendingForumSection = null;

    const wrap = el("div", { class: "forum-standalone" });
    root.appendChild(wrap);
    wrap.innerHTML = `
      ${forumPageHead("forumBack", "发新帖", `<button class="head-publish" id="npPublish">发表</button>`)}
      <div class="forum-editor">
        <input class="editor-title" id="npTitle" maxlength="40" placeholder="标题（必填）">
        <textarea class="editor-body" id="npBody" rows="6" maxlength="600" placeholder="期待你的分享"></textarea>
        <div class="editor-media">
          <input type="file" id="npImageInput" accept="image/*" multiple hidden>
          <button class="image-slot" id="npImage" type="button">+</button>
          <div class="editor-image-preview" id="npImagePreview"></div>
          <div class="editor-slot-note" id="npImageNote">最多 3 张，单张 ≤5MB（JPG / PNG / WebP / GIF）</div>
        </div>
        <button class="editor-row" id="npLocation" type="button">
          <span>⌖</span><b>标记位置</b><i id="npLocationText">未选择</i><em>›</em>
        </button>
        <div class="editor-row static">
          <span>▤</span><b>选择版块</b>
          <select class="editor-section-select" id="npSection">
            ${FORUM_WRITABLE_SECTIONS.map(s => `<option value="${s.id}" ${s.id === defaultSection ? "selected" : ""}>${s.name}</option>`).join("")}
          </select>
        </div>
        <button class="editor-row" id="npAdvanced" type="button">
          <span>⚙</span><b>高级设置</b><i>占位，暂未开放</i><em>›</em>
        </button>
      </div>`;

    const cloud = !!(window.SDJCloud && window.SDJCloud.enabled());
    let images = [];
    let location = null;

    const renderImages = () => {
      const box = wrap.querySelector("#npImagePreview");
      box.innerHTML = images.map((url, i) => `
        <span class="editor-image-item">
          <img src="${escHTML(url)}" alt="待发布配图">
          <button type="button" class="editor-image-del" data-del-image="${i}" title="移除">×</button>
        </span>`).join("");
      box.querySelectorAll("[data-del-image]").forEach(btn => {
        btn.onclick = () => {
          images.splice(Number(btn.dataset.delImage), 1);
          renderImages();
        };
      });
      const slot = wrap.querySelector("#npImage");
      slot.style.display = images.length >= 3 ? "none" : "";
      wrap.querySelector("#npImageNote").textContent = images.length
        ? `已添加 ${images.length} / 3 张`
        : "最多 3 张，单张 ≤5MB（JPG / PNG / WebP / GIF）";
    };

    const readFileDataURL = (file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("读取图片失败"));
      reader.readAsDataURL(file);
    });

    const uploadFiles = async (files) => {
      for (const file of Array.from(files || [])) {
        if (images.length >= 3) { toast("最多只能添加 3 张图片"); break; }
        if (!/^image\//.test(file.type || "")) { toast("只能上传图片文件"); continue; }
        if (file.size > 5 * 1024 * 1024) { toast("单张图片不能超过 5MB"); continue; }
        if (cloud) {
          wrap.querySelector("#npImageNote").textContent = "图片上传中…";
          const r = await window.SDJCloud.uploadForumImage(file);
          if (!r.ok) { toast(r.error || "图片上传失败"); continue; }
          images.push(r.url);
        } else {
          const url = await readFileDataURL(file);
          if (url) images.push(url);
        }
      }
      renderImages();
    };

    wrap.querySelector("#forumBack").onclick = () => { pendingMenu = "forum"; navigate("/app"); };
    const imageInput = wrap.querySelector("#npImageInput");
    wrap.querySelector("#npImage").onclick = () => imageInput.click();
    imageInput.onchange = () => {
      const files = Array.from(imageInput.files || []);
      imageInput.value = "";
      uploadFiles(files).catch(err => toast("图片处理失败：" + (err.message || "未知错误")));
    };
    wrap.querySelector("#npLocation").onclick = () => {
      openPostLocationPicker((loc) => {
        location = loc;
        const label = wrap.querySelector("#npLocationText");
        label.textContent = loc ? `${loc.name} · ${Number(loc.lat).toFixed(2)}, ${Number(loc.lon).toFixed(2)}` : "未选择";
        label.classList.toggle("on", !!loc);
      });
    };
    wrap.querySelector("#npAdvanced").onclick = () => toast("高级设置占位，本轮暂未开放");

    wrap.querySelector("#npPublish").onclick = async () => {
      const title = wrap.querySelector("#npTitle").value.trim();
      const body = wrap.querySelector("#npBody").value.trim();
      const section = wrap.querySelector("#npSection").value;
      if (!title) { toast("标题不能为空"); return; }
      if (!body) { toast("正文不能为空"); return; }
      if (!FORUM_WRITABLE_SECTIONS.some(s => s.id === section)) { toast("请选择版块"); return; }

      const btn = wrap.querySelector("#npPublish");
      btn.disabled = true;
      try {
        const post = {
          id: "f" + Date.now(),
          author: session.displayName,
          authorUsername: session.username || "",
          authorRole: session.role,
          title, body, section,
          time: "刚刚",
          createdAt: Date.now(),
          likes: 0, liked: false, views: 0, viewedBy: [],
          images: images.slice(), location: location || null,
          comments: [], essence: false, pinned: false
        };
        let row = null;
        if (cloud) {
          row = await window.SDJCloud.addForumPost({
            author: session.displayName, title, body,
            section, authorRole: session.role,
            images: images.slice(), location: location || null
          });
          if (row) Object.assign(row, {
            section, authorRole: session.role, createdAt: Date.now(),
            comments: [], views: 0, viewedBy: [], images: images.slice(), location: location || null
          });
          else throw new Error("云端写入失败");
        }
        const st = loadState();
        st.forum = st.forum || [];
        st.forum.unshift(cloud ? row : post);
        saveState();
        forumState = { section, page: 1, query: "" };
        pendingMenu = "forum";
        toast("帖子已发布");
        navigate("/app");
      } catch (err) {
        console.error("[论坛] 发帖失败：", err);
        toast("发布失败：" + (err.message || "未知错误"));
        btn.disabled = false;
      }
    };
  }

  /* ---------------- 发帖 · 位置标记选择器 ---------------- */
  function openPostLocationPicker(onSelect) {
    const overlay = el("div", { class: "modal-overlay", id: "postLocModal" });
    const panel = el("div", { class: "modal-panel panel-cut wide" });
    overlay.appendChild(panel);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("show"));

    let items = [];
    let ready = false;
    panel.innerHTML = `
      <div class="modal-title">标记位置</div>
      <div class="modal-desc">选择地图上的地点，或直接填写经纬度创建一个自定义标记。发布后其他成员可点击地点直接跳转到地图。</div>
      <input class="input-line" id="locSearch" placeholder="搜索地点名称 / 区域">
      <div class="loc-pick-list" id="locPickList"><div class="empty-state">载入地点中…</div></div>
      <div class="loc-custom panel-cut">
        <div class="loc-custom-title">自定义坐标</div>
        <div class="form-row-2">
          <label class="modal-label">地点名称<input class="input-line" id="locName" maxlength="24" placeholder="如：旧城钟楼"></label>
          <label class="modal-label">区域<input class="input-line" id="locDistrict" maxlength="8" placeholder="如：A区"></label>
        </div>
        <div class="form-row-2">
          <label class="modal-label">纬度<input class="input-line" id="locLat" type="number" step="0.01" min="-90" max="90" placeholder="0.00"></label>
          <label class="modal-label">经度<input class="input-line" id="locLon" type="number" step="0.01" min="-180" max="180" placeholder="0.00"></label>
        </div>
        <button class="btn-sm ghost" id="locCustomOk" type="button">使用自定义坐标</button>
      </div>
      <div class="modal-actions">
        <button class="btn-sm ghost" id="locClear" type="button">清除位置标记</button>
        <button class="btn-sm ghost" id="locCancel" type="button">取消</button>
      </div>`;

    const listEl = panel.querySelector("#locPickList");
    const renderList = () => {
      const q = panel.querySelector("#locSearch").value.trim().toLowerCase();
      const list = items.filter(it =>
        !q || `${it.name} ${it.district || ""}`.toLowerCase().includes(q)
      );
      listEl.innerHTML = list.length ? list.map(it => `
        <button class="loc-pick-row" type="button" data-loc-id="${escHTML(it.id)}">
          <span class="level-chip">L${it.level}</span>
          <span class="loc-pick-name">${escHTML(it.name)}</span>
          <span class="loc-pick-sub">${escHTML(it.district || "—")} · ${Number(it.lat).toFixed(2)}, ${Number(it.lon).toFixed(2)}</span>
        </button>`).join("") : `<div class="empty-state">未找到匹配地点</div>`;
      listEl.querySelectorAll("[data-loc-id]").forEach(btn => {
        btn.onclick = () => {
          const it = items.find(x => x.id === btn.dataset.locId);
          if (!it) return;
          onSelect({ id: it.id, name: it.name, district: it.district || "", lat: Number(it.lat), lon: Number(it.lon) });
          overlay.remove();
        };
      });
    };

    panel.querySelector("#locSearch").oninput = renderList;
    panel.querySelector("#locCancel").onclick = () => overlay.remove();
    panel.querySelector("#locClear").onclick = () => { onSelect(null); overlay.remove(); };
    panel.querySelector("#locCustomOk").onclick = () => {
      const name = panel.querySelector("#locName").value.trim();
      const lat = Number(panel.querySelector("#locLat").value);
      const lon = Number(panel.querySelector("#locLon").value);
      if (!name) { toast("请填写自定义地点名称"); return; }
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        toast("经纬度不合法（纬度 ±90 / 经度 ±180）"); return;
      }
      onSelect({ id: "", name, district: panel.querySelector("#locDistrict").value.trim(), lat, lon });
      overlay.remove();
    };

    getLocationChoices().then(list => {
      items = list || [];
      ready = true;
      renderList();
    }).catch(() => {
      items = [];
      ready = true;
      renderList();
    });
    setTimeout(() => panel.querySelector("#locSearch").focus(), 80);
    return { ready: () => ready };
  }

  /* =========================================================
   *  社交模块：密语（消息） / 通讯录（联系人） / 群聊
   *  - 关系与群结构：sdj_social_v1
   *  - 消息：sdj_social_msgs_v1（按会话分桶，单会话最多 500 条）
   *  - NPC 为“仅数据用户”，不可登录，但会自动同意好友申请与群邀请
   * ========================================================= */
  const SOCIAL_KEY = "sdj_social_v1";
  const SOCIAL_MSG_KEY = "sdj_social_msgs_v1";
  const NPC_MIGRATED_KEY = "sdj_npc_friends_synced";
  const FRIEND_TIMEOUT_MS = 7 * 86400000;
  const GROUP_INVITE_TIMEOUT_MS = 24 * 3600000;
  const GROUP_JOIN_TIMEOUT_MS = 7 * 86400000;
  const GROUP_MAX_MEMBERS = 200;
  const GROUP_MAX_ADMINS = 5;
  const MSG_LIMIT = 500;
  const MSG_MAX_LEN = 500;
  const SOCIAL_TAG_DEFAULT = "t_default";

  const NPC_USERS = [
    { username: "npc_baiya", name: "白鸦", role: "contractor", online: true, sign: "情报科的耳朵，比塔还灵。" },
    { username: "npc_moyu", name: "墨羽", role: "contractor", online: true, sign: "夜巡第七组，编号 K-7。" },
    { username: "npc_huijin", name: "灰烬", role: "player", online: false, sign: "刚签完契约，匕首还没开刃。" },
    { username: "npc_yeying", name: "夜莺", role: "player", online: true, sign: "只在午夜之后出现。" }
  ];

  const PINYIN_INITIALS = {
    阿: "A", 艾: "A", 安: "A",
    白: "B", 百: "B", 柏: "B", 北: "B", 冰: "B", 波: "B",
    陈: "C", 程: "C", 城: "C", 初: "C", 春: "C", 辞: "C",
    大: "D", 冬: "D", 东: "D", 刀: "D",
    风: "F", 飞: "F", 浮: "F",
    孤: "G", 古: "G", 顾: "G", 归: "G", 鬼: "G",
    海: "H", 寒: "H", 红: "H", 花: "H", 华: "H", 黄: "H", 灰: "H", 黑: "H",
    江: "J", 简: "J", 姐: "J", 金: "J", 九: "J", 旧: "J", 烬: "J",
    空: "K", 客: "K",
    蓝: "L", 林: "L", 凌: "L", 刘: "L", 龙: "L", 洛: "L",
    猫: "M", 梦: "M", 明: "M", 默: "M", 墨: "M", 木: "M", 暮: "M",
    南: "N", 宁: "N",
    欧: "O",
    裴: "P", 珀: "P",
    祈: "Q", 青: "Q", 清: "Q", 秋: "Q",
    燃: "R", 容: "R",
    沙: "S", 山: "S", 少: "S", 深: "S", 神: "S", 十: "S", 石: "S", 时: "S", 守: "S", 霜: "S", 水: "S", 司: "S", 苏: "S",
    塔: "T", 天: "T", 听: "T",
    王: "W", 未: "W", 温: "W", 无: "W", 吴: "W",
    西: "X", 夏: "X", 先: "X", 星: "X", 血: "X", 雪: "X", 巡: "X",
    鸦: "Y", 夜: "Y", 莺: "Y", 影: "Y", 幽: "Y", 月: "Y", 云: "Y", 羽: "Y",
    张: "Z", 长: "Z", 赵: "Z", 真: "Z", 之: "Z", 纸: "Z", 钟: "Z", 昼: "Z", 朱: "Z", 紫: "Z"
  };

  let socialState = null;
  let socialMsgs = null;
  let socialView = {
    view: "messages", tab: "friend", conv: null, searchTab: "person",
    contactsTab: "friends", groupTab: "all", groupId: null,
    query: "", applied: "", msgQuery: "", msgApplied: "",
    pickMode: "create", picked: [], draft: ""
  };
  let socialTick = null;
  let socialSearchTimer = null;
  let socialCloudTimer = null;
  let socialCloudChannel = null;
  let socialCloudBusy = false;
  let socialCloudPulled = false;
  let socialProfilesCache = [];
  let socialProfilesAt = 0;
  let socialProfilesBusy = false;
  const SOCIAL_CLOUD_AT = "sdj_social_cloud_at";

  function defaultSocial() {
    return {
      v: 1,
      friends: {},
      npcFriends: {},
      friendRequests: [],
      groups: [],
      groupRequests: [],
      groupsSeq: 100000001,
      presence: {},
      reads: {},
      friendSince: {},
      friendTags: [{ id: SOCIAL_TAG_DEFAULT, name: "我的好友" }],
      friendTagOf: {}
    };
  }

  function loadSocial() {
    if (socialState) return socialState;
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(SOCIAL_KEY)); } catch (e) { raw = null; }
    const base = defaultSocial();
    socialState = raw && typeof raw === "object" ? Object.assign(base, raw) : base;
    ["friends", "npcFriends", "reads", "presence", "friendSince", "friendTagOf"].forEach(k => {
      if (!socialState[k] || typeof socialState[k] !== "object") socialState[k] = {};
    });
    ["friendRequests", "groups", "groupRequests", "friendTags"].forEach(k => {
      if (!Array.isArray(socialState[k])) socialState[k] = base[k];
    });
    if (!socialState.friendTags.length) socialState.friendTags = [{ id: SOCIAL_TAG_DEFAULT, name: "我的好友" }];
    if (!socialState.groupsSeq) socialState.groupsSeq = 100000001;
    return socialState;
  }
  function reloadSocial() { socialState = null; return loadSocial(); }

  function saveSocial() {
    try { localStorage.setItem(SOCIAL_KEY, JSON.stringify(socialState)); }
    catch (e) { toast("社交数据保存失败：本地存储空间不足"); }
    queueSocialCloudPush();
  }

  function loadSocialMsgs() {
    if (socialMsgs) return socialMsgs;
    try { socialMsgs = JSON.parse(localStorage.getItem(SOCIAL_MSG_KEY)) || {}; } catch (e) { socialMsgs = {}; }
    if (!socialMsgs || typeof socialMsgs !== "object") socialMsgs = {};
    return socialMsgs;
  }
  function reloadSocialMsgs() { socialMsgs = null; return loadSocialMsgs(); }
  function saveSocialMsgs() {
    try { localStorage.setItem(SOCIAL_MSG_KEY, JSON.stringify(socialMsgs)); }
    catch (e) { toast("消息保存失败：本地存储空间不足"); }
    queueSocialCloudPush();
  }

  /* 云端社交快照：config 填入 Supabase 后自动启用，留空则整段休眠 */
  function socialCloudPayload() {
    // 结构性数据（好友关系 / 群 / 申请）全部由服务端原子函数维护，
    // 快照只同步「软的」本机数据（在线状态、已读、分组标签）与消息，
    // 避免整份快照把别人刚改好的群设置或审批状态覆盖回去。
    const soft = Object.assign({}, loadSocial());
    ["friends", "npcFriends", "friendRequests", "groups", "groupRequests", "groupsSeq"].forEach(k => delete soft[k]);
    return { v: 1, updatedAt: Date.now(), social: soft, msgs: loadSocialMsgs() };
  }

  async function pushSocialCloudNow() {
    if (!window.SDJCloud || !window.SDJCloud.enabled()) return false;
    if (socialCloudBusy) return false;
    socialCloudBusy = true;
    try {
      const payload = socialCloudPayload();
      const res = await window.SDJCloud.saveSocialSnapshot(payload);
      if (res && res.ok) localStorage.setItem(SOCIAL_CLOUD_AT, String(res.updatedAt));
      return !!(res && res.ok);
    } catch (e) {
      return false;
    } finally {
      socialCloudBusy = false;
    }
  }

  function queueSocialCloudPush() {
    if (!window.SDJCloud || !window.SDJCloud.enabled()) return;
    if (socialCloudTimer) clearTimeout(socialCloudTimer);
    socialCloudTimer = setTimeout(() => {
      socialCloudTimer = null;
      pushSocialCloudNow();
    }, 1500);
  }

  // 消息按 id 合并：本地刚发出、还没推到服务端的消息不能被远端快照覆盖掉
  function mergeMsgSnapshots(local, remote) {
    const out = Object.assign({}, remote || {});
    const localAll = local || {};
    Object.keys(localAll).forEach(cid => {
      const byId = new Map();
      (out[cid] || []).forEach(m => { if (m && m.id != null) byId.set(m.id, m); });
      (localAll[cid] || []).forEach(m => { if (m && m.id != null) byId.set(m.id, m); });
      out[cid] = Array.from(byId.values()).sort((a, b) => (a.at || 0) - (b.at || 0));
      if (out[cid].length > MSG_LIMIT) out[cid] = out[cid].slice(out[cid].length - MSG_LIMIT);
    });
    return out;
  }

  async function pullSocialCloud() {
    if (!window.SDJCloud || !window.SDJCloud.enabled()) return false;
    const remote = await window.SDJCloud.loadSocialSnapshot();
    if (!remote || !remote.updatedAt) return false;
    const localAt = Number(localStorage.getItem(SOCIAL_CLOUD_AT) || 0);
    if (remote.updatedAt <= localAt) return false;
    try {
      if (remote.social) {
        const socialOut = remote.social;
        const local = loadSocial();
        socialOut.npcFriends = socialOut.npcFriends || {};
        // 首次迁移前保留本机已有的 NPC 好友，避免还没上传就被云端快照覆盖
        if (localStorage.getItem(NPC_MIGRATED_KEY) !== "1") {
          Object.keys(local.friends || {}).forEach(u => {
            const npcOnly = (local.friends[u] || []).filter(isNpcUser);
            if (!npcOnly.length) return;
            socialOut.npcFriends[u] = Array.from(new Set([...(socialOut.npcFriends[u] || []), ...npcOnly]));
          });
          Object.keys(local.npcFriends || {}).forEach(u => {
            const list = local.npcFriends[u] || [];
            if (!list.length) return;
            socialOut.npcFriends[u] = Array.from(new Set([...(socialOut.npcFriends[u] || []), ...list]));
          });
        }
        // NPC 申请历史只作本机展示，仍在拉取时保留
        const npcReqs = (local.friendRequests || []).filter(r => isNpcUser(r.to) || isNpcUser(r.from));
        if (npcReqs.length) {
          const byId = new Map();
          (socialOut.friendRequests || []).forEach(r => byId.set(r.id, r));
          npcReqs.forEach(r => byId.set(r.id, r));
          socialOut.friendRequests = Array.from(byId.values());
        }
        localStorage.setItem(SOCIAL_KEY, JSON.stringify(socialOut));
      }
      if (remote.msgs) {
        const mergedMsgs = mergeMsgSnapshots(loadSocialMsgs(), remote.msgs);
        localStorage.setItem(SOCIAL_MSG_KEY, JSON.stringify(mergedMsgs));
      }
      localStorage.setItem(SOCIAL_CLOUD_AT, String(remote.updatedAt));
      reloadSocial();
      reloadSocialMsgs();
      return true;
    } catch (e) { return false; }
  }

  // 一次性迁移：把本机旧版 friends 里的 NPC 关系上传到服务端 npcFriends
  async function syncNpcFriendsToCloud() {
    if (!window.SDJCloud || !window.SDJCloud.enabled()) return;
    if (localStorage.getItem(NPC_MIGRATED_KEY) === "1") return;
    const me = currentSocialUser();
    if (!me) return;
    const s = loadSocial();
    const npcList = Array.from(new Set([
      ...(s.friends[me] || []).filter(isNpcUser),
      ...(s.npcFriends[me] || [])
    ]));
    let allOk = true;
    for (const npc of npcList) {
      const r = await window.SDJCloud.npcFriendAdd(npc);
      if (!r.ok) { allOk = false; break; }
    }
    if (!allOk) return; // 网络失败时保留本机数据，下次进入好友页再试
    s.friends[me] = (s.friends[me] || []).filter(x => !isNpcUser(x));
    if (npcList.length) s.npcFriends[me] = npcList;
    try { localStorage.setItem(SOCIAL_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
    localStorage.setItem(NPC_MIGRATED_KEY, "1");
  }

  function startSocialCloudWatch() {
    if (!window.SDJCloud || !window.SDJCloud.enabled() || socialCloudChannel) return;
    window.SDJCloud.watch("social_state", async () => {
      const before = socialUiFingerprint();
      const changed = await pullSocialCloud();
      if (!changed) return;
      const after = socialUiFingerprint();
      refreshSocialBadges();
      if (before === after) return; // 只有 presence/已读变化时不重绘，避免页面周期性弹跳
      // 好友页重绘；其他页面至少弹出未读提示
      if (currentMenuId === "friend") {
        if (socialView.view === "chat") { onSocialExternal(); return; }
        if (socialInputBusy()) { maybeShowUnreadBanner(); return; }
        socialRerender();
      } else maybeShowUnreadBanner();
    }).then(ch => { socialCloudChannel = ch; });
  }

  function stopSocialCloudWatch() {
    if (socialCloudChannel && window.SDJCloud) window.SDJCloud.unsubscribe(socialCloudChannel);
    socialCloudChannel = null;
  }

  function emitSocial() { document.dispatchEvent(new CustomEvent("sdj:social-change")); }

  /* ---------------- 用户目录与在线状态 ---------------- */
  function realAccounts() {
    // 云端模式使用服务端 profiles，才能搜到其他设备注册的玩家/契约者/管理员
    if (window.SDJCloud && window.SDJCloud.enabled() && socialProfilesCache.length) {
      return socialProfilesCache.slice();
    }
    const accs = getAccounts();
    if (accs.length) return accs.map(a => ({
      username: a.username,
      name: a.displayName || a.username,
      role: a.role || "player",
      npc: false,
      sign: ""
    }));
    return ROSTER.map(k => ({ username: k.username, name: k.name, role: k.role, npc: false, sign: "" }));
  }

  async function ensureSocialProfiles(force) {
    if (!window.SDJCloud || !window.SDJCloud.enabled()) return;
    if (socialProfilesBusy) return;
    if (!force && socialProfilesCache.length && Date.now() - socialProfilesAt < 30000) return;
    socialProfilesBusy = true;
    try {
      const list = await window.SDJCloud.listProfiles();
      socialProfilesAt = Date.now();
      if (!list) return;
      const sig = p => [p.username, p.name, p.sign, p.avatar, p.gender, p.age].join(":");
      const before = socialProfilesCache.map(sig).sort().join(",");
      socialProfilesCache = list.filter(p => !p.banned).map(p => ({
        username: p.username,
        name: p.display_name || p.username,
        role: p.role || "player",
        npc: false,
        sign: p.sign || "",
        gender: p.gender || "",
        age: p.age == null ? "" : p.age,
        avatar: p.avatar_url || "",
        createdAt: p.created_at || "",
        updatedAt: p.updated_at || ""
      }));
      const after = socialProfilesCache.map(sig).sort().join(",");
      if (before !== after) {
        refreshSocialBadges();
        if (currentMenuId === "friend" && !socialInputBusy()) socialRerender();
      }
    } catch (e) {
      /* 网络失败时回退本地账号目录 */
    } finally {
      socialProfilesBusy = false;
    }
  }

  function socialDirectory() {
    const list = realAccounts();
    NPC_USERS.forEach(n => {
      if (!list.some(u => u.username === n.username)) {
        list.push({ username: n.username, name: n.name, role: n.role, npc: true, sign: n.sign, online: n.online });
      }
    });
    return list;
  }

  function socialUser(username) {
    return socialDirectory().find(u => u.username === username)
      || { username, name: username || "未知", role: "player", npc: false, sign: "" };
  }
  function nameOf(username) { return socialUser(username).name; }
  function isNpcUser(username) { return NPC_USERS.some(n => n.username === username); }

  function isOnline(username) {
    const npc = NPC_USERS.find(n => n.username === username);
    if (npc) return npc.online !== false;
    const t = loadSocial().presence[username] || 0;
    return Date.now() - t < 5 * 60 * 1000;
  }

  function touchPresence(username) {
    if (!username) return;
    const s = loadSocial();
    s.presence[username] = Date.now();
  }

  /* ---------------- 好友关系 ---------------- */
  function pairKey(a, b) { return [a, b].sort().join("|"); }
  function friendsOf(username) {
    const s = loadSocial();
    return Array.from(new Set([
      ...(s.friends[username] || []),
      ...(s.npcFriends[username] || [])
    ]));
  }
  function areFriends(a, b) {
    const s = loadSocial();
    return (s.friends[a] || []).includes(b) || (s.npcFriends[a] || []).includes(b);
  }

  function addFriendPair(a, b) {
    const s = loadSocial();
    // NPC 没有 Auth 档案，关系单独存 npcFriends，服务端 RPC 负责跨设备同步
    if (isNpcUser(b)) {
      s.npcFriends[a] = Array.from(new Set([...(s.npcFriends[a] || []), b]));
      if (!s.friendSince[pairKey(a, b)]) s.friendSince[pairKey(a, b)] = Date.now();
      return;
    }
    if (isNpcUser(a)) {
      s.npcFriends[b] = Array.from(new Set([...(s.npcFriends[b] || []), a]));
      if (!s.friendSince[pairKey(a, b)]) s.friendSince[pairKey(a, b)] = Date.now();
      return;
    }
    s.friends[a] = Array.from(new Set([...(s.friends[a] || []), b]));
    s.friends[b] = Array.from(new Set([...(s.friends[b] || []), a]));
    if (!s.friendSince[pairKey(a, b)]) s.friendSince[pairKey(a, b)] = Date.now();
  }

  // 删除好友：双向解除；消息记录保留，方便回看
  async function removeFriend(username) {
    const me = currentSocialUser();
    if (!me || !username) return { ok: false, error: "参数错误" };
    if (!areFriends(me, username)) return { ok: false, error: "你们还不是好友" };
    if (window.SDJCloud && window.SDJCloud.enabled()) {
      const r = isNpcUser(username)
        ? await window.SDJCloud.npcFriendRemove(username)
        : await window.SDJCloud.friendRemove(username);
      if (!r.ok) return r;
      await pullSocialCloud();
      emitSocial();
      return { ok: true };
    }
    const s = loadSocial();
    s.friends[me] = (s.friends[me] || []).filter(x => x !== username);
    s.friends[username] = (s.friends[username] || []).filter(x => x !== me);
    s.npcFriends[me] = (s.npcFriends[me] || []).filter(x => x !== username);
    s.npcFriends[username] = (s.npcFriends[username] || []).filter(x => x !== me);
    delete s.friendSince[pairKey(me, username)];
    saveSocial();
    return { ok: true };
  }

  function pendingFriendBetween(a, b) {
    return loadSocial().friendRequests.find(r => r.from === a && r.to === b && r.status === "pending") || null;
  }

  async function sendFriendRequest(from, to, message) {
    if (window.SDJCloud && window.SDJCloud.enabled() && !isNpcUser(to)) {
      const r = await window.SDJCloud.friendRequest(to, message);
      if (!r.ok) return r;
      await pullSocialCloud();
      emitSocial();
      return { ok: true, request: r.request };
    }
    const s = loadSocial();
    if (!from || !to) return { ok: false, error: "参数错误" };
    if (from === to) return { ok: false, error: "不能添加自己为好友" };
    if (areFriends(from, to)) return { ok: false, error: "你们已经是好友了" };
    const reverse = s.friendRequests.find(r => r.from === to && r.to === from && r.status === "pending");
    if (reverse) return { ok: false, error: "对方已向你发送好友申请，请到通知中处理" };
    if (pendingFriendBetween(from, to)) return { ok: false, error: "已发送请求，等待对方同意" };
    const recent = s.friendRequests.filter(r => r.from === from && r.to === to && Date.now() - r.createdAt < 86400000).length;
    if (recent >= 3) return { ok: false, error: "申请过于频繁，请明天再试" };
    const req = {
      id: "fr" + Date.now().toString(36) + Math.random().toString(16).slice(2, 6),
      from, to,
      message: String(message || "").slice(0, 50),
      status: "pending",
      createdAt: Date.now()
    };
    s.friendRequests.unshift(req);
    saveSocial();
    if (!isNpcUser(to)) pushNotification(to, nameOf(from) + " 请求添加你为好友");
    scheduleNpcAccept(req);
    return { ok: true, request: req };
  }

  async function respondFriendRequest(id, accept, reason) {
    const s = loadSocial();
    const req = s.friendRequests.find(r => r.id === id);
    // 目标是 NPC 的申请只在本机流转（NPC 没有 Auth 账号，服务端无法替它同意）
    if (req && window.SDJCloud && window.SDJCloud.enabled() && !isNpcUser(req.from) && !isNpcUser(req.to)) {
      const rc = await window.SDJCloud.friendRespond(id, accept, reason);
      if (!rc.ok) return rc;
      await pullSocialCloud();
      if (accept) pushSystemMsg(convOfFriend(req.from, req.to), "你们已成为好友，开始对话吧");
      emitSocial();
      return { ok: true };
    }
    if (!req || req.status !== "pending") return { ok: false, error: "该申请已处理或不存在" };
    req.status = accept ? "accepted" : "rejected";
    req.handledAt = Date.now();
    req.reason = reason || "";
    if (accept) {
      addFriendPair(req.from, req.to);
      const cid = convOfFriend(req.from, req.to);
      pushSystemMsg(cid, "你们已成为好友，开始对话吧");
    }
    saveSocial();
    // NPC 好友关系写入服务端，其他设备登录后可看到同一位 NPC 好友
    if (accept && isNpcUser(req.to) && window.SDJCloud && window.SDJCloud.enabled()) {
      window.SDJCloud.npcFriendAdd(req.to).then(() => pullSocialCloud()).catch(() => {});
    }
    if (!isNpcUser(req.from)) {
      pushNotification(req.from, accept ? nameOf(req.to) + " 已同意你的好友申请" : nameOf(req.to) + " 拒绝了你的好友申请");
    }
    return { ok: true };
  }

  /* ---------------- 好友分组 ---------------- */
  function friendTags() { return loadSocial().friendTags.slice(); }
  function tagOf(username) { return loadSocial().friendTagOf[username] || SOCIAL_TAG_DEFAULT; }
  function addFriendTag(name) {
    const n = String(name || "").trim();
    if (!n) return { ok: false, error: "分组名称不能为空" };
    const s = loadSocial();
    if (s.friendTags.some(t => t.name === n)) return { ok: false, error: "已存在同名分组" };
    const tag = { id: "t" + Date.now().toString(36), name: n.slice(0, 12) };
    s.friendTags.push(tag);
    saveSocial();
    return { ok: true, tag };
  }
  function removeFriendTag(id) {
    if (id === SOCIAL_TAG_DEFAULT) return { ok: false, error: "默认分组不可删除" };
    const s = loadSocial();
    s.friendTags = s.friendTags.filter(t => t.id !== id);
    Object.keys(s.friendTagOf).forEach(u => { if (s.friendTagOf[u] === id) s.friendTagOf[u] = SOCIAL_TAG_DEFAULT; });
    saveSocial();
    return { ok: true };
  }
  function moveFriendToTag(username, tagId) {
    const s = loadSocial();
    if (!s.friendTags.some(t => t.id === tagId)) return { ok: false, error: "分组不存在" };
    if (!areFriends(currentSocialUser(), username)) return { ok: false, error: "只能移动自己的好友" };
    s.friendTagOf[username] = tagId;
    saveSocial();
    return { ok: true };
  }

  /* ---------------- 群聊 ---------------- */
  function allocGroupNo() {
    const s = loadSocial();
    const used = new Set((s.groups || []).map(g => String(g.no)));
    let n = s.groupsSeq || 100000001;
    while (used.has(String(n))) n++;
    s.groupsSeq = n + 1;
    return String(n);
  }

  function groupById(id) { return loadSocial().groups.find(g => g.id === id) || null; }
  function isGroupOwner(g, u) { return !!g && g.owner === u; }
  function isGroupAdmin(g, u) { return !!g && (g.owner === u || (g.admins || []).includes(u)); }

  // 权限矩阵：view / speak / invite / remove / approve / editName / editNotice / editIntro / policy / setAdmin / dissolve / quit
  function socialCan(action, g, u) {
    if (!g || !u) return false;
    const member = (g.members || []).includes(u);
    const owner = g.owner === u;
    const admin = (g.admins || []).includes(u);
    switch (action) {
      case "view": return member || g.searchable;
      case "speak": return member && g.status === "active";
      case "invite": return member && g.status === "active";
      case "remove": return owner || (admin && member);
      case "approve": return (owner || admin) && g.status === "active";
      case "editName":
      case "editNotice":
      case "editIntro": return member && (owner || admin) && g.status === "active";
      case "policy":
      case "setAdmin":
      case "dissolve": return owner && g.status === "active";
      case "quit": return member && !owner;
      default: return false;
    }
  }

  function pendingInvitesOf(gid) {
    return loadSocial().groupRequests.filter(r => r.groupId === gid && r.type === "invite" && r.status === "pending");
  }

  async function createGroup(owner, invited, name) {
    const list = Array.from(new Set((invited || []).filter(u => u && u !== owner)));
    if (list.length < 2) return { ok: false, error: "至少邀请 2 位好友才能创建群聊" };
    if (list.length > 50) return { ok: false, error: "单次最多邀请 50 人" };
    if (window.SDJCloud && window.SDJCloud.enabled()) {
      const r = await window.SDJCloud.groupCreate(name, list);
      if (!r.ok) return r;
      await pullSocialCloud();
      emitSocial();
      return { ok: true, group: groupById(r.groupId) || r.group };
    }
    const s = loadSocial();
    const g = {
      id: "g" + Date.now().toString(36) + Math.random().toString(16).slice(2, 5),
      no: allocGroupNo(),
      name: (name || (nameOf(owner) + "的群聊")).slice(0, 20),
      intro: "",
      notice: "",
      owner,
      admins: [],
      members: [owner],
      searchable: true,
      joinMode: "verify",
      status: "inviting",
      createdAt: Date.now(),
      activatedAt: 0
    };
    s.groups.unshift(g);
    list.forEach(u => {
      const req = {
        id: "gr" + Date.now().toString(36) + Math.random().toString(16).slice(2, 6),
        groupId: g.id, from: owner, to: u, type: "invite",
        message: "", status: "pending", createdAt: Date.now()
      };
      s.groupRequests.unshift(req);
      if (!isNpcUser(u)) pushNotification(u, nameOf(owner) + " 邀请你加入群聊「" + g.name + "」");
    });
    saveSocial();
    s.groupRequests.filter(r => r.groupId === g.id && r.status === "pending").forEach(r => scheduleNpcAccept(r));
    return { ok: true, group: g };
  }

  function activateGroup(g) {
    if (!g || g.status !== "inviting") return;
    g.status = "active";
    g.activatedAt = Date.now();
    pushSystemMsg(convOfGroup(g.id), "群聊「" + g.name + "」已成立，共 " + g.members.length + " 人");
    g.members.forEach(m => {
      if (!isNpcUser(m)) pushNotification(m, "群聊「" + g.name + "」已成立（" + g.members.length + " 人）");
    });
  }

  function checkGroupForming(g) {
    if (!g || g.status !== "inviting") return;
    if (g.members.length >= 3) { activateGroup(g); return; }
    if (pendingInvitesOf(g.id).length === 0) {
      g.status = "failed";
      if (!isNpcUser(g.owner)) pushNotification(g.owner, "群聊「" + g.name + "」创建失败：同意人数不足 3 人");
    }
  }

  function addGroupMember(g, username) {
    if (!g || g.members.includes(username)) return;
    g.members.push(username);
    pushSystemMsg(convOfGroup(g.id), nameOf(username) + " 加入了群聊");
    if (g.status === "inviting") checkGroupForming(g);
  }

  async function inviteToGroup(gid, byUser, targets) {
    if (window.SDJCloud && window.SDJCloud.enabled()) {
      const list = Array.from(new Set((targets || []).filter(Boolean)));
      if (!list.length) return { ok: false, error: "请选择要邀请的好友" };
      const r = await window.SDJCloud.groupInvite(gid, list);
      if (!r.ok) return r;
      await pullSocialCloud();
      emitSocial();
      return { ok: true };
    }
    const g = groupById(gid);
    if (!g) return { ok: false, error: "群聊不存在" };
    if (!socialCan("invite", g, byUser)) return { ok: false, error: "无权邀请成员" };
    const list = Array.from(new Set((targets || []).filter(u => u && !g.members.includes(u))));
    if (!list.length) return { ok: false, error: "请选择要邀请的好友" };
    if (g.members.length + list.length > GROUP_MAX_MEMBERS) return { ok: false, error: "群成员已满（上限 " + GROUP_MAX_MEMBERS + " 人）" };
    const s = loadSocial();
    list.forEach(u => {
      const dup = s.groupRequests.find(r => r.groupId === gid && r.from === byUser && r.to === u && r.type === "invite" && r.status === "pending");
      if (dup) return;
      const req = {
        id: "gr" + Date.now().toString(36) + Math.random().toString(16).slice(2, 6),
        groupId: gid, from: byUser, to: u, type: "invite",
        message: "", status: "pending", createdAt: Date.now()
      };
      s.groupRequests.unshift(req);
      if (!isNpcUser(u)) pushNotification(u, nameOf(byUser) + " 邀请你加入群聊「" + g.name + "」");
    });
    saveSocial();
    s.groupRequests.filter(r => r.groupId === gid && r.status === "pending").forEach(r => scheduleNpcAccept(r));
    return { ok: true };
  }

  async function applyToGroup(gid, user, message) {
    if (window.SDJCloud && window.SDJCloud.enabled()) {
      const r = await window.SDJCloud.groupApply(gid, message);
      if (!r.ok) return r;
      await pullSocialCloud();
      emitSocial();
      return { ok: true, direct: !!r.direct };
    }
    const g = groupById(gid);
    if (!g || g.status !== "active") return { ok: false, error: "该群聊不存在或已解散" };
    if (!g.searchable) return { ok: false, error: "未找到该群聊" };
    if (g.members.includes(user)) return { ok: false, error: "你已在该群聊中" };
    if (g.members.length >= GROUP_MAX_MEMBERS) return { ok: false, error: "群聊人数已满" };
    const s = loadSocial();
    if (s.groupRequests.find(r => r.groupId === gid && r.from === user && r.type === "apply" && r.status === "pending")) {
      return { ok: false, error: "已发送请求，等待对方群主/管理员同意" };
    }
    if (g.joinMode === "direct") {
      addGroupMember(g, user);
      saveSocial();
      if (!isNpcUser(g.owner)) pushNotification(g.owner, nameOf(user) + " 已直接加入群聊「" + g.name + "」");
      return { ok: true, direct: true };
    }
    const req = {
      id: "gr" + Date.now().toString(36) + Math.random().toString(16).slice(2, 6),
      groupId: gid, from: user, to: g.owner, type: "apply",
      message: String(message || "").slice(0, 50), status: "pending", createdAt: Date.now()
    };
    s.groupRequests.unshift(req);
    saveSocial();
    const approvers = [g.owner, ...(g.admins || [])];
    approvers.forEach(a => { if (!isNpcUser(a)) pushNotification(a, nameOf(user) + " 申请加入群聊「" + g.name + "」"); });
    return { ok: true, request: req };
  }

  async function respondGroupRequest(id, accept, byUser, reason) {
    if (window.SDJCloud && window.SDJCloud.enabled()) {
      const r = await window.SDJCloud.groupRespond(id, accept, reason);
      if (!r.ok) return r;
      await pullSocialCloud();
      emitSocial();
      return { ok: true };
    }
    const s = loadSocial();
    const req = s.groupRequests.find(r => r.id === id);
    if (!req || req.status !== "pending") return { ok: false, error: "该申请已处理或不存在" };
    const g = groupById(req.groupId);
    if (!g || g.status === "dissolved") return { ok: false, error: "群聊已解散" };
    if (req.type === "invite") {
      if (byUser !== req.to) return { ok: false, error: "无权处理该邀请" };
    } else if (!socialCan("approve", g, byUser)) {
      return { ok: false, error: "仅群主/管理员可审批入群申请" };
    }
    req.status = accept ? "accepted" : "rejected";
    req.handledBy = byUser;
    req.handledAt = Date.now();
    req.reason = reason || "";
    const joiner = req.type === "invite" ? req.to : req.from;
    if (accept) {
      if (g.members.length >= GROUP_MAX_MEMBERS) {
        req.status = "pending";
        return { ok: false, error: "群聊人数已满（上限 " + GROUP_MAX_MEMBERS + " 人）" };
      }
      addGroupMember(g, joiner);
    }
    saveSocial();
    if (req.type === "invite") {
      if (!isNpcUser(req.from)) {
        pushNotification(req.from, accept
          ? nameOf(req.to) + " 已接受邀请，加入群聊「" + g.name + "」"
          : nameOf(req.to) + " 拒绝加入群聊「" + g.name + "」");
      }
      checkGroupForming(g);
    } else if (!isNpcUser(req.from)) {
      pushNotification(req.from, accept
        ? "你已加入群聊「" + g.name + "」"
        : "你加入群聊「" + g.name + "」的申请被拒绝");
    }
    saveSocial();
    return { ok: true };
  }

  async function removeGroupMember(gid, byUser, target) {
    if (window.SDJCloud && window.SDJCloud.enabled()) {
      const r = await window.SDJCloud.groupRemoveMember(gid, target);
      if (!r.ok) return r;
      await pullSocialCloud();
      emitSocial();
      return { ok: true };
    }
    const g = groupById(gid);
    if (!g) return { ok: false, error: "群聊不存在" };
    if (!socialCan("remove", g, byUser)) return { ok: false, error: "无权移除成员" };
    if (target === g.owner) return { ok: false, error: "不能移除群主" };
    if (!g.members.includes(target)) return { ok: false, error: "该成员不在群内" };
    const owner = g.owner === byUser;
    const admin = (g.admins || []).includes(byUser);
    if (!owner && admin && (g.admins || []).includes(target)) return { ok: false, error: "管理员不能移除其他管理员" };
    g.members = g.members.filter(m => m !== target);
    g.admins = (g.admins || []).filter(a => a !== target);
    pushSystemMsg(convOfGroup(gid), nameOf(target) + " 已被移出群聊");
    if (!isNpcUser(target)) pushNotification(target, "你已被移出群聊「" + g.name + "」");
    saveSocial();
    return { ok: true };
  }

  async function quitGroup(gid, user) {
    if (window.SDJCloud && window.SDJCloud.enabled()) {
      const r = await window.SDJCloud.groupQuit(gid);
      if (!r.ok) return r;
      await pullSocialCloud();
      emitSocial();
      return { ok: true };
    }
    const g = groupById(gid);
    if (!g) return { ok: false, error: "群聊不存在" };
    if (!socialCan("quit", g, user)) return { ok: false, error: "群主不可退出，只能解散群聊" };
    g.members = g.members.filter(m => m !== user);
    g.admins = (g.admins || []).filter(a => a !== user);
    pushSystemMsg(convOfGroup(gid), nameOf(user) + " 退出了群聊");
    saveSocial();
    return { ok: true };
  }

  async function dissolveGroup(gid, byUser) {
    if (window.SDJCloud && window.SDJCloud.enabled()) {
      const r = await window.SDJCloud.groupDissolve(gid);
      if (!r.ok) return r;
      await pullSocialCloud();
      emitSocial();
      return { ok: true };
    }
    const g = groupById(gid);
    if (!g) return { ok: false, error: "群聊不存在" };
    if (!socialCan("dissolve", g, byUser)) return { ok: false, error: "仅群主可解散群聊" };
    g.status = "dissolved";
    g.dissolvedAt = Date.now();
    g.members.forEach(m => { if (!isNpcUser(m) && m !== byUser) pushNotification(m, "群聊「" + g.name + "」已被群主解散"); });
    loadSocial().groupRequests.forEach(r => { if (r.groupId === gid && r.status === "pending") r.status = "expired"; });
    saveSocial();
    return { ok: true };
  }

  async function setGroupAdmin(gid, byUser, target, on) {
    if (window.SDJCloud && window.SDJCloud.enabled()) {
      const r = await window.SDJCloud.groupAdmin(gid, target, on);
      if (!r.ok) return r;
      await pullSocialCloud();
      emitSocial();
      return { ok: true };
    }
    const g = groupById(gid);
    if (!g) return { ok: false, error: "群聊不存在" };
    if (!socialCan("setAdmin", g, byUser)) return { ok: false, error: "仅群主可任免管理员" };
    if (target === g.owner) return { ok: false, error: "群主无需设为管理员" };
    if (!g.members.includes(target)) return { ok: false, error: "该用户不在群内" };
    g.admins = g.admins || [];
    if (on) {
      if (g.admins.includes(target)) return { ok: false, error: "该成员已是管理员" };
      if (g.admins.length >= GROUP_MAX_ADMINS) return { ok: false, error: "管理员名额已满（最多 " + GROUP_MAX_ADMINS + " 名）" };
      g.admins.push(target);
      if (!isNpcUser(target)) pushNotification(target, "你已成为群聊「" + g.name + "」的管理员");
    } else {
      g.admins = g.admins.filter(a => a !== target);
      if (!isNpcUser(target)) pushNotification(target, "你已被取消群聊「" + g.name + "」的管理员");
    }
    saveSocial();
    return { ok: true };
  }

  async function updateGroup(gid, byUser, field, value) {
    if (window.SDJCloud && window.SDJCloud.enabled()) {
      const r = await window.SDJCloud.groupUpdate(gid, field, value);
      if (!r.ok) return r;
      await pullSocialCloud();
      emitSocial();
      return { ok: true };
    }
    const g = groupById(gid);
    if (!g) return { ok: false, error: "群聊不存在" };
    const map = { name: "editName", notice: "editNotice", intro: "editIntro" };
    const action = map[field];
    if (!action) return { ok: false, error: "不支持的字段" };
    if (!socialCan(action, g, byUser)) return { ok: false, error: "无权修改" };
    const text = String(value || "").trim();
    if (field === "name") {
      if (text.length < 2 || text.length > 20) return { ok: false, error: "群名称需为 2–20 字" };
      g.name = text;
    } else if (field === "notice") {
      if (text.length > 500) return { ok: false, error: "群公告最多 500 字" };
      g.notice = text;
      if (text) pushSystemMsg(convOfGroup(gid), "群公告已更新：" + text);
    } else {
      if (text.length > 300) return { ok: false, error: "群简介最多 300 字" };
      g.intro = text;
    }
    saveSocial();
    return { ok: true };
  }

  async function setGroupPolicy(gid, byUser, key, value) {
    if (window.SDJCloud && window.SDJCloud.enabled()) {
      const r = await window.SDJCloud.groupPolicy(gid, key, value);
      if (!r.ok) return r;
      await pullSocialCloud();
      emitSocial();
      return { ok: true };
    }
    const g = groupById(gid);
    if (!g) return { ok: false, error: "群聊不存在" };
    if (!socialCan("policy", g, byUser)) return { ok: false, error: "仅群主可修改群策略" };
    if (key === "joinMode") g.joinMode = value === "direct" ? "direct" : "verify";
    else if (key === "searchable") g.searchable = !!value;
    else return { ok: false, error: "不支持的设置项" };
    saveSocial();
    return { ok: true };
  }

  /* ---------------- 消息与会话 ---------------- */
  function convOfFriend(a, b) { return "f:" + pairKey(a, b); }
  function convOfGroup(gid) { return "g:" + gid; }

  function msgList(convId) { return (loadSocialMsgs()[convId] || []).slice(); }

  function pushMsg(convId, msg) {
    const all = loadSocialMsgs();
    const arr = all[convId] || (all[convId] = []);
    arr.push(msg);
    if (arr.length > MSG_LIMIT) all[convId] = arr.slice(arr.length - MSG_LIMIT);
    saveSocialMsgs();
  }

  function pushSystemMsg(convId, text) {
    pushMsg(convId, {
      id: "m" + Date.now().toString(36) + Math.random().toString(16).slice(2, 5),
      from: "system", text, at: Date.now(), type: "system"
    });
  }

  function sendChatMessage(convId, from, text) {
    const t = String(text == null ? "" : text).trim();
    if (!t) return { ok: false, error: "消息不能为空" };
    if (t.length > MSG_MAX_LEN) return { ok: false, error: "单条消息最多 " + MSG_MAX_LEN + " 字" };
    pushMsg(convId, {
      id: "m" + Date.now().toString(36) + Math.random().toString(16).slice(2, 5),
      from, text: t, at: Date.now(), type: "text"
    });
    touchPresence(from);
    saveSocial();
    // 聊天消息立即推服务端，不再等 1.5 秒防抖；失败时定时器仍会兜底
    if (window.SDJCloud && window.SDJCloud.enabled()) pushSocialCloudNow();
    return { ok: true };
  }

  function markRead(convId, username) {
    const s = loadSocial();
    s.reads[username] = s.reads[username] || {};
    s.reads[username][convId] = Date.now();
    saveSocial();
  }

  function unreadOf(convId, username) {
    const readAt = (loadSocial().reads[username] || {})[convId] || 0;
    return msgList(convId).filter(m => m.type !== "system" && m.from !== username && m.at > readAt).length;
  }

  function socTime(ts) {
    if (!ts) return "";
    const d = new Date(ts), now = new Date();
    const p = n => String(n).padStart(2, "0");
    if (d.toDateString() === now.toDateString()) return p(d.getHours()) + ":" + p(d.getMinutes());
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return "昨天";
    return (d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function socialInitial(name) {
    const ch = String(name || "").trim()[0] || "#";
    if (/[a-zA-Z]/.test(ch)) return ch.toUpperCase();
    if (/[\u4e00-\u9fa5]/.test(ch)) return PINYIN_INITIALS[ch] || "#";
    return "#";
  }

  function currentSocialUser() {
    const s = getSession();
    return s ? (s.username || s.displayName) : "";
  }

  /* ---------------- NPC 自动同意 / 超时扫描 ---------------- */
  function scheduleNpcAccept(req) {
    if (!req || !req.to || !isNpcUser(req.to) || req.npcQueued) return;
    req.npcQueued = true;
    saveSocial();
    const delay = 1200 + Math.round(Math.random() * 1800);
    setTimeout(() => {
      const s = reloadSocial();
      let live = null;
      if (req.type === "invite") live = s.groupRequests.find(r => r.id === req.id);
      else live = s.friendRequests.find(r => r.id === req.id);
      if (!live || live.status !== "pending") return;
      if (live.type === "invite") respondGroupRequest(live.id, true, live.to);
      else respondFriendRequest(live.id, true);
      emitSocial();
    }, delay);
  }

  function reviveNpcRequests() {
    const s = loadSocial();
    s.friendRequests.forEach(r => {
      if (r.status === "pending" && isNpcUser(r.to) && !r.npcQueued) scheduleNpcAccept(r);
    });
    s.groupRequests.forEach(r => {
      if (r.status === "pending" && r.type === "invite" && isNpcUser(r.to) && !r.npcQueued) scheduleNpcAccept(r);
    });
  }

  function sweepSocial() {
    const s = loadSocial();
    const now = Date.now();
    let changed = false;
    s.friendRequests.forEach(r => {
      if (r.status === "pending" && now - r.createdAt > FRIEND_TIMEOUT_MS) {
        r.status = "expired"; r.handledAt = now; changed = true;
      }
    });
    s.groupRequests.forEach(r => {
      if (r.status !== "pending") return;
      const limit = r.type === "invite" ? GROUP_INVITE_TIMEOUT_MS : GROUP_JOIN_TIMEOUT_MS;
      if (now - r.createdAt > limit) { r.status = "expired"; r.handledAt = now; changed = true; }
    });
    s.groups.forEach(g => {
      if (g.status !== "inviting") return;
      const before = g.status;
      checkGroupForming(g);
      if (g.status !== before) changed = true;
    });
    if (changed) { saveSocial(); saveSocialMsgs(); }
    return changed;
  }

  /* ---------------- 视图数据 ---------------- */
  function socialConversations(username, kind) {
    const s = loadSocial();
    const out = [];
    if (kind === "friend") {
      friendsOf(username).forEach(f => {
        const cid = convOfFriend(username, f);
        const list = msgList(cid);
        const last = list[list.length - 1];
        out.push({
          kind: "friend", id: f, convId: cid,
          name: nameOf(f), initial: socialInitial(nameOf(f)),
          last: last ? (last.type === "system" ? last.text : last.text) : "你们已成为好友，打个招呼吧",
          at: last ? last.at : (s.friendSince[pairKey(username, f)] || 0),
          unread: unreadOf(cid, username),
          online: isOnline(f)
        });
      });
    } else {
      s.groups.filter(g => (g.status === "active" && g.members.includes(username)) || (g.status === "inviting" && g.owner === username)).forEach(g => {
        const cid = convOfGroup(g.id);
        const list = msgList(cid);
        const last = list[list.length - 1];
        const accepted = Math.max(0, g.members.length - 1);
        out.push({
          kind: "group", id: g.id, convId: cid,
          name: g.name, initial: socialInitial(g.name),
          count: g.members.length,
          last: g.status === "inviting"
            ? ("组建中 · 已同意 " + accepted + " / " + (accepted + pendingInvitesOf(g.id).length) + " 人")
            : (last ? last.text : "群聊已成立"),
          at: last ? last.at : g.createdAt,
          unread: unreadOf(cid, username),
          forming: g.status === "inviting"
        });
      });
    }
    return out.sort((a, b) => (b.at || 0) - (a.at || 0));
  }

  function groupMembersOnline(g) {
    let online = 0;
    (g.members || []).forEach(m => { if (isOnline(m)) online++; });
    return { online, offline: g.members.length - online };
  }

  function contactGroupLists(username) {
    const all = loadSocial().groups.filter(g => g.status === "active");
    return {
      all: all.filter(g => g.members.includes(username) || g.admins.includes(username) || g.owner === username),
      created: all.filter(g => g.owner === username),
      managed: all.filter(g => (g.admins || []).includes(username) && g.owner !== username),
      joined: all.filter(g => g.members.includes(username) && g.owner !== username)
    };
  }

  function pendingFriendNotices(username) {
    return loadSocial().friendRequests.filter(r => r.to === username && r.status === "pending");
  }

  function pendingGroupNotices(username) {
    const s = loadSocial();
    return s.groupRequests.filter(r => {
      if (r.status !== "pending") return false;
      if (r.type === "invite") return r.to === username;
      const g = groupById(r.groupId);
      return g ? socialCan("approve", g, username) : false;
    });
  }

  /* ---------------- 渲染入口 ---------------- */
  function renderFriendPage(container, isAdmin) {
    const me = currentSocialUser();
    if (!me) { navigate("/login"); return; }

    // 进入社交模块时强制重读，避免其他标签页的变更停留在旧缓存
    reloadSocialMsgs();
    reloadSocial();
    ensureSocialProfiles();
    if (!socialCloudPulled && window.SDJCloud && window.SDJCloud.enabled()) {
      socialCloudPulled = true;
      syncNpcFriendsToCloud().then(() => pullSocialCloud()).then(changed => {
        if (changed && currentMenuId === "friend" && !socialInputBusy()) socialRerender();
      });
    }
    const s = loadSocial();
    if (!s.presence[me] || Date.now() - s.presence[me] > 30000) touchPresence(me);
    reviveNpcRequests();
    sweepSocial();

    const v = socialView;
    if (v.view === "chat") {
      const ok = v.conv && v.conv.kind === "group"
        ? !!groupById(v.conv.id) && (groupById(v.conv.id).members.includes(me))
        : v.conv && areFriends(me, v.conv.id);
      if (!ok) v.view = "messages";
    }
    if ((v.view === "groupInfo" || v.view === "groupManage") && !groupById(v.groupId)) v.view = "messages";
    if (v.view === "picker" && v.pickMode === "invite" && !groupById(v.groupId)) v.view = "contacts";

    bindSocialEvents(container);
    startSocialTick();

    const view = buildSocialView(me, isAdmin);
    pageShell(container, view);
    afterSocialRender(container, me);
    return container;
  }

  function buildSocialView(me, isAdmin) {
    const v = socialView;
    if (v.view === "chat") return buildChatView(me);
    if (v.view === "contacts") return buildContactsView(me);
    if (v.view === "notifications") return buildNotificationsView(me);
    if (v.view === "picker") return buildPickerView(me);
    if (v.view === "search") return buildSearchView(me);
    if (v.view === "groupInfo") return buildGroupInfoView(me);
    if (v.view === "groupManage") return buildGroupManageView(me);
    return buildMessagesView(me);
  }

  /* ---------------- 社交：视图构建 ---------------- */
  function buildEmpty(title, sub) {
    return `<div class="social-empty">
      <svg viewBox="0 0 120 120" class="social-empty-svg" aria-hidden="true">
        <circle cx="60" cy="60" r="46" fill="none" stroke="rgba(232,17,35,.35)" stroke-width="1.5" stroke-dasharray="4 8"/>
        <circle cx="60" cy="60" r="30" fill="none" stroke="rgba(232,17,35,.22)" stroke-width="1"/>
        <path d="M60 26 L60 94 M26 60 L94 60" stroke="rgba(232,17,35,.25)" stroke-width="1"/>
        <circle cx="60" cy="60" r="4" fill="#e81123"/>
      </svg>
      <div class="social-empty-title">${escHTML(title)}</div>
      <div class="social-empty-sub">${escHTML(sub)}</div>
    </div>`;
  }

  function buildMessagesView(me) {
    const v = socialView;
    const pending = socialPendingCount(me);
    const tools = `
      <div class="social-tools">
        <div class="social-search">
          <span class="social-search-icon">⌕</span>
          <input id="socialSearch" class="social-input-search" placeholder="搜索好友、群聊或消息" value="${escHTML(v.msgQuery || "")}">
          <button class="btn-sm search-go" data-sact="run-msg-search">查找</button>
        </div>
        <div class="social-plus-wrap">
          <button class="social-plus" data-sact="plus-toggle" id="socialPlus" title="更多">＋</button>
          <div class="social-plus-menu" id="socialPlusMenu">
            <button class="social-plus-item" data-sact="go-create">创建群聊</button>
            <button class="social-plus-item" data-sact="go-search">加好友/群聊</button>
            <button class="social-plus-item" data-sact="file-stub">传文件</button>
          </div>
        </div>
        <button class="btn-sm ghost social-contacts-btn" data-sact="go-contacts">通讯录${pending ? `<i class="social-dot"></i>` : ""}</button>
      </div>`;

    if ((v.msgApplied || "").trim()) {
      return { title: "密语", en: "MESSAGES", tools, body: buildSocialSearchResult(me, v.msgApplied.trim()) };
    }

    const items = socialConversations(me, v.tab);
    const body = `
      <div class="social-tabs">
        <button class="social-tab ${v.tab === "friend" ? "active" : ""}" data-sact="msg-tab" data-tab="friend">好友消息</button>
        <button class="social-tab ${v.tab === "group" ? "active" : ""}" data-sact="msg-tab" data-tab="group">群聊消息</button>
      </div>
      <div class="conv-list">
        ${items.length ? items.map(convRow).join("") : buildEmpty(
          v.tab === "friend" ? "暂无好友消息" : "暂无群聊消息",
          v.tab === "friend" ? "点击右上角 ＋ → 加好友/群聊，去认识第一位同路人" : "创建群聊后，群消息会出现在这里")}
      </div>`;
    return { title: "密语", en: "MESSAGES", tools, body };
  }

  function convRow(c) {
    return `<button class="conv-item" data-sact="conv" data-kind="${c.kind}" data-id="${escHTML(c.id)}">
      <span class="avatar conv-avatar ${c.kind === "group" ? "group" : ""}">${escHTML(c.initial)}</span>
      <span class="conv-main">
        <span class="conv-top">
          <span class="conv-name">${escHTML(c.name)}${c.kind === "group" ? "<em>（" + c.count + "）</em>" : ""}${c.forming ? '<i class="conv-forming">组建中</i>' : ""}</span>
          <span class="conv-time">${escHTML(socTime(c.at))}</span>
        </span>
        <span class="conv-bottom">
          <span class="conv-last">${escHTML(c.last)}</span>
          ${c.unread ? '<span class="conv-badge">' + (c.unread > 99 ? "99+" : c.unread) + "</span>" : ""}
        </span>
      </span>
    </button>`;
  }

  function buildSocialSearchResult(me, q) {
    const kw = q.toLowerCase();
    const friends = friendsOf(me).map(socialUser).filter(u => u.name.toLowerCase().includes(kw) || u.username.toLowerCase().includes(kw));
    const groups = contactGroupLists(me).all.filter(g => g.name.toLowerCase().includes(kw) || String(g.no).includes(kw));
    const convHits = [];
    friendsOf(me).forEach(f => {
      const cid = convOfFriend(me, f);
      if (msgList(cid).some(m => m.text.toLowerCase().includes(kw))) convHits.push({ kind: "friend", id: f, name: nameOf(f) });
    });
    socialConversations(me, "group").forEach(c => {
      if (msgList(c.convId).some(m => m.text.toLowerCase().includes(kw))) convHits.push({ kind: "group", id: c.id, name: c.name });
    });
    const sec = (title, rows) => rows.length ? `<div class="search-sec"><div class="search-sec-title">${title}</div>${rows.join("")}</div>` : "";
    return `
      <div class="search-note">全局搜索「${escHTML(q)}」 · 好友 ${friends.length} / 群聊 ${groups.length} / 会话 ${convHits.length}</div>
      ${sec("好友", friends.map(u => `<button class="person-row" data-sact="open-user" data-user="${escHTML(u.username)}">
          <span class="avatar">${escHTML(socialInitial(u.name))}</span>
          <span class="person-main"><span class="person-name">${escHTML(u.name)}</span><span class="person-sub">${roleLabelOf(u.role)} · ${escHTML(u.sign || "暂无签名")}</span></span>
          <span class="person-state">资料</span>
        </button>`))}
      ${sec("群聊", groups.map(g => `<button class="person-row" data-sact="view-group" data-gid="${escHTML(g.id)}">
          <span class="avatar group">${escHTML(socialInitial(g.name))}</span>
          <span class="person-main"><span class="person-name">${escHTML(g.name)}（${g.members.length}）</span><span class="person-sub">群号 ${escHTML(g.no)}</span></span>
          <span class="person-state">信息</span>
        </button>`))}
      ${sec("会话", convHits.map(c => `<button class="person-row" data-sact="conv" data-kind="${c.kind}" data-id="${escHTML(c.id)}">
          <span class="avatar">⌕</span>
          <span class="person-main"><span class="person-name">${escHTML(c.name)}</span><span class="person-sub">会话中包含该关键词</span></span>
          <span class="person-state">进入</span>
        </button>`))}
      ${!friends.length && !groups.length && !convHits.length ? buildEmpty("未找到匹配对象", "换个关键词，或去加好友/群聊") : ""}
    `;
  }

  function buildChatView(me) {
    const v = socialView;
    const isGroup = v.conv.kind === "group";
    const g = isGroup ? groupById(v.conv.id) : null;
    const other = isGroup ? "" : v.conv.id;
    const convId = isGroup ? convOfGroup(g.id) : convOfFriend(me, other);
    markRead(convId, me);
    const msgs = msgList(convId);
    const title = isGroup ? g.name : nameOf(other);
    const canSpeak = isGroup ? socialCan("speak", g, me) : true;
    const live = isGroup ? groupMembersOnline(g) : null;

    const header = `<div class="chat-top">
      <button class="chat-back" data-sact="back" title="返回">‹</button>
      <span class="avatar">${escHTML(socialInitial(title))}</span>
      <div class="chat-title-wrap">
        <div class="chat-title">${escHTML(title)}${isGroup ? "（<span data-chat-count>" + g.members.length + "</span>）" : ""}</div>
        <div class="chat-sub">
          ${isGroup
            ? '<span class="online-pill" data-online>在线人数：' + live.online + '</span><span class="offline-pill" data-offline>不在线人数：' + live.offline + "</span>"
            : '<span class="role-mini">' + roleLabelOf(socialUser(other).role) + '</span><span class="' + (isOnline(other) ? "online-pill" : "offline-pill") + '">' + (isOnline(other) ? "在线" : "不在线") + "</span>"}
        </div>
      </div>
      <button class="chat-burger" data-sact="${isGroup ? "view-group" : "open-user"}" data-gid="${isGroup ? g.id : ""}" data-user="${isGroup ? "" : escHTML(other)}" title="${isGroup ? "群聊信息" : "用户资料"}">≡</button>
    </div>`;

    const notice = isGroup && g.notice ? `<div class="chat-notice">群公告：${escHTML(g.notice)}</div>` : "";

    return {
      title: "密语", en: "MESSAGES",
      tools: `<span class="count-chip">${isGroup ? "群聊 · " + g.members.length + " 人" : "私聊"}</span>`,
      body: `<div class="social-chat">
        ${header}
        ${notice}
        <div class="chat-thread social-thread" id="socialThread">
          ${msgs.length ? msgs.map(m => chatMsgHtml(m, me)).join("") : `<div class="chat-tip">${isGroup ? "群聊已建立，说点什么吧" : "你们已成为好友，说点什么吧"}</div>`}
        </div>
        <div class="chat-compose">
          <textarea id="socialMsgInput" class="chat-textarea" maxlength="500" placeholder="${canSpeak ? "输入加密讯息…（Enter 发送 / Shift+Enter 换行）" : "群聊尚未成立，暂时无法发言"}">${escHTML(v.draft || "")}</textarea>
          <button class="btn-sm" data-sact="send" ${canSpeak ? "" : "disabled"}>发送</button>
        </div>
        ${canSpeak ? "" : '<div class="chat-lock">当前群聊组建中，全部受邀方同意后自动启用发言</div>'}
      </div>`
    };
  }

  // 消息归属只由「发送者 from」与「当前标签页查看者」比较得出，禁止依赖任何共享的全局身份状态
  function messageSide(msg, viewer) {
    if (!msg || msg.type === "system") return "system";
    return msg.from === viewer ? "me" : "them";
  }

  function chatMsgHtml(m, me) {
    const side = messageSide(m, me);
    if (side === "system") return `<div class="chat-sys">${escHTML(m.text)}</div>`;
    const mine = side === "me";
    const u = socialUser(m.from);
    const author = mine ? "" :
      '<span class="chat-author">' + escHTML(u.name) +
      '<i class="chat-author-role role-' + escHTML(u.role) + '">' + roleLabelOf(u.role) + "</i></span>";
    return `<div class="chat-msg ${side}">
      ${author}
      <div class="bubble">${escHTML(m.text)}</div>
      <span class="chat-time">${escHTML(socTime(m.at))}</span>
    </div>`;
  }

  function buildContactsView(me) {
    const v = socialView;
    const fPend = pendingFriendNotices(me).length;
    const gPend = pendingGroupNotices(me).length;
    const tab = v.contactsTab;
    let inner = "";
    if (tab === "tags") inner = buildTagsTab(me);
    else if (tab === "groups") inner = buildContactGroupsTab(me);
    else inner = buildFriendsTab(me);

    return {
      title: "通讯录", en: "CONTACTS",
      tools: `<button class="btn-sm ghost" data-sact="go-messages">返回密语</button>`,
      body: `
        <div class="contact-notice">
          <button class="notice-row" data-sact="notif" data-kind="friend">
            <span class="notice-icon">✦</span>
            <span class="notice-main"><b>好友申请通知</b><em>待处理 ${fPend} 条 · 含历史记录</em></span>
            ${fPend ? '<span class="conv-badge">' + fPend + "</span>" : ""}
            <span class="row-arrow">›</span>
          </button>
          <button class="notice-row" data-sact="notif" data-kind="group">
            <span class="notice-icon">✦</span>
            <span class="notice-main"><b>群聊申请通知</b><em>待处理 ${gPend} 条 · 含历史记录</em></span>
            ${gPend ? '<span class="conv-badge">' + gPend + "</span>" : ""}
            <span class="row-arrow">›</span>
          </button>
        </div>
        <div class="social-tabs contact-tabs">
          <button class="social-tab ${tab === "tags" ? "active" : ""}" data-sact="contact-tab" data-tab="tags">分组</button>
          <button class="social-tab ${tab === "friends" ? "active" : ""}" data-sact="contact-tab" data-tab="friends">好友</button>
          <button class="social-tab ${tab === "groups" ? "active" : ""}" data-sact="contact-tab" data-tab="groups">群聊</button>
        </div>
        <div class="contact-body">${inner}</div>`
    };
  }

  function buildFriendsTab(me) {
    const list = friendsOf(me).map(socialUser);
    if (!list.length) return buildEmpty("还没有好友", "点击右上角 ＋ → 加好友/群聊，去认识第一位同路人");
    const map = {};
    list.forEach(u => {
      const L = socialInitial(u.name);
      (map[L] = map[L] || []).push(u);
    });
    Object.keys(map).forEach(L => map[L].sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN")));
    const letters = Object.keys(map).sort((a, b) => a === "#" ? 1 : b === "#" ? -1 : a.localeCompare(b));
    const idx = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").concat("#");
    return `<div class="friend-az-wrap">
      <div class="friend-idx">
        ${idx.map(L => `<button class="idx-btn ${map[L] ? "has" : "dim"}" data-sact="jump" data-letter="${L}">${L}</button>`).join("")}
      </div>
      <div class="friend-az">
        ${letters.map(L => `<div class="az-group" id="az-${L}">
          <div class="az-head">${L}</div>
          ${map[L].map(u => `<button class="friend-card" data-sact="conv" data-kind="friend" data-id="${escHTML(u.username)}">
            <span class="avatar">${escHTML(socialInitial(u.name))}</span>
            <span class="friend-card-main">
              <span class="friend-card-name">${escHTML(u.name)}${u.npc ? '<i class="npc-chip">NPC</i>' : ""}</span>
              <span class="friend-card-sub">${roleLabelOf(u.role)} · ${escHTML(u.sign || "这位同路人还没有留下签名。")}</span>
            </span>
            <span class="friend-online ${isOnline(u.username) ? "on" : "off"}">${isOnline(u.username) ? "在线" : "不在线"}</span>
          </button>`).join("")}
        </div>`).join("")}
      </div>
    </div>`;
  }

  function buildTagsTab(me) {
    const tags = friendTags();
    const friends = friendsOf(me).map(socialUser);
    return `<div class="tag-tools">
      <button class="btn-sm" data-sact="add-tag">＋ 新建分组</button>
      <span class="tag-tip">拖动好友到分组标题可移动；移动端长按好友</span>
    </div>
    ${tags.map(t => {
      const members = friends.filter(u => tagOf(u.username) === t.id);
      return `<div class="tag-block" data-drop-tag="${t.id}">
        <div class="tag-head">
          <b>${escHTML(t.name)}</b>
          <span class="tag-count">${members.filter(u => isOnline(u.username)).length}/${members.length}</span>
          ${t.id === SOCIAL_TAG_DEFAULT ? "" : `<button class="tag-del" data-sact="del-tag" data-tag="${t.id}" title="删除分组">−</button>`}
        </div>
        <div class="tag-members">
          ${members.length ? members.map(u => `<div class="tag-member" data-drag-user="${escHTML(u.username)}">
            <span class="avatar">${escHTML(socialInitial(u.name))}</span>
            <span class="tag-member-name">${escHTML(u.name)}</span>
            <button class="tag-chat" data-sact="conv" data-kind="friend" data-id="${escHTML(u.username)}">聊天</button>
          </div>`).join("") : '<div class="tag-empty">该分组暂无好友</div>'}
        </div>
      </div>`;
    }).join("")}`;
  }

  function buildContactGroupsTab(me) {
    const v = socialView;
    const lists = contactGroupLists(me);
    const tabs = [
      { id: "all", label: "总群聊", n: lists.all.length },
      { id: "created", label: "我创建的", n: lists.created.length },
      { id: "managed", label: "我管理的", n: lists.managed.length },
      { id: "joined", label: "我加入的", n: lists.joined.length }
    ];
    const cur = lists[v.groupTab] || lists.all;
    return `<div class="group-filters">
      ${tabs.map(t => `<button class="group-filter ${v.groupTab === t.id ? "active" : ""}" data-sact="group-filter" data-tab="${t.id}">${t.label}<em>${t.n}</em></button>`).join("")}
    </div>
    <div class="group-cards">
      ${cur.length ? cur.map(g => {
        const role = g.owner === me ? "群主" : (g.admins || []).includes(me) ? "管理员" : "成员";
        return `<button class="group-card" data-sact="view-group" data-gid="${escHTML(g.id)}">
          <span class="avatar group">${escHTML(socialInitial(g.name))}</span>
          <span class="group-card-main">
            <span class="group-card-name">${escHTML(g.name)}（${g.members.length}）<i class="group-role ${role === "群主" ? "owner" : role === "管理员" ? "admin" : ""}">${role}</i></span>
            <span class="group-card-sub">群号 ${escHTML(g.no)} · ${g.searchable ? "允许被搜索" : "不允许被搜索"} · ${g.joinMode === "direct" ? "直接加入" : "需验证"}</span>
          </span>
          <span class="row-arrow">›</span>
        </button>`;
      }).join("") : buildEmpty("暂无群聊", "创建群聊后，可在这里按四类查看")}
    </div>`;
  }

  function buildNotificationsView(me) {
    const v = socialView;
    const kind = v.notifKind || "friend";
    const rows = kind === "friend" ? buildFriendNoticeRows(me) : buildGroupNoticeRows(me);
    return {
      title: "申请通知", en: "REQUESTS",
      tools: `<button class="btn-sm ghost" data-sact="go-contacts">返回通讯录</button>`,
      body: `<div class="social-tabs">
        <button class="social-tab ${kind === "friend" ? "active" : ""}" data-sact="notif" data-kind="friend">好友申请通知</button>
        <button class="social-tab ${kind === "group" ? "active" : ""}" data-sact="notif" data-kind="group">群聊申请通知</button>
      </div>
      <div class="notice-list">${rows}</div>`
    };
  }

  function buildFriendNoticeRows(me) {
    const s = loadSocial();
    const incoming = s.friendRequests.filter(r => r.to === me);
    const pending = incoming.filter(r => r.status === "pending");
    const history = incoming.filter(r => r.status !== "pending");
    const row = (r, isPending) => `<div class="notice-item">
      <span class="avatar">${escHTML(socialInitial(nameOf(r.from)))}</span>
      <div class="notice-body">
        <div class="notice-title">${escHTML(nameOf(r.from))}<span class="notice-time">${escHTML(socTime(r.createdAt))}</span></div>
        <div class="notice-msg">${r.message ? "附言：" + escHTML(r.message) : "想与你共谈密语"}</div>
        <div class="notice-status ${r.status}">${isPending ? "待处理" : socialStatusText(r)}</div>
      </div>
      ${isPending ? `<div class="notice-ops">
        <button class="btn-sm" data-sact="accept-fr" data-id="${r.id}">同意</button>
        <button class="btn-sm ghost" data-sact="reject-fr" data-id="${r.id}">拒绝</button>
      </div>` : ""}
    </div>`;
    return `<div class="notice-sec-title">待处理（${pending.length}）</div>
      ${pending.length ? pending.map(r => row(r, true)).join("") : '<div class="notice-empty">暂无待处理的好友申请</div>'}
      <div class="notice-sec-title">历史记录（${history.length}）</div>
      ${history.length ? history.map(r => row(r, false)).join("") : '<div class="notice-empty">暂无历史记录</div>'}`;
  }

  function buildGroupNoticeRows(me) {
    const s = loadSocial();
    const pending = pendingGroupNotices(me);
    const outgoing = s.groupRequests.filter(r => r.from === me && (r.type === "apply" || r.type === "invite"));
    const history = s.groupRequests.filter(r =>
      r.status !== "pending" && (r.to === me || r.from === me));
    const gName = id => { const g = groupById(id); return g ? g.name : "已解散群聊"; };
    const lineOf = r => {
      if (r.type === "invite") return r.to === me ? nameOf(r.from) + " 邀请你加入" : "你邀请 " + nameOf(r.to) + " 加入";
      return r.from === me ? "你申请加入" : "申请人：" + nameOf(r.from);
    };
    const row = (r, mode) => {
      const isApproval = mode === "approve";
      return `<div class="notice-item">
        <span class="avatar group">${escHTML(socialInitial(gName(r.groupId)))}</span>
        <div class="notice-body">
          <div class="notice-title">${escHTML(gName(r.groupId))}<span class="notice-time">${escHTML(socTime(r.createdAt))}</span></div>
          <div class="notice-msg">${escHTML(lineOf(r))}${r.message ? " · " + escHTML(r.message) : ""}</div>
          <div class="notice-status ${r.status}">${isApproval ? (r.type === "invite" ? "待你同意邀请" : "待审批") : socialStatusText(r, me)}</div>
        </div>
        ${isApproval ? `<div class="notice-ops">
          <button class="btn-sm" data-sact="accept-gr" data-id="${r.id}">同意</button>
          <button class="btn-sm ghost" data-sact="reject-gr" data-id="${r.id}">拒绝</button>
        </div>` : ""}
      </div>`;
    };
    return `<div class="notice-sec-title">待我审批 / 待我同意（${pending.length}）</div>
      ${pending.length ? pending.map(r => row(r, "approve")).join("") : '<div class="notice-empty">暂无待处理申请</div>'}
      <div class="notice-sec-title">我发出的申请与邀请（${outgoing.length}）</div>
      ${outgoing.length ? outgoing.map(r => row(r, "out")).join("") : '<div class="notice-empty">暂无发出的申请</div>'}
      <div class="notice-sec-title">历史记录（${history.length}）</div>
      ${history.length ? history.map(r => row(r, "out")).join("") : '<div class="notice-empty">暂无历史记录</div>'}`;
  }

  function socialStatusText(r, viewer) {
    if (r.status === "pending") return r.type === "invite" ? "等待对方同意" : "等待群主/管理员同意";
    if (r.status === "accepted") return (r.type === "invite" && viewer && r.from === viewer) ? "对方已同意" : "已通过";
    if (r.status === "rejected") return (r.type === "invite" && viewer && r.from === viewer) ? "对方已拒绝" : "已拒绝";
    if (r.status === "expired") return "已过期";
    return r.status;
  }

  function buildPickerView(me) {
    const v = socialView;
    const inviteMode = v.pickMode === "invite";
    const g = inviteMode ? groupById(v.groupId) : null;
    const all = friendsOf(me).filter(u => !g || !g.members.includes(u));
    const q = v.query.trim().toLowerCase();
    const list = all.map(socialUser).filter(u => !q || u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q));
    const min = inviteMode ? 1 : 2;
    return {
      title: inviteMode ? "邀请成员" : "创建群聊",
      en: inviteMode ? "INVITE" : "CREATE SQUAD",
      tools: `<button class="btn-sm ghost" data-sact="back">返回</button>`,
      body: `<div class="picker-head">
        <div class="picker-title">${inviteMode ? "邀请好友加入「" + escHTML(g.name) + "」" : "选择要邀请的好友"}</div>
        <div class="picker-count">已选 ${v.picked.length}</div>
      </div>
      <div class="social-search search-wide">
        <span class="social-search-icon">⌕</span>
        <input id="socialQueryInput" class="social-input-search" placeholder="搜索好友昵称" value="${escHTML(v.query)}">
      </div>
      <div class="picker-list">
        ${list.length ? list.map(u => `<button class="picker-row ${v.picked.includes(u.username) ? "on" : ""}" data-sact="pick-toggle" data-user="${escHTML(u.username)}">
          <span class="pick-box">${v.picked.includes(u.username) ? "✓" : ""}</span>
          <span class="avatar">${escHTML(socialInitial(u.name))}</span>
          <span class="picker-name">${escHTML(u.name)}${u.npc ? '<i class="npc-chip">NPC</i>' : ""}</span>
          <span class="picker-role">${roleLabelOf(u.role)}</span>
        </button>`).join("") : '<div class="notice-empty">没有可邀请的好友</div>'}
      </div>
      <div class="picker-foot">
        <button class="btn-sm" data-sact="picker-submit" ${v.picked.length < min ? "disabled" : ""}>${inviteMode ? "发送邀请" : "发起邀请"}</button>
        <span class="picker-hint">${inviteMode ? "对方同意后自动入群" : "至少邀请 2 位好友；全部同意后群聊成立（共 3 人）"}</span>
      </div>`
    };
  }

  function buildSearchView(me) {
    const v = socialView;
    const q = (v.applied || "").trim();
    const isPerson = v.searchTab === "person";
    let results = "";
    if (q) {
      if (isPerson) {
        const kw = q.toLowerCase();
        const list = socialDirectory().filter(u => u.username !== me &&
          (u.name.toLowerCase().includes(kw) || u.username.toLowerCase().includes(kw))).slice(0, 20);
        results = list.length ? list.map(u => {
          const friend = areFriends(me, u.username);
          const pend = pendingFriendBetween(me, u.username);
          const incoming = !friend && !pend && loadSocial().friendRequests
            .some(r => r.from === u.username && r.to === me && r.status === "pending");
          const online = isOnline(u.username);
          return `<div class="person-row search-person">
            <span class="avatar${u.avatar ? " has-photo" : ""}" ${u.avatar ? `style="background-image:url('${escHTML(u.avatar)}')"` : ""}>${u.avatar ? "" : escHTML(socialInitial(u.name))}</span>
            <span class="person-main">
              <span class="person-name">${escHTML(u.name)}${u.npc ? '<i class="npc-chip">NPC</i>' : ""}</span>
              <span class="person-sub">${roleLabelOf(u.role)} · ${escHTML(u.sign || "暂无签名")}</span>
              <span class="person-sub person-state-line">
                <i class="state-dot ${online ? "on" : "off"}"></i>${online ? "在线" : "离线"} ·
                <button class="link-btn" data-sact="open-user" data-user="${escHTML(u.username)}">查看资料</button>
              </span>
            </span>
            <span class="person-ops">
              ${friend
                ? '<button class="btn-sm ghost" data-sact="conv" data-kind="friend" data-id="' + escHTML(u.username) + '">发消息</button>'
                : pend
                  ? '<button class="btn-sm" disabled>已申请</button>'
                  : incoming
                    ? `<button class="btn-sm" data-sact="open-user" data-user="${escHTML(u.username)}">处理申请</button>`
                    : `<button class="btn-sm" data-sact="add-friend" data-user="${escHTML(u.username)}">申请添加好友</button>`}
            </span>
          </div>`;
        }).join("") : buildEmpty("未找到该用户", "可输入姓名的任意关键字（如「沙」「沙利」）后点击查找");
      } else {
        if (!/^\d{6,12}$/.test(q)) {
          results = buildEmpty("请输入数字群号", "群号为 6–12 位数字；仅允许被搜索的群可被找到");
        } else {
          const g = loadSocial().groups.find(x => String(x.no) === q && x.status === "active" && x.searchable);
          if (!g) {
            results = buildEmpty("未找到该群聊", "群号不存在，或该群未开启「允许被搜索」");
          } else {
            const member = g.members.includes(me);
            const pend = loadSocial().groupRequests.find(r => r.groupId === g.id && r.from === me && r.type === "apply" && r.status === "pending");
            results = `<div class="group-result panel-cut">
              <div class="group-result-head">
                <span class="avatar big group">${escHTML(socialInitial(g.name))}</span>
                <div class="group-result-meta">
                  <div class="group-result-name">${escHTML(g.name)}</div>
                  <div class="group-result-sub">群号 ${escHTML(g.no)} · ${g.members.length} 人 · 群主 ${escHTML(nameOf(g.owner))}</div>
                  <div class="group-result-tags">
                    <span class="mini-chip">${g.joinMode === "direct" ? "直接加入" : "需验证"}</span>
                    <span class="mini-chip">允许被搜索</span>
                  </div>
                </div>
              </div>
              <div class="group-result-intro">${escHTML(g.intro || "群主还没有填写群简介。")}</div>
              <div class="group-result-actions">
                ${member ? '<button class="btn-sm" disabled>已加入</button>'
                  : pend ? '<button class="btn-sm" disabled>已发送请求，等待对方群主/管理员同意</button>'
                  : `<button class="btn-sm" data-sact="apply-group" data-gid="${escHTML(g.id)}">${g.joinMode === "direct" ? "直接加入" : "申请加入"}</button>`}
              </div>
            </div>`;
          }
        }
      }
    } else {
      results = buildEmpty(isPerson ? "输入昵称找人" : "输入群号找群",
        isPerson ? "输入姓名中的任意关键字，点击「查找」后显示匹配成员" : "输入完整群号后点击「查找」");
    }

    return {
      title: "加好友/群聊", en: "ADD CONTACT",
      tools: `<button class="btn-sm ghost" data-sact="back">返回</button>`,
      body: `<div class="search-hero panel-cut">
        <div class="search-hero-title">${isPerson ? "找人" : "找群"}</div>
        <div class="search-hero-sub">${isPerson ? "输入用户昵称，点击查找后可查看资料并申请添加好友" : "输入数字群号，点击查找后显示允许被搜索的群聊"}</div>
        <div class="social-search search-wide">
          <span class="social-search-icon">⌕</span>
          <input id="socialQueryInput" class="social-input-search" enterkeyhint="search"
            placeholder="${isPerson ? "输入用户昵称（可只输入其中一两个字）" : "输入群号（6–12 位数字）"}" value="${escHTML(v.query)}">
          <button class="btn-sm search-go" data-sact="run-search">查找</button>
        </div>
        <div class="social-tabs search-tabs">
          <button class="social-tab ${isPerson ? "active" : ""}" data-sact="search-tab" data-tab="person">找人</button>
          <button class="social-tab ${!isPerson ? "active" : ""}" data-sact="search-tab" data-tab="group">找群</button>
        </div>
      </div>
      <div class="search-results">${results}</div>`
    };
  }

  function buildGroupInfoView(me) {
    const g = groupById(socialView.groupId);
    const live = groupMembersOnline(g);
    const removing = !!socialView.removing;
    const canEdit = socialCan("editName", g, me);
    const canInvite = socialCan("invite", g, me);
    const canRemove = socialCan("remove", g, me);
    const isOwner = g.owner === me;
    return {
      title: "群聊信息", en: "SQUAD INFO",
      tools: `<button class="btn-sm ghost" data-sact="conv" data-kind="group" data-id="${escHTML(g.id)}">进入群聊</button>`,
      body: `<div class="gi-head panel-cut">
        <span class="avatar big group">${escHTML(socialInitial(g.name))}</span>
        <div class="gi-head-main">
          <div class="gi-name">${escHTML(g.name)}（${g.members.length}）</div>
          <div class="gi-no">群号：${escHTML(g.no)} <button class="mini-copy" data-sact="copy-no" data-no="${escHTML(g.no)}">复制</button> · ${g.searchable ? "允许被搜索" : "不允许被搜索"}</div>
          <div class="gi-pills">
            <span class="online-pill" data-online>在线人数：${live.online}</span>
            <span class="offline-pill" data-offline>不在线人数：${live.offline}</span>
          </div>
        </div>
      </div>
      <div class="gi-block panel-cut">
        <div class="gi-block-title">群成员 <em>${g.members.length} 人</em>
          ${canInvite ? '<button class="gi-act" data-sact="invite-open" data-gid="' + g.id + '">＋</button>' : ""}
          ${canRemove ? '<button class="gi-act danger" data-sact="toggle-remove">' + (removing ? "完成" : "－") + "</button>" : ""}
        </div>
        <div class="gi-members">
          ${g.members.map(m => {
            const role = m === g.owner ? "群主" : (g.admins || []).includes(m) ? "管理员" : "";
            const canKick = removing && m !== g.owner && (isOwner || !(g.admins || []).includes(m));
            return `<div class="gi-member ${canKick ? "kickable" : ""}" ${canKick ? 'data-sact="remove-member" data-gid="' + g.id + '" data-user="' + escHTML(m) + '"' : ""}>
              <span class="avatar">${escHTML(socialInitial(nameOf(m)))}</span>
              <span class="gi-member-name">${escHTML(nameOf(m))}</span>
              ${role ? '<i class="gi-role ' + (role === "群主" ? "owner" : "admin") + '">' + role + "</i>" : ""}
              ${canKick ? '<i class="gi-kick">−</i>' : ""}
            </div>`;
          }).join("")}
        </div>
        ${removing ? '<div class="gi-tip">点击成员右侧「−」将其移出群聊</div>' : ""}
      </div>
      <div class="gi-block panel-cut">
        <button class="gi-row" data-sact="edit-field" data-field="name"><span>群名称</span><em>${escHTML(g.name)}</em><b>›</b></button>
        <button class="gi-row" data-sact="edit-field" data-field="notice"><span>群公告</span><em>${escHTML(g.notice || "未设置")}</em><b>›</b></button>
        <button class="gi-row" data-sact="manage-group" data-gid="${g.id}"><span>管理群</span><em>加群方式、搜索权限、管理员</em><b>›</b></button>
        <button class="gi-row" data-sact="edit-field" data-field="intro"><span>群资料</span><em>${escHTML(g.intro || "未设置")}</em><b>›</b></button>
      </div>
      <div class="gi-block panel-cut">
        <div class="gi-row static"><span>群内角色</span><em>${g.owner === me ? "群主" : (g.admins || []).includes(me) ? "管理员" : "成员"}</em></div>
        <div class="gi-row static"><span>加群方式</span><em>${g.joinMode === "direct" ? "直接加入" : "需验证"}</em></div>
        ${canEdit ? "" : '<div class="gi-tip">群名称 / 公告 / 简介仅群主与管理员可修改</div>'}
      </div>
      <div class="gi-danger">
        ${g.owner === me
          ? '<button class="btn-sm danger" data-sact="dissolve-group" data-gid="' + g.id + '">解散群聊</button>'
          : '<button class="btn-sm danger" data-sact="quit-group" data-gid="' + g.id + '">退出群聊</button>'}
        <button class="btn-sm ghost" data-sact="go-contacts">返回通讯录</button>
      </div>`
    };
  }

  function buildGroupManageView(me) {
    const g = groupById(socialView.groupId);
    const isOwner = g.owner === me;
    const admins = (g.admins || []).map(socialUser);
    const candidates = g.members.filter(m => m !== g.owner && !(g.admins || []).includes(m)).map(socialUser);
    return {
      title: "管理群", en: "MANAGE",
      tools: `<button class="btn-sm ghost" data-sact="view-group" data-gid="${escHTML(g.id)}">返回群信息</button>`,
      body: `<div class="gm-block panel-cut">
        <div class="gm-title">加群方式</div>
        <button class="gm-opt ${g.joinMode === "direct" ? "active" : ""}" data-sact="set-joinmode" data-mode="direct" ${isOwner ? "" : "disabled"}>
          <b>直接加入</b><em>通过群号搜索后可直接进入群聊</em>${g.joinMode === "direct" ? '<i class="gm-check">✓</i>' : ""}
        </button>
        <button class="gm-opt ${g.joinMode === "verify" ? "active" : ""}" data-sact="set-joinmode" data-mode="verify" ${isOwner ? "" : "disabled"}>
          <b>需向管理员发送验证消息</b><em>申请后由群主/管理员审批</em>${g.joinMode === "verify" ? '<i class="gm-check">✓</i>' : ""}
        </button>
      </div>
      <div class="gm-block panel-cut">
        <div class="gm-title">群搜索权限</div>
        <button class="gm-opt ${g.searchable ? "active" : ""}" data-sact="set-searchable" data-val="1" ${isOwner ? "" : "disabled"}>
          <b>允许被搜索</b><em>其他用户可通过群号检索并申请加入</em>${g.searchable ? '<i class="gm-check">✓</i>' : ""}
        </button>
        <button class="gm-opt ${!g.searchable ? "active" : ""}" data-sact="set-searchable" data-val="0" ${isOwner ? "" : "disabled"}>
          <b>不允许被搜索</b><em>搜索栏无法通过群号检索到本群</em>${!g.searchable ? '<i class="gm-check">✓</i>' : ""}
        </button>
        ${isOwner ? "" : '<div class="gm-tip">仅群主可修改群策略</div>'}
      </div>
      <div class="gm-block panel-cut">
        <div class="gm-title">管理员 <em>${admins.length} / ${GROUP_MAX_ADMINS}</em></div>
        <div class="gm-admin-list">
          <div class="gm-admin-row owner"><span class="avatar">${escHTML(socialInitial(nameOf(g.owner)))}</span><span class="gm-admin-name">${escHTML(nameOf(g.owner))}</span><i class="gi-role owner">群主</i></div>
          ${admins.map(u => `<div class="gm-admin-row">
            <span class="avatar">${escHTML(socialInitial(u.name))}</span>
            <span class="gm-admin-name">${escHTML(u.name)}</span>
            <i class="gi-role admin">管理员</i>
            ${isOwner ? '<button class="btn-sm ghost" data-sact="drop-admin" data-user="' + escHTML(u.username) + '">撤销</button>' : ""}
          </div>`).join("")}
        </div>
        ${isOwner ? `<div class="gm-candidates">
          <div class="gm-sub-title">可设为管理员的成员</div>
          ${candidates.length ? candidates.map(u => `<div class="gm-cand-row">
            <span class="avatar">${escHTML(socialInitial(u.name))}</span>
            <span class="gm-admin-name">${escHTML(u.name)}</span>
            <button class="btn-sm" data-sact="make-admin" data-user="${escHTML(u.username)}">设为管理员</button>
          </div>`).join("") : '<div class="notice-empty">暂无可任命的成员</div>'}
        </div>` : '<div class="gm-tip">仅群主可任免管理员（1 名群主 + 最多 5 名管理员）</div>'}
      </div>
      <div class="gm-tip wide">群内「管理员」是群聊专属角色，与系统全局「管理者」为两套独立权限体系。</div>`
    };
  }

  /* ---------------- 社交：交互事件 ---------------- */
  function bindSocialEvents(container) {
    container.onclick = onSocialClick;
    container.oninput = onSocialInput;
    container.onkeydown = onSocialKeydown;
    document.removeEventListener("sdj:social-change", onSocialExternal);
    document.addEventListener("sdj:social-change", onSocialExternal);
  }

  function stopSocial() {
    if (socialTick) { clearInterval(socialTick); socialTick = null; }
    if (socialSearchTimer) { clearTimeout(socialSearchTimer); socialSearchTimer = null; }
    if (socialCloudTimer) { clearTimeout(socialCloudTimer); socialCloudTimer = null; }
    socialCloudPulled = false;
    document.removeEventListener("sdj:social-change", onSocialExternal);
    const host = document.getElementById("mainContent");
    if (host) { host.onclick = null; host.oninput = null; host.onkeydown = null; }
  }

  function startSocialTick() {
    if (socialTick) return;
    socialTick = setInterval(() => {
      const me = currentSocialUser();
      if (!me) return;
      touchPresence(me);
      saveSocial();
      const changed = sweepSocial();
      if (changed) {
        if (socialInputBusy()) updateLiveCounts();
        else socialRerender(true);
        return;
      }
      updateLiveCounts();
      refreshSocialBadges();
    }, 15000);
  }

  function updateLiveCounts() {
    const v = socialView;
    let g = null;
    if (v.view === "chat" && v.conv && v.conv.kind === "group") g = groupById(v.conv.id);
    else if (v.view === "groupInfo" || v.view === "groupManage") g = groupById(v.groupId);
    if (!g) return;
    const live = groupMembersOnline(g);
    document.querySelectorAll("[data-online]").forEach(n => { n.textContent = "在线人数：" + live.online; });
    document.querySelectorAll("[data-offline]").forEach(n => { n.textContent = "不在线人数：" + live.offline; });
  }

  // 输入框正在编辑时不要整页重绘，否则搜索输入会被打断
  function socialInputBusy() {
    const host = document.getElementById("mainContent");
    const active = document.activeElement;
    if (!host || !active || !host.contains(active)) return false;
    return /^(INPUT|TEXTAREA)$/.test(active.tagName);
  }

  function socialRerender() {
    const host = document.getElementById("mainContent");
    if (!host) return;
    const active = document.activeElement;
    const activeId = active && active.id ? active.id : "";
    const start = active && active.selectionStart != null ? active.selectionStart : null;
    const end = active && active.selectionEnd != null ? active.selectionEnd : null;
    const draftEl = document.getElementById("socialMsgInput");
    if (draftEl) socialView.draft = draftEl.value;
    renderFriendPage(host, viewRole === "admin");
    if (activeId) {
      const node = document.getElementById(activeId);
      if (node) {
        try {
          node.focus();
          if (start != null && node.setSelectionRange) node.setSelectionRange(start, end != null ? end : start);
        } catch (e) { /* ignore */ }
      }
    }
    refreshSocialBadges();
  }

  // 只包含会影响界面结构/红点的数据，presence 变化不参与，避免 15 秒一次的无意义重绘
  function socialPendingCount(me) {
    if (!me) return 0;
    const s = loadSocial();
    const friendReq = (s.friendRequests || []).filter(r => r.to === me && r.status === "pending").length;
    const groupReq = pendingGroupNotices(me).length;
    const unreadMsg = socialConversations(me, "friend").reduce((n, c) => n + (c.unread ? 1 : 0), 0);
    return friendReq + groupReq + unreadMsg;
  }

  function refreshSocialBadges() {
    const badge = document.getElementById("socialMenuBadge");
    if (!badge) return;
    const n = socialPendingCount(currentSocialUser());
    badge.hidden = n <= 0;
    badge.textContent = n > 99 ? "99+" : String(n);
  }

  function socialUiFingerprint() {
    const me = currentSocialUser();
    if (!me) return "";
    const s = loadSocial();
    const friends = friendsOf(me).slice().sort().join(",");
    const fReq = (s.friendRequests || []).filter(r => r.to === me && r.status === "pending").length;
    const gReq = pendingGroupNotices(me).length;
    const unread = socialConversations(me, "friend").reduce((n, c) => n + (c.unread ? 1 : 0), 0);
    const groups = (s.groups || []).filter(g => (g.members || []).includes(me))
      .map(g => g.id + ":" + g.name + ":" + g.members.length + ":" + g.status).join(",");
    return [friends, fReq, gReq, unread, groups].join("|");
  }

  function onSocialExternal() {
    const me = currentSocialUser();
    const inChat = currentMenuId === "friend" && socialView.view === "chat";
    const convId = inChat ? currentConvId(me) : "";
    const prev = convId ? msgList(convId).length : 0;
    reloadSocialMsgs();
    reloadSocial();
    if (inChat && convId) {
      const list = msgList(convId);
      if (list.length > prev) {
        for (let i = prev; i < list.length; i++) appendChatNode(convId, list[i], me);
        markRead(convId, me);
        scrollThreadBottom();
      }
      // 聊天视图内保持连续，不整页重绘（避免闪烁）
      return;
    }
    refreshSocialBadges();
    if (currentMenuId === "friend" && !socialInputBusy()) socialRerender();
  }

  /* 未读好友消息横幅：不在好友模块时，收到消息后显示 10 秒 */
  let unreadBannerTimer = null;
  function maybeShowUnreadBanner() {
    const me = currentSocialUser();
    if (!me) return;
    const unreadConvs = socialConversations(me, "friend").filter(c => c.unread > 0).length;
    const pending = pendingFriendNotices(me).length + pendingGroupNotices(me).length;
    const count = unreadConvs + pending;
    if (count > 0) showUnreadBanner(count);
  }

  function showUnreadBanner(count) {
    const old = document.getElementById("socialUnreadBanner");
    if (old) old.remove();
    if (unreadBannerTimer) { clearTimeout(unreadBannerTimer); unreadBannerTimer = null; }

    const node = document.createElement("div");
    node.className = "social-unread-banner";
    node.id = "socialUnreadBanner";
    node.innerHTML = '<span class="ub-mark">!</span><span>【您有新的密语未查看】</span>' +
      (count > 1 ? "<em>" + count + " 项待处理</em>" : "");
    node.onclick = () => {
      node.remove();
      if (unreadBannerTimer) { clearTimeout(unreadBannerTimer); unreadBannerTimer = null; }
      socialView.view = "messages";
      socialView.tab = "friend";
      socialView.conv = null;
      socialView.query = "";
      pendingMenu = "friend";
      navigate("/app");
    };
    document.body.appendChild(node);
    requestAnimationFrame(() => node.classList.add("show"));
    unreadBannerTimer = setTimeout(() => {
      node.classList.remove("show");
      unreadBannerTimer = setTimeout(() => { node.remove(); unreadBannerTimer = null; }, 300);
    }, 10000);
  }

  function onSocialInput(e) {
    const t = e.target;
    if (t.id === "socialSearch") {
      // 只记录草稿，绝不在输入过程中重绘：重绘会打断中文输入法组合态
      socialView.msgQuery = t.value;
    } else if (t.id === "socialQueryInput") {
      socialView.query = t.value;
      if (socialView.view === "picker") filterPickerRows(t.value);
    } else if (t.id === "socialMsgInput") {
      socialView.draft = t.value;
    }
  }

  // 邀请成员列表：本地就地过滤，不重建 DOM
  function filterPickerRows(text) {
    const q = String(text || "").trim().toLowerCase();
    document.querySelectorAll("#mainContent .picker-row").forEach(row => {
      const name = (row.querySelector(".picker-name")?.textContent || "").toLowerCase();
      row.style.display = !q || name.includes(q) ? "" : "none";
    });
  }

  function runSocialSearch() {
    socialView.applied = String(socialView.query || "").trim();
    socialRerender();
  }

  function runMsgSearch() {
    socialView.msgApplied = String(socialView.msgQuery || "").trim();
    socialRerender();
  }

  function onSocialKeydown(e) {
    if (e.target.id === "socialSearch" && e.key === "Enter") {
      e.preventDefault();
      runMsgSearch();
      return;
    }
    if (e.target.id === "socialQueryInput" && e.key === "Enter") {
      e.preventDefault();
      runSocialSearch();
      return;
    }
    if (e.target.id === "socialSearch" && e.key === "Escape") {
      socialView.msgQuery = "";
      socialView.msgApplied = "";
      socialRerender();
      return;
    }
    if (e.target.id === "socialMsgInput" && e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      doSendMessage();
    }
  }

  function doSendMessage() {
    const me = currentSocialUser();
    const convId = currentConvId(me);
    if (!convId) return;
    const input = document.getElementById("socialMsgInput");
    const text = input ? input.value : "";
    const r = sendChatMessage(convId, me, text);
    if (!r.ok) { toast(r.error); return; }
    // 立即清空输入框，且不走整页重渲染，避免出现闪烁
    if (input) input.value = "";
    socialView.draft = "";
    const list = msgList(convId);
    const last = list[list.length - 1];
    if (last) {
      appendChatNode(convId, last, me);
      markRead(convId, me);
      scrollThreadBottom();
    }
  }

  // 增量追加一条消息节点（发送 / 接收共用），不重建整个聊天视图
  function appendChatNode(convId, msg, me) {
    const thread = document.getElementById("socialThread");
    if (!thread || !msg) return;
    const tip = thread.querySelector(".chat-tip");
    if (tip) tip.remove();
    const holder = document.createElement("div");
    holder.innerHTML = chatMsgHtml(msg, me);
    const node = holder.firstElementChild;
    if (node) thread.appendChild(node);
  }

  function scrollThreadBottom() {
    const thread = document.getElementById("socialThread");
    if (thread) thread.scrollTop = thread.scrollHeight;
  }

  function currentConvId(me) {
    const v = socialView;
    if (!v.conv) return "";
    return v.conv.kind === "group" ? convOfGroup(v.conv.id) : convOfFriend(me, v.conv.id);
  }

  function closePlusMenu() {
    const m = document.getElementById("socialPlusMenu");
    if (m) m.classList.remove("show");
  }

  async function onSocialClick(e) {
    const btn = e.target.closest("[data-sact]");
    if (!btn) { closePlusMenu(); return; }
    const act = btn.dataset.sact;
    const me = currentSocialUser();

    switch (act) {
      case "plus-toggle": {
        e.stopPropagation();
        const m = document.getElementById("socialPlusMenu");
        if (m) m.classList.toggle("show");
        return;
      }
      case "go-create":
        closePlusMenu();
        socialView.view = "picker"; socialView.pickMode = "create";
        socialView.groupId = null; socialView.picked = []; socialView.query = "";
        socialRerender();
        return;
      case "go-search":
        closePlusMenu();
        socialView.view = "search"; socialView.searchTab = "person";
        socialView.query = ""; socialView.applied = "";
        socialView.msgQuery = ""; socialView.msgApplied = "";
        socialRerender();
        return;
      case "file-stub":
        closePlusMenu();
        toast("文件传输暂未开放");
        return;
      case "go-contacts":
        socialView.view = "contacts"; socialView.query = ""; socialView.applied = "";
        socialView.msgQuery = ""; socialView.msgApplied = "";
        socialRerender();
        return;
      case "go-messages":
        socialView.view = "messages"; socialView.query = ""; socialView.applied = "";
        socialView.msgQuery = ""; socialView.msgApplied = "";
        socialRerender();
        return;
      case "msg-tab":
        socialView.tab = btn.dataset.tab; socialView.msgQuery = ""; socialView.msgApplied = "";
        socialRerender();
        return;
      case "contact-tab":
        socialView.contactsTab = btn.dataset.tab;
        socialRerender();
        return;
      case "group-filter":
        socialView.groupTab = btn.dataset.tab;
        socialRerender();
        return;
      case "notif":
        socialView.view = "notifications";
        socialView.notifKind = btn.dataset.kind;
        socialRerender();
        return;
      case "back": {
        if (socialView.view === "chat") { socialView.view = "messages"; socialView.conv = null; socialView.draft = ""; }
        else if (socialView.view === "picker") socialView.view = socialView.pickMode === "invite" ? "groupInfo" : "messages";
        else if (socialView.view === "search" || socialView.view === "notifications") socialView.view = "messages";
        else if (socialView.view === "groupManage") socialView.view = "groupInfo";
        else socialView.view = "messages";
        socialRerender();
        return;
      }
      case "conv": {
        const kind = btn.dataset.kind;
        const id = btn.dataset.id;
        if (kind === "group") {
          const g = groupById(id);
          if (!g || !g.members.includes(me)) { toast("你不在该群聊中"); return; }
        } else if (!areFriends(me, id)) {
          toast("你们还不是好友"); return;
        }
        socialView.view = "chat";
        socialView.conv = { kind, id };
        socialView.draft = "";
        socialRerender();
        return;
      }
      case "send":
        doSendMessage();
        return;
      case "jump": {
        const node = document.getElementById("az-" + btn.dataset.letter);
        if (node) node.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      case "open-user":
        openSocialUserCard(btn.dataset.user);
        return;
      case "view-group":
        socialView.view = "groupInfo";
        socialView.groupId = btn.dataset.gid;
        socialView.removing = false;
        socialRerender();
        return;
      case "manage-group":
        socialView.view = "groupManage";
        socialView.groupId = btn.dataset.gid;
        socialRerender();
        return;
      case "invite-open":
        socialView.view = "picker";
        socialView.pickMode = "invite";
        socialView.groupId = btn.dataset.gid;
        socialView.picked = [];
        socialView.query = "";
        socialRerender();
        return;
      case "toggle-remove":
        socialView.removing = !socialView.removing;
        socialRerender();
        return;
      case "pick-toggle": {
        const u = btn.dataset.user;
        const i = socialView.picked.indexOf(u);
        if (i >= 0) socialView.picked.splice(i, 1); else socialView.picked.push(u);
        socialRerender();
        return;
      }
      case "picker-submit": {
        if (socialView.pickMode === "invite") {
          const gid = socialView.groupId;
          const r = await inviteToGroup(gid, me, socialView.picked);
          if (!r.ok) { toast(r.error); return; }
          toast("邀请已发送，等待对方同意");
          socialView.view = "groupInfo";
          socialView.picked = [];
          emitSocial();
          return;
        }
        const r = await createGroup(me, socialView.picked, "");
        if (!r.ok) { toast(r.error); return; }
        toast("邀请已发送，全部同意后群聊成立");
        socialView.view = "messages";
        socialView.tab = "group";
        socialView.picked = [];
        emitSocial();
        return;
      }
      case "accept-fr": {
        const r = await respondFriendRequest(btn.dataset.id, true);
        if (!r.ok) { toast(r.error); return; }
        toast("已同意好友申请");
        emitSocial();
        return;
      }
      case "reject-fr": {
        const r = await respondFriendRequest(btn.dataset.id, false);
        if (!r.ok) { toast(r.error); return; }
        toast("已拒绝好友申请");
        emitSocial();
        return;
      }
      case "accept-gr": {
        const r = await respondGroupRequest(btn.dataset.id, true, me);
        if (!r.ok) { toast(r.error); return; }
        toast("已同意");
        emitSocial();
        return;
      }
      case "reject-gr": {
        const r = await respondGroupRequest(btn.dataset.id, false, me);
        if (!r.ok) { toast(r.error); return; }
        toast("已拒绝");
        emitSocial();
        return;
      }
      case "apply-group": {
        const gid = btn.dataset.gid;
        const g = groupById(gid);
        const r = await applyToGroup(gid, me, "");
        if (!r.ok) { toast(r.error); return; }
        toast(r.direct ? "已加入群聊" : "已发送请求，等待对方群主/管理员同意");
        if (r.direct && g) {
          socialView.view = "chat";
          socialView.conv = { kind: "group", id: gid };
        }
        emitSocial();
        return;
      }
      case "search-tab":
        socialView.searchTab = btn.dataset.tab;
        socialView.query = ""; socialView.applied = "";
        socialRerender();
        return;
      case "run-search":
        runSocialSearch();
        return;
      case "run-msg-search":
        runMsgSearch();
        return;
      case "add-friend": {
        const target = btn.dataset.user;
        if (!target) return;
        if (areFriends(me, target)) { toast("你们已经是好友了"); return; }
        btn.disabled = true;
        const r = await sendFriendRequest(me, target);
        if (!r.ok) { btn.disabled = false; toast(r.error); return; }
        btn.textContent = "已申请";
        toast("已发送好友申请，等待对方同意");
        emitSocial();
        return;
      }
      case "add-tag":
        openAddTagDialog();
        return;
      case "del-tag": {
        const r = removeFriendTag(btn.dataset.tag);
        if (!r.ok) { toast(r.error); return; }
        toast("分组已删除，好友已回到默认分组");
        emitSocial();
        return;
      }
      case "move-tag": {
        const r = moveFriendToTag(btn.dataset.user, btn.dataset.tag);
        closeSocialModal();
        if (!r.ok) { toast(r.error); return; }
        toast("已移动到分组");
        emitSocial();
        return;
      }
      case "remove-member": {
        const r = await removeGroupMember(btn.dataset.gid, me, btn.dataset.user);
        if (!r.ok) { toast(r.error); return; }
        toast("已移出群聊");
        emitSocial();
        return;
      }
      case "make-admin": {
        const r = await setGroupAdmin(socialView.groupId, me, btn.dataset.user, true);
        if (!r.ok) { toast(r.error); return; }
        toast("已设为管理员");
        emitSocial();
        return;
      }
      case "drop-admin": {
        const r = await setGroupAdmin(socialView.groupId, me, btn.dataset.user, false);
        if (!r.ok) { toast(r.error); return; }
        toast("已撤销管理员");
        emitSocial();
        return;
      }
      case "set-joinmode": {
        const r = await setGroupPolicy(socialView.groupId, me, "joinMode", btn.dataset.mode);
        if (!r.ok) { toast(r.error); return; }
        toast("加群方式已更新");
        emitSocial();
        return;
      }
      case "set-searchable": {
        const r = await setGroupPolicy(socialView.groupId, me, "searchable", btn.dataset.val === "1");
        if (!r.ok) { toast(r.error); return; }
        toast("群搜索权限已更新");
        emitSocial();
        return;
      }
      case "dissolve-group": {
        const r = await dissolveGroup(btn.dataset.gid, me);
        if (!r.ok) { toast(r.error); return; }
        toast("群聊已解散");
        socialView.view = "contacts";
        emitSocial();
        return;
      }
      case "quit-group": {
        const r = await quitGroup(btn.dataset.gid, me);
        if (!r.ok) { toast(r.error); return; }
        toast("已退出群聊");
        socialView.view = "contacts";
        emitSocial();
        return;
      }
      case "edit-field":
        openGroupFieldEditor(socialView.groupId, btn.dataset.field);
        return;
      case "copy-no": {
        const no = btn.dataset.no;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(no).then(() => toast("群号已复制"), () => toast("群号：" + no));
        } else toast("群号：" + no);
        return;
      }
      default:
        return;
    }
  }

  function afterSocialRender(container, me) {
    const thread = container.querySelector("#socialThread");
    if (thread) thread.scrollTop = thread.scrollHeight;

    container.querySelectorAll("[data-drag-user]").forEach(node => {
      node.setAttribute("draggable", "true");
      node.addEventListener("dragstart", (e) => {
        try {
          e.dataTransfer.setData("text/plain", node.dataset.dragUser);
          e.dataTransfer.effectAllowed = "move";
        } catch (err) { /* ignore */ }
      });
      let lp = null;
      node.addEventListener("pointerdown", () => {
        lp = setTimeout(() => {
          lp = null;
          openMoveTagDialog(node.dataset.dragUser);
        }, 600);
      });
      ["pointerup", "pointerleave", "pointercancel"].forEach(ev => node.addEventListener(ev, () => {
        if (lp) { clearTimeout(lp); lp = null; }
      }));
    });

    container.querySelectorAll("[data-drop-tag]").forEach(zone => {
      zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("drop-on"); });
      zone.addEventListener("dragleave", () => zone.classList.remove("drop-on"));
      zone.addEventListener("drop", (e) => {
        e.preventDefault();
        zone.classList.remove("drop-on");
        let user = "";
        try { user = e.dataTransfer.getData("text/plain"); } catch (err) { user = ""; }
        if (!user) return;
        const r = moveFriendToTag(user, zone.dataset.dropTag);
        if (!r.ok) { toast(r.error); return; }
        toast("已移动到分组");
        emitSocial();
      });
    });
  }

  /* ---------------- 社交：弹层 ---------------- */
  function openSocialModal(html, setup) {
    const overlay = el("div", { class: "modal-overlay social-overlay" });
    overlay.innerHTML = `<div class="modal-panel wide social-modal">${html}</div>`;
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    document.body.appendChild(overlay);
    // .modal-overlay 默认 opacity:0，必须加 show 类才会真正显示
    requestAnimationFrame(() => overlay.classList.add("show"));
    if (setup) setup(overlay);
    return overlay;
  }

  function closeSocialModal() {
    document.querySelectorAll(".modal-overlay.social-overlay").forEach(n => n.remove());
  }

  function openSocialUserCard(username) {
    const me = currentSocialUser();
    const u = socialUser(username);
    const friend = areFriends(me, username);
    const pend = pendingFriendBetween(me, username);
    const incoming = loadSocial().friendRequests.find(r => r.from === username && r.to === me && r.status === "pending");
    const online = isOnline(username);
    const avatarHtml = u.avatar
      ? `<span class="avatar big has-photo" style="background-image:url('${escHTML(u.avatar)}')"></span>`
      : `<span class="avatar big">${escHTML(socialInitial(u.name))}</span>`;
    const days = u.createdAt ? Math.max(0, Math.floor((Date.now() - new Date(u.createdAt).getTime()) / 86400000)) : null;
    const metaRow = (k, v) => v || v === 0 ? `<div class="profile-row"><span>${k}</span><em>${escHTML(String(v))}</em></div>` : "";
    const btnHtml = friend
      ? '<button class="btn-sm" data-x="chat">发消息</button><button class="btn-sm danger" data-x="del">删除好友</button>'
      : pend
        ? '<button class="btn-sm" disabled>已发送请求，等待对方同意</button>'
        : incoming
          ? '<button class="btn-sm" data-x="ok">同意好友申请</button>'
          : '<button class="btn-sm" data-x="add">申请添加好友</button><button class="btn-sm ghost" data-x="close">关闭</button>';
    openSocialModal(`<div class="modal-title">个人资料档案</div>
      <div class="profile-head">
        ${avatarHtml}
        <div class="profile-meta">
          <div class="profile-name">${escHTML(u.name)}${u.npc ? '<i class="npc-chip">NPC</i>' : ""}</div>
          <div class="profile-sub">
            <i class="state-dot ${online ? "on" : "off"}"></i>${online ? "在线" : "离线"} · ${roleLabelOf(u.role)} · 好友 ${friendsOf(username).length} 人
          </div>
        </div>
      </div>
      <div class="profile-table">
        ${metaRow("姓名", u.name)}
        ${metaRow("性别", u.gender || "未填写")}
        ${metaRow("年龄", u.age === "" ? "未填写" : u.age)}
        ${metaRow("注册时间", u.createdAt ? fmtTime(new Date(u.createdAt).getTime()) : "未知")}
        ${metaRow("已进入系统", days === null ? "未知" : days + " 天")}
        ${metaRow("所属身份", roleLabelOf(u.role))}
      </div>
      <div class="profile-sign">${escHTML(u.sign || "这位同路人还没有留下签名。")}</div>
      <div class="profile-actions" id="profileActions">${btnHtml}</div>`, (overlay) => {
      const box = overlay.querySelector("#profileActions");
      if (friend) {
        box.querySelector('[data-x="chat"]').onclick = () => {
          overlay.remove();
          socialView.view = "chat";
          socialView.conv = { kind: "friend", id: username };
          socialView.draft = "";
          socialRerender();
        };
        box.querySelector('[data-x="del"]').onclick = async () => {
          if (!confirm(`确认删除好友「${u.name}」？聊天记录会保留，但双方将不再出现在彼此的联系人中。`)) return;
          const r = await removeFriend(username);
          if (!r.ok) { toast(r.error); return; }
          overlay.remove();
          toast("已删除好友");
          emitSocial();
        };
      } else if (incoming) {
        box.querySelector('[data-x="ok"]').onclick = async () => {
          const r = await respondFriendRequest(incoming.id, true);
          overlay.remove();
          if (!r.ok) { toast(r.error); return; }
          toast("已同意好友申请");
          emitSocial();
        };
      } else if (!pend) {
        box.querySelector('[data-x="add"]').onclick = async () => {
          const btn = box.querySelector('[data-x="add"]');
          btn.disabled = true;
          const r = await sendFriendRequest(me, username);
          if (!r.ok) { btn.disabled = false; toast(r.error); return; }
          box.innerHTML = '<div class="request-waiting">已发送请求，正在等待对方同意…</div>' +
            '<button class="btn-sm ghost" data-x="close-wait">关闭</button>';
          box.querySelector('[data-x="close-wait"]').onclick = () => overlay.remove();
          toast("已发送请求，等待对方同意");
          emitSocial();
        };
        box.querySelector('[data-x="close"]').onclick = () => overlay.remove();
      }
    });
  }

  function openAddTagDialog() {
    openSocialModal(`<div class="modal-title">新建分组</div>
      <div class="field"><div class="field-label">分组名称</div><input class="comment-input" id="newTagName" maxlength="12" placeholder="例如：夜巡小队"></div>
      <div class="modal-actions"><button class="btn-sm" id="newTagOk">创建</button><button class="btn-sm ghost" id="newTagCancel">取消</button></div>`, (overlay) => {
      const input = overlay.querySelector("#newTagName");
      input.focus();
      overlay.querySelector("#newTagCancel").onclick = () => overlay.remove();
      overlay.querySelector("#newTagOk").onclick = () => {
        const r = addFriendTag(input.value);
        if (!r.ok) { toast(r.error); return; }
        overlay.remove();
        toast("分组已创建");
        emitSocial();
      };
    });
  }

  function openMoveTagDialog(username) {
    const tags = friendTags();
    openSocialModal(`<div class="modal-title">移动「${escHTML(nameOf(username))}」到分组</div>
      <div class="tag-pick-list">${tags.map(t => `<button class="tag-pick" data-sact="move-tag" data-user="${escHTML(username)}" data-tag="${t.id}">${escHTML(t.name)}</button>`).join("")}</div>
      <div class="modal-actions"><button class="btn-sm ghost" id="moveCancel">取消</button></div>`, (overlay) => {
      overlay.querySelector("#moveCancel").onclick = () => overlay.remove();
    });
  }

  function openGroupFieldEditor(gid, field) {
    const g = groupById(gid);
    if (!g) return;
    const conf = {
      name: { title: "编辑群名称", label: "2–20 字", value: g.name, multiline: false },
      notice: { title: "编辑群公告", label: "最多 500 字", value: g.notice, multiline: true },
      intro: { title: "编辑群简介", label: "最多 300 字", value: g.intro, multiline: true }
    }[field];
    if (!conf) return;
    openSocialModal(`<div class="modal-title">${conf.title}</div>
      <div class="field"><div class="field-label">${conf.label}</div>
        ${conf.multiline
          ? `<textarea class="editor-body" id="gfInput" maxlength="500">${escHTML(conf.value || "")}</textarea>`
          : `<input class="comment-input" id="gfInput" maxlength="20" value="${escHTML(conf.value || "")}">`}
      </div>
      <div class="modal-actions"><button class="btn-sm" id="gfOk">保存</button><button class="btn-sm ghost" id="gfCancel">取消</button></div>`, (overlay) => {
      const input = overlay.querySelector("#gfInput");
      input.focus();
      overlay.querySelector("#gfCancel").onclick = () => overlay.remove();
      overlay.querySelector("#gfOk").onclick = async () => {
        const btn = overlay.querySelector("#gfOk");
        btn.disabled = true;
        const r = await updateGroup(gid, currentSocialUser(), field, input.value);
        btn.disabled = false;
        if (!r.ok) { toast(r.error); return; }
        overlay.remove();
        toast("已保存");
        emitSocial();
      };
    });
  }

  window.SDJSocial = {
    load: () => loadSocial(),
    save: saveSocial,
    reload: () => { reloadSocial(); reloadSocialMsgs(); },
    can: socialCan,
    sweep: sweepSocial,
    createGroup: createGroup,
    inviteToGroup: inviteToGroup,
    applyToGroup: applyToGroup,
    respondFriendRequest: respondFriendRequest,
    respondGroupRequest: respondGroupRequest,
    removeGroupMember: removeGroupMember,
    setGroupAdmin: setGroupAdmin,
    setGroupPolicy: setGroupPolicy,
    updateGroup: updateGroup,
    dissolveGroup: dissolveGroup,
    quitGroup: quitGroup,
    sendFriendRequest: sendFriendRequest,
    removeFriend: removeFriend,
    sendMessage: sendChatMessage,
    moveFriendToTag: moveFriendToTag,
    addFriendTag: addFriendTag,
    removeFriendTag: removeFriendTag,
    groupById: groupById,
    groupLists: contactGroupLists,
    friendsOf: friendsOf,
    messages: () => loadSocialMsgs(),
    socialInitial: socialInitial,
    users: socialDirectory,
    side: messageSide,
    view: () => socialView,
    refresh: () => socialRerender(false)
  };

  // 供回归测试检查标签页会话隔离（sessionStorage 优先于 localStorage）
  window.SDJSession = {
    current: () => getSession(),
    tab: () => readTabSession(),
    set: (s) => setSession(s),
    clear: () => clearSession(),
    local: () => {
      try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; } catch (e) { return null; }
    }
  };

  /* ---------------- 议会（暂未开放，全身份统一占位） ---------------- */
  function renderCouncilPage(container, isAdmin) {
    pageShell(container, {
      title: isAdmin ? "议会管理" : "议会",
      en: isAdmin ? "COUNCIL MGMT" : "COUNCIL",
      tools: `<span class="count-chip">尚未开放</span>`,
      body: `<div class="placeholder-panel panel-cut">
        <div class="ph-mark">◈</div>
        <div class="ph-title">等待探索开启</div>
        <div class="ph-desc">议会系统尚未开放。随着主线探索推进，这里将解锁议题、投票与全服决议。</div>
      </div>`
    });
  }

  /* ---------------- 收集图鉴（暂未开放） ---------------- */
  function renderCodexPage(container) {
    pageShell(container, {
      title: "收集图鉴", en: "CODEX",
      tools: `<span class="count-chip">尚未开放</span>`,
      body: `<div class="placeholder-panel panel-cut">
        <div class="ph-mark">✦</div>
        <div class="ph-title">等待探索开启</div>
        <div class="ph-desc">收集图鉴尚未开放。随着探索推进，这里将记录你遇见的组织、异常与失落地点。</div>
      </div>`
    });
  }

  /* ---------------- 设置 ---------------- */
  function renderSettingsPage(container) {
    const s = loadState();
    const rows = [
      ["sound", "界面音效", "操作时的提示音与界面反馈音"],
      ["animation", "动效", "页面切换、地图标签的过渡动画"],
      ["autoLogin", "自动登录", "下次打开时沿用当前会话"]
    ];
    pageShell(container, {
      title: "设置", en: "SETTINGS",
      tools: `<span class="count-chip">v1.0.0 测试版</span>`,
      body: `
        <div class="settings-card panel-cut">
          ${rows.map(([key, name, desc]) => `
            <div class="setting-row">
              <div><div class="setting-name">${name}</div><div class="setting-desc">${desc}</div></div>
              <button class="switch ${s.settings[key] ? "on" : ""}" data-toggle="${key}"><span></span></button>
            </div>`).join("")}
        </div>
        <div class="settings-card panel-cut danger-zone">
          <div class="setting-row">
            <div><div class="setting-name">清除本地数据</div><div class="setting-desc">清空背包、委托、论坛、图鉴、好友与群聊的本地记录，账号会话保留。</div></div>
            <button class="btn-sm ghost" id="resetData">清除</button>
          </div>
        </div>`
    });
    container.querySelectorAll("[data-toggle]").forEach(btn => {
      btn.onclick = () => {
        const key = btn.dataset.toggle;
        s.settings[key] = !s.settings[key];
        saveState();
        btn.classList.toggle("on", s.settings[key]);
      };
    });
    container.querySelector("#resetData").onclick = () => {
      localStorage.removeItem(STATE_KEY);
      localStorage.removeItem(SOCIAL_KEY);
      localStorage.removeItem(SOCIAL_MSG_KEY);
      appState = null;
      reloadSocial();
      reloadSocialMsgs();
      renderSettingsPage(container);
      toast("本地数据已清除");
    };
  }

  /* ---------------- 成员管理（管理者） ---------------- */
  async function renderMemberPage(container) {
    // 进入时强制读最新状态，并把当前登录者的真实身份补进成员表
    reloadState();
    syncAccountMembers();
    const session = getSession();
    if (session && session.username) {
      ensureMemberRecord(session.username, session.displayName, session.role);
    }
    const s = loadState();
    const currentKey = session ? (session.username || session.displayName) : null;
    let rows = s.members.map(m => Object.assign({}, m, {
      current: !!currentKey && (m.username === currentKey || m.name === session.displayName)
    }));
    let isOwner = false;
    if (window.SDJCloud && window.SDJCloud.enabled()) {
      isOwner = !!(window.SDJCloud.isOwner && window.SDJCloud.isOwner());
      const profiles = await window.SDJCloud.listProfiles();
      memberCloudFp = profilesFingerprint(profiles);
      memberCloudAt = Date.now();
      if (profiles && profiles.length) {
        rows = profiles.map(p => {
          const local = (s.members || []).find(m => m.username === p.username) || {};
          return {
            id: p.id,
            username: p.username,
            name: p.display_name,
            role: roleLabelOf(p.role),
            roleRaw: p.role,
            banned: !!p.banned,
            owner: !!p.owner,
            status: p.banned ? "已移出" : "正常",
            lastSeen: local.lastSeen || "—",
            current: !!currentKey && p.username === currentKey
          };
        });
      }
    }
    // 最高管理者不能被处理；其他管理者只有最高管理者能处理
    const canAct = (row) => {
      if (row.current || row.owner) return false;
      if (row.roleRaw === "admin" && !isOwner) return false;
      return true;
    };
    pageShell(container, {
      title: "神降系统成员管理", en: "MEMBER MGMT",
      tools: `<span class="count-chip">${rows.length} 名成员</span>`,
      body: `
        <div class="broadcast panel-cut" id="memberBroadcastBar">
          <input class="input-line" id="broadcastInput" placeholder="向全服发送广播（最多 200 字，新广播会覆盖横幅）" maxlength="200">
          <select class="input-line" id="broadcastMinutes" style="max-width:170px">
            <option value="30">持续 30 分钟</option>
            <option value="60" selected>持续 1 小时</option>
            <option value="180">持续 3 小时</option>
            <option value="360">持续 6 小时</option>
            <option value="720">持续 12 小时</option>
            <option value="1440">持续 24 小时</option>
          </select>
          <button class="btn-sm" id="broadcastSend">发布广播</button>
        </div>
        <div class="member-table panel-cut">
          <div class="member-row head"><span>成员</span><span>身份</span><span>状态</span><span>最后活动</span><span>操作</span></div>
          ${rows.map(m => `
            <div class="member-row">
              <span class="member-name"><span class="avatar">${escHTML(String(m.name).slice(0, 1))}</span>${escHTML(m.name)}${m.current ? `<span class="role-chip">当前</span>` : ""}</span>
              <span>${escHTML(m.role)}</span>
              <span class="${(m.status === "受限" || m.status === "已移出") ? "state-warn" : "state-ok"}">${escHTML(m.status)}</span>
              <span class="muted">${escHTML(m.lastSeen)}</span>
              <span>${m.current
                ? `<span class="muted">—</span>`
                : (window.SDJCloud && window.SDJCloud.enabled()
                    ? (canAct(m)
                        ? `<button class="link-btn ${m.banned ? "" : "warn"}" data-ban="${escHTML(m.username)}" data-banned="${m.banned ? 1 : 0}">${m.banned ? "恢复访问" : "移出系统"}</button>`
                        : `<span class="muted">—</span>`)
                    : `<button class="link-btn" data-restrict="${m.id}">${m.status === "受限" ? "解除限制" : "限制访问"}</button>`)}</span>
            </div>`).join("")}
        </div>`
    });
    container.querySelectorAll("[data-restrict]").forEach(btn => {
      btn.onclick = () => {
        const m = s.members.find(x => x.id === btn.dataset.restrict);
        if (!m) { toast("当前账号不可在此调整"); return; }
        m.status = m.status === "受限" ? "正常" : "受限";
        pushSystemActivity(`管理者将成员「${m.name}」设为${m.status}`, "member");
        saveState(); renderMemberPage(container);
        toast(`已${m.status === "受限" ? "限制" : "解除限制"}：${m.name}`);
      };
    });

    // 云端模式：移出 / 恢复（真正落库，被移出者无法再登录）
    container.querySelectorAll("[data-ban]").forEach(btn => {
      btn.onclick = async () => {
        const username = btn.dataset.ban;
        const banned = btn.dataset.banned !== "1";
        const tip = banned
          ? `确认将「${username}」移出系统？之后该账号无法登录。`
          : `确认恢复「${username}」的访问权限？`;
        if (!confirm(tip)) return;
        btn.disabled = true;
        const r = await window.SDJCloud.banMember(username, banned, "");
        btn.disabled = false;
        if (!r.ok) { toast(r.error || "操作失败"); return; }
        await syncWorldFromCloud(true);
        renderMemberPage(container);
        toast(banned ? `已移出系统：${username}` : `已恢复访问：${username}`);
      };
    });
    container.querySelector("#broadcastSend").onclick = async () => {
      const input = container.querySelector("#broadcastInput");
      const sel = container.querySelector("#broadcastMinutes");
      const text = input.value.trim();
      if (!text) { toast("广播内容不能为空"); return; }
      const minutes = Number(sel && sel.value) || 60;
      const btn = container.querySelector("#broadcastSend");
      btn.disabled = true;
      try {
        const r = await publishBroadcastText(text, minutes);
        if (!r.ok) { toast(r.error || "广播发送失败"); return; }
        input.value = "";
        toast(`广播已发布，持续 ${minutes} 分钟`);
      } finally {
        btn.disabled = false;
      }
    };
    memberViewFingerprint = memberPageFingerprint();
  }

  /* ---------------- 待审批（管理者，三类独立流程） ---------------- */
  let approvalTab = "player";

  function fmtTime(ts) {
    if (!ts) return "—";
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function approvalStatusText(status) {
    return ({ approved: "已通过", rejected: "已驳回", expired: "已超时", completed: "已完成注册" })[status] || status;
  }

  function registerRoleLabel(role) {
    return role === "player" ? "玩家" : role === "contractor" ? "契约者" : "管理者";
  }

  function renderApprovalPage(container) {
    reloadState();
    sweepTimeouts(true);
    const s = loadState();
    const regs = s.registrationRequests || [];
    const reports = s.missionReports || [];
    const tabs = [["player", "玩家审批"], ["contractor", "契约者审批"], ["admin", "管理者审批"], ["report", "委托任务审批"]];
    const countOf = (key) => key === "report"
      ? reports.filter(r => r.status === "pending").length
      : regs.filter(r => r.role === key && r.status === "pending").length;

    let body = "";

    if (approvalTab === "report") {
      const pending = reports.filter(r => r.status === "pending");
      const history = reports.filter(r => r.status !== "pending");
      body = `
        <div class="approval-list">
          ${pending.length ? pending.map(r => {
            const mission = s.missions.find(x => x.id === r.missionId);
            const acceptors = (mission && mission.acceptors) || [];
            return `
            <div class="approval-card panel-cut">
              <div class="approval-head">
                <span class="avatar">${escHTML(String(r.applicant.name || "?").slice(0, 1))}</span>
                <div class="approval-meta">
                  <div class="approval-name">${escHTML(r.missionTitle)}<span class="role-chip">${escHTML(r.level)} 级</span></div>
                  <div class="approval-type">提交人：${escHTML(r.applicant.name)}（${escHTML(r.applicant.username)} · ${escHTML(r.applicant.role)}） · ${fmtTime(r.submittedAt)}</div>
                </div>
                <div class="approval-ops">
                  <button class="btn-sm" data-pass-report="${r.id}">确认完成</button>
                  <button class="btn-sm ghost" data-reject-report="${r.id}">驳回</button>
                </div>
              </div>
              <div class="approval-reason">
                地点：${escHTML(r.loc || "—")} · 奖励：${escHTML(r.reward || "—")} · 接取人数：${acceptors.length}
                ${r.desc ? `<br>要求：${escHTML(r.desc)}` : ""}
                ${r.content ? `<br>任务情况：${escHTML(r.content)}` : ""}
              </div>
              <input class="input-line" data-report-note="${r.id}" maxlength="60" placeholder="驳回原因（驳回时填写，会通知提交人）">
            </div>`;
          }).join("") : `<div class="empty-state">暂无待审批的委托完成申请</div>`}
        </div>
        ${history.length ? `
          <div class="module-sub">已处理记录</div>
          <div class="approval-history">
            ${history.map(r => `<div class="history-row"><span>${escHTML(r.missionTitle)}</span><span>${escHTML(r.applicant.name)} · ${fmtTime(r.submittedAt)}</span><span class="${r.status === "approved" ? "state-ok" : "state-warn"}">${approvalStatusText(r.status)}</span></div>`).join("")}
          </div>` : ""}
      `;
    } else {
      const roleName = registerRoleLabel(approvalTab);
      const pending = regs.filter(r => r.role === approvalTab && r.status === "pending");
      const history = regs.filter(r => r.role === approvalTab && r.status !== "pending");
      body = `
        <div class="approval-list">
          ${pending.length ? pending.map(r => `
            <div class="approval-card panel-cut">
              <div class="approval-head">
                <span class="avatar">${escHTML(String(r.displayName || "?").slice(0, 1))}</span>
                <div class="approval-meta">
                  <div class="approval-name">${escHTML(r.displayName)}<span class="role-chip">${roleName}</span></div>
                  <div class="approval-type">账号：${escHTML(r.username)} · 申请于 ${fmtTime(r.createdAt)}</div>
                </div>
                <div class="approval-ops">
                  <button class="btn-sm" data-pass-reg="${r.id}">同意</button>
                  <button class="btn-sm ghost" data-reject-reg="${r.id}">拒绝</button>
                </div>
              </div>
              <div class="approval-reason">申请人请求以「${roleName}」身份注册。同意后，对方注册页会实时显示「管理者已审批」，并可完成注册。</div>
              <input class="input-line" data-reg-note="${r.id}" maxlength="60" placeholder="拒绝原因（拒绝时填写，会通知申请人）">
            </div>`).join("") : `<div class="empty-state">暂无待审批的${roleName}注册申请</div>`}
        </div>
        ${history.length ? `
          <div class="module-sub">已处理记录</div>
          <div class="approval-history">
            ${history.map(r => `<div class="history-row"><span>${escHTML(r.displayName)}</span><span>${escHTML(r.username)} · ${fmtTime(r.createdAt)}</span><span class="${r.status === "approved" || r.status === "completed" ? "state-ok" : "state-warn"}">${approvalStatusText(r.status)}</span></div>`).join("")}
          </div>` : ""}
      `;
    }

    pageShell(container, {
      title: "待审批请求", en: "APPROVALS",
      tools: `<div class="tabs">${tabs.map(([k, label]) => `<button class="tab-btn ${k === approvalTab ? "active" : ""}" data-atab="${k}">${label} ${countOf(k)}</button>`).join("")}</div>`,
      body
    });

    // 切换分类
    container.querySelectorAll("[data-atab]").forEach(btn => {
      btn.onclick = () => { approvalTab = btn.dataset.atab; renderApprovalPage(container); };
    });

    // —— 注册审批：同意 ——
    container.querySelectorAll("[data-pass-reg]").forEach(btn => {
      btn.onclick = async () => {
        const r = (appState.registrationRequests || []).find(x => x.id === btn.dataset.passReg);
        if (!r) return;
        btn.disabled = true;
        r.status = "approved";
        r.reviewedAt = Date.now();
        r.note = "";
        pushNotification(r.username, "你的注册申请已通过管理者审批。");
        pushSystemActivity(`管理者通过了 ${r.displayName} 的${registerRoleLabel(r.role)}注册申请`, "approval");
        // 关键动作必须等云端确认结果，不能只依赖 800ms 防抖
        const ok = await persistRegistrationReview(r, "approved", "");
        renderApprovalPage(container);
        toast(ok
          ? `已同意 ${r.displayName} 的${registerRoleLabel(r.role)}注册申请`
          : "已同意，但云端写入失败：请检查网络后重试");
      };
    });

    // —— 注册审批：拒绝 ——
    container.querySelectorAll("[data-reject-reg]").forEach(btn => {
      btn.onclick = async () => {
        const r = (appState.registrationRequests || []).find(x => x.id === btn.dataset.rejectReg);
        if (!r) return;
        const noteEl = container.querySelector(`[data-reg-note="${r.id}"]`);
        const note = noteEl ? noteEl.value.trim() : "";
        btn.disabled = true;
        r.status = "rejected";
        r.reviewedAt = Date.now();
        r.note = note || "未填写原因";
        pushNotification(r.username, `你的注册申请被驳回：${r.note}`);
        pushSystemActivity(`管理者驳回了 ${r.displayName} 的注册申请：${r.note}`, "approval");
        const ok = await persistRegistrationReview(r, "rejected", r.note);
        renderApprovalPage(container);
        toast(ok
          ? `已拒绝 ${r.displayName} 的注册申请`
          : "已拒绝，但云端写入失败：请检查网络后重试");
      };
    });

    // —— 委托审批：确认完成 ——
    container.querySelectorAll("[data-pass-report]").forEach(btn => {
      btn.onclick = async () => {
        const r = (appState.missionReports || []).find(x => x.id === btn.dataset.passReport);
        if (!r) return;
        btn.disabled = true;
        if (window.SDJCloud && window.SDJCloud.enabled()) {
          const res = await window.SDJCloud.reviewMission(r.id, "approve", "");
          if (!res.ok) { toast(res.error || "结算失败"); btn.disabled = false; return; }
          await syncWorldFromCloud(true);
          renderApprovalPage(container);
          toast(`已确认完成：${r.missionTitle} · 奖励 ${res.granted || "已发放"}`);
          return;
        }
        const m = appState.missions.find(x => x.id === r.missionId);
        r.status = "approved";
        r.reviewedAt = Date.now();
        let granted = "未发放";
        if (m) granted = settleMissionReward(m, r);
        // 按接取人聚合：仍有他人待审批 → review；全员通过 → done
        recomputeMissionStatus(m);
        pushNotification(r.applicant && r.applicant.username,
          `委托「${r.missionTitle}」已完成结算，奖励：${granted || r.reward || "已发放"}`);
        pushActivity(r.applicant && r.applicant.username, `委托「${r.missionTitle}」审批通过，奖励：${granted || r.reward || "已发放"}`, "mission");
        pushSystemActivity(`管理者确认完成委托「${r.missionTitle}」`, "approval");
        const ok = await pushWorldNow();
        renderApprovalPage(container);
        toast(ok
          ? `已确认完成：${r.missionTitle} · 奖励已发放`
          : "已确认，但云端写入失败：请检查网络后重试");
      };
    });

    // —— 委托审批：驳回 ——
    container.querySelectorAll("[data-reject-report]").forEach(btn => {
      btn.onclick = async () => {
        const r = (appState.missionReports || []).find(x => x.id === btn.dataset.rejectReport);
        if (!r) return;
        const noteEl = container.querySelector(`[data-report-note="${r.id}"]`);
        const note = noteEl ? noteEl.value.trim() : "";
        if (window.SDJCloud && window.SDJCloud.enabled()) {
          const res = await window.SDJCloud.reviewMission(r.id, "reject", note);
          if (!res.ok) { toast(res.error || "驳回失败"); return; }
          await syncWorldFromCloud(true);
          renderApprovalPage(container);
          toast(`已驳回：${r.missionTitle}`);
          return;
        }
        const m = appState.missions.find(x => x.id === r.missionId);
        r.status = "rejected";
        r.reviewedAt = Date.now();
        r.note = note || "未填写原因";
        // 驳回只影响该接取人：其他人仍可提交/等待审批，状态按接取人聚合重算
        recomputeMissionStatus(m);
        pushNotification(r.applicant && r.applicant.username,
          `委托「${r.missionTitle}」的完成申请被驳回：${r.note}`);
        pushActivity(r.applicant && r.applicant.username, `委托「${r.missionTitle}」完成申请被驳回：${r.note}`, "mission");
        pushSystemActivity(`管理者驳回委托「${r.missionTitle}」：${r.note}`, "approval");
        const ok = await pushWorldNow();
        renderApprovalPage(container);
        toast(ok
          ? `已驳回：${r.missionTitle}`
          : "已驳回，但云端写入失败：请检查网络后重试");
      };
    });

    // 轮询兜底：storage 事件缺失或浏览器节流时，也能发现其他标签页提交的新申请
    stopApprovalPoll();
    const fp = approvalFingerprint();
    container._approvalFp = fp;
    approvalPollTimer = setInterval(() => {
      if (!container.isConnected || currentMenuId !== "approval") { stopApprovalPoll(); return; }
      reloadState();
      if (approvalFingerprint() !== container._approvalFp) renderApprovalPage(container);
    }, 2000);
  }

  /* ---------------- 地图 ↔ 委托联动 ---------------- */
  // 地图点位上的逐条接取：同一点位允许多个委托，必须按 mission id 精确操作
  async function acceptMissionById(missionId, btn) {
    const sess = getSession();
    if (!sess || sess.role === "admin") { toast("管理者不可接取委托"); return; }
    const m = (loadState().missions || []).find(x => x.id === missionId);
    if (!m) { toast("委托不存在"); return; }
    if (m.status !== "available") { toast("该委托当前不可接取"); return; }
    if (m.deadline && m.deadline.endsAt && Date.now() > m.deadline.endsAt) { toast("该委托已超过时限"); return; }
    m.acceptors = m.acceptors || [];
    if (m.acceptors.length >= (m.slots || 1)) { toast("该委托名额已满"); return; }
    const username = sess.username || sess.displayName;
    if (m.acceptors.some(a => a.username === username)) { toast("你已接取该委托"); return; }

    if (window.SDJCloud && window.SDJCloud.enabled()) {
      if (btn) btn.disabled = true;
      const r = await window.SDJCloud.acceptMission(m.id);
      if (!r.ok) {
        toast(r.error || "接取失败");
        if (btn) { btn.textContent = r.error || "接取失败"; btn.disabled = false; }
        return;
      }
      await syncWorldFromCloud(true);
      toast(`已接取委托：${m.title}（${r.count || 0}/${r.slots || m.slots || 1}${r.status === "active" ? " · 已满员" : " · 仍可接取"}）`);
    } else {
      m.acceptors.push({ username, name: sess.displayName, role: sess.role, at: Date.now() });
      const fullNow = m.acceptors.length >= (m.slots || 1);
      if (fullNow) m.status = "active";
      m.progress = 0;
      pushActivity(username, `接取委托「${m.title}」（${m.level} 级 · ${m.loc}）`, "mission");
      saveState();
      toast(`已接取委托：${m.title}（${m.acceptors.length}/${m.slots || 1}${fullNow ? " · 已满员" : " · 仍可接取"}）`);
    }
    if (globeEngine && typeof globeEngine.refreshMissions === "function") globeEngine.refreshMissions();
    const host = document.getElementById("mainContent");
    if (currentMenuId === "mission" && host) renderMissionPage(host, viewRole === "admin");
  }

  // 兼容旧调用：按地点 + 标题找到第一条可接取委托（回归测试与旧链接使用）
  async function acceptMissionByLocation(locName, taskTitle, btn) {
    const sess = getSession();
    if (!sess || sess.role === "admin") { toast("管理者不可接取委托"); return; }
    const m = (loadState().missions || []).find(x =>
      x.status === "available" &&
      (x.loc === locName || (taskTitle || "").includes(x.title)) &&
      (x.acceptors || []).length < (x.slots || 1) &&
      !(x.acceptors || []).some(a => a.username === (sess.username || sess.displayName))
    );
    if (!m) {
      toast("该地点暂无可接取委托");
      if (btn) { btn.textContent = "暂无可接取委托"; btn.disabled = true; }
      return;
    }
    return acceptMissionById(m.id, btn);
  }

  window.SDJ = { acceptMission: acceptMissionByLocation, acceptById: acceptMissionById };
  // 地图引擎通过这三个入口回写真实委托数据，不直接操作 DOM 或本地存储
  window.SDJMapActions = {
    accept: (missionId, btn) => acceptMissionById(missionId, btn),
    edit: (missionId) => openMissionEditor(missionId),
    view: (missionId) => openMissionDetail(missionId),
    create: (locationId, locationName) => openMissionEditor(null, { locationId, locationName })
  };

  // 帖子位置标记 → 打开地图并聚焦对应地点
  function goToPostLocation(postId) {
    const p = (loadState().forum || []).find(x => x.id === postId);
    if (!p || !p.location) { toast("该帖子没有位置标记"); return; }
    pendingMapLocation = p.location;
    pendingMenu = "map";
    navigate("/app");
  }

  function renderPlaceholderPage(container) {
    const configKey = viewRole === "admin" ? "admin" : "player";
    const menuItem = menuConfig[configKey].find(m => m.id === currentMenuId);
    const iconSvg = icons[currentMenuId] || icons.dashboard;
    container.innerHTML = `
      <div class="placeholder-page panel-cut">
        <div class="placeholder-icon">${iconSvg}</div>
        <div class="placeholder-title">${menuItem ? menuItem.cn : '未知模块'}</div>
        <div class="placeholder-sub">${menuItem ? menuItem.en : 'UNKNOWN MODULE'}</div>
        <div class="placeholder-desc">该模块正在由隐秘组织进行数据搭建...</div>
      </div>
    `;
  }

  if (!location.hash) history.replaceState(null, "", "#/login");
  migrateMissions();
  if ((loadState().rosterVersion || 0) < 2) normalizeRoster();
  sweepTimeouts(true);
  syncAccountMembers();
  render();

  const IS_CLOUD_BOOT = !!(window.SDJCloud && window.SDJCloud.enabled());
  const existingSession = getSession();
  showLoadingScreen({
    onComplete: () => {
      // 云端模式必须等 boot 校验会话后再决定去向，否则会话失效时会来回跳转
      if (!IS_CLOUD_BOOT && existingSession && getPath() === "/login") {
        navigate("/app");
      }
    }
  });

  // 云端模式：恢复 Supabase 登录态与全服数据（未配置时整段跳过）
  if (IS_CLOUD_BOOT) {
    window.SDJCloud.boot().then(async res => {
      if (res && res.noSession) {
        // 页面里还记着身份，但云端会话已经失效：继续留在主界面会让所有写入静默失败
        if (existingSession) {
          clearSession();
          if (getPath() !== "/login") {
            toast("云端登录已过期，请重新登录");
            setTimeout(() => navigate("/login"), 900);
          }
        }
        return;
      }
      if (res && res.error) {
        toast("云端连接异常：" + res.error);
        return;
      }
      if (!res || !res.profile) return;
      const p = res.profile;
      if (p.banned) {
        clearSession();
        if (getPath() !== "/login") {
          toast("该账号已被移出系统，无法继续使用");
          setTimeout(() => navigate("/login"), 900);
        }
        return;
      }
      setSession({ role: p.role, displayName: p.display_name, username: p.username, ts: Date.now(), auto: true });
      if (res.world) {
        appState = applyCloudWorld(res.world, defaultState());
      }
      // 没有 world 行时也必须有一份可写的本地状态，否则下一步写论坛会空引用
      if (!appState) appState = loadState();
      // 论坛走独立表，优先用表数据覆盖
      try {
        const forumRows = await window.SDJCloud.listForum();
        if (forumRows) {
          appState.forum = mergeLiked(forumRows, appState.forum);
          // 必须写回本地：否则进入审批/成员页时 reloadState() 会把仅存在于内存的云端帖子丢掉，
          // 表现为「刷新后看不到帖子，直到有人再发一条」。
          try { localStorage.setItem(STATE_KEY, JSON.stringify(appState)); } catch (e) { /* ignore */ }
        }
      } catch (e) { console.warn("[云端] 初始化论坛失败：", e); }

      // 无论当前停在主界面还是论坛详情/发帖页，都必须用刚拉到的全服数据重绘一次
      if (getPath() === "/login") navigate("/app");
      else render();
    }).catch(err => console.warn("[云端] 启动失败：", err));
  }
})();
