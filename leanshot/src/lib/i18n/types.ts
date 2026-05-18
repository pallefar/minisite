/**
 * Phase 32 Plan 32-01 — i18n type primitives (single source of truth).
 *
 * Per CONTEXT D-10: single `es` namespace covers Latin-American-neutral
 * Spanish; `es-MX`, `es-ES`, `es-419` browser preferences all collapse to
 * `es` via i18next's `load: 'languageOnly'`. `profiles.locale` is a 2-char
 * column.
 *
 * Per RESEARCH §Anti-Patterns (lines 331-339): NEVER scatter `'es-419'`
 * literals across the codebase — always import `Locale` / `LOCALE_CHOICES`
 * from this module.
 *
 * Downstream plans extend this contract additively (Plan 32-03 wires
 * `profiles.locale`, Plan 32-04 reads `lng` in override-backend, etc.).
 */
export type Locale = 'en' | 'es';

export const LOCALE_CHOICES = ['en', 'es'] as const satisfies readonly Locale[];

export const DEFAULT_LOCALE: Locale = 'en';
