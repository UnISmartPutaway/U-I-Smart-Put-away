create table if not exists public.smart_location_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  display_name text not null,
  role text not null check (role in ('ADMIN', 'MOVER', 'LIFTER'))
);

create table if not exists public.putaway_tasks (
  id text primary key,
  location_id text not null,
  status text not null check (status in ('WAITING_MOVE', 'WAITING_LIFT', 'LIFTING_ACTIVE', 'COMPLETED')),
  task jsonb not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (task->>'id' = id),
  check (task->>'locationId' = location_id),
  check (task->>'status' = status)
);

create unique index if not exists putaway_tasks_one_active_per_location
  on public.putaway_tasks (location_id)
  where status <> 'COMPLETED';

create table if not exists public.putaway_incidents (
  id text primary key,
  task_id text not null references public.putaway_tasks(id),
  incident jsonb not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (incident->>'id' = id),
  check (incident->>'taskId' = task_id)
);

create or replace function public.current_smart_location_user()
returns public.smart_location_users
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u
  from public.smart_location_users u
  where u.user_id = auth.uid()
$$;

revoke all on function public.current_smart_location_user() from public;
grant execute on function public.current_smart_location_user() to authenticated;
grant usage on schema public to authenticated;
grant select on public.smart_location_users to authenticated;
grant select, insert, update on public.putaway_tasks to authenticated;
grant select, insert on public.putaway_incidents to authenticated;

create or replace function public.validate_putaway_task_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  app_user public.smart_location_users;
  old_events jsonb;
  new_events jsonb;
  new_event jsonb;
  next_status text;
begin
  select * into app_user
  from public.smart_location_users
  where user_id = auth.uid();

  if app_user.user_id is null then
    raise exception 'No warehouse role assigned to this account';
  end if;

  if tg_op = 'INSERT' then
    if app_user.role <> 'ADMIN' or new.created_by <> auth.uid() then
      raise exception 'Only an admin can create put-away tasks';
    end if;
    if new.status <> 'WAITING_MOVE'
      or jsonb_typeof(new.task->'events') <> 'array'
      or jsonb_array_length(new.task->'events') <> 1 then
      raise exception 'A new task must start in the waiting-for-move state';
    end if;
    new_event := new.task->'events'->0;
    if new_event->>'status' is distinct from 'WAITING_MOVE'
      or new_event->>'actorUsername' is distinct from app_user.username
      or new_event->>'actorName' is distinct from app_user.display_name then
      raise exception 'Initial workflow event does not match the signed-in account';
    end if;
    if new.task->>'createdByUsername' is distinct from app_user.username
      or new.task->>'createdByName' is distinct from app_user.display_name then
      raise exception 'Task creator does not match the signed-in account';
    end if;
    new.created_at := now();
    return new;
  end if;

  if new.task - array['status', 'events', 'updatedAt']::text[]
    is distinct from old.task - array['status', 'events', 'updatedAt']::text[] then
    raise exception 'Task details cannot be edited during a workflow transition';
  end if;

  if new.created_by <> old.created_by or new.location_id <> old.location_id or new.id <> old.id then
    raise exception 'Task identity and reservation cannot be changed';
  end if;
  new.created_at := old.created_at;

  if app_user.role = 'MOVER'
    and old.status = 'WAITING_MOVE'
    and new.status = 'WAITING_LIFT' then
    next_status := 'WAITING_LIFT';
  elsif app_user.role = 'LIFTER'
    and old.status = 'WAITING_LIFT'
    and new.status = 'LIFTING_ACTIVE' then
    next_status := 'LIFTING_ACTIVE';
  elsif app_user.role = 'LIFTER'
    and old.status = 'LIFTING_ACTIVE'
    and new.status = 'COMPLETED' then
    next_status := 'COMPLETED';
  else
    raise exception 'This account cannot perform the requested workflow transition';
  end if;

  old_events := coalesce(old.task->'events', '[]'::jsonb);
  new_events := coalesce(new.task->'events', '[]'::jsonb);
  if jsonb_typeof(new_events) <> 'array'
    or jsonb_array_length(new_events) <> jsonb_array_length(old_events) + 1
    or new_events - (jsonb_array_length(new_events) - 1) <> old_events then
    raise exception 'A workflow transition must append exactly one event';
  end if;

  new_event := new_events->(jsonb_array_length(new_events) - 1);
  if new_event->>'status' is distinct from next_status
    or new_event->>'actorUsername' is distinct from app_user.username
    or new_event->>'actorName' is distinct from app_user.display_name then
    raise exception 'Workflow event does not match the signed-in account';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists validate_putaway_task_write on public.putaway_tasks;
create trigger validate_putaway_task_write
before insert or update on public.putaway_tasks
for each row execute function public.validate_putaway_task_write();

create or replace function public.validate_putaway_incident_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  app_user public.smart_location_users;
begin
  select * into app_user
  from public.smart_location_users
  where user_id = auth.uid();

  if app_user.user_id is null
    or app_user.role not in ('MOVER', 'LIFTER')
    or new.created_by <> auth.uid()
    or new.incident->>'employeeUsername' is distinct from app_user.username
    or new.incident->>'employeeName' is distinct from app_user.display_name
    or new.incident->>'reportedByRole' is distinct from app_user.role then
    raise exception 'Incident reporter does not match the signed-in account';
  end if;

  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists validate_putaway_incident_write on public.putaway_incidents;
create trigger validate_putaway_incident_write
before insert on public.putaway_incidents
for each row execute function public.validate_putaway_incident_write();

alter table public.smart_location_users enable row level security;
alter table public.putaway_tasks enable row level security;
alter table public.putaway_incidents enable row level security;

drop policy if exists "Users can read their own warehouse profile" on public.smart_location_users;
create policy "Users can read their own warehouse profile"
  on public.smart_location_users for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Authenticated users can read put-away tasks" on public.putaway_tasks;
create policy "Authenticated users can read put-away tasks"
  on public.putaway_tasks for select to authenticated
  using ((public.current_smart_location_user()).user_id is not null);

drop policy if exists "Admins can create put-away tasks" on public.putaway_tasks;
create policy "Admins can create put-away tasks"
  on public.putaway_tasks for insert to authenticated
  with check ((public.current_smart_location_user()).role = 'ADMIN');

drop policy if exists "Warehouse workers can advance put-away tasks" on public.putaway_tasks;
create policy "Warehouse workers can advance put-away tasks"
  on public.putaway_tasks for update to authenticated
  using ((public.current_smart_location_user()).role in ('MOVER', 'LIFTER'))
  with check ((public.current_smart_location_user()).role in ('MOVER', 'LIFTER'));

drop policy if exists "Authenticated users can read put-away incidents" on public.putaway_incidents;
create policy "Authenticated users can read put-away incidents"
  on public.putaway_incidents for select to authenticated
  using ((public.current_smart_location_user()).user_id is not null);

drop policy if exists "Warehouse workers can report put-away incidents" on public.putaway_incidents;
create policy "Warehouse workers can report put-away incidents"
  on public.putaway_incidents for insert to authenticated
  with check ((public.current_smart_location_user()).role in ('MOVER', 'LIFTER'));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'putaway_tasks'
  ) then
    alter publication supabase_realtime add table public.putaway_tasks;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'putaway_incidents'
  ) then
    alter publication supabase_realtime add table public.putaway_incidents;
  end if;
end;
$$;
