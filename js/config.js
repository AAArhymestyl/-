/* 神降计划·塔 · 部署配置
 *
 * supabaseUrl / supabaseAnonKey 留空 → 纯本地模式（数据只存在浏览器里，适合单机调试）
 * 填入后 → 自动启用云端账号与全服数据同步（需先在 Supabase 执行 supabase/schema.sql）
 *
 * anon key 是公开密钥，安全由数据库 RLS 策略保证，不要在这里放 service_role key。
 */
window.SDJ_CONFIG = {
  supabaseUrl: "",
  supabaseAnonKey: "",

  // 公开部署安全开关：关闭管理者自助注册，避免邀请码随公开仓库泄露后被提权
  // 仅本地/私有部署需要自助注册管理员时，才改为 true 并填写只有自己知道的邀请码
  allowAdminRegister: false,
  adminInvite: "",

  // 委托等级配色：地图标记、侧边栏、任务列表共用同一份定义
  missionLevels: {
    A: { color: "#ff2b2b", label: "A 级 · 紧急", ripple: true },
    B: { color: "#ff8a00", label: "B 级 · 高危", ripple: false },
    C: { color: "#ffd166", label: "C 级 · 常规", ripple: false },
    D: { color: "#7fd1ff", label: "D 级 · 低危", ripple: false }
  }
};
