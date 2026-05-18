/**
 * Phase 32 Plan 32-01 — i18n Suspense fallback (pre-translation visual).
 *
 * Rendered by main.tsx's outer <Suspense> while initial namespace JSON
 * loads. MUST NOT call useTranslation() — that would throw a promise the
 * very boundary it lives behind is supposed to catch, blanking the page
 * (32-RESEARCH Pitfall 1, lines 681-687).
 *
 * Visual matches the Skeleton primitive style without importing it (avoids
 * pulling the ui chunk into the i18n-runtime chunk).
 */
export function I18nSuspenseFallback() {
  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--color-bg, #efebe0)',
      }}
    >
      <div
        style={{
          width: '48px',
          height: '48px',
          borderRadius: '999px',
          background:
            'linear-gradient(90deg, var(--color-skeleton, rgba(0,0,0,0.08)) 0%, color-mix(in oklab, var(--color-skeleton, rgba(0,0,0,0.08)) 60%, transparent) 50%, var(--color-skeleton, rgba(0,0,0,0.08)) 100%)',
          backgroundSize: '200% 100%',
          animation: 'shimmer 1.6s linear infinite',
        }}
      />
    </div>
  );
}
