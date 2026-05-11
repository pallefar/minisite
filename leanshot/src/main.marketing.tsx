import { createRoot } from 'react-dom/client';
import { Landing } from '@/components/marketing/Landing';
import '@/index.css';

/**
 * Marketing entry — independent of the SPA's Zustand store, Sentry, PostHog,
 * and AppShell. Errors here are rare and observable in console (D-19).
 *
 * The "Start" CTA navigates to the SPA's preview/production URL via plain href.
 * Per 02-CONTEXT.md Deferred Ideas: planner picks the handoff mechanism — anchor wins.
 *
 * VITE_SPA_URL is set per Vercel preview/production env in the marketing project
 * (documented in 02-08). Local fallback is '/' (harmless: marketing dev rarely needs
 * a live SPA target).
 */
const root = document.getElementById('root');
if (root) {
  const spaUrl = import.meta.env.VITE_SPA_URL ?? '/';
  createRoot(root).render(
    <Landing
      onStart={() => {
        window.location.href = spaUrl;
      }}
    />,
  );
}
