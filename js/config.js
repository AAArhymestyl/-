/* 神降计划·塔 · 部署配置
 *
 * supabaseUrl / supabaseAnonKey 留空 → 纯本地模式（数据只存在浏览器里，适合单机调试）
 * 填入后 → 自动启用云端账号与全服数据同步（需先在 Supabase 执行 supabase/schema.sql）
 *
 * anon key 是公开密钥，安全由数据库 RLS 策略保证，不要在这里放 service_role key。
 */
window.SDJ_CONFIG = {
  supabaseUrl: "https://dumhzaasgterekohjxgv.supabase.co",
  supabaseAnonKey: "sb_publishable_Rz2by2gZiHo-MkeCszZfDg_l-t2b7Xx",

  // 管理者注册入口：true 时注册页显示「高级认证」
  // 云端模式下邀请码由数据库校验（public.app_config），前端 adminInvite 留空即可；
  // 提交后只是创建申请，必须由现任管理员在「待审批 · 管理者审批」同意才会真正成为管理者
  allowAdminRegister: true,
  adminInvite: "",

  // 委托等级配色：地图标记、侧边栏、任务列表共用同一份定义
  missionLevels: {
    A: { color: "#ff2b2b", label: "A 级 · 紧急", ripple: true },
    B: { color: "#ff8a00", label: "B 级 · 高危", ripple: false },
    C: { color: "#ffd166", label: "C 级 · 常规", ripple: false },
    D: { color: "#7fd1ff", label: "D 级 · 低危", ripple: false }
  }
};
