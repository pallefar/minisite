-- Phase 37 Plan 01 Task 1 — Helpdesk schema (12 tables)
-- Per CONTEXT D-01..D-04: phi flag on every relevant row.
-- Per [[feedback_planner_missed_status_enum_widening]]: tickets.status CHECK enumerates ALL 6 values upfront.
-- Per [[reference_supabase_migration_filename_regex]]: 14-digit prefix strict.
--
-- Tables (12):
--   1. tickets                  — primary entity (status / priority / phi / source)
--   2. ticket_messages          — append-only thread
--   3. ticket_attachments       — files; phi inherited via FK
--   4. ticket_tags              — many-to-many tag application
--   5. ticket_inbound_events    — Resend Inbound idempotency
--   6. ticket_ai_suggestions    — below-threshold AI cache
--   7. kb_articles              — knowledge base (org-scoped + global)
--   8. kb_article_versions      — immutable KB snapshots
--   9. csat_responses           — per-ticket CSAT (1..5)
--  10. agent_macros             — per-org canned responses
--  11. helpdesk_routing_rules   — admin-editable tag→agent rules
--  12. sla_targets              — admin-editable per-tier SLA

begin;

-- ============================================================
-- 1. tickets
-- ============================================================
create table public.tickets (
  id                       uuid primary key default gen_random_uuid(),
  org_id                   uuid not null references public.organizations(id) on delete restrict,
  user_id                  uuid not null references auth.users(id) on delete cascade,
  assigned_to              uuid references auth.users(id) on delete set null,
  subject                  text not null check (length(subject) between 1 and 200),
  phi boolean not null default false,
  status                   text not null default 'open'
                             check (status in ('open','pending','resolved','closed','waiting_on_customer','spam')),
  priority                 text not null default 'p3'
                             check (priority in ('p1','p2','p3')),
  source                   text not null default 'widget'
                             check (source in ('widget','email','admin')),
  sentiment_min_score      numeric(3,2),
  sentiment_alert_fired_at timestamptz,
  last_user_message_at     timestamptz,
  last_agent_message_at    timestamptz,
  closed_at                timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz
);

create index tickets_org_status_idx     on public.tickets (org_id, status);
create index tickets_user_status_idx    on public.tickets (user_id, status);
create index tickets_assigned_idx       on public.tickets (assigned_to) where assigned_to is not null;
create index tickets_sla_scan_idx       on public.tickets (status, priority, created_at);

alter table public.tickets enable row level security;

-- ============================================================
-- 2. ticket_messages (append-only)
-- ============================================================
create table public.ticket_messages (
  id              uuid primary key default gen_random_uuid(),
  ticket_id       uuid not null references public.tickets(id) on delete cascade,
  author_user_id  uuid references auth.users(id) on delete set null,
  author_kind     text not null check (author_kind in ('user','agent','system','ai_draft')),
  body            text not null,
  body_html       text,
  via             text not null check (via in ('widget','email','admin','api')),
  resend_email_id text,
  created_at      timestamptz not null default now()
);

create index ticket_messages_ticket_created_idx on public.ticket_messages (ticket_id, created_at);

alter table public.ticket_messages enable row level security;

-- ============================================================
-- 3. ticket_attachments
-- ============================================================
create table public.ticket_attachments (
  id                 uuid primary key default gen_random_uuid(),
  ticket_id          uuid not null references public.tickets(id) on delete cascade,
  message_id         uuid references public.ticket_messages(id) on delete set null,
  storage_path       text not null,
  mime_type          text not null
                       check (mime_type in ('image/png','image/jpeg','image/gif','image/webp','application/pdf','text/plain','text/csv')),
  byte_size          bigint not null check (byte_size <= 10485760),
  original_filename  text not null,
  scan_status        text not null default 'deferred'
                       check (scan_status in ('deferred','clean','infected','error')),
  created_at         timestamptz not null default now()
);

comment on column public.ticket_attachments.scan_status
  is 'deferred = ClamAV scan deferred to v1.4 per deferred-items.md P0';

create index ticket_attachments_ticket_idx on public.ticket_attachments (ticket_id);

alter table public.ticket_attachments enable row level security;

-- ============================================================
-- 4. ticket_tags
-- ============================================================
create table public.ticket_tags (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references public.tickets(id) on delete cascade,
  tag_name    text not null check (length(tag_name) between 1 and 64),
  confidence  numeric(3,2) check (confidence between 0 and 1),
  applied_by  text not null check (applied_by in ('ai','agent','rule')),
  created_at  timestamptz not null default now(),
  unique (ticket_id, tag_name)
);

create index ticket_tags_ticket_idx on public.ticket_tags (ticket_id);

alter table public.ticket_tags enable row level security;

-- ============================================================
-- 5. ticket_inbound_events (Resend idempotency)
-- ============================================================
create table public.ticket_inbound_events (
  id              uuid primary key default gen_random_uuid(),
  resend_email_id text not null unique,
  ticket_id       uuid references public.tickets(id) on delete set null,
  from_email      text not null,
  to_email        text not null,
  outcome         text not null
                    check (outcome in ('ticket_created','reply_appended','unknown_sender_bounced','hmac_failed_bounced','duplicate','rejected_loop')),
  created_at      timestamptz not null default now()
);

create index ticket_inbound_events_outcome_idx on public.ticket_inbound_events (outcome, created_at);

alter table public.ticket_inbound_events enable row level security;

-- ============================================================
-- 6. ticket_ai_suggestions
-- ============================================================
create table public.ticket_ai_suggestions (
  id                          uuid primary key default gen_random_uuid(),
  ticket_id                   uuid not null references public.tickets(id) on delete cascade,
  message_id                  uuid not null references public.ticket_messages(id) on delete cascade,
  suggested_tags              jsonb not null,
  suggested_route_user_id     uuid references auth.users(id) on delete set null,
  suggested_route_confidence  numeric(3,2),
  draft_reply                 text,
  sentiment_score             numeric(3,2) check (sentiment_score between -1 and 1),
  model_id                    text not null,
  is_clinical_scope           boolean not null,
  applied_at                  timestamptz,
  created_at                  timestamptz not null default now()
);

create index ticket_ai_suggestions_ticket_created_idx on public.ticket_ai_suggestions (ticket_id, created_at desc);
create index ticket_ai_suggestions_message_idx       on public.ticket_ai_suggestions (message_id);

alter table public.ticket_ai_suggestions enable row level security;

-- ============================================================
-- 7. kb_articles
-- ============================================================
create table public.kb_articles (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid references public.organizations(id) on delete cascade,
  slug               text not null,
  title              text not null check (length(title) between 1 and 200),
  body               text not null default '',
  title_es           text,
  body_es            text,
  locale_set         text[] not null default array['en'],
  published_at       timestamptz,
  published_version  int not null default 0,
  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz
);

-- Unique slug per org (null org_id treated as global namespace via coalesce sentinel).
create unique index kb_articles_org_slug_idx
  on public.kb_articles (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), slug);

alter table public.kb_articles enable row level security;

-- ============================================================
-- 8. kb_article_versions (append-only)
-- ============================================================
create table public.kb_article_versions (
  id            uuid primary key default gen_random_uuid(),
  article_id    uuid not null references public.kb_articles(id) on delete cascade,
  version       int not null,
  title         text not null,
  body          text not null,
  title_es      text,
  body_es       text,
  published_by  uuid references auth.users(id) on delete set null,
  published_at  timestamptz not null default now(),
  unique (article_id, version)
);

alter table public.kb_article_versions enable row level security;

-- ============================================================
-- 9. csat_responses
-- ============================================================
create table public.csat_responses (
  id            uuid primary key default gen_random_uuid(),
  ticket_id     uuid not null references public.tickets(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  rating        int not null check (rating between 1 and 5),
  comment       text,
  responded_at  timestamptz not null default now(),
  unique (ticket_id)
);

alter table public.csat_responses enable row level security;

-- ============================================================
-- 10. agent_macros
-- ============================================================
create table public.agent_macros (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  created_by  uuid references auth.users(id) on delete set null,
  name        text not null check (length(name) between 1 and 64),
  shortcut    text not null check (length(shortcut) between 1 and 32),
  body        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz,
  unique (org_id, shortcut)
);

alter table public.agent_macros enable row level security;

-- ============================================================
-- 11. helpdesk_routing_rules
-- ============================================================
create table public.helpdesk_routing_rules (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  name                text not null,
  tag_name            text not null,
  assign_to_user_id   uuid not null references auth.users(id) on delete cascade,
  priority            int not null default 100,
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz
);

create index helpdesk_routing_rules_org_active_priority_idx
  on public.helpdesk_routing_rules (org_id, active, priority);

alter table public.helpdesk_routing_rules enable row level security;

-- ============================================================
-- 12. sla_targets
-- ============================================================
create table public.sla_targets (
  id                       uuid primary key default gen_random_uuid(),
  org_id                   uuid not null references public.organizations(id) on delete cascade,
  tier                     text not null check (tier in ('p1','p2','p3')),
  first_response_minutes   int not null check (first_response_minutes > 0),
  resolution_minutes       int not null check (resolution_minutes > 0),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz,
  unique (org_id, tier)
);

alter table public.sla_targets enable row level security;

-- ============================================================
-- Append-only / immutable invariants (revoke at end of file)
-- ============================================================
revoke update, delete on public.ticket_messages       from service_role;
revoke update, delete on public.kb_article_versions   from service_role;
revoke update         on public.ticket_inbound_events from service_role;
revoke update, delete on public.csat_responses        from service_role;

commit;
