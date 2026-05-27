/**
 * Phase 69 Plan 69-03 — DS-07 — Mobile-responsive grep audit (REPORT-ONLY).
 *
 * Heuristic checks for surfaces that won't reflow at 375px (iPhone SE) or
 * have sub-44pt tap targets:
 *
 *   1. fixed-width-too-wide       — `w-[NNNpx]` where NNN > 375 with no
 *                                   `md:` / `lg:` responsive override on the
 *                                   same line.
 *   2. tap-target-too-small       — `<button>` or `<a>` with `h-[Npx]` or
 *                                   `min-h-[Npx]` where N < 44.
 *   3. horizontal-scroll-fallback — `overflow-x-auto` declarations (often
 *                                   indicate horizontal scroll fallback for
 *                                   content that should reflow).
 *   4. table-no-overflow-wrapper  — `<table>` element NOT inside an
 *                                   `overflow-x-auto` wrapper (a heuristic
 *                                   only — checks 3 lines above for the
 *                                   wrapper).
 *
 * Exit code: ALWAYS 0. Report-only.
 *
 * Runtime: Deno.
 *
 *   deno run -A scripts/ci/audit-mobile-responsive.ts [--root=<path>] [--out=<path>] [--quiet]
 */

import { walk } from 'https://deno.land/std@0.224.0/fs/walk.ts';
import { join, relative, dirname, resolve } from 'https://deno.land/std@0.224.0/path/mod.ts';

// ─── Types ───────────────────────────────────────────────────────────────────

export type CheckName =
  | 'fixed-width-too-wide'
  | 'tap-target-too-small'
  | 'horizontal-scroll-fallback'
  | 'table-no-overflow-wrapper';

export interface Finding {
  check: CheckName;
  file: string;
  line: number;
  excerpt: string;
  suggestion: string;
}

export interface CliArgs {
  root: string;
  outPath: string;
  quiet: boolean;
}

export function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    root: Deno.cwd(),
    outPath: 'leanshot/.planning/design-system/mobile-responsive-report.md',
    quiet: false,
  };
  for (const raw of argv) {
    if (raw.startsWith('--root=')) {
      args.root = resolve(raw.slice('--root='.length));
    } else if (raw.startsWith('--out=')) {
      args.outPath = raw.slice('--out='.length);
    } else if (raw === '--quiet') {
      args.quiet = true;
    }
  }
  args.root = resolve(args.root);
  return args;
}

// ─── Heuristics ──────────────────────────────────────────────────────────────

/** Mobile breakpoint (iPhone SE). Widths above this without md/lg override flag. */
export const MOBILE_BREAKPOINT_PX = 375;
/** Apple HIG / Material minimum tap-target size. */
export const MIN_TAP_TARGET_PX = 44;

const WIDTH_PX = /\bw-\[(\d+)px\]/g;
const RESPONSIVE_BREAKPOINT = /\b(sm|md|lg|xl|2xl):/;

export interface WideWidthHit {
  excerpt: string;
  suggestion: string;
}

export function probeFixedWidth(line: string): WideWidthHit | null {
  WIDTH_PX.lastIndex = 0;
  let m: RegExpExecArray | null;
  let hit: WideWidthHit | null = null;
  while ((m = WIDTH_PX.exec(line)) !== null) {
    const px = Number(m[1]);
    if (px > MOBILE_BREAKPOINT_PX) {
      // If line also contains a responsive override (md:w-* / lg:w-*), assume
      // the dev handled it. Cheap check — could miss multiline JSX.
      if (RESPONSIVE_BREAKPOINT.test(line)) continue;
      hit = {
        excerpt: line.trim().slice(0, 160),
        suggestion: `w-[${px}px] exceeds ${MOBILE_BREAKPOINT_PX}px mobile breakpoint without md:/lg: override`,
      };
      // Take first hit per line.
      return hit;
    }
  }
  return null;
}

const TAP_TARGET_RE = /\b(?:min-)?h-\[(\d+)px\]/g;
const TAP_TARGET_TAG = /<(?:button|a)\b/;

export interface TapTargetHit {
  excerpt: string;
  suggestion: string;
}

export function probeTapTarget(line: string): TapTargetHit | null {
  if (!TAP_TARGET_TAG.test(line)) return null;
  TAP_TARGET_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAP_TARGET_RE.exec(line)) !== null) {
    const px = Number(m[1]);
    if (px < MIN_TAP_TARGET_PX) {
      return {
        excerpt: line.trim().slice(0, 160),
        suggestion: `<button|a> height ${px}px < ${MIN_TAP_TARGET_PX}px (Apple HIG / Material tap-target minimum)`,
      };
    }
  }
  return null;
}

const OVERFLOW_X_AUTO = /\boverflow-x-auto\b/;

export function probeHorizontalScroll(
  line: string,
): { excerpt: string; suggestion: string } | null {
  if (!OVERFLOW_X_AUTO.test(line)) return null;
  return {
    excerpt: line.trim().slice(0, 160),
    suggestion: '`overflow-x-auto` — verify content reflows on mobile instead of relying on horizontal scroll',
  };
}

const TABLE_OPENER = /<table\b/;

/**
 * Heuristic: for each `<table>` opener, look at the previous up-to-3 lines for
 * a wrapper with `overflow-x-auto`. If absent, flag.
 */
export function findTablesWithoutOverflowWrapper(source: string): Array<{
  line: number;
  excerpt: string;
}> {
  const lines = source.split(/\r?\n/);
  const out: Array<{ line: number; excerpt: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    if (!TABLE_OPENER.test(lines[i])) continue;
    // Look back 3 lines for a wrapper.
    let hasWrapper = false;
    for (let j = Math.max(0, i - 3); j < i; j++) {
      if (OVERFLOW_X_AUTO.test(lines[j])) {
        hasWrapper = true;
        break;
      }
    }
    // Also check the same line — `<div class="overflow-x-auto"><table>` is possible inline.
    if (!hasWrapper && OVERFLOW_X_AUTO.test(lines[i])) hasWrapper = true;
    if (!hasWrapper) {
      out.push({ line: i + 1, excerpt: lines[i].trim().slice(0, 160) });
    }
  }
  return out;
}

// ─── File-skip ───────────────────────────────────────────────────────────────

export function shouldSkipFile(absPath: string): boolean {
  return (
    /\.(test|spec)\.tsx?$/.test(absPath) ||
    /\/__tests__\//.test(absPath)
  );
}

// ─── Scanner ─────────────────────────────────────────────────────────────────

export function scanFile(absPath: string, source: string, rootForRelative: string): Finding[] {
  const out: Finding[] = [];
  if (shouldSkipFile(absPath)) return out;
  const relPath = relative(rootForRelative, absPath) || absPath;
  const lines = source.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fw = probeFixedWidth(line);
    if (fw) {
      out.push({
        check: 'fixed-width-too-wide',
        file: relPath,
        line: i + 1,
        excerpt: fw.excerpt,
        suggestion: fw.suggestion,
      });
    }
    const tt = probeTapTarget(line);
    if (tt) {
      out.push({
        check: 'tap-target-too-small',
        file: relPath,
        line: i + 1,
        excerpt: tt.excerpt,
        suggestion: tt.suggestion,
      });
    }
    const hs = probeHorizontalScroll(line);
    if (hs) {
      out.push({
        check: 'horizontal-scroll-fallback',
        file: relPath,
        line: i + 1,
        excerpt: hs.excerpt,
        suggestion: hs.suggestion,
      });
    }
  }

  for (const t of findTablesWithoutOverflowWrapper(source)) {
    out.push({
      check: 'table-no-overflow-wrapper',
      file: relPath,
      line: t.line,
      excerpt: t.excerpt,
      suggestion: '`<table>` not wrapped in `overflow-x-auto` — small-screen UX may break',
    });
  }
  return out;
}

export async function scanRoot(root: string): Promise<Finding[]> {
  const srcDir = join(root, 'leanshot', 'src');
  let exists = false;
  try {
    const st = await Deno.stat(srcDir);
    exists = st.isDirectory;
  } catch {
    exists = false;
  }
  if (!exists) return [];

  const findings: Finding[] = [];
  for await (const entry of walk(srcDir, {
    includeDirs: false,
    includeFiles: true,
    exts: ['tsx', 'ts'],
    skip: [/\/__tests__\//, /\.test\.tsx?$/, /\.spec\.tsx?$/],
  })) {
    if (!entry.isFile) continue;
    let source: string;
    try {
      source = await Deno.readTextFile(entry.path);
    } catch {
      continue;
    }
    findings.push(...scanFile(entry.path, source, root));
  }
  return findings;
}

// ─── Report builder ──────────────────────────────────────────────────────────

const CHECK_TITLES: Record<CheckName, string> = {
  'fixed-width-too-wide': `Hardcoded width > ${MOBILE_BREAKPOINT_PX}px without responsive override`,
  'tap-target-too-small': `Tap target < ${MIN_TAP_TARGET_PX}px (Apple HIG / Material)`,
  'horizontal-scroll-fallback': '`overflow-x-auto` (verify reflow vs scroll)',
  'table-no-overflow-wrapper': '`<table>` without `overflow-x-auto` wrapper',
};

const CHECK_ORDER: readonly CheckName[] = [
  'fixed-width-too-wide',
  'tap-target-too-small',
  'horizontal-scroll-fallback',
  'table-no-overflow-wrapper',
];

export function buildReport(findings: readonly Finding[], generatedAt: string): string {
  const byCheck = new Map<CheckName, Finding[]>();
  for (const c of CHECK_ORDER) byCheck.set(c, []);
  for (const f of findings) byCheck.get(f.check)?.push(f);

  const lines: string[] = [];
  lines.push('# Mobile-Responsive Audit (DS-07)');
  lines.push('');
  lines.push(`Generated: ${generatedAt}`);
  lines.push('');
  lines.push('Report-only heuristic audit. False positives expected — operator filters');
  lines.push('during fix pass (Phase 69.5). Script exits 0 regardless of findings.');
  lines.push('');
  lines.push(
    `Mobile breakpoint: ${MOBILE_BREAKPOINT_PX}px (iPhone SE). Min tap target: ${MIN_TAP_TARGET_PX}px.`,
  );
  lines.push('');
  lines.push(`Total findings: **${findings.length}**`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Check | Findings |');
  lines.push('| --- | --- |');
  for (const c of CHECK_ORDER) {
    lines.push(`| ${CHECK_TITLES[c]} | ${byCheck.get(c)!.length} |`);
  }
  lines.push('');

  for (const c of CHECK_ORDER) {
    const items = byCheck.get(c)!;
    lines.push(`## ${CHECK_TITLES[c]} — ${items.length} findings`);
    lines.push('');
    if (items.length === 0) {
      lines.push('_None detected._');
      lines.push('');
      continue;
    }
    items.sort((a, b) =>
      a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file),
    );
    for (const f of items) {
      lines.push(`- \`${f.file}:${f.line}\` — ${f.suggestion}`);
      lines.push('  ```');
      lines.push(`  ${f.excerpt}`);
      lines.push('  ```');
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function runMain(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  const findings = await scanRoot(args.root);
  const report = buildReport(findings, new Date().toISOString());
  const outAbs = resolve(args.root, args.outPath);
  await Deno.mkdir(dirname(outAbs), { recursive: true });
  await Deno.writeTextFile(outAbs, report + '\n');
  if (!args.quiet) {
    const summary = CHECK_ORDER.map(
      (c) => `${c}=${findings.filter((f) => f.check === c).length}`,
    ).join(' ');
    console.log(
      `[audit-mobile-responsive] wrote ${relative(args.root, outAbs)} — ${findings.length} findings (${summary})`,
    );
  }
  return 0;
}

if (import.meta.main) {
  const code = await runMain(Deno.args);
  Deno.exit(code);
}
