create table if not exists public.hr_dashboard_store (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz default now()
);

create table if not exists public.hr_staff_directory (
  record_id text primary key,
  id text default '',
  zk text default '',
  saber text default '',
  final_code text default '',
  full_name text default '',
  last_name text default '',
  first_name text default '',
  gender text default '',
  kind text default '',
  contract text default '',
  department text default '',
  service text default '',
  job text default '',
  hired_at text default '',
  pay_type text default '',
  signed text default '',
  status text default '',
  inactive_from text default '',
  updated_at timestamptz default now()
);

alter table public.hr_dashboard_store enable row level security;
alter table public.hr_staff_directory enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'hr_dashboard_store'
      and policyname = 'hr_dashboard_store_select'
  ) then
    create policy "hr_dashboard_store_select"
    on public.hr_dashboard_store
    for select
    to anon, authenticated
    using (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'hr_dashboard_store'
      and policyname = 'hr_dashboard_store_insert'
  ) then
    create policy "hr_dashboard_store_insert"
    on public.hr_dashboard_store
    for insert
    to anon, authenticated
    with check (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'hr_dashboard_store'
      and policyname = 'hr_dashboard_store_update'
  ) then
    create policy "hr_dashboard_store_update"
    on public.hr_dashboard_store
    for update
    to anon, authenticated
    using (true)
    with check (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'hr_staff_directory'
      and policyname = 'hr_staff_directory_select'
  ) then
    create policy "hr_staff_directory_select"
    on public.hr_staff_directory
    for select
    to anon, authenticated
    using (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'hr_staff_directory'
      and policyname = 'hr_staff_directory_insert'
  ) then
    create policy "hr_staff_directory_insert"
    on public.hr_staff_directory
    for insert
    to anon, authenticated
    with check (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'hr_staff_directory'
      and policyname = 'hr_staff_directory_update'
  ) then
    create policy "hr_staff_directory_update"
    on public.hr_staff_directory
    for update
    to anon, authenticated
    using (true)
    with check (true);
  end if;
end $$;

insert into public.hr_dashboard_store (id, payload)
values ('rh-homepage', '{}'::jsonb)
on conflict (id) do nothing;
