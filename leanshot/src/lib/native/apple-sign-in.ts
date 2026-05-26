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
// Reading email here would be both unreliable and unnecessary. Email is also
// excluded from the `scopes` field (IN-01 fix) to avoid Apple's relay-email prompt.
//
// Security (CR-01 / AUTH-09): The raw nonce is SHA-256-hashed before being passed
// to Apple's authorize() call (Apple bakes the hash into the JWT). The raw nonce
// is forwarded to supabase.auth.signInWithIdToken so GoTrue can re-hash it and
// verify the nonce claim — closing the token-replay window.
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
 * SHA-256 hash a plain string, returning a lowercase hex digest.
 *
 * Uses Web Crypto (available in all modern browsers and iOS WKWebView).
 * Apple requires the nonce to be SHA-256-hashed before embedding it in the
 * authorize() request; GoTrue receives the raw nonce and re-hashes to verify.
 */
async function sha256Hex(plain: string): Promise<string> {
  const encoded = new TextEncoder().encode(plain);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

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
    // CR-01 fix: generate a raw nonce and pass the SHA-256 hash to Apple.
    // Apple signs the hash into the identityToken JWT. GoTrue receives the
    // raw nonce and independently re-hashes it to verify the nonce claim —
    // preventing token-replay attacks where a valid Apple JWT is reused.
    const rawNonce = crypto.randomUUID();
    const hashedNonce = await sha256Hex(rawNonce);

    const result = await SignInWithApple.authorize({
      clientId: 'app.leanshot.ios',
      redirectURI: '',
      scopes: 'name',             // IN-01: email excluded (app never reads it; avoids relay-email prompt)
      state: crypto.randomUUID(),
      nonce: hashedNonce,         // Apple signs SHA256(rawNonce) into the JWT
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
      nonce: rawNonce,            // CR-01: GoTrue hashes this and compares to the JWT nonce claim
    });

    return { error: error ? { message: error.message } : null };
  } catch (err) {
    const message =
      err instanceof Error && err.message ? err.message : 'apple_native_failed';
    return { error: { message } };
  }
}
