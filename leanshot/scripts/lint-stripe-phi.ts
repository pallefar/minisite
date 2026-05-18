// scripts/lint-stripe-phi.ts
// Phase 25 Plan 25-05 — HIPAA-08 banking-exemption boundary CI gate.
//
// What it does:
//   Scans .ts/.tsx files under src/ and supabase/functions/ that import or
//   reference `stripe`. For each stripe.<resource>.<verb>({...}) call site,
//   extracts string-literal argument values from description, statement_descriptor,
//   metadata, and line_items[].description fields. Fails if any value contains
//   a keyword from stripe-phi-keywords.json (case-insensitive, word-boundary
//   anchored per RESEARCH Pitfall 11).
//
// Allowlist:
//   Inline `// stripe-phi-lint:allow reason='...'` on the same line OR within
//   3 lines above the matched call expression. Comment without reason= is
//   REJECTED (forces engineer to document intent).
//
// CLI flags:
//   --json           Emit JSON report instead of human/CI-annotation form.
//   --strict         Treat warnings as errors (default: errors only fail; no warnings exist yet).
//   --root=PATH      Override scan root (default: cwd which CI sets to leanshot/).
//
// Exit codes:
//   0 = PASS
//   1 = FAIL (violation(s) found)
//   2 = USAGE ERROR (bad CLI args)
//
// GitHub Actions annotation:
//   ::error file=PATH,line=N::keyword "<KW>" in stripe API call argument

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
let jsonMode = false;
let rootOverride: string | null = null;

for (const arg of args) {
  if (arg === '--json') {
    jsonMode = true;
  } else if (arg === '--strict') {
    // Reserved for future use — no warnings exist yet
  } else if (arg.startsWith('--root=')) {
    rootOverride = arg.slice('--root='.length);
  } else {
    process.stderr.write(`Unknown argument: ${arg}\n`);
    process.exit(2);
  }
}

// ---------------------------------------------------------------------------
// Resolve paths
// ---------------------------------------------------------------------------
const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url));
const LEANSHOT_DIR = resolve(SCRIPT_DIR, '..');
const REPO_ROOT = resolve(LEANSHOT_DIR, '..');

// The scan root defaults to the cwd (CI sets working-directory: leanshot).
// When called from a different cwd, use --root=. to adapt.
const CWD_ROOT = rootOverride ? resolve(rootOverride) : process.cwd();

// Determine if cwd looks like the leanshot dir or the repo root
// so we can build correct scan paths.
function resolveDir(subPath: string): string {
  // Try cwd-relative first, then leanshot-relative, then repo-relative
  const fromCwd = join(CWD_ROOT, subPath);
  try {
    statSync(fromCwd);
    return fromCwd;
  } catch {
    // Not found relative to cwd
  }
  const fromLean = join(LEANSHOT_DIR, subPath);
  try {
    statSync(fromLean);
    return fromLean;
  } catch {
    // Not found relative to leanshot
  }
  // Return cwd-relative as canonical even if it doesn't exist
  return fromCwd;
}

const SCAN_ROOTS = [
  resolveDir('src'),
  resolveDir('supabase/functions'),
];

const KEYWORDS_PATH = join(SCRIPT_DIR, 'stripe-phi-keywords.json');
const keywordsConfig = JSON.parse(readFileSync(KEYWORDS_PATH, 'utf8')) as {
  version: number;
  keywords: string[];
};
const KEYWORDS: string[] = keywordsConfig.keywords;

// ---------------------------------------------------------------------------
// File walker
// ---------------------------------------------------------------------------
function* walkDir(dir: string): Generator<string> {
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // directory does not exist — skip silently
  }
  for (const entry of entries) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Exclude common non-source dirs
      if (
        entry.name === 'node_modules' ||
        entry.name === 'dist' ||
        entry.name === '.next' ||
        entry.name === '__tests__' ||
        entry.name === '__mocks__'
      ) {
        continue;
      }
      yield* walkDir(p);
    } else if (entry.isFile()) {
      // Only .ts and .tsx
      if (!p.endsWith('.ts') && !p.endsWith('.tsx')) continue;
      // Exclude test/spec files
      if (
        p.endsWith('.test.ts') ||
        p.endsWith('.test.tsx') ||
        p.endsWith('.spec.ts') ||
        p.endsWith('.spec.tsx')
      ) {
        continue;
      }
      yield p;
    }
  }
}

// ---------------------------------------------------------------------------
// Allowlist check
// ---------------------------------------------------------------------------
// Looks for `// stripe-phi-lint:allow reason='...'` on the same line OR within
// 3 lines above the match position in the raw source lines.
function checkAllowlist(
  rawLines: string[],
  lineIndex: number,
): { allowed: boolean; missingReason: boolean } {
  const ALLOW_PATTERN = /\/\/\s*stripe-phi-lint:allow\b/;
  const REASON_PATTERN = /\/\/\s*stripe-phi-lint:allow\s+reason=['"]([^'"]+)['"]/;

  // Check same line and up to 3 lines above
  const start = Math.max(0, lineIndex - 3);
  for (let i = lineIndex; i >= start; i--) {
    const line = rawLines[i] ?? '';
    if (ALLOW_PATTERN.test(line)) {
      if (REASON_PATTERN.test(line)) {
        return { allowed: true, missingReason: false };
      }
      // Allow marker present but no reason= — REJECT
      return { allowed: false, missingReason: true };
    }
  }
  return { allowed: false, missingReason: false };
}

// ---------------------------------------------------------------------------
// Extract string literal values from a call-site object body
// ---------------------------------------------------------------------------
function extractStringValues(objectBody: string): string[] {
  const values: string[] = [];

  // Match description: '...', statement_descriptor: '...', and string values in metadata
  const singleQuoteRe =
    /(?:description|statement_descriptor|name)\s*:\s*'([^']*)'/g;
  const doubleQuoteRe =
    /(?:description|statement_descriptor|name)\s*:\s*"([^"]*)"/g;
  const backtickRe =
    /(?:description|statement_descriptor|name)\s*:\s*`([^`]*)`/g;

  for (const re of [singleQuoteRe, doubleQuoteRe, backtickRe]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(objectBody)) !== null) {
      values.push(m[1]);
    }
  }

  // Also extract bare string values (for metadata object values)
  const metaValueRe =
    /:\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)/g;
  let mv: RegExpExecArray | null;
  while ((mv = metaValueRe.exec(objectBody)) !== null) {
    const val = mv[1] ?? mv[2] ?? mv[3];
    if (val !== undefined) values.push(val);
  }

  return values;
}

// ---------------------------------------------------------------------------
// Violation type
// ---------------------------------------------------------------------------
interface Violation {
  file: string;
  line: number;
  column: number;
  keyword: string;
  callSite: string;
  suggestion: string;
  missingReason?: boolean;
}

// ---------------------------------------------------------------------------
// Main scan
// ---------------------------------------------------------------------------
const violations: Violation[] = [];

// Stripe call site regex — intentionally loose per RESEARCH Pitfall 11.
// Matches: stripe.<resource>.<verb>({ ... })
// The `[^}]*` capture is intentionally not greedy past '}' to stay simple.
const CALL_SITE_RE =
  /(?:stripe|[A-Za-z_]\w*[Ss]tripe)\.\w+\.(create|update|capture|refund|cancel|retrieve|del|list)\s*\(\s*\{([^}]*)\}/gs;

for (const scanRoot of SCAN_ROOTS) {
  for (const filePath of walkDir(scanRoot)) {
    const rawContent = readFileSync(filePath, 'utf8');

    // Fast-path: skip files without any stripe reference
    if (!/\bstripe\b/i.test(rawContent)) continue;

    const rawLines = rawContent.split('\n');

    // Reset regex state
    CALL_SITE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;

    while ((m = CALL_SITE_RE.exec(rawContent)) !== null) {
      const callSiteStart = m.index;
      const objectBody = m[2];

      // Determine line number of the call site start
      const beforeMatch = rawContent.slice(0, callSiteStart);
      const lineIndex = beforeMatch.split('\n').length - 1;

      // Extract string literal values from the object body
      const stringValues = extractStringValues(objectBody);

      for (const value of stringValues) {
        const lowerValue = value.toLowerCase();

        for (const keyword of KEYWORDS) {
          // Word-boundary anchored match (RESEARCH Pitfall 11)
          // For multi-word keywords (e.g. "blood pressure"), use literal match
          let matched = false;
          if (keyword.includes(' ') || keyword.includes('-')) {
            // Multi-word or hyphenated: case-insensitive literal match
            matched = lowerValue.includes(keyword.toLowerCase());
          } else {
            // Single word: word-boundary anchored
            const kRe = new RegExp(`\\b${escapeRegex(keyword)}\\b`, 'i');
            matched = kRe.test(value);
          }

          if (!matched) continue;

          // Check allowlist
          const { allowed, missingReason } = checkAllowlist(rawLines, lineIndex);
          if (allowed) continue;

          const relPath = relative(process.cwd(), filePath);
          violations.push({
            file: relPath,
            line: lineIndex + 1,
            column: 1,
            keyword,
            callSite: m[0].slice(0, 80) + (m[0].length > 80 ? '...' : ''),
            suggestion: `// stripe-phi-lint:allow reason='<why-this-is-safe>'`,
            missingReason,
          });
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

if (jsonMode) {
  process.stdout.write(JSON.stringify(violations, null, 2) + '\n');
  process.exit(violations.length > 0 ? 1 : 0);
}

for (const v of violations) {
  if (v.missingReason) {
    process.stderr.write(
      `::error file=${v.file},line=${v.line}::stripe-phi-lint:allow comment found but missing required reason= field. Add reason='...' to document why this is safe.\n`,
    );
  } else {
    process.stderr.write(
      `::error file=${v.file},line=${v.line}::keyword "${v.keyword}" found in stripe API call argument. Add \`${v.suggestion}\` if intentional.\n`,
    );
  }
}

if (violations.length > 0) {
  process.stderr.write(
    `\nFAIL: ${violations.length} PHI keyword violation(s) in Stripe call sites.\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `OK: no PHI keywords found in Stripe call sites across ${SCAN_ROOTS.length} scan roots.\n`,
);
process.exit(0);
