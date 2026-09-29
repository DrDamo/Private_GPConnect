-- Fault injection switches for the simulated national services, shared by all
-- server instances so a demo operator's switch takes effect everywhere.

create table pgpc.sim_faults (
  adapter     text primary key check (adapter in ('pds', 'sds', 'nhs-login', 'sms', 'gp-connect', 'mesh')),
  kind        text not null check (kind in ('timeout', 'unavailable', 'latency')),
  latency_ms  integer check (latency_ms between 0 and 30000),
  updated_at  timestamptz not null default now()
);

alter table pgpc.sim_faults enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on pgpc.sim_faults from anon, authenticated;
  end if;
end;
$$;
