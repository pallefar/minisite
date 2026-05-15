/**
 * HttpOnly affiliate cookie helper for the `affiliate-attribute` Edge Function.
 *
 * Phase 19 Plan 19-02 (D-21):
 *   - Cookie name: `_aff` (singular — W-6 dropped the JS-readable mirror).
 *   - Attributes (LOCKED — DO NOT relax):
 *       HttpOnly       — JS cannot read; eliminates self-XSS exfil surface.
 *       Secure         — TLS only.
 *       SameSite=Lax   — referral clicks from social media still set the
 *                        cookie; full Strict would block the most common
 *                        affiliate traffic source.
 *       Domain=.leanshot.app — covers apex + www + future subdomains
 *                        (e.g. app.leanshot.app for the SPA). Vercel
 *                        rewrite at /r/:code is required so the response
 *                        origin is leanshot.app — that gate is the Wave-0
 *                        D-37 #1 smoke verified before Task 2 ships.
 *       Path=/         — entire site.
 *       Max-Age=30d    — 30-day attribution window per CONTEXT D-21.
 *
 * W-6 RATIONALE (iter-1 revision 2026-05-15): the original CONTEXT described
 * a dual-cookie pattern (`_aff` HttpOnly + `_aff_pub` JS-readable mirror) so
 * client-side Stripe.js could pass attribution via client_reference_id. That
 * was unnecessary — Plan 19-04 stripe-checkout reads the cookie server-side
 * via `getCookies(req.headers.get('Cookie'))`, which works on HttpOnly
 * cookies. Single HttpOnly cookie removes the self-XSS exfil path.
 *
 * Project rules (LeanShot memory):
 *   - reference_supabase_edge_function_deploy.md — jsr:@std/http/cookie is
 *     the project-blessed setter; hand-rolling Set-Cookie strings is the
 *     well-known Edge Function footgun.
 */

import { setCookie } from 'jsr:@std/http/cookie';

export const AFF_COOKIE_NAME = '_aff';
export const AFF_COOKIE_MAX_AGE_SEC = 30 * 24 * 60 * 60; // 30 days

/**
 * Append a single Set-Cookie header for the affiliate referral code.
 *
 * Per W-6: writes ONE cookie. Do not add a second JS-readable mirror in
 * this helper — that path is intentionally absent.
 */
export function setAffiliateCookie(headers: Headers, referralCode: string): void {
  setCookie(headers, {
    name: AFF_COOKIE_NAME,
    value: referralCode,
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    domain: '.leanshot.app',
    path: '/',
    maxAge: AFF_COOKIE_MAX_AGE_SEC,
  });
}
