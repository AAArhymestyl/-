-- 神降计划·塔 · Supabase 数据库初始化
-- 在 Supabase 控制台 → SQL Editor 里整段执行一次即可。

-- 1. 成员档案（与 auth.users 一一对应）
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  display_name text not null,
  role text not null default 'player' check (role in ('player', 'contractor', 'admin')),
  created_at timestamptz not null default now()
);

-- 2. 全服共享数据（固定一行，id = 1）
create table if not exists public.world_state (
  id int primary key default 1,
  map_locations jsonb not null default '{"items":[],"removed":[],"v":2}'::jsonb,
  missions jsonb,
  forum jsonb,
  members jsonb,
  approvals jsonb,
  council jsonb,
  codex jsonb,
  bag jsonb,
  cards jsonb,
  activity_log jsonb,
  system_alerts jsonb,
  friends jsonb,
  settings jsonb,
  updated_at timestamptz not null default now()
);

alter table public.world_state add column if not exists cards jsonb;
alter table public.world_state add column if not exists activity_log jsonb;
alter table public.world_state add column if not exists system_alerts jsonb;
alter table public.world_state add column if not exists items jsonb;
alter table public.world_state add column if not exists mission_reports jsonb;
alter table public.world_state add column if not exists registration_requests jsonb;
alter table public.world_state add column if not exists wallets jsonb;
alter table public.world_state add column if not exists notifications jsonb;

insert into public.world_state (id) values (1) on conflict (id) do nothing;

-- 3. 行级安全
alter table public.profiles enable row level security;
alter table public.world_state enable row level security;

drop policy if exists "profiles readable by members" on public.profiles;
create policy "profiles readable by members"
  on public.profiles for select to authenticated using (true);

drop policy if exists "profile self insert" on public.profiles;
create policy "profile self insert"
  on public.profiles for insert to authenticated with check (auth.uid() = id and role <> 'admin');

drop policy if exists "profile self update" on public.profiles;
create policy "profile self update"
  on public.profiles for update to authenticated using (auth.uid() = id);

-- 提权防护：禁止登录用户自行把 role 改成 admin / contractor
-- 管理者身份只能由 SQL Editor 或 service_role 设置（此时 auth.uid() 为空）
create or replace function public.guard_profile_role()
returns trigger
language plpgsql
as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null then
    raise exception 'role change is not allowed';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_role_guard on public.profiles;
create trigger profiles_role_guard
  before update on public.profiles
  for each row execute function public.guard_profile_role();

drop policy if exists "world readable by members" on public.world_state;
create policy "world readable by members"
  on public.world_state for select to authenticated using (true);

-- 只有 profiles.role = 'admin' 的账号能写全服数据
drop policy if exists "world writable by admin" on public.world_state;
create policy "world writable by admin"
  on public.world_state for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- 允许管理员插入（首次 upsert 时行不存在会走 insert 分支）
drop policy if exists "world insert by admin" on public.world_state;
create policy "world insert by admin"
  on public.world_state for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- 4. 管理员判定函数（供后续策略复用）
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin');
$$;

-- 5. 论坛独立表（供 Realtime 订阅）
create table if not exists public.forum_posts (
  id uuid primary key default gen_random_uuid(),
  author text not null,
  author_id uuid references auth.users(id) on delete set null,
  title text not null,
  body text not null,
  likes int not null default 0,
  pinned boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.forum_posts enable row level security;

drop policy if exists "forum readable" on public.forum_posts;
create policy "forum readable"
  on public.forum_posts for select to authenticated using (true);

drop policy if exists "forum insert own" on public.forum_posts;
create policy "forum insert own"
  on public.forum_posts for insert to authenticated
  with check (auth.uid() = author_id);

drop policy if exists "forum update" on public.forum_posts;
create policy "forum update"
  on public.forum_posts for update to authenticated
  using (auth.uid() = author_id or public.is_admin())
  with check (auth.uid() = author_id or public.is_admin());

drop policy if exists "forum delete" on public.forum_posts;
create policy "forum delete"
  on public.forum_posts for delete to authenticated
  using (auth.uid() = author_id or public.is_admin());

-- 6. 待审批独立表
create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null default 'player',
  type text not null,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

alter table public.approvals enable row level security;

drop policy if exists "approvals readable" on public.approvals;
create policy "approvals readable"
  on public.approvals for select to authenticated using (true);

drop policy if exists "approvals insert by admin" on public.approvals;
create policy "approvals insert by admin"
  on public.approvals for insert to authenticated with check (public.is_admin());

drop policy if exists "approvals update by admin" on public.approvals;
create policy "approvals update by admin"
  on public.approvals for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "approvals delete by admin" on public.approvals;
create policy "approvals delete by admin"
  on public.approvals for delete to authenticated using (public.is_admin());

-- 7. 社交快照（好友 / 群聊 / 消息）：单行快照，便于跨设备同步
create table if not exists public.social_state (
  id int primary key default 1,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.social_state enable row level security;

drop policy if exists "social readable" on public.social_state;
create policy "social readable"
  on public.social_state for select to authenticated using (true);

drop policy if exists "social insert" on public.social_state;
create policy "social insert"
  on public.social_state for insert to authenticated with check (true);

drop policy if exists "social update" on public.social_state;
create policy "social update"
  on public.social_state for update to authenticated using (true) with check (true);

-- 8. 打开 Realtime（重复执行会报 already member，可忽略）
do $$
begin
  alter publication supabase_realtime add table public.forum_posts;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.approvals;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.social_state;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.world_state;
exception when duplicate_object then null;
end $$;

-- 8.5 显式授权（即使关闭「Automatically expose new tables」也能正常工作）
--     RLS 仍然会按策略限制行级读写，这里只补表级权限。
grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.world_state to authenticated;
grant select, insert, update, delete on public.forum_posts to authenticated;
grant select, insert, update, delete on public.approvals to authenticated;
grant select, insert, update, delete on public.social_state to authenticated;

-- 9. v1.0.0 公测不写入任何演示数据，存档从空开始
-- 首个管理者（云端注册需要审批，所以不能用前端自助创建管理员）：
--   1) Supabase Dashboard → Authentication → Users → Add user
--      Email 填 <用户名>@sdj.local，设置密码，勾选 Auto Confirm User
--   2) 复制该用户 id，在 SQL Editor 执行：
--      insert into public.profiles (id, username, display_name, role)
--      values ('<auth-user-id>', 'AAArhymestyl', '沙利叶', 'admin')
--      on conflict (id) do update set role = 'admin';
-- （SQL Editor / service_role 无登录 JWT，可绕过上面的 role 修改守卫）

-- =========================================================
-- 10. 跨设备玩家动作 RPC
--     玩家没有 world_state 写权限，通过 security definer 函数安全写入
-- =========================================================

-- 10.1 接取委托
create or replace function public.mission_accept(p_mission_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_username text;
  v_display text;
  v_role text;
  v_world public.world_state%rowtype;
  v_mission jsonb;
  v_acceptors jsonb;
  v_slots int;
  v_deadline bigint;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_new_status text;
  v_missions jsonb;
  v_log jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', '请先登录'); end if;
  select username, display_name, role into v_username, v_display, v_role
    from public.profiles where id = v_uid;
  if v_username is null then return jsonb_build_object('ok', false, 'error', '缺少成员档案'); end if;
  if v_role = 'admin' then return jsonb_build_object('ok', false, 'error', '管理者不可接取委托'); end if;

  select * into v_world from public.world_state where id = 1 for update;
  if not found then return jsonb_build_object('ok', false, 'error', '全服数据未初始化'); end if;

  select m into v_mission
    from jsonb_array_elements(coalesce(v_world.missions, '[]'::jsonb)) m
   where m->>'id' = p_mission_id limit 1;
  if v_mission is null then return jsonb_build_object('ok', false, 'error', '委托不存在'); end if;
  if (v_mission->>'status') <> 'available' then return jsonb_build_object('ok', false, 'error', '该委托当前不可接取'); end if;

  v_deadline := nullif(v_mission->'deadline'->>'endsAt', '')::bigint;
  if v_deadline is not null and v_now > v_deadline then
    return jsonb_build_object('ok', false, 'error', '该委托已超过时限');
  end if;

  v_slots := coalesce((v_mission->>'slots')::int, 1);
  v_acceptors := coalesce(v_mission->'acceptors', '[]'::jsonb);
  if jsonb_array_length(v_acceptors) >= v_slots then
    return jsonb_build_object('ok', false, 'error', '名额已满');
  end if;
  if exists (select 1 from jsonb_array_elements(v_acceptors) a where a->>'username' = v_username) then
    return jsonb_build_object('ok', false, 'error', '你已接取该委托');
  end if;

  v_acceptors := v_acceptors || jsonb_build_array(jsonb_build_object(
    'username', v_username, 'name', v_display, 'role', v_role, 'at', v_now
  ));
  v_new_status := case when jsonb_array_length(v_acceptors) >= v_slots then 'active' else 'available' end;

  select coalesce(jsonb_agg(
    case when m->>'id' = p_mission_id
      then m || jsonb_build_object('acceptors', v_acceptors, 'status', v_new_status)
      else m end
  ), '[]'::jsonb) into v_missions
  from jsonb_array_elements(coalesce(v_world.missions, '[]'::jsonb)) m;

  v_log := jsonb_build_array(jsonb_build_object(
    'id', 'al' || v_now || floor(random() * 1000)::text,
    'username', v_username,
    'scope', 'self',
    'kind', 'mission',
    'text', '接取委托「' || (v_mission->>'title') || '」（' || (v_mission->>'level') || ' 级 · ' || (v_mission->>'loc') || '）',
    'at', v_now
  )) || coalesce(v_world.activity_log, '[]'::jsonb);
  if jsonb_array_length(v_log) > 300 then
    select coalesce(jsonb_agg(e), '[]'::jsonb) into v_log
      from (select e from jsonb_array_elements(v_log) with ordinality t(e, ord) order by ord limit 300) s;
  end if;

  update public.world_state
     set missions = v_missions,
         activity_log = v_log,
         updated_at = now()
   where id = 1;

  return jsonb_build_object('ok', true, 'status', v_new_status,
    'count', jsonb_array_length(v_acceptors), 'slots', v_slots);
end;
$$;

-- 10.2 提交完成申请
create or replace function public.mission_submit(p_mission_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_username text;
  v_display text;
  v_role text;
  v_world public.world_state%rowtype;
  v_mission jsonb;
  v_reports jsonb;
  v_report jsonb;
  v_missions jsonb;
  v_notes jsonb;
  v_log jsonb;
  v_deadline bigint;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', '请先登录'); end if;
  select username, display_name, role into v_username, v_display, v_role
    from public.profiles where id = v_uid;
  if v_username is null then return jsonb_build_object('ok', false, 'error', '缺少成员档案'); end if;
  if v_role = 'admin' then return jsonb_build_object('ok', false, 'error', '管理者不可提交委托'); end if;

  select * into v_world from public.world_state where id = 1 for update;
  if not found then return jsonb_build_object('ok', false, 'error', '全服数据未初始化'); end if;

  select m into v_mission
    from jsonb_array_elements(coalesce(v_world.missions, '[]'::jsonb)) m
   where m->>'id' = p_mission_id limit 1;
  if v_mission is null then return jsonb_build_object('ok', false, 'error', '委托不存在'); end if;

  if not exists (
    select 1 from jsonb_array_elements(coalesce(v_mission->'acceptors', '[]'::jsonb)) a
     where a->>'username' = v_username
  ) then
    return jsonb_build_object('ok', false, 'error', '你未接取该委托');
  end if;
  if (v_mission->>'status') not in ('available', 'active', 'review') then
    return jsonb_build_object('ok', false, 'error', '该委托当前不可提交');
  end if;

  v_deadline := nullif(v_mission->'deadline'->>'endsAt', '')::bigint;
  if v_deadline is not null and v_now > v_deadline then
    return jsonb_build_object('ok', false, 'error', '已超过任务时限，无法提交');
  end if;

  v_reports := coalesce(v_world.mission_reports, '[]'::jsonb);
  if exists (
    select 1 from jsonb_array_elements(v_reports) r
     where r->>'missionId' = p_mission_id
       and r->'applicant'->>'username' = v_username
       and r->>'status' in ('pending', 'approved')
  ) then
    return jsonb_build_object('ok', false, 'error', '你的完成申请已在审批队列或已通过');
  end if;

  v_report := jsonb_build_object(
    'id', 'mr' || v_now,
    'missionId', p_mission_id,
    'missionTitle', v_mission->>'title',
    'level', v_mission->>'level',
    'loc', v_mission->>'loc',
    'reward', case when v_mission->'reward'->>'type' = 'points'
                   then '计划点 ×' || coalesce(v_mission->'reward'->>'points', '0')
                   else coalesce(v_mission->'reward'->>'label', v_mission->'reward'->>'itemName', '奖励') end,
    'desc', v_mission->>'desc',
    'applicant', jsonb_build_object('username', v_username, 'name', v_display, 'role', v_role),
    'submittedAt', v_now,
    'deadlineAt', v_deadline,
    'status', 'pending',
    'note', ''
  );
  v_reports := jsonb_build_array(v_report) || v_reports;
  if jsonb_array_length(v_reports) > 500 then
    select coalesce(jsonb_agg(e), '[]'::jsonb) into v_reports
      from (select e from jsonb_array_elements(v_reports) with ordinality t(e, ord) order by ord limit 500) s;
  end if;

  select coalesce(jsonb_agg(
    case when m->>'id' = p_mission_id then m || '{"status":"review"}'::jsonb else m end
  ), '[]'::jsonb) into v_missions
  from jsonb_array_elements(coalesce(v_world.missions, '[]'::jsonb)) m;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', 'n' || v_now || '_' || p.username,
    'username', p.username,
    'text', '新的委托完成申请：' || (v_mission->>'title') || '（' || v_display || '）',
    'at', v_now,
    'read', false
  )), '[]'::jsonb) into v_notes
  from public.profiles p where p.role = 'admin';

  v_log := jsonb_build_array(jsonb_build_object(
    'id', 'al' || v_now || floor(random() * 1000)::text,
    'username', v_username,
    'scope', 'self',
    'kind', 'mission',
    'text', '提交完成申请「' || (v_mission->>'title') || '」',
    'at', v_now
  )) || coalesce(v_world.activity_log, '[]'::jsonb);
  if jsonb_array_length(v_log) > 300 then
    select coalesce(jsonb_agg(e), '[]'::jsonb) into v_log
      from (select e from jsonb_array_elements(v_log) with ordinality t(e, ord) order by ord limit 300) s;
  end if;

  update public.world_state
     set missions = v_missions,
         mission_reports = v_reports,
         notifications = v_notes || coalesce(notifications, '[]'::jsonb),
         activity_log = v_log,
         updated_at = now()
   where id = 1;

  return jsonb_build_object('ok', true, 'status', 'review');
end;
$$;

-- 10.3 提交注册申请（未登录可调用；不存密码哈希）
create or replace function public.registration_submit(
  p_username text,
  p_display_name text,
  p_role text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text := btrim(coalesce(p_username, ''));
  v_display text := btrim(coalesce(p_display_name, ''));
  v_role text := coalesce(p_role, 'player');
  v_world public.world_state%rowtype;
  v_existing jsonb;
  v_reqs jsonb;
  v_req jsonb;
  v_notes jsonb;
  v_status text;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if v_username !~ '^[A-Za-z0-9_]{3,16}$' then
    return jsonb_build_object('ok', false, 'error', '用户名需 3-16 位字母数字下划线');
  end if;
  if length(v_display) < 1 or length(v_display) > 20 then
    return jsonb_build_object('ok', false, 'error', '显示名需 1-20 位');
  end if;
  if v_role not in ('player', 'contractor') then
    return jsonb_build_object('ok', false, 'error', '身份不合法');
  end if;
  if exists (select 1 from public.profiles p where lower(p.username) = lower(v_username)) then
    return jsonb_build_object('ok', false, 'error', '该用户名已注册，请直接登录');
  end if;

  select * into v_world from public.world_state where id = 1 for update;
  if not found then return jsonb_build_object('ok', false, 'error', '全服数据未初始化'); end if;

  v_reqs := coalesce(v_world.registration_requests, '[]'::jsonb);
  select r into v_existing
    from jsonb_array_elements(v_reqs) r
   where lower(r->>'username') = lower(v_username)
   order by (r->>'createdAt')::bigint desc limit 1;

  if v_existing is not null then
    v_status := v_existing->>'status';
    if v_status in ('pending', 'approved', 'completed') then
      return jsonb_build_object('ok', true, 'status', v_status, 'existing', true);
    end if;
  end if;

  if jsonb_array_length(v_reqs) >= 300 then
    return jsonb_build_object('ok', false, 'error', '申请队列已满，请联系管理者');
  end if;

  v_req := jsonb_build_object(
    'id', 'r' || v_now,
    'username', v_username,
    'displayName', v_display,
    'role', v_role,
    'status', 'pending',
    'createdAt', v_now,
    'note', ''
  );
  v_reqs := jsonb_build_array(v_req) || v_reqs;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', 'n' || v_now || '_' || p.username,
    'username', p.username,
    'text', '新的' || case when v_role = 'player' then '玩家' else '契约者' end
            || '注册申请：' || v_display || '（' || v_username || '）',
    'at', v_now,
    'read', false
  )), '[]'::jsonb) into v_notes
  from public.profiles p where p.role = 'admin';

  update public.world_state
     set registration_requests = v_reqs,
         notifications = v_notes || coalesce(notifications, '[]'::jsonb),
         updated_at = now()
   where id = 1;

  return jsonb_build_object('ok', true, 'status', 'pending');
end;
$$;

-- 10.4 查询注册申请状态（未登录可调用，只返回状态）
create or replace function public.registration_status(p_username text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_world public.world_state%rowtype;
  v_req jsonb;
begin
  select * into v_world from public.world_state where id = 1;
  if not found then return jsonb_build_object('ok', true, 'status', 'none'); end if;
  select r into v_req
    from jsonb_array_elements(coalesce(v_world.registration_requests, '[]'::jsonb)) r
   where lower(r->>'username') = lower(btrim(coalesce(p_username, '')))
   order by (r->>'createdAt')::bigint desc limit 1;
  if v_req is null then return jsonb_build_object('ok', true, 'status', 'none'); end if;
  return jsonb_build_object(
    'ok', true,
    'status', v_req->>'status',
    'note', coalesce(v_req->>'note', ''),
    'displayName', v_req->>'displayName',
    'role', v_req->>'role'
  );
end;
$$;

-- 10.5 权限：撤销默认 PUBLIC，按需授权
revoke all on function public.mission_accept(text) from public;
revoke all on function public.mission_submit(text) from public;
revoke all on function public.registration_submit(text, text, text) from public;
revoke all on function public.registration_status(text) from public;
grant execute on function public.mission_accept(text) to authenticated;
grant execute on function public.mission_submit(text) to authenticated;
grant execute on function public.registration_submit(text, text, text) to anon, authenticated;
grant execute on function public.registration_status(text) to anon, authenticated;

-- =========================================================
-- 11. 管理者邀请码（审批制）
--     邀请码只保存在服务端（RLS 无策略 + 回收权限），前端拿不到
--     流程：邀请码提交申请 → 现任管理员在「待审批 · 管理者审批」同意 → 申请人完成注册时建档
-- =========================================================

create table if not exists public.app_config (
  id int primary key default 1,
  admin_invite text not null default '',
  updated_at timestamptz not null default now()
);

insert into public.app_config (id) values (1) on conflict (id) do nothing;

alter table public.app_config enable row level security;
revoke all on public.app_config from anon, authenticated;

-- 设置 / 更换邀请码（在 SQL Editor 执行，把 CHANGE-ME 换成自己的码）：
-- update public.app_config set admin_invite = 'CHANGE-ME', updated_at = now() where id = 1;

-- 11.1 提交管理者注册申请（未登录可调用，必须带正确邀请码）
create or replace function public.admin_request_submit(
  p_username text,
  p_display_name text,
  p_invite text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text := btrim(coalesce(p_username, ''));
  v_display text := btrim(coalesce(p_display_name, ''));
  v_invite text := btrim(coalesce(p_invite, ''));
  v_code text;
  v_world public.world_state%rowtype;
  v_reqs jsonb;
  v_existing jsonb;
  v_req jsonb;
  v_notes jsonb;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  select admin_invite into v_code from public.app_config where id = 1;
  if v_code is null or v_code = '' then
    return jsonb_build_object('ok', false, 'error', '管理者邀请码尚未设置');
  end if;
  if v_invite <> v_code then
    return jsonb_build_object('ok', false, 'error', '邀请码错误');
  end if;

  if v_username !~ '^[A-Za-z0-9_]{3,16}$' then
    return jsonb_build_object('ok', false, 'error', '用户名需 3-16 位字母数字下划线');
  end if;
  if length(v_display) < 1 or length(v_display) > 20 then
    return jsonb_build_object('ok', false, 'error', '显示名需 1-20 位');
  end if;
  if exists (select 1 from public.profiles p where lower(p.username) = lower(v_username)) then
    return jsonb_build_object('ok', false, 'error', '该用户名已注册，请直接登录');
  end if;

  select * into v_world from public.world_state where id = 1 for update;
  if not found then return jsonb_build_object('ok', false, 'error', '全服数据未初始化'); end if;

  v_reqs := coalesce(v_world.registration_requests, '[]'::jsonb);
  select r into v_existing
    from jsonb_array_elements(v_reqs) r
   where lower(r->>'username') = lower(v_username)
     and r->>'role' = 'admin'
   order by (r->>'createdAt')::bigint desc limit 1;

  if v_existing is not null and (v_existing->>'status') in ('pending', 'approved', 'completed') then
    return jsonb_build_object('ok', true, 'status', v_existing->>'status', 'existing', true);
  end if;

  if jsonb_array_length(v_reqs) >= 300 then
    return jsonb_build_object('ok', false, 'error', '申请队列已满，请联系管理者');
  end if;

  v_req := jsonb_build_object(
    'id', 'ra' || v_now,
    'username', v_username,
    'displayName', v_display,
    'role', 'admin',
    'status', 'pending',
    'createdAt', v_now,
    'note', ''
  );
  v_reqs := jsonb_build_array(v_req) || v_reqs;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', 'n' || v_now || '_' || p.username,
    'username', p.username,
    'text', '新的管理者注册申请：' || v_display || '（' || v_username || '）',
    'at', v_now,
    'read', false
  )), '[]'::jsonb) into v_notes
  from public.profiles p where p.role = 'admin';

  update public.world_state
     set registration_requests = v_reqs,
         notifications = v_notes || coalesce(notifications, '[]'::jsonb),
         updated_at = now()
   where id = 1;

  return jsonb_build_object('ok', true, 'status', 'pending');
end;
$$;

-- 11.2 审批通过后建立管理者档案（需已登录，且同名管理者申请为 approved）
--     建档走 INSERT，因此不会触发 profiles_role_guard（该触发器只拦 UPDATE）
create or replace function public.admin_claim()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := coalesce(auth.jwt()->>'email', '');
  v_uname text := split_part(v_email, '@', 1);
  v_world public.world_state%rowtype;
  v_req jsonb;
  v_reqs jsonb;
  v_profile public.profiles%rowtype;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', '请先登录'); end if;
  if v_uname = '' then return jsonb_build_object('ok', false, 'error', '无法识别账号'); end if;

  select * into v_profile from public.profiles where id = v_uid;
  if found then
    return jsonb_build_object('ok', true, 'profile', jsonb_build_object(
      'id', v_profile.id, 'username', v_profile.username,
      'display_name', v_profile.display_name, 'role', v_profile.role
    ));
  end if;

  select * into v_world from public.world_state where id = 1 for update;
  if not found then return jsonb_build_object('ok', false, 'error', '全服数据未初始化'); end if;

  select r into v_req
    from jsonb_array_elements(coalesce(v_world.registration_requests, '[]'::jsonb)) r
   where lower(r->>'username') = lower(v_uname)
     and r->>'role' = 'admin'
     and r->>'status' = 'approved'
   order by (r->>'createdAt')::bigint desc limit 1;

  if v_req is null then
    return jsonb_build_object('ok', false, 'error', '管理者申请尚未获批，请联系现任管理者');
  end if;

  if exists (select 1 from public.profiles p where lower(p.username) = lower(v_req->>'username')) then
    return jsonb_build_object('ok', false, 'error', '该用户名已被占用');
  end if;

  insert into public.profiles (id, username, display_name, role)
  values (
    v_uid,
    v_req->>'username',
    coalesce(nullif(v_req->>'displayName', ''), v_req->>'username'),
    'admin'
  );

  v_reqs := (
    select coalesce(jsonb_agg(
      case when r->>'id' = v_req->>'id' then r || '{"status":"completed"}'::jsonb else r end
    ), '[]'::jsonb)
    from jsonb_array_elements(coalesce(v_world.registration_requests, '[]'::jsonb)) r
  );

  update public.world_state
     set registration_requests = v_reqs,
         updated_at = now()
   where id = 1;

  return jsonb_build_object('ok', true, 'profile', jsonb_build_object(
    'id', v_uid,
    'username', v_req->>'username',
    'display_name', coalesce(nullif(v_req->>'displayName', ''), v_req->>'username'),
    'role', 'admin'
  ));
end;
$$;

revoke all on function public.admin_request_submit(text, text, text) from public;
revoke all on function public.admin_claim() from public;
grant execute on function public.admin_request_submit(text, text, text) to anon, authenticated;
grant execute on function public.admin_claim() to authenticated;

-- =========================================================
-- 12. 竞态防护：委托全程服务端化 + 成员封禁
--     原则：多人会同时改的字段一律走 security definer 函数，
--          管理端不再整行 upsert 这些字段。
-- =========================================================

-- 12.0 成员状态与最高管理者标记
alter table public.profiles add column if not exists banned boolean not null default false;
alter table public.profiles add column if not exists ban_note text not null default '';
alter table public.profiles add column if not exists banned_at timestamptz;
alter table public.profiles add column if not exists banned_by text;
alter table public.profiles add column if not exists owner boolean not null default false;

update public.profiles set owner = true where role = 'admin' and username = 'AAArhymestyl';

create or replace function public.is_owner()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles p
                  where p.id = auth.uid() and p.role = 'admin' and p.owner and not p.banned);
$$;

create or replace function public.is_banned()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce((select p.banned from public.profiles p where p.id = auth.uid()), false);
$$;

-- 被封禁的管理员同时失去写权限
create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles p
                  where p.id = auth.uid() and p.role = 'admin' and not p.banned);
$$;

drop policy if exists "world writable by admin" on public.world_state;
create policy "world writable by admin"
  on public.world_state for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin' and not p.banned))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin' and not p.banned));

drop policy if exists "world insert by admin" on public.world_state;
create policy "world insert by admin"
  on public.world_state for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin' and not p.banned));

-- 12.1 移出 / 恢复成员（只有管理者可调用；管理者账号只有最高管理者可处理）
create or replace function public.member_ban(p_username text, p_banned boolean, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_me public.profiles%rowtype;
  v_target public.profiles%rowtype;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_ban boolean := coalesce(p_banned, false);
  v_note text := btrim(coalesce(p_note, ''));
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', '请先登录'); end if;
  select * into v_me from public.profiles where id = v_uid;
  if not found or v_me.role <> 'admin' or v_me.banned then
    return jsonb_build_object('ok', false, 'error', '需要管理者权限');
  end if;
  select * into v_target from public.profiles
   where lower(username) = lower(btrim(coalesce(p_username, ''))) limit 1;
  if not found then return jsonb_build_object('ok', false, 'error', '成员不存在'); end if;
  if v_target.id = v_me.id then return jsonb_build_object('ok', false, 'error', '不能处理自己'); end if;
  if v_target.owner then return jsonb_build_object('ok', false, 'error', '不能处理最高管理者'); end if;
  if v_target.role = 'admin' and not v_me.owner then
    return jsonb_build_object('ok', false, 'error', '只有最高管理者可以处理管理者账号');
  end if;

  update public.profiles
     set banned = v_ban,
         ban_note = v_note,
         banned_at = case when v_ban then now() else null end,
         banned_by = case when v_ban then v_me.username else null end
   where id = v_target.id;

  update public.world_state
     set activity_log = jsonb_build_array(jsonb_build_object(
           'id', 'al' || v_now,
           'username', '*',
           'scope', 'system',
           'kind', 'member',
           'text', case when v_ban
                     then '管理者将成员「' || v_target.display_name || '」移出系统'
                     else '管理者恢复了成员「' || v_target.display_name || '」的访问' end,
           'at', v_now
         )) || coalesce(activity_log, '[]'::jsonb),
         updated_at = now()
   where id = 1;

  return jsonb_build_object('ok', true, 'username', v_target.username,
                            'displayName', v_target.display_name, 'banned', v_ban);
end;
$$;

-- 12.2 委托发布 / 编辑：保留已有的接取人、状态与时间戳，避免覆盖玩家刚接取的数据
create or replace function public.mission_save(p_mission jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_world public.world_state%rowtype;
  v_id text := nullif(btrim(coalesce(p_mission->>'id', '')), '');
  v_existing jsonb;
  v_row jsonb;
  v_missions jsonb;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', '需要管理者权限'); end if;
  if v_id is null then v_id := 'm' || v_now; end if;

  select * into v_world from public.world_state where id = 1 for update;
  if not found then return jsonb_build_object('ok', false, 'error', '全服数据未初始化'); end if;

  select m into v_existing
    from jsonb_array_elements(coalesce(v_world.missions, '[]'::jsonb)) m
   where m->>'id' = v_id limit 1;

  v_missions := '[]'::jsonb;

  if v_existing is not null then
    v_row := v_existing || (p_mission - 'acceptors' - 'status' - 'completedAt' - 'failedAt' - 'createdAt');
    v_row := v_row || jsonb_build_object('id', v_id);
    select coalesce(jsonb_agg(case when m->>'id' = v_id then v_row else m end), '[]'::jsonb)
      into v_missions
      from jsonb_array_elements(coalesce(v_world.missions, '[]'::jsonb)) m;
  else
    v_row := p_mission || jsonb_build_object(
      'id', v_id, 'status', 'available', 'acceptors', '[]'::jsonb, 'createdAt', v_now);
    v_missions := coalesce(v_world.missions, '[]'::jsonb) || jsonb_build_array(v_row);
  end if;

  update public.world_state set missions = v_missions, updated_at = now() where id = 1;
  return jsonb_build_object('ok', true, 'id', v_id, 'mission', v_row);
end;
$$;

-- 12.3 删除委托（连带清理该委托的完成申请）
create or replace function public.mission_delete(p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_world public.world_state%rowtype;
  v_id text := btrim(coalesce(p_id, ''));
  v_missions jsonb;
  v_reports jsonb;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', '需要管理者权限'); end if;
  if v_id = '' then return jsonb_build_object('ok', false, 'error', '缺少委托编号'); end if;

  select * into v_world from public.world_state where id = 1 for update;
  if not found then return jsonb_build_object('ok', false, 'error', '全服数据未初始化'); end if;

  select coalesce(jsonb_agg(m), '[]'::jsonb) into v_missions
    from jsonb_array_elements(coalesce(v_world.missions, '[]'::jsonb)) m
   where m->>'id' <> v_id;

  select coalesce(jsonb_agg(r), '[]'::jsonb) into v_reports
    from jsonb_array_elements(coalesce(v_world.mission_reports, '[]'::jsonb)) r
   where r->>'missionId' <> v_id;

  update public.world_state
     set missions = v_missions, mission_reports = v_reports, updated_at = now()
   where id = 1;

  return jsonb_build_object('ok', true);
end;
$$;

-- 12.4 提交任务情况（覆盖旧的单参数版本，旧客户端仍可用）
drop function if exists public.mission_submit(text, text);

create or replace function public.mission_submit(p_mission_id text, p_content text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_username text;
  v_display text;
  v_role text;
  v_world public.world_state%rowtype;
  v_mission jsonb;
  v_reports jsonb;
  v_report jsonb;
  v_missions jsonb;
  v_notes jsonb;
  v_log jsonb;
  v_deadline bigint;
  v_content text := btrim(coalesce(p_content, ''));
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', '请先登录'); end if;
  if public.is_banned() then return jsonb_build_object('ok', false, 'error', '该账号已被移出系统'); end if;
  select username, display_name, role into v_username, v_display, v_role
    from public.profiles where id = v_uid;
  if v_username is null then return jsonb_build_object('ok', false, 'error', '缺少成员档案'); end if;
  if v_role = 'admin' then return jsonb_build_object('ok', false, 'error', '管理者不可提交委托'); end if;
  if length(v_content) > 800 then return jsonb_build_object('ok', false, 'error', '任务情况最多 800 字'); end if;

  select * into v_world from public.world_state where id = 1 for update;
  if not found then return jsonb_build_object('ok', false, 'error', '全服数据未初始化'); end if;

  select m into v_mission
    from jsonb_array_elements(coalesce(v_world.missions, '[]'::jsonb)) m
   where m->>'id' = p_mission_id limit 1;
  if v_mission is null then return jsonb_build_object('ok', false, 'error', '委托不存在'); end if;

  if not exists (
    select 1 from jsonb_array_elements(coalesce(v_mission->'acceptors', '[]'::jsonb)) a
     where a->>'username' = v_username
  ) then
    return jsonb_build_object('ok', false, 'error', '你未接取该委托');
  end if;
  if (v_mission->>'status') not in ('available', 'active', 'review') then
    return jsonb_build_object('ok', false, 'error', '该委托当前不可提交');
  end if;

  v_deadline := nullif(v_mission->'deadline'->>'endsAt', '')::bigint;
  if v_deadline is not null and v_now > v_deadline then
    return jsonb_build_object('ok', false, 'error', '已超过任务时限，无法提交');
  end if;

  v_reports := coalesce(v_world.mission_reports, '[]'::jsonb);
  if exists (
    select 1 from jsonb_array_elements(v_reports) r
     where r->>'missionId' = p_mission_id
       and r->'applicant'->>'username' = v_username
       and r->>'status' in ('pending', 'approved')
  ) then
    return jsonb_build_object('ok', false, 'error', '你的完成申请已在审批队列或已通过');
  end if;

  v_report := jsonb_build_object(
    'id', 'mr' || v_now,
    'missionId', p_mission_id,
    'missionTitle', v_mission->>'title',
    'level', v_mission->>'level',
    'loc', v_mission->>'loc',
    'reward', case when v_mission->'reward'->>'type' = 'points'
                   then '计划点 ×' || coalesce(v_mission->'reward'->>'points', '0')
                   else coalesce(v_mission->'reward'->>'itemName', v_mission->'reward'->>'label', '道具奖励') end,
    'desc', v_mission->>'desc',
    'content', v_content,
    'applicant', jsonb_build_object('username', v_username, 'name', v_display, 'role', v_role),
    'submittedAt', v_now,
    'deadlineAt', v_deadline,
    'status', 'pending',
    'note', ''
  );
  v_reports := jsonb_build_array(v_report) || v_reports;

  select coalesce(jsonb_agg(case when m->>'id' = p_mission_id then m || '{"status":"review"}'::jsonb else m end), '[]'::jsonb)
    into v_missions
    from jsonb_array_elements(coalesce(v_world.missions, '[]'::jsonb)) m;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', 'n' || v_now || '_' || p.username,
    'username', p.username,
    'text', '新的委托完成申请：' || (v_mission->>'title') || '（' || v_display || '）',
    'at', v_now,
    'read', false
  )), '[]'::jsonb) into v_notes
  from public.profiles p where p.role = 'admin' and not p.banned;

  v_log := jsonb_build_array(jsonb_build_object(
    'id', 'al' || v_now,
    'username', v_username,
    'scope', 'self',
    'kind', 'mission',
    'text', '提交完成申请「' || (v_mission->>'title') || '」',
    'at', v_now
  )) || coalesce(v_world.activity_log, '[]'::jsonb);

  update public.world_state
     set missions = v_missions,
         mission_reports = v_reports,
         notifications = v_notes || coalesce(notifications, '[]'::jsonb),
         activity_log = v_log,
         updated_at = now()
   where id = 1;

  return jsonb_build_object('ok', true, 'status', 'review');
end;
$$;

create or replace function public.mission_submit(p_mission_id text)
returns jsonb language sql security definer set search_path = public as $$
  select public.mission_submit(p_mission_id, '');
$$;

-- 12.5 委托结算：服务端完成审批、发奖、状态聚合
create or replace function public.mission_review(p_report_id text, p_action text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_world public.world_state%rowtype;
  v_reports jsonb;
  v_report jsonb;
  v_mission jsonb;
  v_missions jsonb;
  v_wallets jsonb;
  v_bag jsonb;
  v_notes jsonb;
  v_log jsonb;
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_note text := btrim(coalesce(p_note, ''));
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_user text;
  v_reward jsonb;
  v_item jsonb;
  v_grant text := '未发放';
  v_pending int := 0;
  v_approved int := 0;
  v_all int := 0;
  v_deadline bigint;
  v_status text;
  v_points numeric;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', '需要管理者权限'); end if;
  if v_action not in ('approve', 'reject') then
    return jsonb_build_object('ok', false, 'error', '操作不合法');
  end if;

  select * into v_world from public.world_state where id = 1 for update;
  if not found then return jsonb_build_object('ok', false, 'error', '全服数据未初始化'); end if;

  v_reports := coalesce(v_world.mission_reports, '[]'::jsonb);
  select r into v_report from jsonb_array_elements(v_reports) r where r->>'id' = p_report_id limit 1;
  if v_report is null then return jsonb_build_object('ok', false, 'error', '申请不存在'); end if;
  if coalesce(v_report->>'status', '') <> 'pending' then
    return jsonb_build_object('ok', false, 'error', '该申请已处理');
  end if;

  v_user := v_report->'applicant'->>'username';
  select m into v_mission
    from jsonb_array_elements(coalesce(v_world.missions, '[]'::jsonb)) m
   where m->>'id' = v_report->>'missionId' limit 1;

  v_wallets := coalesce(v_world.wallets, '{}'::jsonb);
  v_bag := coalesce(v_world.bag, '[]'::jsonb);

  if v_action = 'approve' and v_mission is not null then
    v_reward := case when jsonb_typeof(v_mission->'reward') = 'object' then v_mission->'reward' else '{}'::jsonb end;
    if coalesce(v_reward->>'type', 'points') = 'item' then
      select i into v_item from jsonb_array_elements(coalesce(v_world.items, '[]'::jsonb)) i
       where i->>'id' = v_reward->>'itemId' limit 1;
      v_bag := v_bag || jsonb_build_array(jsonb_build_object(
        'id', 'rw' || v_now,
        'owner', v_user,
        'name', coalesce(v_item->>'name', v_reward->>'itemName', '未知道具'),
        'type', case when coalesce(v_item->>'category', 'normal') = 'affinity' then '好感道具' else '普通道具' end,
        'rarity', coalesce(v_item->>'rarity', v_reward->>'rarity', 'N'),
        'desc', coalesce(v_item->>'intro', '委托结算奖励'),
        'equipped', false
      ));
      v_grant := coalesce(v_item->>'name', v_reward->>'itemName', '未知道具');
    else
      v_points := coalesce((v_wallets -> v_user ->> 'points')::numeric, 0)
                  + coalesce((v_reward->>'points')::numeric, 0);
      v_wallets := jsonb_set(v_wallets, array[v_user], jsonb_build_object('points', v_points), true);
      v_grant := '计划点 ×' || coalesce(v_reward->>'points', '0');
    end if;
  end if;

  if v_action = 'approve' then
    v_report := v_report || jsonb_build_object('status', 'approved', 'reviewedAt', v_now, 'note', '');
  else
    v_report := v_report || jsonb_build_object(
      'status', 'rejected', 'reviewedAt', v_now,
      'note', case when v_note = '' then '未填写原因' else v_note end);
  end if;

  select coalesce(jsonb_agg(case when r->>'id' = p_report_id then v_report else r end), '[]'::jsonb)
    into v_reports
    from jsonb_array_elements(v_reports) r;

  if v_mission is not null then
    select count(*) into v_pending from jsonb_array_elements(v_reports) r
     where r->>'missionId' = v_mission->>'id' and r->>'status' = 'pending';
    select count(*) into v_approved from jsonb_array_elements(v_reports) r
     where r->>'missionId' = v_mission->>'id' and r->>'status' = 'approved';
    select count(*) into v_all from jsonb_array_elements(coalesce(v_mission->'acceptors', '[]'::jsonb)) a
     where a->>'username' is not null;

    v_status := v_mission->>'status';
    if v_status not in ('failed', 'expired', 'done') then
      if v_pending > 0 then
        v_status := 'review';
      elsif v_all > 0 and v_approved >= v_all then
        v_status := 'done';
      else
        v_deadline := nullif(v_mission->'deadline'->>'endsAt', '')::bigint;
        if v_deadline is not null and v_now > v_deadline then
          if v_approved > 0 then v_status := 'done'; else v_status := 'failed'; end if;
        elsif v_all >= coalesce((v_mission->>'slots')::int, 1) or v_approved > 0 then
          v_status := 'active';
        else
          v_status := 'available';
        end if;
      end if;
    end if;

    v_mission := v_mission || jsonb_build_object('status', v_status);
    if v_status = 'done' and v_mission->>'completedAt' is null then
      v_mission := v_mission || jsonb_build_object('completedAt', v_now);
    end if;
    if v_status = 'failed' and v_mission->>'failedAt' is null then
      v_mission := v_mission || jsonb_build_object('failedAt', v_now);
    end if;

    select coalesce(jsonb_agg(case when m->>'id' = v_mission->>'id' then v_mission else m end), '[]'::jsonb)
      into v_missions
      from jsonb_array_elements(coalesce(v_world.missions, '[]'::jsonb)) m;
  else
    v_missions := coalesce(v_world.missions, '[]'::jsonb);
  end if;

  v_notes := jsonb_build_array(jsonb_build_object(
    'id', 'n' || v_now || '_' || coalesce(v_user, 'x'),
    'username', v_user,
    'text', case when v_action = 'approve'
                 then '委托「' || coalesce(v_report->>'missionTitle', '') || '」已完成结算，奖励：' || v_grant
                 else '委托「' || coalesce(v_report->>'missionTitle', '') || '」的完成申请被驳回：' || (v_report->>'note') end,
    'at', v_now,
    'read', false
  ));

  v_log := jsonb_build_array(jsonb_build_object(
    'id', 'al' || v_now,
    'username', '*',
    'scope', 'system',
    'kind', 'approval',
    'text', case when v_action = 'approve'
                 then '管理者确认完成委托「' || coalesce(v_report->>'missionTitle', '') || '」'
                 else '管理者驳回委托「' || coalesce(v_report->>'missionTitle', '') || '」' end,
    'at', v_now
  )) || coalesce(v_world.activity_log, '[]'::jsonb);

  update public.world_state
     set missions = v_missions,
         mission_reports = v_reports,
         wallets = v_wallets,
         bag = v_bag,
         notifications = v_notes || coalesce(notifications, '[]'::jsonb),
         activity_log = v_log,
         updated_at = now()
   where id = 1;

  return jsonb_build_object('ok', true, 'status', v_report->>'status',
                            'granted', v_grant, 'missionStatus', v_status);
end;
$$;

-- 12.6 超时结算（委托过期 / 注册申请 24h / 完成申请 48h）
create or replace function public.world_sweep()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_world public.world_state%rowtype;
  v_missions jsonb := '[]'::jsonb;
  v_reports jsonb;
  v_regs jsonb := '[]'::jsonb;
  v_notes jsonb := '[]'::jsonb;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  m jsonb;
  a jsonb;
  r jsonb;
  v_new jsonb;
  v_deadline bigint;
  v_approved int;
  v_acc int;
  v_changed int := 0;
  v_status text;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', '需要管理者权限'); end if;
  select * into v_world from public.world_state where id = 1 for update;
  if not found then return jsonb_build_object('ok', false, 'error', '全服数据未初始化'); end if;

  v_reports := coalesce(v_world.mission_reports, '[]'::jsonb);

  -- 委托超时
  for m in select * from jsonb_array_elements(coalesce(v_world.missions, '[]'::jsonb)) loop
    v_deadline := nullif(m->'deadline'->>'endsAt', '')::bigint;
    v_new := null;
    if v_deadline is not null and v_now > v_deadline then
      v_status := m->>'status';
      if v_status = 'active' then
        select count(*) into v_approved from jsonb_array_elements(v_reports) x
         where x->>'missionId' = m->>'id' and x->>'status' = 'approved';
        if v_approved > 0 then
          v_new := m || jsonb_build_object('status', 'done', 'completedAt', coalesce(m->'completedAt', to_jsonb(v_now)));
        else
          v_new := m || jsonb_build_object('status', 'failed', 'failedAt', v_now);
        end if;
        for a in select * from jsonb_array_elements(coalesce(m->'acceptors', '[]'::jsonb)) loop
          if a->>'username' is not null and not exists (
            select 1 from jsonb_array_elements(v_reports) x
             where x->>'missionId' = m->>'id' and x->>'status' = 'approved'
               and x->'applicant'->>'username' = a->>'username') then
            v_notes := v_notes || jsonb_build_array(jsonb_build_object(
              'id', 'n' || v_now || '_' || (a->>'username'),
              'username', a->>'username',
              'text', '委托「' || (m->>'title') || '」已超过时限，未能完成',
              'at', v_now, 'read', false));
          end if;
        end loop;
        v_changed := v_changed + 1;
      elsif v_status = 'available' then
        select count(*) into v_acc from jsonb_array_elements(coalesce(m->'acceptors', '[]'::jsonb)) x
         where x->>'username' is not null;
        if v_acc > 0 then
          v_new := m || jsonb_build_object('status', 'failed', 'failedAt', v_now);
          for a in select * from jsonb_array_elements(coalesce(m->'acceptors', '[]'::jsonb)) loop
            if a->>'username' is not null then
              v_notes := v_notes || jsonb_build_array(jsonb_build_object(
                'id', 'n' || v_now || '_' || (a->>'username'),
                'username', a->>'username',
                'text', '委托「' || (m->>'title') || '」已超过时限，判定为失败',
                'at', v_now, 'read', false));
            end if;
          end loop;
        else
          v_new := m || jsonb_build_object('status', 'expired');
        end if;
        v_changed := v_changed + 1;
      end if;
    end if;
    v_missions := v_missions || jsonb_build_array(coalesce(v_new, m));
  end loop;

  -- 完成申请 48h 未处理自动退回
  select coalesce(jsonb_agg(
    case when x->>'status' = 'pending'
              and v_now - (x->>'submittedAt')::bigint > 172800000
         then x || jsonb_build_object('status', 'expired', 'note', '超过 48 小时未处理，已自动退回')
         else x end
  ), '[]'::jsonb) into v_reports
  from jsonb_array_elements(v_reports) x;

  -- 注册申请 24h 未处理自动失效
  select coalesce(jsonb_agg(
    case when x->>'status' = 'pending'
              and v_now - (x->>'createdAt')::bigint > 86400000
         then x || jsonb_build_object('status', 'expired', 'note', '超过 24 小时未处理，申请已自动失效')
         else x end
  ), '[]'::jsonb) into v_regs
  from jsonb_array_elements(coalesce(v_world.registration_requests, '[]'::jsonb)) x;

  update public.world_state
     set missions = v_missions,
         mission_reports = v_reports,
         registration_requests = v_regs,
         notifications = v_notes || coalesce(notifications, '[]'::jsonb),
         updated_at = now()
   where id = 1;

  return jsonb_build_object('ok', true, 'changed', v_changed);
end;
$$;

-- =========================================================
-- 13. 全服广播 / 论坛评论与点赞 / 社交合并
-- =========================================================

-- 13.0 广播列：新广播覆盖展示，但保留最近 50 条历史
alter table public.world_state add column if not exists broadcasts jsonb;

create or replace function public.broadcast_publish(p_text text, p_minutes int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_world public.world_state%rowtype;
  v_text text := btrim(coalesce(p_text, ''));
  v_min int := greatest(1, least(1440, coalesce(p_minutes, 60)));
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_item jsonb;
  v_list jsonb;
  v_me text;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', '需要管理者权限'); end if;
  if v_text = '' then return jsonb_build_object('ok', false, 'error', '广播内容不能为空'); end if;
  if char_length(v_text) > 200 then return jsonb_build_object('ok', false, 'error', '广播最多 200 字'); end if;

  select username into v_me from public.profiles where id = auth.uid();
  select * into v_world from public.world_state where id = 1 for update;
  if not found then return jsonb_build_object('ok', false, 'error', '全服数据未初始化'); end if;

  v_item := jsonb_build_object(
    'id', 'b' || v_now, 'text', v_text, 'at', v_now,
    'by', coalesce(v_me, '管理者'), 'minutes', v_min,
    'expiresAt', v_now + v_min * 60000
  );
  v_list := jsonb_build_array(v_item) || coalesce(v_world.broadcasts, '[]'::jsonb);
  if jsonb_array_length(v_list) > 50 then
    select coalesce(jsonb_agg(e), '[]'::jsonb) into v_list
      from (select e from jsonb_array_elements(v_list) with ordinality t(e, ord) order by ord limit 50) s;
  end if;

  update public.world_state set broadcasts = v_list, updated_at = now() where id = 1;
  return jsonb_build_object('ok', true, 'broadcast', v_item);
end;
$$;

-- 13.1 论坛评论 / 点赞（此前只写本地，跨设备互相看不见）
alter table public.forum_posts add column if not exists comments jsonb not null default '[]'::jsonb;
alter table public.forum_posts add column if not exists liked_by jsonb not null default '[]'::jsonb;

create or replace function public.forum_comment_add(p_post_id uuid, p_text text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_text text := btrim(coalesce(p_text, ''));
  v_me public.profiles%rowtype;
  v_comments jsonb;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', '请先登录'); end if;
  if public.is_banned() then return jsonb_build_object('ok', false, 'error', '该账号已被移出系统'); end if;
  select * into v_me from public.profiles where id = auth.uid();
  if not found then return jsonb_build_object('ok', false, 'error', '缺少成员档案'); end if;
  if v_text = '' then return jsonb_build_object('ok', false, 'error', '评论不能为空'); end if;
  if char_length(v_text) > 300 then return jsonb_build_object('ok', false, 'error', '评论最多 300 字'); end if;

  update public.forum_posts
     set comments = coalesce(comments, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
         'id', 'c' || v_now,
         'author', v_me.display_name,
         'username', v_me.username,
         'role', v_me.role,
         'text', v_text,
         'at', v_now))
   where id = p_post_id
   returning comments into v_comments;

  if v_comments is null then return jsonb_build_object('ok', false, 'error', '帖子不存在'); end if;
  return jsonb_build_object('ok', true, 'comments', v_comments);
end;
$$;

create or replace function public.forum_toggle_like(p_post_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles%rowtype;
  v_liked jsonb;
  v_has boolean;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', '请先登录'); end if;
  if public.is_banned() then return jsonb_build_object('ok', false, 'error', '该账号已被移出系统'); end if;
  select * into v_me from public.profiles where id = auth.uid();
  if not found then return jsonb_build_object('ok', false, 'error', '缺少成员档案'); end if;

  select coalesce(liked_by, '[]'::jsonb) into v_liked
    from public.forum_posts where id = p_post_id for update;
  if v_liked is null then return jsonb_build_object('ok', false, 'error', '帖子不存在'); end if;

  v_has := exists (select 1 from jsonb_array_elements(v_liked) x where x->>'username' = v_me.username);
  if v_has then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_liked
      from jsonb_array_elements(v_liked) x where x->>'username' <> v_me.username;
  else
    v_liked := v_liked || jsonb_build_array(jsonb_build_object('username', v_me.username, 'at', v_now));
  end if;

  update public.forum_posts set liked_by = v_liked, likes = jsonb_array_length(v_liked) where id = p_post_id;
  return jsonb_build_object('ok', true, 'liked', not v_has, 'likes', jsonb_array_length(v_liked));
end;
$$;

-- 13.2 社交快照合并：不再整份覆盖，消息按 id 取并集，避免两台设备互相冲掉
create or replace function public.social_merge(p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cur jsonb;
  v_in jsonb := coalesce(p_data, '{}'::jsonb);
  v_key text;
  v_arr jsonb;
  v_merged jsonb;
  v_social jsonb;
  v_social_in jsonb;
  v_ids jsonb;
  v_item jsonb;
  v_out jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', '请先登录'); end if;
  if public.is_banned() then return jsonb_build_object('ok', false, 'error', '该账号已被移出系统'); end if;

  select coalesce(data, '{}'::jsonb) into v_cur from public.social_state where id = 1 for update;
  if v_cur is null then v_cur := '{}'::jsonb; end if;

  -- 消息：按会话分组，两组消息按 id 取并集并按时间排序
  v_merged := coalesce(v_cur->'msgs', '{}'::jsonb);
  for v_key in select jsonb_object_keys(coalesce(v_in->'msgs', '{}'::jsonb)) loop
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_arr
      from (
        select distinct on (e->>'id') e
          from jsonb_array_elements(
                 coalesce(v_cur->'msgs'->v_key, '[]'::jsonb) || coalesce(v_in->'msgs'->v_key, '[]'::jsonb)
               ) e
         order by e->>'id', (e->>'at')::bigint desc
      ) s (x);
    v_merged := jsonb_set(v_merged, array[v_key], v_arr, true);
  end loop;
  v_out := jsonb_set(coalesce(v_cur, '{}'::jsonb), array['msgs'], v_merged, true);

  -- 好友 / 分组 / 申请 / 标签：对象合并，数组按 id 取并集
  v_social := coalesce(v_out->'social', '{}'::jsonb);
  v_social_in := coalesce(v_in->'social', '{}'::jsonb);

  v_social := jsonb_set(v_social, array['friends'],
    coalesce(v_social->'friends', '{}'::jsonb) || coalesce(v_social_in->'friends', '{}'::jsonb), true);
  v_social := jsonb_set(v_social, array['reads'],
    coalesce(v_social->'reads', '{}'::jsonb) || coalesce(v_social_in->'reads', '{}'::jsonb), true);
  v_social := jsonb_set(v_social, array['presence'],
    coalesce(v_social->'presence', '{}'::jsonb) || coalesce(v_social_in->'presence', '{}'::jsonb), true);
  v_social := jsonb_set(v_social, array['friendSince'],
    coalesce(v_social->'friendSince', '{}'::jsonb) || coalesce(v_social_in->'friendSince', '{}'::jsonb), true);
  v_social := jsonb_set(v_social, array['friendTagOf'],
    coalesce(v_social->'friendTagOf', '{}'::jsonb) || coalesce(v_social_in->'friendTagOf', '{}'::jsonb), true);

  foreach v_key in array array['groups', 'friendRequests', 'groupRequests', 'friendTags'] loop
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_arr
      from (
        select distinct on (e->>'id') e
          from jsonb_array_elements(
                 coalesce(v_social->v_key, '[]'::jsonb) || coalesce(v_social_in->v_key, '[]'::jsonb)
               ) e
         order by e->>'id'
      ) s (x);
    v_social := jsonb_set(v_social, array[v_key], v_arr, true);
  end loop;

  -- 其余标量（v / groupsSeq 等）以传入值为准
  if v_social_in ? 'groupsSeq' then
    v_social := jsonb_set(v_social, array['groupsSeq'], v_social_in->'groupsSeq', true);
  end if;

  v_out := jsonb_set(v_out, array['social'], v_social, true);
  v_out := jsonb_set(v_out, array['v'], to_jsonb(1), true);
  v_out := jsonb_set(v_out, array['updatedAt'],
    to_jsonb((extract(epoch from clock_timestamp()) * 1000)::bigint), true);

  insert into public.social_state (id, data, updated_at)
  values (1, v_out, now())
  on conflict (id) do update set data = excluded.data, updated_at = now();

  return jsonb_build_object('ok', true, 'updatedAt', v_out->'updatedAt');
end;
$$;

revoke all on function public.broadcast_publish(text, int) from public;
revoke all on function public.forum_comment_add(uuid, text) from public;
revoke all on function public.forum_toggle_like(uuid) from public;
revoke all on function public.social_merge(jsonb) from public;
grant execute on function public.broadcast_publish(text, int) to authenticated;
grant execute on function public.forum_comment_add(uuid, text) to authenticated;
grant execute on function public.forum_toggle_like(uuid) to authenticated;
grant execute on function public.social_merge(jsonb) to authenticated;

-- =========================================================
-- 14. 好友申请 / 群组操作 / 论坛楼中楼（服务端原子操作）
-- =========================================================

-- 14.1 发送好友申请
create or replace function public.social_friend_request(p_to text, p_message text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me text;
  v_data jsonb;
  v_social jsonb;
  v_friends jsonb;
  v_reqs jsonb;
  v_to text := btrim(coalesce(p_to, ''));
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_req jsonb;
  v_recent int;
  v_from_name text;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', '请先登录'); end if;
  if public.is_banned() then return jsonb_build_object('ok', false, 'error', '该账号已被移出系统'); end if;
  select username, display_name into v_me, v_from_name from public.profiles where id = auth.uid();
  if v_me is null then return jsonb_build_object('ok', false, 'error', '缺少成员档案'); end if;
  if v_to = '' then return jsonb_build_object('ok', false, 'error', '参数错误'); end if;
  if v_to = v_me then return jsonb_build_object('ok', false, 'error', '不能添加自己为好友'); end if;

  select coalesce(data, '{}'::jsonb) into v_data from public.social_state where id = 1 for update;
  v_social := coalesce(v_data->'social', '{}'::jsonb);
  v_friends := coalesce(v_social->'friends', '{}'::jsonb);
  if exists (select 1 from jsonb_array_elements(coalesce(v_friends->v_me, '[]'::jsonb)) x where x#>>'{}' = v_to) then
    return jsonb_build_object('ok', false, 'error', '你们已经是好友了');
  end if;
  v_reqs := coalesce(v_social->'friendRequests', '[]'::jsonb);
  if exists (select 1 from jsonb_array_elements(v_reqs) r where r->>'from' = v_to and r->>'to' = v_me and r->>'status' = 'pending') then
    return jsonb_build_object('ok', false, 'error', '对方已向你发送好友申请，请到通知中处理');
  end if;
  if exists (select 1 from jsonb_array_elements(v_reqs) r where r->>'from' = v_me and r->>'to' = v_to and r->>'status' = 'pending') then
    return jsonb_build_object('ok', false, 'error', '已发送请求，等待对方同意');
  end if;
  select count(*) into v_recent from jsonb_array_elements(v_reqs) r
   where r->>'from' = v_me and r->>'to' = v_to and v_now - (r->>'createdAt')::bigint < 86400000;
  if v_recent >= 3 then return jsonb_build_object('ok', false, 'error', '申请过于频繁，请明天再试'); end if;

  v_req := jsonb_build_object(
    'id', 'fr' || v_now, 'from', v_me, 'to', v_to,
    'message', left(coalesce(p_message, ''), 50),
    'status', 'pending', 'createdAt', v_now
  );
  v_social := jsonb_set(v_social, array['friendRequests'], jsonb_build_array(v_req) || v_reqs, true);
  v_data := jsonb_set(v_data, array['social'], v_social, true);
  v_data := jsonb_set(v_data, array['updatedAt'], to_jsonb(v_now), true);

  insert into public.social_state (id, data, updated_at) values (1, v_data, now())
  on conflict (id) do update set data = excluded.data, updated_at = now();

  -- 给接收方写一条全服通告，保证不在好友页时也能实时看到“新的密语”提示
  update public.world_state
     set notifications = jsonb_build_array(jsonb_build_object(
           'id', 'n' || v_now || '_friend_req',
           'username', v_to,
           'text', coalesce(v_from_name, v_me) || ' 想与你共谈密语（好友申请）',
           'at', v_now, 'read', false)) || coalesce(notifications, '[]'::jsonb),
         updated_at = now()
   where id = 1;

  return jsonb_build_object('ok', true, 'request', v_req);
end;
$$;

-- 14.2 处理好友申请
create or replace function public.social_friend_respond(p_id text, p_accept boolean, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me text;
  v_data jsonb;
  v_social jsonb;
  v_reqs jsonb;
  v_req jsonb;
  v_friends jsonb;
  v_since jsonb;
  v_a text;
  v_b text;
  v_key text;
  v_me_name text;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_ok boolean := coalesce(p_accept, false);
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', '请先登录'); end if;
  if public.is_banned() then return jsonb_build_object('ok', false, 'error', '该账号已被移出系统'); end if;
  select username into v_me from public.profiles where id = auth.uid();
  if v_me is null then return jsonb_build_object('ok', false, 'error', '缺少成员档案'); end if;

  select coalesce(data, '{}'::jsonb) into v_data from public.social_state where id = 1 for update;
  v_social := coalesce(v_data->'social', '{}'::jsonb);
  v_reqs := coalesce(v_social->'friendRequests', '[]'::jsonb);
  select r into v_req from jsonb_array_elements(v_reqs) r where r->>'id' = p_id limit 1;
  if v_req is null then return jsonb_build_object('ok', false, 'error', '该申请已处理或不存在'); end if;
  if coalesce(v_req->>'status', '') <> 'pending' then
    return jsonb_build_object('ok', false, 'error', '该申请已处理或不存在');
  end if;
  if v_req->>'to' <> v_me then return jsonb_build_object('ok', false, 'error', '无权处理该申请'); end if;

  v_req := v_req || jsonb_build_object(
    'status', case when v_ok then 'accepted' else 'rejected' end,
    'handledAt', v_now,
    'reason', coalesce(p_reason, '')
  );
  select coalesce(jsonb_agg(case when r->>'id' = p_id then v_req else r end), '[]'::jsonb)
    into v_reqs from jsonb_array_elements(v_reqs) r;
  v_social := jsonb_set(v_social, array['friendRequests'], v_reqs, true);

  if v_ok then
    v_a := v_req->>'from';
    v_b := v_req->>'to';
    v_friends := coalesce(v_social->'friends', '{}'::jsonb);
    if not exists (select 1 from jsonb_array_elements(coalesce(v_friends->v_a, '[]'::jsonb)) x where x#>>'{}' = v_b) then
      v_friends := jsonb_set(v_friends, array[v_a],
        coalesce(v_friends->v_a, '[]'::jsonb) || jsonb_build_array(to_jsonb(v_b)), true);
    end if;
    if not exists (select 1 from jsonb_array_elements(coalesce(v_friends->v_b, '[]'::jsonb)) x where x#>>'{}' = v_a) then
      v_friends := jsonb_set(v_friends, array[v_b],
        coalesce(v_friends->v_b, '[]'::jsonb) || jsonb_build_array(to_jsonb(v_a)), true);
    end if;
    v_social := jsonb_set(v_social, array['friends'], v_friends, true);

    v_key := least(v_a, v_b) || '|' || greatest(v_a, v_b);
    v_since := coalesce(v_social->'friendSince', '{}'::jsonb);
    if not (v_since ? v_key) then
      v_since := jsonb_set(v_since, array[v_key], to_jsonb(v_now), true);
    end if;
    v_social := jsonb_set(v_social, array['friendSince'], v_since, true);
  end if;

  v_data := jsonb_set(v_data, array['social'], v_social, true);
  v_data := jsonb_set(v_data, array['updatedAt'], to_jsonb(v_now), true);
  update public.social_state set data = v_data, updated_at = now() where id = 1;

  if v_ok and v_a is not null then
    select display_name into v_me_name from public.profiles where username = v_me;
    update public.world_state
       set notifications = jsonb_build_array(jsonb_build_object(
             'id', 'n' || v_now || '_friend_ok',
             'username', v_a,
             'text', coalesce(v_me_name, v_me) || ' 已同意你的好友申请，现在可以开始密谈了',
             'at', v_now, 'read', false)) || coalesce(notifications, '[]'::jsonb),
           updated_at = now()
     where id = 1;
  end if;

  return jsonb_build_object('ok', true, 'status', v_req->>'status');
end;
$$;

-- 14.3 邀请好友入群
create or replace function public.social_group_invite(p_group_id text, p_targets jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me text;
  v_data jsonb;
  v_social jsonb;
  v_groups jsonb;
  v_g jsonb;
  v_reqs jsonb;
  v_target text;
  v_members jsonb;
  v_added int := 0;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', '请先登录'); end if;
  if public.is_banned() then return jsonb_build_object('ok', false, 'error', '该账号已被移出系统'); end if;
  select username into v_me from public.profiles where id = auth.uid();
  if v_me is null then return jsonb_build_object('ok', false, 'error', '缺少成员档案'); end if;

  select coalesce(data, '{}'::jsonb) into v_data from public.social_state where id = 1 for update;
  v_social := coalesce(v_data->'social', '{}'::jsonb);
  v_groups := coalesce(v_social->'groups', '[]'::jsonb);
  select g into v_g from jsonb_array_elements(v_groups) g where g->>'id' = p_group_id limit 1;
  if v_g is null then return jsonb_build_object('ok', false, 'error', '群聊不存在'); end if;
  if not (coalesce(v_g->'members', '[]'::jsonb) ? v_me) then
    return jsonb_build_object('ok', false, 'error', '无权邀请成员');
  end if;
  if coalesce(v_g->>'status', '') <> 'active' then return jsonb_build_object('ok', false, 'error', '该群聊当前不可邀请'); end if;

  v_reqs := coalesce(v_social->'groupRequests', '[]'::jsonb);
  v_members := coalesce(v_g->'members', '[]'::jsonb);
  for v_target in select jsonb_array_elements_text(coalesce(p_targets, '[]'::jsonb)) loop
    if v_target = '' or (v_members ? v_target) then continue; end if;
    -- NPC 自动同意邀请，直接成为群成员
    if v_target like 'npc\_%' then
      v_members := v_members || jsonb_build_array(to_jsonb(v_target));
      v_added := v_added + 1;
      continue;
    end if;
    if exists (select 1 from jsonb_array_elements(v_reqs) r
                where r->>'groupId' = p_group_id and r->>'from' = v_me and r->>'to' = v_target
                  and r->>'type' = 'invite' and r->>'status' = 'pending') then continue; end if;
    v_reqs := jsonb_build_array(jsonb_build_object(
      'id', 'gr' || v_now || '_' || v_target, 'groupId', p_group_id,
      'from', v_me, 'to', v_target, 'type', 'invite', 'message', '',
      'status', 'pending', 'createdAt', v_now)) || v_reqs;
    v_added := v_added + 1;
  end loop;

  if v_added = 0 then return jsonb_build_object('ok', false, 'error', '请选择要邀请的好友'); end if;

  v_g := v_g || jsonb_build_object('members', v_members);
  select coalesce(jsonb_agg(case when x->>'id' = p_group_id then v_g else x end), '[]'::jsonb)
    into v_groups from jsonb_array_elements(v_groups) x;
  v_social := jsonb_set(v_social, array['groups'], v_groups, true);
  v_social := jsonb_set(v_social, array['groupRequests'], v_reqs, true);
  v_data := jsonb_set(v_data, array['social'], v_social, true);
  v_data := jsonb_set(v_data, array['updatedAt'], to_jsonb(v_now), true);
  update public.social_state set data = v_data, updated_at = now() where id = 1;

  return jsonb_build_object('ok', true, 'added', v_added);
end;
$$;

-- 14.4 申请加入群聊（joinMode=direct 直接进群）
create or replace function public.social_group_apply(p_group_id text, p_message text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me text;
  v_data jsonb;
  v_social jsonb;
  v_groups jsonb;
  v_g jsonb;
  v_reqs jsonb;
  v_members jsonb;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', '请先登录'); end if;
  if public.is_banned() then return jsonb_build_object('ok', false, 'error', '该账号已被移出系统'); end if;
  select username into v_me from public.profiles where id = auth.uid();
  if v_me is null then return jsonb_build_object('ok', false, 'error', '缺少成员档案'); end if;

  select coalesce(data, '{}'::jsonb) into v_data from public.social_state where id = 1 for update;
  v_social := coalesce(v_data->'social', '{}'::jsonb);
  v_groups := coalesce(v_social->'groups', '[]'::jsonb);
  select g into v_g from jsonb_array_elements(v_groups) g where g->>'id' = p_group_id limit 1;
  if v_g is null or coalesce(v_g->>'status', '') <> 'active' then
    return jsonb_build_object('ok', false, 'error', '该群聊不存在或已解散');
  end if;
  if not coalesce((v_g->>'searchable')::boolean, false) then
    return jsonb_build_object('ok', false, 'error', '未找到该群聊');
  end if;
  if coalesce(v_g->'members', '[]'::jsonb) ? v_me then
    return jsonb_build_object('ok', false, 'error', '你已在该群聊中');
  end if;

  v_reqs := coalesce(v_social->'groupRequests', '[]'::jsonb);
  if exists (select 1 from jsonb_array_elements(v_reqs) r
              where r->>'groupId' = p_group_id and r->>'from' = v_me
                and r->>'type' = 'apply' and r->>'status' = 'pending') then
    return jsonb_build_object('ok', false, 'error', '已发送请求，等待群主/管理员同意');
  end if;

  if coalesce(v_g->>'joinMode', '') = 'direct' then
    v_members := coalesce(v_g->'members', '[]'::jsonb) || jsonb_build_array(to_jsonb(v_me));
    v_g := v_g || jsonb_build_object('members', v_members);
    select coalesce(jsonb_agg(case when x->>'id' = p_group_id then v_g else x end), '[]'::jsonb)
      into v_groups from jsonb_array_elements(v_groups) x;
    v_social := jsonb_set(v_social, array['groups'], v_groups, true);
    v_data := jsonb_set(v_data, array['social'], v_social, true);
    v_data := jsonb_set(v_data, array['updatedAt'], to_jsonb(v_now), true);
    update public.social_state set data = v_data, updated_at = now() where id = 1;
    return jsonb_build_object('ok', true, 'direct', true);
  end if;

  v_reqs := jsonb_build_array(jsonb_build_object(
    'id', 'gr' || v_now || '_' || v_me, 'groupId', p_group_id,
    'from', v_me, 'to', coalesce(v_g->>'owner', ''), 'type', 'apply',
    'message', left(coalesce(p_message, ''), 50),
    'status', 'pending', 'createdAt', v_now)) || v_reqs;
  v_social := jsonb_set(v_social, array['groupRequests'], v_reqs, true);
  v_data := jsonb_set(v_data, array['social'], v_social, true);
  v_data := jsonb_set(v_data, array['updatedAt'], to_jsonb(v_now), true);
  update public.social_state set data = v_data, updated_at = now() where id = 1;

  return jsonb_build_object('ok', true, 'status', 'pending');
end;
$$;

-- 14.5 处理入群邀请 / 入群申请
create or replace function public.social_group_respond(p_id text, p_accept boolean, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me text;
  v_data jsonb;
  v_social jsonb;
  v_groups jsonb;
  v_g jsonb;
  v_reqs jsonb;
  v_req jsonb;
  v_joiner text;
  v_members jsonb;
  v_ok boolean := coalesce(p_accept, false);
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_owner text;
  v_admins jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', '请先登录'); end if;
  if public.is_banned() then return jsonb_build_object('ok', false, 'error', '该账号已被移出系统'); end if;
  select username into v_me from public.profiles where id = auth.uid();
  if v_me is null then return jsonb_build_object('ok', false, 'error', '缺少成员档案'); end if;

  select coalesce(data, '{}'::jsonb) into v_data from public.social_state where id = 1 for update;
  v_social := coalesce(v_data->'social', '{}'::jsonb);
  v_reqs := coalesce(v_social->'groupRequests', '[]'::jsonb);
  select r into v_req from jsonb_array_elements(v_reqs) r where r->>'id' = p_id limit 1;
  if v_req is null or coalesce(v_req->>'status', '') <> 'pending' then
    return jsonb_build_object('ok', false, 'error', '该申请已处理或不存在');
  end if;

  v_groups := coalesce(v_social->'groups', '[]'::jsonb);
  select g into v_g from jsonb_array_elements(v_groups) g where g->>'id' = v_req->>'groupId' limit 1;
  if v_g is null or coalesce(v_g->>'status', '') = 'dissolved' then
    return jsonb_build_object('ok', false, 'error', '群聊已解散');
  end if;

  v_owner := coalesce(v_g->>'owner', '');
  v_admins := coalesce(v_g->'admins', '[]'::jsonb);

  if v_req->>'type' = 'invite' then
    if v_me <> (v_req->>'to') then return jsonb_build_object('ok', false, 'error', '无权处理该邀请'); end if;
    v_joiner := v_req->>'to';
  else
    if not (v_me = v_owner or v_admins ? v_me) then
      return jsonb_build_object('ok', false, 'error', '仅群主/管理员可审批入群申请');
    end if;
    v_joiner := v_req->>'from';
  end if;

  v_req := v_req || jsonb_build_object(
    'status', case when v_ok then 'accepted' else 'rejected' end,
    'handledBy', v_me, 'handledAt', v_now, 'reason', coalesce(p_reason, ''));
  select coalesce(jsonb_agg(case when r->>'id' = p_id then v_req else r end), '[]'::jsonb)
    into v_reqs from jsonb_array_elements(v_reqs) r;
  v_social := jsonb_set(v_social, array['groupRequests'], v_reqs, true);

  v_members := coalesce(v_g->'members', '[]'::jsonb);
  if v_ok and not (v_members ? v_joiner) then
    v_members := v_members || jsonb_build_array(to_jsonb(v_joiner));
  end if;
  v_g := v_g || jsonb_build_object('members', v_members);

  -- 组建中的群：人数满 3 立即成立；若已无待处理邀请则判定创建失败
  if coalesce(v_g->>'status', '') = 'inviting' then
    if jsonb_array_length(v_members) >= 3 then
      v_g := v_g || jsonb_build_object('status', 'active', 'activatedAt', v_now);
    elsif not exists (
      select 1 from jsonb_array_elements(v_reqs) r
       where r->>'groupId' = v_g->>'id' and r->>'type' = 'invite' and r->>'status' = 'pending'
    ) then
      v_g := v_g || jsonb_build_object('status', 'failed', 'failedAt', v_now);
    end if;
  end if;

  select coalesce(jsonb_agg(case when x->>'id' = v_g->>'id' then v_g else x end), '[]'::jsonb)
    into v_groups from jsonb_array_elements(v_groups) x;
  v_social := jsonb_set(v_social, array['groups'], v_groups, true);

  v_data := jsonb_set(v_data, array['social'], v_social, true);
  v_data := jsonb_set(v_data, array['updatedAt'], to_jsonb(v_now), true);
  update public.social_state set data = v_data, updated_at = now() where id = 1;

  return jsonb_build_object('ok', true, 'status', v_req->>'status');
end;
$$;

-- 14.6 退出群聊
create or replace function public.social_group_quit(p_group_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me text;
  v_data jsonb;
  v_social jsonb;
  v_groups jsonb;
  v_g jsonb;
  v_members jsonb;
  v_admins jsonb;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', '请先登录'); end if;
  select username into v_me from public.profiles where id = auth.uid();
  if v_me is null then return jsonb_build_object('ok', false, 'error', '缺少成员档案'); end if;

  select coalesce(data, '{}'::jsonb) into v_data from public.social_state where id = 1 for update;
  v_social := coalesce(v_data->'social', '{}'::jsonb);
  v_groups := coalesce(v_social->'groups', '[]'::jsonb);
  select g into v_g from jsonb_array_elements(v_groups) g where g->>'id' = p_group_id limit 1;
  if v_g is null then return jsonb_build_object('ok', false, 'error', '群聊不存在'); end if;
  if coalesce(v_g->>'owner', '') = v_me then
    return jsonb_build_object('ok', false, 'error', '群主不可退出，请解散群聊');
  end if;
  if not (coalesce(v_g->'members', '[]'::jsonb) ? v_me) then
    return jsonb_build_object('ok', false, 'error', '你不在该群聊中');
  end if;

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_members
    from jsonb_array_elements(coalesce(v_g->'members', '[]'::jsonb)) x where x#>>'{}' <> v_me;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_admins
    from jsonb_array_elements(coalesce(v_g->'admins', '[]'::jsonb)) x where x#>>'{}' <> v_me;
  v_g := v_g || jsonb_build_object('members', v_members, 'admins', v_admins);
  select coalesce(jsonb_agg(case when x->>'id' = p_group_id then v_g else x end), '[]'::jsonb)
    into v_groups from jsonb_array_elements(v_groups) x;
  v_social := jsonb_set(v_social, array['groups'], v_groups, true);

  v_data := jsonb_set(v_data, array['social'], v_social, true);
  v_data := jsonb_set(v_data, array['updatedAt'], to_jsonb(v_now), true);
  update public.social_state set data = v_data, updated_at = now() where id = 1;

  return jsonb_build_object('ok', true);
end;
$$;

-- 14.7 论坛评论支持楼中楼
drop function if exists public.forum_comment_add(uuid, text);

create or replace function public.forum_comment_add(p_post_id uuid, p_text text, p_parent_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_text text := btrim(coalesce(p_text, ''));
  v_me public.profiles%rowtype;
  v_comments jsonb;
  v_comment jsonb;
  v_parent text := coalesce(p_parent_id, '');
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', '请先登录'); end if;
  if public.is_banned() then return jsonb_build_object('ok', false, 'error', '该账号已被移出系统'); end if;
  select * into v_me from public.profiles where id = auth.uid();
  if not found then return jsonb_build_object('ok', false, 'error', '缺少成员档案'); end if;
  if v_text = '' then return jsonb_build_object('ok', false, 'error', '评论不能为空'); end if;
  if char_length(v_text) > 300 then return jsonb_build_object('ok', false, 'error', '评论最多 300 字'); end if;

  select coalesce(comments, '[]'::jsonb) into v_comments
    from public.forum_posts where id = p_post_id for update;
  if v_comments is null then return jsonb_build_object('ok', false, 'error', '帖子不存在'); end if;

  v_comment := jsonb_build_object(
    'id', 'c' || v_now, 'author', v_me.display_name, 'username', v_me.username,
    'role', v_me.role, 'text', v_text, 'at', v_now);

  if v_parent = '' then
    v_comments := v_comments || jsonb_build_array(v_comment);
  else
    if not exists (select 1 from jsonb_array_elements(v_comments) x where x->>'id' = v_parent) then
      return jsonb_build_object('ok', false, 'error', '回复的评论不存在');
    end if;
    select coalesce(jsonb_agg(
      case when x->>'id' = v_parent
        then x || jsonb_build_object('replies',
               coalesce(x->'replies', '[]'::jsonb) || jsonb_build_array(v_comment))
        else x end
    ), '[]'::jsonb) into v_comments
    from jsonb_array_elements(v_comments) x;
  end if;

  update public.forum_posts set comments = v_comments where id = p_post_id;
  return jsonb_build_object('ok', true, 'comments', v_comments);
end;
$$;

revoke all on function public.social_friend_request(text, text) from public;
revoke all on function public.social_friend_respond(text, boolean, text) from public;
revoke all on function public.social_group_invite(text, jsonb) from public;
revoke all on function public.social_group_apply(text, text) from public;
revoke all on function public.social_group_respond(text, boolean, text) from public;
revoke all on function public.social_group_quit(text) from public;
revoke all on function public.forum_comment_add(uuid, text, text) from public;
grant execute on function public.social_friend_request(text, text) to authenticated;
grant execute on function public.social_friend_respond(text, boolean, text) to authenticated;
grant execute on function public.social_group_invite(text, jsonb) to authenticated;
grant execute on function public.social_group_apply(text, text) to authenticated;
grant execute on function public.social_group_respond(text, boolean, text) to authenticated;
grant execute on function public.social_group_quit(text) to authenticated;
grant execute on function public.forum_comment_add(uuid, text, text) to authenticated;

-- =========================================================
-- 15. 论坛跨设备字段 / 好友删除 / 群设置原子函数
--     群设置类操作不再依赖整份快照合并：每次只改一个字段，
--     服务端行锁保证多人同时修改时「最后写入并提交者生效」。
-- =========================================================

-- 15.1 论坛帖补字段：此前 section / author_role / views / essence 只存在本机
alter table public.forum_posts add column if not exists section text;
alter table public.forum_posts add column if not exists author_role text;
alter table public.forum_posts add column if not exists views int not null default 0;
alter table public.forum_posts add column if not exists essence boolean not null default false;

-- 15.2 创建群聊（服务端分配群号并生成邀请，避免客户端快照覆盖）
create or replace function public.social_group_create(p_name text, p_targets jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me text;
  v_data jsonb;
  v_social jsonb;
  v_groups jsonb;
  v_reqs jsonb;
  v_targets jsonb := coalesce(p_targets, '[]'::jsonb);
  v_target text;
  v_no bigint;
  v_seq bigint;
  v_gid text;
  v_g jsonb;
  v_name text := btrim(coalesce(p_name, ''));
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', '请先登录'); end if;
  if public.is_banned() then return jsonb_build_object('ok', false, 'error', '该账号已被移出系统'); end if;
  select username into v_me from public.profiles where id = auth.uid();
  if v_me is null then return jsonb_build_object('ok', false, 'error', '缺少成员档案'); end if;
  if jsonb_array_length(v_targets) < 2 then
    return jsonb_build_object('ok', false, 'error', '至少邀请 2 位好友才能创建群聊');
  end if;
  if jsonb_array_length(v_targets) > 50 then
    return jsonb_build_object('ok', false, 'error', '单次最多邀请 50 人');
  end if;

  select coalesce(data, '{}'::jsonb) into v_data from public.social_state where id = 1 for update;
  v_social := coalesce(v_data->'social', '{}'::jsonb);
  v_groups := coalesce(v_social->'groups', '[]'::jsonb);
  v_reqs := coalesce(v_social->'groupRequests', '[]'::jsonb);

  v_seq := coalesce((v_social->>'groupsSeq')::bigint, 100000001);
  v_no := v_seq;
  while exists (select 1 from jsonb_array_elements(v_groups) g where (g->>'no')::bigint = v_no) loop
    v_no := v_no + 1;
  end loop;
  v_seq := v_no + 1;

  v_gid := 'g' || v_now;
  v_g := jsonb_build_object(
    'id', v_gid, 'no', v_no::text,
    'name', case when v_name = '' then (v_me || '的群聊') else left(v_name, 20) end,
    'intro', '', 'notice', '', 'owner', v_me, 'admins', '[]'::jsonb,
    'members', jsonb_build_array(to_jsonb(v_me)),
    'searchable', true, 'joinMode', 'verify',
    'status', 'inviting', 'createdAt', v_now, 'activatedAt', 0
  );

  for v_target in select jsonb_array_elements_text(v_targets) loop
    if v_target = '' or v_target = v_me then continue; end if;
    -- NPC 自动同意：直接入群，不生成等待人工审批的邀请
    if v_target like 'npc\_%' then
      if not (coalesce(v_g->'members', '[]'::jsonb) ? v_target) then
        v_g := jsonb_set(v_g, array['members'],
          coalesce(v_g->'members', '[]'::jsonb) || jsonb_build_array(to_jsonb(v_target)), true);
      end if;
      continue;
    end if;
    if exists (select 1 from jsonb_array_elements(v_reqs) r
                where r->>'groupId' = v_gid and r->>'to' = v_target and r->>'type' = 'invite'
                  and r->>'status' = 'pending') then continue; end if;
    v_reqs := jsonb_build_array(jsonb_build_object(
      'id', 'gr' || v_now || '_' || v_target, 'groupId', v_gid,
      'from', v_me, 'to', v_target, 'type', 'invite', 'message', '',
      'status', 'pending', 'createdAt', v_now)) || v_reqs;
  end loop;

  if jsonb_array_length(coalesce(v_g->'members', '[]'::jsonb)) >= 3 then
    v_g := v_g || jsonb_build_object('status', 'active', 'activatedAt', v_now);
  end if;
  v_groups := v_groups || jsonb_build_array(v_g);

  v_social := jsonb_set(v_social, array['groups'], v_groups, true);
  v_social := jsonb_set(v_social, array['groupRequests'], v_reqs, true);
  v_social := jsonb_set(v_social, array['groupsSeq'], to_jsonb(v_seq), true);
  v_data := jsonb_set(v_data, array['social'], v_social, true);
  v_data := jsonb_set(v_data, array['updatedAt'], to_jsonb(v_now), true);
  update public.social_state set data = v_data, updated_at = now() where id = 1;

  return jsonb_build_object('ok', true, 'group', v_g, 'groupId', v_gid);
end;
$$;

-- 15.3 删除好友（双向解除，消息记录保留）
create or replace function public.social_friend_remove(p_friend text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me text;
  v_friend text := btrim(coalesce(p_friend, ''));
  v_data jsonb;
  v_social jsonb;
  v_friends jsonb;
  v_key text;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', '请先登录'); end if;
  if public.is_banned() then return jsonb_build_object('ok', false, 'error', '该账号已被移出系统'); end if;
  select username into v_me from public.profiles where id = auth.uid();
  if v_me is null then return jsonb_build_object('ok', false, 'error', '缺少成员档案'); end if;
  if v_friend = '' then return jsonb_build_object('ok', false, 'error', '参数错误'); end if;
  if v_friend = v_me then return jsonb_build_object('ok', false, 'error', '不能删除自己'); end if;

  select coalesce(data, '{}'::jsonb) into v_data from public.social_state where id = 1 for update;
  v_social := coalesce(v_data->'social', '{}'::jsonb);
  v_friends := coalesce(v_social->'friends', '{}'::jsonb);
  if not exists (
    select 1 from jsonb_array_elements_text(coalesce(v_friends->v_me, '[]'::jsonb)) x where x = v_friend
  ) then
    return jsonb_build_object('ok', false, 'error', '你们还不是好友');
  end if;

  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_friends
    from jsonb_array_elements_text(coalesce(v_friends->v_me, '[]'::jsonb)) x where x <> v_friend;
  v_social := jsonb_set(v_social, array['friends'], jsonb_set(coalesce(v_social->'friends', '{}'::jsonb), array[v_me], v_friends, true), true);

  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_friends
    from jsonb_array_elements_text(coalesce(v_social->'friends'->v_friend, '[]'::jsonb)) x where x <> v_me;
  v_social := jsonb_set(v_social, array['friends'], jsonb_set(coalesce(v_social->'friends', '{}'::jsonb), array[v_friend], v_friends, true), true);

  v_key := least(v_me, v_friend) || '|' || greatest(v_me, v_friend);
  v_social := jsonb_set(v_social, array['friendSince'], coalesce(v_social->'friendSince', '{}'::jsonb) - v_key, true);

  v_data := jsonb_set(v_data, array['social'], v_social, true);
  v_data := jsonb_set(v_data, array['updatedAt'], to_jsonb(v_now), true);
  update public.social_state set data = v_data, updated_at = now() where id = 1;

  return jsonb_build_object('ok', true);
end;
$$;

-- 15.3 修改群名称 / 公告 / 简介（逐字段原子写入）
create or replace function public.social_group_update(p_group_id text, p_field text, p_value text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me text;
  v_data jsonb;
  v_social jsonb;
  v_groups jsonb;
  v_g jsonb;
  v_field text := lower(btrim(coalesce(p_field, '')));
  v_text text := btrim(coalesce(p_value, ''));
  v_owner text;
  v_admins jsonb;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', '请先登录'); end if;
  if public.is_banned() then return jsonb_build_object('ok', false, 'error', '该账号已被移出系统'); end if;
  select username into v_me from public.profiles where id = auth.uid();
  if v_me is null then return jsonb_build_object('ok', false, 'error', '缺少成员档案'); end if;
  if v_field not in ('name', 'notice', 'intro') then return jsonb_build_object('ok', false, 'error', '不支持的字段'); end if;

  select coalesce(data, '{}'::jsonb) into v_data from public.social_state where id = 1 for update;
  v_social := coalesce(v_data->'social', '{}'::jsonb);
  v_groups := coalesce(v_social->'groups', '[]'::jsonb);
  select g into v_g from jsonb_array_elements(v_groups) g where g->>'id' = p_group_id limit 1;
  if v_g is null then return jsonb_build_object('ok', false, 'error', '群聊不存在'); end if;
  if coalesce(v_g->>'status', '') <> 'active' then return jsonb_build_object('ok', false, 'error', '该群聊当前不可修改'); end if;

  v_owner := coalesce(v_g->>'owner', '');
  v_admins := coalesce(v_g->'admins', '[]'::jsonb);
  if not (v_me = v_owner or v_admins ? v_me) then return jsonb_build_object('ok', false, 'error', '无权修改'); end if;

  if v_field = 'name' then
    if char_length(v_text) < 2 or char_length(v_text) > 20 then
      return jsonb_build_object('ok', false, 'error', '群名称需为 2–20 字');
    end if;
  elsif v_field = 'notice' then
    if char_length(v_text) > 500 then return jsonb_build_object('ok', false, 'error', '群公告最多 500 字'); end if;
  else
    if char_length(v_text) > 300 then return jsonb_build_object('ok', false, 'error', '群简介最多 300 字'); end if;
  end if;

  v_g := jsonb_set(v_g, array[v_field], to_jsonb(v_text), true);
  select coalesce(jsonb_agg(case when x->>'id' = p_group_id then v_g else x end), '[]'::jsonb)
    into v_groups from jsonb_array_elements(v_groups) x;
  v_social := jsonb_set(v_social, array['groups'], v_groups, true);
  v_data := jsonb_set(v_data, array['social'], v_social, true);
  v_data := jsonb_set(v_data, array['updatedAt'], to_jsonb(v_now), true);
  update public.social_state set data = v_data, updated_at = now() where id = 1;

  return jsonb_build_object('ok', true);
end;
$$;

-- 15.4 加群方式 / 群搜索权限（群主专属）
create or replace function public.social_group_policy(p_group_id text, p_key text, p_value jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me text;
  v_data jsonb;
  v_social jsonb;
  v_groups jsonb;
  v_g jsonb;
  v_key text := btrim(coalesce(p_key, ''));
  v_mode text;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', '请先登录'); end if;
  if public.is_banned() then return jsonb_build_object('ok', false, 'error', '该账号已被移出系统'); end if;
  select username into v_me from public.profiles where id = auth.uid();
  if v_me is null then return jsonb_build_object('ok', false, 'error', '缺少成员档案'); end if;

  select coalesce(data, '{}'::jsonb) into v_data from public.social_state where id = 1 for update;
  v_social := coalesce(v_data->'social', '{}'::jsonb);
  v_groups := coalesce(v_social->'groups', '[]'::jsonb);
  select g into v_g from jsonb_array_elements(v_groups) g where g->>'id' = p_group_id limit 1;
  if v_g is null then return jsonb_build_object('ok', false, 'error', '群聊不存在'); end if;
  if coalesce(v_g->>'status', '') <> 'active' then return jsonb_build_object('ok', false, 'error', '该群聊当前不可修改'); end if;
  if coalesce(v_g->>'owner', '') <> v_me then return jsonb_build_object('ok', false, 'error', '仅群主可修改群策略'); end if;

  if v_key = 'joinMode' then
    v_mode := coalesce(p_value #>> '{}', '');
    if v_mode not in ('direct', 'verify') then return jsonb_build_object('ok', false, 'error', '不支持的加群方式'); end if;
    v_g := jsonb_set(v_g, array['joinMode'], to_jsonb(v_mode), true);
  elsif v_key = 'searchable' then
    v_g := jsonb_set(v_g, array['searchable'], to_jsonb(coalesce((p_value #>> '{}')::boolean, false)), true);
  else
    return jsonb_build_object('ok', false, 'error', '不支持的设置项');
  end if;

  select coalesce(jsonb_agg(case when x->>'id' = p_group_id then v_g else x end), '[]'::jsonb)
    into v_groups from jsonb_array_elements(v_groups) x;
  v_social := jsonb_set(v_social, array['groups'], v_groups, true);
  v_data := jsonb_set(v_data, array['social'], v_social, true);
  v_data := jsonb_set(v_data, array['updatedAt'], to_jsonb(v_now), true);
  update public.social_state set data = v_data, updated_at = now() where id = 1;

  return jsonb_build_object('ok', true);
end;
$$;

-- 15.5 任免群管理员（1 群主 + 最多 5 管理员）
create or replace function public.social_group_admin(p_group_id text, p_target text, p_on boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me text;
  v_data jsonb;
  v_social jsonb;
  v_groups jsonb;
  v_g jsonb;
  v_target text := btrim(coalesce(p_target, ''));
  v_admins jsonb;
  v_owner text;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', '请先登录'); end if;
  if public.is_banned() then return jsonb_build_object('ok', false, 'error', '该账号已被移出系统'); end if;
  select username into v_me from public.profiles where id = auth.uid();
  if v_me is null then return jsonb_build_object('ok', false, 'error', '缺少成员档案'); end if;

  select coalesce(data, '{}'::jsonb) into v_data from public.social_state where id = 1 for update;
  v_social := coalesce(v_data->'social', '{}'::jsonb);
  v_groups := coalesce(v_social->'groups', '[]'::jsonb);
  select g into v_g from jsonb_array_elements(v_groups) g where g->>'id' = p_group_id limit 1;
  if v_g is null then return jsonb_build_object('ok', false, 'error', '群聊不存在'); end if;
  if coalesce(v_g->>'status', '') <> 'active' then return jsonb_build_object('ok', false, 'error', '该群聊当前不可修改'); end if;
  v_owner := coalesce(v_g->>'owner', '');
  if v_owner <> v_me then return jsonb_build_object('ok', false, 'error', '仅群主可任免管理员'); end if;
  if v_target = '' then return jsonb_build_object('ok', false, 'error', '参数错误'); end if;
  if v_target = v_owner then return jsonb_build_object('ok', false, 'error', '群主无需设为管理员'); end if;
  if not (coalesce(v_g->'members', '[]'::jsonb) ? v_target) then
    return jsonb_build_object('ok', false, 'error', '该用户不在群内');
  end if;

  v_admins := coalesce(v_g->'admins', '[]'::jsonb);
  if coalesce(p_on, false) then
    if v_admins ? v_target then return jsonb_build_object('ok', false, 'error', '该成员已是管理员'); end if;
    if jsonb_array_length(v_admins) >= 5 then return jsonb_build_object('ok', false, 'error', '管理员名额已满（最多 5 名）'); end if;
    v_admins := v_admins || jsonb_build_array(to_jsonb(v_target));
  else
    select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_admins
      from jsonb_array_elements_text(v_admins) x where x <> v_target;
  end if;

  v_g := jsonb_set(v_g, array['admins'], v_admins, true);
  select coalesce(jsonb_agg(case when x->>'id' = p_group_id then v_g else x end), '[]'::jsonb)
    into v_groups from jsonb_array_elements(v_groups) x;
  v_social := jsonb_set(v_social, array['groups'], v_groups, true);
  v_data := jsonb_set(v_data, array['social'], v_social, true);
  v_data := jsonb_set(v_data, array['updatedAt'], to_jsonb(v_now), true);
  update public.social_state set data = v_data, updated_at = now() where id = 1;

  return jsonb_build_object('ok', true);
end;
$$;

-- 15.6 移出群成员（群主 / 管理员）
create or replace function public.social_group_remove_member(p_group_id text, p_target text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me text;
  v_data jsonb;
  v_social jsonb;
  v_groups jsonb;
  v_g jsonb;
  v_target text := btrim(coalesce(p_target, ''));
  v_owner text;
  v_admins jsonb;
  v_members jsonb;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', '请先登录'); end if;
  if public.is_banned() then return jsonb_build_object('ok', false, 'error', '该账号已被移出系统'); end if;
  select username into v_me from public.profiles where id = auth.uid();
  if v_me is null then return jsonb_build_object('ok', false, 'error', '缺少成员档案'); end if;

  select coalesce(data, '{}'::jsonb) into v_data from public.social_state where id = 1 for update;
  v_social := coalesce(v_data->'social', '{}'::jsonb);
  v_groups := coalesce(v_social->'groups', '[]'::jsonb);
  select g into v_g from jsonb_array_elements(v_groups) g where g->>'id' = p_group_id limit 1;
  if v_g is null then return jsonb_build_object('ok', false, 'error', '群聊不存在'); end if;
  if coalesce(v_g->>'status', '') <> 'active' then return jsonb_build_object('ok', false, 'error', '该群聊当前不可修改'); end if;

  v_owner := coalesce(v_g->>'owner', '');
  v_admins := coalesce(v_g->'admins', '[]'::jsonb);
  if not (v_me = v_owner or v_admins ? v_me) then return jsonb_build_object('ok', false, 'error', '无权移除成员'); end if;
  if v_target = v_owner then return jsonb_build_object('ok', false, 'error', '不能移除群主'); end if;
  if not (coalesce(v_g->'members', '[]'::jsonb) ? v_target) then
    return jsonb_build_object('ok', false, 'error', '该成员不在群内');
  end if;
  if v_me <> v_owner and v_admins ? v_target then
    return jsonb_build_object('ok', false, 'error', '管理员不能移除其他管理员');
  end if;

  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_members
    from jsonb_array_elements_text(coalesce(v_g->'members', '[]'::jsonb)) x where x <> v_target;
  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_admins
    from jsonb_array_elements_text(v_admins) x where x <> v_target;
  v_g := v_g || jsonb_build_object('members', v_members, 'admins', v_admins);

  select coalesce(jsonb_agg(case when x->>'id' = p_group_id then v_g else x end), '[]'::jsonb)
    into v_groups from jsonb_array_elements(v_groups) x;
  v_social := jsonb_set(v_social, array['groups'], v_groups, true);
  v_data := jsonb_set(v_data, array['social'], v_social, true);
  v_data := jsonb_set(v_data, array['updatedAt'], to_jsonb(v_now), true);
  update public.social_state set data = v_data, updated_at = now() where id = 1;

  return jsonb_build_object('ok', true);
end;
$$;

-- 15.7 解散群聊（群主）
create or replace function public.social_group_dissolve(p_group_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me text;
  v_data jsonb;
  v_social jsonb;
  v_groups jsonb;
  v_g jsonb;
  v_reqs jsonb;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', '请先登录'); end if;
  if public.is_banned() then return jsonb_build_object('ok', false, 'error', '该账号已被移出系统'); end if;
  select username into v_me from public.profiles where id = auth.uid();
  if v_me is null then return jsonb_build_object('ok', false, 'error', '缺少成员档案'); end if;

  select coalesce(data, '{}'::jsonb) into v_data from public.social_state where id = 1 for update;
  v_social := coalesce(v_data->'social', '{}'::jsonb);
  v_groups := coalesce(v_social->'groups', '[]'::jsonb);
  select g into v_g from jsonb_array_elements(v_groups) g where g->>'id' = p_group_id limit 1;
  if v_g is null then return jsonb_build_object('ok', false, 'error', '群聊不存在'); end if;
  if coalesce(v_g->>'owner', '') <> v_me then return jsonb_build_object('ok', false, 'error', '仅群主可解散群聊'); end if;

  v_g := v_g || jsonb_build_object('status', 'dissolved', 'dissolvedAt', v_now);
  select coalesce(jsonb_agg(case when x->>'id' = p_group_id then v_g else x end), '[]'::jsonb)
    into v_groups from jsonb_array_elements(v_groups) x;

  select coalesce(jsonb_agg(
    case when r->>'groupId' = p_group_id and r->>'status' = 'pending'
      then r || jsonb_build_object('status', 'expired', 'handledAt', v_now)
      else r end
  ), '[]'::jsonb) into v_reqs
  from jsonb_array_elements(coalesce(v_social->'groupRequests', '[]'::jsonb)) r;

  v_social := jsonb_set(v_social, array['groups'], v_groups, true);
  v_social := jsonb_set(v_social, array['groupRequests'], v_reqs, true);
  v_data := jsonb_set(v_data, array['social'], v_social, true);
  v_data := jsonb_set(v_data, array['updatedAt'], to_jsonb(v_now), true);
  update public.social_state set data = v_data, updated_at = now() where id = 1;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.social_group_create(text, jsonb) from public;
revoke all on function public.social_friend_remove(text) from public;
revoke all on function public.social_group_update(text, text, text) from public;
revoke all on function public.social_group_policy(text, text, jsonb) from public;
revoke all on function public.social_group_admin(text, text, boolean) from public;
revoke all on function public.social_group_remove_member(text, text) from public;
revoke all on function public.social_group_dissolve(text) from public;
grant execute on function public.social_group_create(text, jsonb) to authenticated;
grant execute on function public.social_friend_remove(text) to authenticated;
grant execute on function public.social_group_update(text, text, text) to authenticated;
grant execute on function public.social_group_policy(text, text, jsonb) to authenticated;
grant execute on function public.social_group_admin(text, text, boolean) to authenticated;
grant execute on function public.social_group_remove_member(text, text) to authenticated;
grant execute on function public.social_group_dissolve(text) to authenticated;

-- =========================================================
-- 16. 注册绕过告警（跨设备）
--     玩家未点「向管理者发送请求」直接注册，累计 3 次时服务端写入系统告警，
--     并给所有管理者档案写入未读通告；即使管理者不在同一台设备也能实时看到。
-- =========================================================
alter table public.world_state add column if not exists register_bypass jsonb;

create or replace function public.register_bypass_report(p_username text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_world public.world_state%rowtype;
  v_rb jsonb;
  v_count int;
  v_users jsonb;
  v_alerts jsonb;
  v_notes jsonb;
  v_text text;
  v_name text := left(btrim(coalesce(p_username, '未知')), 20);
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  select * into v_world from public.world_state where id = 1 for update;
  if not found then return jsonb_build_object('ok', false, 'error', '全服数据未初始化'); end if;

  v_rb := coalesce(v_world.register_bypass, '{"count":0,"users":[]}'::jsonb);
  v_count := coalesce((v_rb->>'count')::int, 0) + 1;
  v_users := jsonb_build_array(jsonb_build_object('username', v_name, 'at', v_now))
    || coalesce(v_rb->'users', '[]'::jsonb);
  if jsonb_array_length(v_users) > 50 then
    select coalesce(jsonb_agg(e), '[]'::jsonb) into v_users
      from (select e from jsonb_array_elements(v_users) with ordinality t(e, ord) order by ord limit 50) s;
  end if;
  v_rb := jsonb_build_object('count', v_count, 'users', v_users);

  if v_count >= 3 then
    v_text := '未发送注册审批请求直接注册：' || v_name || '（累计 ' || v_count || ' 次）';
    v_alerts := coalesce(v_world.system_alerts, '[]'::jsonb);
    select coalesce(jsonb_agg(a), '[]'::jsonb) into v_alerts
      from jsonb_array_elements(v_alerts) a where a->>'kind' <> 'register-bypass';
    v_alerts := jsonb_build_array(jsonb_build_object(
      'id', 'sa' || v_now, 'kind', 'register-bypass', 'text', v_text,
      'count', v_count, 'at', v_now, 'read', false)) || v_alerts;
    if jsonb_array_length(v_alerts) > 50 then
      select coalesce(jsonb_agg(e), '[]'::jsonb) into v_alerts
        from (select e from jsonb_array_elements(v_alerts) with ordinality t(e, ord) order by ord limit 50) s;
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'id', 'n' || v_now || '_' || p.username, 'username', p.username,
      'text', '系统告警：' || v_text, 'at', v_now, 'read', false
    )), '[]'::jsonb) into v_notes
    from public.profiles p where p.role = 'admin';
  else
    v_alerts := coalesce(v_world.system_alerts, '[]'::jsonb);
    v_notes := '[]'::jsonb;
  end if;

  update public.world_state
     set register_bypass = v_rb,
         system_alerts = v_alerts,
         notifications = v_notes || coalesce(notifications, '[]'::jsonb),
         updated_at = now()
   where id = 1;

  return jsonb_build_object('ok', true, 'count', v_count, 'alerted', v_count >= 3);
end;
$$;

revoke all on function public.register_bypass_report(text) from public;
grant execute on function public.register_bypass_report(text) to anon, authenticated;

-- =========================================================
-- 17. NPC 好友跨设备 / 论坛浏览数 / 图片与位置
-- =========================================================

-- 17.1 论坛新字段
alter table public.forum_posts add column if not exists images jsonb not null default '[]'::jsonb;
alter table public.forum_posts add column if not exists location jsonb;
alter table public.forum_posts add column if not exists viewed_by jsonb not null default '[]'::jsonb;

-- 17.2 浏览数：同一账号对同一帖子只计一次，服务端原子累加
create or replace function public.forum_view_add(p_post_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me text;
  v_viewed jsonb;
  v_views int;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', '请先登录'); end if;
  if public.is_banned() then return jsonb_build_object('ok', false, 'error', '该账号已被移出系统'); end if;
  select username into v_me from public.profiles where id = auth.uid();
  if v_me is null then return jsonb_build_object('ok', false, 'error', '缺少成员档案'); end if;

  select coalesce(viewed_by, '[]'::jsonb) into v_viewed
    from public.forum_posts where id = p_post_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', '帖子不存在'); end if;

  if not exists (
    select 1 from jsonb_array_elements_text(v_viewed) x where x = v_me
  ) then
    v_viewed := v_viewed || jsonb_build_array(to_jsonb(v_me));
  end if;
  v_views := jsonb_array_length(v_viewed);

  update public.forum_posts
     set viewed_by = v_viewed, views = v_views
   where id = p_post_id;

  return jsonb_build_object('ok', true, 'views', v_views);
end;
$$;

-- 17.3 NPC 好友跨设备（NPC 无 Auth 档案，因此单独存于 social_state.social.npcFriends）
create or replace function public.social_npc_friend_add(p_npc text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me text;
  v_npc text := btrim(coalesce(p_npc, ''));
  v_data jsonb;
  v_social jsonb;
  v_map jsonb;
  v_arr jsonb;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', '请先登录'); end if;
  if public.is_banned() then return jsonb_build_object('ok', false, 'error', '该账号已被移出系统'); end if;
  select username into v_me from public.profiles where id = auth.uid();
  if v_me is null then return jsonb_build_object('ok', false, 'error', '缺少成员档案'); end if;
  if v_npc not like 'npc\_%' then return jsonb_build_object('ok', false, 'error', '不是有效的 NPC'); end if;

  select coalesce(data, '{}'::jsonb) into v_data from public.social_state where id = 1 for update;
  v_social := coalesce(v_data->'social', '{}'::jsonb);
  v_map := coalesce(v_social->'npcFriends', '{}'::jsonb);
  v_arr := coalesce(v_map->v_me, '[]'::jsonb);
  if not exists (select 1 from jsonb_array_elements_text(v_arr) x where x = v_npc) then
    v_arr := v_arr || jsonb_build_array(to_jsonb(v_npc));
  end if;
  v_map := jsonb_set(v_map, array[v_me], v_arr, true);
  v_social := jsonb_set(v_social, array['npcFriends'], v_map, true);
  v_data := jsonb_set(v_data, array['social'], v_social, true);
  v_data := jsonb_set(v_data, array['updatedAt'], to_jsonb(v_now), true);
  update public.social_state set data = v_data, updated_at = now() where id = 1;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.social_npc_friend_remove(p_npc text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me text;
  v_npc text := btrim(coalesce(p_npc, ''));
  v_data jsonb;
  v_social jsonb;
  v_map jsonb;
  v_arr jsonb;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', '请先登录'); end if;
  if public.is_banned() then return jsonb_build_object('ok', false, 'error', '该账号已被移出系统'); end if;
  select username into v_me from public.profiles where id = auth.uid();
  if v_me is null then return jsonb_build_object('ok', false, 'error', '缺少成员档案'); end if;

  select coalesce(data, '{}'::jsonb) into v_data from public.social_state where id = 1 for update;
  v_social := coalesce(v_data->'social', '{}'::jsonb);
  v_map := coalesce(v_social->'npcFriends', '{}'::jsonb);
  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_arr
    from jsonb_array_elements_text(coalesce(v_map->v_me, '[]'::jsonb)) x where x <> v_npc;
  v_map := jsonb_set(v_map, array[v_me], v_arr, true);
  v_social := jsonb_set(v_social, array['npcFriends'], v_map, true);
  v_data := jsonb_set(v_data, array['social'], v_social, true);
  v_data := jsonb_set(v_data, array['updatedAt'], to_jsonb(v_now), true);
  update public.social_state set data = v_data, updated_at = now() where id = 1;
  return jsonb_build_object('ok', true);
end;
$$;

-- 17.4 论坛图片 Storage 桶与策略
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('forum-images', 'forum-images', true, 5242880,
        array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "forum images read" on storage.objects;
create policy "forum images read"
  on storage.objects for select using (bucket_id = 'forum-images');

drop policy if exists "forum images upload" on storage.objects;
create policy "forum images upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'forum-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "forum images delete" on storage.objects;
create policy "forum images delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'forum-images' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

revoke all on function public.forum_view_add(uuid) from public;
revoke all on function public.social_npc_friend_add(text) from public;
revoke all on function public.social_npc_friend_remove(text) from public;
grant execute on function public.forum_view_add(uuid) to authenticated;
grant execute on function public.social_npc_friend_add(text) to authenticated;
grant execute on function public.social_npc_friend_remove(text) to authenticated;

-- 12.7 权限
revoke all on function public.member_ban(text, boolean, text) from public;
revoke all on function public.mission_save(jsonb) from public;
revoke all on function public.mission_delete(text) from public;
revoke all on function public.mission_submit(text, text) from public;
revoke all on function public.mission_review(text, text, text) from public;
revoke all on function public.world_sweep() from public;
grant execute on function public.member_ban(text, boolean, text) to authenticated;
grant execute on function public.mission_save(jsonb) to authenticated;
grant execute on function public.mission_delete(text) to authenticated;
grant execute on function public.mission_submit(text, text) to authenticated;
grant execute on function public.mission_review(text, text, text) to authenticated;
grant execute on function public.world_sweep() to authenticated;
