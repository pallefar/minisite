/**
 * Phase 69 Plan 69-03 — DS-08 — Spacing audit (REPORT-ONLY).
 *
 * Heuristic: design-system spacing scale = multiples of 4. Flags any arbitrary
 * Tailwind value (`p-[Npx]`, `m-[Npx]`, `gap-[Npx]`, `space-x-[Npx]`,
 * `space-y-[Npx]`) where N is NOT a multiple of 4. The Tailwind default
 * `p-1` / `p-2` / ... scale is allowed (all map to multiples of 4 in the
 * default config: p-1 = 4px, p-2 = 8px, etc).
 *
 * Exceptions live in DESIGN-DECISIONS.md (e.g., "spacing 7px on X surface
 * because Y") — operator filters known carve-outs at Phase 69.5 sweep.
 *
 * Exit code: ALWAYS 0.
 *
 * Runtime: Deno.
 *
 *   deno run -A scripts/ci/audit-spacing.ts [--root=<path>] [--out=<path>] [--quiet]
 */

import { walk } from 'https://deno.land/std@0.224.0/fs/walk.ts';
import { join, relative, dirname, resolve } from 'https://deno.land/std@0.224.0/path/mod.ts';

// ─── Types ───────────────────────────────────────────────────────────────────

export type SpacingClass = 'padding' | 'margin' | 'gap' | 'space-x' | 'space-y';

export interface Finding {
  kind: SpacingClass;
  raw: string;
  px: number;
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
    outPath: 'leanshot/.planning/design-system/spacing-report.md',
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

/** Spacing grid: design-system enforces multiples of 4. */
export const GRID_PX = 4;

interface ArbPattern {
  kind: SpacingClass;
  re: RegExp;
  label: string;
}

/**
 * Patterns for arbitrary spacing tokens. We deliberately capture only
 * px-suffixed arbitraries — `p-[2rem]`, `gap-[1em]` are NOT handled (different
 * unit; heuristically much rarer in this codebase). Negative margins
 * (`-m-[8px]`) are also captured for completeness.
 *
 * Note: The `p` family includes `p`, `px`, `py`, `pt`, `pr`, `pb`, `pl`,
 * `ps`, `pe`. Same for `m`. We match conservatively.
 */
const PATTERNS: readonly ArbPattern[] = [
  {
    kind: 'padding',
    re: /\b-?p[trblxyse]?-\[(\d+)px\]/g,
    label: 'p-* / px-* / py-* / pt-* / pr-* / pb-* / pl-* / ps-* / pe-*',
  },
  {
    kind: 'margin',
    re: /\b-?m[trblxyse]?-\[(\d+)px\]/g,
    label: 'm-* / mx-* / my-* / mt-* / mr-* / mb-* / ml-* / ms-* / me-*',
  },
  { kind: 'gap', re: /\bgap(?:-x|-y)?-\[(\d+)px\]/g, label: 'gap-* / gap-x-* / gap-y-*' },
  { kind: 'space-x', re: /\bspace-x-\[(\d+)px\]/g, label: 'space-x-*' },
  { kind: 'space-y', re: /\bspace-y-\[(\d+)px\]/g, label: 'space-y-*' },
];

export interface SpacingMatch {
  kind: SpacingClass;
  raw: string;
  px: number;
}

/**
 * Probe a single line for non-grid arbitrary spacing tokens. Returns ALL
 * matches (a line can hold multiple).
 */
export function probeLine(line: string): SpacingMatch[] {
  const out: SpacingMatch[] = [];
  for (const pat of PATTERNS) {
    pat.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pat.re.exec(line)) !== null) {
      const px = Number(m[1]);
      if (Number.isNaN(px)) continue;
      if (px % GRID_PX === 0) continue;
      out.push({ kind: pat.kind, raw: m[0], px });
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
  if (shouldSkipFile(absPath)) return [];
  const relPath = relative(rootForRelative, absPath) || absPath;
  const lines = source.split(/\r?\n/);
  const out: Finding[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const hits = probeLine(line);
    for (const h of hits) {
      out.push({
        kind: h.kind,
        raw: h.raw,
        px: h.px,
        file: relPath,
        line: i + 1,
        excerpt: line.trim().slice(0, 160),
        suggestion: `\`${h.raw}\` — ${h.px}px is not a multiple of ${GRID_PX}. Snap to nearest grid step.`,
      });
    }
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

const KIND_ORDER: readonly SpacingClass[] = ['padding', 'margin', 'gap', 'space-x', 'space-y'];

export function buildReport(findings: readonly Finding[], generatedAt: string): string {
  const byKind = new Map<SpacingClass, Finding[]>();
  for (const k of KIND_ORDER) byKind.set(k, []);
  for (const f of findings) byKind.get(f.kind)?.push(f);

  const lines: string[] = [];
  lines.push('# Spacing Audit (DS-08)');
  lines.push('');
  lines.push(`Generated: ${generatedAt}`);
  lines.push('');
  lines.push('Report-only heuristic audit. False positives expected (intentional');
  lines.push('exceptions per surface). Document carve-outs in DESIGN-DECISIONS.md so');
  lines.push('Phase 69.5 sweep does not re-flag them.');
  lines.push('');
  lines.push(`Design-system grid: multiples of **${GRID_PX}px**. Tailwind default scale`);
  lines.push('(`p-1` = 4px, `p-2` = 8px, ...) is on-grid by definition — only `*-[Npx]`');
  lines.push('arbitrary values are scanned.');
  lines.push('');
  lines.push(`Total findings: **${findings.length}**`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Kind | Findings |');
  lines.push('| --- | --- |');
  for (const k of KIND_ORDER) {
    lines.push(`| ${k} | ${byKind.get(k)!.length} |`);
  }
  lines.push('');

  for (const k of KIND_ORDER) {
    const items = byKind.get(k)!;
    lines.push(`## ${k} — ${items.length} findings`);
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
    const summary = KIND_ORDER.map(
      (k) => `${k}=${findings.filter((f) => f.kind === k).length}`,
    ).join(' ');
    console.log(
      `[audit-spacing] wrote ${relative(args.root, outAbs)} — ${findings.length} findings (${summary})`,
    );
  }
  return 0;
}

if (import.meta.main) {
  const code = await runMain(Deno.args);
  Deno.exit(code);
}
