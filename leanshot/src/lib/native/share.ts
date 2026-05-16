// Phase 16 Plan 16-02 fill — Native share sheet bridge (MOBILE-10, CONTEXT
// D-07 plugin set). Firewall zone: shared / no restriction.
// Source: RESEARCH §Pattern reference (capacitorjs.com/docs/v8/apis/share)
// + Web Share API (developer.mozilla.org/docs/Web/API/Navigator/share).
//
// Native → @capacitor/share opens UIActivityViewController (iOS) /
// Intent.ACTION_SEND (Android).
// Web → navigator.share if available, falls back to clipboard.writeText(url).
// All errors swallowed — share is fire-and-forget per UI-SPEC Surface 3
// (user-cancel from @capacitor/share is also a thrown error we must absorb).
import { Share } from '@capacitor/share';
import { detectPlatform } from './platform';

export interface ShareOptions {
  title: string;
  text: string;
  url: string;
}

export async function nativeShare(opts: ShareOptions): Promise<void> {
  const p = detectPlatform();
  if (p === 'ios' || p === 'android') {
    try {
      await Share.share({ title: opts.title, text: opts.text, url: opts.url });
    } catch {
      // User cancelled OS share sheet OR plugin error — fire-and-forget per UI-SPEC.
    }
    return;
  }
  // Web (incl. capacitor-web npx-cap-serve harness)
  try {
    const nav = globalThis.navigator as Navigator & {
      share?: (data: ShareData) => Promise<void>;
    };
    if (typeof nav.share === 'function') {
      await nav.share({ title: opts.title, text: opts.text, url: opts.url });
      return;
    }
    if (nav.clipboard?.writeText) {
      await nav.clipboard.writeText(opts.url);
    }
  } catch {
    // navigator.share user-cancel / permission-denied → silently swallow.
  }
}
