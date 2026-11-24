/* 神降计划·塔 · PVP 服务端权威表 v1
 *
 * 目标：
 * - 大厅/对局/邀请从「本地快照 + 广播」升级为数据库权威状态；
 * - 前端只读公开表，所有写入走 security definer RPC；
 * - 编成/禁牌/引擎快照放在 pvp_match_secrets，敌方玩家读不到；
 * - 观战页订阅 pvp_matches.public_state 实时同步，不泄露暗牌。
 *
 * 执行方式：Supabase Dashboard → SQL Editor 粘贴执行；
 * 或使用 02_开发工具/构建脚本/apply-supabase-sql.mjs 通过 Management API 执行。
 */

begin;

-- ---------------------------------------------------------------------------
-- 0. 基础 helper
-- ---------------------------------------------------------------------------
create or replace function public.sdj_pvp_username()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.username from public.profiles p where p.id = auth.uid()), '');
$$;

create or replace function public.sdj_pvp_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.role from public.profiles p where p.id = auth.uid()), '');
$$;

create or replace function public.sdj_pvp_display_name(p_username text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select coalesce(p.display_name, p.username) from public.profiles p where p.username = p_username), p_username);
$$;

create or replace function public.sdj_pvp_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.role = 'admin' and not coalesce(p.banned, false)
  );
$$;

-- ---------------------------------------------------------------------------
-- 1. 表结构
-- ---------------------------------------------------------------------------
create table if not exists public.pvp_matches (
  id text primary key,
  name text not null,
  mode text not null default 'ranked' check (mode in ('ranked', 'casual')),
  status text not null default 'waiting' check (status in ('waiting', 'playing', 'finished', 'cancelled')),
  phase text not null default 'referee' check (phase in ('referee', 'partner', 'opponent', 'dice', 'loadout', 'ban', 'battle', 'done')),
  creator text not null,
  referee text,
  teams jsonb not null default '{"A": [], "B": []}'::jsonb,
  public_state jsonb not null default '{}'::jsonb,
  deadline timestamptz,
  engine_id text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pvp_match_secrets (
  match_id text not null references public.pvp_matches(id) on delete cascade,
  team text not null check (team in ('A', 'B')),
  kind text not null check (kind in ('dice', 'loadout', 'ban', 'engine')),
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (match_id, team, kind)
);

create table if not exists public.pvp_invites (
  id uuid primary key default gen_random_uuid(),
  match_id text not null references public.pvp_matches(id) on delete cascade,
  from_user text not null,
  from_name text not null default '',
  to_user text not null,
  kind text not null check (kind in ('referee', 'partner', 'opponent', 'ally')),
  team text check (team in ('A', 'B')),
  role text check (role in ('player', 'contractor')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.pvp_actions (
  id bigserial primary key,
  match_id text not null references public.pvp_matches(id) on delete cascade,
  seq integer not null,
  actor text not null,
  action jsonb not null,
  created_at timestamptz not null default now(),
  unique (match_id, seq)
);

create index if not exists pvp_matches_status_idx on public.pvp_matches (status, mode, created_at desc);
create index if not exists pvp_invites_to_idx on public.pvp_invites (to_user, status, expires_at desc);
create index if not exists pvp_invites_match_idx on public.pvp_invites (match_id, status);
create unique index if not exists pvp_invites_pending_uniq on public.pvp_invites (match_id, to_user) where status = 'pending';

-- 判断某用户是否在某队：返回 'A' / 'B' / ''
create or replace function public.sdj_pvp_member_team(p_match text, p_username text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (
      select 1 from public.pvp_matches m, jsonb_array_elements(coalesce(m.teams->'A', '[]'::jsonb)) e
       where m.id = p_match and e->>'username' = p_username
    ) then 'A'
    when exists (
      select 1 from public.pvp_matches m, jsonb_array_elements(coalesce(m.teams->'B', '[]'::jsonb)) e
       where m.id = p_match and e->>'username' = p_username
    ) then 'B'
    else ''
  end;
$$;

-- ---------------------------------------------------------------------------
-- 2. RLS：直接写表全部禁止，只允许 RPC
-- ---------------------------------------------------------------------------
alter table public.pvp_matches enable row level security;
alter table public.pvp_match_secrets enable row level security;
alter table public.pvp_invites enable row level security;
alter table public.pvp_actions enable row level security;

drop policy if exists pvp_matches_read on public.pvp_matches;
create policy pvp_matches_read
  on public.pvp_matches for select to authenticated
  using (true);

drop policy if exists pvp_secrets_read on public.pvp_match_secrets;
create policy pvp_secrets_read
  on public.pvp_match_secrets for select to authenticated
  using (
    public.sdj_pvp_is_admin()
    or exists (
      select 1 from public.pvp_matches m
       where m.id = match_id and m.referee = public.sdj_pvp_username()
    )
    or (
      kind <> 'engine'
      and public.sdj_pvp_member_team(match_id, public.sdj_pvp_username()) = team
    )
  );

drop policy if exists pvp_invites_read on public.pvp_invites;
create policy pvp_invites_read
  on public.pvp_invites for select to authenticated
  using (
    to_user = public.sdj_pvp_username()
    or from_user = public.sdj_pvp_username()
    or public.sdj_pvp_is_admin()
  );

drop policy if exists pvp_actions_read on public.pvp_actions;
create policy pvp_actions_read
  on public.pvp_actions for select to authenticated
  using (
    public.sdj_pvp_is_admin()
    or exists (
      select 1 from public.pvp_matches m
       where m.id = match_id
         and (m.referee = public.sdj_pvp_username()
              or public.sdj_pvp_member_team(m.id, public.sdj_pvp_username()) <> '')
    )
  );

revoke insert, update, delete on public.pvp_matches from anon, authenticated;
revoke insert, update, delete on public.pvp_match_secrets from anon, authenticated;
revoke insert, update, delete on public.pvp_invites from anon, authenticated;
revoke insert, update, delete on public.pvp_actions from anon, authenticated;

grant select on public.pvp_matches to authenticated;
grant select on public.pvp_match_secrets to authenticated;
grant select on public.pvp_invites to authenticated;
grant select on public.pvp_actions to authenticated;

-- ---------------------------------------------------------------------------
-- 3. 大厅与对局
-- ---------------------------------------------------------------------------
create or replace function public.pvp_match_list(p_mode text default null)
returns setof public.pvp_matches
language sql
stable
security definer
set search_path = public
as $$
  select * from public.pvp_matches
   where status in ('waiting', 'playing')
     and (p_mode is null or mode = p_mode)
   order by created_at desc
   limit 50;
$$;

create or replace function public.pvp_match_create(p_name text, p_mode text default 'ranked')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := public.sdj_pvp_username();
  v_role text := public.sdj_pvp_role();
  v_id text;
  v_name text := btrim(coalesce(p_name, ''));
  v_mode text := case when p_mode = 'casual' then 'casual' else 'ranked' end;
  v_teams jsonb;
  v_match public.pvp_matches%rowtype;
begin
  if v_me = '' then raise exception '未登录'; end if;
  if v_name = '' then raise exception '对局名称不能为空'; end if;
  if v_role not in ('player', 'contractor', 'admin') then raise exception '当前身份不能创建对局'; end if;

  v_id := 'pvp_' || replace(gen_random_uuid()::text, '-', '');

  if v_role = 'admin' then
    v_teams := '{"A": [], "B": []}'::jsonb;
  else
    v_teams := jsonb_build_object(
      'A', jsonb_build_array(jsonb_build_object(
        'username', v_me,
        'name', public.sdj_pvp_display_name(v_me),
        'role', v_role
      )),
      'B', '[]'::jsonb
    );
  end if;

  insert into public.pvp_matches (id, name, mode, creator, teams)
  values (v_id, v_name, v_mode, v_me, v_teams)
  returning * into v_match;

  return to_jsonb(v_match);
end;
$$;

create or replace function public.pvp_match_start(p_match text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := public.sdj_pvp_username();
  v_match public.pvp_matches%rowtype;
  v_a_count int;
  v_b_count int;
  v_a_player boolean;
  v_a_contractor boolean;
  v_b_player boolean;
  v_b_contractor boolean;
begin
  if v_me = '' then raise exception '未登录'; end if;

  select * into v_match from public.pvp_matches where id = p_match for update;
  if not found then raise exception '对局不存在'; end if;
  if v_match.referee is distinct from v_me and not public.sdj_pvp_is_admin() then
    raise exception '只有裁判可以开始对局';
  end if;
  if v_match.status <> 'waiting' then raise exception '对局已经开始'; end if;
  if v_match.referee is null then raise exception '请先确认裁判'; end if;

  v_a_count := jsonb_array_length(coalesce(v_match.teams->'A', '[]'::jsonb));
  v_b_count := jsonb_array_length(coalesce(v_match.teams->'B', '[]'::jsonb));
  v_a_player := exists (select 1 from jsonb_array_elements(coalesce(v_match.teams->'A', '[]'::jsonb)) e where e->>'role' = 'player');
  v_a_contractor := exists (select 1 from jsonb_array_elements(coalesce(v_match.teams->'A', '[]'::jsonb)) e where e->>'role' = 'contractor');
  v_b_player := exists (select 1 from jsonb_array_elements(coalesce(v_match.teams->'B', '[]'::jsonb)) e where e->>'role' = 'player');
  v_b_contractor := exists (select 1 from jsonb_array_elements(coalesce(v_match.teams->'B', '[]'::jsonb)) e where e->>'role' = 'contractor');

  if v_a_count + v_b_count <> 4 or not (v_a_player and v_a_contractor and v_b_player and v_b_contractor) then
    raise exception '尚未满足开始条件';
  end if;

  update public.pvp_matches
     set status = 'playing',
         phase = 'dice',
         deadline = now() + interval '3 minutes',
         public_state = jsonb_build_object(
           'phase', 'dice',
           'round', 0,
           'hp', jsonb_build_object('A', 10, 'B', 10),
           'dice', '{}'::jsonb
         ),
         version = version + 1,
         updated_at = now()
   where id = p_match
   returning * into v_match;

  return to_jsonb(v_match);
end;
$$;

-- 前置阶段提交：dice / loadout / ban
create or replace function public.pvp_phase_submit(
  p_match text,
  p_team text,
  p_kind text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := public.sdj_pvp_username();
  v_role text := public.sdj_pvp_role();
  v_match public.pvp_matches%rowtype;
  v_value int;
  v_a int;
  v_b int;
  v_first text;
  v_done boolean;
  v_state jsonb;
begin
  if v_me = '' then raise exception '未登录'; end if;
  if p_team not in ('A', 'B') then raise exception '队伍无效'; end if;
  if p_kind not in ('dice', 'loadout', 'ban') then raise exception '阶段无效'; end if;

  select * into v_match from public.pvp_matches where id = p_match for update;
  if not found then raise exception '对局不存在'; end if;
  if v_match.status <> 'playing' then raise exception '对局未开始'; end if;
  if v_match.phase <> p_kind then raise exception '当前阶段不能提交该内容'; end if;
  if v_match.deadline is not null and now() > v_match.deadline + interval '5 seconds' then
    raise exception '阶段已超时';
  end if;
  if not (public.sdj_pvp_is_admin() or v_match.referee = v_me
          or public.sdj_pvp_member_team(p_match, v_me) = p_team) then
    raise exception '只能代表本队提交';
  end if;

  if p_kind = 'dice' then
    v_value := 1 + floor(random() * 6)::int;
    p_payload := jsonb_build_object('value', v_value, 'at', extract(epoch from clock_timestamp()) * 1000);
  elsif p_kind = 'loadout' then
    if jsonb_array_length(coalesce(p_payload->'player', '[]'::jsonb)) <> 5
       or jsonb_array_length(coalesce(p_payload->'contractor', '[]'::jsonb)) <> 3 then
      raise exception '编成必须为 5 张玩家卡 + 3 张契约者卡';
    end if;
  elsif p_kind = 'ban' then
    if jsonb_array_length(coalesce(p_payload, '[]'::jsonb)) <> 2 then
      raise exception '每队必须提交 2 个 ban';
    end if;
  end if;

  insert into public.pvp_match_secrets (match_id, team, kind, payload, updated_at)
  values (p_match, p_team, p_kind, p_payload, now())
  on conflict (match_id, team, kind)
  do update set payload = excluded.payload, updated_at = now();

  -- 单方提交后立刻公开「该队已提交」，对手只能看到状态，看不到内容
  if p_kind = 'loadout' then
    update public.pvp_matches
       set public_state = coalesce(public_state, '{}'::jsonb) || jsonb_build_object(
             'loadoutsSubmitted',
             coalesce(public_state->'loadoutsSubmitted', '{}'::jsonb) || jsonb_build_object(p_team, true)
           ),
           updated_at = now()
     where id = p_match;
  elsif p_kind = 'ban' then
    update public.pvp_matches
       set public_state = coalesce(public_state, '{}'::jsonb) || jsonb_build_object(
             'bansSubmitted',
             coalesce(public_state->'bansSubmitted', '{}'::jsonb) || jsonb_build_object(p_team, true)
           ),
           updated_at = now()
     where id = p_match;
  elsif p_kind = 'dice' then
    update public.pvp_matches
       set public_state = coalesce(public_state, '{}'::jsonb) || jsonb_build_object(
             'dice',
             coalesce(public_state->'dice', '{}'::jsonb) || jsonb_build_object(p_team, v_value)
           ),
           updated_at = now()
     where id = p_match;
  end if;

  select count(*) >= 2 into v_done
    from public.pvp_match_secrets
   where match_id = p_match and kind = p_kind;

  if v_done then
    if p_kind = 'dice' then
      select (payload->>'value')::int into v_a
        from public.pvp_match_secrets
       where match_id = p_match and team = 'A' and kind = 'dice';
      select (payload->>'value')::int into v_b
        from public.pvp_match_secrets
       where match_id = p_match and team = 'B' and kind = 'dice';
      if v_a = v_b then
        v_b := (v_b % 6) + 1;
        update public.pvp_match_secrets
           set payload = jsonb_set(payload, '{value}', to_jsonb(v_b)), updated_at = now()
         where match_id = p_match and team = 'B' and kind = 'dice';
      end if;
      v_first := case when v_a < v_b then 'A' else 'B' end;
      update public.pvp_matches
         set phase = 'loadout',
             deadline = now() + interval '10 minutes',
             public_state = coalesce(public_state, '{}'::jsonb) || jsonb_build_object(
               'dice', jsonb_build_object('A', v_a, 'B', v_b),
               'first', v_first,
               'phase', 'loadout'
             ),
             version = version + 1,
             updated_at = now()
       where id = p_match
       returning * into v_match;
    elsif p_kind = 'loadout' then
      update public.pvp_matches
         set phase = 'ban',
             deadline = now() + interval '5 minutes',
             public_state = coalesce(public_state, '{}'::jsonb) || jsonb_build_object(
               'loadoutsSubmitted', jsonb_build_object('A', true, 'B', true),
               'phase', 'ban'
             ),
             version = version + 1,
             updated_at = now()
       where id = p_match
       returning * into v_match;
    else
      update public.pvp_matches
         set phase = 'battle',
             deadline = null,
             public_state = coalesce(public_state, '{}'::jsonb) || jsonb_build_object(
               'bansSubmitted', jsonb_build_object('A', true, 'B', true),
               'revealBans', true,
               'phase', 'battle'
             ),
             version = version + 1,
             updated_at = now()
       where id = p_match
       returning * into v_match;
    end if;
  end if;

  return jsonb_build_object(
    'match', to_jsonb(v_match),
    'team', p_team,
    'kind', p_kind,
    'value', v_value,
    'first', v_first
  );
end;
$$;

-- 裁判发布观战公开状态（只接受白名单字段，避免暗牌泄露）
create or replace function public.pvp_referee_publish(p_match text, p_public jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := public.sdj_pvp_username();
  v_match public.pvp_matches%rowtype;
  v_state jsonb;
  v_round int;
  v_reveal boolean;
begin
  select * into v_match from public.pvp_matches where id = p_match for update;
  if not found then raise exception '对局不存在'; end if;
  if v_match.referee is distinct from v_me and not public.sdj_pvp_is_admin() then
    raise exception '只有裁判可以发布观战状态';
  end if;

  v_round := coalesce(nullif(p_public->>'round', '')::int, 0);
  v_reveal := coalesce((p_public->>'revealBans')::boolean, false);

  v_state := jsonb_build_object(
    'phase', coalesce(p_public->>'phase', v_match.phase),
    'round', v_round,
    'turnSide', nullif(p_public->>'turnSide', ''),
    'hp', coalesce(p_public->'hp', '{}'::jsonb),
    'statuses', coalesce(p_public->'statuses', '{}'::jsonb),
    'log', coalesce(p_public->'log', '[]'::jsonb),
    'winner', p_public->'winner',
    'revealBans', v_reveal,
    'bans', case when v_reveal then coalesce(p_public->'bans', '{}'::jsonb) else '{}'::jsonb end
  );

  update public.pvp_matches
     set public_state = coalesce(public_state, '{}'::jsonb) || v_state,
         version = version + 1,
         updated_at = now()
   where id = p_match
   returning * into v_match;

  return to_jsonb(v_match);
end;
$$;

-- 引擎快照：任意已加入成员在对局进入 battle 后可发布一次；只有裁判/管理员能读取
create or replace function public.pvp_engine_publish(p_match text, p_engine jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := public.sdj_pvp_username();
  v_match public.pvp_matches%rowtype;
begin
  select * into v_match from public.pvp_matches where id = p_match for update;
  if not found then raise exception '对局不存在'; end if;
  if v_match.phase <> 'battle' then raise exception '对局尚未进入战斗阶段'; end if;
  if not (public.sdj_pvp_is_admin() or v_match.referee = v_me) then
    raise exception '只有裁判可以发布引擎快照';
  end if;

  insert into public.pvp_match_secrets (match_id, team, kind, payload, updated_at)
  values (p_match, 'A', 'engine', p_engine, now())
  on conflict (match_id, team, kind)
  do update set payload = excluded.payload, updated_at = now();

  return jsonb_build_object('ok', true, 'match_id', p_match);
end;
$$;

create or replace function public.pvp_engine_get(p_match text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me text := public.sdj_pvp_username();
  v_match public.pvp_matches%rowtype;
  v_payload jsonb;
begin
  select * into v_match from public.pvp_matches where id = p_match;
  if not found then raise exception '对局不存在'; end if;
  if v_match.referee is distinct from v_me and not public.sdj_pvp_is_admin() then
    raise exception '只有裁判可以读取引擎快照';
  end if;
  select payload into v_payload
    from public.pvp_match_secrets
   where match_id = p_match and kind = 'engine'
   limit 1;
  return v_payload;
end;
$$;

-- 裁判建引擎所需的双方暗牌数据（只有裁判/管理员可读）
create or replace function public.pvp_engine_data(p_match text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me text := public.sdj_pvp_username();
  v_match public.pvp_matches%rowtype;
  v_loadout_a jsonb;
  v_loadout_b jsonb;
  v_ban_a jsonb;
  v_ban_b jsonb;
begin
  select * into v_match from public.pvp_matches where id = p_match;
  if not found then raise exception '对局不存在'; end if;
  if v_match.referee is distinct from v_me and not public.sdj_pvp_is_admin() then
    raise exception '只有裁判可以读取暗牌数据';
  end if;

  select payload into v_loadout_a from public.pvp_match_secrets
   where match_id = p_match and team = 'A' and kind = 'loadout' limit 1;
  select payload into v_loadout_b from public.pvp_match_secrets
   where match_id = p_match and team = 'B' and kind = 'loadout' limit 1;
  select payload into v_ban_a from public.pvp_match_secrets
   where match_id = p_match and team = 'A' and kind = 'ban' limit 1;
  select payload into v_ban_b from public.pvp_match_secrets
   where match_id = p_match and team = 'B' and kind = 'ban' limit 1;

  return jsonb_build_object(
    'match', to_jsonb(v_match),
    'loadouts', jsonb_build_object(
      'A', coalesce(v_loadout_a, '{"player": [], "contractor": []}'::jsonb),
      'B', coalesce(v_loadout_b, '{"player": [], "contractor": []}'::jsonb)
    ),
    'bans', jsonb_build_object(
      'A', coalesce(v_ban_a, '[]'::jsonb),
      'B', coalesce(v_ban_b, '[]'::jsonb)
    ),
    'first', coalesce(v_match.public_state->>'first', 'A'),
    'dice', coalesce(v_match.public_state->'dice', '{}'::jsonb)
  );
end;
$$;

create or replace function public.pvp_spectator_snapshot(p_match text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(m) from public.pvp_matches m where m.id = p_match;
$$;

-- ---------------------------------------------------------------------------
-- 4. 邀请
-- ---------------------------------------------------------------------------
create or replace function public.pvp_invite_create(
  p_match text,
  p_to text,
  p_kind text,
  p_team text default null,
  p_role text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := public.sdj_pvp_username();
  v_match public.pvp_matches%rowtype;
  v_to_role text;
  v_count int;
  v_team_count int;
  v_id uuid;
begin
  if v_me = '' then raise exception '未登录'; end if;
  if p_kind not in ('referee', 'partner', 'opponent', 'ally') then raise exception '邀请类型无效'; end if;
  if p_to is null or btrim(p_to) = '' or p_to = v_me then raise exception '邀请对象无效'; end if;

  select * into v_match from public.pvp_matches where id = p_match for update;
  if not found then raise exception '对局不存在'; end if;
  if v_match.status <> 'waiting' then raise exception '对局已经开始'; end if;
  if not (v_match.creator = v_me or public.sdj_pvp_is_admin()
          or public.sdj_pvp_member_team(p_match, v_me) <> '') then
    raise exception '你不是该对局成员';
  end if;

  select p.role into v_to_role from public.profiles p where p.username = p_to;
  if v_to_role is null then raise exception '被邀请用户不存在'; end if;

  if p_kind = 'referee' then
    if v_to_role <> 'admin' then raise exception '只有管理者可以担任裁判'; end if;
    if v_match.referee is not null and v_match.referee <> p_to then
      raise exception '该对局已有裁判';
    end if;
  else
    if v_match.referee is null then raise exception '请先邀请裁判并等待确认'; end if;
    if p_role not in ('player', 'contractor') then raise exception '邀请缺少角色'; end if;
    if p_team not in ('A', 'B') then raise exception '邀请缺少队伍'; end if;
    if v_to_role <> p_role then raise exception '角色不匹配'; end if;

    v_count := jsonb_array_length(coalesce(v_match.teams->'A', '[]'::jsonb))
             + jsonb_array_length(coalesce(v_match.teams->'B', '[]'::jsonb));
    if v_count >= 4 then raise exception '对局已满员'; end if;

    v_team_count := jsonb_array_length(coalesce(v_match.teams->p_team, '[]'::jsonb));
    if v_team_count >= 2 then raise exception '该队伍已满员'; end if;
    if exists (
      select 1 from jsonb_array_elements(coalesce(v_match.teams->p_team, '[]'::jsonb)) e
       where e->>'role' = p_role
    ) then
      raise exception '该位置已有同角色成员';
    end if;
    if public.sdj_pvp_member_team(p_match, p_to) <> '' then
      raise exception '对方已在对局中';
    end if;
  end if;

  insert into public.pvp_invites (match_id, from_user, from_name, to_user, kind, team, role, expires_at)
  values (p_match, v_me, public.sdj_pvp_display_name(v_me), p_to, p_kind, p_team, p_role, now() + interval '60 seconds')
  on conflict (match_id, to_user) where status = 'pending'
  do update set
    from_user = excluded.from_user,
    from_name = excluded.from_name,
    kind = excluded.kind,
    team = excluded.team,
    role = excluded.role,
    expires_at = excluded.expires_at
  returning id into v_id;

  return jsonb_build_object(
    'invite_id', v_id,
    'expires_at', (now() + interval '60 seconds'),
    'match_id', p_match
  );
end;
$$;

create or replace function public.pvp_invite_respond(p_invite uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := public.sdj_pvp_username();
  v_role text := public.sdj_pvp_role();
  v_inv public.pvp_invites%rowtype;
  v_match public.pvp_matches%rowtype;
  v_count int;
  v_team_count int;
  v_teams jsonb;
  v_phase text;
  v_name text;
begin
  if v_me = '' then raise exception '未登录'; end if;

  select * into v_inv from public.pvp_invites where id = p_invite for update;
  if not found then raise exception '邀请不存在'; end if;
  if v_inv.to_user <> v_me then raise exception '这不是发给你的邀请'; end if;
  if v_inv.status <> 'pending' then raise exception '邀请已处理'; end if;
  if v_inv.expires_at < now() then
    update public.pvp_invites set status = 'expired' where id = p_invite;
    raise exception '邀请已超时';
  end if;

  select * into v_match from public.pvp_matches where id = v_inv.match_id for update;
  if not found then raise exception '对局不存在'; end if;
  if v_match.status <> 'waiting' then
    update public.pvp_invites set status = 'expired' where id = p_invite;
    raise exception '对局已经开始，邀请已失效';
  end if;

  if not p_accept then
    update public.pvp_invites set status = 'rejected' where id = p_invite;
    return jsonb_build_object('accepted', false, 'match', to_jsonb(v_match));
  end if;

  if v_inv.kind = 'referee' then
    if v_role <> 'admin' then raise exception '只有管理者可以担任裁判'; end if;
    if v_match.referee is not null and v_match.referee <> v_me then
      raise exception '该对局已有裁判';
    end if;
    update public.pvp_matches
       set referee = v_me,
           phase = case when phase = 'referee' then 'partner' else phase end,
           version = version + 1,
           updated_at = now()
     where id = v_match.id
     returning * into v_match;
  else
    if v_match.referee is null then raise exception '裁判尚未确认'; end if;

    v_count := jsonb_array_length(coalesce(v_match.teams->'A', '[]'::jsonb))
             + jsonb_array_length(coalesce(v_match.teams->'B', '[]'::jsonb));
    if v_count >= 4 then raise exception '哎呀，来晚一步，对局已经满员啦'; end if;
    if public.sdj_pvp_member_team(v_match.id, v_me) <> '' then raise exception '你已在对局中'; end if;
    if v_inv.team not in ('A', 'B') then raise exception '邀请队伍无效'; end if;
    if v_role not in ('player', 'contractor') then raise exception '当前身份不能加入对局'; end if;
    if v_inv.role is not null and v_inv.role <> v_role then raise exception '角色不匹配'; end if;

    v_team_count := jsonb_array_length(coalesce(v_match.teams->v_inv.team, '[]'::jsonb));
    if v_team_count >= 2 then raise exception '哎呀，来晚一步，对局已经满员啦'; end if;
    if exists (
      select 1 from jsonb_array_elements(coalesce(v_match.teams->v_inv.team, '[]'::jsonb)) e
       where e->>'role' = v_role
    ) then
      raise exception '该位置已有同角色成员';
    end if;

    v_name := public.sdj_pvp_display_name(v_me);
    v_teams := jsonb_set(
      v_match.teams,
      array[v_inv.team],
      coalesce(v_match.teams->v_inv.team, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'username', v_me,
        'name', v_name,
        'role', v_role
      )),
      true
    );

    v_phase := v_match.phase;
    if exists (select 1 from jsonb_array_elements(coalesce(v_teams->'A', '[]'::jsonb)) e where e->>'role' = 'player')
       and exists (select 1 from jsonb_array_elements(coalesce(v_teams->'A', '[]'::jsonb)) e where e->>'role' = 'contractor')
       and exists (select 1 from jsonb_array_elements(coalesce(v_teams->'B', '[]'::jsonb)) e where e->>'role' = 'player')
       and exists (select 1 from jsonb_array_elements(coalesce(v_teams->'B', '[]'::jsonb)) e where e->>'role' = 'contractor') then
      v_phase := 'opponent';
    end if;

    update public.pvp_matches
       set teams = v_teams,
           phase = v_phase,
           version = version + 1,
           updated_at = now()
     where id = v_match.id
     returning * into v_match;
  end if;

  update public.pvp_invites set status = 'accepted' where id = p_invite;

  return jsonb_build_object(
    'accepted', true,
    'invite', jsonb_build_object('kind', v_inv.kind, 'team', v_inv.team, 'role', v_inv.role),
    'match', to_jsonb(v_match)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Realtime：公开对局 + 邀请
-- ---------------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.pvp_matches;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.pvp_invites;
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 6. 权限
-- ---------------------------------------------------------------------------
revoke all on function public.pvp_match_list(text) from public;
revoke all on function public.pvp_match_create(text, text) from public;
revoke all on function public.pvp_match_start(text) from public;
revoke all on function public.pvp_phase_submit(text, text, text, jsonb) from public;
revoke all on function public.pvp_referee_publish(text, jsonb) from public;
revoke all on function public.pvp_engine_publish(text, jsonb) from public;
revoke all on function public.pvp_engine_get(text) from public;
revoke all on function public.pvp_engine_data(text) from public;
revoke all on function public.pvp_spectator_snapshot(text) from public;
revoke all on function public.pvp_invite_create(text, text, text, text, text) from public;
revoke all on function public.pvp_invite_respond(uuid, boolean) from public;

grant execute on function public.pvp_match_list(text) to authenticated;
grant execute on function public.pvp_match_create(text, text) to authenticated;
grant execute on function public.pvp_match_start(text) to authenticated;
grant execute on function public.pvp_phase_submit(text, text, text, jsonb) to authenticated;
grant execute on function public.pvp_referee_publish(text, jsonb) to authenticated;
grant execute on function public.pvp_engine_publish(text, jsonb) to authenticated;
grant execute on function public.pvp_engine_get(text) to authenticated;
grant execute on function public.pvp_engine_data(text) to authenticated;
grant execute on function public.pvp_spectator_snapshot(text) to authenticated;
grant execute on function public.pvp_invite_create(text, text, text, text, text) to authenticated;
grant execute on function public.pvp_invite_respond(uuid, boolean) to authenticated;

commit;
