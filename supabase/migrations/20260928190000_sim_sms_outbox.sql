-- Simulated SMS outbox: what the on-screen "phone" shows. Simulation only;
-- the check constraint mirrors the adapter's guard that only Ofcom drama-range
-- numbers (07700 900xxx) can ever be stored.

create table pgpc.sim_sms_outbox (
  id         uuid primary key,
  sent_at    timestamptz not null,
  to_number  text not null check (to_number ~ '^07700900[0-9]{3}$'),
  body       text not null check (length(body) between 1 and 918),
  reference  text
);

create index sim_sms_outbox_to_idx on pgpc.sim_sms_outbox (to_number, sent_at desc);

alter table pgpc.sim_sms_outbox enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on pgpc.sim_sms_outbox from anon, authenticated;
  end if;
end;
$$;
