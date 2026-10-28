/* 神降计划·塔 · 注册/委托审批回归测试
 *
 * 用法：以管理员身份登录后，在浏览器控制台粘贴本文件内容，然后执行
 *      await SDJApprovalTest.run()
 * 输出：每个用例的 PASS/FAIL 与诊断信息；不会删除真实数据（只插入 test_ 前缀记录）。
 */
(function () {
  const STORE = "sdj_state_v1";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const read = () => JSON.parse(localStorage.getItem(STORE) || "{}");
  const write = (s) => localStorage.setItem(STORE, JSON.stringify(s));
  const results = [];
  const record = (name, pass, detail) => results.push({ name, pass: !!pass, detail: pass ? "" : (detail || "") });

  function ensureAdmin() {
    const sess = JSON.parse(localStorage.getItem("sdj_session") || "null");
    return sess && sess.role === "admin";
  }

  function pushReq(req) {
    const s = read();
    s.registrationRequests = s.registrationRequests || [];
    s.registrationRequests.unshift(req);
    write(s);
  }

  async function openApproval(tab) {
    const menu = document.querySelector('.menu-item[data-id="approval"]');
    if (!menu) {
      record("前置：管理员审批菜单存在", false, "当前会话可能不是管理员权限");
      return false;
    }
    menu.click();
    await sleep(1100);
    if (tab) {
      const btn = [...document.querySelectorAll("[data-atab]")].find(b => b.dataset.atab === tab);
      btn?.click();
      await sleep(600);
    }
    return true;
  }

  async function run() {
    results.length = 0;
    if (!ensureAdmin()) {
      return [{ name: "前置：管理员登录", pass: false, detail: "请先以管理员身份登录后重跑" }];
    }

    /* 用例 1：玩家注册申请出现在「玩家审批」并可通过 */
    const regId = "test_reg_" + Date.now();
    const uname = "test_user_" + Date.now();
    pushReq({ id: regId, username: uname, displayName: "回归玩家", role: "player", salt: "s", hash: "h", status: "pending", createdAt: Date.now(), note: "" });
    await openApproval("player");
    const passBtn = document.querySelector(`[data-pass-reg="${regId}"]`);
    record("C1 玩家申请进入玩家审批列表", !!passBtn, "未找到同意按钮");
    passBtn?.click();
    await sleep(500);
    const after = read().registrationRequests.find(r => r.id === regId);
    record("C2 同意后申请状态变为 approved", after && after.status === "approved", after ? after.status : "记录丢失");

    /* 用例 3：真实提交路径（注册页按钮）会触发管理员通告 */
    const nUser = "tn" + String(Date.now()).slice(-8);
    location.hash = "#/register";
    await sleep(900);
    const nInputs = [...document.querySelectorAll(".panel-inner input")];
    ["0", "回归通知", "abc12345", "abc12345"].forEach((v, i) => {
      if (nInputs[i]) {
        nInputs[i].value = i === 0 ? nUser : v;
        nInputs[i].dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    document.getElementById("regReqBtn")?.click();
    await sleep(1000);
    const notified = (read().notifications || []).some(n => String(n.text).includes("回归通知"));
    record("C3 真实提交会通知管理员", notified, notified ? "" : "notifications 中无对应文案");
    location.hash = "#/app";
    await sleep(900);

    /* 用例 2：契约者申请进入独立列表，并支持带原因拒绝 */
    const cId = "test_reg_c_" + Date.now();
    pushReq({ id: cId, username: "test_c_" + Date.now(), displayName: "回归契约者", role: "contractor", salt: "s", hash: "h", status: "pending", createdAt: Date.now(), note: "" });
    await openApproval("contractor");
    const cBtn = document.querySelector(`[data-reject-reg="${cId}"]`);
    record("C4 契约者申请进入契约者审批列表", !!cBtn, "未找到拒绝按钮");
    const noteInput = document.querySelector(`[data-reg-note="${cId}"]`);
    if (noteInput) noteInput.value = "回归测试：资料不足";
    cBtn?.click();
    await sleep(500);
    const cAfter = read().registrationRequests.find(r => r.id === cId);
    record("C5 拒绝写入原因", cAfter && cAfter.status === "rejected" && /资料不足/.test(cAfter.note), cAfter ? cAfter.status + "/" + cAfter.note : "记录丢失");

    /* 用例 3：委托完成申请进入「委托任务审批」 */
    const rId = "test_rep_" + Date.now();
    const s2 = read();
    s2.missionReports = s2.missionReports || [];
    s2.missionReports.unshift({
      id: rId, missionId: "m1", missionTitle: "回归委托", level: "C", loc: "A区",
      reward: "契约点 +80", desc: "回归测试用", applicant: { username: "test_user", name: "回归玩家", role: "player" },
      submittedAt: Date.now(), status: "pending", note: ""
    });
    write(s2);
    await openApproval("report");
    const repBtn = document.querySelector(`[data-pass-report="${rId}"]`);
    record("C6 完成申请进入委托任务审批", !!repBtn, "未找到确认完成按钮");
    repBtn?.click();
    await sleep(500);
    const repAfter = read().missionReports.find(r => r.id === rId);
    record("C7 确认完成后报告状态 approved", repAfter && repAfter.status === "approved", repAfter ? repAfter.status : "记录丢失");

    /* 用例 4：超时申请自动失效 */
    const tId = "test_reg_t_" + Date.now();
    pushReq({ id: tId, username: "test_t_" + Date.now(), displayName: "超时回归", role: "player", salt: "s", hash: "h", status: "pending", createdAt: Date.now() - 25 * 3600 * 1000, note: "" });
    await openApproval("player");
    const tAfter = read().registrationRequests.find(r => r.id === tId);
    record("C8 超过 24 小时的申请自动 expired", tAfter && tAfter.status === "expired", tAfter ? tAfter.status : "记录丢失");

    /* 清理本次用例产生的数据，避免污染真实审批队列 */
    const sEnd = read();
    sEnd.registrationRequests = (sEnd.registrationRequests || []).filter(r => r.id !== regId && r.id !== cId && r.id !== tId && r.username !== nUser);
    sEnd.missionReports = (sEnd.missionReports || []).filter(r => r.id !== rId);
    write(sEnd);

    return results;
  }

  window.SDJApprovalTest = { run };
})();
