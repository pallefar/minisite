// scripts/audit-sentry-mask.ts
// Phase 25 Plan 25-06 — HIPAA-16 Sentry data-sentry-mask CI audit.
//
// What it does:
//   Scans .tsx files under src/ for JSX expressions that render PHI-bearing
//   property access paths listed in sentry-mask-required-props.json. For each
//   match, asserts that the element or an ancestor within 3 lines has:
//     (a) a `data-sentry-mask` attribute, OR
//     (b) a `className` containing "sentry-mask", OR
//     (c) a `// sentry-mask-lint:allow reason='...'` inline comment (same line
//         or within 3 lines above the match).
//
// Lint design: matches EXPRESSION TEXT (right side of `={...}` or `{...}`),
//   NOT prop names. A bare identifier like `patient` does NOT trigger; the
//   specific dot-access path `patient.name` does.
//
// FALSE-POSITIVE BIAS NOTE: This lint intentionally accepts false negatives
//   (under-blocks) over false positives (over-blocks) to keep developer
//   ergonomics manageable. The complementary defenses are:
//     (a) Sentry runtime PII scrubber,
//     (b) Sentry org-level masking defaults,
//     (c) PR review.
//   The lint is a "shift-left" reminder, NOT the final boundary.
//   See RESEARCH Pitfall 11 for AST-upgrade trigger criteria.
//
// KNOWN LIMITATION: Ancestor shielding is a 3-line lookback heuristic, NOT full
//   AST parent traversal. This can produce false-negatives in deeply nested JSX.
//   Per RESEARCH Pitfall 11 cadence: upgrade to AST-based traversal when
//   false-negative rate proves insufficient via PR review feedback.
//
// Allowlist:
//   Inline `// sentry-mask-lint:allow reason='...'` on the same line OR within
//   3 lines above the matched JSX expression. Comment without reason= is
//   REJECTED (forces engineer to document intent).
//
// CLI flags:
//   --json           Emit JSON report to stdout instead of GitHub CI annotations.
//   --strict         Reserved for future use.
//   --root=PATH      Override scan root (default: cwd which CI sets to leanshot/).
//
// Exit codes:
//   0 = PASS
//   1 = FAIL (violation(s) found)
//   2 = USAGE ERROR (bad CLI args)
//
// GitHub Actions annotation format:
//   ::error file=PATH,line=N::PHI expression <EXPR> rendered without data-sentry-mask

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
    // Reserved for future use
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

const CWD_ROOT = rootOverride ? resolve(rootOverride) : process.cwd();

function resolveDir(subPath: string): string {
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
  return fromCwd;
}

const SCAN_ROOT = resolveDir('src');

const PROPS_PATH = join(SCRIPT_DIR, 'sentry-mask-required-props.json');
const propsConfig = JSON.parse(readFileSync(PROPS_PATH, 'utf8')) as {
  version: number;
  phiExpressions: string[];
};
const PHI_EXPRESSIONS: string[] = propsConfig.phiExpressions;

// ---------------------------------------------------------------------------
// Escape special regex characters in a string
// ---------------------------------------------------------------------------
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// File walker — .tsx files only, excludes __tests__, *.test.*, *.spec.*
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
      // Only .tsx — PHI rendering is JSX; pure .ts files don't render UI
      if (!p.endsWith('.tsx')) continue;
      // Exclude test/spec files
      if (
        p.endsWith('.test.tsx') ||
        p.endsWith('.spec.tsx')
      ) {
        continue;
      }
      yield p;
    }
  }
}

// ---------------------------------------------------------------------------
// Shield check: does any of lines[lineIndex - 3 .. lineIndex] contain a mask?
// ---------------------------------------------------------------------------
function checkAncestorShield(rawLines: string[], lineIndex: number): boolean {
  const MASK_ATTR = /data-sentry-mask/;
  const MASK_CLASS = /className\s*=\s*["'][^"']*sentry-mask[^"']*["']/;

  const start = Math.max(0, lineIndex - 3);
  for (let i = lineIndex; i >= start; i--) {
    const line = rawLines[i] ?? '';
    if (MASK_ATTR.test(line) || MASK_CLASS.test(line)) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Allowlist check: does the allow comment (with reason=) appear within 3 lines?
// Accepts both JS-style `// sentry-mask-lint:allow` and JSX-style
// `{/* sentry-mask-lint:allow */}` comments.
// ---------------------------------------------------------------------------
function checkAllowlist(
  rawLines: string[],
  lineIndex: number,
): { allowed: boolean; missingReason: boolean } {
  // Matches both `// sentry-mask-lint:allow` and `/* sentry-mask-lint:allow */`
  const ALLOW_PATTERN = /(?:\/\/|\/\*|\{\s*\/\*)\s*sentry-mask-lint:allow\b/;
  const REASON_PATTERN = /(?:\/\/|\/\*|\{\s*\/\*)\s*sentry-mask-lint:allow\s+reason=['"]([^'"]+)['"]/;

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
// Violation type
// ---------------------------------------------------------------------------
interface Violation {
  file: string;
  line: number;
  column: number;
  expression: string;
  suggestion: string;
  missingReason?: boolean;
}

// ---------------------------------------------------------------------------
// Main scan
// ---------------------------------------------------------------------------
const violations: Violation[] = [];

for (const filePath of walkDir(SCAN_ROOT)) {
  const rawContent = readFileSync(filePath, 'utf8');

  // Fast-path: skip files that don't reference any PHI expression substring
  const hasAnyPhiExpression = PHI_EXPRESSIONS.some((expr) =>
    rawContent.includes(expr),
  );
  if (!hasAnyPhiExpression) continue;

  const rawLines = rawContent.split('\n');
  const relPath = relative(process.cwd(), filePath);

  for (const expr of PHI_EXPRESSIONS) {
    // Skip if this specific expression isn't in the file
    if (!rawContent.includes(expr)) continue;

    // Match {patient.name} or ={patient.name} patterns
    // The escaped dot in the expression prevents matching `patientXname`
    const escapedExpr = escapeRegex(expr);
    const exprRe = new RegExp(`\\{\\s*${escapedExpr}\\s*\\}`, 'g');

    let m: RegExpExecArray | null;
    while ((m = exprRe.exec(rawContent)) !== null) {
      const matchStart = m.index;
      const beforeMatch = rawContent.slice(0, matchStart);
      const lineIndex = beforeMatch.split('\n').length - 1;

      // Check for ancestor shielding (data-sentry-mask or sentry-mask className)
      if (checkAncestorShield(rawLines, lineIndex)) continue;

      // Check allowlist comment
      const { allowed, missingReason } = checkAllowlist(rawLines, lineIndex);
      if (allowed) continue;

      violations.push({
        file: relPath,
        line: lineIndex + 1,
        column: 1,
        expression: expr,
        suggestion: `// sentry-mask-lint:allow reason='<why-this-is-safe>'`,
        missingReason,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------
if (jsonMode) {
  process.stdout.write(JSON.stringify(violations, null, 2) + '\n');
  process.exit(violations.length > 0 ? 1 : 0);
}

for (const v of violations) {
  if (v.missingReason) {
    process.stderr.write(
      `::error file=${v.file},line=${v.line}::sentry-mask-lint:allow comment found but missing required reason= field. Add reason='...' to document why this is safe.\n`,
    );
  } else {
    process.stderr.write(
      `::error file=${v.file},line=${v.line}::PHI expression <${v.expression}> rendered without data-sentry-mask. Wrap in element with data-sentry-mask, add className="sentry-mask", or annotate with \`${v.suggestion}\`.\n`,
    );
  }
}

if (violations.length > 0) {
  process.stderr.write(
    `\nFAIL: ${violations.length} Sentry mask violation(s) found. PHI expressions rendered without data-sentry-mask protection.\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `OK: no unmasked PHI expressions found in ${SCAN_ROOT}.\n`,
);
process.exit(0);
