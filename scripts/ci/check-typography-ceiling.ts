/**
 * Phase 69 Plan 69-01 — DS-02 typography ceiling CI guard.
 *
 * Enforces that custom font-size + font-weight declarations across the
 * codebase respect the Phase 60-13 typography ceiling:
 *
 *   - Allowed font-sizes:  {11, 13, 18, 28} px  (per ROADMAP DS-02)
 *   - Allowed font-weights: {400, 600}           (per ROADMAP DS-02)
 *
 * Phase 60-13 normalized 6 surfaces (/knowledge, /research, etc.) to this
 * ceiling. This gate prevents regression — and prevents net-new surfaces
 * (Phase 65+) from introducing yet another type scale.
 *
 * ### Scope (heuristic, not full type-checker)
 *
 * The gate flags:
 *  1. Tailwind arbitrary font-size literals:  `text-[14px]`, `text-[1.5rem]`
 *  2. Tailwind built-in font-size utilities OUTSIDE the ceiling set
 *     (text-xs=12, text-base=16, text-xl=22 etc. — but allow text-sm=13,
 *     text-lg=18, text-heading=28 plus a `text-[11px]` shortcut).
 *  3. Inline styles:  `style={{ fontSize: '14px' }}`
 *  4. CSS files (other than `index.css` itself): bare `font-size: 14px`
 *  5. Tailwind font-weight named utilities outside {normal, semibold}
 *     (`font-medium`, `font-bold`, `font-thin`, `font-light`, etc.)
 *  6. Tailwind arbitrary font-weight literals outside {400, 600}.
 *
 * ### Known limitations
 *
 * - CSS-in-JS variants (styled-components, emotion) are not parsed.
 * - Dynamic `${size}px` interpolations are not detected.
 * - The gate trusts `index.css` itself as the @theme source-of-truth;
 *   declarations there are NOT flagged.
 *
 * ### Allow-list
 *
 * Files on the ALLOW_LIST are grandfathered (existing-violation tolerance).
 * Phase 69.5 tech-debt sweep replaces them. Per Phase 60-13: the marketing
 * landing + select onboarding surfaces are still mid-migration.
 *
 * ### Runtime
 *
 *   deno run --no-check -A scripts/ci/check-typography-ceiling.ts
 *
 * Exit codes:
 *   0  — no ceiling violations
 *   1  — at least one violation outside ALLOW_LIST
 *   2  — script-internal error
 */

import { walk } from 'https://deno.land/std@0.224.0/fs/walk.ts';
import { join, relative } from 'https://deno.land/std@0.224.0/path/mod.ts';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CeilingViolation {
  file: string;
  line: number;
  kind: 'font-size-arbitrary' | 'font-size-utility' | 'font-size-inline' | 'font-size-css' | 'font-weight-utility' | 'font-weight-arbitrary' | 'font-weight-css';
  /** The full match as it appears in source. */
  match: string;
  /** Computed pixel value (or named weight) that failed the ceiling. */
  value: string;
}

export interface CheckResult {
  filesScanned: number;
  violations: CeilingViolation[];
  allowListed: CeilingViolation[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ALLOWED_PX = new Set<number>([11, 13, 18, 28]);
const ALLOWED_WEIGHTS = new Set<number>([400, 600]);

/**
 * Tailwind v4 built-in font-size → px (default Tailwind scale).
 * NOTE: project overrides some of these via @theme (--text-sm=13px,
 * --text-lg=18px, --text-heading=28px). Where the @theme override LANDS
 * ON the ceiling we treat the utility as ALLOWED. Where it DOESN'T (e.g.
 * --text-base=16px, --text-xl=22px, --text-2xl=26px), the utility is
 * flagged on use.
 */
const TAILWIND_TEXT_PX: Record<string, number> = {
  'text-caption': 10,
  'text-micro': 11,
  'text-xs': 12,
  'text-sm': 13,
  'text-base': 16,
  'text-md': 16,
  'text-lg': 18,
  'text-xl': 22,
  'text-2xl': 26,
  'text-heading': 28,
  'text-3xl': 32,
  'text-4xl': 42,
  'text-5xl': 56,
  'text-display': 64,
};

/**
 * Tailwind v4 named font-weight utility → numeric weight.
 */
const TAILWIND_FONT_WEIGHT: Record<string, number> = {
  'font-thin': 100,
  'font-extralight': 200,
  'font-light': 300,
  'font-normal': 400,
  'font-medium': 500,
  'font-semibold': 600,
  'font-bold': 700,
  'font-extrabold': 800,
  'font-black': 900,
};

/**
 * Grandfathered files — DS-02 violations tolerated until Phase 69.5 sweep.
 *
 * Loaded from `scripts/ci/check-typography-ceiling.baseline.txt` at runtime.
 * Lines beginning with `#` are comments; blank lines are ignored.
 *
 * To shrink the baseline (i.e., after migrating a file to the ceiling):
 *   1. Remove its line from the baseline file.
 *   2. Re-run the script — should still PASS.
 * To add a new file (Phase 69.5 migration in progress):
 *   1. Add its relative path to the baseline file.
 *   2. Re-run; gate goes green.
 */
function loadAllowList(baselinePath: string): Set<string> {
  const out = new Set<string>();
  let source: string;
  try {
    source = Deno.readTextFileSync(baselinePath);
  } catch {
    // Baseline file missing — start with empty allow-list.
    return out;
  }
  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    out.add(line);
  }
  return out;
}

// ─── Parsers ─────────────────────────────────────────────────────────────────

/**
 * Convert a CSS size literal to pixels.
 *   "14px"   → 14
 *   "1rem"   → 16
 *   "0.875rem" → 14
 *   "1.5em"  → null (em is contextual — skip)
 *   "100%"   → null
 *
 * Returns null if the unit cannot be safely converted (caller treats as
 * unknown → not flagged).
 */
export function parseSizeToPx(literal: string): number | null {
  const m = literal.trim().match(/^(-?\d*\.?\d+)(px|rem)$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  if (unit === 'px') return Math.round(n);
  if (unit === 'rem') return Math.round(n * 16);
  return null;
}

/**
 * Scan a single .tsx/.ts source file for font-size + font-weight violations.
 */
export function scanTsxSource(
  source: string,
): Array<Omit<CeilingViolation, 'file'>> {
  // Strip comments (block + line) to suppress prose false-positives.
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const out: Array<Omit<CeilingViolation, 'file'>> = [];
  const lines = stripped.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/(^|\s)\/\/.*$/, '$1');
    if (!line.includes('text') && !line.includes('font') && !line.includes('fontSize') && !line.includes('fontWeight')) {
      continue;
    }

    // 1. Arbitrary font-size: text-[14px], text-[1.25rem]
    for (const m of line.matchAll(/\btext-\[([0-9.]+(?:px|rem))\]/g)) {
      const px = parseSizeToPx(m[1]);
      if (px === null) continue;
      if (!ALLOWED_PX.has(px)) {
        out.push({ line: i + 1, kind: 'font-size-arbitrary', match: m[0], value: `${px}px` });
      }
    }

    // 2. Tailwind built-in text-{name} utility — only flag if in className/cn/clsx context.
    const isClassContext = /className\s*=|class\s*=|\bcn\s*\(|\bclsx\s*\(|\btw\s*`/.test(line);
    if (isClassContext) {
      for (const [name, px] of Object.entries(TAILWIND_TEXT_PX)) {
        // Use a strict tokenized match — preceded by `"`, `'`, `` ` ``, or whitespace,
        // followed by similar boundary so e.g. `text-base-foo` doesn't double-match.
        const re = new RegExp(`(?:^|[\\s"'\`])(${name})(?=[\\s"'\`:]|$)`, 'g');
        for (const m of line.matchAll(re)) {
          if (!ALLOWED_PX.has(px)) {
            out.push({
              line: i + 1,
              kind: 'font-size-utility',
              match: m[1],
              value: `${px}px`,
            });
          }
        }
      }
    }

    // 3. Inline style: style={{ fontSize: '14px' }} or style={{ fontSize: 14 }}
    for (const m of line.matchAll(/fontSize\s*:\s*['"`]?([0-9.]+)(px|rem)?['"`]?/g)) {
      const val = m[2] ? `${m[1]}${m[2]}` : `${m[1]}px`;
      const px = parseSizeToPx(val);
      if (px === null) continue;
      if (!ALLOWED_PX.has(px)) {
        out.push({ line: i + 1, kind: 'font-size-inline', match: m[0], value: `${px}px` });
      }
    }

    // 4. font-weight named utility (only inside className-flavored context).
    if (isClassContext) {
      for (const [name, weight] of Object.entries(TAILWIND_FONT_WEIGHT)) {
        const re = new RegExp(`(?:^|[\\s"'\`])(${name})(?=[\\s"'\`:]|$)`, 'g');
        for (const m of line.matchAll(re)) {
          if (!ALLOWED_WEIGHTS.has(weight)) {
            out.push({
              line: i + 1,
              kind: 'font-weight-utility',
              match: m[1],
              value: `${weight}`,
            });
          }
        }
      }
    }

    // 5. Tailwind arbitrary font-weight: font-[500]
    for (const m of line.matchAll(/\bfont-\[(\d{3})\]/g)) {
      const w = parseInt(m[1], 10);
      if (!ALLOWED_WEIGHTS.has(w)) {
        out.push({ line: i + 1, kind: 'font-weight-arbitrary', match: m[0], value: `${w}` });
      }
    }

    // 6. Inline style: fontWeight: 500 / '500'
    for (const m of line.matchAll(/fontWeight\s*:\s*['"`]?(\d{3})['"`]?/g)) {
      const w = parseInt(m[1], 10);
      if (!ALLOWED_WEIGHTS.has(w)) {
        out.push({ line: i + 1, kind: 'font-weight-utility', match: m[0], value: `${w}` });
      }
    }
  }

  return out;
}

/**
 * Scan a CSS source file (not index.css itself) for raw font-size/font-weight
 * declarations outside the ceiling.
 */
export function scanCssSource(
  source: string,
): Array<Omit<CeilingViolation, 'file'>> {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const out: Array<Omit<CeilingViolation, 'file'>> = [];
  const lines = stripped.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // font-size: <number><unit>
    for (const m of line.matchAll(/font-size\s*:\s*([0-9.]+(?:px|rem))/gi)) {
      const px = parseSizeToPx(m[1]);
      if (px === null) continue;
      if (!ALLOWED_PX.has(px)) {
        out.push({ line: i + 1, kind: 'font-size-css', match: m[0], value: `${px}px` });
      }
    }

    // font-weight: <number>
    for (const m of line.matchAll(/font-weight\s*:\s*(\d{3})/gi)) {
      const w = parseInt(m[1], 10);
      if (!ALLOWED_WEIGHTS.has(w)) {
        out.push({ line: i + 1, kind: 'font-weight-css', match: m[0], value: `${w}` });
      }
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
    violations: [],
    allowListed: [],
  };

  for await (
    const entry of walk(srcRoot, {
      exts: ['.tsx', '.ts', '.css'],
      skip: [/\.test\.tsx?$/, /\.stories\.tsx?$/, /__tests__/],
    })
  ) {
    if (!entry.isFile) continue;
    result.filesScanned++;
    const relPath = relative(Deno.cwd(), entry.path);

    // index.css IS the @theme source-of-truth; skip.
    if (relPath.endsWith('/index.css') || relPath.endsWith('\\index.css')) continue;

    let source: string;
    try {
      source = await Deno.readTextFile(entry.path);
    } catch {
      continue;
    }

    const raw = entry.path.endsWith('.css')
      ? scanCssSource(source)
      : scanTsxSource(source);

    const isAllowed = allowList.has(relPath);

    for (const v of raw) {
      const violation: CeilingViolation = { file: relPath, ...v };
      if (isAllowed) result.allowListed.push(violation);
      else result.violations.push(violation);
    }
  }

  return result;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function formatResult(r: CheckResult): string {
  const lines: string[] = [];
  lines.push(`Files scanned: ${r.filesScanned}`);
  lines.push(`Allowed font-sizes (px): ${[...ALLOWED_PX].sort((a, b) => a - b).join(', ')}`);
  lines.push(`Allowed font-weights: ${[...ALLOWED_WEIGHTS].sort((a, b) => a - b).join(', ')}`);
  lines.push('');

  if (r.allowListed.length > 0) {
    lines.push(`Allow-listed (grandfathered) — ${r.allowListed.length}:`);
    const byFile = new Map<string, number>();
    for (const v of r.allowListed) byFile.set(v.file, (byFile.get(v.file) ?? 0) + 1);
    for (const [file, count] of [...byFile.entries()].sort()) {
      lines.push(`  • ${file} — ${count} usage(s)`);
    }
    lines.push('');
  }

  if (r.violations.length > 0) {
    lines.push(`CEILING VIOLATIONS — ${r.violations.length}:`);
    const byFile = new Map<string, CeilingViolation[]>();
    for (const v of r.violations) {
      if (!byFile.has(v.file)) byFile.set(v.file, []);
      byFile.get(v.file)!.push(v);
    }
    for (const [file, vs] of [...byFile.entries()].sort()) {
      lines.push(`  ${file}:`);
      for (const v of vs) {
        lines.push(`    line ${v.line} [${v.kind}]: ${v.match} → ${v.value}`);
      }
    }
  } else {
    lines.push('No typography-ceiling violations found.');
  }

  return lines.join('\n');
}

if (import.meta.main) {
  const cwd = Deno.cwd();
  const srcRoot = Deno.env.get('SRC_ROOT') ?? join(cwd, 'leanshot', 'src');
  const baselinePath = Deno.env.get('BASELINE')
    ?? join(cwd, 'scripts', 'ci', 'check-typography-ceiling.baseline.txt');

  try {
    const stat = await Deno.stat(srcRoot);
    if (!stat.isDirectory) {
      console.error(`FATAL: ${srcRoot} is not a directory`);
      Deno.exit(2);
    }
  } catch {
    console.error(`FATAL: ${srcRoot} not found (cwd=${cwd}). Set SRC_ROOT.`);
    Deno.exit(2);
  }

  const allowList = loadAllowList(baselinePath);
  console.log(`Loaded baseline: ${allowList.size} grandfathered files`);
  console.log('');

  const result = await scanProject(srcRoot, allowList);
  console.log(formatResult(result));

  if (result.violations.length > 0) {
    console.error('');
    console.error(`FAIL: ${result.violations.length} typography-ceiling violation(s).`);
    console.error('      Allowed font-sizes: {11, 13, 18, 28} px.');
    console.error('      Allowed font-weights: {400, 600}.');
    console.error('      Fix: use text-micro/text-sm/text-lg/text-heading + font-normal/font-semibold,');
    console.error('      or add to ALLOW_LIST if migration deferred to Phase 69.5.');
    Deno.exit(1);
  }

  console.log('');
  console.log('PASS: all font-size + font-weight declarations respect the ceiling.');
  Deno.exit(0);
}
