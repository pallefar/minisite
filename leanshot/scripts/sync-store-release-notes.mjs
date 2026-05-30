#!/usr/bin/env node
/**
 * Phase 71 Plan 71-02 Task 1 (PU-04) — Centralized changelog → store release-notes sync.
 *
 * Node ESM build-time script. Queries the newest `status='published'`
 * `changelog_entries` row whose `version` matches the current build version,
 * converts its markdown `body_md` to PLAIN TEXT, and writes it into both
 * fastlane metadata files:
 *   - fastlane/metadata/ios/en-US/release_notes.txt            (overwrite)
 *   - fastlane/metadata/android/en-US/changelogs/<versionCode>.txt  (create)
 *
 * Wired to run BEFORE the existing `upload_testflight` / `upload_play` fastlane
 * lanes (lane edit only — signing/secrets stay owned by Phase 70).
 *
 * Runs in CI at release time with the SERVICE-ROLE key (changelog SELECT is
 * authenticated-only; service role bypasses RLS but we STILL filter
 * status='published' explicitly).
 *
 * Env (mirrors build-research-rss.mjs / seed-photo-soak-fixture.mjs):
 *   SUPABASE_URL              (or VITE_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Fail-soft: if env is missing OR no matching published entry exists, the
 * script warns to stderr and exits 0 WITHOUT writing — non-release builds
 * (and CI without DB access) never break, and existing metadata files are
 * left untouched.
 *
 * Run:
 *   node scripts/sync-store-release-notes.mjs
 */

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_NAME = 'sync-store-release-notes';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LEANSHOT_DIR = resolve(__dirname, '..');

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ─── Pure helpers (exported for unit tests) ───────────────────────────────────

/**
 * Converts a markdown string to plain text suitable for store "What's new"
 * release notes. Dependency-free + pure so the unit test can import it.
 *
 * Strips: ATX headings (`# `), bold/italic markers (`**` `__` `*` `_`),
 * inline-link syntax keeping the text (`[text](url)` → `text`), list markers
 * (`- ` `* ` `+ ` `1. `), blockquote markers (`> `), inline code backticks.
 * Collapses 3+ consecutive newlines to 2, trims trailing whitespace per line,
 * and trims the whole result.
 *
 * @param {string} md
 * @returns {string}
 */
export function markdownToPlainText(md) {
  if (md == null) return '';
  let text = String(md);

  // Normalise line endings.
  text = text.replace(/\r\n?/g, '\n');

  // Fenced code blocks: drop the fence markers, keep the inner lines as-is.
  text = text.replace(/^```[^\n]*\n([\s\S]*?)\n```$/gm, '$1');

  text = text
    .split('\n')
    .map((line) => {
      let l = line;
      // ATX headings: `# `, `## ` … → unwrap.
      l = l.replace(/^\s{0,3}#{1,6}\s+/, '');
      // Blockquote markers: `> ` (possibly nested).
      l = l.replace(/^\s{0,3}(?:>\s?)+/, '');
      // Ordered list markers: `1. ` `2) `.
      l = l.replace(/^\s{0,3}\d+[.)]\s+/, '');
      // Unordered list markers: `- ` `* ` `+ `.
      l = l.replace(/^\s{0,3}[-*+]\s+/, '');
      return l;
    })
    .join('\n');

  // Inline-link syntax: `[text](url)` → `text`. Run before stripping `*`/`_`
  // so link text emphasis is handled by the later emphasis pass.
  text = text.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1');

  // Bold/italic emphasis markers: `**` `__` `*` `_`.
  text = text.replace(/(\*\*|__)(.*?)\1/g, '$2');
  text = text.replace(/(\*|_)(.*?)\1/g, '$2');

  // Inline code backticks (keep the code text).
  text = text.replace(/`([^`]*)`/g, '$1');

  // Trim trailing whitespace on each line.
  text = text
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n');

  // Collapse 3+ consecutive newlines to 2 (a single blank line).
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

/**
 * Resolves the two fastlane target file paths.
 *
 * @param {string} version       app version (unused in path, kept for parity / future locale)
 * @param {number|string} versionCode  Android versionCode → changelogs/<N>.txt filename
 * @param {string} [baseDir]     base directory (defaults to leanshot/ resolved from this file)
 * @returns {{ iosPath: string, androidPath: string }}
 */
export function resolveTargets(version, versionCode, baseDir = LEANSHOT_DIR) {
  const iosPath = resolve(baseDir, 'fastlane', 'metadata', 'ios', 'en-US', 'release_notes.txt');
  const androidPath = resolve(
    baseDir,
    'fastlane',
    'metadata',
    'android',
    'en-US',
    'changelogs',
    `${versionCode}.txt`,
  );
  return { iosPath, androidPath };
}

/**
 * Picks the newest published entry matching the given build version.
 * Defends against an unsorted result set by sorting on published_at desc.
 *
 * @param {Array<{title?:string, body_md?:string, version?:string|null, status?:string, published_at?:string|null}>} rows
 * @param {string} version
 * @returns {object|null}
 */
export function pickEntry(rows, version) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const matching = rows.filter(
    (r) => r && r.status === 'published' && r.version === version,
  );
  if (matching.length === 0) return null;
  matching.sort((a, b) => {
    const ta = a.published_at ? Date.parse(a.published_at) : 0;
    const tb = b.published_at ? Date.parse(b.published_at) : 0;
    return tb - ta;
  });
  return matching[0];
}

/**
 * Builds the final plain-text release-notes string from an entry: prepends the
 * entry title (if present) as the first line, then a blank line, then the
 * markdown-stripped body.
 *
 * @param {{title?:string, body_md?:string}} entry
 * @returns {string}
 */
export function entryToReleaseNotes(entry) {
  const title = (entry?.title ?? '').trim();
  const body = markdownToPlainText(entry?.body_md ?? '');
  if (title && body) return `${title}\n\n${body}\n`;
  if (title) return `${title}\n`;
  if (body) return `${body}\n`;
  return '';
}

/**
 * Reads the app version from package.json.
 * @param {string} [baseDir]
 * @returns {string}
 */
export function readAppVersion(baseDir = LEANSHOT_DIR) {
  const pkgPath = resolve(baseDir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  return pkg.version;
}

/**
 * Reads the Android versionCode from apps/android/app/build.gradle.
 * @param {string} [baseDir]
 * @returns {number}
 */
export function readVersionCode(baseDir = LEANSHOT_DIR) {
  const gradlePath = resolve(baseDir, 'apps', 'android', 'app', 'build.gradle');
  const gradle = readFileSync(gradlePath, 'utf-8');
  const m = gradle.match(/versionCode\s+(\d+)/);
  if (!m) {
    throw new Error(`${SCRIPT_NAME}: could not parse versionCode from ${gradlePath}`);
  }
  return Number(m[1]);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Fail-soft on missing env (non-release builds / CI without DB access).
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.warn(
      `[${SCRIPT_NAME}] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — ` +
        'skipping store release-notes sync (fail-soft, existing metadata untouched).',
    );
    process.exit(0);
  }

  const appVersion = readAppVersion();
  const versionCode = readVersionCode();
  const { iosPath, androidPath } = resolveTargets(appVersion, versionCode);

  // Lazy import so importing this module in the unit test never pulls in the
  // supabase SDK or touches the network.
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase
    .from('changelog_entries')
    .select('title, body_md, version, status, published_at')
    .eq('status', 'published')
    .eq('version', appVersion)
    .order('published_at', { ascending: false })
    .limit(1);

  if (error) {
    console.warn(
      `[${SCRIPT_NAME}] changelog query failed (${error.message}) — ` +
        'skipping store release-notes sync (fail-soft, existing metadata untouched).',
    );
    process.exit(0);
  }

  const entry = pickEntry(data ?? [], appVersion);
  if (!entry) {
    console.warn(
      `[${SCRIPT_NAME}] no published changelog entry found for version ${appVersion} — ` +
        'skipping store release-notes sync (fail-soft, existing metadata untouched).',
    );
    process.exit(0);
  }

  const notes = entryToReleaseNotes(entry);

  // iOS — overwrite the existing release_notes.txt.
  mkdirSync(dirname(iosPath), { recursive: true });
  writeFileSync(iosPath, notes, 'utf-8');

  // Android — create the changelogs/ dir then write <versionCode>.txt.
  mkdirSync(dirname(androidPath), { recursive: true });
  writeFileSync(androidPath, notes, 'utf-8');

  console.log(
    `[${SCRIPT_NAME}] wrote release notes for v${appVersion} (versionCode ${versionCode}) → ` +
      `${iosPath} + ${androidPath} (${notes.length} bytes).`,
  );
}

// Only run main() when executed directly — NOT when imported by the unit test.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`[${SCRIPT_NAME}] Fatal error:`, err);
    process.exit(1);
  });
}
