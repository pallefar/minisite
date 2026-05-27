/**
 * Phase 69 Plan 69-01 — DS-03 accent color reserved-list CI guard.
 *
 * Greps `leanshot/src/**\/*.{tsx,ts}` for usage of accent-color Tailwind
 * utilities (text-primary, bg-primary, text-accent, bg-accent, text-success,
 * bg-success, text-warning, bg-warning, text-danger, bg-danger, text-info,
 * bg-info, plus *-soft variants, ring-* variants, and `/N` opacity
 * modifiers).
 *
 * Decides whether the usage is allowed by file-pattern + baseline:
 *
 *   1. RESERVED_FILE_PATTERNS — the file is a known accent-purposeful surface
 *      (e.g. Button.tsx, Badge.tsx, Pill.tsx, status indicators). Accent
 *      usage is silently allowed.
 *
 *   2. FORBIDDEN_FILE_PATTERNS — the file is a known accent-noise risk
 *      (initially `**\/marketing/Landing.tsx` per Phase 60-13). Accent usage
 *      ALWAYS fails — even pre-existing usages — unless the baseline file
 *      explicitly allows specific lines.
 *
 *   3. Everything else — accent usage is allowed IF the file is on the
 *      grandfather baseline (`scripts/ci/check-accent-reserved.baseline.txt`).
 *      NEW files with accent usage that aren't on the baseline fail.
 *
 * Rationale: Phase 60-13 caught 6 surfaces using accent tokens as decoration
 * (extracted-quote teal coloring, etc.) — visual weight without semantic
 * meaning. The audit is documented in
 * `leanshot/.planning/design-system/accent-reserved-list.md`.
 *
 * ### Runtime
 *
 *   deno run --no-check -A scripts/ci/check-accent-reserved.ts
 *
 * Exit codes:
 *   0 — pass (no violations, or all violations grandfathered)
 *   1 — violations outside baseline + outside reserved surfaces
 *   2 — script-internal error
 */

import { walk } from 'https://deno.land/std@0.224.0/fs/walk.ts';
import { join, relative } from 'https://deno.land/std@0.224.0/path/mod.ts';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AccentUsage {
  file: string;
  line: number;
  /** The accent class as it appears, e.g. `text-primary`, `bg-accent/50`. */
  className: string;
  /** Reserved-surface match (if any). */
  reservedMatch?: string;
  /** Forbidden-surface match (if any). */
  forbiddenMatch?: string;
}

export interface CheckResult {
  filesScanned: number;
  /** Files matched RESERVED_FILE_PATTERNS — accent allowed. */
  reservedAllowed: AccentUsage[];
  /** Files matched FORBIDDEN_FILE_PATTERNS — accent ALWAYS fails. */
  forbiddenViolations: AccentUsage[];
  /** Baseline grandfathered usages — accent allowed. */
  baselineAllowed: AccentUsage[];
  /** New-file usages not on baseline — accent fails. */
  newViolations: AccentUsage[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Accent-color Tailwind utility regex. Matches:
 *   text-primary, bg-accent, text-success-soft, bg-warning/50,
 *   ring-danger, border-info, text-primary-foreground
 *
 * Excludes pure `text-text-primary` (which is itself a separate token
 * concern, owned by DS-01 — not an accent).
 */
const ACCENT_TOKEN_NAMES = [
  'primary',
  'accent',
  'success',
  'warning',
  'danger',
  'info',
] as const;

const ACCENT_CLASS_RE = new RegExp(
  // Negative-look-behind: not preceded by an alphanumeric (would mean this is
  // mid-token, e.g. `text-text-primary` where `text-primary` would otherwise
  // match starting at position 5). Also not preceded by `-` (mid-class).
  `(?<![a-zA-Z0-9-])` +
    // Prefix:  text-/bg-/border-/ring-/from-/to-/via-/divide-/placeholder-/fill-/stroke-/accent-/decoration-/caret-/outline-
    `(text|bg|border|ring|from|to|via|divide|placeholder|fill|stroke|accent|decoration|caret|outline)-` +
    // Accent token name.
    `(${ACCENT_TOKEN_NAMES.join('|')})` +
    // Optional sub-modifier (-soft, -foreground, -hover) or opacity modifier (/N).
    `(?:-[a-z]+)?(?:/\\d+)?` +
    // Word boundary — followed by space, quote, end-of-string, etc.
    `(?=[\\s"'\`:/]|$)`,
  'g',
);

/**
 * File patterns where accent usage is INTENDED (reserved surfaces).
 * Each entry is matched against the relative path with a simple glob:
 *   `**\/Button.tsx`, `**\/ui/Badge.tsx`, etc.
 *
 * Patterns are converted to regex with `*` → `[^/]*` and `**` → `.*`.
 */
const RESERVED_FILE_PATTERNS: string[] = [
  '**/components/ui/Button.tsx',
  '**/components/ui/Badge.tsx',
  '**/components/ui/Pill.tsx',
  '**/components/ui/Spinner.tsx',
  '**/components/ui/Toast.tsx',
  '**/components/ui/ProgressRing.tsx',
  '**/components/ui/Sparkline.tsx',
  '**/components/ui/Confirm.tsx',
  '**/components/ui/EmptyState.tsx',
  '**/StatusDot.tsx',
  '**/StatusBadge.tsx',
  '**/StatusPill.tsx',
  '**/streaks/**',
  '**/badges/**',
  '**/charts/**',
  '**/dashboard/cards/**',
  // CTA primitives shipped per surface
  '**/CtaButton.tsx',
  '**/PrimaryCta.tsx',
  // Tab + nav state indicators
  '**/Sidebar.tsx',
  '**/MobileNav.tsx',
  '**/TabSwitcher.tsx',
  // Form validation surfaces
  '**/ErrorMessage.tsx',
  '**/FieldError.tsx',
  // Streak / gamification surfaces (defaults to accent)
  '**/StreakBanner.tsx',
  '**/StreakMeter.tsx',
];

/**
 * File patterns where accent usage is FORBIDDEN even on first sight.
 * Phase 60-13 caught accent-noise on the marketing landing's extracted
 * quote — those teal text-primary spans were decorative, not interactive.
 * Per CONTEXT.md, this is the canonical no-accent surface.
 */
const FORBIDDEN_FILE_PATTERNS: string[] = [
  '**/marketing/Landing.tsx',
];

// ─── Glob helpers ────────────────────────────────────────────────────────────

/**
 * Convert a `**\/glob/Pattern.tsx` to a RegExp. Supports `**`, `*`, literal
 * path segments. Anchored to match the FULL relative path.
 */
export function globToRegExp(pattern: string): RegExp {
  // Escape regex metacharacters except `*`.
  let p = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  // `**` → `.*`, then `*` → `[^/]*` (must happen in this order).
  p = p.replace(/\*\*/g, '___DOUBLESTAR___');
  p = p.replace(/\*/g, '[^/]*');
  p = p.replace(/___DOUBLESTAR___/g, '.*');
  return new RegExp(`^${p}$`);
}

const RESERVED_REGEXES = RESERVED_FILE_PATTERNS.map((p) => ({ pattern: p, re: globToRegExp(p) }));
const FORBIDDEN_REGEXES = FORBIDDEN_FILE_PATTERNS.map((p) => ({ pattern: p, re: globToRegExp(p) }));

function matchReserved(relPath: string): string | undefined {
  for (const { pattern, re } of RESERVED_REGEXES) {
    if (re.test(relPath)) return pattern;
  }
  return undefined;
}

function matchForbidden(relPath: string): string | undefined {
  for (const { pattern, re } of FORBIDDEN_REGEXES) {
    if (re.test(relPath)) return pattern;
  }
  return undefined;
}

// ─── Baseline loader ─────────────────────────────────────────────────────────

export function loadAllowList(baselinePath: string): Set<string> {
  const out = new Set<string>();
  let source: string;
  try {
    source = Deno.readTextFileSync(baselinePath);
  } catch {
    return out;
  }
  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    out.add(line);
  }
  return out;
}

// ─── Source scanning ─────────────────────────────────────────────────────────

export function scanSource(
  source: string,
): Array<{ line: number; className: string }> {
  // Strip block + line comments.
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const lines = stripped.split('\n');
  const out: Array<{ line: number; className: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].replace(/(^|\s)\/\/.*$/, '$1');
    if (!line.includes('-')) continue;

    // Only scan when we're inside a className-flavored context — accent class
    // names like 'text-primary' are also valid TypeScript discriminator strings
    // ('primary' tier, 'accent' theme variant), and we don't want false-fires.
    const isClassContext = /className\s*=|class\s*=|\bcn\s*\(|\bclsx\s*\(|\btw\s*`/.test(line);
    if (!isClassContext) continue;

    for (const m of line.matchAll(ACCENT_CLASS_RE)) {
      out.push({ line: i + 1, className: m[0] });
    }
  }

  return out;
}

// ─── Main scan ───────────────────────────────────────────────────────────────

export async function scanProject(
  srcRoot: string,
  allowList: Set<string> = new Set(),
): Promise<CheckResult> {
  const result: CheckResult = {
    filesScanned: 0,
    reservedAllowed: [],
    forbiddenViolations: [],
    baselineAllowed: [],
    newViolations: [],
  };

  for await (
    const entry of walk(srcRoot, {
      exts: ['.tsx', '.ts'],
      skip: [/\.test\.tsx?$/, /\.stories\.tsx?$/, /__tests__/],
    })
  ) {
    if (!entry.isFile) continue;
    result.filesScanned++;
    const relPath = relative(Deno.cwd(), entry.path);

    let source: string;
    try {
      source = await Deno.readTextFile(entry.path);
    } catch {
      continue;
    }

    const hits = scanSource(source);
    if (hits.length === 0) continue;

    const reservedMatch = matchReserved(relPath);
    const forbiddenMatch = matchForbidden(relPath);
    const isBaselined = allowList.has(relPath);

    for (const h of hits) {
      const usage: AccentUsage = { file: relPath, line: h.line, className: h.className };
      if (forbiddenMatch) {
        usage.forbiddenMatch = forbiddenMatch;
        // A baseline-listed forbidden file is STILL forbidden — the
        // forbidden-list overrides baselining (it's the strict no-accent
        // surface). But we allow per-LINE suppression in future via
        // `// DS-03-IGNORE: <reason>` if needed (not implemented v1).
        result.forbiddenViolations.push(usage);
      } else if (reservedMatch) {
        usage.reservedMatch = reservedMatch;
        result.reservedAllowed.push(usage);
      } else if (isBaselined) {
        result.baselineAllowed.push(usage);
      } else {
        result.newViolations.push(usage);
      }
    }
  }

  return result;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function formatResult(r: CheckResult): string {
  const lines: string[] = [];
  lines.push(`Files scanned: ${r.filesScanned}`);
  lines.push(`Reserved-surface allowed: ${r.reservedAllowed.length} usage(s)`);
  lines.push(`Baseline grandfathered: ${r.baselineAllowed.length} usage(s) in ${
    new Set(r.baselineAllowed.map((u) => u.file)).size
  } file(s)`);
  lines.push('');

  if (r.forbiddenViolations.length > 0) {
    lines.push(`FORBIDDEN-SURFACE ACCENT USAGE — ${r.forbiddenViolations.length}:`);
    lines.push('  (Phase 60-13: these surfaces MUST use neutral copy tokens.)');
    const byFile = new Map<string, AccentUsage[]>();
    for (const u of r.forbiddenViolations) {
      if (!byFile.has(u.file)) byFile.set(u.file, []);
      byFile.get(u.file)!.push(u);
    }
    for (const [file, us] of [...byFile.entries()].sort()) {
      lines.push(`  ${file}:`);
      for (const u of us) {
        lines.push(`    line ${u.line}: ${u.className}`);
      }
    }
    lines.push('');
  }

  if (r.newViolations.length > 0) {
    lines.push(`NEW-FILE ACCENT VIOLATIONS — ${r.newViolations.length}:`);
    lines.push('  (Not in baseline + not on reserved-surface list. Move to a ');
    lines.push('   reserved surface OR add to baseline with Phase 69.5 ticket.)');
    const byFile = new Map<string, AccentUsage[]>();
    for (const u of r.newViolations) {
      if (!byFile.has(u.file)) byFile.set(u.file, []);
      byFile.get(u.file)!.push(u);
    }
    for (const [file, us] of [...byFile.entries()].sort()) {
      lines.push(`  ${file}:`);
      for (const u of us) {
        lines.push(`    line ${u.line}: ${u.className}`);
      }
    }
  }

  if (r.forbiddenViolations.length === 0 && r.newViolations.length === 0) {
    lines.push('No DS-03 accent-reserved violations.');
  }

  return lines.join('\n');
}

if (import.meta.main) {
  const cwd = Deno.cwd();
  const srcRoot = Deno.env.get('SRC_ROOT') ?? join(cwd, 'leanshot', 'src');
  const baselinePath = Deno.env.get('BASELINE')
    ?? join(cwd, 'scripts', 'ci', 'check-accent-reserved.baseline.txt');

  try {
    const stat = await Deno.stat(srcRoot);
    if (!stat.isDirectory) {
      console.error(`FATAL: ${srcRoot} not a directory`);
      Deno.exit(2);
    }
  } catch {
    console.error(`FATAL: ${srcRoot} not found (cwd=${cwd}). Set SRC_ROOT.`);
    Deno.exit(2);
  }

  const allowList = loadAllowList(baselinePath);
  console.log(`Loaded baseline: ${allowList.size} grandfathered files`);

  const result = await scanProject(srcRoot, allowList);
  console.log(formatResult(result));

  const fail = result.forbiddenViolations.length + result.newViolations.length;
  if (fail > 0) {
    console.error('');
    console.error(`FAIL: ${fail} DS-03 accent-reserved violation(s).`);
    console.error('      See leanshot/.planning/design-system/accent-reserved-list.md');
    Deno.exit(1);
  }

  console.log('');
  console.log('PASS: accent-token usage respects reserved-list policy.');
  Deno.exit(0);
}
