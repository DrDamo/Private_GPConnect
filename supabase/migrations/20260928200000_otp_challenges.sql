-- One-time passcodes for the SMS consent route. Only a keyed hash of each code
-- is stored. Attempts are incremented atomically in the database so parallel
-- guesses cannot exceed the limit.

create table pgpc.otp_challenges (
  id           uuid primary key,
  subject_ref  text not null,
  destination  text not null,
  code_hash    text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  created_at   timestamptz not null,
  expires_at   timestamptz not null,
  attempts     integer not null default 0 check (attempts >= 0),
  consumed_at  timestamptz
);

create index otp_challenges_subject_idx on pgpc.otp_challenges (subject_ref, created_at desc);

alter table pgpc.otp_challenges enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on pgpc.otp_challenges from anon, authenticated;
  end if;
end;
$$;
