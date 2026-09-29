-- Simulated MESH mailboxes (practice inboxes) for GP Connect Send Document.
-- Simulation only: in a real deployment messages live in MESH and the GP
-- system, and this middleware keeps no copy.

create table pgpc.sim_mesh_messages (
  id            uuid primary key,
  sent_at       timestamptz not null,
  from_mailbox  text not null,
  to_mailbox    text not null,
  workflow_id   text not null,
  local_id      text not null,
  subject       text not null,
  content_type  text not null,
  content       jsonb not null,
  status        text not null check (status in ('accepted', 'downloaded', 'acknowledged', 'rejected')),
  status_at     timestamptz not null,
  status_note   text
);

create index sim_mesh_messages_to_idx on pgpc.sim_mesh_messages (to_mailbox, sent_at desc);

alter table pgpc.sim_mesh_messages enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on pgpc.sim_mesh_messages from anon, authenticated;
  end if;
end;
$$;
