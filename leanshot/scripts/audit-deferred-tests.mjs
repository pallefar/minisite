#!/usr/bin/env node
/**
 * audit-deferred-tests.mjs
 *
 * Phase 23 Plan 23-01 D-12 — deferred-tests registry enforcement.
 *
 * Walks src/**, tests/**, e2e/** for test files (*.test.ts, *.test.tsx, *.spec.ts)
 * and checks that every defer marker has a `// see deferred-tests.md#<anchor>`
 * comment on the same line or the immediately preceding non-blank comment line.
 *
 * Defer markers checked:
 *   - test.fixme(  / it.fixme(  / describe.fixme(
 *   - xtest(  / xdescribe(
 *
 * Env-gated patterns EXEMPT from the anchor requirement (boolean env-check first argument):
 *   - test.skip(!HAS_LIVE, ...)  or  test.skip(!hasLiveSupabase(), ...)
 *   - test.skip(!SHOULD_RUN, ...) / test.skip(!HAS_POSTHOG, ...) etc.
 *   - describe.skip / describeIfLive  (entire-suite env gates)
 *   - test.skip(true, ...)  (inline always-skip guard inside beforeAll etc.)
 *   - Bare test.skip() / it.skip() / describe.skip() with no arguments (in-block early exit)
 *
 * Top-level or named string-argument test.skip(  REQUIRE an anchor unless the
 * second argument starts with a boolean env expression.
 *
 * Exit codes:
 *   0 — all defer markers have anchor comments (or are env-gated / exempt)
 *   1 — one or more missing anchor comments
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// ─── Configuration ────────────────────────────────────────────────────────────

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

const SEARCH_DIRS = ['src', 'tests', 'e2e'];

const TEST_FILE_PATTERN = /\.(test|spec)\.(ts|tsx)$/;

// Lines that contain a defer marker we need to audit.
// We capture: test.fixme, it.fixme, describe.fixme, xtest, xdescribe
// as well as test.skip / it.skip with a string (non-boolean) first argument.
const DEFER_MARKER_RE =
  /\b(test|it|describe)\s*\.\s*fixme\s*\(|^[^/]*\b(xtest|xdescribe)\s*\(/;

// test.skip patterns — only require anchor when NOT env-gated.
// Env-gated = first argument is a boolean expression (negated env var, hasLiveSupabase(), etc.)
// or is `true` (static always-skip guard used inside conditional logic).
const TEST_SKIP_RE = /\b(test|it|describe)\s*\.\s*skip\s*\(/;

// Anchor comment pattern (on same line or immediately preceding comment line).
const ANCHOR_RE = /\/\/\s*see\s+deferred-tests\.md#/i;

// Boolean env-gate patterns — first argument is one of these → exempt.
// Matches:
//   - !<anything>  (negated env var, negated function call, negated setup variable)
//   - true  (static always-skip guard)
//   - HAS_* / SHOULD_RUN / process.env.* (non-negated positional env check)
const ENV_GATE_FIRST_ARG_RE =
  /^\s*(?:!|true\s*[,)]|HAS_[A-Z_]+|SHOULD_RUN|process\.env\.)/;

// Bare no-arg call: test.skip() or describe.skip() with no content before closing paren
// (used as early-exit guards inside conditional blocks)
const BARE_SKIP_RE = /\b(test|it|describe)\s*\.\s*skip\s*\(\s*\)/;

// describeIfLive pattern — entire-suite env gate, exempt
const DESCRIBE_IF_LIVE_RE = /\bdescribeIfLive\b/;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Recursively walk a directory and yield file paths matching the filter.
 * @param {string} dir
 * @param {RegExp} filter
 * @returns {string[]}
 */
function walkDir(dir, filter) {
  const results = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return results; // directory doesn't exist — skip silently
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      // Skip node_modules, dist, coverage, playwright-report
      if (['node_modules', 'dist', 'dist-marketing', 'coverage', 'playwright-report', 'test-results', '.git'].includes(entry)) {
        continue;
      }
      results.push(...walkDir(full, filter));
    } else if (filter.test(entry)) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Given an array of lines and a line index, return the immediately
 * preceding non-blank comment line (if any). Returns '' if not found.
 * @param {string[]} lines
 * @param {number} idx  0-based index of the current line
 */
function precedingCommentLine(lines, idx) {
  for (let i = idx - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (trimmed === '') continue; // skip blank lines
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      return trimmed;
    }
    break; // non-blank, non-comment line — stop looking
  }
  return '';
}

/**
 * Extract the content after the opening paren of a call like `test.skip(`.
 * Handles the case where the opening paren is at the end of the line.
 * @param {string} line
 * @param {string[]} lines
 * @param {number} idx
 * @returns {string}
 */
function firstArgContent(line, lines, idx) {
  const match = line.match(/\btest\s*\.\s*skip\s*\((.*)$/);
  if (!match) {
    const m2 = line.match(/\b(?:it|describe)\s*\.\s*skip\s*\((.*)$/);
    if (!m2) return '';
    return m2[1];
  }
  let content = match[1];
  // If the line ends after the paren with nothing, peek at next line
  if (content.trim() === '' && idx + 1 < lines.length) {
    content = lines[idx + 1];
  }
  return content;
}

// ─── Main audit ───────────────────────────────────────────────────────────────

let totalMarkers = 0;
let linkedMarkers = 0;
const failures = [];

for (const dir of SEARCH_DIRS) {
  const absDir = join(ROOT, dir);
  const files = walkDir(absDir, TEST_FILE_PATTERN);

  for (const file of files) {
    const relPath = relative(ROOT, file);
    let content;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // ── Check describeIfLive — always exempt ──────────────────────────────
      if (DESCRIBE_IF_LIVE_RE.test(line)) {
        // Entire-suite env gate — no anchor needed, don't count as defer marker
        continue;
      }

      // ── Check test.fixme / xtest / xdescribe ─────────────────────────────
      if (DEFER_MARKER_RE.test(line)) {
        totalMarkers++;
        const hasAnchorOnLine = ANCHOR_RE.test(line);
        const prevComment = precedingCommentLine(lines, i);
        const hasAnchorOnPrev = ANCHOR_RE.test(prevComment);

        if (hasAnchorOnLine || hasAnchorOnPrev) {
          linkedMarkers++;
        } else {
          failures.push({
            file: relPath,
            lineNum: i + 1,
            content: line.trimStart(),
          });
        }
        continue;
      }

      // ── Check test.skip / it.skip / describe.skip ─────────────────────────
      if (TEST_SKIP_RE.test(line)) {
        // Exempt: bare no-arg call (early-exit guard inside conditional)
        if (BARE_SKIP_RE.test(line)) continue;

        // Get the first argument content to determine if env-gated
        const argContent = firstArgContent(line, lines, i);

        // Exempt: boolean env-gate first argument
        if (ENV_GATE_FIRST_ARG_RE.test(argContent)) continue;

        // This is a non-env-gated, non-bare test.skip — requires anchor
        totalMarkers++;
        const hasAnchorOnLine = ANCHOR_RE.test(line);
        const prevComment = precedingCommentLine(lines, i);
        const hasAnchorOnPrev = ANCHOR_RE.test(prevComment);

        if (hasAnchorOnLine || hasAnchorOnPrev) {
          linkedMarkers++;
        } else {
          failures.push({
            file: relPath,
            lineNum: i + 1,
            content: line.trimStart(),
          });
        }
      }
    }
  }
}

const unlinked = failures.length;

// ─── Report ───────────────────────────────────────────────────────────────────

console.log(`\nDeferred-tests registry audit`);
console.log(`  Audited: ${totalMarkers} non-env-gated defer markers`);
console.log(`  Linked:  ${linkedMarkers} have // see deferred-tests.md#<anchor>`);
console.log(`  Unlinked: ${unlinked}`);

if (failures.length > 0) {
  console.log('\nFAIL — missing deferred-tests.md anchor links:\n');
  for (const f of failures) {
    console.log(`  FAIL ${f.file}:${f.lineNum} — missing deferred-tests.md anchor link`);
    console.log(`       ${f.content.slice(0, 100)}`);
  }
  console.log(
    '\nFix: add a comment on the line above or same line as the skip/fixme:',
  );
  console.log(
    '  // see deferred-tests.md#<section-slug>\n',
  );
  process.exit(1);
}

console.log('\nPASS — all non-env-gated defer markers have registry anchor links.\n');
process.exit(0);
