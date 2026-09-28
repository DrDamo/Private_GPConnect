-- Core storage for the simulated middleware: consents and the hash-chained
-- audit trail. Everything lives in a private schema that is NOT exposed through
-- Supabase's REST API; only the server (direct Postgres connection) can reach it.

create schema if not exists pgpc;

create table pgpc.consents (
  id            uuid primary key,
  version       integer not null check (version >= 1),
  status        text not null check (status in ('pending', 'active', 'declined', 'withdrawn', 'expired')),
  nhs_number    text not null check (nhs_number ~ '^[0-9]{10}$'),
  provider_ods  text not null,
  requested_at  timestamptz not null,
  record        jsonb not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index consents_nhs_number_idx on pgpc.consents (nhs_number, requested_at desc);
create index consents_provider_idx on pgpc.consents (provider_ods, requested_at desc);

-- Append-only audit trail. `event` holds the exact JSON that was hashed; the
-- other columns are copies for indexing.
create table pgpc.audit_events (
  seq             bigint primary key check (seq >= 1),
  id              uuid not null unique,
  recorded_at     timestamptz not null,
  type            text not null,
  outcome         text not null check (outcome in ('success', 'denied', 'failure')),
  patient_ref     text,
  consent_id      text,
  correlation_id  text not null,
  prev_hash       text not null check (prev_hash ~ '^[0-9a-f]{64}$'),
  hash            text not null unique check (hash ~ '^[0-9a-f]{64}$'),
  event           jsonb not null
);

create index audit_events_patient_ref_idx on pgpc.audit_events (patient_ref, seq) where patient_ref is not null;
create index audit_events_consent_id_idx on pgpc.audit_events (consent_id, seq) where consent_id is not null;

create function pgpc.audit_events_append_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'pgpc.audit_events is append-only (% rejected)', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger audit_events_no_update_delete
  before update or delete on pgpc.audit_events
  for each row execute function pgpc.audit_events_append_only();

create trigger audit_events_no_truncate
  before truncate on pgpc.audit_events
  for each statement execute function pgpc.audit_events_append_only();

-- Defence in depth on Supabase: RLS on with no policies, and no grants to the
-- API roles. (Guarded so the migration also runs on plain Postgres in tests.)
alter table pgpc.consents enable row level security;
alter table pgpc.audit_events enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on schema pgpc from anon, authenticated;
    revoke all on all tables in schema pgpc from anon, authenticated;
    revoke all on all functions in schema pgpc from anon, authenticated, public;
  end if;
end;
$$;
