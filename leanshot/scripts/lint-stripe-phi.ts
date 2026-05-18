#!/usr/bin/env tsx
/**
 * lint-stripe-phi.ts — Phase 25 D-09 + Phase 29 D-11 + Phase 30 D-18
 *
 * CI lint guard: blocks PHI keywords from appearing in Stripe call sites and
 * clinician alert email templates.
 *
 * Scans all TypeScript/JavaScript files under the 5 PHI-sensitive Edge Function
 * directories. Strips single-line comments before checking per
 * [[reference_grep_gate_comment_strip]] to avoid false-positives on doc comments
 * that mention PHI keywords for documentation purposes.
 *
 * Multi-line block comments (slash-star) are NOT stripped — improvement for v1.4;
 * residual risk accepted at v1.3 scale (T-29-07-02 accept).
 *
 * To suppress a legitimate match, add the inline marker BEFORE the line:
 *   // stripe-phi-lint:allow reason='this is a count variable not a patient field'
 *   const mg = count;
 *
 * Usage:
 *   npm run lint:stripe-phi
 *   npx tsx scripts/lint-stripe-phi.ts
 *
 * Exit codes:
 *   0 — no violations found
 *   1 — one or more PHI keyword violations
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve the repo root (scripts/ is one level inside leanshot/)
const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url));
const LEANSHOT_DIR = resolve(SCRIPT_DIR, '..');
const REPO_ROOT = resolve(LEANSHOT_DIR, '..');

// Stripe-touching Edge Function directories to scan.
// Paths are relative to the repo root (where supabase/ lives).
const STRIPE_PATHS = [
  join(REPO_ROOT, 'supabase', 'functions', 'stripe-webhook'),
  join(REPO_ROOT, 'supabase', 'functions', 'stripe-checkout'),
  join(REPO_ROOT, 'supabase', 'functions', 'admin-stripe-action'),
  join(REPO_ROOT, 'supabase', 'functions', 'org-metered-billing-cron'), // P29 D-11
  join(REPO_ROOT, 'supabase', 'functions', 'clinician-alert-deliver-cron'), // P30 D-18
];

const KEYWORDS_PATH = join(SCRIPT_DIR, 'stripe-phi-keywords.json');
const config = JSON.parse(readFileSync(KEYWORDS_PATH, 'utf8')) as {
  keywords: string[];
  allowlist_inline_marker: string;
};
const KEYWORDS: string[] = config.keywords;
const ALLOW_MARKER: string = config.allowlist_inline_marker;

/** Recursively yield all .ts and .js source files under dir (excludes test files). */
function* walk(dir: string): Generator<string> {
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // directory does not exist — skip silently
  }
  for (const entry of entries) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(p);
    } else if (
      entry.isFile() &&
      (p.endsWith('.ts') || p.endsWith('.js')) &&
      // Exclude test files — they test PHI absence by mentioning keyword names;
      // production source is the lint target (not test fixtures).
      !p.endsWith('.test.ts') &&
      !p.endsWith('.test.js') &&
      !p.endsWith('.spec.ts') &&
      !p.endsWith('.spec.js')
    ) {
      yield p;
    }
  }
}

/** Strip single-line comments from source per [[reference_grep_gate_comment_strip]]. */
function stripSingleLineComments(src: string): string {
  return src
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

let violations = 0;

for (const root of STRIPE_PATHS) {
  try {
    statSync(root);
  } catch {
    // Directory absent — skip (handles case where a new function hasn't been deployed yet)
    continue;
  }

  for (const file of walk(root)) {
    const raw = readFileSync(file, 'utf8');
    // Strip single-line comments to avoid false-positives on documentation.
    const content = stripSingleLineComments(raw);
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // If the previous line (in original source) contains the allow-marker, skip this line.
      // We use the raw lines here for the allow-marker check.
      const rawLines = raw.split('\n');
      const prevRawLine = i > 0 ? rawLines[i - 1].trim() : '';
      const isAllowed = prevRawLine.includes(ALLOW_MARKER);

      for (const kw of KEYWORDS) {
        const rx = new RegExp(`\\b${kw}\\b`, 'gi');
        if (rx.test(line) && !isAllowed) {
          const matchCount = (line.match(rx) ?? []).length;
          console.error(
            `PHI keyword "${kw}" found in ${file}:${i + 1} (${matchCount}x)`,
          );
          violations += matchCount;
        }
      }
    }
  }
}

if (violations > 0) {
  console.error(
    `\nFAIL: ${violations} PHI keyword violation(s) in Stripe call sites.`,
  );
  console.error(
    `To suppress a legitimate match, add the following comment on the line BEFORE the match:`,
  );
  console.error(`  ${ALLOW_MARKER}'<reason>'`);
  process.exit(1);
}

console.log(
  `OK: no PHI keywords in ${STRIPE_PATHS.length} Stripe call site directories.`,
);
