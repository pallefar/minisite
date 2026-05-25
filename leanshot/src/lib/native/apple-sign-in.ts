// Phase 59 Plan 59-02 Task 2 — native iOS Sign-in-with-Apple bridge.
//
// Security (T-59-04, T-59-05): Apple's identityToken (a signed JWT) is passed
// directly to supabase.auth.signInWithIdToken — GoTrue verifies the signature
// against Apple's public keys and validates exp + nonce server-side. The client
// NEVER asserts identity itself or hand-rolls JWT verification.
//
// Security (T-59-06 / AUTH-09): We deliberately do NOT read the Apple-provided
// email from the authorization response. Apple returns email only on first sign-in;
// profiles keys on id (handle_new_user inserts profiles(id) only, no email column).
// Reading email here would be both unreliable and unnecessary.
//
// Platform gate (T-59-07): signInWithAppleNative() is only reachable when the
// caller checks isAppleEnabled() && detectPlatform()==='ios'. As a defence-in-depth
// layer, we short-circuit on non-iOS platforms here too so the native binding is
// never touched in web/jsdom/WebView contexts.
//
// Firewall: @capacitor/core is imported via ./platform (sole legit import site).
import { SignInWithApple } from '@capacitor-community/apple-sign-in';
import { supabase } from '@/lib/supabase';
import { detectPlatform } from './platform';

/**
 * Sign in with Apple using the native ASAuthorization dialog (iOS only).
 *
 * Returns `{ error: null }` on success, or `{ error: { message } }` on
 * every failure path — never throws, always returns.
 */
export async function signInWithAppleNative(): Promise<{ error: { message: string } | null }> {
  // Defence-in-depth: also short-circuit here even though auth.ts's platform
  // fork is the primary gate (T-59-07). Keeps jsdom + WebView builds safe.
  if (detectPlatform() !== 'ios') {
    return { error: { message: 'native_apple_ios_only' } };
  }

  try {
    const result = await SignInWithApple.authorize({
      clientId: 'app.leanshot.ios',
      redirectURI: '',
      scopes: 'email name',
      state: crypto.randomUUID(),
      nonce: crypto.randomUUID(),
    });

    // identityToken is required by the Apple response type; guard against
    // empty string in case a web-platform shim returns an empty value.
    const identityToken = result.response?.identityToken;
    if (!identityToken) {
      return { error: { message: 'apple_no_identity_token' } };
    }

    // Server-side verification: GoTrue validates the Apple JWT signature,
    // exp, and nonce. The client never trusts or inspects the token content.
    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: identityToken,
    });

    return { error: error ? { message: error.message } : null };
  } catch (err) {
    const message =
      err instanceof Error && err.message ? err.message : 'apple_native_failed';
    return { error: { message } };
  }
}
