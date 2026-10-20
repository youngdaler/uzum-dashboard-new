-- Shared dashboard for up to 3 separately authenticated users.
-- Apply AFTER 0001_schema.sql. All existing owner-owned records are preserved.
-- Owners and members share the owner_id as the canonical user_id of business data.

create table public.workspace_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','member')),
  created_at timestamptz not null default now(),
  constraint workspace_owner_consistency check
    ((role = 'owner' and user_id = owner_id) or (role = 'member' and user_id <> owner_id))
);
create index workspace_members_owner_idx on public.workspace_members(owner_id);

-- Auto-create personal workspace for new signups; existing users are backfilled.
create or replace function public.create_personal_workspace()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.workspace_members(user_id,owner_id,role)
  values (new.id,new.id,'owner') on conflict (user_id) do nothing;
  return new;
end $$;
create trigger on_auth_user_workspace after insert on auth.users
  for each row execute function public.create_personal_workspace();
insert into public.workspace_members (user_id,owner_id,role)
select id,id,'owner' from auth.users on conflict (user_id) do nothing;

-- Limit the shared dashboard to 3 logins including its owner.
create or replace function public.enforce_workspace_limit()
returns trigger language plpgsql set search_path = '' as $$
declare member_count integer;
begin
  -- Serialize concurrent membership changes per owner.
  perform pg_advisory_xact_lock(hashtextextended(new.owner_id::text, 0));
  select count(*) into member_count from public.workspace_members
    where owner_id = new.owner_id and user_id <> new.user_id;
  if member_count >= 3 then raise exception 'В одном рабочем пространстве допускается максимум 3 пользователя'; end if;
  if new.role = 'member' and not exists (
    select 1 from public.workspace_members m
    where m.user_id = new.owner_id and m.owner_id = new.owner_id and m.role = 'owner'
  ) then raise exception 'Рабочее пространство владельца не найдено'; end if;
  return new;
end $$;
create trigger workspace_limit before insert or update of owner_id on public.workspace_members
  for each row execute function public.enforce_workspace_limit();

-- RLS membership visibility: signed-in user can only inspect own membership.
alter table public.workspace_members enable row level security;
create policy workspace_members_read on public.workspace_members
  for select to authenticated using (user_id = (select auth.uid()));
-- No client-side membership editing: link staff via SQL editor (see README).
revoke insert, update, delete on public.workspace_members from anon, authenticated;
grant select on public.workspace_members to authenticated;

-- Security-definer reads membership without recursive RLS, scoped to current JWT.
create schema if not exists private;
create or replace function private.current_workspace_owner()
returns uuid language sql stable security definer set search_path = '' as $$
  select m.owner_id from public.workspace_members m
  where m.user_id = (select auth.uid())
$$;
revoke all on function private.current_workspace_owner() from public;
grant usage on schema private to authenticated;
grant execute on function private.current_workspace_owner() to authenticated;

-- Owner and members share full access to business data.
drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_insert on public.profiles;
drop policy if exists profiles_update on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select private.current_workspace_owner()));
-- A user's profile is created by the auth trigger, never from browser for teammates.
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select private.current_workspace_owner()))
  with check (id = (select private.current_workspace_owner()));

do $$
declare t text;
begin
  foreach t in array array[
    'categories','suppliers','products','purchase_batches','purchase_batch_items',
    'expenses','expense_allocations','sales','sale_items','inventory_movements',
    'returns','exchange_rates','marketplace_fee_settings','payments','product_evaluations'
  ] loop
    execute format('drop policy if exists %I on public.%I',t || '_select',t);
    execute format('drop policy if exists %I on public.%I',t || '_insert',t);
    execute format('drop policy if exists %I on public.%I',t || '_update',t);
    execute format('drop policy if exists %I on public.%I',t || '_delete',t);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select private.current_workspace_owner()))',t || '_select',t);
    execute format('create policy %I on public.%I for insert to authenticated with check (user_id = (select private.current_workspace_owner()))',t || '_insert',t);
    execute format('create policy %I on public.%I for update to authenticated using (user_id = (select private.current_workspace_owner())) with check (user_id = (select private.current_workspace_owner()))',t || '_update',t);
    execute format('create policy %I on public.%I for delete to authenticated using (user_id = (select private.current_workspace_owner()))',t || '_delete',t);
  end loop;
end $$;
