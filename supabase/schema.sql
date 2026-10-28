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
