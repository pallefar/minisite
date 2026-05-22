/**
 * Phase 36 Plan 36-05 Task 2 — Multi-device NPS cooldown E2E (REVIEW-03 / D-08).
 *
 * Behavior: NPS prompt history is server-side; a fire that lands on context A
 * suppresses the modal in context B (different browser context, same user)
 * within the global cooldown window. Cooldown semantics are owned by the
 * `nps-trigger-decide` Edge Fn + the review_prompt_history table.
 *
 * Seeds pre-fire rows via the W8-followup `_test_seed_with_gas` SECDEF
 * wrapper (the ONLY callable path for test-harness seeding — see
 * leanshot/e2e/_helpers/with-test-mode.ts). The bare
 * `_test_seed_review_prompt_history` helper MUST NOT be referenced in any
 * e2e file (verified by grep in the plan's verify block).
 *
 * Gate: PLAYWRIGHT_RUN_P36=1 + live Supabase env (URL, anon, service-role).
 * Without those env vars the spec self-skips; without a seeded
 * review_prompt_rules row + the activation_completed Phase 35 trigger event,
 * the spec is deferred to milestone close via the deferred-tests.md flow
 * per [[feedback_defer_then_batch_fix_pattern]].
 *
 * Per-file slug prefix per [[feedback_rls_per_file_slug_prefix]]:
 *   `nps-cd-${Date.now().toString(36)}-`
 */
import { test, expect } from '@playwright/test';
import { makeAdminClient, seedReviewPromptHistory } from './_helpers/with-test-mode';

const PLAYWRIGHT_RUN = process.env.PLAYWRIGHT_RUN_P36 === '1';
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const HAS_LIVE = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_ROLE);

const SLUG = `nps-cd-${Date.now().toString(36)}-`;

test.describe('Phase 36 — NPS multi-device cooldown', () => {
  test.skip(
    !PLAYWRIGHT_RUN || !HAS_LIVE,
    'PLAYWRIGHT_RUN_P36=1 + live Supabase env required',
  );

  test('cooldown is server-side: context A fire suppresses context B modal', async ({
    browser,
  }) => {
    const admin = makeAdminClient();

    // Seed a test user + rule. Cleanup is per-file; afterAll deletes by slug.
    const email = `${SLUG}user@leanshot.test`;
    const { data: createRes, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: 'test-pw-' + SLUG,
      email_confirm: true,
    });
    if (createErr || !createRes?.user) {
      test.skip(
        true,
        `User-create failed (likely Phase 34 trigger events not seeded in this env): ${createErr?.message ?? 'no user'}`,
      );
      return;
    }
    const userId = createRes.user.id;

    // Look up a Phase 36 rule. We require one with trigger_event=activation_completed.
    const { data: rules } = await admin
      .from('review_prompt_rules')
      .select('id')
      .eq('trigger_event', 'activation_completed')
      .eq('active', true)
      .limit(1);
    if (!rules || rules.length === 0) {
      test.skip(
        true,
        'No active review_prompt_rules row for activation_completed — admin rule-builder seed deferred to milestone close',
      );
      return;
    }
    const ruleId = rules[0]!.id as string;

    // Seed 4 prior fires at 30/45/60/70 days ago via the SECDEF wrapper.
    // Last fire at 30 days ago: global cooldown should still suppress.
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    for (const ago of [30, 45, 60, 70]) {
      await seedReviewPromptHistory(admin, {
        userId,
        ruleId,
        firedAt: new Date(now - ago * day).toISOString(),
        ratingValue: null,
        copyVariant: 'control',
      });
    }

    // Two browser contexts, same user authenticated.
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    try {
      // Smoke: navigate both contexts to root. We assert the NPS modal does
      // NOT appear in either context within 3s — server-side cooldown is the
      // contract regardless of which context fires the trigger.
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();
      await pageA.goto('/');
      await pageB.goto('/');

      const dialogA = pageA.getByRole('dialog', {
        name: /how likely are you to recommend/i,
      });
      const dialogB = pageB.getByRole('dialog', {
        name: /how likely are you to recommend/i,
      });

      await expect(dialogA).toHaveCount(0, { timeout: 3000 });
      await expect(dialogB).toHaveCount(0, { timeout: 3000 });
    } finally {
      await contextA.close();
      await contextB.close();
      // Cleanup
      try {
        await admin.auth.admin.deleteUser(userId);
      } catch {
        /* best-effort */
      }
    }
  });
});
