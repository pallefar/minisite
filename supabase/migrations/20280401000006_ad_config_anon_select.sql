-- Phase 56 Review Fix — CR-02
-- Add anon+authenticated SELECT policies on ad_csp_allowlist and
-- ad_advertiser_blocklist so the Edge Middleware can read these tables
-- using the anon key when building CSP headers (fetchAdCspHosts).
--
-- These tables contain non-sensitive config (CDN hostnames, competitor
-- domain blocklist) — NOT PHI. Admin-write policies from migration
-- 20280401000002 are preserved unchanged.
--
-- Forward-dated past 20280401000005 (ad_revenue_etl_cron_rpc ceiling).

begin;

-- ad_csp_allowlist: allow anon + authenticated reads so middleware CSP
-- generation works without service-role credentials.
create policy "ad_csp_allowlist_anon_select"
  on public.ad_csp_allowlist
  for select
  using (true);   -- public read; hostnames are non-sensitive config

-- ad_advertiser_blocklist: allow anon + authenticated reads so middleware
-- blocklist filtering works (T-56-11 GLP-1 competitor host exclusion).
create policy "ad_advertiser_blocklist_anon_select"
  on public.ad_advertiser_blocklist
  for select
  using (true);   -- public read; competitor domains are non-sensitive config

commit;
