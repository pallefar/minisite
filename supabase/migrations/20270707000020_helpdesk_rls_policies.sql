-- Phase 37 Plan 01 Task 2 — Helpdesk RLS (two-axis user_id + org_id)
-- Per CONTEXT D-04/D-05: attachments inherit ticket.phi via FK + policy join.
--                       PHI audit trigger fires from phi-access-rpc.ts (Plan 06/07), NOT in a policy.
-- Anti-patterns avoided (per [[feedback_planner_iter1_anti_patterns]]):
--   - No tautological-bypass predicates
--   - No GUC-based predicates — always join org_members
--   - No combined-verb shortcuts — explicit per-verb policies for audit clarity
--
-- Service-role bypasses RLS by default (writes are audited at app layer).

begin;

-- ============================================================
-- tickets — 6 policies
-- ============================================================
create policy tickets_select_owner
  on public.tickets
  for select
  to authenticated
  using (user_id = auth.uid());

create policy tickets_select_agent
  on public.tickets
  for select
  to authenticated
  using (
    exists (
      select 1 from public.org_members
      where org_id = tickets.org_id
        and user_id = auth.uid()
    )
  );

create policy tickets_insert_owner
  on public.tickets
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy tickets_insert_agent
  on public.tickets
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.org_members
      where org_id = tickets.org_id
        and user_id = auth.uid()
    )
  );

-- Owner can update but cannot transition to closed/spam (T-37-01-03).
create policy tickets_update_owner
  on public.tickets
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and status in ('open','pending','waiting_on_customer','resolved')
  );

create policy tickets_update_agent
  on public.tickets
  for update
  to authenticated
  using (
    exists (
      select 1 from public.org_members
      where org_id = tickets.org_id
        and user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.org_members
      where org_id = tickets.org_id
        and user_id = auth.uid()
    )
  );

-- No DELETE policy — tickets are not user-deletable.

-- ============================================================
-- ticket_messages — 4 policies (append-only at service layer)
-- ============================================================
create policy tm_select_owner
  on public.ticket_messages
  for select
  to authenticated
  using (
    exists (
      select 1 from public.tickets t
      where t.id = ticket_messages.ticket_id
        and t.user_id = auth.uid()
    )
  );

create policy tm_select_agent
  on public.ticket_messages
  for select
  to authenticated
  using (
    exists (
      select 1 from public.tickets t
      join public.org_members om on om.org_id = t.org_id
      where t.id = ticket_messages.ticket_id
        and om.user_id = auth.uid()
    )
  );

create policy tm_insert_owner
  on public.ticket_messages
  for insert
  to authenticated
  with check (
    author_kind = 'user'
    and exists (
      select 1 from public.tickets t
      where t.id = ticket_messages.ticket_id
        and t.user_id = auth.uid()
    )
  );

create policy tm_insert_agent
  on public.ticket_messages
  for insert
  to authenticated
  with check (
    author_kind in ('agent','system','ai_draft')
    and exists (
      select 1 from public.tickets t
      join public.org_members om on om.org_id = t.org_id
      where t.id = ticket_messages.ticket_id
        and om.user_id = auth.uid()
    )
  );

-- ============================================================
-- ticket_attachments — 4 policies (phi inherits via parent ticket join)
-- ============================================================
create policy ta_select_owner
  on public.ticket_attachments
  for select
  to authenticated
  using (
    exists (
      select 1 from public.tickets t
      where t.id = ticket_attachments.ticket_id
        and t.user_id = auth.uid()
    )
  );

create policy ta_select_agent
  on public.ticket_attachments
  for select
  to authenticated
  using (
    exists (
      select 1 from public.tickets t
      join public.org_members om on om.org_id = t.org_id
      where t.id = ticket_attachments.ticket_id
        and om.user_id = auth.uid()
    )
  );

create policy ta_insert_owner
  on public.ticket_attachments
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.tickets t
      where t.id = ticket_attachments.ticket_id
        and t.user_id = auth.uid()
    )
  );

create policy ta_insert_agent
  on public.ticket_attachments
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.tickets t
      join public.org_members om on om.org_id = t.org_id
      where t.id = ticket_attachments.ticket_id
        and om.user_id = auth.uid()
    )
  );

-- ============================================================
-- ticket_tags — 3 policies (no user insert — tags are agent/AI/rule only)
-- ============================================================
create policy tt_select_owner
  on public.ticket_tags
  for select
  to authenticated
  using (
    exists (
      select 1 from public.tickets t
      where t.id = ticket_tags.ticket_id
        and t.user_id = auth.uid()
    )
  );

create policy tt_select_agent
  on public.ticket_tags
  for select
  to authenticated
  using (
    exists (
      select 1 from public.tickets t
      join public.org_members om on om.org_id = t.org_id
      where t.id = ticket_tags.ticket_id
        and om.user_id = auth.uid()
    )
  );

create policy tt_insert_agent
  on public.ticket_tags
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.tickets t
      join public.org_members om on om.org_id = t.org_id
      where t.id = ticket_tags.ticket_id
        and om.user_id = auth.uid()
    )
  );

-- ============================================================
-- ticket_inbound_events — admin-only select, no insert (service-role only)
-- ============================================================
create policy tie_select_admin_only
  on public.ticket_inbound_events
  for select
  to authenticated
  using (
    exists (
      select 1 from public.org_members
      where user_id = auth.uid()
        and role in ('owner','support_admin','support_lead','support_agent')
    )
  );

-- ============================================================
-- ticket_ai_suggestions — agent-only select, no insert (service-role only)
-- ============================================================
create policy tas_select_agent
  on public.ticket_ai_suggestions
  for select
  to authenticated
  using (
    exists (
      select 1 from public.tickets t
      join public.org_members om on om.org_id = t.org_id
      where t.id = ticket_ai_suggestions.ticket_id
        and om.user_id = auth.uid()
    )
  );

-- ============================================================
-- kb_articles — 3 select policies + 3 admin-only modify policies
-- ============================================================
create policy kb_select_published_global
  on public.kb_articles
  for select
  to authenticated
  using (
    org_id is null
    and published_at is not null
  );

create policy kb_select_published_org
  on public.kb_articles
  for select
  to authenticated
  using (
    org_id is not null
    and published_at is not null
    and exists (
      select 1 from public.org_members
      where org_id = kb_articles.org_id
        and user_id = auth.uid()
    )
  );

create policy kb_select_drafts_admin
  on public.kb_articles
  for select
  to authenticated
  using (
    exists (
      select 1 from public.org_members
      where (kb_articles.org_id is null or org_id = kb_articles.org_id)
        and user_id = auth.uid()
        and role in ('owner','support_admin','support_lead')
    )
  );

create policy kb_insert_admin
  on public.kb_articles
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.org_members
      where (kb_articles.org_id is null or org_id = kb_articles.org_id)
        and user_id = auth.uid()
        and role in ('owner','support_admin','support_lead')
    )
  );

create policy kb_update_admin
  on public.kb_articles
  for update
  to authenticated
  using (
    exists (
      select 1 from public.org_members
      where (kb_articles.org_id is null or org_id = kb_articles.org_id)
        and user_id = auth.uid()
        and role in ('owner','support_admin','support_lead')
    )
  )
  with check (
    exists (
      select 1 from public.org_members
      where (kb_articles.org_id is null or org_id = kb_articles.org_id)
        and user_id = auth.uid()
        and role in ('owner','support_admin','support_lead')
    )
  );

create policy kb_delete_admin
  on public.kb_articles
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.org_members
      where (kb_articles.org_id is null or org_id = kb_articles.org_id)
        and user_id = auth.uid()
        and role in ('owner','support_admin','support_lead')
    )
  );

-- ============================================================
-- kb_article_versions — select-only via parent article visibility
-- (No INSERT/UPDATE policy — SECDEF RPC in Plan 02 writes here.)
-- ============================================================
create policy kbv_select
  on public.kb_article_versions
  for select
  to authenticated
  using (
    exists (
      select 1 from public.kb_articles ka
      where ka.id = kb_article_versions.article_id
        and (
          -- mirror parent visibility (published + visible to caller)
          (ka.published_at is not null and ka.org_id is null)
          or (
            ka.published_at is not null
            and ka.org_id is not null
            and exists (
              select 1 from public.org_members
              where org_id = ka.org_id and user_id = auth.uid()
            )
          )
          or exists (
            select 1 from public.org_members
            where (ka.org_id is null or org_id = ka.org_id)
              and user_id = auth.uid()
              and role in ('owner','support_admin','support_lead')
          )
        )
    )
  );

-- ============================================================
-- csat_responses — owner insert/select + agent select
-- ============================================================
create policy csat_insert_owner
  on public.csat_responses
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy csat_select_owner
  on public.csat_responses
  for select
  to authenticated
  using (user_id = auth.uid());

create policy csat_select_agent
  on public.csat_responses
  for select
  to authenticated
  using (
    exists (
      select 1 from public.tickets t
      join public.org_members om on om.org_id = t.org_id
      where t.id = csat_responses.ticket_id
        and om.user_id = auth.uid()
    )
  );

-- ============================================================
-- agent_macros — org-member select, admin-role modify (4 policies)
-- ============================================================
create policy am_select
  on public.agent_macros
  for select
  to authenticated
  using (
    exists (
      select 1 from public.org_members
      where org_id = agent_macros.org_id
        and user_id = auth.uid()
    )
  );

create policy am_insert_admin
  on public.agent_macros
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.org_members
      where org_id = agent_macros.org_id
        and user_id = auth.uid()
        and role in ('owner','support_admin','support_lead')
    )
  );

create policy am_update_admin
  on public.agent_macros
  for update
  to authenticated
  using (
    exists (
      select 1 from public.org_members
      where org_id = agent_macros.org_id
        and user_id = auth.uid()
        and role in ('owner','support_admin','support_lead')
    )
  )
  with check (
    exists (
      select 1 from public.org_members
      where org_id = agent_macros.org_id
        and user_id = auth.uid()
        and role in ('owner','support_admin','support_lead')
    )
  );

create policy am_delete_admin
  on public.agent_macros
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.org_members
      where org_id = agent_macros.org_id
        and user_id = auth.uid()
        and role in ('owner','support_admin','support_lead')
    )
  );

-- ============================================================
-- helpdesk_routing_rules — 4 policies
-- ============================================================
create policy hrr_select
  on public.helpdesk_routing_rules
  for select
  to authenticated
  using (
    exists (
      select 1 from public.org_members
      where org_id = helpdesk_routing_rules.org_id
        and user_id = auth.uid()
    )
  );

create policy hrr_insert_admin
  on public.helpdesk_routing_rules
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.org_members
      where org_id = helpdesk_routing_rules.org_id
        and user_id = auth.uid()
        and role in ('owner','support_admin','support_lead')
    )
  );

create policy hrr_update_admin
  on public.helpdesk_routing_rules
  for update
  to authenticated
  using (
    exists (
      select 1 from public.org_members
      where org_id = helpdesk_routing_rules.org_id
        and user_id = auth.uid()
        and role in ('owner','support_admin','support_lead')
    )
  )
  with check (
    exists (
      select 1 from public.org_members
      where org_id = helpdesk_routing_rules.org_id
        and user_id = auth.uid()
        and role in ('owner','support_admin','support_lead')
    )
  );

create policy hrr_delete_admin
  on public.helpdesk_routing_rules
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.org_members
      where org_id = helpdesk_routing_rules.org_id
        and user_id = auth.uid()
        and role in ('owner','support_admin','support_lead')
    )
  );

-- ============================================================
-- sla_targets — 4 policies
-- ============================================================
create policy sla_select
  on public.sla_targets
  for select
  to authenticated
  using (
    exists (
      select 1 from public.org_members
      where org_id = sla_targets.org_id
        and user_id = auth.uid()
    )
  );

create policy sla_insert_admin
  on public.sla_targets
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.org_members
      where org_id = sla_targets.org_id
        and user_id = auth.uid()
        and role in ('owner','support_admin','support_lead')
    )
  );

create policy sla_update_admin
  on public.sla_targets
  for update
  to authenticated
  using (
    exists (
      select 1 from public.org_members
      where org_id = sla_targets.org_id
        and user_id = auth.uid()
        and role in ('owner','support_admin','support_lead')
    )
  )
  with check (
    exists (
      select 1 from public.org_members
      where org_id = sla_targets.org_id
        and user_id = auth.uid()
        and role in ('owner','support_admin','support_lead')
    )
  );

create policy sla_delete_admin
  on public.sla_targets
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.org_members
      where org_id = sla_targets.org_id
        and user_id = auth.uid()
        and role in ('owner','support_admin','support_lead')
    )
  );

commit;
