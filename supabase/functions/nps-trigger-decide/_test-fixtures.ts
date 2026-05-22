/**
 * Shared test fixtures for nps-trigger-decide Deno tests.
 *
 * Provides:
 *   - makeFakeAdmin(cfg): builds a fake SupabaseClient that records reads/inserts
 *     into a shared log object so individual tests can assert on call shape.
 *   - mkReq(opts): Request builder.
 *   - installCaptureSpy(): no-op spy hook (POSTHOG_PROJECT_KEY is unset in
 *     tests so captureServer is already a no-op; this exists for future-proofing).
 *
 * NOT a Deno test file — filename ends in `-fixtures.ts` so the deno test
 * discovery glob `{*_,*.,}test.*` does NOT pick it up.
 */

export interface HistoryFixture {
  fired_at: string;
  rule_id: string | null;
  rating_value: number | null;
}

export interface RuleFixture {
  id: string;
  trigger_event: string;
  active: boolean;
  created_at: string;
}

export interface ProfileFixture {
  primary_org_id: string | null;
}

export interface CtaFixture {
  slug: 'trustpilot' | 'g2' | 'capterra';
  url_pattern: string;
  requires_mobile_shell?: boolean;
  claimed?: boolean;
}

export interface FakeAdminLog {
  historyInserts: Array<Record<string, unknown>>;
  rulesQueriedFor: string[];
  ctaQueries: Array<{ slugs: string[] }>;
}

export interface FakeAdminCfg {
  log: FakeAdminLog;
  authBehavior: 'ok' | 'error';
  userUid: string;
  history: HistoryFixture[];
  rules: RuleFixture[];
  profile: ProfileFixture | null;
  /**
   * CTA fixtures. Tests can include rows with requires_mobile_shell:true or
   * claimed:false to verify the filter logic. The makeFakeAdmin .in().eq()
   * chain applies the same predicates the production code applies.
   */
  cta: CtaFixture[];
  insertBehavior?: 'ok' | 'error';
}

// deno-lint-ignore no-explicit-any
type AnyChain = any;

export function makeFakeAdmin(cfg: FakeAdminCfg): AnyChain {
  return {
    auth: {
      getUser: (_jwt: string) => {
        if (cfg.authBehavior === 'error') {
          return Promise.resolve({ data: { user: null }, error: { message: 'invalid_jwt' } });
        }
        return Promise.resolve({ data: { user: { id: cfg.userUid } }, error: null });
      },
    },
    from: (table: string) => {
      if (table === 'review_prompt_history') {
        return makeHistoryChain(cfg);
      }
      if (table === 'review_prompt_rules') {
        return makeRulesChain(cfg);
      }
      if (table === 'profiles') {
        return makeProfileChain(cfg);
      }
      if (table === 'review_cta_catalog') {
        return makeCtaChain(cfg);
      }
      if (table === 'events_mirror') {
        // captureServer's dual-write — env-gated off in tests but defensive.
        return {
          insert: (_row: unknown) => Promise.resolve({ data: null, error: null }),
        };
      }
      throw new Error(`[fake-admin] unexpected table: ${table}`);
    },
  };
}

function makeHistoryChain(cfg: FakeAdminCfg): AnyChain {
  // Two-shape chain: select…eq…order (read) OR insert (write).
  return {
    select: (_cols: string) => ({
      eq: (col: string, val: string) => {
        if (col !== 'user_id' || val !== cfg.userUid) {
          // Defensive — production filters by user_id only.
          return {
            order: (_c: string, _o: unknown) => Promise.resolve({ data: [], error: null }),
          };
        }
        return {
          order: (_c: string, _o: unknown) =>
            // Already pre-sorted descending in the fixture; we don't re-sort
            // because tests author the fixture in the order production reads.
            Promise.resolve({ data: cfg.history, error: null }),
        };
      },
    }),
    insert: (row: Record<string, unknown>) => {
      cfg.log.historyInserts.push(row);
      if (cfg.insertBehavior === 'error') {
        return Promise.resolve({ data: null, error: { message: 'insert_failed' } });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
}

function makeRulesChain(cfg: FakeAdminCfg): AnyChain {
  return {
    select: (_cols: string) => ({
      eq: (_c1: string, v1: string) => ({
        eq: (_c2: string, _v2: unknown) => ({
          order: (_c: string, _o: unknown) => {
            cfg.log.rulesQueriedFor.push(v1);
            const filtered = cfg.rules.filter((r) => r.trigger_event === v1 && r.active === true);
            return Promise.resolve({ data: filtered, error: null });
          },
        }),
      }),
    }),
  };
}

function makeProfileChain(cfg: FakeAdminCfg): AnyChain {
  return {
    select: (_cols: string) => ({
      eq: (_col: string, _val: string) => ({
        maybeSingle: () => Promise.resolve({ data: cfg.profile, error: null }),
      }),
    }),
  };
}

function makeCtaChain(cfg: FakeAdminCfg): AnyChain {
  return {
    select: (_cols: string) => ({
      in: (_col: string, slugs: string[]) => ({
        eq: (_c1: string, mobileShellVal: boolean) => ({
          eq: (_c2: string, claimedVal: boolean) => {
            cfg.log.ctaQueries.push({ slugs });
            const filtered = cfg.cta.filter((c) => {
              if (!slugs.includes(c.slug)) return false;
              const mobileShell = c.requires_mobile_shell ?? false;
              const claimed = c.claimed ?? true;
              return mobileShell === mobileShellVal && claimed === claimedVal;
            });
            return Promise.resolve({
              data: filtered.map((c) => ({ slug: c.slug, url_pattern: c.url_pattern })),
              error: null,
            });
          },
        }),
      }),
    }),
  };
}

export function mkReq(opts: { method?: string; jwt?: string; body?: unknown }): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.jwt) headers.Authorization = `Bearer ${opts.jwt}`;
  return new Request('http://localhost/functions/v1/nps-trigger-decide', {
    method: opts.method ?? 'POST',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

/**
 * Placeholder spy for future event-capture assertions.
 *
 * Returns a `restore()` callable. In the present test suite POSTHOG_PROJECT_KEY
 * is unset so captureServer is a no-op (per posthog-server.ts:42-48); this
 * function exists to give future tests a hook point without rewriting call sites.
 */
export function installCaptureSpy(): () => void {
  return () => {};
}
